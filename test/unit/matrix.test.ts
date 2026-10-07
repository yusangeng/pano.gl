import { describe, it, expect } from 'vitest'
import { mat4, vec4 } from 'gl-matrix'
import { buildCameraTransform, buildProjection, buildViewMatrix } from '../../src/core/matrix'
import type { Projection } from '../../src/core/types'

const linear: Projection = { kind: 'linear', fov: Math.PI / 3, aspect: 1 }
const planet: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }

describe('depth convention', () => {
  it('maps the near plane to -1 in gl convention and 0 in webgpu convention', () => {
    // The single difference between the backends, asserted where it becomes
    // visible: a point ON the near plane (view z = -NEAR) must land exactly on
    // the respective clip boundary -- for the perspective frustum and for the
    // non-linear ortho box alike. Swapping the convention-selected gl-matrix
    // function flips both mappings at once.
    const nearPoint: vec4 = [0, 0, -0.1, 1]

    for (const projection of [linear, planet]) {
      const gl = buildProjection(projection, 'minus-one-to-one', mat4.create(), 1)
      const zo = buildProjection(projection, 'zero-to-one', mat4.create(), 1)

      const glClip = vec4.transformMat4(vec4.create(), nearPoint, gl)
      expect(glClip[2] / glClip[3]).toBeCloseTo(-1, 6)

      const zoClip = vec4.transformMat4(vec4.create(), nearPoint, zo)
      expect(zoClip[2] / zoClip[3]).toBeCloseTo(0, 6)
    }
  })

  it('is the only thing that differs between backends for the same projection', () => {
    const out1 = mat4.create()
    const out2 = mat4.create()
    buildProjection(linear, 'minus-one-to-one', out1, 1)
    buildProjection(linear, 'zero-to-one', out2, 1)
    // X and Y terms are untouched by the depth convention.
    expect(out1[0]).toBeCloseTo(out2[0], 12)
    expect(out1[5]).toBeCloseTo(out2[5], 12)
  })

  it('sizes the non-linear ortho box to half the extent at a square viewport, in either convention', () => {
    const gl = buildProjection(planet, 'minus-one-to-one', mat4.create(), 1)
    const zo = buildProjection(planet, 'zero-to-one', mat4.create(), 1)
    // A 4x4 extent means a [-2, 2] box on both axes: 2 / (2 - (-2)) = 0.5.
    // The x/y scales are what the fragment shader reads the surface through,
    // so they must not depend on the depth convention.
    expect(gl[0]).toBeCloseTo(0.5, 12)
    expect(gl[5]).toBeCloseTo(0.5, 12)
    expect(zo[0]).toBeCloseTo(0.5, 12)
    expect(zo[5]).toBeCloseTo(0.5, 12)
    expect(zo[10]).not.toBe(gl[10])
  })

  it('sizes the box per axis from a manual extent tuple (fit extent)', () => {
    // fit 'extent' takes the tuple literally: [4, 2] is a [-2, 2] x [-1, 1]
    // box, so gl[0] = 2/(2*2) = 0.5 and gl[5] = 2/(2*1) = 1 -- independent
    // per-axis scales, the rectangular-ortho contract the fragment
    // reconstruction reads the surface through. Both orderings, so a
    // transposed implementation fails at least one of them loudly.
    for (const [extent, sx, sy] of [[[4, 2], 0.5, 1], [[2, 4], 1, 0.5]] as const) {
      const manual: Projection = { kind: 'planet', zoom: 1, extent, fit: 'extent' }
      const gl = buildProjection(manual, 'minus-one-to-one', mat4.create(), 1)
      const zo = buildProjection(manual, 'zero-to-one', mat4.create(), 1)
      expect(gl[0]).toBeCloseTo(sx, 12)
      expect(gl[5]).toBeCloseTo(sy, 12)
      expect(zo[0]).toBeCloseTo(sx, 12)
      expect(zo[5]).toBeCloseTo(sy, 12)
    }
  })

  it('derives the container-fit height per camera rate', () => {
    // Literals derived independently from the rate table, not by running
    // resolveExtent. Cylindrical at A=2 resolves [1, 1] to [1, pi]:
    // gl[0] = 1/(1/2) = 2, gl[5] = 1/(pi/2) = 0.6366197723675814.
    const cylindrical: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    const gl = buildProjection(cylindrical, 'minus-one-to-one', mat4.create(), 2)
    expect(gl[0]).toBeCloseTo(2, 12)
    // mat4 is Float32Array storage, so the assertable value is the correctly
    // rounded float32 of the independently derived double -- Math.fround of
    // the plan literal, bit-for-bit what ortho()/orthoZO() stores (here and
    // at the pannini leg below). A wrong rate or a missing aspect coupling
    // displaces the double by O(1) and lands on a different float32, still
    // failing loudly.
    expect(gl[5]).toBeCloseTo(Math.fround(0.6366197723675814), 12)

    // Pannini at A=16/9 resolves [4, 4] to [4, 2.25]:
    // gl[0] = 2/4 = 0.5, gl[5] = 2/2.25 = 0.8888888888888888.
    const pannini: Projection = { kind: 'pannini', zoom: 1, extent: [4, 4] }
    const zo = buildProjection(pannini, 'zero-to-one', mat4.create(), 16 / 9)
    expect(zo[0]).toBeCloseTo(0.5, 12)
    expect(zo[5]).toBeCloseTo(Math.fround(0.8888888888888888), 12)
  })

  it('fit extent with a square tuple is bit-identical at any viewport (I6)', () => {
    // The legacy collapse was m = max(extent)/2; for a square tuple that is
    // exactly per-axis halves, so fit 'extent' + square tuple reproduces the
    // legacy matrix WHATEVER the container. This is what lets gate A keep
    // watching the v0.2.2 pixels instead of re-shooting the baseline. toEqual,
    // not toBeCloseTo: I6 is a bit-for-bit claim.
    const probe: Projection = { kind: 'planet', zoom: 1, extent: [4, 4], fit: 'extent' }
    const reference = buildProjection(probe, 'minus-one-to-one', mat4.create(), 1)
    for (const aspect of [16 / 9, 9 / 16, 2.39]) {
      const other = buildProjection(probe, 'minus-one-to-one', mat4.create(), aspect)
      expect(other).toEqual(reference)
    }
    expect(reference[0]).toBe(0.5)
    expect(reference[5]).toBe(0.5)
  })
})

