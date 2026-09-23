import { afterEach, describe, expect, it, vi } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { canvasOf } from './support/dom'
import { countNonBlack, maxChannelDiff, nextFrames, readCanvas } from './support/canvas'
import { drag } from './support/gestures'
import { captureRenderInputs, captureTeardown } from './support/spies'
import { imageViewer } from './support/viewer'

/**
 * How much of the readback is lit, as a fraction.
 *
 * The denominator is the readback's own size, not the canvas's: `readCanvas`
 * downscales to 64x32, and a fraction computed against the canvas would be
 * wrong by whatever the device scale factor is.
 */
function litFraction (image: ImageData): number {
  return countNonBlack(image) / (image.width * image.height)
}

/*
 * US1: a photo viewer that renders, responds to a drag, honours PTZ = false,
 * follows its container, and is sharp on a retina display.
 */
describe('US1: view a 360 photo and look around', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('renders the image and reports load', async () => {
    const { viewer, container } = await imageViewer()
    const loaded: string[] = []
    // Before `src`, always. See rule 1.
    viewer.on('media-load', () => loaded.push('media-load'))
    viewer.src = '/fixtures/panorama.png'
    await vi.waitFor(() => expect(loaded).toContain('media-load'), { timeout: 5000 })
    await nextFrames(2)

    const image = await readCanvas(canvasOf(container))
    viewer.dispose()

    // Not a black rectangle, so the upload and the projection between them put
    // something on the canvas. The bound is deliberately loose: every quadrant
    // of the fixture is bright in at least one channel, so a frame that arrived
    // reads near 1.0 while one that never did reads 0. 0.2 sits far from both,
    // which keeps this a test of "did anything arrive" rather than an
    // accidental precision test of the projection.
    expect(litFraction(image)).toBeGreaterThan(0.2)
  })

  it('dragging rotates the camera and changes the image', async () => {
    const { viewer, container } = await imageViewer()
    const canvas = canvasOf(container)
    const rotations: string[] = []
    viewer.on('rotate', () => rotations.push('rotate'))
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    const before = await readCanvas(canvas)

    // Right by 200px across a 400px-wide container. Element-relative, one move
    // between press and release -- see support/gestures.ts.
    await drag(canvas, { from: { x: 100, y: 150 }, to: { x: 300, y: 150 } })
    await nextFrames(2)

    const after = await readCanvas(canvas)
    const pose = viewer.cameraOptions.pose
    viewer.dispose()

    expect(rotations.length).toBeGreaterThan(0)
    // A horizontal drag moves the longitude, and by more than rounding would
    // explain: the viewer converts pixels to degrees against the frame size, so
    // 200 of 400 pixels is a substantial turn.
    expect(pose?.povLongitude).not.toBe(0)
    expect(maxChannelDiff(before.data, after.data)).toBeGreaterThan(2)
  })

  it.each([
    { lat: 30, lng: 0, half: 'latitude' },
    { lat: 0, lng: 90, half: 'longitude' }
  ])('rotate() moves the picture on a non-linear camera: the $half half', async ({ lat, lng }) => {
    /*
     * The drag test above is the linear camera, where pose lives in the
     * clip matrix and always reached the canvas. On the non-linear kinds
     * the matrix is constant by design and the pose travels through the
     * uniforms -- the path the P2/P3 setCamera early-out froze. The two
     * halves are asserted separately because they fail separately: the
     * longitude half was a working feature in v0.2.2 (a regression), the
     * latitude half is new intended behaviour -- v0.2.2's shader never
     * read u_CamPOVLatitude, v1's WGSL does -- so the expected value here
     * is v1's own semantics (the pixels move), never the v0.2.2 capture.
     * Turn sizes are large on purpose: the sample window has to shift by
     * more than rounding for the diff to clear the bound. If a half ever
     * reads <= 2 WITH the redraw confirmed below, report it -- do not
     * loosen the bound or shrink the turn silently.
     */
    const inputs = captureRenderInputs()
    const { viewer, container } = await imageViewer({ camera: 'cylindrical' })
    const canvas = canvasOf(container)
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    const before = await readCanvas(canvas)
    const drawsBefore = inputs.sourceCalls()
    viewer.rotate(lat, lng)
    await nextFrames(2)
    const after = await readCanvas(canvas)
    viewer.dispose()

    expect(inputs.sourceCalls() - drawsBefore, `rotate(${lat}, ${lng}) did not redraw`).toBeGreaterThan(0)
    expect(maxChannelDiff(before.data, after.data), `rotate(${lat}, ${lng}) did not move the picture`).toBeGreaterThan(2)
  })

  it('a press and release without movement reports nothing', async () => {
    /*
     * The pan wiring has an early return for a zero displacement, and this is
     * the only gesture that can reach it: a drag whose release is at its press
     * produces exactly the {0, 0} pan the guard exists for. Without the guard a
     * tap would report a `rotate` event with two zeros in it -- noise an
     * application logging camera moves would show as a phantom turn.
     */
    const { viewer, container } = await imageViewer()
    const canvas = canvasOf(container)
    const rotations: string[] = []
    viewer.on('rotate', () => rotations.push('rotate'))
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    await drag(canvas, { from: { x: 200, y: 150 }, to: { x: 200, y: 150 } })
    await nextFrames(2)

    const pose = viewer.cameraOptions.pose
    viewer.dispose()

    expect(rotations).toHaveLength(0)
    expect(pose).toEqual({ povLatitude: 0, povLongitude: 0 })
  })

  it('PTZ = false leaves the image static', async () => {
    const { viewer, container } = await imageViewer()
    const canvas = canvasOf(container)
    viewer.PTZ = false
    const rotations: string[] = []
    viewer.on('rotate', () => rotations.push('rotate'))
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    const before = await readCanvas(canvas)
    await drag(canvas, { from: { x: 100, y: 50 }, to: { x: 300, y: 250 } })
    await nextFrames(3)
    const after = await readCanvas(canvas)
    viewer.dispose()

    // Both halves matter. No event, because the controller refuses the gesture;
    // and no pixel change, because the frame is what a user sees.
    expect(rotations).toHaveLength(0)
    expect(maxChannelDiff(before.data, after.data)).toBeLessThanOrEqual(2)
  })

  it('the image fills a container that changes size', async () => {
    /*
     * The legacy code listened on window resize and additionally called
     * `window.removeEventLstener` (a typo), so the listener never came off. A
     * ResizeObserver also catches container-only changes, which is the common
     * case for a viewer inside a layout -- and the one this test makes, since
     * nothing here resizes the window.
     *
     * Two resizes, because a resize has two separable obligations and one
     * change cannot exercise both. The FIRST changes the surface's aspect
     * (4:3 to 1:1): the backing store follows the new CSS size (times the
     * device pixel ratio -- this project runs at density 2, and asserting the
     * raw 300 would be wrong by 2x) and the linear projection's aspect is
     * rewritten, which is the one projection field `#resize` owns. The SECOND
     * keeps the aspect at 1:1 -- and that is the one whose repaint can only
     * come from `invalidate()`: `setAspect` early-outs on an unchanged aspect,
     * so nothing else marks the camera dirty. The repaint is asserted as a
     * draw, not as pixels, for the measured reason inside the test.
     */
    const { viewer, container } = await imageViewer()
    const canvas = canvasOf(container)
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)
    expect(canvas.width).toBe(400 * devicePixelRatio)

    container.style.width = '300px'
    // Two frames: the observer fires, the loop marks itself dirty, the next
    // frame draws. One frame would be the frame already in flight when the
    // style changed.
    await nextFrames(2)
    expect(canvas.width).toBe(300 * devicePixelRatio)

    const projection = viewer.cameraOptions.projection
    if (projection.kind !== 'linear') {
      viewer.dispose()
      throw new Error(`expected linear, got ${projection.kind}`)
    }
    expect(projection.aspect).toBe(1) // 300 CSS px over 300 CSS px

    /*
     * The repaint, counted rather than seen. Measured on this platform: a
     * WebGPU canvas KEEPS its last presented frame across a dimension change
     * that no draw follows -- `toDataURL` still reads the old frame, lit -- so
     * no pixel assertion can tell a repainted resize from an undrawn one. What
     * does tell them apart is whether a draw ran, and this is the one resize
     * where `invalidate()` is the only thing that can make one happen (the
     * aspect is unchanged, so `setAspect` early-outs; the source is loaded and
     * idle). Counted at the `setSource` each draw makes, per this suite's rule
     * that "did it draw" questions go through `captureRenderInputs`, never
     * `countDraws` -- and snapped AFTER the first resize's draw has settled, so
     * the delta is this resize's repaint alone.
     */
    const inputs = captureRenderInputs()
    const before = inputs.sourceCalls()
    container.style.width = '200px'
    container.style.height = '200px'
    await nextFrames(3)
    expect(canvas.width).toBe(200 * devicePixelRatio)
    const draws = inputs.sourceCalls() - before

    // Read BEFORE dispose: dispose destroys the device, and a canvas whose
    // context is gone reads back as blank -- which would make this assertion
    // fail for a reason that has nothing to do with repainting.
    const image = await readCanvas(canvas)
    viewer.dispose()

    expect(draws, 'the resize did not repaint').toBeGreaterThan(0)
    expect(litFraction(image), 'the resized canvas kept no frame').toBeGreaterThan(0.2)
  })

  it('renders sharply on a high-DPI display', async () => {
    // The legacy Renderer.adjustSize ignored devicePixelRatio entirely, so every
    // retina display got a blurry upscale.
    //
    // The density comes from the project's `contextOptions.deviceScaleFactor`,
    // not from this test. The first assertion is what pins that: an assertion of
    // `canvas.width === rect.width * devicePixelRatio` passes at DPR 1 as well,
    // so without it this test would keep passing on a project that had quietly
    // stopped running at 2x -- green, and testing nothing.
    const { viewer, container } = await imageViewer()
    const canvas = canvasOf(container)
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(2)

    const rect = container.getBoundingClientRect()
    const result = {
      dpr: devicePixelRatio,
      backing: { w: canvas.width, h: canvas.height },
      css: { w: rect.width, h: rect.height }
    }
    viewer.dispose()

    expect(result.dpr).toBe(2)
    expect(result.backing.w).toBe(result.css.w * 2)
    expect(result.backing.h).toBe(result.css.h * 2)
  })

  it('an application can ask about the backend before it creates anything', async () => {
    /*
     * The other half of US5. There, WebGPU is absent and `probe()` has to say
     * so; here the project's guard has proven a live adapter, so it has to say
     * 'webgpu'. A probe that misreported either quadrant is the legacy silent
     * downgrade back again -- "ask first, then decide" was the whole reason
     * probe exists, and an answer that cannot be trusted in the good case is
     * worse than none.
     */
    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('webgpu')
  })

  it('survives a whole session: mount, turn, swap the photo, stay put, dispose', async () => {
    /*
     * The full journey, not its pieces. The defect this is shaped against was
     * measured, not imagined: a `setSource` that reset the camera's pose to the
     * origin survived a whole green suite once, because the one swapping test
     * there never turned before it swapped -- its pose was the origin already,
     * so "the swap reset the pose" and "nothing happened" read identically
     * (anti-pattern F, acceptance-point fragmentation). Every step below is
     * therefore taken IN ORDER and asserted before the next one begins.
     */
    const inputs = captureRenderInputs()
    const loads: string[] = []
    const { viewer, container } = await imageViewer()
    viewer.on('media-load', () => loads.push('load'))

    // The factory already constructed this viewer on the plain fixture URL, so
    // its load may or may not have landed in `loads` before the listener went
    // on -- re-assigning the same URL is still a real swap through the public
    // setter, and the count is a baseline, not an absolute (see support/viewer).
    viewer.src = '/fixtures/panorama.png'
    await vi.waitFor(() => expect(loads.length).toBeGreaterThanOrEqual(1))
    await nextFrames(2)

    // Turned BEFORE the swap, and proved to have reached the backend, so the
    // assertions after the swap cannot be satisfied by a camera that never
    // moved in the first place.
    viewer.rotate(15, 45)
    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.state).toEqual({ povLatitude: 15, povLongitude: 45 })
    })

    viewer.src = '/fixtures/panorama.png?journey'
    await vi.waitFor(() => expect(loads.length).toBeGreaterThanOrEqual(2))
    await nextFrames(2)

    // The swap is not a reconfiguration: the camera stays where the user put
    // it -- on the viewer's own state AND on the frame the backend was handed
    // -- while the source itself moves on.
    expect(viewer.src).toBe('/fixtures/panorama.png?journey')
    expect(viewer.cameraOptions.pose).toEqual({ povLatitude: 15, povLongitude: 45 })
    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.state).toEqual({ povLatitude: 15, povLongitude: 45 })
    })
    const image = await readCanvas(canvasOf(container))
    expect(litFraction(image), 'the swapped-in photo never reached the canvas').toBeGreaterThan(0.2)

    // The end of the journey is a teardown, and it is asserted, not assumed:
    // the resize observer is disconnected and the listeners are dropped, or a
    // session that ends still holds the page's memory. Three emitters are torn
    // down by this one dispose -- the source's, the input controller's and the
    // viewer's own -- so three calls; the count is the observable, the names
    // are why it is three and not one.
    const teardown = captureTeardown()
    viewer.dispose()
    expect(teardown.disconnects(), 'the resize observer outlived the viewer').toBe(1)
    expect(teardown.emitterTeardowns(), 'a listener set outlived the viewer').toBe(3)
    expect(viewer.isDisposed).toBe(true)
    expect(container.querySelector('.pano-canvas')).toBeNull()
  })
})
