import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'
import { Viewer } from '../../src/viewer/viewer'
import type { CameraOptions } from '../../src/viewer/types'
import type { Projection } from '../../src/core/types'
import { nextFrames } from './support/canvas'
import { canvasOf, makeContainer } from './support/dom'

/*
 * The public camera boundary: `viewer.cameraOptions`.
 *
 * `CameraController.state` and `CameraController.projection` both return the
 * object the controller is holding, so the naive getter and setter hand the
 * caller a live reference to viewer state. `Projection`'s fields are `readonly`,
 * but that is a compile-time modifier -- at runtime the caller can write to
 * them, and `extent` is a shared array besides.
 *
 * What makes that worth a test rather than a comment is that the damage is
 * silent. A write through the handed-out reference changes what the next frame
 * would draw while leaving the controller's dirty flag clear, so the change
 * never reaches a frame at all: no error, no event, a canvas that disagrees with
 * the object the application is holding. `Viewer`'s public boundary therefore
 * copies in both directions; the per-frame path inside `#drawFrame` still reads
 * the live reference, because copying there would allocate once per frame.
 */

/** A fresh projection per call, never a module-scope one: a shared fixture would be a channel between tests. */
function cylindrical (zoom: number): Projection {
  return { kind: 'cylindrical', zoom, extent: [4, 4] }
}

/** The snapshot with its `readonly`s taken off -- writing to it is the point. */
interface WritableProjection {
  zoom: number
  extent: number[]
}

async function mount (camera: CameraOptions, container = makeContainer()): Promise<Viewer> {
  const canvas = document.createElement('canvas')
  const backend = await createBackend(canvas)
  return new Viewer({ container, canvas, camera, backend })
}

afterEach(() => { vi.restoreAllMocks() })

describe('cameraOptions', () => {
  it('hands out a copy of the projection, so writing to it cannot move the camera', async () => {
    const viewer = await mount({ projection: cylindrical(0.5) })

    const handed = viewer.cameraOptions
    // Assert what is about to be overwritten before overwriting it. Without this
    // the assertions at the end could hold because the field was never there to
    // begin with -- the vacuous-assertion trap E8 in the plan's errata records.
    expect(handed.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [4, 4] })

    const projection = handed.projection as unknown as WritableProjection
    projection.zoom = 0.9
    projection.extent[0] = 99

    expect(viewer.cameraOptions.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [4, 4] })

    // And the reader is live rather than a constant that happened to match: a
    // getter returning the same object every time would satisfy every line above.
    viewer.rotate(0, 10)
    expect(viewer.cameraOptions.pose).toEqual({ povLatitude: 0, povLongitude: 10 })
  })

  it('hands out a copy of the pose, so writing to it cannot move the camera', async () => {
    const viewer = await mount({ pose: { povLatitude: 10, povLongitude: 20 }, projection: cylindrical(0.5) })

    const handed = viewer.cameraOptions
    expect(handed.pose).toEqual({ povLatitude: 10, povLongitude: 20 })

    const pose = handed.pose as unknown as { povLatitude: number, povLongitude: number }
    pose.povLatitude = 45
    pose.povLongitude = 45

    expect(viewer.cameraOptions.pose).toEqual({ povLatitude: 10, povLongitude: 20 })
  })

  it('hands out a copy of the linear projection, which has no extent to copy', async () => {
    /*
     * The other arm of the snapshot. `linear` is the one member of the
     * `Projection` union with no `extent` field, so a copy written only for the
     * three extent-bearing kinds would be wrong here in a way none of the tests
     * above could see -- `{ ...projection, extent: [...projection.extent] }`
     * throws on the default projection, which is exactly the one a viewer built
     * with `camera: undefined` gets.
     *
     * The container is 600x300 rather than the default so that the aspect
     * asserted below cannot be satisfied by the 1 the caller passed in: the
     * linear projection's aspect belongs to the surface, and the viewer
     * overwrites it in `#resize`. That is worth pinning here, because it is the
     * one projection field a caller sets and does not get back.
     */
    const viewer = await mount(
      { projection: { kind: 'linear', fov: Math.PI / 2, aspect: 1 } },
      makeContainer(600, 300)
    )

    const handed = viewer.cameraOptions
    expect(handed.projection).toEqual({ kind: 'linear', fov: Math.PI / 2, aspect: 2 })

    const projection = handed.projection as unknown as { fov: number, aspect: number }
    projection.fov = Math.PI
    projection.aspect = 3

    expect(viewer.cameraOptions.projection).toEqual({ kind: 'linear', fov: Math.PI / 2, aspect: 2 })
  })

  it('does not adopt the projection object handed to the constructor, so writing to it cannot move the camera', async () => {
    /*
     * The third door, and the one a real application goes through: Task 4's
     * `FramelessImageViewer.create` reaches `new Viewer(...)` with
     * `camera: valid.camera` taken straight from its own caller. `cameraOptions`
     * is copied on the way out and on the way in, but the constructor handed the
     * caller's object to `CameraController`, which stores what it is given --
     * the same silent no-redraw write as the two tests above, arriving by a door
     * neither of them can see.
     *
     * 0.5 rather than 1: 1 is the default zoom, so an assertion written against
     * defaults would hold for a constructor that ignored its argument entirely.
     * The kind does the same work here -- ignoring the argument yields the
     * linear `DEFAULT_PROJECTION`, not a cylindrical projection at all.
     */
    const projection = cylindrical(0.5)
    const viewer = await mount({ projection })

    // First, that the value was really taken. Without this the assertion below
    // is vacuous -- see the E8 note in the first test.
    expect(viewer.cameraOptions.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [4, 4] })

    const writable = projection as unknown as WritableProjection
    writable.zoom = 0.9
    writable.extent[0] = 99

    expect(viewer.cameraOptions.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [4, 4] })
  })

  it("does not adopt the caller's projection object, so writing to it later cannot move the camera", async () => {
    const viewer = await mount({ projection: cylindrical(1) })
    const projection = cylindrical(0.5)

    viewer.cameraOptions = { projection }
    // The setter has to have taken the value, or everything below is vacuous:
    // "nothing changed" asserted against an object that was never installed
    // proves nothing. This is what shows the viewer's value actually moved.
    expect(viewer.cameraOptions.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [4, 4] })

    const writable = projection as unknown as WritableProjection
    writable.zoom = 0.9
    writable.extent[0] = 99

    expect(viewer.cameraOptions.projection).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [4, 4] })
  })

  it('merges a partial pose, so an omitted angle means unchanged', async () => {
    /*
     * The half of the setter's contract nothing above exercises: `pose` is a
     * Partial and "Omitted means 'unchanged'" (src/viewer/types.ts) is a claim
     * about a merge, not something the type system can check. Every assignment
     * in the tests above omits `pose` entirely, so the merge itself could be
     * deleted with this file none the wiser -- the only pose movement anywhere
     * here is `rotate`, which bypasses the setter.
     *
     * Moved off the origin first, or the test agrees with a missing merge by
     * coincidence: a viewer at {0, 0} sits at {0, 0} whether the merge ran or
     * not. Both angles asserted exactly -- the latitude the caller named
     * moved to 5, and the longitude they omitted survived at 20 rather than
     * falling back to the origin.
     */
    const viewer = await mount({ projection: cylindrical(0.5) })
    viewer.rotate(10, 20)
    viewer.cameraOptions = { pose: { povLatitude: 5 }, projection: viewer.cameraOptions.projection }
    expect(viewer.cameraOptions.pose).toEqual({ povLatitude: 5, povLongitude: 20 })
  })
})

