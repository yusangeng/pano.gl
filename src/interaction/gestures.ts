/**
 * Turning raw input deltas into camera movements.
 *
 * Everything here is a pure function so it can be tested without a browser.
 * The legacy plugins mixed recognition with listener management and DOM state,
 * which is why none of their thresholds were testable and several were wrong
 * (a trackpad and a mouse wheel went through the same divisor).
 */

/** Wheel normalisation constants, exported so the tests can assert against them. */
export const WheelZoom = {
  /** One notch of a line-mode wheel. */
  LINES_PER_NOTCH: 3,
  /** Zoom step per notch. */
  STEP_PER_NOTCH: 0.3,
  /**
   * Pixels per notch. Trackpads report pixels and mice report lines; without
   * this conversion the same gesture is an order of magnitude apart between the
   * two devices.
   */
  PIXELS_PER_NOTCH: 100,
  /** Largest zoom change a single event may produce. */
  MAX_STEP: 1
} as const

/**
 * `WheelEvent.deltaMode` values.
 *
 * Restated rather than read off the global, because this module is pure and is
 * tested in Node -- where `WheelEvent` does not exist. The numbers are fixed by
 * the UI Events spec, and `InputController`'s integration test is what checks
 * that the real `WheelEvent` still agrees with them.
 */
export const WheelDeltaMode = {
  PIXEL: 0,
  LINE: 1,
  PAGE: 2
} as const

/** A wheel event's relevant fields. */
export interface WheelInput {
  readonly deltaY: number
  readonly deltaMode: number
}

/**
 * Converts a wheel event to a zoom delta.
 *
 * @returns A signed zoom step, clamped to +/- `WheelZoom.MAX_STEP`. Positive is
 *   zoom in.
 */
export function classifyWheel (input: WheelInput): number {
  if (input.deltaY === 0) return 0

  const notches = input.deltaMode === WheelDeltaMode.PIXEL
    ? input.deltaY / WheelZoom.PIXELS_PER_NOTCH
    : input.deltaY / WheelZoom.LINES_PER_NOTCH
  // Page mode reports whole pages, which is coarse enough to treat as lines.

  const step = -notches * WheelZoom.STEP_PER_NOTCH
  // Some drivers emit a deltaY in the thousands on a single flick. Without a
  // clamp, one event spins the panorama a full revolution.
  return Math.max(-WheelZoom.MAX_STEP, Math.min(WheelZoom.MAX_STEP, step))
}

/**
 * Converts a two-finger distance change to a zoom delta.
 *
 * @param previous - Previous pointer distance. Zero means the gesture just
 *   started, which yields no delta -- producing one is the classic "pinch snaps
 *   the zoom on the first move" bug.
 * @param current - Current pointer distance.
 */
export function classifyPinch (previous: number, current: number): number {
  if (previous <= 0 || current <= 0) return 0
  // A ratio, not a difference: 100->200 px must feel identical to 200->400.
  const ratio = Math.log(current / previous)
  return Math.max(-WheelZoom.MAX_STEP, Math.min(WheelZoom.MAX_STEP, ratio))
}

/** A drag gesture in CSS pixels. */
export interface DragInput {
  readonly deltaX: number
  readonly deltaY: number
}

/** The surface the drag happened on, in CSS pixels. */
export interface SurfaceSize {
  readonly width: number
  readonly height: number
}

/**
 * Converts a drag to a camera rotation in degrees.
 *
 * The sign is inverted throughout: the scene follows the finger, so dragging
 * right turns the camera left. This is a coin flip every time it is
 * reimplemented, hence the test.
 *
 * @returns `{ lat, lng }` in degrees. Both are zero for a zero-sized surface,
 *   which happens for real when the container is `display: none` -- dividing by
 *   zero there produces an infinite angle, then a NaN matrix, then a black
 *   frame with no error reported anywhere.
 */
export function classifyDrag (delta: DragInput, surface: SurfaceSize): { lat: number, lng: number } {
  if (surface.width <= 0 || surface.height <= 0) return { lat: 0, lng: 0 }
  return {
    lng: -(delta.deltaX / surface.width) * 360,
    lat: -(delta.deltaY / surface.height) * 180
  }
}
