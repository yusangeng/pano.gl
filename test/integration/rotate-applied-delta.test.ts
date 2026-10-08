import { describe, it, expect } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { makeContainer, canvasOf } from './support/dom'
import { nextFrames } from './support/canvas'
import { drag, dragThrough } from './support/gestures'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'

/*
 * The rotate event's lat is the APPLIED delta on EVERY camera (ADV-3,
 * mercator-camera review leftover risk #6): the pose difference the drag
 * actually produced, after rotate()'s +-90 clamp. The old four cameras used
 * to report the REQUESTED delta, which overshoots the clamped pose near the
 * poles -- a consumer summing the events drifts away from the pose exactly
 * where the camera stops moving. Mercator already reports applied (pinned in
 * mercator-drag.test.ts); this file pins the same contract for the old four
 * -- cylindrical on every leg, planet once to guard against a future
 * per-kind split of the shared emit branch -- through the public surface
 * the way a user sees it.
 *
 * Why the pole legs can use toBe: `drag` delivers exactly one move, so the
 * event sum IS the single difference pose_after - pose_before -- all-integer
 * float64 on those legs, and on the multi-move leg too (its two applied
 * deltas are 1 and 0). Applied deltas do telescope, but a chunked sum of
 * non-integer floats only stays within an ulp of pose_final - pose_initial,
 * it is not exactly it. The float legs -- deep overshoot, lng, control --
 * use toBeCloseTo for exactly that reason: the deep-overshoot applied
 * difference (90 - 89.9) and the requested floats away from the clamp (0.2
 * is not binary-exact) can each differ from the single-shot product by an
 * ulp.
 */

