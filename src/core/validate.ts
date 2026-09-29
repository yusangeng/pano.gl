/**
 * The range assertions that survived deleting `param-check`.
 *
 * "Is this a number" and "is this a Camera" are the type system's job. What
 * types cannot express is *range* -- and range is what actually breaks this
 * library, because out-of-range angles and zero-length vectors produce
 * matrices full of NaN, which render as a black screen with no error anywhere.
 *
 * Small on purpose. If you are tempted to add an `isArray`-style check here,
 * the type signature is wrong instead.
 */

/**
 * Clamps a latitude into `[-90, 90]` degrees.
 *
 * Latitude does not wrap. 100 degrees is not -80, it is "as far up as the
 * camera can go" -- wrapping would put the camera upside down, which is a
 * different picture, not a normalised one.
 *
 * @throws If `degrees` is not finite.
 */
export function clampLatitude (degrees: number): number {
  if (!Number.isFinite(degrees)) {
    throw new TypeError(`latitude must be finite, got ${degrees}`)
  }
  return Math.min(90, Math.max(-90, degrees))
}

/**
 * Normalises a longitude into `[0, 360)` degrees.
 *
 * The result is never exactly 360: `wrapLongitude(360)` is `0`. (The legacy
 * non-linear cameras wrapped `% 25` -- a different function with a different
 * range. There is one answer now.)
 *
 * @throws If `degrees` is not finite.
 */
export function wrapLongitude (degrees: number): number {
  if (!Number.isFinite(degrees)) {
    throw new TypeError(`longitude must be finite, got ${degrees}`)
  }
  return ((degrees % 360) + 360) % 360
}

/**
 * Asserts a value is strictly greater than zero and returns it.
 *
 * @param name - Argument name, used in the error message.
 * @throws If `value` is not finite or is not positive.
 */
export function assertPositive (value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a finite number greater than 0, got ${value}`)
  }
  return value
}

/**
 * Asserts a value is finite and returns it.
 *
 * @param name - Argument name, used in the error message.
 * @throws If `value` is NaN or infinite.
 */
export function assertFinite (value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite, got ${value}`)
  }
  return value
}
