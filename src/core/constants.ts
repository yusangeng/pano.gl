/**
 * Projection kind constants.
 *
 * The numbers live in `projection-kinds.json` and nowhere else; both this
 * module and the shader-constant generator read that file, so the JS side and
 * the shader side cannot drift. (The legacy code declared them independently
 * in JS and in GLSL, and they drifted.)
 */

import kinds from './projection-kinds.json'

/**
 * The camera projection kinds, as TypeScript sees them.
 *
 * STRINGS in the API, numbers only on the GPU wire: a discriminant should be
 * readable in a debugger and a stack trace (`{ kind: 'planet' }` beats
 * `{ kind: 3 }`), while `u_CamProjType` must agree with the generated shader
 * constants. Keeping them separate means the wire format can change without
 * touching the API; conflating them (as the legacy code did) turns a wrong
 * camera into a silently mis-projected image instead of a type error.
 *
 * `cameraProjectionCode` is the only bridge -- the only place a projection
 * kind turns into a number.
 */
export type ProjectionKind = 'linear' | 'cylindrical' | 'planet' | 'pannini'

/**
 * The texture projection kinds, as TypeScript sees them.
 *
 * Deliberately a single kind: the legacy code half-carried a second one as
 * three mutually inconsistent descriptions of a feature that did not exist.
 * Describe what exists.
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
