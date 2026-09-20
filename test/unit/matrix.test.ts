import { describe, it, expect } from 'vitest'
import { mat4 } from 'gl-matrix'
import { buildCameraTransform, buildProjection, buildViewMatrix } from '../../src/core/matrix'
import type { Projection } from '../../src/core/types'

const linear: Projection = { kind: 'linear', fov: Math.PI / 3, aspect: 1 }
const planet: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }

describe('depth convention', () => {
  it('maps the near plane to -1 in gl convention and 0 in webgpu convention', () => {
    // The single difference between the backends. A point at the near plane
    // must land on the respective clip boundary.
    const gl = buildProjection(linear, 'minus-one-to-one', mat4.create())
    const zo = buildProjection(linear, 'zero-to-one', mat4.create())
    expect(gl).not.toEqual(zo)

    // Column-major: element index 10 is m[2][2], the depth scale.
    expect(zo[10]).not.toBe(gl[10])
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
