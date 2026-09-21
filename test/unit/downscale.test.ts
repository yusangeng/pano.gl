import { describe, it, expect } from 'vitest'
import { planDownscale } from '../../src/media/downscale'

describe('planDownscale', () => {
  it('passes a source that fits straight through', () => {
    expect(planDownscale(1920, 1080, 8192)).toEqual({ scale: 1, width: 1920, height: 1080 })
  })

  it('scales down a source that exceeds the limit', () => {
    const plan = planDownscale(16384, 8192, 8192)
    expect(plan.width).toBeLessThanOrEqual(8192)
    expect(plan.height).toBeLessThanOrEqual(8192)
    expect(plan.scale).toBeLessThan(1)
  })

  it('preserves aspect ratio', () => {
    const plan = planDownscale(16384, 8192, 8192)
    expect(plan.width / plan.height).toBeCloseTo(2, 2)
  })

  it('does NOT quantise to powers of two', () => {
    // The legacy path required power-of-two sources because it used gl.RGB with
    // LINEAR filtering, no mipmaps and no CLAMP_TO_EDGE. WebGPU has no such
    // requirement, so rounding to 4096 here would throw away real resolution
    // for a constraint that no longer exists.
    const plan = planDownscale(10000, 5000, 8192)
    expect(plan.width).toBe(8192)
    expect(plan.height).toBe(4096)
  })

  it('never rounds a dimension down to zero', () => {
    // A 1-pixel-tall panorama is absurd but must not become a zero-sized
    // texture, which is a WebGPU validation error rather than a blank frame.
    const plan = planDownscale(16384, 1, 8192)
    expect(plan.height).toBeGreaterThanOrEqual(1)
    expect(plan.width).toBeGreaterThanOrEqual(1)
  })

  it('scales a source that is over on one axis only', () => {
    const plan = planDownscale(9000, 100, 8192)
    expect(plan.width).toBe(8192)
    expect(plan.height).toBe(91)
  })

  it('scales a source that is over on height only', () => {
    // The suite's other over-limit inputs are all landscape, so the height
    // comparison in the fits check and in Math.min was never the reason a test
    // passed. A portrait source is the case that catches it.
    const plan = planDownscale(5000, 10000, 8192)
    expect(plan.width).toBe(4096)
    expect(plan.height).toBe(8192)
    expect(plan.scale).toBe(8192 / 10000)
  })

  it('clamps when rounding would produce a zero dimension', () => {
    // (20000, 1): 1 * 0.4096 rounds to 0 -- Math.round(0.4096) is 0, not 1.
    // The 'never rounds down to zero' test's input (16384, 1) rounds to 1 by
    // luck of round-half-up at exactly 0.5, so the clamp itself was unexercised.
    expect(planDownscale(20000, 1, 8192).height).toBe(1)
    expect(planDownscale(1, 20000, 8192).width).toBe(1)
  })

  it('rounds rather than floors on the non-binding axis', () => {
    // The binding axis is exact by construction (w * (max / w) === max), so
    // round vs floor is only observable here. 5001 * 0.8192 = 4096.8192.
    expect(planDownscale(10000, 5001, 8192).height).toBe(4097)
  })

  it('rejects a zero-sized source rather than guessing', () => {
    // Video elements report 0x0 before metadata loads. Passing that through as
    // "fits, no scaling needed" produces a texture creation failure later,
    // far from the cause.
    expect(() => planDownscale(0, 0, 8192)).toThrow(RangeError)
    expect(() => planDownscale(0, 0, 8192)).toThrow(/zero/i)
    // One-sided: the guard is an OR, and only the both-zero case pinned it.
    expect(() => planDownscale(8192, 0, 8192)).toThrow(/zero/i)
  })
})
