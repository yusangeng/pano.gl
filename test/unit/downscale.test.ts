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
    expect(plan.height).toBeGreaterThanOrEqual(1)
  })

  it('rejects a zero-sized source rather than guessing', () => {
    // Video elements report 0x0 before metadata loads. Passing that through as
    // "fits, no scaling needed" produces a texture creation failure later,
    // far from the cause.
    expect(() => planDownscale(0, 0, 8192)).toThrow(/zero/i)
  })
})
