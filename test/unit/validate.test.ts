import { describe, it, expect } from 'vitest'
import {
  clampLatitude, wrapLongitude, assertPositive, assertFinite
} from '../../src/core/validate'

describe('clampLatitude', () => {
  it('passes through values inside the poles', () => {
    expect(clampLatitude(0)).toBe(0)
    expect(clampLatitude(45.5)).toBe(45.5)
  })

  it('clamps exactly at the poles', () => {
    expect(clampLatitude(90)).toBe(90)
    expect(clampLatitude(-90)).toBe(-90)
  })

  it('clamps beyond the poles rather than wrapping', () => {
    // Latitude is the one angle that must not wrap: 100 degrees is not -80,
    // it is "as far up as you can go". The legacy code took whatever the caller
    // passed, which let a caller put the camera inside-out.
    expect(clampLatitude(100)).toBe(90)
    expect(clampLatitude(-100)).toBe(-90)
  })

  it('rejects a non-finite input', () => {
    expect(() => clampLatitude(NaN)).toThrow(/finite/i)
    expect(() => clampLatitude(Infinity)).toThrow(/finite/i)
  })
})

describe('wrapLongitude', () => {
  it('passes through values already in range', () => {
    expect(wrapLongitude(0)).toBe(0)
    expect(wrapLongitude(359)).toBe(359)
  })

  it('wraps past 360 back to zero', () => {
    expect(wrapLongitude(360)).toBe(0)
    expect(wrapLongitude(450)).toBe(90)
  })

  it('wraps negatives up into the range', () => {
    expect(wrapLongitude(-90)).toBe(270)
    expect(wrapLongitude(-450)).toBe(270)
  })

  it('normalises a value that is already an exact multiple of 360 to zero, not 360', () => {
    // The modular guard in the legacy non-linear cameras did `long % 25` and
    // the linear path wrapped into [0, 360). A result of 360 instead of 0 looks
    // identical on screen but breaks equality checks in tests and in any
    // consumer that diffs camera state.
    expect(wrapLongitude(720)).toBe(0)
    expect(wrapLongitude(-360)).toBe(0)
  })

  it('rejects a non-finite input', () => {
    expect(() => wrapLongitude(NaN)).toThrow(/finite/i)
  })
})

describe('assertPositive', () => {
  it('returns the value when it is greater than zero', () => {
    expect(assertPositive(1, 'zoom')).toBe(1)
    expect(assertPositive(0.001, 'zoom')).toBe(0.001)
  })

  it('throws on zero and on negatives, naming the argument', () => {
    expect(() => assertPositive(0, 'zoom')).toThrow(/zoom/)
    expect(() => assertPositive(-1, 'zoom')).toThrow(/zoom/)
  })

  it('throws on NaN', () => {
    expect(() => assertPositive(NaN, 'zoom')).toThrow(/zoom/)
  })
})

describe('assertFinite', () => {
  it('returns the value when finite', () => {
    expect(assertFinite(0, 'fov')).toBe(0)
    expect(assertFinite(-273.15, 'fov')).toBe(-273.15)
  })

  it('throws naming the argument on NaN and infinities', () => {
    expect(() => assertFinite(NaN, 'fov')).toThrow(/fov/)
    expect(() => assertFinite(Infinity, 'fov')).toThrow(/fov/)
    expect(() => assertFinite(-Infinity, 'fov')).toThrow(/fov/)
  })
})
