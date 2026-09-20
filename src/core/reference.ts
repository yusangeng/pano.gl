/**
 * A float64 CPU implementation of the four projections.
 *
 * Why this exists: the cross-backend pixel test compares WGSL against GLSL, and
 * it has a blind spot -- if both shaders were written from the same
 * misunderstanding, they agree with each other and the test passes. This module
 * is the independent third opinion. It is the only artifact in the repo that can
 * catch "both backends are wrong in the same way".
 *
 * It is also the definition of the coordinate range the legacy shader fed to
 * `texture2D`, which gate B in P3 checks the reconstructed surface against.
 *
 * **Everything here is transcribed line by line from
 * `legacy/shader/fshader.glsl`, including its quirks, and must stay that
 * way.** That is not laziness -- it is the requirement. v1's acceptance
 * criterion is "renders what v0.2.2 rendered", so the reference must encode what
 * v0.2.2 actually computed, not what it should have. Two consequences worth
 * stating up front, because they look like transcription errors and are not:
 *
 *   - `theta` is NOT divided by a normalising constant and `u` is NOT shifted
 *     by 0.5. The shader returns `theta / TWO_PI` raw, and the legacy texture
 *     object used the default `REPEAT` wrap, so the sampler did the wrapping.
 *     A `+ 0.5` here would rotate the panorama half a turn.
 *   - The longitude subtraction is `povLongitude / 4`, in *degrees*, subtracted
 *     from a value in *radians*. See `lngOffset` below.
 */

import type { CameraState, Projection } from './types'

const PI = Math.PI
const HALF_PI = Math.PI / 2
const TWO_PI = Math.PI * 2

/** An equirectangular texture coordinate, not yet wrapped by a sampler. */
export interface UV {
  readonly u: number
  readonly v: number
}

/**
 * The legacy shader's longitude offset, transcribed exactly.
 *
 * The shader declares `float lng = u_CamPOVLongitude / 2.0;` at file scope and
 * then each non-linear projection does `theta -= lng / 2.0`. So the value
 * subtracted from a radian angle is `u_CamPOVLongitude / 4`, where
 * `u_CamPOVLongitude` is `CameraState.povLongitude` in **degrees**.
 *
 * This mixes units, and it is a bug in v0.2.2, not a convention. It is
 * reproduced here because reproducing v0.2.2 is the acceptance criterion; fixing
 * it changes panning sensitivity and is a separate, user-visible decision that
 * must not be smuggled in as part of a port. The observable effect is one full
 * turn per `8 * PI` (about 25.13) degrees of `povLongitude` -- about 14.3x
 * (`45 / PI`) the rate of a naive one-turn-per-360-degrees pan. That rate is
 * also why `CylindricalCamera` wraps its longitude with `% 25`: 25 degrees
 * works out to `25 / 4 = 6.25` radians, 0.53% short of the `2 * PI` of a full
 * turn, so the wrap point approximately coincides with the seam.
 *
 * A second hazard, recorded because P0's baseline is the arbiter for it: `lng`
 * is a file-scope initialiser that is not a constant expression, which is
 * invalid in GLSL ES 1.0. Some drivers may have compiled it as 0, in which case
 * the legacy non-linear cameras never rotated at all. Whether the captured
 * baseline shows rotation or not determines which states are comparable; P3's
 * gate A derives its comparable set from the capture rather than assuming.
 */
function lngOffset (state: CameraState): number {
  const lng = state.povLongitude / 2
  return lng / 2
}

/**
 * Wraps into `[0, 1)`, standing in for the sampler's `REPEAT` wrap.
 *
 * The shader itself does not do this -- it hands `texture2D` a raw ratio and the
 * texture object's default wrap mode handles it. The reference has no sampler,
 * so it wraps explicitly. **Parity tests must therefore compare modulo 1**, or
 * compare this normalised output against the shader's `fract()`ed output.
 */
function wrap01 (x: number): number {
  const w = x % 1
  return w < 0 ? w + 1 : w
}

/** Transcribed from `tex_proj_equiprectangular`. Note: no `+ 0.5`. */
function toUV (theta: number, phi: number): UV {
  return { u: wrap01(theta / TWO_PI), v: phi / PI }
}

/*
 * The four projections below are transcribed statement for statement from
 * cam_proj_linear / _cylindrical / _planet / _pannini. The `Math.atan(a / b)`
 * plus explicit quadrant fixups are NOT simplified to `Math.atan2(b, a)`: the
 * two agree for `linear` and `cylindrical` but NOT for `pannini`, where the
 * shader doubles `theta` BEFORE applying the fixups, so `2 * atan2(...)` and
 * `atan2` then `* 2` land in different quadrants. Transcribing literally is both
 * safer and shorter to check against the source.
 */

function projectLinear (x: number, y: number, z: number): UV {
  // Scale-invariant: multiplying (x, y, z) by any positive constant leaves the
  // result unchanged, because every term is a ratio. This is the property that
  // lets the geometry subsystem be replaced by a single fullscreen triangle.
  let theta = Math.atan(z / x)

  if (x < 0) {
    theta = PI + theta
  } else if (x > 0 && z < 0) {
    theta = TWO_PI + theta
  }

  const phi = Math.atan(y / Math.sqrt(x * x + z * z)) + HALF_PI
  return toUV(theta, phi)
}

