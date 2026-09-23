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
 * cylindrical, 4x4 for planet and pannini.
 */
const extentFor = (kind: Kind): readonly [number, number] =>
  kind === 'cylindrical' ? [1, 1] : [4, 4]

const projectionFor = (kind: Kind, s: State): Projection =>
  kind === 'linear'
    ? { kind, fov: s.fov, aspect: 1 }
    : { kind, zoom: s.zoom, extent: extentFor(kind) }

const CAMERAS: readonly Kind[] = ['linear', 'cylindrical', 'planet', 'pannini']

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
