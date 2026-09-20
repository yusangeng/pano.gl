/**
 * Projection kind constants.
 *
 * The numbers live in `projection-kinds.json` and nowhere else. Both this
 * module and the shader-constant generator read that file, so the JS side and
 * the shader side cannot drift -- which is exactly what went wrong in the
 * legacy implementation, where the same four numbers were declared
 * independently in `projectionType.js` and in `fshader.glsl`.
 */

import kinds from './projection-kinds.json'

/**
 * The camera projection kinds, as TypeScript sees them.
 *
 * These are STRINGS, not the numbers the legacy code used, and the split is
 * deliberate. Two different things were being conflated:
 *
 *   - what a projection is, in TypeScript -- a discriminant that should be
 *     readable in a debugger, in a stack trace and in a public API call
 *     (`{ kind: 'planet' }` beats `{ kind: 3 }` on every one of those counts)
 *   - what gets uploaded to the GPU as `u_CamProjType` -- an integer that must
 *     agree with the generated shader constants, and nothing else
 *
 * The legacy code used one number for both, which is why a wrong camera showed
 * up as a silently mis-projected image rather than as a type error. Keeping
 * them separate means the wire format can change without touching the API.
 *
 * `cameraProjectionCode` is the only bridge, and it is the only place a
 * projection kind turns into a number.
 */
export type ProjectionKind = 'linear' | 'cylindrical' | 'planet' | 'pannini'

/**
 * The texture projection kinds, as TypeScript sees them.
 *
 * The extra kind the legacy code half-carried is deliberately absent: an
 * unreachable constant, a JS branch that threw, and a shader branch that
 * returned vec2(0.0) -- three mutually inconsistent descriptions of a feature
 * that does not exist. Describe what exists.
 */
export type TextureProjection = 'equirectangular'

/** The upload values, keyed by kind. Derived from the JSON, never restated. */
const CAMERA_CODES: Record<ProjectionKind, number> = {
  linear: kinds.camera.linear,
  cylindrical: kinds.camera.cylindrical,
  planet: kinds.camera.planet,
  pannini: kinds.camera.pannini
}

const TEXTURE_CODES: Record<TextureProjection, number> = {
  equirectangular: kinds.texture.equirectangular
}

/**
 * The value uploaded as `u_CamProjType` for a camera projection kind.
 *
 * Every upload site goes through this function rather than reading the JSON
 * directly, so the generated shader constants and the runtime values have
 * exactly one path between them.
 */
export function cameraProjectionCode (kind: ProjectionKind): number {
  return CAMERA_CODES[kind]
}

/** The value uploaded as `u_TexProjType`. See `cameraProjectionCode`. */
export function textureProjectionCode (projection: TextureProjection): number {
  return TEXTURE_CODES[projection]
}

/** Every camera projection kind, in a stable order. */
export const PROJECTION_KINDS: readonly ProjectionKind[] = [
  'linear', 'cylindrical', 'planet', 'pannini'
]
