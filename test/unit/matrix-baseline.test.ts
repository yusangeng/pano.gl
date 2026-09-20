import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { mat4 } from 'gl-matrix'
import { buildCameraTransform } from '../../src/core/matrix'
import type { Projection } from '../../src/core/types'
import { CAMERAS, LEGACY_EXTENT, STATES, legacyFovFrom } from '../support/baseline'
import { fixtureRoot, readCaptureDoc } from '../support/baseline-node'

/*
 * Compares the new matrix code against what v0.2.2 actually uploaded.
 *
 * This is the payoff for capturing the uniform stream in P0 rather than only
 * pixels: matrix construction is CPU work, so it can be proven correct without
 * a GPU, a browser, or a renderer. If this test passes, every later gate that
 * fails is failing somewhere else.
 */

/**
 * The entries that encode `near`/`far`, and are therefore the only ones allowed
 * to differ.
 *
 * Composing `P * V` with `V` the fixed quad view: the only places `P[10]` and
 * `P[14]` land are the coefficient of world-x in clip-z (`M[2]`) and the clip-z
 * constant (`M[14]`). Everything else -- the whole surface mapping -- reads only
 * `P[0]` and `P[5]`, which do not involve `near` or `far` at all.
 *
 * The legacy used `far = 1000`; v1 uses `far = 1` so that reconstruction samples
 * the plane the quad actually lies on. See `buildProjection`.
 */
const DEPTH_ONLY_ENTRIES = new Set([2, 14])

const captures = existsSync(fixtureRoot)
  ? CAMERAS.flatMap(camera => STATES.map(state => ({ camera, state })))
  : []

describe.skipIf(captures.length === 0)('matrix parity with the v0.2.2 baseline', () => {
  it.each(captures)(
    '$camera / $state reproduces the captured u_CamTransMatrix',
    ({ camera, state }) => {
      const { state: pose, captured } = readCaptureDoc(camera, state)
      const expected = captured.u_CamTransMatrix
      expect(expected, 'baseline has no u_CamTransMatrix').toBeDefined()
      const matrix = expected as number[]

      const projection: Projection =
        camera === 'perspective'
          ? { kind: 'linear', fov: legacyFovFrom(matrix), aspect: 1 }
          : { kind: camera, zoom: 1, extent: LEGACY_EXTENT[camera] }

      const actual = buildCameraTransform(
        { povLatitude: pose.lat, povLongitude: pose.lng },
        projection,
        'minus-one-to-one',
        mat4.create()
      )

      // The linear path is the same computation the legacy performed, so all 16
      // entries must match. The non-linear path reconstructs instead of
      // interpolating, so the two depth entries legitimately differ.
      for (let i = 0; i < 16; i++) {
        if (camera !== 'perspective' && DEPTH_ONLY_ENTRIES.has(i)) continue
        // float32 storage in the fixture vs float64 here.
        expect(actual[i], `element ${i}`).toBeCloseTo(matrix[i]!, 5)
      }
    }
  )

  it('differs from the baseline ONLY in the two depth entries', () => {
    // The carve-out above is only sound if it is actually confined. If a future
    // change made, say, the x-scale depend on `far`, the previous test would
    // still pass while the panorama silently rescaled -- so assert the exclusion
    // is exactly two entries wide and no wider.
    const { state: pose, captured } = readCaptureDoc('planet', 'origin')
    const matrix = captured.u_CamTransMatrix as number[]

    const actual = buildCameraTransform(
      { povLatitude: pose.lat, povLongitude: pose.lng },
      { kind: 'planet', zoom: 1, extent: LEGACY_EXTENT.planet },
      'minus-one-to-one',
      mat4.create()
    )

    const differing = []
    for (let i = 0; i < 16; i++) {
      if (Math.abs(actual[i]! - matrix[i]!) > 1e-5) differing.push(i)
    }
    expect(differing).toEqual([2, 14])
  })
})