describe('buildViewMatrix', () => {
  it('leaves the world unrotated at the origin orientation', () => {
    const m = buildViewMatrix({ povLatitude: 0, povLongitude: 0 }, mat4.create())
    // Eye at origin looking down +X. The view matrix is still a rigid transform,
    // so its determinant magnitude is 1.
    const det =
      m[0] * (m[5] * m[10] - m[6] * m[9]) -
      m[1] * (m[4] * m[10] - m[6] * m[8]) +
      m[2] * (m[4] * m[9] - m[5] * m[8])
    expect(Math.abs(det)).toBeCloseTo(1, 10)
  })

  it('turns longitude into a rotation about the vertical axis', () => {
    const a = buildViewMatrix({ povLatitude: 0, povLongitude: 0 }, mat4.create())
    const b = buildViewMatrix({ povLatitude: 0, povLongitude: 90 }, mat4.create())
    expect(a).not.toEqual(b)
  })
})

describe('buildCameraTransform', () => {
  it('is projection times view, in that order', () => {
    const state = { povLatitude: 20, povLongitude: 40 }
    const actual = buildCameraTransform(state, linear, 'minus-one-to-one', mat4.create(), 1)

    const view = buildViewMatrix(state, mat4.create())
    const proj = buildProjection(linear, 'minus-one-to-one', mat4.create(), 1)
    const expected = mat4.multiply(mat4.create(), proj, view)

    for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 12)
  })
})

/*
 * Gate B, part 1: does the inverse-matrix surface reconstruction reproduce the
 * legacy quad's coordinate range exactly?
 *
 * The legacy non-linear cameras rasterised a quad at x = 1 spanning y and z,
 * sized 1x1 for cylindrical and mercator and 4x4 for planet and pannini,
 * and fed the interpolated position straight into the projection formula.
 * The new renderer gets the same point from `invClip`. If the matrix encodes
 * the wrong extent, the picture scales -- which looks almost right, and is
 * the failure mode this gate exists to catch.
 *
 * This is CPU work, so it belongs in the unit project: it needs no adapter, and
 * a property that can be checked without a GPU should not be gated behind one.
 */
