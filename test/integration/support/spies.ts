/*
 * The places a test reaches into a production class.
 *
 * All of them exist because the thing being asserted has no other observable --
 * there is no event for "a frame was drawn", none for "the device is gone", and
 * none for "this is the frame the viewer handed the backend". The alternative
 * to spying would be widening `src/index.ts` -- whose public surface Task 4
 * froze at the two viewer classes and their option types, none of which
 * exposes a rendering type or a teardown hook -- so spying through here remains
 * the narrow way to look at any of it.
 *
 * `vi.spyOn` replaces a prototype method for the whole page, so every file that
 * imports this must call `vi.restoreAllMocks()` in `afterEach`. Files are
 * isolated from each other in browser mode, so the restore only has to protect
 * the file that installed the spy.
 */

import { vi } from 'vitest'
import { WebGPUBackend } from '../../../src/renderer/webgpu/backend'
import { WebGL2Backend } from '../../../src/renderer/webgl2/backend'
import { EventEmitter } from '../../../src/core/events'
import type { RenderableSource } from '../../../src/renderer/backend'
import type { CameraState, Projection } from '../../../src/core/types'

/**
 * Counts every frame drawn by whichever backend the viewer selected.
 *
 * Both prototypes, and since 2026-09-24 as coverage, not just prophylaxis:
 * dispose-order and viewer-events now run in the no-webgpu project, where the
 * viewer mounts a WebGL2Backend -- and on the CI runner that project is the
 * ONLY execution of their draw-count assertions, because the integration
 * copies skip there behind the presented-canvas gate. A WebGPU-only wrap
 * would hand those tests `toBe(0)` passing against a method nobody calls,
 * which is worse than a red test, because it survives review.
 * viewer-render-input stays outside that project's include, so for it the
 * wrap remains prophylaxis against the same vacuous-pass shape arriving.
 *
 * The spies call through, and the reader sums the two accounts -- the same
 * shape `captureRenderInputs` gives `sourceCalls`. Calling through is the
 * point: a helper that stubs `render` hands a guaranteed-blank canvas to any
 * test that counts draws and then reads pixels.
 *
 * Returns a reader rather than a count: the callers snapshot it before and after
 * an action, and two reads of one number is what lets them.
 */
export function countDraws (): () => number {
  const spies = [
    vi.spyOn(WebGPUBackend.prototype, 'render'),
    vi.spyOn(WebGL2Backend.prototype, 'render')
  ]
  for (const spy of spies) spy.mockClear()
  return () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0)
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
 * it. Its one caller probes for an adapter first and skips itself in the
 * no-adapter world before installing this, so in the no-webgpu project this
 * spy is never even reached -- the null pass-through is the factory's honesty
 * about failure, not a branch some project exercises.
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

/**
 * Records what the viewer hands the backend on each frame.
 *
 * `countDraws` above answers "did the loop run"; this answers "with what",
 * which is a different question and one no pixel comparison can reach. A
 * viewer that called `setSource(null)` for ever, or pinned the camera to the
 * origin, would still draw the right NUMBER of frames -- so a suite built only
 * on `countDraws` stays green through both, as the quality review measured.
 *
 * Both spies call through. These tests assert on the arguments, not on a
 * stubbed-out backend: replacing `setSource` with a recorder would leave the
 * real backend never told about the source, and every pixel assertion made
 * afterwards would be about a frame nobody rendered.
 *
 * BOTH prototypes, for the same reason `countDraws` wraps both: the same
 * user-story file runs in two projects and only one backend exists in each.
 * At most one of the two accounts is ever non-empty -- "the last call" is the
 * last call of whichever one is, and `sourceCalls` is their sum for the same
 * reason the draw counter is one number.
 */
export function captureRenderInputs (): {
  readonly lastSource: () => RenderableSource | null | undefined
  readonly lastCamera: () => { state: CameraState, projection: Projection } | undefined
  readonly sourceCalls: () => number
} {
  const sources = [
    vi.spyOn(WebGPUBackend.prototype, 'setSource'),
    vi.spyOn(WebGL2Backend.prototype, 'setSource')
  ]
  const cameras = [
    vi.spyOn(WebGPUBackend.prototype, 'setCamera'),
    vi.spyOn(WebGL2Backend.prototype, 'setCamera')
  ]
  for (const spy of [...sources, ...cameras]) spy.mockClear()

  return {
    // `undefined` means "never called", `null` means "called with no source".
    // Collapsing the two would make the not-yet-loaded case indistinguishable
    // from a backend the viewer never spoke to at all.
    lastSource: () => {
      for (const spy of sources) {
        if (spy.mock.calls.length > 0) return spy.mock.calls.at(-1)?.[0]
      }
      return undefined
    },
    lastCamera: () => {
      for (const spy of cameras) {
        const call = spy.mock.calls.at(-1)
        if (call !== undefined) return { state: call[0], projection: call[1] }
      }
      return undefined
    },
    sourceCalls: () => sources.reduce((total, spy) => total + spy.mock.calls.length, 0)
  }
}

/**
 * Counts the teardown calls one `dispose` must make.
 *
 * `dispose-order.test.ts` spies on `RenderLoop.prototype.dispose` and on
 * `window.cancelAnimationFrame` inline; the user-story files cannot do the
 * same for these two, because their import discipline allows `src/index.ts`
 * only and one of the two targets is an internal class's prototype method.
 * The spy therefore lives here with the other production-class reach-ins, and
 * the user-story file stays on the public surface.
 *
 * `emitterTeardowns` counts EVERY emitter's `removeAllListeners`, not just the
 * viewer's: one dispose tears down three of them (the source's, the input
 * controller's and the viewer's own), and the reader comparing against that
 * count is the same `dispose-order` technique one layer up -- a teardown step
 * that went missing shows up as a missing call, whatever it was attached to.
 */
export function captureTeardown (): {
  readonly disconnects: () => number
  readonly emitterTeardowns: () => number
} {
  const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
  const removeAll = vi.spyOn(EventEmitter.prototype, 'removeAllListeners')
  disconnect.mockClear()
  removeAll.mockClear()
  return {
    disconnects: () => disconnect.mock.calls.length,
    emitterTeardowns: () => removeAll.mock.calls.length
  }
}
