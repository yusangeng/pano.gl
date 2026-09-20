/**
 * The sampler the panorama shader samples through -- still sources only.
 *
 * The filtering is the part that matters for pixel parity: `linear`, and no
 * mipmaps, because that is what the legacy texture object asked for
 * (`gl.LINEAR` min and mag, and `generateMipmap` never called).
 *
 * The address modes are `clamp-to-edge` and that is NOT a behaviour choice --
 * the shader wraps u itself with `fract` (see `to_uv`), and v never leaves
 * [0, 1] for any of the four projections, so nothing ever samples outside the
 * texture. Declaring `repeat` here would suggest the sampler is doing work it
 * is not, and would leave a reader thinking they can stop wrapping in the
 * shader, which the external-texture path cannot do.
 *
 * A function rather than a module-level constant because a GPUSampler belongs
 * to a device, and a module-level one would outlive the device that created it.
 */
export function createPanoramaSampler (device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'panorama',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
  })
}