describe('gate B: surface reconstruction', () => {
  // Annotated so `camera` stays a literal union: unannotated, the array widens
  // it to `string` and `{ kind: camera, ... }` no longer picks a Projection
  // variant. The annotation also contextually types `extent` as a tuple.
  const CASES: ReadonlyArray<{
    camera: 'cylindrical' | 'planet' | 'pannini' | 'mercator'
    extent: readonly [number, number]
  }> = [
    { camera: 'cylindrical', extent: [1, 1] },
    { camera: 'planet', extent: [4, 4] },
    { camera: 'pannini', extent: [4, 4] },
    { camera: 'mercator', extent: [1, 1] }
  ]

  /*
   * Walks the NDC corners of the viewport through the same reconstruction the
   * fragment shader performs: `invClip * vec4(ndc, 1, 1)` then divide by w.
   * Written out longhand rather than reused from `reference.ts`, because a
   * check that shares its implementation with the thing it checks cannot fail.
   *
   * The third column is load-bearing and easy to drop: the input's z slot is
   * the constant 1 -- the far plane, in both depth conventions -- and the
   * far-plane term in that column is what pins the recovered x at exactly 1.
   * Omitting it lands x on the near plane instead, which is a different point
   * than any the legacy quad ever produced.
   */
  function surfaceAt (invClip: mat4, ndcX: number, ndcY: number) {
    const x = invClip[0]! * ndcX + invClip[4]! * ndcY + invClip[8]! + invClip[12]!
    const y = invClip[1]! * ndcX + invClip[5]! * ndcY + invClip[9]! + invClip[13]!
    const z = invClip[2]! * ndcX + invClip[6]! * ndcY + invClip[10]! + invClip[14]!
    const w = invClip[3]! * ndcX + invClip[7]! * ndcY + invClip[11]! + invClip[15]!
    return { x: x / w, y: y / w, z: z / w }
  }

  for (const { camera, extent } of CASES) {
    it(`${camera} recovers a surface spanning ${extent[0]} x ${extent[1]} at x = 1`, () => {
      const clip = buildCameraTransform(
        { povLatitude: 0, povLongitude: 0 },
        { kind: camera, zoom: 1, extent, fit: 'extent' },
        'zero-to-one',
        mat4.create(),
        1
      )
      // The shader inverts; so does this test. Inverting separately is what
      // makes the assertion about the matrix rather than about gl-matrix.
      const invClip = mat4.invert(mat4.create(), clip)
      // A throw rather than an `expect`: `noUncheckedIndexedAccess` and strict
      // null checks mean the narrowing has to be real, and a non-invertible
      // camera transform is a bug worth naming rather than a failed assertion.
      if (!invClip) throw new Error('the camera transform must be invertible')

      const corners = [
        surfaceAt(invClip, -1, -1), surfaceAt(invClip, 1, -1),
        surfaceAt(invClip, -1, 1), surfaceAt(invClip, 1, 1)
      ]

      // x is pinned, and this is also the far-plane assertion: on the legacy
      // quad x was the constant 1, and `QUAD_FAR = 1` is what makes sampling at
      // ndc z = +1 -- where both depth conventions put the far plane -- land
      // exactly on that plane. The legacy's far = 1000 would recover x = 1000
      // here and silently rescale pannini, which divides by x.
      for (const c of corners) expect(c.x).toBeCloseTo(1, 3)
      // The recovered surface spans the extent box, centred on the origin.
      const ys = corners.map(c => c.y)
      const zs = corners.map(c => c.z)
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(extent[1], 3)
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(extent[0], 3)
      expect(Math.max(...ys) + Math.min(...ys)).toBeCloseTo(0, 3)
      expect(Math.max(...zs) + Math.min(...zs)).toBeCloseTo(0, 3)
    })
  }

  it('resolves the container fit before sizing the box (cylindrical at A=1 spans 1 x 2pi)', () => {
    // The container default at a square viewport: cylindrical's rate is 2pi,
    // so [1, 1] resolves to [1, 2pi] -- the same reconstruction as above, with
    // the span read from the RESOLVED pair rather than the tuple.
    const clip = buildCameraTransform(
      { povLatitude: 0, povLongitude: 0 },
      { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
      'zero-to-one',
      mat4.create(),
      1
    )
    const invClip = mat4.invert(mat4.create(), clip)
    if (!invClip) throw new Error('the camera transform must be invertible')

    const corners = [
      surfaceAt(invClip, -1, -1), surfaceAt(invClip, 1, -1),
      surfaceAt(invClip, -1, 1), surfaceAt(invClip, 1, 1)
    ]
    for (const c of corners) expect(c.x).toBeCloseTo(1, 3)
    const ys = corners.map(c => c.y)
    const zs = corners.map(c => c.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1, 3)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * Math.PI, 3)
    expect(Math.max(...ys) + Math.min(...ys)).toBeCloseTo(0, 3)
    expect(Math.max(...zs) + Math.min(...zs)).toBeCloseTo(0, 3)
  })
})

describe('fragment-stage reconstruction', () => {
  it('recovers the quad surface point from ndc through the inverse transform', () => {
    // The CPU-side statement of what the fragment stage does: transform
    // (ndcX, ndcY, 1, 1) through the inverse camera transform and divide by w.
    // It pins two things the baseline carve-out cannot see. The recovered x
    // must be exactly +1 -- the plane the legacy quad sat on, whose SIGN the
    // pannini shader branches on (x < 0 rotates it half a turn). And ndcZ = 1
    // must sample that plane (QUAD_FAR = 1), not the legacy's far = 1000,
    // which would hand the shader x = 1000 and silently rescale pannini.
    const transform = buildCameraTransform(
      { povLatitude: 0, povLongitude: 0 },
      planet,
      'minus-one-to-one',
      mat4.create(),
      1
    )
    const inv = mat4.invert(mat4.create(), transform)
    expect(inv, 'camera transform must be invertible').not.toBeNull()

    // The extent resolves to [4, 4] at this square viewport: the quad spans
    // [-2, 2] on both axes.
    const half = 2
    const points = [[0.25, -0.5], [-0.75, 0.375]] as const

    for (const [ndcX, ndcY] of points) {
      const clip = vec4.transformMat4(vec4.create(), [ndcX, ndcY, 1, 1], inv!)
      const x = clip[0] / clip[3]
      const y = clip[1] / clip[3]
      const z = clip[2] / clip[3]

      // A quad vertex (1, y, z): y and z are the extent-scaled screen
      // coordinates (note the axes swap -- view-X is world +Z), x is pinned.
      expect(x).toBeCloseTo(1, 6)
      expect(y).toBeCloseTo(half * ndcY, 6)
      expect(z).toBeCloseTo(half * ndcX, 6)
    }
  })
})
