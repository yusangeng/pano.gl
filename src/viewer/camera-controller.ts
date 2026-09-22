/**
 * The single owner of camera state.
 *
 * The matrix maths is stateless and lives in `core/matrix.ts`. What is here is
 * everything that needs memory: clamping on assignment, the relative semantics
 * of rotate and zoom, and the dirty flag.
 *
 * The dirty flag is why a static image renders once instead of sixty times a
 * second. The legacy FrameDriver redrew unconditionally on every rAF tick,
 * which is a full-screen fragment shader running forever for a picture that
 * has not changed.
 *
 * Nothing here recomputes a projection formula. The CPU-side authority for those
 * is `core/reference.ts` (`project` / `ndcToSurface`), which exists so that a
 * test can predict what the shader will do; duplicating a formula here would
 * create a second opinion about it.
 */

import type { CameraState, Projection } from '../core/types'
import { clampLatitude, wrapLongitude, assertFinite, assertPositive } from '../core/validate'

/**
 * The camera a viewer starts with when the caller does not name one.
 *
 * The legacy value: `CameraFactory.defaultDataMap.perspective` was
 * `{ fov: 70, aspect: 1 }`, in degrees because cuon's `mat4.perspective` took
 * degrees. `Projection.fov` is in radians (P2's `legacyFovFrom` inverts the
 * degree-based matrix, which is what proves it), so 70 degrees is converted here
 * once rather than at every call site.
 *
 * `aspect` is a placeholder: the viewer overwrites it with the surface's real
 * aspect on the first resize, which happens during construction. It cannot be
 * known before a container exists, and 1 is the value that is wrong in the least
 * visible way if a frame somehow got drawn first.
 */
export const DEFAULT_PROJECTION: Projection = {
  kind: 'linear',
  fov: (70 * Math.PI) / 180,
  aspect: 1
}

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
   * consumer, and a flag that had to be cleared by hand is exactly the kind of
   * state that goes wrong. The legacy `needUpdate_` latch was cleared in one
   * place and set in three.
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

  /** Changes the zoom of the current projection. No-op for the linear one. */
  zoom (delta: number): void {
    assertFinite(delta, 'zoom delta')
    if (delta === 0) return
    if (this.#projection.kind === 'linear') return
    const next = Math.min(1, Math.max(0.01, this.#projection.zoom * (1 + delta)))
    // The clamp can land back on the value already held -- a wheel held at the
    // limit, or a delta below the float64 epsilon, where `zoom * (1 + delta)`
    // rounds to `zoom` itself. Both are the no-redraw case `#apply` and
    // `setAspect` already guard, and without it a wheel pinned at the ceiling
    // costs a full-screen redraw and a subscriber wake per event.
    if (next === this.#projection.zoom) return
    this.#projection = { ...this.#projection, zoom: next }
    this.#dirty = true
    this.#notify()
  }

  /**
   * Replaces the projection, keeping the pose.
   *
   * The legacy `cameraOptions` setter rebuilt the whole camera, which reset the
   * pose to the origin -- so changing the projection silently threw away where
   * the user was looking.
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
   * 16:9 container with the default square aspect stretches the image. The other
   * three cameras take their shape from the quad's extent, which the shader reads
   * (P2's `LEGACY_EXTENT`), so they have no aspect field to write and are left
   * untouched rather than given one nothing consumes.
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
