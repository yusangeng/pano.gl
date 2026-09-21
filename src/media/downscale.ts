/**
 * Deciding when a media element is too large to upload as-is.
 *
 * The legacy equivalent was the `frameSize` option, which routed an oversized
 * source through an intermediate 2D canvas. It also carried a power-of-two
 * requirement inherited from WebGL1 -- the old upload path used gl.RGB with
 * LINEAR filtering, no mipmaps and no CLAMP_TO_EDGE, which requires the source
 * to be power-of-two.
 *
 * WebGPU has no such requirement: rgba8unorm with linear filtering and
 * clamp-to-edge address mode is valid at any size. So there is no power-of-two
 * quantisation here, and an image that fits is uploaded untouched.
 */

/** How a source of the given size should be prepared for upload. */
export interface DownscalePlan {
  /** Multiplier to apply. 1 means upload as-is. */
  readonly scale: number
  readonly width: number
  readonly height: number
}

/**
 * Computes the upload size for a source.
 *
 * @param width - Source width in pixels.
 * @param height - Source height in pixels.
 * @param max - The device's `maxTextureDimension2D`.
 * @throws If either dimension is not positive. Media elements report 0x0 before their
 *   metadata loads; treating that as "fits" defers the failure to texture
 *   creation, far from the actual cause.
 */
export function planDownscale (width: number, height: number, max: number): DownscalePlan {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`source has a zero dimension: ${width}x${height}`)
  }

  if (width <= max && height <= max) {
    return { scale: 1, width, height }
  }

  const scale = Math.min(max / width, max / height)
  return {
    scale,
    // Round rather than floor toward powers of two: the limit is the only
    // constraint, and quantising would discard resolution for no reason.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}