/*
 * The three non-linear projections are NOT scale-invariant: they read the
 * magnitude of their inputs, not just their ratio. That is why the size of the
 * surface being projected is a projection parameter (`extent`) and not a
 * property of geometry.
 */

function projectCylindrical (x: number, y: number, z: number, zoom: number, lng: number): UV {
  // `x` is deliberately unread, exactly as in the shader. On the legacy quad it
  // was the constant 1.
  const yy = y * zoom
  const zz = z * zoom

  const theta = zz * TWO_PI - lng
  const phi = Math.atan(yy) + HALF_PI
  return toUV(theta, phi)
}

function projectPlanet (x: number, y: number, z: number, zoom: number, lng: number): UV {
  const yy = y * zoom
  // The negation is in the shader and is easy to drop. Without it the planet
  // projection renders mirrored and inside out.
  const zz = -(z * zoom)

  const m = 1 + zz * zz + yy * yy

  const p = (2 * zz) / m
  const q = (2 * yy) / m
  const r = (m - 2) / m

  let theta = Math.atan(p / q)

  if (q < 0) {
    theta = PI + theta
  } else if (q > 0 && p < 0) {
    theta = TWO_PI + theta
  }

  theta -= lng

  const phi = Math.atan(r / Math.sqrt(p * p + q * q)) + HALF_PI
  return toUV(theta, phi)
}

function projectPannini (x: number, y: number, z: number, zoom: number, lng: number): UV {
  const yy = y * zoom
  const zz = z * zoom

  // Note `zz * 0.5 / x`, not `zz * 0.5 * x`: this is the term that reads `x`, and
  // therefore the only one that cares that the reconstruction recovers `x = 1`
  // rather than some far-plane distance. See buildProjection.
  let theta = 2 * Math.atan((zz * 0.5) / x)

  // The fixups test `x` and `z` AFTER theta has been doubled.
  if (x < 0) {
    theta = PI + theta
  } else if (x > 0 && z < 0) {
    theta = TWO_PI + theta
  }

  theta -= lng

  const phi = Math.atan(yy / Math.sqrt(x * x + zz * zz)) + HALF_PI
  return toUV(theta, phi)
}

/**
 * Projects a point on the camera's surface to an equirectangular coordinate.
 *
 * `state.povLatitude` is deliberately unread: `fshader.glsl` declares
 * `u_CamPOVLatitude` and never reads it either, so tilting the non-linear
 * cameras here would render something v0.2.2 never did.
 *
 * @param x - Surface position. For the linear projection only the direction
 *   matters; for the others the magnitude is part of the projection.
 * @param y - Surface position. Drives `phi` in every projection; scaled by
 *   `zoom` by the three non-linear ones.
 * @param z - Surface position. Drives `theta` in every projection; scaled by
 *   `zoom` by the three non-linear ones, and negated by planet.
 * @param state - Camera angles, used by the non-linear projections as a
 *   longitude offset. Only `povLongitude` is read.
 * @param projection - Which formula to apply.
 */
export function project (x: number, y: number, z: number, state: CameraState, projection: Projection): UV {
  const lng = lngOffset(state)

  switch (projection.kind) {
    case 'linear':
      return projectLinear(x, y, z)
    case 'cylindrical':
      return projectCylindrical(x, y, z, projection.zoom, lng)
    case 'planet':
      return projectPlanet(x, y, z, projection.zoom, lng)
    case 'pannini':
      return projectPannini(x, y, z, projection.zoom, lng)
  }
}

/**
 * Maps a normalised device coordinate to the surface position the projection
 * formulas expect.
 *
 * This is the CPU-side statement of what the matrix does on the GPU. The legacy
 * pipeline rasterised a quad lying in the `x = 1` plane and let the varying
 * interpolate its local coordinates; across that quad only `(y, z)` varied and
 * `x` was the constant 1. This function is that mapping written down, and
 * `buildCameraTransform` is built so that inverting it on the GPU recovers
 * exactly these numbers.
 *
 * Both axes use `m = max(extent) / 2`, matching `buildProjection`, and **the
 * sign on `ndcX` is positive**. That sign is not free: the fixed view's basis
 * works out to view-X = world +Z, so a positive horizontal device coordinate is
 * a positive world `z`. Getting it backwards mirrors the panorama horizontally,
 * which is subtle enough to survive review on a symmetric test image and is
 * exactly what the P0 baseline comparison is for.
 *
 * @param ndcX - Horizontal device coordinate in `[-1, 1]`.
 * @param ndcY - Vertical device coordinate in `[-1, 1]`.
 * @param extent - Surface size; the legacy quad's width and height.
 */
export function ndcToSurface (
  ndcX: number,
  ndcY: number,
  extent: readonly [number, number]
): readonly [number, number, number] {
  const m = Math.max(extent[0], extent[1]) / 2
  return [1, ndcY * m, ndcX * m]
}
