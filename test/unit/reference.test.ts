import { describe, it, expect } from 'vitest'
import { ndcToSurface, project } from '../../src/core/reference'
import type { CameraState, Projection } from '../../src/core/types'

const state: CameraState = { povLatitude: 0, povLongitude: 0 }

/*
 * The transcribed formulas divide by zero at a handful of exactly-degenerate
 * points, and a faithful transcription must keep producing NaN there (the
 * legacy GPU computed atan(0.0 / 0.0) just the same; see the "faithful NaNs"
 * test). Planet left that class on 2026-09-28: the planet-review-followups
 * spec, section 2.2, adjudicated a canonical value at its Mobius branch
 * points, so projectPlanet is finite everywhere and its case below returns
 * false. This predicate names the remaining points so the finiteness and
 * range sweeps can step around them without silently weakening themselves:
 * anything not listed here that produces a NaN is a real bug and fails the
 * sweep.
 */
function isDegenerate (kind: Projection['kind'], x: number, y: number, z: number): boolean {
  switch (kind) {
    case 'linear':
    case 'pannini':
      // atan(z / x) -- and, for pannini, atan(z * 0.5 / x) -- hits 0/0 exactly
      // when both operands are zero.
      return x === 0 && z === 0
    case 'planet':
      // The Mobius branch points (p = q = 0, including y = z = 0 at lat 0)
      // take a canonical value since 2026-09-28, so nothing here is
      // degenerate any more -- the sweeps below now cover (0, 0) too.
      return false
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

  it('cylindrical scales z by zoom, subtracts the honestly-converted lng, and wraps negative', () => {
    // cam_proj_cylindrical(1, 0, 0.5) at povLongitude 350, zoom 1: theta is
    // 0.5 * TWO_PI - 350 honestly converted = PI * (1/2 - 35/18) =
    // -17/18 PI, deeply negative, so u only lands in [0, 1) through
    // wrap01's negative branch -- the seam behaviour -- at exactly 19/36.
    // phi is atan(0) + HALF_PI = exactly PI/2, so v is exactly 0.5.
    const projection: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    const uv = project(1, 0, 0.5, { povLatitude: 0, povLongitude: 350 }, projection)
    expect(uv.u).toBeCloseTo(0.52777777777777790, 12)
    expect(uv.v).toBeCloseTo(0.5, 12)
  })

  it('cylindrical zoom scales z before the TWO_PI multiply', () => {
    // cam_proj_cylindrical(1, 0, 0.5) at povLongitude 350, zoom 0.5 -- 0.5
    // and not 2, because the legacy CylindricalCamera clamps its zoom to
    // [0.1, 1] (CylindricalCamera.js:69), so this is a reachable viewer
    // state where 2 is not (planet and pannini clamp to [0.1, 2], which is
    // why their zoom rows use 2). Halving the scaled z shifts theta by
    // exactly a quarter turn, so u lands a quarter of a turn below the
    // zoom-1 row's literal after the same negative wrap (0.25 - 350/360 =
    // -13/18, wrapped to 5/18); v stays exactly 0.5.
    const projection: Projection = { kind: 'cylindrical', zoom: 0.5, extent: [1, 1] }
    const uv = project(1, 0, 0.5, { povLatitude: 0, povLongitude: 350 }, projection)
    expect(uv.u).toBeCloseTo(0.27777777777777790, 12)
    expect(uv.v).toBeCloseTo(0.5, 12)
  })

  it('planet negates z, takes the Q>0 && P<0 fixup, and subtracts the converted lng', () => {
    // cam_proj_planet(1, 0.3, 0.7) at povLongitude 90, zoom 1: the negated z
    // makes P negative while y keeps Q positive -- the Q>0 && P<0 branch --
    // and the converted lng subtracts PI/2 from theta (about 5.117), which
    // stays positive, so u lands inside [0, 1) at 0.5644 with no wrap.
    const projection: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
    const uv = project(1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(uv.u).toBeCloseTo(0.56444052920457832, 12)
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
    expect(uv.u).toBeCloseTo(0.56444052920457832, 12)
    expect(uv.v).toBeCloseTo(0.6301534806039966, 12)
  })

  it('pannini applies the x<0 fixup AFTER doubling theta', () => {
    // cam_proj_pannini(-1, 0.3, 0.7) at povLongitude 90, zoom 1: theta is
    // 2 * atan(-0.35) = -0.673... first, and only then does the x<0 branch
    // add PI and the converted lng subtract PI/2 -- net PI/2 - 0.673 =
    // 0.897..., so u is 0.897... / TWO_PI = 0.1428... with no wrap. This is
    // the row an atan2 "simplification" gets wrong: atan2 yields a different
    // angle before the doubling, and the fixup then lands in another
    // quadrant -- exactly the trap the module header warns about.
    const projection: Projection = { kind: 'pannini', zoom: 1, extent: [4, 4] }
    const uv = project(-1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(uv.u).toBeCloseTo(0.14283307656006256, 12)
    expect(uv.v).toBeCloseTo(0.5767104994935404, 12)
  })

  it('pannini zoom enters both the doubled atan and phi', () => {
    // cam_proj_pannini(1, 0.3, 0.7) at povLongitude 90, zoom 2: z scales to
    // 1.4, so theta = 2 * atan(0.7) = 1.221... with no fixup (x>0, z>0),
    // and the converted lng subtracts PI/2, leaving theta at -0.349... --
    // u = 1 - 0.349... / TWO_PI = 0.944... through the negative wrap -- and
    // phi reads the scaled y against sqrt(x^2 + z^2) with the scaled z. Both
    // halves of the formula see the zoom, so dropping it fails either
    // assertion.
    const projection: Projection = { kind: 'pannini', zoom: 2, extent: [4, 4] }
    const uv = project(1, 0.3, 0.7, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(uv.u).toBeCloseTo(0.94440011221421483, 12)
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
    //
    // Planet's centre pixel left this class on 2026-09-28, by adjudication
    // rather than silently: the planet-review-followups spec, section 2.2,
    // defines the canonical value and pins it in the planet-tilt describe.
    //
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
   *
   * Planet left this table on 2026-09-28: its latitude is no longer a phi
   * offset but the tilt of a Mobius pre-transform -- see the planet-tilt
   * describe below.
   */
  const nonLinear: Array<[string, Projection]> = [
    ['cylindrical', { kind: 'cylindrical', zoom: 1, extent: [1, 1] }],
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

describe('planet tilt (the steerable centre, 2026-09-28 spec)', () => {
  /*
   * The planet latitude is a sphere rotation: the Mobius pre-transform of
   * projectPlanet rolls the source point at polar angle |lat| to the screen
   * centre, so the centre displays the pose (povLatitude, povLongitude).
   * The four blocks pin the spec's invariants I1-I4 in order; the fifth pins
   * the transform's values away from the centre (review I-1); the sixth pins
   * the Mobius pole the other blocks deliberately sample around (CR round 1,
   * testing specialist); the seventh pins the canonical branch-point value
   * (planet-review-followups spec 2.2); the eighth witnesses the f32 floored
   * arithmetic the shaders actually run (CR round 2, red team).
   */
  const projection: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
  const wrap = (x: number): number => {
    const w = x % 1
    return w < 0 ? w + 1 : w
  }

  it('is bit-identical to the legacy closed form at lat = 0 (I1)', () => {
    // A verbatim copy of the pre-tilt formula. The tilt must be the identity
    // here term for term, which is gate A's unit-level precondition. Points
    // stay off the zz = 0 and yy = 0 axes so a signed-zero difference cannot
    // masquerade as (or hide) a real one.
    const legacy = (y: number, z: number, lng: number) => {
      const yy = y
      const zz = -z
      const m = 1 + zz * zz + yy * yy
      const p = (2 * zz) / m
      const q = (2 * yy) / m
      const r = (m - 2) / m
      let theta = Math.atan(p / q)
      if (q < 0) theta = Math.PI + theta
      else if (q > 0 && p < 0) theta = 2 * Math.PI + theta
      theta -= lng
      const phi = Math.atan(r / Math.sqrt(p * p + q * q)) + Math.PI / 2
      return { u: wrap(theta / (2 * Math.PI)), v: phi / Math.PI }
    }
    for (const [y, z] of [[0.3, 0.7], [-0.4, 0.2], [0.5, -0.6], [-0.25, -0.85]] as const) {
      const uv = project(1, y, z, { povLatitude: 0, povLongitude: 90 }, projection)
      const want = legacy(y, z, (90 * Math.PI) / 180)
      expect(uv.u, `u at (y=${y}, z=${z})`).toBe(want.u)
      expect(uv.v, `v at (y=${y}, z=${z})`).toBe(want.v)
    }
  })

  it('shows the pose at the screen centre: v = |lat| / PI, u tracks lng (I2)', () => {
    // ndcToSurface(0, 0, [4, 4]) is the surface point the exact centre of the
    // viewport reconstructs. The centre's sampled azimuth is PI for lat > 0
    // (the q < 0 fixup branch) and 0 for lat < 0: the sign of lat picks which
    // meridian the roll follows, |lat| how far -- the pole being the default
    // centre, either drag direction can only leave it.
    for (const [latDeg, lngDeg] of [[30, 90], [-45, 350], [90, 180], [-90, 0], [60, 0]] as const) {
      const centre = ndcToSurface(0, 0, projection.extent)
      const uv = project(centre[0], centre[1], centre[2], { povLatitude: latDeg, povLongitude: lngDeg }, projection)
      expect(uv.v, `v at lat=${latDeg}`).toBeCloseTo((Math.abs(latDeg) * Math.PI / 180) / Math.PI, 12)
      const azimuth = latDeg > 0 ? Math.PI : 0
      const expectedU = wrap((azimuth - (lngDeg * Math.PI / 180)) / (2 * Math.PI))
      expect(uv.u, `u at lat=${latDeg} lng=${lngDeg}`).toBeCloseTo(expectedU, 12)
    }
  })

  it('rolls monotonically from the pole to the horizon and stays finite (I3)', () => {
    let previous = -1
    for (let latDeg = 0; latDeg <= 90; latDeg += 15) {
      const uv = project(1, 0, 0, { povLatitude: latDeg, povLongitude: 0 }, projection)
      expect(Number.isFinite(uv.v), `v at lat=${latDeg}`).toBe(true)
      expect(uv.v, `v at lat=${latDeg}`).toBeGreaterThan(previous)
      previous = uv.v
    }
    expect(previous).toBeCloseTo(0.5, 12)

    // Finiteness across the full tilt range on a grid that never lands on the
    // Mobius pole (|yy| = cot(|tilt|/2) with zz = 0, so |yy| >= 1 everywhere in
    // the clamp range; 0.75 dodges it). The reference deliberately carries no
    // denominator floor -- it is the arbiter, not a pixel comparison. The
    // centre loop above asserts only v; the centre's u finiteness away from
    // lat = 0 is pinned by I2, whose closeness assertions a NaN u cannot pass.
    for (let latDeg = -90; latDeg <= 90; latDeg += 15) {
      for (const y of [-0.75, -0.5, 0.5, 0.75]) {
        for (const z of [-0.6, 0, 0.6]) {
          const uv = project(1, y, z, { povLatitude: latDeg, povLongitude: 30 }, projection)
          expect(Number.isFinite(uv.u), `u at lat=${latDeg} (y=${y}, z=${z})`).toBe(true)
          expect(Number.isFinite(uv.v), `v at lat=${latDeg} (y=${y}, z=${z})`).toBe(true)
        }
      }
    }
  })

  it('drags the content with the finger (I4)', () => {
    // A downward drag is povLatitude going negative (classifyDrag negates
    // deltaY). The roll must bring what was ABOVE the centre to the centre:
    // the source point at polar 30 degrees used to sit at w = +i*tan(15 deg)
    // (one arm up the screen-vertical meridian), and after a 30-degree
    // downward roll the centre samples exactly that point.
    const arm = Math.tan(Math.PI / 12)
    const before = project(1, arm, 0, { povLatitude: 0, povLongitude: 0 }, projection)
    const after = project(1, 0, 0, { povLatitude: -30, povLongitude: 0 }, projection)
    expect(after.u).toBeCloseTo(before.u, 12)
    expect(after.v).toBeCloseTo(before.v, 12)
    // The mirror roll: 0 -> +30 brings the point from below instead.
    const mirror = project(1, -arm, 0, { povLatitude: 0, povLongitude: 0 }, projection)
    const up = project(1, 0, 0, { povLatitude: 30, povLongitude: 0 }, projection)
    expect(up.u).toBeCloseTo(mirror.u, 12)
    expect(up.v).toBeCloseTo(mirror.v, 12)
  })

  it('is a rotation away from the centre too: chordal distances survive the tilt (review I-1)', () => {
    // I1-I4 pin the origin only: I1 is the tilt = 0 identity and I2-I4 all
    // evaluate the centre, where w = 0 zeroes the very terms a flipped
    // denominator sign lives in -- two one-token mutants of the Mobius
    // denominator (the sign of denIm, the sign of the st * yy inside denRe)
    // survived every test in this file before this block. It pins values
    // instead: a tilt is a sphere rotation, and rotations preserve chordal
    // distances on the sphere, so every pair of off-axis points must stay
    // equidistant under the tilt. The sphere images are recovered from
    // project's public output alone (u, v -> theta, phi -> unit vector),
    // never through the Mobius code, which would only echo a mutant; the
    // recovery reflects the sphere the same way for every point, and a
    // consistent reflection is itself an isometry, so nothing needs to undo
    // it. The true formula drifts ~1e-16 (float64 rounding); the two mutants
    // above drift 4e-2 to 1.7e-1, five orders of margin.
    const lngDeg = 30
    const toSphere = (latDeg: number, y: number, z: number): readonly [number, number, number] => {
      const uv = project(1, y, z, { povLatitude: latDeg, povLongitude: lngDeg }, projection)
      // u already absorbed the lng subtraction; adding lng back recovers
      // theta up to a full turn, which sin and cos cannot see.
      const theta = uv.u * 2 * Math.PI + (lngDeg * Math.PI) / 180
      const phi = uv.v * Math.PI
      return [Math.sin(phi) * Math.sin(theta), Math.sin(phi) * Math.cos(theta), Math.cos(phi)]
    }
    const chord = (
      a: readonly [number, number, number],
      b: readonly [number, number, number]
    ): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    // Off the y = 0 and z = 0 axes like I1, and |y| <= 0.75 stays below the
    // closest the Mobius pole ever comes (|yy| = cot(|tilt| / 2) >= 1).
    const points: Array<readonly [number, number]> = [
      [0.3, 0.7], [-0.4, 0.2], [0.5, -0.6], [-0.25, -0.85], [0.75, 0.35], [-0.6, -0.45]
    ]
    for (const latDeg of [30, -30, 60, -60, 90]) {
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const [y1, z1] = points[i]!
          const [y2, z2] = points[j]!
          const before = chord(toSphere(0, y1, z1), toSphere(0, y2, z2))
          const after = chord(toSphere(latDeg, y1, z1), toSphere(latDeg, y2, z2))
          expect(after, `chord at lat=${latDeg} for (${y1}, ${z1}) vs (${y2}, ${z2})`).toBeCloseTo(before, 12)
        }
      }
    }
  })

  it('pins the Mobius pole the other blocks sample around', () => {
    // The pole of the tilt denominator (d2 = 0 at yy = -cot(tilt/2), zz = 0)
    // sits on the visible surface for |lat| >= ~53 degrees and povLatitude's
    // clamp reaches +-90, so reachable camera states render through it. The
    // blocks above deliberately sample around it; this one is the executable
    // witness for the region the shaders' 1e-15 floor guards -- the
    // continuous limit the floor claims to preserve, pinned here on the
    // unfloored float64 arbiter, the exact point, and the whole tilted
    // surface at the clamp extremes.
    const epsLadder = [1e-3, 1e-6, 1e-7, 1e-8] as const
    const approach = epsLadder.map((eps) => ({
      eps,
      plus: project(1, 1, eps, { povLatitude: -90, povLongitude: 0 }, projection),
      minus: project(1, 1, -eps, { povLatitude: -90, povLongitude: 0 }, projection)
    }))
    // The pole is (y, z) = (1, 0) at lat = -90: approaching along y = 1 from
    // either z side, v converges to 1 (the far pole) and u to 0.75 / 0.25
    // per side. At 1e-3 the approach is still O(eps) away from the limit
    // (~8e-5), so the limit assertions start one rung down; the 1e-3 rung
    // still carries finiteness and the strict progression below.
    for (const { eps, plus, minus } of approach) {
      expect(Number.isFinite(plus.u) && Number.isFinite(plus.v), `finite above the pole at eps=${eps}`).toBe(true)
      expect(Number.isFinite(minus.u) && Number.isFinite(minus.v), `finite below the pole at eps=${eps}`).toBe(true)
    }
    for (const { eps, plus, minus } of approach.slice(1)) {
      expect(plus.u, `u above the pole at eps=${eps}`).toBeCloseTo(0.75, 6)
      expect(minus.u, `u below the pole at eps=${eps}`).toBeCloseTo(0.25, 6)
      expect(plus.v, `v at eps=${eps}`).toBeCloseTo(1, 6)
      expect(minus.v, `v at eps=${eps}`).toBeCloseTo(1, 6)
    }
    // The approach is strict: v still rising and u still homing in on its
    // per-side limit at every step. A floor on d2 -- the one thing the
    // shaders carry and this arbiter must not -- caps |w'|, which reverses
    // the v progression and deflates the exact-pole v pinned below (checked
    // against the shaders' actual 1e-15 floor: v falls from 1 - 3.2e-8 back
    // to 1 - 6.4e-8, exact-pole v to 0.099). The u homing happens to survive
    // the floor, so the v line and the exact-pole pin are the pair that kill
    // a floor-adding mutant.
    for (let i = 1; i < approach.length; i++) {
      const cur = approach[i]!
      const prev = approach[i - 1]!
      expect(cur.plus.v, `v strictly rises from eps=${prev.eps} to ${cur.eps}`).toBeGreaterThan(prev.plus.v)
      expect(Math.abs(cur.plus.u - 0.75), `u+ homing in from eps=${prev.eps} to ${cur.eps}`)
        .toBeLessThan(Math.abs(prev.plus.u - 0.75))
      expect(Math.abs(cur.minus.u - 0.25), `u- homing in from eps=${prev.eps} to ${cur.eps}`)
        .toBeLessThan(Math.abs(prev.minus.u - 0.25))
    }
    // The exact pole: ct and |st| differ by exactly one ulp at tilt = -PI/2,
    // so d2 is (1.1e-16)^2 = 1.2e-32 rather than 0 and the point stays
    // finite by float64 rounding. Pinned so a change in that luck (an engine
    // swap, a different half-angle path) is a visible, adjudicated failure
    // rather than a silent one -- the same stance the module takes at its
    // other degenerate points.
    const exact = project(1, 1, 0, { povLatitude: -90, povLongitude: 0 }, projection)
    expect(Number.isFinite(exact.u) && Number.isFinite(exact.v), 'finite exactly on the pole').toBe(true)
    expect(exact.v).toBeCloseTo(1, 6)
    const mirror = project(1, -1, 0, { povLatitude: 90, povLongitude: 0 }, projection)
    expect(Number.isFinite(mirror.u) && Number.isFinite(mirror.v), 'finite on the +90 pole').toBe(true)
    expect(mirror.v).toBeCloseTo(1, 6)
    // The lat = 0 sweeps elsewhere in this file, extended to the tilts whose
    // pole is on-screen. Two grid points land exactly on the pole ((0, 0.5)
    // at lat = -90, (0, -0.5) at lat = +90) and stay finite by the same
    // last-ulp luck -- they are part of the pin, not skipped.
    for (const latDeg of [-90, -60, 60, 90]) {
      for (let ndcY = -1; ndcY <= 1.0001; ndcY += 0.125) {
        for (let ndcX = -1; ndcX <= 1.0001; ndcX += 0.125) {
          const s = ndcToSurface(ndcX, ndcY, projection.extent)
          const uv = project(s[0], s[1], s[2], { povLatitude: latDeg, povLongitude: 30 }, projection)
          expect(Number.isFinite(uv.u) && Number.isFinite(uv.v), `finite at lat=${latDeg} ndc=(${ndcX},${ndcY})`).toBe(true)
          expect(uv.u, `u in [0,1] at lat=${latDeg} ndc=(${ndcX},${ndcY})`).toBeGreaterThanOrEqual(0)
          expect(uv.u, `u in [0,1] at lat=${latDeg} ndc=(${ndcX},${ndcY})`).toBeLessThanOrEqual(1)
          expect(uv.v, `v in [0,1] at lat=${latDeg} ndc=(${ndcX},${ndcY})`).toBeGreaterThanOrEqual(0)
          expect(uv.v, `v in [0,1] at lat=${latDeg} ndc=(${ndcX},${ndcY})`).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('takes the canonical branch-point value where p and q are both zero', () => {
    // 2026-09-28 planet-review-followups spec, section 2.2, by user
    // adjudication -- this departs, openly, from the faithful-NaN stance the
    // "keeps the NaNs" test below still pins for linear and pannini. The
    // Mobius reduction reaches p = q = 0 at five sites: the lat = 0 centre
    // (the numerator is the zero factor, in float64 too) and, in f32 only,
    // the four exact-hit sites at the +-90 clamps. The canonical values are
    // the +z-side one-sided limits, measured identical at every site:
    // theta = 1.5*PI, and phi = PI where the denominator is the zero factor
    // versus 0 where the numerator is. Bit-exact by construction, hence
    // toBe: 1.5*PI / TWO_PI is exact in float64, and a tolerance here would
    // hide a changed constant.
    const centre = project(1, 0, 0, { povLatitude: 0, povLongitude: 0 }, projection)
    expect(centre.u).toBe(0.75)
    expect(centre.v).toBe(0)

    // The lng subtraction runs after the guard, so the canonical theta
    // receives it like any other fragment's. This is the pin for the
    // statement order: a guard placed after `theta -= lng` fails it.
    const rotated = project(1, 0, 0, { povLatitude: 0, povLongitude: 90 }, projection)
    expect(rotated.u).toBe(0.5)

    // The four B-class sites in float64: sin and cos of the half-angle
    // differ by one ulp here, so num and den stay nonzero, the guard does
    // NOT fire, and the formula's own finite values stand. They are
    // mid-jump artifacts of that one ulp -- each sits 0 or 1/2 a turn from
    // the 0.75 limit either side homes in on -- pinned as the documented,
    // non-normative divergence between this arbiter and the f32 shaders
    // (which take 0.75 at every site, witnessed in the f32 block below).
    // A change to them is an engine or half-angle change and must be seen.
    const artifacts: Array<[number, number, number, number]> = [
      // [y, lat, u, v] -- Mobius pole sites first, then tilt centres. The
      // -0 in the first row is deliberate and load-bearing (toBe is
      // Object.is): the pole site carries zz = -0 through num into p, and
      // theta stays -0 to the wrap.
      [1, -90, -0, 1],
      [-1, 90, 0.5, 1],
      [-1, -90, 0.5, 0],
      [1, 90, 0, 0]
    ]
    for (const [y, latDeg, u, v] of artifacts) {
      const hit = project(1, y, 0, { povLatitude: latDeg, povLongitude: 0 }, projection)
      expect(hit.u, `u at (y=${y}) lat=${latDeg}`).toBe(u)
      expect(hit.v, `v at (y=${y}) lat=${latDeg}`).toBe(v)
    }
  })

  it('witnesses the f32 floored path the shaders run: floor fires, atan(0/0) remains', () => {
    // The blocks above run the float64 arbiter; the shaders run f32 with the
    // 1e-15 floor, and until this block nothing executed that arithmetic (CR
    // round 2, red team). This replica transcribes panorama.glsl's
    // project_planet -- the WGSL twin is token-identical, held by the shader
    // tests -- with Math.fround at every intermediate, and three deliberate
    // elisions: lng pinned at 0 (theta -= 0 changes no bit), the zoom
    // pre-multiplication (every pin runs zoom 1, an exact identity), and
    // to_uv's mod on u (every pinned theta / TWO_PI sits in [0, 1) and mod of
    // NaN stays NaN; the v flip is transcribed). One caveat the pins below
    // carry: JS Math.sin/cos/atan/sqrt are f64-then-rounded, so a backend's
    // f32 transcendentals may differ by an ulp; the exact-hit behaviour
    // pinned here is the JS-rounding truth and documents the class, not
    // every backend's bits.
    const f = Math.fround
    const F32_PI = f(Math.PI)
    const shaderPlanet = (y: number, z: number, latDeg: number): { u: number, v: number, d2: number } => {
      const yy = f(y)
      const zz = f(-z)
      const lat = f(f(f(latDeg) * F32_PI) / f(180))
      const ct = f(Math.cos(f(lat * f(0.5))))
      const st = f(Math.sin(f(lat * f(0.5))))
      const numRe = f(ct * zz)
      const numIm = f(f(ct * yy) - st)
      const denRe = f(ct + f(st * yy))
      const denIm = f(f(-st) * zz)
      const d2 = f(Math.max(f(f(denRe * denRe) + f(denIm * denIm)), 1e-15))
      const zn = f(f(f(numRe * denRe) + f(numIm * denIm)) / d2)
      const yn = f(f(f(numIm * denRe) - f(numRe * denIm)) / d2)
      const m = f(f(1 + f(zn * zn)) + f(yn * yn))
      const p = f(f(2 * zn) / m)
      const q = f(f(2 * yn) / m)
      const r = f(f(m - 2) / m)
      let theta = Math.atan(f(p / q))
      if (q < 0) theta = f(f(Math.PI) + theta)
      else if (q > 0 && p < 0) theta = f(f(f(2) * F32_PI) + theta)
      const phi = f(f(Math.atan(f(r / f(Math.sqrt(f(f(p * p) + f(q * q))))))) + f(F32_PI / f(2)))
      const u = f(theta / f(f(2) * F32_PI))
      const v = f(1 - f(phi / f(Math.PI)))
      return { u, v, d2 }
    }

    // The approach ladder, both clamp signs, on the Mobius pole's own column
    // (y = +1 at lat = -90, y = -1 at lat = +90): finite, u homing on 0.75 at
    // O(eps), v on the source-pole row at O(eps) -- and at the last rung the
    // floor FIRES (raw d2 is 5e-17, floored to fround(1e-15)), which is the
    // floor's actual deliverable and was pinned nowhere before. Past that
    // rung v is floor-limited at ~6e-8 rather than O(eps), hence the looser
    // bound there.
    for (const [site, latDeg] of [[1, -90], [-1, 90]] as const) {
      for (const [eps, vBound] of [[1e-3, 1e-3], [1e-6, 1e-6], [1e-8, 2e-7]] as const) {
        const near = shaderPlanet(site, eps, latDeg)
        expect(
          Number.isFinite(near.u) && Number.isFinite(near.v),
          `finite near the pole at (y=${site}) lat=${latDeg} eps=${eps}`
        ).toBe(true)
        expect(Math.abs(near.u - 0.75), `u homing on 0.75 at eps=${eps}`).toBeLessThan(4 * eps)
        expect(Math.abs(near.v), `v at the source-pole row at eps=${eps}`).toBeLessThan(vBound)
      }
      expect(shaderPlanet(site, 1e-8, latDeg).d2, `the floor fired at (y=${site}) lat=${latDeg}`)
        .toBe(Math.fround(1e-15))
    }

    // Exactly on the degenerate sites, all four (both clamps, both signs of
    // y): u is NaN and v collapses to a source pole -- pinned as the
    // documented residual, the same faithful-NaN class the lat = 0 centre
    // pixel carries, not an accident. The d2 pins say which site is which:
    // the Mobius pole's denominator zero is floored up from 0 (and the floor
    // still cannot save theta, which is atan(0/0) one link downstream), while
    // the tilt centre's own w' = 0 carries d2 = O(1) -- no d2 floor can ever
    // reach that one.
    const exactSites: Array<[number, number, 'pole' | 'centre']> = [
      [1, -90, 'pole'],
      [-1, 90, 'pole'],
      [-1, -90, 'centre'],
      [1, 90, 'centre']
    ]
    for (const [y, latDeg, kind] of exactSites) {
      const hit = shaderPlanet(y, 0, latDeg)
      expect(Number.isNaN(hit.u), `u NaN exactly on the ${kind} site (y=${y}) at lat=${latDeg}`).toBe(true)
      expect(hit.v, `v collapses to a source pole on the ${kind} site (y=${y}) lat=${latDeg}`).toBe(1)
      if (kind === 'pole') {
        expect(hit.d2, `d2 floored up from 0 on the pole site (y=${y}) lat=${latDeg}`)
          .toBe(Math.fround(1e-15))
      } else {
        // The analytic value is (2c)^2 with c the shared ct/st bits, about
        // 1.9999999; the bound stays at half of it because the pin's job is
        // telling the centre site (d2 = O(1)) from the pole site (d2 at the
        // floor, fifteen orders below), not measuring the constant.
        expect(hit.d2, `d2 is O(1) on the centre site (y=${y}) lat=${latDeg}`).toBeGreaterThan(1)
      }
    }
  })
})
