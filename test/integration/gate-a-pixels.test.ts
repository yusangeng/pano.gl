import { describe, it, expect } from 'vitest'
import { renderOffscreen, maxChannelDiff } from './support/gpu'
import { LEGACY_EXTENT, legacyFovFrom } from '../support/baseline'
import { camerasOf, loadCapture, loadSource, statesOf } from './support/baseline-browser'
import type { Projection } from '../../src/core/types'

/*
 * Gate A: does one fullscreen triangle serve all four projections?
 *
 * Compares against the PNGs P0 captured from v0.2.2. The baseline is regenerated
 * only by tools/baseline/capture.mjs, so a failure here means the new renderer
 * disagrees with the shipped one -- not that the baseline drifted.
 *
 * Every input comes from the fixture: the state list from the files that exist,
 * the camera parameters from the recorded uniform stream, the source image from
 * the PNG the capture used, the fov from the captured matrix. Nothing is
 * restated here, because a second copy of "what was captured" is a second source
 * of truth for it and the two drift.
 *
 * Tolerance is +-2 LSB per channel. Measured cross-backend deviation is about
 * 5e-5 in float terms, well under one 8-bit step; the headroom covers the
 * difference between v0.2.2's shader and this one, which is not the same code.
 */

/*
 * Whether the legacy `lng` initializer took effect, measured rather than assumed.
 *
 * `cylindrical` at `origin` and `tilt` differ only in longitude as far as this
 * projection can tell -- its phi does not read latitude, both states have zoom
 * 0, and latitude is ignored anyway (F5). So identical pixels mean the driver
 * compiled that invalid file-scope initializer to zero.
 */
async function longitudeIsInert (): Promise<boolean> {
  const [a, b] = await Promise.all([
    loadCapture('cylindrical', 'origin'),
    loadCapture('cylindrical', 'tilt')
  ])
  if (a.image.rgba.length !== b.image.rgba.length) return false
  for (let i = 0; i < a.image.rgba.length; i++) {
    if (a.image.rgba[i] !== b.image.rgba[i]) return false
  }
  return true
}

const LNG_INERT = await longitudeIsInert()

/*
 * The states a camera can be compared on.
 *
 * `perspective` gets all of them: the linear path puts longitude in the matrix,
 * which P2 already pins element by element, so neither defect applies.
 *
 * The non-linear cameras get only the states where both defects are neutral.
 * Latitude is always neutral-or-divergent, never comparable, so it filters to
 * zero. Longitude is neutral only if the measurement above says it never reached
 * a pixel, or if this state does not use it.
 *
 * Registered divergence (C1, 2026-09-23, pan-zoom-semantics spec §5.2,
 * docs/superpowers/specs/2026-09-23-pan-zoom-semantics.md): the renderer now
 * converts longitude honestly while the baseline PNGs still carry v0.2.2's
 * `/ 4` offset in their pixels, so every non-linear state with lng != 0
 * drifts from the baseline permanently. That drift is the fix itself, not a
 * red waiting to be repaired, and the filter above already excludes exactly
 * those states. At lng = 0 both formulas read 0, so `origin` stays comparable.
 */
async function comparableStates (camera: string): Promise<string[]> {
  const all = statesOf(camera)
  if (camera === 'perspective') return all

  const kept: string[] = []
  for (const stateId of all) {
    const { state } = await loadCapture(camera, stateId)
    if (state.lat === 0 && (LNG_INERT || state.lng === 0)) kept.push(stateId)
  }
  return kept
}

describe('gate A: fullscreen triangle vs the v0.2.2 baseline', () => {
  it('compares every camera the baseline holds', async () => {
    const source = await loadSource()

    for (const camera of camerasOf()) {
      for (const stateId of await comparableStates(camera)) {
        const { image, state, captured } = await loadCapture(camera, stateId)

        // The legacy fov is read out of the matrix it built rather than guessed:
        // this gate is about whether the rest of the pipeline agrees, and a
        // wrong fov would produce a confident failure that says nothing useful.
        const projection: Projection =
          camera === 'perspective'
            ? { kind: 'linear', fov: legacyFovFrom(captured.u_CamTransMatrix as number[]), aspect: 1 }
            : { kind: camera, zoom: 1, extent: LEGACY_EXTENT[camera] }

        const bitmap = await createImageBitmap(
          new ImageData(source.rgba.slice(), source.width, source.height)
        )

        const result = await renderOffscreen({
          width: image.width,
          height: image.height,
          camera: { povLatitude: state.lat, povLongitude: state.lng },
          projection,
          source: bitmap,
          sourceWidth: source.width,
          sourceHeight: source.height
        })
        bitmap.close()

        const diff = maxChannelDiff(result.rgba, image.rgba)
        expect(diff, `${camera} / ${stateId}: max channel difference`).toBeLessThanOrEqual(2)
      }
    }
  })

  /*
   * The gate above is only as strong as the set it runs on, so assert the set
   * itself. Without this, a bug that emptied `comparableStates` would report a
   * clean run over zero tests -- and a gate that silently checks nothing is
   * worse than no gate, because it is believed.
   */
  it('has a non-empty comparable set covering all four projections', async () => {
    const cameras = camerasOf()
    expect(cameras).toEqual(['cylindrical', 'pannini', 'perspective', 'planet'])

    for (const camera of cameras) {
      const states = await comparableStates(camera)
      expect(states.length, `${camera} has no comparable state`).toBeGreaterThan(0)
    }
    // The linear path must be compared on everything the capture holds.
    expect(await comparableStates('perspective')).toHaveLength(statesOf('perspective').length)
  })
})
