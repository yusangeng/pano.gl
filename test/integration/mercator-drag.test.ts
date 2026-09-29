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
      camera: { projection: { kind: 'mercator', zoom: 1, extent: [1, 1] } }
    })
    try {
      await nextFrames(3)

      // 80px of 400px width rightward: lng = -(80/400)*360 = -72, wrapped to
      // 288. deltaY is 0, so the deltaM === 0 shortcut keeps latitude at
      // exactly 0 -- this exercises the no-jitter path through the whole
      // stack.
      await drag(canvasOf(container), { from: { x: 100, y: 100 }, to: { x: 180, y: 100 } })
      await nextFrames(2)

      const pose = viewer.cameraOptions.pose
      expect(pose?.povLatitude).toBe(0)
      expect(pose?.povLongitude).toBe(288)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })
})
