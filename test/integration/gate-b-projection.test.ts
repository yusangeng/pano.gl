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
  const CAMERAS = ['cylindrical', 'planet', 'pannini', 'mercator'] as const

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
          projection: { kind: camera, zoom: 1, extent: camera === 'mercator' ? [1, 1] : LEGACY_EXTENT[camera] },
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

  it('mercator is extent-sensitive: the surface size is part of the projection', async () => {
    // Same camera, same source, extent 1x1 vs 2x2: the ortho box scales y/z
    // before the formula sees them, so the frame must change. An
    // extent-blind mercator (say, one special-cased in the matrix) would
    // render these identical -- which is exactly what this catches.
    const source = await loadSource()
    const bitmap = await createImageBitmap(
      new ImageData(source.rgba.slice(), source.width, source.height)
    )

    const render = (extent: readonly [number, number]) =>
      renderOffscreen({
        width: 128,
        height: 128,
        camera: { povLatitude: 0, povLongitude: 0 },
        projection: { kind: 'mercator', zoom: 1, extent },
        source: bitmap,
        sourceWidth: source.width,
        sourceHeight: source.height
      })

    const [a, b] = await Promise.all([render([1, 1]), render([2, 2])])
    bitmap.close()
    expect(maxChannelDiff(a.rgba, b.rgba)).toBeGreaterThan(2)
  })

  it('a pole pose collapses the mercator frame onto one source row', async () => {
    // Row r of a 64x64 synthetic source is the uniform shade 4r, so "how many
    // rows are on screen" is readable from the pixels. At povLatitude 90 the
    // f32 chain is atanh(sin(lat)) = +Infinity, M = -Infinity whatever y
    // says, and every fragment lands on the SAME pole row: the frame is
    // uniform. At lat 0 the frame spans nearly all rows and is not. The
    // uniformity spread, not WHICH row, is the assertion: the shader's v is
    // flipped and the sampler repeats, so naming the row would pin a
    // convention this test does not need (the reference unit tests pin which
    // v each pole gives).
    const rows = 64
    const pixels = new Uint8ClampedArray(rows * rows * 4)
    for (let r = 0; r < rows; r++) {
      const shade = r * 4
      for (let c = 0; c < rows; c++) {
        const i = (r * rows + c) * 4
        pixels[i] = shade
        pixels[i + 1] = shade
        pixels[i + 2] = shade
        pixels[i + 3] = 255
      }
    }
    const bitmap = await createImageBitmap(new ImageData(pixels, rows, rows))

    const spread = (rgba: Uint8Array) => {
      let min = 255
      let max = 0
      for (let i = 0; i < rgba.length; i += 4) {
        min = Math.min(min, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
        max = Math.max(max, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
      }
      return max - min
    }

    const render = async (povLatitude: number) =>
      renderOffscreen({
        width: 128,
        height: 128,
        camera: { povLatitude, povLongitude: 0 },
        projection: { kind: 'mercator', zoom: 1, extent: [1, 1] },
        source: bitmap,
        sourceWidth: rows,
        sourceHeight: rows
      })

    const [pole, equator] = await Promise.all([render(90), render(0)])
    bitmap.close()

    // One source row on screen: one shade everywhere (2 absorbs a single
    // bilinear step at a row boundary).
    expect(spread(pole.rgba)).toBeLessThanOrEqual(2)
    // The equator frame shows many rows.
    expect(spread(equator.rgba)).toBeGreaterThan(2)
  })
})
