import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'
import { Viewer } from '../../src/viewer/viewer'
import { ImageSource } from '../../src/media/image-source'
import type { MediaSource } from '../../src/media/source'
import { WebGPUBackend } from '../../src/renderer/webgpu/backend'
import { makeContainer } from './support/dom'
import { countDraws, captureRenderInputs } from './support/spies'
import { nextFrames } from './support/canvas'

/*
 * What the viewer hands the backend, frame by frame.
 *
 * This file exists because of a gap the quality review measured rather than
 * suspected: every rendering assertion Task 3 had was built on `countDraws()`,
 * which counts calls to `WebGPUBackend.render` -- so the whole suite was
 * asking "did a frame happen" and never "what was in it". Two mutants that
 * destroy the picture while leaving the frame count untouched (a viewer that
 * never hands over its source, and one that pins the camera to the origin)
 * were run against the full 32-file suite and it stayed green.
 *
 * "Execution reached the line" and "the line was asserted on" are different
 * facts, and coverage -- which the unit gate measures -- can only see the
 * first. These tests assert the arguments at the boundary where the viewer's
 * state becomes the backend's input, which is the last place a wrong picture
 * is still cheap to catch.
 *
 * The `waitFor` predicates below are deliberately weak (`toBeTruthy`,
 * `toContain`) and lean on the strong assertion that follows them in the same
 * test. They are a pair -- a weak predicate copied without its follow-up is
 * satisfied by anything, which is the vacuous-assertion shape this file exists
 * to close.
 */

/** `setSource` is protected: a subclass is the only thing allowed to swap a source. */
class SourcedViewer extends Viewer {
  install (source: MediaSource | undefined): void { this.setSource(source) }
}

async function mount (): Promise<{ viewer: SourcedViewer, backend: WebGPUBackend }> {
  const container = makeContainer()
  const canvas = document.createElement('canvas')
  const backend = await createBackend(canvas)
  const viewer = new SourcedViewer({ container, canvas, camera: undefined, backend })
  // The factory is typed as `Backend`; these tests spy on the WebGPU prototype,
  // so the concrete class is what they need and WebGPU is what the integration
  // project's guard has already proven is present.
  if (!(backend instanceof WebGPUBackend)) throw new Error('the integration project must select WebGPU')
  return { viewer, backend }
}

function image (src: string, backend: WebGPUBackend): ImageSource {
  return new ImageSource(src, { maxTextureDimension: backend.capabilities.maxTextureDimension })
}

afterEach(() => { vi.restoreAllMocks() })

