/*
 * The only two places a test reaches into a production class.
 *
 * Both exist because the thing being asserted has no other observable -- there
 * is no event for "a frame was drawn" and none for "the device is gone", and
 * the alternative to spying would be widening `src/index.ts` with a rendering
 * type so that a test could look at it.
 *
 * `vi.spyOn` replaces a prototype method for the whole page, so every file that
 * imports this must call `vi.restoreAllMocks()` in `afterEach`. Files are
 * isolated from each other in browser mode, so the restore only has to protect
 * the file that installed the spy.
 */

import { vi } from 'vitest'
import { WebGPUBackend } from '../../../src/renderer/webgpu/backend'

/**
 * Counts the frames a backend draws.
 *
 * `render()` is the only call that reaches the swapchain, so counting it is
 * counting frames. The spy calls through: these tests ask how MANY times the
 * loop ran, not what it drew, and a stubbed-out render would be a loop that
 * never rendered at all.
 *
 * Returns a reader rather than the spy, so a test that wants a delta cannot
 * accidentally assert on a total.
 */
export function countDraws (): () => number {
  const spy = vi.spyOn(WebGPUBackend.prototype, 'render')
  spy.mockClear()
  return () => spy.mock.calls.length
}

/**
 * Collects the backends created while this is installed.
 *
 * For the one test that destroys a device: `Viewer` holds its backend in a
 * private field, and putting a `Backend` getter on the public surface so that a
 * single test could reach the device would be the test dictating the API.
 *
 * Wrapping the static factory is the narrow version of that -- it touches no
 * source file and the wrapper is gone when the spy is restored. A `null` return
 * (no adapter) is passed through unchanged: the caller decides what to do about
 * it, and one of the callers is the no-WebGPU project, where it is the point.
 */
export function captureBackends (): WebGPUBackend[] {
  const created: WebGPUBackend[] = []
  const original = WebGPUBackend.create
  vi.spyOn(WebGPUBackend, 'create').mockImplementation(async (canvas) => {
    const backend = await original(canvas)
    if (backend !== null) created.push(backend)
    return backend
  })
  return created
}
