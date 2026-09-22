import { describe, expect, it } from 'vitest'
import { canvasOf } from './support/dom'
import { maxChannelDiff, nextFrames, readCanvas } from './support/canvas'
import { PROJECTIONS, imageViewer } from './support/viewer'
import type { ProjectionName } from './support/viewer'

const KINDS = ['linear', 'cylindrical', 'planet', 'pannini'] as const

describe('US3: switch camera models at runtime', () => {
  // Each case starts from a DIFFERENT model, so that every switch is a real
  // switch. Starting from the default every time would make the 'linear' case a
  // no-op onto itself, and the pixel assertion would then hold for a reason that
  // has nothing to do with switching.
  for (const kind of KINDS) {
    it(`switches to ${kind} and keeps the pose`, async () => {
      // The legacy cameraOptions setter rebuilt the whole camera and reset the
      // pose to the origin, so changing the projection silently threw away where
      // the user was looking.
      const from: ProjectionName = kind === 'linear' ? 'cylindrical' : 'linear'
      const { viewer, container } = await imageViewer({ camera: from })
      const canvas = canvasOf(container)
      viewer.src = '/fixtures/panorama.png'
      await nextFrames(3)

      viewer.rotate(20, 100)
      await nextFrames(2)
      const poseBefore = viewer.cameraOptions.pose
      const pixelsBefore = await readCanvas(canvas)

      // No `pose` in the options, and leaving it out is what the assertion is
      // about: handing the old pose back would pass even if the setter reset the
      // camera and then reapplied the pose it was given.
      viewer.cameraOptions = { projection: PROJECTIONS[kind] }
      await nextFrames(3)

      const result = {
        before: poseBefore,
        after: viewer.cameraOptions.pose,
        kind: viewer.cameraOptions.projection.kind,
        changed: maxChannelDiff((await readCanvas(canvas)).data, pixelsBefore.data)
      }
      viewer.dispose()

      expect(result.kind).toBe(kind)
      expect(result.after).toEqual(result.before)
      expect(result.changed).toBeGreaterThan(2)
    })
  }

  it('a projection swap does not reset the pose the user dragged to', async () => {
    const { viewer } = await imageViewer()
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(2)

    viewer.rotate(15, 200)
    const before = viewer.cameraOptions.pose
    viewer.cameraOptions = { projection: PROJECTIONS.planet }
    const after = viewer.cameraOptions.pose
    viewer.dispose()

    expect(after).toEqual(before)
    // The pose the user was looking at, not the origin: the assertion above
    // would also pass if both were the origin.
    expect(after?.povLongitude).toBe(200)
  })

  it('the exported union names exactly the kinds the factory accepts', () => {
    // There is nothing to assert about an unknown kind at runtime -- it cannot be
    // written down, because `Projection` is a closed union -- so this pins the
    // half that IS observable: the kinds this file drives are exactly the four
    // the public union names, in both directions. A fifth kind added to one side
    // and not the other is the failure this catches, and `PROJECTIONS` is
    // `satisfies Record<string, Projection>`, so the compiler catches it too.
    expect(Object.keys(PROJECTIONS).sort()).toEqual([...KINDS].sort())
  })
})
