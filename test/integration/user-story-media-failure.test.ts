import { afterEach, describe, expect, it, vi } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { canvasOf } from './support/dom'
import { countNonBlack, nextFrames, readCanvas } from './support/canvas'
import { captureRenderInputs } from './support/spies'
import { imageViewer, videoViewer } from './support/viewer'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'

afterEach(() => { vi.restoreAllMocks() })

/*
 * Blob URLs stand in for the two fixtures this story used to need.
 *
 * What the story is about is a response that arrives and cannot be decoded,
 * which is a different path from one that never arrives -- and a blob URL
 * produces exactly that with no fixture file and no request interception, which
 * browser mode does not have. The type is a claim the browser then fails to
 * honour, which is the case a misconfigured CDN produces.
 *
 * Revoked on the way out: a blob URL pins its blob for the document's lifetime,
 * and a test file that leaks one per case is a leak the next reader has to
 * reason about.
 */
function undecodable (mime: string): string {
  return URL.createObjectURL(new Blob(['this is not what the type claims'], { type: mime }))
}

describe('US4: media fails to load', () => {
  /*
   * The three tests that wait past the error event -- for pixels, or for the
   * loop to carry a moved pose -- probe first and skip on a device that cannot
   * keep a presented-canvas WebGPU device alive (support/presented-canvas.ts):
   * a mounted viewer's load rhythm draws to the presented canvas even when the
   * source never lands, so on such a device the viewer can self-dispose
   * mid-wait. The two error-event-only tests resolve in milliseconds, an order
   * under the measured ~60ms device-death floor, and the empty-src and
   * frameSize tests assert before anything can draw.
   */
  it('a missing image emits media-error and does not throw', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    /*
     * Broken at CONSTRUCTION, not by a later assignment: the factory cannot
     * build a viewer without a source (the frozen surface requires `src`), and a
     * viewer that had a good frame and then fails a swap keeps drawing that
     * frame -- which is the right behaviour, and a different story from the one
     * this test tells. Constructed on the 404, the canvas has never held a
     * frame, so "empty" below means the failure produced nothing, not that
     * something else's pixels survived.
     */
    const { viewer, container } = await imageViewer({ src: '/fixtures/does-not-exist.png' })
    const errors: unknown[] = []
    viewer.on('media-error', (e) => errors.push(e))
    // Absent from `public/fixtures/`. Vite's SPA fallback only rewrites requests
    // that accept HTML, and an <img> does not, so this is a real 404 rather than
    // a 200 carrying index.html.

    await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 5000 })
    await nextFrames(2)
    const image = await readCanvas(canvasOf(container))
    const aliveBeforeDispose = !viewer.isDisposed
    viewer.dispose()

    // A failed source leaves an empty canvas -- not a stale frame, not an
    // exception. "Empty" means the render pass ran and drew nothing over its
    // opaque black clear (P3's `clearValue: { r: 0, g: 0, b: 0, a: 1 }`), which
    // `countNonBlack` reports as 0 because it looks at RGB and ignores alpha.
    expect(countNonBlack(image)).toBe(0)
    // The viewer is still usable, so the teardown is the test's job and not the
    // error's. Asserted because a viewer that disposed itself on a failed source
    // would take a whole application down with one bad URL.
    expect(aliveBeforeDispose).toBe(true)
    expect(viewer.isDisposed).toBe(true)
  })

  it('an undecodable image emits media-error', async () => {
    const url = undecodable('image/png')
    const { viewer } = await imageViewer()
    const errors: unknown[] = []
    viewer.on('media-error', (e) => errors.push(e))
    viewer.src = url
    await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 5000 })
    viewer.dispose()
    URL.revokeObjectURL(url)
  })

  it('a video with a bad codec emits media-error', async () => {
    const url = undecodable('video/mp4')
    const { viewer } = await videoViewer({ autoplay: true })
    const errors: unknown[] = []
    viewer.on('media-error', (e) => errors.push(e))
    viewer.src = url
    await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 5000 })
    viewer.dispose()
    URL.revokeObjectURL(url)
  })

  it('the viewer keeps working after a source error', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // An error is a property of the source, not of the viewer. The camera must
    // still move and the loop must still draw, or one bad URL leaves the
    // application holding a dead object it cannot even navigate.
    //
    // Asserted at the backend's boundary rather than by counting draws: the
    // claim is not merely that frames happened but that a frame carried the
    // moved pose, which is the thing a viewer paralysed by an error cannot
    // produce no matter how many empty frames it draws.
    const inputs = captureRenderInputs()
    const { viewer } = await imageViewer()
    const errors: unknown[] = []
    viewer.on('media-error', (e) => errors.push(e))
    viewer.src = '/fixtures/does-not-exist.png'
    await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 5000 })
    await nextFrames(2)

    viewer.rotate(10, 10)
    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.state).toEqual({ povLatitude: 10, povLongitude: 10 })
    })
    const pose = viewer.cameraOptions.pose
    viewer.dispose()

    expect(pose).toEqual({ povLatitude: 10, povLongitude: 10 })
  })

  it('replacing a broken source recovers', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const { viewer, container } = await imageViewer()
    const errors: string[] = []
    const loads: string[] = []
    viewer.on('media-error', () => errors.push('error'))
    viewer.on('media-load', () => loads.push('load'))
    viewer.src = '/fixtures/does-not-exist.png'
    await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 5000 })

    viewer.src = '/fixtures/panorama.png'
    await vi.waitFor(() => expect(loads).toContain('load'), { timeout: 5000 })
    await nextFrames(2)
    const image = await readCanvas(canvasOf(container))
    viewer.dispose()

    expect(countNonBlack(image)).toBeGreaterThan(0.2 * image.width * image.height)
  })

  it('an empty src throws at construction', async () => {
    // The type cannot express "a non-empty string", and an empty src makes the
    // browser resolve the URL to the current page, load the HTML document as an
    // image, and fail with a message that says nothing about the real cause.
    const { viewer } = await imageViewer()
    expect(() => { viewer.src = '' }).toThrow(/src/)
    viewer.dispose()
  })

  it('the removed frameSize option is refused loudly', async () => {
    // Built in a variable rather than written inline, and that is not style: an
    // object literal with an unknown key is an excess-property error, i.e.
    // TypeScript already refuses it. This test is about the second line of
    // defence -- the runtime check, for the JavaScript caller whose config object
    // still carries this key. A variable is how such an object is spelled in a
    // typed test without a cast.
    const legacyOptions = { container: document.createElement('div'), src: '/fixtures/panorama.png', frameSize: [2048, 1024] }
    await expect(FramelessImageViewer.create(legacyOptions as any)).rejects.toThrow(/frameSize/)
  })
})
