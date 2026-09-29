import { describe, it, expect } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { makeContainer, canvasOf } from './support/dom'
import { drag } from './support/gestures'
import { nextFrames } from './support/canvas'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'

/*
 * The mercator gesture story end to end: a drag on the canvas moves the pose
 * in the metre metric (spec section 4) and the public 'rotate' event still
 * carries degrees -- the APPLIED delta, not the metres. Mounts through the
 * public class directly rather than support/viewer's PROJECTIONS table, which
 * Task 9 widens; the pose assertions do not need that harness.
 */
describe('mercator drag (user story)', () => {
  it('a vertical drag pans in the metre metric and reports applied degrees', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: { projection: { kind: 'mercator', zoom: 1, extent: [1, 1] } }
    })
    try {
      await nextFrames(3)

      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // 32px of 200px height upward: metres = -(deltaY/h)*2pi*zoom
      // = 2pi*0.16 = 1.0053096491487339, derived independently.
      await drag(canvasOf(container), { from: { x: 200, y: 100 }, to: { x: 200, y: 68 } })
      await nextFrames(2)

      const pose = viewer.cameraOptions.pose
      expect(pose?.povLatitude).toBeCloseTo(49.801690337054204, 9)
      expect(pose?.povLongitude).toBe(0)
      // Each 'rotate' carries its own applied delta. The drag helper delivers
      // exactly one move, so this is one event; the sum keeps the assertion
      // tied to the pose even if the provider ever batches differently.
      expect(rotations.length).toBeGreaterThanOrEqual(1)
      const totalLat = rotations.reduce((s, r) => s + r.lat, 0)
      const totalLng = rotations.reduce((s, r) => s + r.lng, 0)
      expect(totalLat).toBeCloseTo(49.801690337054204, 9)
      expect(totalLng).toBe(0)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('a horizontal drag moves longitude only, latitude bit-exact', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'mercator', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 45 }
      }
    })
    try {
      await nextFrames(3)

      // 80px of 400px width rightward: lng = -(80/400)*360 = -72, wrapped to
      // 288. deltaY is 0, so the deltaM === 0 shortcut keeps latitude at
      // exactly 45. Mounted at 45, not 0, on purpose: the atanh/tanh/asin
      // round trip is exact at lat 0 and one ulp short here, so removing the
      // shortcut fails THIS test -- at lat 0 the title's bit-exactness claim
      // was only trivially exercised.
      await drag(canvasOf(container), { from: { x: 100, y: 100 }, to: { x: 180, y: 100 } })
      await nextFrames(2)

      const pose = viewer.cameraOptions.pose
      expect(pose?.povLatitude).toBe(45)
      expect(pose?.povLongitude).toBe(288)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('the emitted turn is the requested, unwrapped longitude delta', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: { projection: { kind: 'mercator', zoom: 1, extent: [1, 1] } }
    })
    try {
      await nextFrames(3)

      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // Same rightward drag as the bit-exactness test above: the pose wraps
      // to 288, but the event carries the requested turn, -72. A sign-flip
      // in the emit passed the whole suite before this -- the vertical test's
      // lng delta is exactly -0, and the pose assertions had no listener.
      await drag(canvasOf(container), { from: { x: 100, y: 100 }, to: { x: 180, y: 100 } })
      await nextFrames(2)

      const totalLng = rotations.reduce((s, r) => s + r.lng, 0)
      expect(totalLng).toBeCloseTo(-72, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('metres scale by the zoom in force when the drag happens, not at construction', async (ctx) => {
    // zoom() REPLACES the projection object, so the handler reads zoom live
    // per event; a construction-cached or hardcoded zoom answers 1 forever.
    // Measured by Task 8's review: a hardcoded `zoom: 1` passes unit 343/343
    // and integration 139/139 -- this is the only pin of the live read.
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: { projection: { kind: 'mercator', zoom: 1, extent: [1, 1] } }
    })
    try {
      await nextFrames(3)

      // Halve the zoom parameter -- 1 / (1 + 1) = 0.5 -- so the same 32px of
      // 200px upward spans half the metres: 2pi*0.16*0.5, and
      // lat' = asin(tanh(2pi*0.08)) * 180/pi = 27.658619791226776,
      // derived independently.
      viewer.zoom(1)
      await drag(canvasOf(container), { from: { x: 200, y: 100 }, to: { x: 200, y: 68 } })
      await nextFrames(2)

      const pose = viewer.cameraOptions.pose
      expect(pose?.povLatitude).toBeCloseTo(27.658619791226776, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('the rotate event carries the applied delta, not the absolute pose', async (ctx) => {
    // From lat 89 the pan asymptotically APPROACHES the pole but never clamps
    // onto it: a finite deltaM keeps |lat'| strictly below 90 (I3 -- this is
    // not saturation). The pose-vs-sum pair is the point: applied delta and
    // absolute pose coincide at lat 0, where the first test drags, so an
    // implementation emitting the absolute pose passed the whole suite until
    // this test, measured by Task 8's review. L = 89.63406064763751, applied
    // = L - 89 = 0.6340606476375115, both derived independently.
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'mercator', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 89 }
      }
    })
    try {
      await nextFrames(3)

      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // The same 32px-of-200px upward drag: metres = 2pi*0.16.
      await drag(canvasOf(container), { from: { x: 200, y: 100 }, to: { x: 200, y: 68 } })
      await nextFrames(2)

      const pose = viewer.cameraOptions.pose
      expect(pose?.povLatitude).toBeCloseTo(89.63406064763751, 9)
      const totalLat = rotations.reduce((s, r) => s + r.lat, 0)
      expect(totalLat).toBeCloseTo(0.6340606476375115, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })
})
