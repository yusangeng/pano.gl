import { describe, expect, it } from 'vitest'
import { renderBothBackends, compareWithReference } from './support/cross-backend'
import type { CameraState, Projection } from '../../src/core/types'

/*
 * Gate C: do the two hand-transcribed shaders agree?
 *
 * The WGSL and GLSL sources are separate files with the same four formulas
 * written twice. Nothing in the type system or the build connects them. This is
 * the only thing that does.
 *
 * The comparison is WebGPU vs WebGL2, not either against the P0 baseline:
 *   - Against the baseline, a shared mistake in both transcriptions would pass.
 *   - Against each other, only a mistake in ONE of them fails, which is exactly
 *     the failure mode of hand transcription.
 *
 * The CPU reference in src/core/reference.ts is the arbiter when they disagree:
 * run all three, and the odd one out is the wrong one.
 *
 * `it` rather than `it.each` for the state matrix, because a parameterised test
 * name is built from a string and these names are built from the projection kind
 * and the state index -- the same information, typed, and readable in the
 * failure output.
 */

type Kind = Projection['kind']

/** One camera state. `zoom` belongs to the projection, not to the state. */
interface State {
  readonly povLatitude: number
  readonly povLongitude: number
  readonly fov: number
  readonly zoom: number
}

const state = (s: State): CameraState => ({ povLatitude: s.povLatitude, povLongitude: s.povLongitude })

/**
 * The surface size each projection is evaluated on.
 *
 * These are the legacy quad sizes, and they are part of the projection rather
 * than of any geometry -- which is what let the geometry subsystem disappear.
 * The numbers come from the v0.2.2 quad vertex coordinates: 1x1 for
 * cylindrical, 4x4 for planet and pannini. Mercator's 1x1 is a choice of the
 * 2026-09-29 spec section 2.3, not a legacy quad size.
 */
const extentFor = (kind: Kind): readonly [number, number] =>
  kind === 'cylindrical' || kind === 'mercator' ? [1, 1] : [4, 4]

const projectionFor = (kind: Kind, s: State): Projection =>
  kind === 'linear'
    ? { kind, fov: s.fov, aspect: 1 }
    : { kind, zoom: s.zoom, extent: extentFor(kind) }

const CAMERAS: readonly Kind[] = ['linear', 'cylindrical', 'planet', 'pannini', 'mercator']

// fov is in RADIANS (Projection.fov; see src/viewer/camera-controller.ts). The
// plan originally wrote 75/60/90 here as degrees, which built a mirrored ~22
// degree camera; the values below are the intended angles converted.
const STATES: readonly State[] = [
  { povLatitude: 0, povLongitude: 0, fov: (75 * Math.PI) / 180, zoom: 1 },
  { povLatitude: 30, povLongitude: 45, fov: (75 * Math.PI) / 180, zoom: 1 },
  { povLatitude: -60, povLongitude: 180, fov: (60 * Math.PI) / 180, zoom: 1 },
  { povLatitude: 10, povLongitude: 300, fov: (90 * Math.PI) / 180, zoom: 0.5 }
]

