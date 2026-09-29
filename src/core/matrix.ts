/**
 * Matrix construction for both backends.
 *
 * The one thing that differs between WebGL and WebGPU is the depth clip range:
 * GL maps the near plane to -1 and the far plane to +1, WebGPU maps them to 0
 * and 1. Getting this wrong does not throw -- the picture renders with the far
 * half of the scene missing or inverted. The convention is a parameter here,
 * and the gl-matrix function that implements it carries it in its name
 * (`perspective` vs `perspectiveZO`), so it cannot be selected by accident.
 */

import { mat4 } from 'gl-matrix'
import type { CameraState, DepthRange, Projection } from './types'

/** Near and far planes for the LINEAR perspective path; generous bounds are all
 *  that is required, because reconstruction divides the ray by `w`. */
const NEAR = 0.1
const FAR = 1000

/**
 * Builds the LINEAR view matrix: the world rotates around a stationary eye at
 * the origin, hence the zero eye position in `lookAt`.
 *
 * The `-sin(theta)` in the target's X is the captured handedness; flipping it
 * mirrors the panorama horizontally.
 *
 * **Linear projection only.** The four non-linear cameras rotate the *surface
 * coordinate* in the fragment shader via `u_CamPOVLongitude`; applying this view
 * to them would rotate twice. See `LEGACY_QUAD_VIEW`.
 *
 * @param state - Camera angles in degrees.
 * @param out - Destination matrix.
 */
export function buildViewMatrix (state: CameraState, out: mat4): mat4 {
  const theta = (state.povLongitude * Math.PI) / 180
  const phi = (state.povLatitude * Math.PI) / 180

  return mat4.lookAt(
    out,
    [0, 0, 0],
    [Math.cos(phi) * Math.cos(theta), Math.sin(phi), -Math.cos(phi) * Math.sin(theta)],
    [0, 1, 0]
  )
}

/**
 * The fixed view for the four non-linear projections: camera at the origin
 * looking straight down +X, world up = +Y.
 *
 * The projection formulas expect the surface point in local coordinates: `z`
 * drives `theta`, `y` drives `phi`, and `x` is the constant 1 that
 * `cam_proj_pannini` divides by. With no vertex attributes there is no varying
 * to carry them -- this matrix is the only channel, so `invClip * (ndc, 1.0,
 * 1.0)` must hand the shader back exactly those coordinates.
 */
const LEGACY_QUAD_VIEW: readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
] = Object.freeze([
  // Column-major, the output of mat4.lookAt(identity, [0,0,0], [1,0,0], [0,1,0]).
  //
  //   z = normalize(eye - center) = (-1, 0, 0)
  //   x = normalize(up x z)       = ( 0, 0, 1)
  //   y = z x x                   = ( 0, 1, 0)
  //
  // A surface point (1, y, z) arrives in view space as (z, y, -1): `y`/`z` pass
  // through untouched and `x = 1` becomes a view-space depth of -1.
  0, 0, -1, 0,
  0, 1, 0, 0,
  1, 0, 0, 0,
  0, 0, 0, 1
])

/**
 * Builds a projection matrix in the requested depth convention.
 *
 * **Linear** gets a normal perspective frustum; the fragment shader recovers the
 * view ray from it and `cam_proj_linear` turns that into angles.
 *
 * **Non-linear** gets an orthographic box sized to the projection's `extent`. The
 * `extent` is load-bearing: it is the only carrier of the surface coordinates
 * (see `LEGACY_QUAD_VIEW`), so a box of the wrong size silently rescales `y`/`z`
 * before the shader sees them.
 *
 * Two pinned details:
 *
 * - **`far` is exactly 1.** The surface sits at `x = 1` and reconstruction
 *   samples at `ndcZ = 1`; those must coincide. With `far = 1000` the
 *   reconstruction returns `x = 1000`, and `cam_proj_pannini`'s
 *   `atan(z * 0.5 / x)` is off by a factor of 1000 -- a pannini that looks
 *   almost like plain perspective, with no error anywhere. (`near` is ordinary;
 *   any positive value below `far` works.)
 * - **`m = max(extent) / 2`, not per-axis.** All cameras are square today
 *   (cylindrical and mercator 1x1, planet and pannini 4x4), so the two
 *   agree, and `max` is what the captured matrices use.
 *
 * The `far = 1` pin is the one deliberate departure from the v0.2.2 capture:
 * composing `P * V`, only `M[2]` and `M[14]` read the `far` terms `P[10]`/`P[14]`,
 * so the other fourteen entries stay byte-identical to the capture for the same
 * `extent` -- `test/unit/matrix-baseline.test.ts` asserts exactly that.
 *
 * @param projection - The projection to build. `zoom` is *not* folded in here:
 *   all five shader paths apply it themselves, the linear path by widening the
 *   fov before this call.
 * @param depth - Which backend's depth clip range to produce. On the non-linear
 *   path it changes only the near-plane encoding (entries 2 and 14); both
 *   conventions put the far plane at `ndcZ = 1`, the only plane reconstruction
 *   reads, so either matrix serves both backends.
 * @param out - Destination matrix.
 */
export function buildProjection (
  projection: Projection,
  depth: DepthRange,
  out: mat4
): mat4 {
  if (projection.kind === 'linear') {
    return depth === 'zero-to-one'
      ? mat4.perspectiveZO(out, projection.fov, projection.aspect, NEAR, FAR)
      : mat4.perspective(out, projection.fov, projection.aspect, NEAR, FAR)
  }

  const m = Math.max(projection.extent[0], projection.extent[1]) / 2

  return depth === 'zero-to-one'
    ? mat4.orthoZO(out, -m, m, -m, m, QUAD_NEAR, QUAD_FAR)
    : mat4.ortho(out, -m, m, -m, m, QUAD_NEAR, QUAD_FAR)
}

/** Near/far for the non-linear ortho box. `QUAD_FAR` is pinned to the surface's
 *  `x = 1` plane; changing it breaks reconstruction. See `buildProjection`. */
const QUAD_NEAR = 0.1
const QUAD_FAR = 1

/**
 * Builds the matrix uploaded as `u_CamTransMatrix`.
 *
 * Equivalent to `projection * view`, in that order. Which view is used depends
 * on the projection family -- the linear path rotates the world, the non-linear
 * paths must not.
 */
export function buildCameraTransform (
  state: CameraState,
  projection: Projection,
  depth: DepthRange,
  out: mat4
): mat4 {
  const view = mat4.create()
  const proj = mat4.create()

  if (projection.kind === 'linear') {
    buildViewMatrix(state, view)
  } else {
    mat4.set(view, ...LEGACY_QUAD_VIEW)
  }

  buildProjection(projection, depth, proj)
  return mat4.multiply(out, proj, view)
}
