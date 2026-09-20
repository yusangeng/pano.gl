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
    // [4, 2] is asymmetric and the type allows it; every legacy extent was
    // square, so nothing else would notice per-axis sizing creeping back in.
    const asymmetric: Projection = { kind: 'cylindrical', zoom: 1, extent: [4, 2] }
    const gl = buildProjection(asymmetric, 'minus-one-to-one', mat4.create())
    const zo = buildProjection(asymmetric, 'zero-to-one', mat4.create())

    // m = max(4, 2) / 2 = 2 on BOTH axes: a [-2, 2] x [-2, 2] box has both
    // scales at 2 / (2 - (-2)) = 0.5. Per-axis sizing would read extent[1] on
    // the y axis and produce 2 / (1 - (-1)) = 1 there instead.
    expect(gl[0]).toBeCloseTo(0.5, 12)
    expect(gl[5]).toBeCloseTo(0.5, 12)
    expect(zo[0]).toBeCloseTo(0.5, 12)
    expect(zo[5]).toBeCloseTo(0.5, 12)
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
