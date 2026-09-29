/**
 * The single owner of camera state.
 *
 * The matrix maths is stateless and lives in `core/matrix.ts`. What is here is
 * everything that needs memory: clamping on assignment, the relative semantics
 * of rotate and zoom, and the dirty flag -- which is why a static image renders
 * once instead of running a full-screen fragment shader on every rAF tick
 * forever (as the legacy FrameDriver did).
 *
 * Nothing here recomputes a projection formula: the CPU-side authority is
 * `core/reference.ts`, and a formula duplicated here would be a second opinion.
 */

import type { CameraState, Projection } from '../core/types'
import { clampLatitude, wrapLongitude, assertFinite, assertPositive } from '../core/validate'

/**
 * The camera a viewer starts with when the caller does not name one.
 *
 * The legacy default was `fov: 70` in degrees; `Projection.fov` is in radians
 * (the legacy matrix took degrees), so the conversion happens here once. The
 * `aspect` is a placeholder the viewer overwrites from the surface's real size
 * on the first resize, during construction: it cannot be known before a
 * container exists, and 1 is wrong in the least visible way if a frame somehow
 * got drawn first.
 */
export const DEFAULT_PROJECTION: Projection = {
  kind: 'linear',
  fov: (70 * Math.PI) / 180,
  aspect: 1
}

/**
 * Linear zoom bounds in radians: 15° and 110°. Below 15° a handful of source
 * pixels stretch across the viewport; past 110° rectilinear distortion
 * dominates. User-adjudicated 2026-09-23, see the pan-zoom-semantics spec §4
 * (docs/superpowers/specs/2026-09-23-pan-zoom-semantics.md).
 */
const MIN_FOV = (15 * Math.PI) / 180
const MAX_FOV = (110 * Math.PI) / 180

export class CameraController {
  #state: CameraState
  #projection: Projection
  #dirty = true
  readonly #changeListeners = new Set<() => void>()

