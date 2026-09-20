/**
 * Matrix construction for both backends.
 *
 * The one thing that differs between WebGL and WebGPU is the depth clip range:
 * GL maps the near plane to -1 and the far plane to +1, WebGPU maps them to 0
 * and 1. Getting this wrong does not throw -- the picture renders with the far
 * half of the scene missing or inverted.
 *
 * The legacy code baked the GL convention into its matrix helpers, so the
 * convention was invisible at every call site. Here it is a parameter, and the
 * gl-matrix function that implements it has the convention in its name
 * (`perspective` vs `perspectiveZO`), so it cannot be selected by accident.
 */

import { mat4 } from 'gl-matrix'
import type { CameraState, DepthRange, Projection } from './types'

/** Near and far planes for the LINEAR perspective path. The legacy cube sat at
 *  radius 100 and was the only geometry, so these bound it with room to spare. */
const NEAR = 0.1
const FAR = 1000

/**
 * Builds the LINEAR view matrix: eye at the origin, world rotated by the angles.
 *
 * This is the legacy convention, and it is worth stating explicitly because it
 * looks backwards. The legacy viewer never moves the camera -- it rotates the
 * world around a stationary eye, which is why `lookAt` is called with a zero eye
 * position and a direction vector derived from the angles.
 *
 * The `-sin(theta)` in the target's X component is not a typo. It is the legacy
 * handedness, and flipping it mirrors the panorama horizontally.
 *
 * **This view applies to the linear projection only.** The three non-linear
 * cameras do not rotate a world -- they rotate the *surface coordinate* inside
 * the fragment shader, via `u_CamPOVLongitude`. Applying this view to them as
 * well would rotate twice. See `LEGACY_QUAD_VIEW`.
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
 * The fixed view for the three non-linear projections: camera at the origin
 * looking straight down +X, world up = +Y.
 *
 * This reproduces the legacy vertex shader's data path. The legacy unit quad sat
 * at `x = 1` with `y`/`z` spanning the camera's extent, and `vshader.glsl` did
 * `v_Pos = a_Pos` -- so the fragment shader received those raw *local*
 * coordinates, untransformed. In the new design there is no attribute and
 * therefore no varying: the matrix is the only channel left. Pinning the view to
 * this fixed orientation, and sizing the ortho box to the extent, makes
 * `invClip * (ndc, 1.0, 1.0)` hand back exactly the legacy local coordinates.
 *
 * gl-matrix derives the basis as view-X = world +Z, view-Y = world +Y, so an
 * `(x, y, z)` quad vertex arrives at the shader as `(1, y, z)`. That is what
 * `cam_proj_cylindrical` and friends expect: `z` drives `theta`, `y` drives
 * `phi`, and `x` is the constant 1 that `cam_proj_pannini` divides by.
 */
const LEGACY_QUAD_VIEW: readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
] = Object.freeze([
  // Column-major, the output of mat4.lookAt(identity, [0,0,0], [1,0,0], [0,1,0]),
  // written out so that "this view does not depend on the camera state" is
  // visible in the code rather than inferred.
  //
  //   z = normalize(eye - center) = (-1, 0, 0)
  //   x = normalize(up x z)       = ( 0, 0, 1)
  //   y = z x x                   = ( 0, 1, 0)
  //
  // Mapped to (1, y, z) this yields view-space (z, y, -1): the quad's `y` and
  // `z` pass through untouched (which is what the shader needs) and its `x = 1`
  // constant becomes a view-space depth of -1.
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
 * `extent` is load-bearing, not decoration: it is the only surviving carrier of
 * the quad's local coordinates (see `LEGACY_QUAD_VIEW`), so a box of the wrong
 * size silently rescales `y`/`z` before the shader sees them and every non-linear
 * projection renders wrong.
 *
 * Two details that look arbitrary and are not:
 *
 * - **`far` is exactly 1, where the legacy used 1000.** The legacy quad sits at
 *   `x = 1`, and reconstruction samples at `ndcZ = 1`. Those must coincide:
 *   with the legacy's `far = 1000` the reconstruction returns `x = 1000`, and
 *   `cam_proj_pannini`'s `atan(z * 0.5 / x)` is then off by a factor of 1000 --
 *   which renders a pannini camera that looks almost like a plain perspective
 *   one, with no error anywhere. (`near` at 0.1 is ordinary; any positive value
 *   below `far` works.)
 * - **`m = max(extent) / 2`, not `extent / 2` per axis.** The legacy cameras all
 *   happen to be square (cylindrical is 1x1, planet and pannini are 4x4), so the
 *   two are equal in practice, and `max` reproduces the legacy
 *   `Math.max(W / 2, H / 2)` exactly.
 *
 * **This is the one place the new matrix deliberately departs from the P0
 * capture, and the departure is provably confined to two entries.** Composing
 * `P * V` where `V` is the fixed view, the only entries that read `P[10]` or
 * `P[14]` -- the two terms `far` appears in -- are `M[2]` and `M[14]`. The other
 * fourteen entries are byte-identical to the legacy capture for the same
 * `extent`. `test/unit/matrix-baseline.test.ts` asserts exactly that: the
 * surface mapping is preserved, the depth convention is not.
 *
 * @param projection - The projection to build. `zoom` is *not* folded in here:
 *   all four shader paths apply it themselves, the linear path by widening the
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

/** Near/far for the non-linear ortho box. `QUAD_FAR` is pinned to the legacy
 *  quad's `x = 1` plane; changing it breaks reconstruction. See `buildProjection`. */
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
