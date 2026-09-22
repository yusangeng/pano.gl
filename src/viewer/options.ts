/**
 * Constructor argument validation.
 *
 * There is far less of this than the legacy code had. `param-check` guarded
 * every public boundary against every possible wrong type; in TypeScript the
 * type system already does that, and a runtime check for "is this a string"
 * adds nothing for anyone using the library from TypeScript.
 *
 * What survives is the class of mistake the type system cannot see:
 *
 * - A value that is the right type but the wrong range or the wrong member of
 *   a union, arriving through a cast or from JavaScript.
 * - Options that USED to exist and are now gone. Ignoring one silently leaves
 *   an upgrader believing it still works.
 */

import type { TextureProjection } from '../core/constants'
import type { CameraOptions } from './types'

/**
 * The texture projections this viewer accepts.
 *
 * An alias of `TextureProjection`, not a union of its own and not a copy of its
 * members: there is exactly one accepting type, and `'fisheye'` is deliberately
 * NOT in it. Fisheye was documented in the legacy library and never implemented
 * -- the shader returned `vec2(0.0)`. Leaving it in the type would let a
 * TypeScript caller write an option that can only ever throw; the runtime check
 * below still recognises the string, because a JavaScript caller or a legacy
 * snippet has no compiler to stop it, and "not implemented" is a better message
 * than "unknown projection".
 *
 * The day fisheye is implemented, this is the one line that widens.
 */
export type ImageProjection = TextureProjection

export interface ImageViewerOptions {
  readonly container: HTMLElement
  readonly src: string
  /** How the source's pixels are laid out. A property of the source, not the camera. */
  readonly projection?: ImageProjection
  readonly camera?: CameraOptions
  readonly PTZ?: boolean
}

export interface VideoViewerOptions extends ImageViewerOptions {
  readonly autoplay?: boolean
  readonly loop?: boolean
  readonly muted?: boolean
}

/** Options that were removed. Present only so they can be rejected loudly. */
interface RemovedOptions {
  readonly frameSize?: unknown
  readonly el?: unknown
}

function assertContainer (value: unknown): asserts value is HTMLElement {
  if (value === null || typeof value !== 'object' || (value as Node).nodeType !== 1) {
    throw new TypeError('container must be an HTMLElement')
  }
}

/**
 * Asserts a source URL.
 *
 * Exported because the `src` setters on both public classes take a URL long
 * after construction, and they must reject the same values the constructor does
 * -- a setter that accepted `''` would be the constructor's bug, one call later.
 */
export function assertSrc (value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new TypeError('src must be a string')
  // An empty src makes the browser resolve it to the current page URL, load the
  // HTML document as an image, fail to decode it, and report a media-error that
  // says nothing about the real cause.
  if (value.trim() === '') throw new TypeError('src must not be empty')
}

/**
 * Asserts a texture projection and narrows it for the caller.
 *
 * An assertion function rather than a plain check so that after it returns,
 * `options.projection` is `ImageProjection | undefined` and can be handed to
 * `ImageSource` / `VideoSource` without a cast. `undefined` passes: it means
 * "equirectangular", which is what those constructors default to.
 */
function assertProjection (value: unknown): asserts value is ImageProjection | undefined {
  if (value === undefined) return
  if (value === 'equiprectangular') {
    throw new TypeError(
      "projection 'equiprectangular' was a misspelling; use 'equirectangular'"
    )
  }
  if (value === 'fisheye') {
    // Rejecting at construction. The legacy code accepted it here and threw
    // from inside the texture update, so the viewer reported success and then
    // failed on the first frame.
    throw new TypeError("projection 'fisheye' is not implemented")
  }
  if (value !== 'equirectangular') {
    throw new TypeError(`unknown projection: ${String(value)}`)
  }
}

function assertNoRemoved (options: RemovedOptions): void {
  if (options.frameSize !== undefined) {
    throw new TypeError(
      'the frameSize option was removed: WebGPU has no power-of-two texture ' +
      'requirement, and oversize sources are downscaled automatically'
    )
  }
  if (options.el !== undefined) {
    throw new TypeError("the el option was renamed to 'container'")
  }
}

/**
 * Validates image viewer options.
 *
 * The parameter is the intersection with `RemovedOptions` so that a removed
 * option is *reachable* at runtime -- a caller from JavaScript, or a TypeScript
 * caller who has not rebuilt yet, still arrives here, and the point of checking
 * is to tell them. A literal with `frameSize` in TypeScript is additionally
 * refused by the excess-property check at the call site, which is the better
 * error of the two.
 */
export function validateImageOptions (options: ImageViewerOptions & RemovedOptions): ImageViewerOptions {
  assertContainer(options.container)
  assertSrc(options.src)
  assertProjection(options.projection)
  assertNoRemoved(options)
  return options
}

/** Validates video viewer options, filling in the autoplay defaults. */
export function validateVideoOptions (
  options: VideoViewerOptions & RemovedOptions
): VideoViewerOptions & { muted: boolean } {
  validateImageOptions(options)
  return {
    ...options,
    // Muted by default. Every modern browser blocks unmuted autoplay, so an
    // autoplay video with sound never starts -- which is what the legacy
    // default produced, with no error.
    muted: options.muted ?? true
  }
}