describe('rotate reports the applied delta on the old-four cameras', () => {
  it('clamps at the pole: requested 90 from lat 89, applied 1', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 89 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY -100 of height 200: requested lat = -(-100/200)*180 = +90,
      // which would land at 179; the clamp stops the pose at 90.
      await drag(canvasOf(container), { from: { x: 200, y: 150 }, to: { x: 200, y: 50 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBe(90)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBe(1)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('planet clamps identically: applied 1 from lat 89', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // The emit site is one branch shared by the old four kinds, and the
    // drag-to-degrees conversion reads only the surface -- never the
    // projection's extent -- so planet is not a different formula here.
    // This leg exists so a future per-kind split of that branch (someone
    // special-casing the 4x4 extent) cannot silently drop the applied-delta
    // contract for a kind no other leg mounts. linear and pannini remain
    // unpinned by the same argument: they differ from cylindrical only in
    // the projection formula, which this path never reads.
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'planet', zoom: 1, extent: [4, 4] },
        pose: { povLatitude: 89 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // Same drag as the cylindrical north-pole leg: requested +90, the
      // clamp stops the pose at 90, applied 1.
      await drag(canvasOf(container), { from: { x: 200, y: 150 }, to: { x: 200, y: 50 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBe(90)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBe(1)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('deep in the overshoot: requested 45 from lat 89.9, applied 0.1', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 89.9 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY -50 of height 200: requested +45, pose would be 134.9, the
      // clamp stops it at 90: applied = 90 - 89.9 = 0.09999999999999432 in
      // float64, hence toBeCloseTo.
      await drag(canvasOf(container), { from: { x: 200, y: 125 }, to: { x: 200, y: 75 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBe(90)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBeCloseTo(0.1, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('south pole clamp: requested -90 from lat -89, applied -1', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // This leg exists because no northbound drag can separate a symmetric
    // clamp from a one-sided one: an implementation that clamps only the
    // north overshoot (lat: Math.min(d.lat, 90 - before)) passes every other
    // test in this file while still misreporting the south. It was red
    // before Task 2's emit change -- the event reported the requested -90
    // where applied -1 is pinned -- and turned green with it.
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: -89 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY +100 of height 200: requested lat = -(100/200)*180 = -90,
      // which would land at -179; the south clamp stops the pose at -90.
      // Applied = -90 - (-89) = -1, integers in float64, hence toBe.
      await drag(canvasOf(container), { from: { x: 200, y: 50 }, to: { x: 200, y: 150 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBe(-90)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBe(-1)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('a multi-move drag: per-event applied, telescoping sum', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // `drag` delivers exactly one move, so a handler that captured its
    // baseline once per GESTURE instead of once per MOVE is indistinguishable
    // from the correct one -- every single-move leg above passes under that
    // mutant. This leg is two held moves in one press: the first saturates
    // the clamp (applied 1), the second is clamp-pinned (applied 0), and the
    // sum must be the pose difference -- 1, not 2. The length and the second
    // event's zero also pin the mid-drag half of the zero-applied edge: a
    // clamp-pinned move still FIRES, because event cardinality is itself
    // consumer-visible and the tap guard filters moves that asked for
    // nothing, not moves the clamp swallowed.
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 89 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // Two held moves of deltaY -25 each: requested +22.5 per move, but the
      // first already clamps 89 -> 90 (applied 1) and the second is pinned
      // (applied 0). Synthetic events -- see dragThrough -- hence the event
      // count assertion that makes a delivery failure loud.
      await dragThrough(canvasOf(container), [
        { x: 200, y: 150 },
        { x: 200, y: 125 },
        { x: 200, y: 100 }
      ])
      await nextFrames(2)

      expect(rotations).toHaveLength(2)
      expect(rotations[0]?.lat).toBe(1)
      expect(rotations[1]?.lat).toBe(0)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBe(1)
      expect(viewer.cameraOptions.pose?.povLatitude).toBe(90)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('a drag that starts pinned at the pole still fires, with lat 0', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // The gesture-start half of the zero-applied edge: mounted AT the pole,
    // an upward drag passes the requested guard (it asked for +90) but
    // applies nothing. Suppressing the event would be wrong -- the tap guard
    // exists to filter gestures that asked for nothing, and a consumer
    // counting gestures, or showing edge feedback, must still see this one.
    // Fired, with lat exactly 0: the pose difference of a clamp that had no
    // room to move.
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 90 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY -100 of height 200: requested +90 from a pose already at 90,
      // so the clamp leaves the pose where it is.
      await drag(canvasOf(container), { from: { x: 200, y: 150 }, to: { x: 200, y: 50 } })
      await nextFrames(2)

      expect(rotations).toHaveLength(1)
      expect(rotations[0]?.lat).toBe(0)
      expect(viewer.cameraOptions.pose?.povLatitude).toBe(90)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('the emitted lng is the unwrapped requested turn', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // lng has no clamp, only the [0, 360) wrap on the pose, so the requested
    // turn IS the applied one -- but the pose loses the turn count when it
    // wraps, and an event emitting the wrapped pose-difference (288, not
    // -72) would break every delta-summing consumer. lng rides through the
    // same emit line Task 2 edited; this leg is what keeps that field
    // honest, and like the control leg it is green before and after the
    // change.
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 0 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaX +80 of width 400 rightward: requested turn
      // -(80/400)*360 = -72, pose 0 - 72 wraps to 288.
      await drag(canvasOf(container), { from: { x: 100, y: 100 }, to: { x: 180, y: 100 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLongitude).toBe(288)
      expect(rotations.reduce((s, r) => s + r.lng, 0)).toBeCloseTo(-72, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('away from the poles applied equals requested (control leg)', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 30 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY -40 of height 200: requested +36, pose 66 -- no clamp in
      // force, so the applied delta IS the requested one. This leg passes
      // before AND after the change; it exists to pin that the unification
      // does not eat the mid-range behaviour.
      await drag(canvasOf(container), { from: { x: 200, y: 140 }, to: { x: 200, y: 100 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBeCloseTo(66, 9)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBeCloseTo(36, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })
})
