/**
 * The sampler the panorama shader samples through -- still sources only.
 *
 * The filtering is the part that matters for pixel parity: `linear`, and no
 * mipmaps, because that is what the legacy texture object asked for
 * (`gl.LINEAR` min and mag, and `generateMipmap` never called).
 *
 * The address modes are `repeat` on BOTH axes, for legacy parity: the legacy
 * texture object left WebGL's default wrap in place, so a LINEAR fetch within
 * half a texel of the u seam blended the last source column into the first,
 * and one at the v poles blended the top row into the bottom. `fract` in
 * `to_uv` already folds u into [0, 1); what repeat adds over it is only that
 * boundary blend, which clamp-to-edge cannot express -- gate A measured it at
 * up to 124 LSB on the seam columns, and at the pole for perspective/south.
 * The video path is unaffected by this choice either way:
 * `textureSampleBaseClampToEdge` clamps to the edge whatever the sampler's
 * address modes say, so video keeps a hard seam as an API limit of its entry
 * point, not as a decision to treat it differently.
 *
 * A function rather than a module-level constant because a GPUSampler belongs
 * to a device, and a module-level one would outlive the device that created it.
 */
export function createPanoramaSampler (device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'panorama',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
  })
}
