import { describe, it, expect } from 'vitest'
import { ndcToSurface, project } from '../../src/core/reference'
import type { CameraState, Projection } from '../../src/core/types'

const state: CameraState = { povLatitude: 0, povLongitude: 0 }

/*
 * The transcribed formulas divide by zero at a handful of exactly-degenerate
 * points, and a faithful transcription must keep producing NaN there (the
 * legacy GPU computed atan(0.0 / 0.0) just the same; see the "faithful NaNs"
 * test). This predicate names those points so the finiteness and range sweeps
 * can step around them without silently weakening themselves: anything not
 * listed here that produces a NaN is a real bug and fails the sweep.
 */
function isDegenerate (kind: Projection['kind'], x: number, y: number, z: number): boolean {
  switch (kind) {
    case 'linear':
    case 'pannini':
      // atan(z / x) -- and, for pannini, atan(z * 0.5 / x) -- hits 0/0 exactly
      // when both operands are zero.
      return x === 0 && z === 0
    case 'planet':
      // atan(P / Q) hits 0/0 when y and z are both zero; the formula never
      // reads x.
      return y === 0 && z === 0
    case 'cylindrical':
      // Nothing it divides by can be zero.
      return false
  }
}

describe('homogeneity', () => {
  /*
   * This property is the entire justification for replacing the cube and the
   * quad with one fullscreen triangle. If the linear projection were not
   * scale-invariant, the size of the surface being rasterised would matter, and
   * the geometry subsystem could not be deleted.
   *
   * spec section 4.5: "a 12-triangle cube covering a 360 panorama still renders
   * correctly -- if the geometry had any resolution meaning, that would be
   * absurd."
   */
  const linear: Projection = { kind: 'linear', fov: 1, aspect: 1 }

  it('the linear projection ignores the magnitude of its input', () => {
    const base = project(1, 0.3, 0.7, state, linear)
    for (const k of [0.001, 0.5, 2, 100, 1e6]) {
      const scaled = project(k * 1, k * 0.3, k * 0.7, state, linear)
      expect(scaled.u, `u at k=${k}`).toBeCloseTo(base.u, 10)
      expect(scaled.v, `v at k=${k}`).toBeCloseTo(base.v, 10)
    }
  })

  const nonLinear: Array<[string, Projection]> = [
    ['cylindrical', { kind: 'cylindrical', zoom: 1, extent: [1, 1] }],
    ['planet', { kind: 'planet', zoom: 1, extent: [4, 4] }],
    ['pannini', { kind: 'pannini', zoom: 1, extent: [4, 4] }]
  ]

  it.each(nonLinear)('the %s projection does NOT ignore magnitude', (_name, projection) => {
    // The counter-test to the one above, with x pinned to 1 -- scaling all
    // three coordinates would not do, because pannini reads only ratios of its
    // input (z * 0.5 / x and y / sqrt(x*x + z*z)) and is invariant under
    // uniform scaling. Pinning x is also faithful to how extent enters these
    // formulas: ndcToSurface keeps x at 1 and scales (y, z) by
    // max(extent) / 2, so it is the (y, z) magnitude at fixed x that the
    // surface size controls. These projections read |z| and |y|, so the
    // surface size is a projection parameter -- which is why `extent` exists
    // in the Projection type instead of hiding in vertex coordinates.
    const base = project(1, 0.3, 0.7, state, projection)
    const scaled = project(1, 0.6, 1.4, state, projection)
    expect(scaled.u === base.u && scaled.v === base.v).toBe(false)
  })
})

