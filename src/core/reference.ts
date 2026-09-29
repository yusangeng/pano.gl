/**
 * A float64 CPU implementation of the five projections.
 *
 * The cross-backend pixel test compares WGSL against GLSL and has a blind spot:
 * two shaders written from the same misunderstanding agree with each other.
 * This module is the independent third opinion -- the only artifact that can
 * catch "both backends are wrong in the same way" -- and the definition of the
 * coordinate range the reconstructed surface is checked against (gate B).
 *
 * Everything is transcribed line by line from v0.2.2's `fshader.glsl`,
 * including its quirks, because the acceptance criterion is "renders what
 * v0.2.2 rendered". A quirk that looks like a transcription error is usually
 * the point:
 *
 *   - `theta` is NOT divided by a normalising constant and `u` is NOT shifted
 *     by 0.5. The shader returns `theta / TWO_PI` raw and the legacy texture
 *     used `REPEAT` wrap, so the sampler did the wrapping; a `+ 0.5` here
 *     would rotate the panorama half a turn.
 *
 * Three adjudicated departures, documented at their sites: `latOffset` (the
 * legacy non-linear cameras never read latitude at all), `lngOffset` (a
 * v0.2.2 unit-mixing defect, corrected by user adjudication), and planet's
 * branch-point guard (NaN replaced by the spec's canonical values).
 *
 * Mercator (added 2026-09-29, mercator-camera spec) is not a transcription
 * at all: it has no v0.2.2 original. Its authority is the spec's analytic
 * invariants and gate C's three-way agreement, the same class of ownership
 * as the latitude term above.
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
 * The longitude offset, converted honestly: degrees to radians.
 *
 * v0.2.2 computed a net `povLongitude / 4` -- in degrees -- and subtracted it
 * from a radian angle: about 14.3x the one-turn-per-360-degrees rate. The port
 * first carried that through deliberately (v1-design §11.4 B1); corrected
 * 2026-09-23 by user adjudication, pan-zoom-semantics spec §1
 * (docs/superpowers/specs/2026-09-23-pan-zoom-semantics.md). The WGSL and GLSL
 * copies changed in the same commit and point at the same spec -- gate C holds
 * the three formulas together.
 *
 * The legacy `lng` initialiser was not a constant expression, which is invalid
 * GLSL ES 1.0; some drivers may have compiled it as 0, so the legacy
 * non-linear cameras may never have rotated at all. Gate A derives its
 * comparable state set from the capture rather than assuming either way.
 */
function lngOffset (state: CameraState): number {
  return (state.povLongitude * PI) / 180
}

/**
 * The latitude offset the non-linear projections consume: cylindrical and
 * pannini subtract it from `phi`; planet uses it as the Mobius tilt angle
 * (2026-09-28 planet-drag-semantics spec); mercator subtracts
 * `atanh(sin(lat))`, the conformal counterpart of cylindrical's `- lat`
 * (2026-09-29 mercator-camera spec).
 *
 * Not a transcription: v0.2.2 read latitude nowhere on these cameras (defect
 * F5), so there is no legacy number to preserve and the term is v1's own, in
 * honest degrees-to-radians units. Pinned by gate B.
 */
