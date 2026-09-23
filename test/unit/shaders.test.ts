import { describe, it, expect } from 'vitest'
import { PANORAMA_WGSL } from '../../src/renderer/webgpu/shaders'
import { CAMERA_UNIFORM_LAYOUT, CAMERA_UNIFORM_SIZE } from '../../src/renderer/uniforms'

// Positive assertions run against code, not comments: the shader's comments
// name `textureSampleBaseClampToEdge` and `TEXTURE_PROJECTION_EQUIRECTANGULAR`,
// so a `toContain` against the raw source passes even when the call or
// comparison is gone. Block comments are stripped before line comments so a
// `//` inside a block comment cannot leave a dangling `*/` behind.
const STRIPPED = PANORAMA_WGSL
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')

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
      // The kind fields are ABI-critical: `packCameraUniforms` writes them
      // through a Uint32Array, so the shader must read them as u32. Declared
      // f32, the bits of 1 read as a denormal (~1.4e-45): projKind matches no
      // switch case and every fragment takes the default branch, texProjKind
      // fails its equirectangular check. Both types score 4 bytes, which is
      // why the size map alone cannot catch this.
      if (m[1] === 'projKind' || m[1] === 'texProjKind') {
        expect(m[2], `${m[1]} must be declared u32`).toBe('u32')
      }
    }
    expect(total).toBe(CAMERA_UNIFORM_SIZE)
  })

  it('does not use the modulo operator', () => {
    // The shader wraps u with `fract`, which is `x - floor(x)` and matches
    // GLSL's `mod`. WGSL's `%` truncates toward zero instead, so a `%` here
    // would put a seam in the panorama wherever theta is negative -- and it
    // would be a silent divergence from src/core/reference.ts, which uses the
    // floor-based form.
    expect(STRIPPED).not.toMatch(/[^/%]\s*%\s*[^%]/)
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
    expect(STRIPPED).toContain('fn fs_main(')
    expect(STRIPPED).toContain('fn fs_main_external(')
    expect(STRIPPED).toContain('var tex: texture_2d<f32>')
    expect(STRIPPED).toContain('var ext: texture_external')
    expect(STRIPPED).toContain('textureSampleBaseClampToEdge')
  })

  it('dispatches on the generated constants rather than numeric literals', () => {
    // This is the assertion that makes the generated-constants arrangement
    // worth anything: if the switch went back to `case 1u:`, the numbers would
    // be hand-maintained in two places again, which is exactly the defect the
    // legacy code had.
    expect(STRIPPED).toContain('case CAMERA_PROJECTION_LINEAR:')
    expect(STRIPPED).toContain('case CAMERA_PROJECTION_CYLINDRICAL:')
    expect(STRIPPED).toContain('case CAMERA_PROJECTION_PLANET:')
    expect(STRIPPED).toContain('case CAMERA_PROJECTION_PANNINI:')
    // A bare `TEXTURE_PROJECTION_EQUIRECTANGULAR` token check cannot catch a
    // numeric-literal comparison: the generated constants block is prepended
    // as code, so its `const TEXTURE_PROJECTION_EQUIRECTANGULAR` declaration
    // satisfies it no matter what the comparison says. The needle is the
    // comparison itself.
    expect(STRIPPED).toContain('camera.texProjKind != TEXTURE_PROJECTION_EQUIRECTANGULAR')
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

  it('subtracts an honestly converted povLongitude, not the legacy /4 units bug', () => {
    // v0.2.2 subtracted a degree value from a radian angle; the port carried
    // that through as the retention recorded in v1-design §11.4 (B1), and it
    // was corrected 2026-09-23 by user adjudication -- the pan-zoom-semantics
    // spec §1 supersedes that retention. The GLSL twin and `lngOffset` in
    // src/core/reference.ts carry the same formula; changing one without the
    // others is what gate C exists to catch.
    expect(PANORAMA_WGSL).toContain('camera.povLongitude * PI / 180.0')
    expect(PANORAMA_WGSL).not.toMatch(/povLongitude \/ 4\.0/)
  })
})
