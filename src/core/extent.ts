import type { Projection } from './types'
import { assertPositive } from './validate'

/** Every `Projection` member except the linear one. */
export type NonLinearProjection = Exclude<Projection, { kind: 'linear' }>

const TWO_PI = 2 * Math.PI

/**
 * Resolves the surface extent a non-linear camera is rendered on for the
 * container aspect `aspect` (width / height).
 *
 * `fit: 'extent'` takes the tuple literally -- manual framing (anamorphic
 * lenses, locked framing, the v0.2.2 legacy box). The default -- missing,
 * `'container'`, or any unrecognized value -- keeps `extent[0]` as the
 * horizontal calibration and derives the height so that one pixel at the
 * screen centre covers the same panorama angle horizontally and vertically:
 * `extent_y = extent_x * (k_x / k_y) / aspect`, where the rate ratio is 2pi
 * for cylindrical (theta = z * 2pi against phi = atan(y), centre slope 1)
 * and 1 for the cameras that are conformal or centre-isotropic (mercator,
 * pannini, planet).
 *
 * No clamping and no special cases: the cameras' own asymptotes make every
 * derived paper height graceful. The derivation never reads zoom --
 * zoom cancels on both sides of the equidistance condition, which is what
 * keeps it a purely horizontal framing knob.
 *
 * @throws If `aspect` is not a finite number greater than 0, whatever the
 *   framing mode -- the guard is `assertPositive`'s, and a manual tuple does
 *   not waive the shape check.
 */
export function resolveExtent (
  projection: NonLinearProjection,
  aspect: number
): readonly [number, number] {
  assertPositive(aspect, 'aspect')
  if (projection.fit === 'extent') return [projection.extent[0], projection.extent[1]]
  const rate = projection.kind === 'cylindrical' ? TWO_PI : 1
  return [projection.extent[0], (projection.extent[0] * rate) / aspect]
}