describe('exact output pins', () => {
  /*
   * Everything else in this file asserts a property -- a range, a homogeneity,
   * a finiteness -- and a mutant that shifts every output by a constant can
   * survive all of them. These are exact literals instead. They were derived
   * by transcribing `legacy/shader/fshader.glsl` into a scratch script
   * (from the GLSL text, NOT from src/core/reference.ts -- expectations
   * generated from the code under test are an echo chamber that passes on any
   * transcription error) and then cross-checked against a second independent
   * transcription: the two agree to under 1e-15 on every literal below.
   */
  it('linear at x<0 applies the PI fixup after a plain atan', () => {
    // cam_proj_linear(-1, 0.3, 0.7): atan(0.7 / -1) is negative and the x<0
    // branch adds PI to land theta in the correct half. Linear reads neither
    // the camera angles nor zoom, so the projection record is inert here.
    const uv = project(-1, 0.3, 0.7, state, { kind: 'linear', fov: 1, aspect: 1 })
    expect(uv.u).toBeCloseTo(0.40279994389289264, 12)
    expect(uv.v).toBeCloseTo(0.5767104994935404, 12)
  })

  it('cylindrical scales z by zoom, subtracts the degree-mixed lng, and wraps negative', () => {
    // cam_proj_cylindrical(1, 0, 0.5) at povLongitude 350, zoom 1: theta is
    // 0.5 * TWO_PI - 350/4 = -84.358..., deeply negative, so u only lands in
    // [0, 1) through wrap01's negative branch -- the seam behaviour. phi is
    // atan(0) + HALF_PI = exactly PI/2, so v is exactly 0.5.
    const projection: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    const uv = project(1, 0, 0.5, { povLatitude: 0, povLongitude: 350 }, projection)
    expect(uv.u).toBeCloseTo(0.5739424794591574, 12)
    expect(uv.v).toBeCloseTo(0.5, 12)
  })

  it('cylindrical zoom scales z before the TWO_PI multiply', () => {
    // cam_proj_cylindrical(1, 0, 0.5) at povLongitude 350, zoom 0.5 -- 0.5
    // and not 2, because the legacy CylindricalCamera clamps its zoom to
    // [0.1, 1] (CylindricalCamera.js:69), so this is a reachable viewer
    // state where 2 is not (planet and pannini clamp to [0.1, 2], which is
    // why their zoom rows use 2). Halving the scaled z shifts theta by
    // exactly a quarter turn, so u lands a quarter of a turn below the
    // zoom-1 row's literal after the same negative wrap; v stays exactly 0.5.
    const projection: Projection = { kind: 'cylindrical', zoom: 0.5, extent: [1, 1] }
    const uv = project(1, 0, 0.5, { povLatitude: 0, povLongitude: 350 }, projection)
    expect(uv.u).toBeCloseTo(0.32394247945915744, 12)
    expect(uv.v).toBeCloseTo(0.5, 12)
  })

  it('planet negates z, takes the Q>0 && P<0 fixup, and subtracts lng in degrees', () => {
    // cam_proj_planet(1, 0.3, 0.7) at povLongitude 90, zoom 1: the negated z
    // makes P negative while y keeps Q positive -- the Q>0 && P<0 branch --
    // and theta then crosses zero through the -22.5 subtraction, exercising
    // the negative wrap as well.
    const projection: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
    const uv = project(1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(uv.u).toBeCloseTo(0.23345430963693303, 12)
    expect(uv.v).toBeCloseTo(0.41435639705845567, 12)
  })

  it('planet zoom moves v through m and leaves u untouched through P/Q', () => {
    // Same input at zoom 2. P/Q is a ratio of zoom-scaled values, so theta --
    // and therefore u -- is invariant, asserted against the SAME literal as
    // the zoom-1 row; R = (m - 2)/m reads m = 1 + (zoom^2)(y^2 + z^2), so v
    // moves. Dropping the zoom factor anywhere in this formula fails one of
    // the two assertions.
    const projection: Projection = { kind: 'planet', zoom: 2, extent: [4, 4] }
    const uv = project(1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(uv.u).toBeCloseTo(0.23345430963693303, 12)
    expect(uv.v).toBeCloseTo(0.6301534806039966, 12)
  })

  it('pannini applies the x<0 fixup AFTER doubling theta', () => {
    // cam_proj_pannini(-1, 0.3, 0.7) at povLongitude 90, zoom 1: theta is
    // 2 * atan(-0.35) = -0.673... first, and only then does the x<0 branch
    // add PI. This is the row an atan2 "simplification" gets wrong: atan2
    // yields a different angle before the doubling, and the fixup then lands
    // in another quadrant -- exactly the trap the module header warns about.
    const projection: Projection = { kind: 'pannini', zoom: 1, extent: [4, 4] }
    const uv = project(-1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(uv.u).toBeCloseTo(0.8118468569924171, 12)
    expect(uv.v).toBeCloseTo(0.5767104994935404, 12)
  })

  it('pannini zoom enters both the doubled atan and phi', () => {
    // cam_proj_pannini(1, 0.3, 0.7) at povLongitude 90, zoom 2: z scales to
    // 1.4, so theta = 2 * atan(0.7) with no fixup (x>0, z>0), and phi reads
    // the scaled y against sqrt(x^2 + z^2) with the scaled z. Both halves of
    // the formula see the zoom, so dropping it fails either assertion.
    const projection: Projection = { kind: 'pannini', zoom: 2, extent: [4, 4] }
    const uv = project(1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(uv.u).toBeCloseTo(0.6134138926465695, 12)
    expect(uv.v).toBeCloseTo(0.6068103096969111, 12)
  })
})

describe('output range', () => {
  const projections: Projection[] = [
    { kind: 'linear', fov: 1, aspect: 1 },
    { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
    { kind: 'planet', zoom: 1, extent: [4, 4] },
    { kind: 'pannini', zoom: 1, extent: [4, 4] }
  ]

  it.each(projections.map((p) => [String(p.kind), p] as const))(
    'projection %s stays inside [0, 1] across the surface',
    (_name, projection) => {
      const lngs = [0, 90, 179, 181, 270, 359]
      for (const povLongitude of lngs) {
        for (let ndcY = -1; ndcY <= 1; ndcY += 0.25) {
          for (let ndcX = -1; ndcX <= 1; ndcX += 0.25) {
            // The exactly-degenerate points (see isDegenerate) are the one
            // place on the sweep where the legacy formula legitimately
            // produces NaN; they are pinned as faithful in their own test
            // below rather than folded into a range assertion they cannot
            // satisfy.
            if (isDegenerate(projection.kind, 1, ndcY, ndcX)) continue
            const uv = project(1, ndcY, ndcX, { povLatitude: 0, povLongitude }, projection)
            expect(uv.u, `u at lng=${povLongitude} ndc=(${ndcX},${ndcY})`).toBeGreaterThanOrEqual(0)
            expect(uv.u).toBeLessThanOrEqual(1)
            expect(uv.v, `v at lng=${povLongitude} ndc=(${ndcX},${ndcY})`).toBeGreaterThanOrEqual(0)
            expect(uv.v).toBeLessThanOrEqual(1)
          }
        }
      }
    }
  )

  it('produces no NaN anywhere on the surface', () => {
    // A NaN UV samples garbage and shows up as a black or smeared region with
    // no error message. Sweeping the whole surface is cheap and catches it.
    const projections: Projection[] = [
      { kind: 'linear', fov: 1, aspect: 1 },
      { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
      { kind: 'planet', zoom: 1, extent: [4, 4] },
      { kind: 'pannini', zoom: 1, extent: [4, 4] }
    ]
    for (const projection of projections) {
      for (let y = -1; y <= 1; y += 0.125) {
        for (let x = -1; x <= 1; x += 0.125) {
          for (const [sx, sy, sz] of [[1, y, x], [0, y, x], [1, y, 0], [-1, 1e-9, 1e9]]) {
            if (isDegenerate(projection.kind, sx!, sy!, sz!)) continue
            const uv = project(sx!, sy!, sz!, state, projection)
            expect(Number.isFinite(uv.u), `u for kind ${projection.kind}`).toBe(true)
            expect(Number.isFinite(uv.v), `v for kind ${projection.kind}`).toBe(true)
          }
        }
      }
    }
  })

  it('keeps the NaNs the legacy shader produced at the degenerate points', () => {
    // v0.2.2's fragment shader computed atan(0.0 / 0.0) at exactly these
    // inputs, and so does this transcription -- the rasteriser essentially
    // never lands a fragment exactly on the quad's centre lines, so nobody saw
    // the single NaN texel, but the formula is the formula. Normalising the
    // NaN away here would be a silent spec change: gate B compares against
    // this module, not against an idealised sphere.
    const planet: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
    // The planet centre is the one degenerate point that lies ON the surface
    // itself (x is never read, so the x = 1 plane does not save it).
    expect(project(1, 0, 0, state, planet).u).toBeNaN()

    // The zero vector never arises from ndcToSurface, which pins x to 1; these
    // are pinned only to keep the transcription honest about its own domain.
    const linear: Projection = { kind: 'linear', fov: 1, aspect: 1 }
    expect(project(0, 0, 0, state, linear).u).toBeNaN()
    const pannini: Projection = { kind: 'pannini', zoom: 1, extent: [4, 4] }
    expect(project(0, 0, 0, state, pannini).u).toBeNaN()

    // Cylindrical divides by nothing that can be zero, even at the origin.
    const cylindrical: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    expect(project(0, 0, 0, state, cylindrical).u).toBe(0)
  })

  it('is finite just off the degenerate set, and the predicate skips only the degenerate points', () => {
    // Guard for isDegenerate's exactness, asserted OUTSIDE the sweep skip
    // logic: these are the points adjacent to the degenerate set -- on the
    // y=0 and z=0 lines but off the centre for planet, in the x=0 plane but
    // off the y axis for linear and pannini. atan of +-Infinity is a
    // perfectly good angle, so they are finite; and isDegenerate must return
    // false for them, or a widened predicate (say, planet's y === 0) would
    // silently hide those lines from the sweeps above while nothing failed.
    const adjacent: Array<[Projection, number, number, number]> = [
      [{ kind: 'planet', zoom: 1, extent: [4, 4] }, 1, 0, 0.25],
      [{ kind: 'planet', zoom: 1, extent: [4, 4] }, 1, 0.25, 0],
      [{ kind: 'linear', fov: 1, aspect: 1 }, 0, 0.3, 0.7],
      [{ kind: 'pannini', zoom: 1, extent: [4, 4] }, 0, 0.3, 0.7]
    ]
    for (const [projection, x, y, z] of adjacent) {
      const uv = project(x, y, z, state, projection)
      expect(Number.isFinite(uv.u), `${projection.kind} (${x}, ${y}, ${z}) u`).toBe(true)
      expect(Number.isFinite(uv.v), `${projection.kind} (${x}, ${y}, ${z}) v`).toBe(true)
      expect(isDegenerate(projection.kind, x, y, z), `${projection.kind} (${x}, ${y}, ${z})`).toBe(false)
    }
  })
})

describe('ndcToSurface', () => {
  // Direct pins, beyond the property tests above: this mapping is the
  // protagonist of gate B, and the property tests never call it.
  it('maps the device square onto the x = 1 plane at half the largest extent', () => {
    // extent [4, 4] -> m = 2, so the corners of the device square land on the
    // corners of the legacy quad. This is the same correspondence the matrix
    // tests pin from the other side: ndc(±1, ±1) <-> (1, ±2, ±2).
    expect(ndcToSurface(1, 1, [4, 4])).toEqual([1, 2, 2])
    expect(ndcToSurface(-1, 1, [4, 4])).toEqual([1, 2, -2])
    expect(ndcToSurface(1, -1, [4, 4])).toEqual([1, -2, 2])
    expect(ndcToSurface(-1, -1, [4, 4])).toEqual([1, -2, -2])
    // An interior point, so the mapping is pinned between the corners too.
    expect(ndcToSurface(0.5, -1, [4, 4])).toEqual([1, -2, 1])
  })

  it('uses max(extent) / 2 on both axes for an asymmetric extent', () => {
    // The same asymmetric inputs as the matrix tests, in both orders: max = 6
    // either way, so m = 3 drives both axes. A per-axis or width-driven
    // sizing produces a different number somewhere in this pair.
    expect(ndcToSurface(0.5, -0.5, [2, 6])).toEqual([1, -1.5, 1.5])
    expect(ndcToSurface(0.5, -0.5, [6, 2])).toEqual([1, -1.5, 1.5])
  })
})

describe('glslMod', () => {
  it('is exercised through a negative angle', () => {
    // The wrap at the antimeridian. JavaScript's % returns a negative value
    // here and GLSL's mod does not; getting this wrong puts a seam in the
    // panorama that only appears at some longitudes.
    const projection: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    const uv = project(1, 0, 0.5, { povLatitude: 0, povLongitude: 350 }, projection)
    expect(uv.u).toBeGreaterThanOrEqual(0)
    expect(uv.u).toBeLessThanOrEqual(1)
  })
})

describe('latitude on the non-linear cameras (the F5 fix)', () => {
  /*
   * Derived, not observed: each non-linear phi is `... + HALF_PI - latRad`, and
   * v is phi / PI, so raising povLatitude from 0 to 30 must shift v by exactly
   * -(30 * PI / 180) / PI = -1/6 and leave theta -- therefore u -- untouched.
   * The size of the shift also pins the units: subtracting the raw degrees
   * instead of the radians would move v by -30/PI, and folding latitude into
   * theta would move u instead of v.
   */
  const nonLinear: Array<[string, Projection]> = [
    ['cylindrical', { kind: 'cylindrical', zoom: 1, extent: [1, 1] }],
    ['planet', { kind: 'planet', zoom: 1, extent: [4, 4] }],
    ['pannini', { kind: 'pannini', zoom: 1, extent: [4, 4] }]
  ]

  it.each(nonLinear)(
    '%s shifts v by exactly -latRad / PI when povLatitude goes 0 -> 30',
    (_name, projection) => {
      const latRad = (30 * Math.PI) / 180
      const a = project(1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
      const b = project(1, 0.3, 0.7, { povLatitude: 30, povLongitude: 90 }, projection)
      expect(b.v - a.v).toBeCloseTo(-latRad / Math.PI, 12)
      // theta has no latitude term, and identical inputs compute identical
      // bits, so u is not merely close -- it is the same number.
      expect(b.u).toBe(a.u)
    }
  )

  it('linear output is unchanged by povLatitude', () => {
    // Linear latitude lives in buildViewMatrix, not in project: the reference
    // formula itself must not read the angle. All four numbers are pinned so a
    // term that leaks latitude into either coordinate fails loudly.
    const projection: Projection = { kind: 'linear', fov: 1, aspect: 1 }
    const a = project(1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    const b = project(1, 0.3, 0.7, { povLatitude: 45, povLongitude: 90 }, projection)
    expect(b.u).toBe(a.u)
    expect(b.v).toBe(a.v)
  })
})
