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
      const gl = buildProjection(projection, 'minus-one-to-one', mat4.create())
      const zo = buildProjection(projection, 'zero-to-one', mat4.create())

      const glClip = vec4.transformMat4(vec4.create(), nearPoint, gl)
      expect(glClip[2] / glClip[3]).toBeCloseTo(-1, 6)

      const zoClip = vec4.transformMat4(vec4.create(), nearPoint, zo)
      expect(zoClip[2] / zoClip[3]).toBeCloseTo(0, 6)
    }
  })

  it('is the only thing that differs between backends for the same projection', () => {
    const out1 = mat4.create()
    const out2 = mat4.create()
    buildProjection(linear, 'minus-one-to-one', out1)
    buildProjection(linear, 'zero-to-one', out2)
    // X and Y terms are untouched by the depth convention.
    expect(out1[0]).toBeCloseTo(out2[0], 12)
    expect(out1[5]).toBeCloseTo(out2[5], 12)
  })

  it('sizes the non-linear ortho box to half the largest extent, in either convention', () => {
    const gl = buildProjection(planet, 'minus-one-to-one', mat4.create())
    const zo = buildProjection(planet, 'zero-to-one', mat4.create())
    // A 4x4 extent means a [-2, 2] box on both axes: 2 / (2 - (-2)) = 0.5.
    // The x/y scales are what the fragment shader reads the surface through,
    // so they must not depend on the depth convention.
    expect(gl[0]).toBeCloseTo(0.5, 12)
    expect(gl[5]).toBeCloseTo(0.5, 12)
    expect(zo[0]).toBeCloseTo(0.5, 12)
    expect(zo[5]).toBeCloseTo(0.5, 12)
    expect(zo[10]).not.toBe(gl[10])
  })

  it('bases the box half-width on the largest extent axis, not per axis', () => {
    // Both orderings of an asymmetric extent, which the type allows even
    // though every legacy extent was square. Jointly the two inputs pin
    // m = max/2 against all three wrong sizings: per-axis ([4, 2] catches it
    // on y), width-driven ([2, 4] catches it on both axes) and height-driven
    // ([4, 2] catches it on both axes).
    for (const extent of [[4, 2], [2, 4]] as const) {
      const asymmetric: Projection = { kind: 'cylindrical', zoom: 1, extent }
      const gl = buildProjection(asymmetric, 'minus-one-to-one', mat4.create())
      const zo = buildProjection(asymmetric, 'zero-to-one', mat4.create())

      // max = 4 either way, so m = 2 on BOTH axes: a [-2, 2] x [-2, 2] box
      // has both scales at 2 / (2 - (-2)) = 0.5. Any sizing that reads the
      // wrong axis -- or one axis for both -- produces a 1 somewhere.
      expect(gl[0]).toBeCloseTo(0.5, 12)
      expect(gl[5]).toBeCloseTo(0.5, 12)
      expect(zo[0]).toBeCloseTo(0.5, 12)
      expect(zo[5]).toBeCloseTo(0.5, 12)
    }
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
    const actual = buildCameraTransform(state, linear, 'minus-one-to-one', mat4.create())

    const view = buildViewMatrix(state, mat4.create())
    const proj = buildProjection(linear, 'minus-one-to-one', mat4.create())
    const expected = mat4.multiply(mat4.create(), proj, view)

    for (let i = 0; i < 16; i++) expect(actual[i]).toBeCloseTo(expected[i]!, 12)
  })
})

/*
 * Gate B, part 1: does the inverse-matrix surface reconstruction reproduce the
 * legacy quad's coordinate range exactly?
 *
 * The legacy non-linear cameras rasterised a quad at x = 1 spanning y and z,
 * sized 1x1 for cylindrical and 4x4 for planet and pannini, and fed the
 * interpolated position straight into the projection formula. The new renderer
 * gets the same point from `invClip`. If the matrix encodes the wrong extent,
 * the picture scales -- which looks almost right, and is the failure mode this
 * gate exists to catch.
 *
 * This is CPU work, so it belongs in the unit project: it needs no adapter, and
 * a property that can be checked without a GPU should not be gated behind one.
 */
describe('gate B: surface reconstruction', () => {
  // Annotated so `camera` stays a literal union: unannotated, the array widens
  // it to `string` and `{ kind: camera, ... }` no longer picks a Projection
  // variant. The annotation also contextually types `extent` as a tuple.
  const CASES: ReadonlyArray<{
    camera: 'cylindrical' | 'planet' | 'pannini'
    extent: readonly [number, number]
  }> = [
    { camera: 'cylindrical', extent: [1, 1] },
    { camera: 'planet', extent: [4, 4] },
    { camera: 'pannini', extent: [4, 4] }
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
        { kind: camera, zoom: 1, extent },
        'zero-to-one',
        mat4.create()
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
      mat4.create()
    )
    const inv = mat4.invert(mat4.create(), transform)
    expect(inv, 'camera transform must be invertible').not.toBeNull()

    // max([4, 4]) / 2: the quad spans [-2, 2] on both axes.
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
