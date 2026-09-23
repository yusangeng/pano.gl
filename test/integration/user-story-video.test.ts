import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasOf } from './support/dom'
import { maxChannelDiff, nextFrames, readCanvas } from './support/canvas'
import { wheel } from './support/gestures'
import { captureRenderInputs } from './support/spies'
import { imageViewer, videoViewer } from './support/viewer'

afterEach(() => { vi.restoreAllMocks() })

/*
 * US2: a video viewer that plays, stops when paused, cleans up a swapped
 * source, mutes autoplay by default, and zooms -- or refuses to.
 *
 * Two facts about v1 shape this file, both measured rather than assumed:
 *
 * - The `<video>` element is NEVER inserted into the container. It is exposed
 *   through `viewer.element`, so that is how these tests reach it -- the plan's
 *   `videoOf(container)` helper assumed a DOM-attached element and finds nothing.
 * - Construction-time `autoplay` does not start playback in this environment:
 *   the element is detached, and the browser runs no autoplay algorithm for a
 *   detached element (media-load fires, media-play never does; the explicit
 *   `play()` method works). Playback here is therefore started through the
 *   public `play()`, and the inert autoplay is recorded as a known risk in the
 *   Task 5 completion report.
 */
describe('US2: play a 360 video and zoom', () => {
  it('plays and advances frames', async () => {
    const { viewer, container } = await videoViewer({ loop: true })
    const events: string[] = []
    // Both listeners before playback starts, so neither event can be missed --
    // `media-play` can arrive no later than the frames it announces, and a
    // listener attached after the first would wait forever.
    viewer.on('media-load', () => events.push('load'))
    viewer.on('media-play', () => events.push('play'))
    await vi.waitFor(() => expect(events).toContain('load'), { timeout: 5000 })
    await viewer.play()

    await vi.waitFor(() => expect(events).toContain('play'), { timeout: 5000 })
    await nextFrames(3)

    const a = await readCanvas(canvasOf(container))
    /*
     * The media clock AND the pixels, both inside one bounded wait. They are
     * two different things under load, and that is the whole reason this is
     * not a single read: the flake this replaced was a run where the clock
     * had already moved and the canvas still showed the previous decoded
     * frame -- presentation lagged the clock -- so gating on `currentTime`
     * alone asserted a change the screen had not made. A fixed wall-clock
     * window is fragile from both directions for the same reason (the pixels
     * may not have caught up when it expires). Waiting for the picture itself
     * to change keeps the claim where it belongs -- on what reached the
     * screen -- while tolerating load-induced presentation lag. Bounded, so a
     * loop that never redraws a playing video still fails here.
     */
    const t0 = viewer.element.currentTime
    await vi.waitFor(async () => {
      expect(viewer.element.currentTime - t0).toBeGreaterThan(0.15)
      const b = await readCanvas(canvasOf(container))
      expect(maxChannelDiff(a.data, b.data)).toBeGreaterThan(2)
    }, { timeout: 5000 })
    viewer.dispose()
  })

  it('a paused video stops drawing', async () => {
    // The loop draws when the source's version changes, and a video advances its
    // version only while it is playing. Without that guard, this is the test
    // that catches "a paused video still burns a full-screen shader at 60Hz".
    //
    // Counted at the `setSource` the viewer makes per drawn frame, not with
    // `countDraws`: the frame count alone cannot say what the frames carried,
    // and this suite's one measured CRITICAL gap was exactly a draw-count
    // assertion passing over frames that drew nothing. Same predicate either
    // way -- `shouldDraw` gates the whole `draw`, so setSource calls are draws.
    const inputs = captureRenderInputs()
    const { viewer } = await videoViewer({ loop: true })
    const paused: string[] = []
    viewer.on('media-pause', () => paused.push('pause'))
    await vi.waitFor(() => expect(viewer.element.readyState).toBeGreaterThanOrEqual(1), { timeout: 5000 })
    await viewer.play()
    await vi.waitFor(() => expect(viewer.element.paused).toBe(false), { timeout: 5000 })
    viewer.pause()
    await vi.waitFor(() => expect(paused).toContain('pause'))
    await nextFrames(3)

    const before = inputs.sourceCalls()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const frames = inputs.sourceCalls() - before
    viewer.dispose()

    expect(frames).toBe(0)
  })

  it('a source swap tears down the old element', async () => {
    const { viewer } = await videoViewer({ loop: true })
    const loaded: string[] = []
    viewer.on('media-load', () => loaded.push('load'))
    await vi.waitFor(() => expect(loaded.length).toBeGreaterThanOrEqual(1), { timeout: 5000 })

    // Held directly rather than looked up again later: the whole assertion is
    // that this element is no longer the one the viewer serves.
    const first = viewer.element

    // Turned before the swap so that "the pose survived" is distinguishable from
    // "the pose was never anywhere else".
    viewer.rotate(15, 45)
    viewer.src = '/fixtures/clip.mp4?second'
    await vi.waitFor(() => expect(loaded.length).toBeGreaterThanOrEqual(2), { timeout: 5000 })
    await nextFrames(2)

    const state = {
      replaced: viewer.element !== first,
      oldPaused: first.paused,
      oldSrcRemoved: first.getAttribute('src') === null,
      // A swap is not a reconfiguration: the camera is the user's, not the
      // source's, and swapping between two clips of the same place is a thing
      // people do. Resetting here would also be invisible in a screenshot --
      // the new frame would simply be of the other end of the room.
      pose: viewer.cameraOptions.pose
    }
    viewer.dispose()

    // VideoSource.dispose pauses, removes the src and calls load(), so the old
    // element stops decoding. Without that, swapping sources leaks a video that
    // keeps buffering in the background -- invisible, because it is no longer
    // the viewer's element to be seen.
    expect(state.replaced).toBe(true)
    expect(state.oldPaused).toBe(true)
    expect(state.oldSrcRemoved).toBe(true)
    expect(state.pose).toEqual({ povLatitude: 15, povLongitude: 45 })
  })

  it('the autoplay option carries the muted default', async () => {
    const { viewer } = await videoViewer({ autoplay: true })
    const muted = viewer.element.muted
    viewer.dispose()

    // Every modern browser blocks unmuted autoplay, so the legacy default of
    // playing with sound produced a video that never started, and said nothing.
    // What this pins is the default the option carries; that autoplay itself
    // does not fire on v1's detached element is the recorded risk in the file
    // header, not something this test could assert either way.
    expect(muted).toBe(true)
  })

  it('a wheel zoom-in reaches the camera state of a non-linear projection', async () => {
    const inputs = captureRenderInputs()
    const { viewer, container } = await imageViewer({ camera: 'cylindrical' })
    const canvas = canvasOf(container)
    const zooms: string[] = []
    viewer.on('zoom', () => zooms.push('zoom'))
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    const before = await readCanvas(canvas)
    const drawsBefore = inputs.sourceCalls()

    // Scroll UP, which magnifies: classifyWheel produces positive = magnify
    // and a scroll up arrives as one. The unified formula
    // `zoom / (1 + delta)` starting from the default of 1 can only go DOWN
    // (magnify), and scrolling down is a no-op AT the ceiling -- which is
    // why this test scrolls up.
    await wheel(canvas, -200)
    await nextFrames(2)

    const after = await readCanvas(canvas)
    const projection = viewer.cameraOptions.projection
    viewer.dispose()

    expect(zooms.length).toBeGreaterThan(0)
    // Narrowed before the field is read: `Projection` is a union and only the
    // non-linear members have `zoom`, so reading it without the guard does not
    // compile -- which is the union doing its job.
    if (projection.kind !== 'cylindrical') throw new Error(`expected cylindrical, got ${projection.kind}`)
    expect(projection.zoom).toBeLessThan(1)
    /*
     * The pixel half, back where the plan had it. It was red on the
     * unmodified tree (P2+P3 defect: setCamera's matrix-equality early-out
     * skipped the uniform write AND the dirty flag for every camera change
     * on the non-linear kinds -- their clip matrix is constant by design --
     * so zoom never reached the canvas). A failure names its layer: the
     * redraw count watches the loop only -- setSource fires for every frame
     * the loop selects, upstream of the backend's dirty gate -- so "did not
     * redraw" means no frame was ever attempted, while the pixel assertion
     * is the half that catches the backend freeze (under the early-out it
     * went red with the redraw count still passing). No gate covers this
     * family -- gate A compares only states this defect never touches,
     * gate B varies extent between cases, which reflushes through setSource
     * -- so this test is the net.
     */
    expect(inputs.sourceCalls() - drawsBefore, 'the zoom-in did not redraw').toBeGreaterThan(0)
    expect(maxChannelDiff(before.data, after.data), 'the zoom-in did not move the picture').toBeGreaterThan(2)
  })

  it('the public zoom() method reaches the projection the backend receives', async () => {
    /*
     * The wheel test above drives zoom through the input wiring; this one
     * drives the method an application calls. They share a controller but not
     * a path -- the gesture goes `InputController -> 'zoom' event -> camera`,
     * skipping `Viewer.zoom` entirely -- so the asymmetry the acceptance
     * ruler recorded (rotate netted at the method, zoom not) only closes with
     * a call through the method itself, asserted at the backend's boundary:
     * the projection the last drawn frame carried is what the shader read,
     * which no cameraOptions read alone can prove.
     */
    const inputs = captureRenderInputs()
    const { viewer } = await imageViewer({ camera: 'cylindrical' })
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(2)

    // The pre-zoom frame first, or "unchanged" below could be satisfied by a
    // projection that was never installed: `PROJECTIONS.cylindrical` is zoom 1.
    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.projection).toEqual({ kind: 'cylindrical', zoom: 1, extent: [1, 1] })
    })

    // A delta of 1 magnifies by 2x: 1 / (1 + 1) = 0.5. Under the old reading
    // ("-0.5 halves") this same call would be a ceiling no-op and the waitFor
    // below would time out.
    viewer.zoom(1)

    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [1, 1] })
    })
    // A zoom is not a camera move: the pose the frame carries is untouched.
    expect(inputs.lastCamera()?.state).toEqual({ povLatitude: 0, povLongitude: 0 })
    expect(viewer.cameraOptions.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [1, 1] })
    viewer.dispose()
  })

  it('a wheel zoom reaches the linear projection as fov', async () => {
    const inputs = captureRenderInputs()
    const { viewer, container } = await imageViewer()
    const canvas = canvasOf(container)
    const zooms: string[] = []
    viewer.on('zoom', () => zooms.push('zoom'))
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    const before = await readCanvas(canvas)
    const drawsBefore = inputs.sourceCalls()
    const fovBefore = (() => {
      const p = viewer.cameraOptions.projection
      if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
      return p.fov
    })()

    await wheel(canvas, -200)
    await nextFrames(2)

    const after = await readCanvas(canvas)
    const p = viewer.cameraOptions.projection
    viewer.dispose()

    expect(zooms.length).toBeGreaterThan(0)
    if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
    // Scroll UP magnifies: a narrower fov. v1 returned at the kind guard and
    // the frame never changed -- the test this one replaces pinned that no-op.
    expect(p.fov).toBeLessThan(fovBefore)
    expect(inputs.sourceCalls() - drawsBefore, 'the zoom did not redraw').toBeGreaterThan(0)
    expect(maxChannelDiff(before.data, after.data), 'the zoom did not move the picture').toBeGreaterThan(2)
  })

  it('a disposed viewer rejects play()', async () => {
    const { viewer } = await videoViewer()
    // Playable before the dispose, or the rejection could be the never-loaded
    // clip rather than the disposed viewer.
    await vi.waitFor(() => expect(viewer.element.readyState).toBeGreaterThanOrEqual(1), { timeout: 5000 })
    viewer.dispose()

    await expect(viewer.play()).rejects.toThrow(/disposed/i)
  })
})