  /**
   * @param pose - Initial pose in degrees. Defaults to the origin.
   * @param projection - Initial projection.
   * @throws If a supplied angle is not finite. The pose arrives straight from a
   *   caller's `camera.pose` option, so this is a public boundary and not an
   *   internal one -- a NaN let through here reaches the matrix and draws a
   *   black frame with nothing reported.
   */
  constructor (pose: Partial<CameraState> | undefined, projection: Projection) {
    this.#state = {
      povLatitude: clampLatitude(pose?.povLatitude ?? 0),
      povLongitude: wrapLongitude(pose?.povLongitude ?? 0)
    }
    this.#projection = projection
  }

  /** The current pose. */
  get state (): CameraState { return this.#state }

  /** The current projection. */
  get projection (): Projection { return this.#projection }

  /**
   * Reads and clears the dirty flag.
   *
   * Consuming rather than reading is deliberate: the renderer is the only
   * consumer, and a flag cleared by hand is exactly the state that goes wrong
   * (the legacy latch was cleared in one place and set in three).
   */
  consumeDirty (): boolean {
    const was = this.#dirty
    this.#dirty = false
    return was
  }

  /**
   * Sets the pose.
   *
   * Latitude is clamped to [-90, 90]; longitude wraps into [0, 360). The two
   * are different on purpose -- wrapping latitude would carry the viewer past
   * the pole to the mirrored side, where the equirectangular mapping is
   * singular.
   *
   * @throws If either angle is not finite. An infinite or NaN angle produces a
   *   matrix of NaNs that draws a black frame with no error reported anywhere.
   */
  setPose (pose: CameraState): void {
    assertFinite(pose.povLatitude, 'povLatitude')
    assertFinite(pose.povLongitude, 'povLongitude')
    this.#apply(pose.povLatitude, pose.povLongitude)
  }

  /**
   * Rotates by a relative delta in degrees.
   *
   * A zero delta is a no-op that does not dirty the controller: every
   * pointermove that did not actually move would otherwise force a full redraw.
   */
  rotate (deltaLat: number, deltaLng: number): void {
    assertFinite(deltaLat, 'deltaLat')
    assertFinite(deltaLng, 'deltaLng')
    if (deltaLat === 0 && deltaLng === 0) return
    this.#apply(this.#state.povLatitude + deltaLat, this.#state.povLongitude + deltaLng)
  }

  /**
   * Pans the Mercator camera: `deltaM` in the map's metre metric, `deltaLng`
   * in degrees.
   *
   * The latitude update inverts the projection's own latitude term --
   * `lat' = asin(tanh(atanh(sin lat) + deltaM))` -- so the content under the
   * finger stays under the finger at every latitude and zoom (spec section 4;
   * the metre formula lives in `classifyDragMercator`). Programmatic rotation
   * keeps its degree-linear shape; this is the gesture path only.
   */
  panMercator (deltaM: number, deltaLng: number): void {
    assertFinite(deltaM, 'deltaM')
    assertFinite(deltaLng, 'deltaLng')
    if (deltaM === 0 && deltaLng === 0) return
    // A purely horizontal pan must not touch latitude: the atanh/tanh/asin
    // round trip is exact in real arithmetic but only ~1 ulp in float64
    // (measured 7.1e-15deg at lat 45, 1.4e-14 at lat 80), and every jitter
    // dirties a full-redraw frame.
    const lat = deltaM === 0
      ? this.#state.povLatitude
      : Math.asin(Math.tanh(Math.atanh(Math.sin(this.#state.povLatitude * Math.PI / 180)) + deltaM)) * 180 / Math.PI
    this.#apply(lat, this.#state.povLongitude + deltaLng)
  }

  /**
   * Zooms by a relative magnification: a positive delta magnifies the picture
   * by (1 + delta), a negative one shrinks it by the same factor.
   *
   * Both parameterisations divide by (1 + delta) -- fov for the linear camera,
   * zoom for the others -- because in both a smaller parameter is a narrower
   * field, so ONE formula serves five cameras and the wheel step feels the
   * same on each. v1 multiplied instead, reading the "positive is zoom in"
   * wheel contract backwards and inverting wheel and pinch; corrected by user
   * adjudication, pan-zoom-semantics spec §2-3.
   *
   * No-op for a zero delta and for a delta whose clamped result is the value
   * already held (a wheel pinned at a limit).
   */
  zoom (delta: number): void {
    assertFinite(delta, 'zoom delta')
    if (delta === 0) return
    // A public-API delta below -1 would flip the divisor's sign and clamp a
    // "shrink" onto the most-magnified end of the range. Clamping the divisor
    // keeps every delta on the monotone path; the real input layer already
    // bounds its deltas to [-1, 1] (WheelZoom.MAX_STEP).
    const scale = Math.max(1 + delta, Number.EPSILON)
    if (this.#projection.kind === 'linear') {
      const next = Math.min(MAX_FOV, Math.max(MIN_FOV, this.#projection.fov / scale))
      if (next === this.#projection.fov) return
      this.#projection = { ...this.#projection, fov: next }
    } else {
      const next = Math.min(1, Math.max(0.01, this.#projection.zoom / scale))
      if (next === this.#projection.zoom) return
      this.#projection = { ...this.#projection, zoom: next }
    }
    this.#dirty = true
    this.#notify()
  }

  /**
   * Replaces the projection, keeping the pose -- the legacy setter rebuilt the
   * whole camera and silently threw away where the user was looking.
   */
  setProjection (projection: Projection): void {
    this.#projection = projection
    this.#dirty = true
    this.#notify()
  }

  /**
   * Sets the linear projection's aspect from the surface's, and does nothing to
   * the others.
   *
   * The surface size is knowledge only the viewer's resize handler has, and for
   * the linear camera the projection's aspect IS the surface's -- rendering a
   * 16:9 container with the default square aspect stretches the image. The
   * other four cameras take their shape from the projection's `extent`, which
   * the shader reads, so they have no aspect field to write.
   *
   * @param aspect - width / height of the drawing surface. Must be positive.
   * @throws If `aspect` is not finite or is not greater than zero. A zero aspect
   *   makes the projection matrix singular, which draws nothing and reports
   *   nothing.
   */
  setAspect (aspect: number): void {
    assertPositive(aspect, 'aspect')
    if (this.#projection.kind !== 'linear') return
    if (this.#projection.aspect === aspect) return
    this.#projection = { ...this.#projection, aspect }
    this.#dirty = true
    this.#notify()
  }

  /**
   * Marks the next frame as needing a draw, without changing anything.
   *
   * Called after a resize: reallocating the drawing buffer clears it, so the next
   * frame has to be drawn even though the camera did not move. Without this the
   * canvas stays blank until the user happens to rotate something.
   */
  invalidate (): void {
    this.#dirty = true
  }

  /** Subscribes to changes. Returns an unsubscribe function. */
  onChange (fn: () => void): () => void {
    this.#changeListeners.add(fn)
    return () => { this.#changeListeners.delete(fn) }
  }

  #apply (lat: number, lng: number): void {
    const next = { povLatitude: clampLatitude(lat), povLongitude: wrapLongitude(lng) }
    if (next.povLatitude === this.#state.povLatitude && next.povLongitude === this.#state.povLongitude) {
      return
    }
    this.#state = next
    this.#dirty = true
    this.#notify()
  }

  #notify (): void {
    // Iterate a copy. A live Set tolerates removing the listener being visited,
    // but silently skips one still to come -- so a listener that detaches a
    // later-registered listener would drop that listener's notification for a
    // change it was still subscribed to at the time.
    for (const fn of [...this.#changeListeners]) fn()
  }
}
