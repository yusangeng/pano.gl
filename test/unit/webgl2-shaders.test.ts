import { describe, it, expect } from 'vitest'
import { PANORAMA_GLSL_VERTEX, PANORAMA_GLSL_FRAGMENT } from '../../src/renderer/webgl2/shaders'
import { PANORAMA_WGSL } from '../../src/renderer/webgpu/shaders'

/** The body of a `vec2 name (...)` function, or `fn name(` for the WGSL. */
function glslBody (name: string): string {
  const start = PANORAMA_GLSL_FRAGMENT.indexOf(`vec2 ${name} (`)
  expect(start, `${name} not found in the GLSL`).toBeGreaterThan(-1)
  return PANORAMA_GLSL_FRAGMENT.slice(start, PANORAMA_GLSL_FRAGMENT.indexOf('\n}', start))
}

function wgslBody (name: string): string {
  const match = PANORAMA_WGSL.match(new RegExp(`fn ${name}\\([\\s\\S]*?\\n\\}`))
  expect(match, `${name} not found in the WGSL`).not.toBeNull()
  return match![0]
}

/** Comments out, whitespace collapsed: the two languages' only shared vocabulary. */
function skeleton (source: string): string {
  return source
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join(' ')
}

describe('WebGL2 shader source', () => {
  it('starts with #version 300 es as the very first line', () => {
    // Anything before the directive -- a comment, a blank line, a generated
    // constant -- is a compile error whose message does not mention ordering.
    expect(PANORAMA_GLSL_VERTEX.startsWith('#version 300 es\n')).toBe(true)
    expect(PANORAMA_GLSL_FRAGMENT.startsWith('#version 300 es\n')).toBe(true)
  })

  it('declares a float precision in both stages', () => {
    // ES 3.00 requires an explicit float precision in the fragment stage.
    // Omitting it fails at link time with a message about the vertex shader.
    expect(PANORAMA_GLSL_FRAGMENT).toMatch(/precision\s+highp\s+float/)
    expect(PANORAMA_GLSL_VERTEX).toMatch(/precision\s+highp\s+float/)
  })

  it('declares exactly the uniforms the backend uploads', () => {
    // Six values and one sampler. A missing declaration is not an error at the
    // GL level: getUniformLocation returns null and the gl.uniform* call is
    // silently ignored, so the value stays at zero and the picture is wrong in
    // a way that looks like a projection bug. The backend throws on a null
    // location for that reason, and this test is what keeps the list the two of
    // them share honest.
    const declared = [...PANORAMA_GLSL_FRAGMENT.matchAll(/^uniform\s+\S+\s+(\w+)\s*;/gm)]
      .map(m => m[1])
      .sort()

    expect(declared).toEqual([
      'u_invClip', 'u_povLatitude', 'u_povLongitude',
      'u_projKind', 'u_tex', 'u_texProjKind', 'u_zoom'
    ])
  })

  it('uses the generated projection constants, not numeric literals', () => {
    // The legacy code maintained the same four numbers by hand in two files and
    // they agreed only by luck. A literal here is that defect coming back.
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_LINEAR')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_CYLINDRICAL')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_PLANET')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_PANNINI')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('TEXTURE_PROJECTION_EQUIRECTANGULAR')
    expect(PANORAMA_GLSL_FRAGMENT).not.toMatch(/projKind\s*==\s*\d/)
  })

  it('does not use WGSL syntax', () => {
    for (const pattern of [/@fragment/, /@vertex/, /@builtin/, /vec4f/, /mat4x4/, /\bfn\s+\w+\s*\(/]) {
      expect(PANORAMA_GLSL_FRAGMENT).not.toMatch(pattern)
      expect(PANORAMA_GLSL_VERTEX).not.toMatch(pattern)
    }
  })

  it('never adds 0.5 to the longitude', () => {
    // The single most tempting "fix" in this file. The legacy shader has no
    // +0.5, and adding one rotates the panorama half a turn -- which looks like
    // a texture-orientation problem and sends you looking in the wrong place.
    const body = skeleton(glslBody('to_uv'))
    expect(body).not.toMatch(/\+\s*0\.5/)
  })

  it('wraps u with mod and flips v, exactly as the WGSL does', () => {
    // mod(), not fract(): same function for a divisor of 1.0, and the one GLSL
    // has. The flip is the entire compensation for not setting
    // UNPACK_FLIP_Y_WEBGL on upload; dropping it renders the panorama upside
    // down and gate C would not catch it, because both shaders would still
    // agree about everything except the picture.
    const body = skeleton(glslBody('to_uv'))
    expect(body).toContain('mod(theta / TWO_PI, 1.0)')
    expect(body).toContain('1.0 - phi / PI')
  })

  it('applies the latitude term in all three non-linear projections', () => {
    // Defect F5. The legacy shader declared u_CamPOVLatitude and never read it,
    // and P3's Task 8 makes that a deliberate behaviour change. Copying the old
    // omission into the second backend would make the two backends disagree
    // only at non-zero latitude -- the hardest possible place to notice.
    for (const fn of ['project_cylindrical', 'project_planet', 'project_pannini']) {
      expect(skeleton(glslBody(fn)), `${fn} ignores latitude`).toMatch(/-\s*lat\b/)
    }
  })

  it('subtracts povLongitude / 4, not a converted angle', () => {
    // v0.2.2 subtracted degrees from radians, and the acceptance criterion is
    // "renders what v0.2.2 rendered". A degree conversion here is a real bug fix
    // and therefore not this phase's business: it changes panning sensitivity,
    // which is a user-visible decision that must not ride along with a port.
    const body = skeleton(PANORAMA_GLSL_FRAGMENT)
    expect(body).toContain('u_povLongitude / 4.0')
    expect(body).not.toMatch(/povLongitude \* PI \/ 180/)
  })

  it('uses no two-argument atan, in either source', () => {
    // atan(a, b) agrees with the fixups for linear and cylindrical and does NOT
    // agree for pannini, where the fixups run after theta is doubled. Both files
    // keep the fixups for that reason; a two-argument atan in either one is a
    // sign that someone "simplified" a projection.
    //
    // The assertions run against code, not comments (the convention of
    // shaders.test.ts's STRIPPED): both shaders' comments quote the
    // two-argument form in prose to explain why it is not used, and the GLSL
    // spells it `atan(s.z, s.x)` -- with a comma, which the raw-source match
    // would flag as the very thing it exists to catch.
    expect(skeleton(PANORAMA_GLSL_FRAGMENT)).not.toMatch(/atan\s*\([^)]*,/)
    expect(skeleton(PANORAMA_WGSL)).not.toMatch(/atan2\s*\(/)
  })

  it('transcribes the same four projection formulas as the WGSL', () => {
    // A structural check, not a numeric one: same call sites, same literal
    // vocabulary. It will not catch a wrong sign -- that is what gate C is for
    // -- but it catches the case where one file was edited and the other was
    // not edited at all, which is the actual failure mode of hand transcription.
    for (const [glslName, wgslName] of [
      ['project_linear', 'project_linear'],
      ['project_cylindrical', 'project_cylindrical'],
      ['project_planet', 'project_planet'],
      ['project_pannini', 'project_pannini']
    ] as const) {
      const glsl = skeleton(glslBody(glslName))
      const wgsl = skeleton(wgslBody(wgslName))

      const literals = (s: string) => (s.match(/\b\d+\.\d+\b/g) ?? []).sort()
      expect(literals(glsl), `${glslName} literals differ`).toEqual(literals(wgsl))
      expect(
        (glsl.match(/atan\(/g) ?? []).length,
        `${glslName} has a different number of atan call sites`
      ).toBe((wgsl.match(/atan\(/g) ?? []).length)
    }
  })
})
