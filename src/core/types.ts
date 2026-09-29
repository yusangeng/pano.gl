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
 * `extent` is the part the legacy code hid inside quad geometry. The three
 * non-linear projections are not scale-invariant: `theta = z * TWO_PI` reads
 * the magnitude of `z`, so the size of the surface is part of the projection
 * itself (1x1 for cylindrical, 4x4 for planet and pannini). Promoting it to a
 * parameter is what lets the geometry subsystem disappear.
 *
 * The pair is ordered `[width, height]`. Every extent in use is square, so the
 * order is presently unobservable -- written down here before a non-square
 * extent turns an unstated assumption into a silent transposition.
 *
 * The `kind` literals are deliberately re-spelled rather than derived from
 * `ProjectionKind`: that type is the set of legal values, this union is which
 * fields each value carries. If either side drifts, the
 * `Record<ProjectionKind, number>` table in `constants.ts` makes it a compile
 * error.
 */
export type Projection =
  | { readonly kind: 'linear'; readonly fov: number; readonly aspect: number }
  | { readonly kind: 'cylindrical'; readonly zoom: number; readonly extent: readonly [number, number] }
  | { readonly kind: 'planet'; readonly zoom: number; readonly extent: readonly [number, number] }
  | { readonly kind: 'pannini'; readonly zoom: number; readonly extent: readonly [number, number] }
  /**
   * The conformal cylinder (2026-09-29 mercator-camera spec): uniform scale
   * everywhere, poles at infinity. Same zoom anchor as cylindrical -- full
   * width 360 degrees at zoom 1 -- and the same 1x1 surface; the vertical
   * field is the Gudermannian pair of the latitude, spanning +/-85.051129
   * degrees (gd(pi), the EPSG:3857 cutoff) at zoom 1.
   */
  | { readonly kind: 'mercator'; readonly zoom: number; readonly extent: readonly [number, number] }

/**
 * Everything the renderer needs to know about the pixels it is sampling.
 * `projection` is `TextureProjection` from `constants.ts`, not a second type
 * declared here.
 *
 * There is deliberately **no** `frameSize` field: neither WebGPU nor WebGL2 has
 * WebGL1's power-of-two rule, and the remaining size limit is knowable at
 * runtime from `Capabilities.maxTextureDimension` -- so downscaling is the
 * backend's decision, where the information lives, not the caller's.
 *
 * DOM-free by design: the media element and its version counter belong to the
 * source layer, which composes this.
 */
export interface SourceState {
  readonly projection: TextureProjection
  readonly width: number
  readonly height: number
}

/** Depth clip range, which is the one thing the two backends genuinely disagree about. */
export type DepthRange = 'minus-one-to-one' | 'zero-to-one'
