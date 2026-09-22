import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'
import { Viewer } from '../../src/viewer/viewer'
import { ImageSource } from '../../src/media/image-source'
import type { MediaSource } from '../../src/media/source'
import { WebGPUBackend } from '../../src/renderer/webgpu/backend'
import { RenderLoop } from '../../src/viewer/render-loop'
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
 * This file drives `Viewer` rather than a public viewer class. That began as a
 * deviation forced by timing -- when this file was written, `src/index.ts`
 * exported `VERSION` and nothing else -- but Task 4 has since landed the frozen
 * public surface (`FramelessImageViewer`, `FramelessVideoViewer` and their
 * option types), so the original reason has expired and the file keeps its
 * internal hold deliberately: it tests the teardown *mechanism*, one layer
 * below the public entry point, and the plan's import discipline puts it in
 * the same row as `gate-*.test.ts` and `render-loop.test.ts` ("internal
 * modules are fair game"). Whether a public class reachably runs this same
 * teardown is netted from the public surface by Task 5's user-story layer
 * (`user-story-photo.test.ts` ends its journey with the dispose assertions).
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

  it('stops the loop, rather than leaving it running with nothing to do', async () => {
    /*
     * The test above cannot see this, and the reason is worth stating rather
     * than leaving as a gap. After `dispose` the viewer holds no source and a
     * clean camera, so `shouldDraw` returns false whatever the loop is doing --
     * a loop that is dead and a loop that is alive but idle produce exactly the
     * same frame count. The observable has to be the scheduling itself.
     */
    const { viewer } = await mountImage('/fixtures/panorama.png')
    await nextFrames(2)

    const loopDisposed = vi.spyOn(RenderLoop.prototype, 'dispose')
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')

    viewer.dispose()

    expect(loopDisposed, 'the viewer never disposed its render loop').toHaveBeenCalledTimes(1)
    /*
     * Two facts, not one. The loop was reached, AND the frame it already had
     * queued was withdrawn: a teardown that set a flag without cancelling
     * would leave one more callback to run against a backend that is being
     * dismantled on the next line -- which is the in-flight frame the ordering
     * of `dispose` exists to prevent.
     *
     * The COUNT, not just the call. At this point the loop holds exactly one
     * handle -- `stop()` clears it after cancelling, and `#scheduleNext` sets it
     * again only once a frame has run -- so the withdrawal is one call, and a
     * teardown that cancelled the same handle repeatedly would be a second
     * defect that `toHaveBeenCalled()` cannot see. Measured, not assumed: with
     * this assertion in place the double-cancel mutant reddens this test and the
     * weak form does not.
     */
    expect(cancel, 'the loop was disposed but its pending frame was not cancelled').toHaveBeenCalledTimes(1)
  })

  it('is idempotent', async () => {
    const { viewer } = await mountImage('/fixtures/panorama.png')
    const disposed = vi.spyOn(WebGPUBackend.prototype, 'dispose')

    viewer.dispose()
    expect(disposed, 'the first dispose() never reached the backend').toHaveBeenCalledTimes(1)

    viewer.dispose()
    /*
     * The observable that makes this more than "did not throw". `expect(() =>
     * viewer.dispose()).not.toThrow()` is satisfied by replacing the whole
     * method with an empty function -- so it certifies that nothing exploded,
     * not that the second call was a no-op. A second teardown reaches the
     * backend a second time, and that is what this counts.
     */
    expect(disposed, 'the second dispose() tore down a second time').toHaveBeenCalledTimes(1)
    expect(viewer.isDisposed).toBe(true)
  })

  it('does not re-enter its own teardown', async () => {
    /*
     * What the `#disposing` guard is actually for.
     *
     * NOT the device-lost listener, which is the shape the comment further down
     * used to claim. By the time that listener runs, the first teardown has
     * already ended in `super.dispose()`, which installs an OWN no-op `dispose`
     * property on the instance -- and property lookup consults own properties
     * before the prototype chain, so the listener's call never reaches the
     * override at all. The guard is unreachable from there; the assertion that
     * the listener's `dispose()` is harmless is a real assertion, but it is not
     * evidence about this guard.
     *
     * A call made from INSIDE the teardown is a different matter. This spy sits
     * on step 5 (`#backend.dispose()`) and step 6 is `super.dispose()`, so at
     * that moment no shadow exists yet and the call genuinely arrives at the
     * override -- which is the case the guard has to hold.
     */
    const { viewer } = await mountImage('/fixtures/panorama.png')
    await nextFrames(2)

    const original = WebGPUBackend.prototype.dispose
    const teardowns: number[] = []
    vi.spyOn(WebGPUBackend.prototype, 'dispose').mockImplementation(function (this: WebGPUBackend) {
      teardowns.push(teardowns.length + 1)
      // Re-enter once and only once. An unguarded second teardown would
      // otherwise recurse through this spy for ever, and the failure would
      // arrive as a hung test rather than as a red assertion.
      if (teardowns.length === 1) viewer.dispose()
      original.call(this)
    })

    expect(() => viewer.dispose()).not.toThrow()
    expect(teardowns, 'the teardown ran twice').toHaveLength(1)
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
      // Read the viewer from inside the handler. That is the assertion this
      // test carries: reporting BEFORE tearing down is what makes a listener
      // able to read the viewer at all, and `disposedWhenNotified` is false
      // exactly when the order held.
      //
      // The `dispose()` below is a second, weaker claim, and it is worth being
      // precise about what it does NOT cover. It shows that a listener which
      // cleans up on its own is harmless. It is NOT evidence about
      // `#disposing`: by the time this runs, the first teardown has already
      // reached `super.dispose()`, which installs an own no-op `dispose` on the
      // instance, so this call resolves to that shadow and never reaches the
      // override. The guard is exercised by "does not re-enter its own
      // teardown" above, which re-enters from inside the teardown instead.
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
