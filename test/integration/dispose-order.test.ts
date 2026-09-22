import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'
import { Viewer } from '../../src/viewer/viewer'
import { ImageSource } from '../../src/media/image-source'
import type { MediaSource } from '../../src/media/source'
import { canvasOf, makeContainer } from './support/dom'
import { countDraws, captureBackends } from './support/spies'
import { nextFrames } from './support/canvas'

/*
 * `Viewer.setSource` is protected, and it is protected for a reason: a subclass
 * is the only thing allowed to swap a source, so that the four-part swap (drop
 * the old subscriptions, dispose the old source, subscribe the new one, reset
 * the version latch) cannot be got half right from outside. A test is such a
 * subclass. Widening the method to public so that a test could reach it would
 * be the test dictating the API.
 */
class SourcedViewer extends Viewer {
  install (source: MediaSource): void { this.setSource(source) }
}

/*
 * This file drives `Viewer` rather than a public viewer class, and that is a
 * deviation from the plan it implements. The plan's Step 3 imports
 * `FramelessImageViewer` from `src/index.ts`, which Task 4 creates -- at Task 3's
 * completion `src/index.ts` exports `VERSION` and nothing else, so the plan's own
 * test file could not compile, let alone pass. The plan's import discipline puts
 * this file in the same row as `gate-*.test.ts` and `render-loop.test.ts`
 * ("internal modules are fair game"), which is why reaching for `Viewer` directly
 * is in bounds.
 *
 * What the deviation costs is stated in the Task 3 report rather than hidden
 * here: `Viewer` is one layer below the public entry point, so these tests prove
 * the teardown *mechanism*, while whether a `FramelessImageViewer` reachably runs
 * it is Task 5's user-story layer.
 */
async function mountImage (src: string): Promise<{
  viewer: SourcedViewer
  container: HTMLElement
}> {
  const container = makeContainer()
  const canvas = document.createElement('canvas')
  const backend = await createBackend(canvas)
  const viewer = new SourcedViewer({ container, canvas, camera: undefined, backend })
  viewer.install(new ImageSource(src, {
    maxTextureDimension: backend.capabilities.maxTextureDimension
  }))
  return { viewer, container }
}

afterEach(() => { vi.restoreAllMocks() })

/*
 * The legacy codebase leaked in five places, and none of them were "somebody
 * forgot to write dispose". Each was a teardown step that existed somewhere in
 * a super chain and was invisible from the class being disposed. These tests
 * assert the observable consequences rather than the call order, so they keep
 * working if the internals are reorganised.
 *
 * "Observable" is doing real work in that sentence. Nothing here reads a
 * listener count: the viewer's canvas is removed from the container on dispose,
 * and with no other reference to it the canvas and everything bound to it are
 * collectable, so DOM reachability IS the leak question. Whether
 * `InputController` unbinds its own listeners is P4's unit test, where it can be
 * asked directly.
 */
describe('dispose', () => {
  it('stops drawing, and leaves no canvas behind', async () => {
    const draws = countDraws()
    const { viewer, container } = await mountImage('/fixtures/panorama.png')
    const canvas = canvasOf(container)
    await nextFrames(2)

    const before = draws()
    viewer.dispose()
    await nextFrames(5)

    expect(before, 'nothing was ever drawn, so this test cannot see a stop').toBeGreaterThan(0)
    expect(draws(), 'a disposed viewer kept drawing').toBe(before)
    expect(container.querySelector('.pano-canvas'), 'the canvas outlived the viewer').toBeNull()
    expect(canvas.isConnected).toBe(false)
  })

  it('is idempotent', async () => {
    const { viewer } = await mountImage('/fixtures/panorama.png')
    viewer.dispose()
    expect(() => viewer.dispose()).not.toThrow()
    expect(viewer.isDisposed).toBe(true)
  })

  it('renders a still image a bounded number of times, not once per frame', async () => {
    /*
     * The legacy FrameDriver redrew unconditionally at up to 60fps, which is a
     * full-screen fragment shader running forever for a picture that is not
     * changing. The bound is deliberately loose -- the claim is "not one per
     * frame", and a tight bound would fail on a resize or a late decode.
     */
    const draws = countDraws()
    const { viewer } = await mountImage('/fixtures/panorama.png')
    await nextFrames(3)

    const start = draws()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const frames = draws() - start
    viewer.dispose()

    expect(frames, 'a still image drew on almost every frame').toBeLessThan(10)
  })

  it('throws from the public methods rather than drawing into nothing', async () => {
    const { viewer } = await mountImage('/fixtures/panorama.png')
    viewer.dispose()
    // The message is asserted, not just the throw: `rotate` on a disposed viewer
    // that fails with "cannot read properties of undefined" is also a throw, and
    // it means the guard is somewhere other than where it was intended.
    expect(() => viewer.rotate(10, 10)).toThrow(/disposed/i)
  })

  it('reports a destroyed device to listeners, then releases it', async () => {
    /*
     * A real loss, not a simulated one: `device.destroy()` resolves `device.lost`
     * with reason 'destroyed' -- P0 measured that it does, which is what makes
     * this testable at all.
     */
    const backends = captureBackends()
    const { viewer } = await mountImage('/fixtures/panorama.png')
    const backend = backends[0]
    expect(backend, 'no WebGPU backend was created to destroy').toBeDefined()
    if (backend === undefined) throw new Error('no WebGPU backend was created to destroy')

    const seen: Array<{ reason: string, disposedWhenNotified: boolean }> = []
    viewer.on('device-lost', (lost) => {
      // Read the viewer from inside the handler: reporting before tearing down is
      // what makes that possible at all, and the dispose here is the re-entrancy
      // case -- a listener that cleans up on its own must not run the teardown a
      // second time, nor re-enter it halfway through.
      seen.push({ reason: lost.reason, disposedWhenNotified: viewer.isDisposed })
      viewer.dispose()
    })
    backend.device.destroy()

    // `device.lost` resolves on a later task, so the report cannot be awaited.
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({ reason: 'destroyed', disposedWhenNotified: false })
    expect(viewer.isDisposed).toBe(true)
  })
})
