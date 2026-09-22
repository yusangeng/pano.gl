import { describe, it, expect } from 'vitest'
import { classifyWheel, classifyPinch, classifyDrag, WheelZoom, WheelDeltaMode } from '../../src/interaction/gestures'

describe('classifyWheel', () => {
  it('maps a line-mode wheel delta to a zoom step', () => {
    expect(classifyWheel({ deltaY: -3, deltaMode: WheelDeltaMode.LINE })).toBeCloseTo(0.3, 5)
  })

  it('normalises pixel-mode deltas, which are an order of magnitude larger', () => {
    // A trackpad reports pixels and a mouse wheel reports lines. Feeding both
    // through the same divisor makes one of them unusable: this is why the
    // legacy zoom was violent on a trackpad and sluggish on a mouse.
    const pixel = classifyWheel({ deltaY: -100, deltaMode: WheelDeltaMode.PIXEL })
    const line = classifyWheel({ deltaY: -3, deltaMode: WheelDeltaMode.LINE })
    expect(Math.sign(pixel)).toBe(Math.sign(line))
    expect(Math.abs(pixel / line)).toBeLessThan(3)
  })

  it('treats page-mode deltas as lines', () => {
    expect(classifyWheel({ deltaY: -3, deltaMode: WheelDeltaMode.PAGE }))
      .toBeCloseTo(0.3, 5)
  })

  it('is antisymmetric', () => {
    const down = classifyWheel({ deltaY: 100, deltaMode: WheelDeltaMode.PIXEL })
    const up = classifyWheel({ deltaY: -100, deltaMode: WheelDeltaMode.PIXEL })
    expect(down).toBeCloseTo(-up, 6)
  })

  it('returns zero for a zero delta', () => {
    expect(classifyWheel({ deltaY: 0, deltaMode: WheelDeltaMode.PIXEL })).toBe(0)
  })

  it('clamps an absurd single-event delta', () => {
    // Some drivers emit a single deltaY of several thousand on a flick. Without
    // a clamp the panorama jumps a full revolution.
    const huge = classifyWheel({ deltaY: -100000, deltaMode: WheelDeltaMode.PIXEL })
    expect(Math.abs(huge)).toBeLessThanOrEqual(WheelZoom.MAX_STEP)
  })

  it('clamps an absurd delta in both directions', () => {
    // Both sides: a mutant keeping only one half of the clamp survives a
    // one-sided assertion, and the hardcoded 1 is what pins MAX_STEP itself.
    expect(classifyWheel({ deltaY: -100000, deltaMode: WheelDeltaMode.PIXEL })).toBeCloseTo(1, 5)
    expect(classifyWheel({ deltaY: 100000, deltaMode: WheelDeltaMode.PIXEL })).toBeCloseTo(-1, 5)
  })
})

describe('classifyPinch', () => {
  it('reports no zoom for an unchanged distance', () => {
    expect(classifyPinch(100, 100)).toBe(0)
  })

  it('zooms in when fingers separate', () => {
    expect(classifyPinch(100, 200)).toBeGreaterThan(0)
  })

  it('zooms out when fingers converge', () => {
    expect(classifyPinch(200, 100)).toBeLessThan(0)
  })

  it('is antisymmetric in log space', () => {
    // Antisymmetry pins the sign only -- a subtractive measure is antisymmetric
    // too, which is why scale invariance gets its own test below.
    expect(classifyPinch(100, 200)).toBeCloseTo(-classifyPinch(200, 100), 6)
  })

  it('is a log ratio, not a difference', () => {
    // 100->200 must equal 200->400: a subtractive measure gives 100 vs 200.
    expect(classifyPinch(100, 200)).toBeCloseTo(Math.log(2), 5)
    expect(classifyPinch(100, 200)).toBeCloseTo(classifyPinch(200, 400), 5)
  })

  it('ignores the first move of a gesture', () => {
    // previous = 0 means the second finger has just landed. Producing a jump
    // here is the classic "pinch snaps the zoom" bug.
    expect(classifyPinch(0, 150)).toBe(0)
  })

  it('reports no zoom when the fingers coincide', () => {
    // Two fingers on the same spot are a real gesture, not log(0) = -Infinity
    // snapping to a full zoom-out.
    expect(classifyPinch(100, 0)).toBe(0)
  })

  it('clamps an extreme pinch to the max step', () => {
    // log(1000) is about 6.9. The hardcoded 1 is deliberate: asserting against
    // WheelZoom.MAX_STEP would let a mutated constant satisfy its own mutant.
    expect(classifyPinch(1, 1000)).toBe(1)
  })
})

describe('classifyDrag', () => {
  it('converts a pixel delta to surface degrees', () => {
    const d = classifyDrag({ deltaX: 100, deltaY: 50 }, { width: 1000, height: 500 })
    expect(d.lng).toBeCloseTo(-36, 5)
    expect(d.lat).toBeCloseTo(-18, 5)
  })

  it('reverses the sign of the drag, because the scene moves with the finger', () => {
    // Dragging right must turn the camera left. Getting this backwards makes
    // the panorama feel like it is fighting the user, and it is a coin flip
    // every time it is reimplemented.
    const d = classifyDrag({ deltaX: 100, deltaY: 0 }, { width: 1000, height: 500 })
    expect(d.lng).toBeLessThan(0)
  })

  it('returns zero for a zero-size surface instead of dividing by zero', () => {
    // Happens for real: a viewer constructed into a display:none container has
    // width 0, and 100/0 is Infinity, which becomes a NaN matrix and a black
    // frame with no error anywhere.
    expect(classifyDrag({ deltaX: 10, deltaY: 10 }, { width: 0, height: 0 }))
      .toEqual({ lat: 0, lng: 0 })
  })

  it('scales with surface size, so the same drag is the same visual angle', () => {
    const small = classifyDrag({ deltaX: 100, deltaY: 0 }, { width: 500, height: 500 })
    const large = classifyDrag({ deltaX: 100, deltaY: 0 }, { width: 1000, height: 500 })
    expect(Math.abs(small.lng)).toBeCloseTo(Math.abs(large.lng) * 2, 5)
  })
})