describe('the frame the viewer hands the backend', () => {
  it('is the source it holds, not null', async () => {
    /* A viewer that never passes its source on draws a correct number of
     * frames of nothing at all -- and "a frame happened" is exactly what the
     * rest of the suite asserts, so nothing else here can see it. */
    const inputs = captureRenderInputs()
    const { viewer, backend } = await mount()
    viewer.install(image('/fixtures/panorama.png', backend))

    // Waiting for a frame-carrying argument rather than for a frame: the
    // frames start before the image loads, and each of those legitimately
    // carries `null`. Asserting on a frame count here would be satisfied by
    // those.
    //
    // `toBeTruthy`, not `not.toBeNull`. Measured: `expect(undefined).not
    // .toBeNull()` PASSES, so a `waitFor` written that way returns on its
    // first attempt and the whole wait is a no-op -- the same vacuous-assertion
    // shape this file exists to close, one level up in the test's own plumbing.
    await vi.waitFor(() => {
      expect(inputs.lastSource(), 'no source was ever handed to the backend').toBeTruthy()
    })

    const source = inputs.lastSource()
    if (!source) throw new Error('no source was handed to the backend')
    expect(source.kind).toBe('image')
    // The version is what the backend uses as its only pixel identity; a
    // frame handed over without one is not an upload description.
    expect(source.version).toBeGreaterThanOrEqual(1)
    expect(source.state.width).toBeGreaterThan(0)
    expect(source.state.height).toBeGreaterThan(0)
    expect(source.element).toBeInstanceOf(HTMLImageElement)
  })

  it('carries the pose the viewer holds, not a fixed one', async () => {
    /* The pose is asserted AWAY from the origin on purpose. The default pose
     * IS the origin, so a mutant that pins the state to `{0, 0}` is invisible
     * against a viewer that never moved -- it would agree with the expectation
     * by coincidence rather than by forwarding anything. */
    const inputs = captureRenderInputs()
    const { viewer } = await mount()
    await nextFrames(2)

    viewer.rotate(20, 30)

    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.state).toEqual({ povLatitude: 20, povLongitude: 30 })
    })
    expect(viewer.cameraOptions.pose).toEqual({ povLatitude: 20, povLongitude: 30 })
  })

  it('carries the projection the viewer holds, not a fixed one', async () => {
    const inputs = captureRenderInputs()
    const { viewer } = await mount()
    await nextFrames(2)

    viewer.cameraOptions = {
      pose: { povLatitude: 0, povLongitude: 0 },
      projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    }

    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.projection).toEqual(viewer.cameraOptions.projection)
    })
    // The kind as well as the object: a mutant that forwards a *stale copy* of
    // the right shape would satisfy a structural comparison written against
    // whatever the viewer happens to hold at assert time.
    expect(inputs.lastCamera()?.projection.kind).toBe('cylindrical')
  })

  it('ticks the source after the frame that drew it, not before', async () => {
    /*
     * `markFramePresented` is where a video advances its version, and the
     * comment on the call site gives the reason it comes last: the version has
     * to describe the frame just drawn while the backend is still reading it. A
     * call moved above `render` would bump the version of a frame nobody drew.
     *
     * It is pinned through the ORDER of the two calls rather than by counting
     * them, because an image source's implementation is a deliberate no-op --
     * its pixels change once, on load -- so for the source this test can
     * actually mount, the only observable thing about the call is when it
     * happens.
     */
    const order: string[] = []
    const originalRender = WebGPUBackend.prototype.render
    vi.spyOn(WebGPUBackend.prototype, 'render').mockImplementation(function (this: WebGPUBackend) {
      order.push('render')
      originalRender.call(this)
    })
    vi.spyOn(ImageSource.prototype, 'markFramePresented').mockImplementation(function () {
      order.push('mark')
    })

    const { viewer, backend } = await mount()
    viewer.install(image('/fixtures/panorama.png', backend))
    await vi.waitFor(() => { expect(order).toContain('mark') })

    const firstRender = order.indexOf('render')
    const firstMark = order.indexOf('mark')
    expect(firstRender, 'no frame was drawn, so the order proves nothing').toBeGreaterThanOrEqual(0)
    expect(firstMark, 'the source was never told a frame had been presented').toBeGreaterThan(firstRender)
  })
})

describe('a source that cannot produce a frame', () => {
  it('is reported to the backend as null rather than left in place', async () => {
    /*
     * `ImageSource.frame` throws until the image loads, and the catch is what
     * turns that into "draw nothing". Without the `setSource(null)` in it the
     * viewer would never speak to the backend about the source at all -- and
     * the backend's own last source, from a previous viewer or a previous
     * frame, would keep being sampled.
     */
    const inputs = captureRenderInputs()
    const { viewer, backend } = await mount()
    viewer.install(image('/fixtures/no-such-image.png', backend))
    await nextFrames(5)

    expect(inputs.sourceCalls(), 'the viewer never told the backend about the source').toBeGreaterThan(0)
    expect(inputs.lastSource()).toBeNull()
  })

  it('is reported as null when the viewer holds no source at all', async () => {
    /* The other half of the same boundary, and a separate line of code: a
     * viewer constructed with no source still has to clear the backend, or a
     * backend reused across two viewers keeps drawing the first one's image. */
    const inputs = captureRenderInputs()
    await mount()
    await nextFrames(5)

    expect(inputs.sourceCalls()).toBeGreaterThan(0)
    expect(inputs.lastSource()).toBeNull()
  })

  it('does not cost a redraw every frame while it stays unready', async () => {
    /*
     * A source whose metadata has not arrived is not a change -- there is
     * simply nothing to draw yet -- and a `#sourceChanged` that said otherwise
     * would put the legacy failure back: a full-screen fragment shader at
     * 60fps for a picture that is not there. Counting rather than sampling,
     * for the same reason the still-image bound in `dispose-order` counts.
     */
    const draws = countDraws()
    const { viewer, backend } = await mount()
    viewer.install(image('/fixtures/no-such-image.png', backend))
    await nextFrames(3)

    const start = draws()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(draws() - start, 'an unready source drew on almost every frame').toBeLessThan(10)

    // ...and the loop is idle rather than dead. Without this, a loop that gave
    // up after the first frame satisfies the bound above exactly.
    viewer.rotate(10, 10)
    await vi.waitFor(() => { expect(draws()).toBeGreaterThan(start) })
  })
})