describe('gate C: WebGPU vs WebGL2', () => {
  for (const kind of CAMERAS) {
    for (const [index, s] of STATES.entries()) {
      it(`${kind} / state ${index}`, async () => {
        const diff = await renderBothBackends(state(s), projectionFor(kind, s))

        // The message carries the worst pixel and both colours, so a failure
        // here is a diagnosis rather than a number.
        expect(
          diff.max,
          `worst channel ${diff.max} at (${diff.x}, ${diff.y}): ` +
            `webgpu ${JSON.stringify(diff.a)} vs webgl2 ${JSON.stringify(diff.b)}`
        ).toBeLessThanOrEqual(2)
      })
    }
  }

  it('the CPU reference agrees with both, so a disagreement has an arbiter', async () => {
    // If this test ever fails while the others pass, the two backends are
    // consistently wrong together -- which is the failure mode gate C cannot see
    // on its own.
    //
    // The CPU path is float64 with its own bilinear fetch and the shaders are
    // float32 with the hardware's; hardware bilinear weights are quantized to a
    // handful of sub-texel bits, which is most of the headroom here.
    // Cylindrical, not linear, and not by taste: the reference's ndcToSurface
    // inverts the FIXED quad view, while a linear camera's pose is baked into
    // buildViewMatrix -- which this arbiter deliberately does not use (see
    // project()'s docs in src/core/reference.ts). A non-zero-pose linear
    // camera is beyond what the arbiter can model by construction. The
    // non-linear projections carry their pose as explicit formula terms, so
    // cylindrical at state 1 keeps the third opinion honest exactly where the
    // formulas can disagree: at a non-zero pose.
    const s = STATES[1]!
    const r = await compareWithReference(state(s), projectionFor('cylindrical', s))

    expect(r.webgpu).toBeLessThanOrEqual(3)
    expect(r.webgl2).toBeLessThanOrEqual(3)
  })

  it('the CPU reference arbitrates planet too, at a tilted pose', async () => {
    // 2026-09-28 planet-review-followups spec, section 3: gate C's arbiter leg
    // covered cylindrical only, so a pair of shaders agreeing on a wrong
    // planet transcription had no third opinion. State 1 (lat 30) keeps the
    // pole off-screen and the 128 even canvas never lands a fragment centre
    // on a branch point.
    //
    // Tolerance, per the spec's four requirements:
    // - measured: webgpu 1, webgl2 1, probe run of this file on this
    //   machine's GPU (2026-09-28); the pin is not a guess;
    // - derived: planet runs a longer per-fragment chain than cylindrical
    //   (whose pin is <= 3 above) -- the Mobius complex division and the
    //   stereographic back-projection add a handful of f32 divisions plus
    //   sqrt and a second atan per fragment, and the 4x4 extent
    //   samples a wider stretch of the surface, so a few ulps per link land
    //   a few channels apart after the shared bilinear fetch, whose hardware
    //   weights are quantized to sub-texel bits;
    // - bounded: 4, the smallest power of two strictly above twice the
    //   larger measured maximum;
    // - headroom: the 2x factor plus the power-of-two step absorb a
    //   different f32 transcendental implementation (CI runs SwiftShader,
    //   this machine ran hardware) without masking a real break, which
    //   shows up as a frame-wide uniform difference far above this bound.
    const s = STATES[1]!
    const r = await compareWithReference(state(s), projectionFor('planet', s))

    expect(r.webgpu).toBeLessThanOrEqual(4)
    expect(r.webgl2).toBeLessThanOrEqual(4)
  })

  it('the CPU reference arbitrates mercator too, at a tilted pose', async () => {
    // The mercator-camera spec's acceptance criterion is gate C three-way
    // agreement, so the arbiter leg is not optional for this camera: a pair
    // of shaders agreeing on a wrong mercator transcription has no third
    // opinion without it. State 1 (lat 30) keeps the pose non-trivial.
    //
    // Tolerance, per the four requirements (fill 'measured' from the first
    // probe run on this machine's GPU -- do NOT guess it):
    // - measured: webgpu 1, webgl2 1, probe run of this file
    //   (2026-09-29); the pin is not a guess;
    // - derived: the per-fragment chain is atanh/tanh/asin -- three f32
    //   transcendentals over a 1x1 extent's narrow sample, the same class
    //   of cost as cylindrical's pin (<= 3) above, with no Mobius division
    //   and no second atan;
    // - bounded: 3, matching the cylindrical pin the chain is comparable
    //   to; raise only with a measured reason recorded here;
    // - headroom: the shared bilinear fetch's quantized hardware weights
    //   are most of the distance between the shaders and float64, the same
    //   argument as the cylindrical leg.
    const s = STATES[1]!
    const r = await compareWithReference(state(s), projectionFor('mercator', s))

    expect(r.webgpu).toBeLessThanOrEqual(3)
    expect(r.webgl2).toBeLessThanOrEqual(3)
  })

  it('the poles are the documented exception', async () => {
    // Near latitude +/-90 the equirectangular mapping compresses the entire
    // longitude range into a few pixels, so a tiny difference in the computation
    // of atan lands many texels apart. The tolerance is relaxed there on
    // purpose; this test pins that it is still bounded rather than unbounded.
    for (const kind of CAMERAS) {
      const s: State = { povLatitude: 89.5, povLongitude: 0, fov: (75 * Math.PI) / 180, zoom: 1 }
      const diff = await renderBothBackends(state(s), projectionFor(kind, s))

      // Not equal, but not garbage: a broken implementation gives a uniform
      // difference across the whole frame, not a bounded one.
      expect(diff.max, `${kind} at the pole`).toBeLessThan(64)
    }
  })
})

describe('gate C: mercator state sweep (spec section 5)', () => {
  // Spec 2026-09-29 section 5: gate C must cover mercator across the latitude
  // range INCLUDING the pole poses and across the zoom range. The exact poles
  // are row collapses, not the longitude compression that motivates the 89.5
  // relaxation above, and mercator's theta never reads latitude, so every
  // state here holds to the same <= 2 as the main matrix.
  //
  // If a state fails on first run, measure it before writing any number down
  // -- never fabricate a 'measured' line (the four-requirement protocol the
  // planet arbiter comment records above).
  for (const lat of [-90, -45, 0, 45, 90]) {
    for (const zoom of [0.01, 0.5, 1]) {
      it(`mercator lat ${lat} zoom ${zoom}`, async () => {
        const diff = await renderBothBackends(
          { povLatitude: lat, povLongitude: 30 },
          { kind: 'mercator', zoom, extent: [1, 1] }
        )
        expect(
          diff.max,
          `worst channel ${diff.max} at (${diff.x}, ${diff.y}): ` +
            `webgpu ${JSON.stringify(diff.a)} vs webgl2 ${JSON.stringify(diff.b)}`
        ).toBeLessThanOrEqual(2)
      })
    }
  }
})