describe('a surface with no width', () => {
  /** The aspect of a linear projection, which is the one field `#resize` writes. */
  const aspectOf = (viewer: Viewer): number => {
    const projection = viewer.cameraOptions.projection
    return projection.kind === 'linear' ? projection.aspect : NaN
  }

  it('constructs without throwing and without writing an aspect', async () => {
    /*
     * A collapsed side panel or a vertical splitter dragged shut is zero wide
     * with its height intact -- the one layout where width / height is 0 while
     * height alone looks healthy. `setAspect` rejects 0 (a zero aspect makes
     * the projection matrix singular) and `#resize` reaches it from the
     * constructor, so guarding height alone rejects the whole construction
     * with an error naming `aspect`, an option this caller never wrote.
     *
     * Linear on purpose, with a non-default aspect: `setAspect` is the only
     * writer of that field, so "still the 2 I passed" is the observable of
     * "setAspect never ran". A default fixture could not tell a skipped call
     * from one that wrote the same value back.
     */
    const viewer = await mount(
      { projection: { kind: 'linear', fov: Math.PI / 2, aspect: 2 } },
      makeContainer(0, 300)
    )
    expect(aspectOf(viewer)).toBe(2)
  })

  it('does not throw from the resize path when a live viewer collapses to zero width', async () => {
    /*
     * The same layout arriving later: the container is healthy at
     * construction, then the splitter closes. What `#resize` does then runs
     * inside the ResizeObserver callback, where a throw is uncaught -- it
     * escapes to the page's error reporting once per layout pass, which is
     * the failure shape the guard exists to prevent. Observed at the boundary
     * an application would actually see it: window's error events, collected
     * while the collapse settles.
     */
    const container = makeContainer(400, 300)
    const viewer = await mount(
      { projection: { kind: 'linear', fov: Math.PI / 2, aspect: 1 } },
      container
    )
    // The pre-collapse aspect, which the viewer wrote itself in `#resize`:
    // asserting it first is what keeps "unchanged" below from being satisfied
    // by a value that was never there (the E8 vacuous-assertion trap).
    expect(aspectOf(viewer)).toBe(400 / 300)

    const uncaught: ErrorEvent[] = []
    const onUncaught = (event: ErrorEvent): void => { uncaught.push(event) }
    window.addEventListener('error', onUncaught)
    try {
      container.style.width = '0px'
      await nextFrames(3)
    } finally {
      window.removeEventListener('error', onUncaught)
    }
    expect(uncaught).toEqual([])

    // Proof the collapse actually reached `#resize`, rather than the observer
    // never firing: the backend clamps a zero CSS width to a 1px drawing
    // buffer (`Math.max(1, ...)` in its resize), so the canvas is the record
    // that the resize path ran -- at 400 CSS px and deviceScaleFactor 2 it
    // starts at 800 device px, which nothing but a resize rewrites.
    expect(canvasOf(container).width).toBe(1)
    // And the aspect survived the collapse untouched.
    expect(aspectOf(viewer)).toBe(400 / 300)
  })
})
