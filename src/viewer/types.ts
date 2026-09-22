/**
 * The camera half of the public options.
 *
 * `pose` is a partial because the common case is "just move the projection" or
 * "just start at this angle", and requiring both halves would force callers to
 * restate the default. Omitting it means "keep the current pose", which is what
 * makes the `cameraOptions` setter usable for a live projection swap -- see
 * `CameraController.setProjection`.
 *
 * `projection` is required: there is no sensible default that is not also a
 * silent choice of rendering model.
 */

import type { CameraState, Projection } from '../core/types'

export interface CameraOptions {
  /** Initial or replacement pose, in degrees. Omitted means "unchanged". */
  readonly pose?: Partial<CameraState>
  readonly projection: Projection
}
