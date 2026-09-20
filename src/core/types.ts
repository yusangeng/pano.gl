/**
 * The vocabulary shared by every layer.
 *
 * Nothing here knows about WebGL, WebGPU, the DOM, or depth conventions. That
 * is deliberate: `core` is the layer both backends agree on, so anything that
 * differs between them must not appear in these types.
 */

import type { TextureProjection } from './constants'

/**
 * Camera orientation.
 *
 * Angles are degrees, matching the legacy public API. Nothing here is a
 * scale factor or a matrix -- those are derived, and storing them would create
 * a second source of truth that can disagree with the angles.
 */
export interface CameraState {
  /** Degrees, always in `[-90, 90]`. Use `clampLatitude`. */
  readonly povLatitude: number
  /** Degrees, always in `[0, 360)`. Use `wrapLongitude`. */
  readonly povLongitude: number
}

/**
 * How the projection maps view directions onto the screen.
 *
 * `extent` is the part the legacy code hid inside geometry. The three non-linear
 * projections are not scale-invariant: `theta = z * TWO_PI` reads the magnitude
 * of `z`, so the size of the surface being projected is part of the projection
 * itself. The legacy code baked it into quad vertex coordinates (1x1 for
 * cylindrical, 4x4 for planet and pannini) and the numbers never participated
 * in any other computation -- the shader declared `u_CamGeoWidth` and
 * `u_CamGeoHeight` and read neither.
 *
 * Promoting it to a parameter is what lets the geometry subsystem disappear.
 */
export type Projection =
  | { readonly kind: 'linear'; readonly fov: number; readonly aspect: number }
  | { readonly kind: 'cylindrical'; readonly zoom: number; readonly extent: readonly [number, number] }
  | { readonly kind: 'planet'; readonly zoom: number; readonly extent: readonly [number, number] }
  | { readonly kind: 'pannini'; readonly zoom: number; readonly extent: readonly [number, number] }

/**
 * Everything the renderer needs to know about the pixels it is sampling.
 *
 * `projection` is `TextureProjection` from `constants.ts`, not a second type
 * declared here. The legacy code had this concept in three places under three
 * names (`SourceProjection`, `u_TexProjType`, `TEXTURE_PROJECTION_TYPE_*`) and
 * they could disagree.
 *
 * There is deliberately **no** `frameSize` field. The legacy `Texture` took an
 * optional `frameSize` so callers could route an oversized image through an
 * intermediate canvas, because WebGL1 demanded power-of-two textures and
 * `MAX_TEXTURE_SIZE` was a hard wall. Neither WebGPU nor WebGL2 has the
 * power-of-two requirement, and the remaining size limit is knowable at runtime
 * from `Capabilities.maxTextureDimension`. So the decision moves to the backend,
 * where the information actually lives, instead of being a caller's problem.
 *
 * This type is DOM-free by design: `core` is the layer both backends agree on,
 * so the media element and its version counter belong to the source layer, which
 * composes this.
 */
export interface SourceState {
  readonly projection: TextureProjection
  readonly width: number
  readonly height: number
}

/** Depth clip range, which is the one thing the two backends genuinely disagree about. */
export type DepthRange = 'minus-one-to-one' | 'zero-to-one'
