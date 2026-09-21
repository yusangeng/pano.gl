import { describe, it, expect } from 'vitest'
import { renderOffscreen, maxChannelDiff } from './support/gpu'
import { LEGACY_EXTENT } from '../support/baseline'
import { loadSource, readCaptureDoc } from './support/baseline-browser'

/*
 * Gate B, part 2: the one place the new renderer intentionally disagrees with
 * v0.2.2.
 *
 * The legacy non-linear cameras ignored povLatitude entirely: the shader
 * declared u_CamPOVLatitude and never read it, the viewer never uploaded it,
 * and the inner ortho camera that supplied the matrix was constructed with
 * latitude 0 and never updated. The baseline fixtures for those cameras
 * therefore have pixels that cannot vary with latitude, which is why gate A
 * only compares states where this change is a no-op.
 *
 * This test pins the new behaviour so the fix cannot silently regress.
 */
describe('latitude now affects the non-linear cameras', () => {
  const CAMERAS = ['cylindrical', 'planet', 'pannini'] as const

  for (const camera of CAMERAS) {
    it(`${camera} responds to povLatitude`, async () => {
      const source = await loadSource()
      const bitmap = await createImageBitmap(
        new ImageData(source.rgba.slice(), source.width, source.height)
      )

      const render = async (povLatitude: number) =>
        renderOffscreen({
          width: 128,
          height: 128,
          camera: { povLatitude, povLongitude: 0 },
          projection: { kind: camera, zoom: 1, extent: LEGACY_EXTENT[camera] },
          source: bitmap,
          sourceWidth: source.width,
          sourceHeight: source.height
        })

      const [a, b] = await Promise.all([render(0), render(45)])
      bitmap.close()

      // Two frames 45 degrees apart in latitude cannot be the same picture. The
      // threshold is the gate A tolerance: anything above it is a real
      // difference, not dithering.
      expect(maxChannelDiff(a.rgba, b.rgba)).toBeGreaterThan(2)
    })
  }

  it('and the capture records latitude being driven while the legacy pipeline uploaded none of it', async () => {
    // Reads the P0 fixture rather than re-deriving from source, so this is a
    // record of observed behaviour, not of intent.
    const origin = await readCaptureDoc('cylindrical', 'origin')
    const tilt = await readCaptureDoc('cylindrical', 'tilt')

    // The capture drove different latitudes into the viewer -- this is what
    // makes the first test's comparison meaningful rather than a no-op: the
    // two render inputs differ in exactly the value the legacy camera dropped.
    expect(origin.state.lat).toBe(0)
    expect(tilt.state.lat).not.toBe(0)

    // And latitude never reached the legacy non-linear pipeline at all: no
    // frame of either capture contains a u_CamPOVLatitude write. That absence
    // -- not an unread uniform -- is F5 as the fixture records it, and it is
    // why the baseline pixels could not have varied with latitude.
    for (const doc of [origin, tilt]) {
      for (const frame of doc.frames) {
        expect(frame.some(u => u.name === 'u_CamPOVLatitude')).toBe(false)
      }
    }
  })
})
