import { describe, it, expect } from 'vitest'
import { PANORAMA_WGSL } from '../../src/renderer/webgpu/shaders'
import { CAMERA_UNIFORM_LAYOUT, CAMERA_UNIFORM_SIZE } from '../../src/renderer/uniforms'

describe('panorama WGSL', () => {
  it('declares every field of the uniform layout, in the same order', () => {
    // Writes into the struct are positional, so a field that exists in the TS
    // layout but not in the shader shifts everything after it. Nothing reports
    // this: the shader just reads the wrong bytes.
    const structBody = PANORAMA_WGSL.match(/struct Camera \{([\s\S]*?)\}/)?.[1]
    expect(structBody, 'no Camera struct in the shader').toBeDefined()

    const declared = structBody!
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('//'))
      .map(l => l.split(':')[0]!.trim())

    const expected = CAMERA_UNIFORM_LAYOUT.map(f => f.name)
    expect(declared).toEqual(expected)
  })

  it('declares the struct fields with byte sizes that sum to the block size', () => {
    // `[1]!` and not the first test's `?.[1]` + `toBeDefined()`: this test only
    // runs meaningfully if the first passed, and `noUncheckedIndexedAccess`
    // types the element itself as `string | undefined` -- the trailing `!` is
    // what asserts it.
    const structBody = PANORAMA_WGSL.match(/struct Camera \{([\s\S]*?)\}/)![1]!
    const sizes: Record<string, number> = { 'mat4x4<f32>': 64, u32: 4, f32: 4, i32: 4 }
    let total = 0
    for (const line of structBody.split('\n')) {
      const m = line.match(/^\s*(\w+)\s*:\s*([\w<>]+)\s*,/)
      if (!m) continue
      const size = sizes[m[2]!]
      expect(size, `unknown WGSL type ${m[2]}`).toBeDefined()
      total += size!
    }
    expect(total).toBe(CAMERA_UNIFORM_SIZE)
  })

  it('does not use the modulo operator', () => {
    // The shader wraps u with `fract`, which is `x - floor(x)` and matches
    // GLSL's `mod`. WGSL's `%` truncates toward zero instead, so a `%` here
    // would put a seam in the panorama wherever theta is negative -- and it
    // would be a silent divergence from src/core/reference.ts, which uses the
    // floor-based form.
    const body = PANORAMA_WGSL.replace(/\/\/[^\n]*/g, '')
    expect(body).not.toMatch(/[^/%]\s*%\s*[^%]/)
  })

  it('has no preprocessor directives', () => {
    // WGSL has no preprocessor. A `#define` that slipped in from a GLSL-ism
    // would be a parse error, but it is worth failing the unit test rather than
    // waiting for a browser.
    expect(PANORAMA_WGSL).not.toMatch(/^\s*#/m)
  })

  it('declares both fragment entry points and both source bindings', () => {
    // Both are needed: `texture_external` has no `textureSample` overload, so a
    // single entry point cannot serve both source kinds. Losing either one
    // means one source kind silently falls back to the other's pipeline.
    expect(PANORAMA_WGSL).toContain('fn fs_main(')
    expect(PANORAMA_WGSL).toContain('fn fs_main_external(')
    expect(PANORAMA_WGSL).toContain('var tex: texture_2d<f32>')
    expect(PANORAMA_WGSL).toContain('var ext: texture_external')
    expect(PANORAMA_WGSL).toContain('textureSampleBaseClampToEdge')
  })

  it('dispatches on the generated constants rather than numeric literals', () => {
    // This is the assertion that makes the generated-constants arrangement
    // worth anything: if the switch went back to `case 1u:`, the numbers would
    // be hand-maintained in two places again, which is exactly the defect the
    // legacy code had.
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_LINEAR:')
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_CYLINDRICAL:')
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_PLANET:')
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_PANNINI:')
    expect(PANORAMA_WGSL).toContain('TEXTURE_PROJECTION_EQUIRECTANGULAR')
    expect(PANORAMA_WGSL).not.toMatch(/case \d+u:/)
  })

  it('does not shift u by half a turn', () => {
    // A `+ 0.5` in `to_uv` rotates the panorama 180 degrees, and it is the
    // single most plausible "cleanup" a reader would make: the legacy shader
    // looks wrong without it, and src/core/reference.ts documents at length why
    // it is not there. This test exists because the mistake is invisible in a
    // unit test and looks like a plausible camera bug in a screenshot.
    const toUv = PANORAMA_WGSL.match(/fn to_uv\([\s\S]*?\n\}/)?.[0]
    expect(toUv, 'no to_uv in the shader').toBeDefined()
    expect(toUv).not.toMatch(/0\.5/)
  })

  it('flips v, absorbing the legacy UNPACK_FLIP_Y_WEBGL upload', () => {
    // The legacy upload flipped the image; WebGPU cannot (no flipY on
    // importExternalTexture), so the flip lives in the shader. Spec §4.4:
    // one convention for both source paths. If this flip is dropped, stills
    // and video both come out upside down -- and gate A's failure table has a
    // row for exactly that symptom.
    const toUv = PANORAMA_WGSL.match(/fn to_uv\([\s\S]*?\n\}/)![0]
    expect(toUv).toContain('1.0 - phi / PI')
  })

  it('subtracts povLongitude / 4, the legacy units bug, and not a degree conversion', () => {
    // v0.2.2 subtracted a degree value from a radian angle. Reproducing that is
    // the acceptance criterion for this phase; "fixing" it here would change
    // panning sensitivity, which v1 deliberately does not do (spec §11.4 B1).
    expect(PANORAMA_WGSL).toContain('camera.povLongitude / 4.0')
    expect(PANORAMA_WGSL).not.toMatch(/povLongitude \* PI \/ 180/)
  })
})