function latOffset (state: CameraState): number {
  return (state.povLatitude * PI) / 180
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
 * Four of the five projections below are transcribed statement for
 * statement from cam_proj_linear / _cylindrical / _planet / _pannini;
 * mercator is not one of them -- it has no shader original to transcribe
 * (see the header). The `Math.atan(a / b)`
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
 * The four non-linear projections are NOT scale-invariant: they read the
 * magnitude of their inputs, not just their ratio. That is why the size of the
 * surface being projected is a projection parameter (`extent`) and not a
 * property of geometry.
 */

function projectCylindrical (x: number, y: number, z: number, zoom: number, lng: number, lat: number): UV {
  // `x` is unread, exactly as in the shader; on the surface it is the constant 1.
  const yy = y * zoom
  const zz = z * zoom

  const theta = zz * TWO_PI - lng
  const phi = Math.atan(yy) + HALF_PI - lat
  return toUV(theta, phi)
}

function projectPlanet (x: number, y: number, z: number, zoom: number, lng: number, lat: number): UV {
  const yy = y * zoom
  // The negation is in the shader and is easy to drop. Without it the planet
  // projection renders mirrored and inside out.
  const zz = -(z * zoom)

  // The tilt: a sphere rotation as a Mobius transform of the plane point
  // w = zz + i*yy, rolling the source point at polar angle |lat| along the
  // screen-vertical meridian to the screen centre (2026-09-28
  // planet-drag-semantics spec §2.1). The fixed points are w = +-1 and the
  // angle is lat itself -- drag down rolls the centre to sample what was above
  // it, the content-follows-the-finger convention the other cameras use. At
  // lat = 0 this is the identity term for term. The WGSL/GLSL twins add a
  // 1e-15 floor on d2; this float64 arbiter deliberately does not -- exact
  // pole hits stay finite and are pinned as one-ulp artifacts in
  // test/unit/reference.test.ts, and the branch points take the canonical
  // values below.
  const tilt = lat
  const ct = Math.cos(tilt / 2)
  const st = Math.sin(tilt / 2)

  // w' = (ct*w - i*st) / (-i*st*w + ct), expanded into real components:
  // numerator (ct*zz, ct*yy - st), denominator (ct + st*yy, -st*zz).
  const numRe = ct * zz
  const numIm = ct * yy - st
  const denRe = ct + st * yy
  const denIm = -st * zz
  const d2 = denRe * denRe + denIm * denIm

  const zn = (numRe * denRe + numIm * denIm) / d2
  const yn = (numIm * denRe - numRe * denIm) / d2

  const m = 1 + zn * zn + yn * yn

  const p = (2 * zn) / m
  const q = (2 * yn) / m
  const r = (m - 2) / m

  let theta = Math.atan(p / q)

  if (q < 0) {
    theta = PI + theta
  } else if (q > 0 && p < 0) {
    theta = TWO_PI + theta
  }

  let phi = Math.atan(r / Math.sqrt(p * p + q * q)) + HALF_PI

  // The Mobius reduction's branch points: p = q = 0 makes the atan above
  // atan(0/0). The canonical values are the +z-side one-sided limits --
  // theta = 1.5*PI; phi = PI at the Mobius pole (denominator the zero
  // factor), 0 where the numerator is wholly zero (the lat = 0 centre and
  // the tilt centres at the +-90 clamps) -- measured identical at every
  // branch point (2026-09-28 planet-review-followups spec §2.2). In float64
  // the guard fires only at exact tilt-centre hits where the cancellation is
  // bit exact (always at lat = 0, where st = 0 makes it exact by
  // construction; at other tilts by rounding luck); the +-90 sites keep a
  // one-ulp residue in the would-be zero factor, never fire, and their
  // finite values are pinned in test/unit/reference.test.ts. The phi = PI
  // arm never wins in float64 but is load-bearing: the f32 twins DO reach
  // the pole arm, and the spec's same-rule requires the same guard
  // statements in all three.
  if (p === 0 && q === 0) {
    theta = 1.5 * PI
    phi = PI
    if (numRe === 0 && numIm === 0) {
      phi = 0
    }
  }

  theta -= lng
  return toUV(theta, phi)
}

function projectPannini (x: number, y: number, z: number, zoom: number, lng: number, lat: number): UV {
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

  const phi = Math.atan(yy / Math.sqrt(x * x + zz * zz)) + HALF_PI - lat
  return toUV(theta, phi)
}

function projectMercator (x: number, y: number, z: number, zoom: number, lng: number, lat: number): UV {
  // `x` is deliberately unread, exactly as in `projectCylindrical` above.
  const yy = y * zoom
  const zz = z * zoom
  const theta = zz * TWO_PI - lng
  // The negated atanh(sin(lat)) mirrors cylindrical's "- lat" (spec I2): at
  // the screen centre the two cameras read the same source point.
  const M = yy * TWO_PI - Math.atanh(Math.sin(lat))
  // gd(M) + pi/2 in the asin/tanh form: tanh saturates at exactly +-1 and
  // asin's domain is closed, so any M -- including the +-Infinity an exact
  // pole pose produces -- stays finite and branch-free (spec 2.4: the exp
  // form overflows f32 near M = 88.7).
  const phi = Math.asin(Math.tanh(M)) + HALF_PI
  return toUV(theta, phi)
}

/**
 * Projects a point on the camera's surface to an equirectangular coordinate.
 *
 * The linear projection's angles live in `buildViewMatrix`; the non-linear
 * projections read `state` here, through `lngOffset`/`latOffset` (the F5 fix,
 * one of the module header's adjudicated departures).
 *
 * @param x - Surface position. Only its direction matters to `linear`; the
 *   magnitude is part of the projection for the others.
 * @param y - Drives `phi` in every projection; scaled by `zoom` by the
 *   non-linear ones.
 * @param z - Drives `theta` in every projection; scaled by `zoom` by the
 *   non-linear ones, and negated by planet.
 * @param state - Camera angles, read only by the non-linear projections.
 * @param projection - Which formula to apply.
 */
export function project (x: number, y: number, z: number, state: CameraState, projection: Projection): UV {
  const lng = lngOffset(state)
  const lat = latOffset(state)

  switch (projection.kind) {
    case 'linear':
      return projectLinear(x, y, z)
    case 'cylindrical':
      return projectCylindrical(x, y, z, projection.zoom, lng, lat)
    case 'planet':
      return projectPlanet(x, y, z, projection.zoom, lng, lat)
    case 'pannini':
      return projectPannini(x, y, z, projection.zoom, lng, lat)
    case 'mercator':
      return projectMercator(x, y, z, projection.zoom, lng, lat)
  }
}

/**
 * Maps a normalised device coordinate to the surface position the projection
 * formulas expect: the point `(1, ndcY * m, ndcX * m)` on the `x = 1` plane,
 * `m = max(extent) / 2` matching `buildProjection`. `buildCameraTransform` is
 * built so that inverting it on the GPU recovers exactly these numbers.
 *
 * **The sign on `ndcX` is positive**: the fixed view's basis makes a positive
 * horizontal device coordinate a positive world `z`. Getting it backwards
 * mirrors the panorama horizontally -- subtle enough to survive review on a
 * symmetric test image, which is what the P0 baseline comparison is for.
 *
 * @param ndcX - Horizontal device coordinate in `[-1, 1]`.
 * @param ndcY - Vertical device coordinate in `[-1, 1]`.
 * @param extent - Surface size, the projection's `extent`.
 */
export function ndcToSurface (
  ndcX: number,
  ndcY: number,
  extent: readonly [number, number]
): readonly [number, number, number] {
  const m = Math.max(extent[0], extent[1]) / 2
  return [1, ndcY * m, ndcX * m]
}
