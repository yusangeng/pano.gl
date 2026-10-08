import { describe, it, expect } from 'vitest'
import { resolveExtent } from '../../src/core/extent'
import type { NonLinearProjection } from '../../src/core/extent'
import type { Projection } from '../../src/core/types'

/*
 * Every literal below was derived independently (scratch transcription of the
 * WGSL formulas plus the spec 1.2 rate table), not by running resolveExtent:
 * expectations generated from the code under test are an echo chamber that
 * passes on any wrong rate constant.
 */
describe('resolveExtent', () => {
  it('derives the container-fit height from the per-camera rate (spec 1.2)', () => {
    // cylindrical: rate 2pi -- theta = z * 2pi against phi = atan(y), slope 1
    // at the centre, so the paper needs 2pi times the height per unit width.
    const cylindrical: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    expect(resolveExtent(cylindrical, 1)).toEqual([1, 6.283185307179586])
    expect(resolveExtent(cylindrical, 16 / 9)[1]).toBeCloseTo(3.5342917352885173, 12)
    expect(resolveExtent(cylindrical, 9 / 16)[1]).toBeCloseTo(11.170107212763709, 12)
    // The width is never touched: it is the zoom/extent[0] calibration knob.
    expect(resolveExtent(cylindrical, 9 / 16)[0]).toBe(1)

    // mercator / pannini / planet: rate 1 (conformal or centre-isotropic).
    const mercator: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1] }
    expect(resolveExtent(mercator, 16 / 9)).toEqual([1, 0.5625])
    expect(resolveExtent(mercator, 9 / 16)).toEqual([1, 1.7777777777777777])
    // I4: at a square viewport mercator keeps exactly the EPSG:3857 paper.
    expect(resolveExtent(mercator, 1)).toEqual([1, 1])

    const pannini: Projection = { kind: 'pannini', zoom: 1, extent: [4, 4] }
    expect(resolveExtent(pannini, 16 / 9)).toEqual([4, 2.25])
    expect(resolveExtent(pannini, 9 / 16)).toEqual([4, 7.111111111111111])

    const planet: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
    expect(resolveExtent(planet, 16 / 9)).toEqual([4, 2.25])
    expect(resolveExtent(planet, 9 / 16)).toEqual([4, 7.111111111111111])
  })

  it("fit 'extent' takes the tuple literally, at any viewport (spec 1.4, I6)", () => {
    const anamorphic: Projection = { kind: 'pannini', zoom: 1, extent: [4, 2], fit: 'extent' }
    expect(resolveExtent(anamorphic, 1)).toEqual([4, 2])
    expect(resolveExtent(anamorphic, 16 / 9)).toEqual([4, 2])
    expect(resolveExtent(anamorphic, 9 / 16)).toEqual([4, 2])
  })

  it('a fit value that is not the literal "extent" reads as container', () => {
    // Runtime-lenient on purpose, mirroring the unknown-kind handling: the
    // union is the set of legal values, and anything else degrades to the
    // default rather than throwing mid-frame.
    const typo = { kind: 'mercator', zoom: 1, extent: [1, 1], fit: 'contain' } as unknown as NonLinearProjection
    expect(resolveExtent(typo, 2)).toEqual([1, 0.5])
    // The spelled-out default deserves its own leg, not only the typo case:
    // 'container' by name must resolve identically to the degradation.
    const named: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1], fit: 'container' }
    expect(resolveExtent(named, 2)).toEqual([1, 0.5])
  })

  it('rejects a non-positive or non-finite aspect', () => {
    const projection: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1] }
    expect(() => resolveExtent(projection, 0)).toThrow(/greater than 0/i)
    expect(() => resolveExtent(projection, -1)).toThrow(/greater than 0/i)
    expect(() => resolveExtent(projection, NaN)).toThrow(/greater than 0/i)
    // The guard fires in manual mode too: the aspect is the surface's shape,
    // invalid whatever the framing mode -- same ruling as setAspect's order.
    const manual: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1], fit: 'extent' }
    expect(() => resolveExtent(manual, 0)).toThrow(/greater than 0/i)
  })
})
