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
    // One alternation, one scan. Two sequential passes -- `//` first, then
    // `/*...*/` -- let a `//` inside a block comment eat through the closing
    // `*/` and leave the block's opening half behind as residue
    // (`'/* see https:'` survives as `'/* see '`). With the alternation the
    // block-comment branch consumes the whole `/*...*/` region, embedded `//`
    // included, because the engine takes it as one match from the leftmost
    // position.
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join(' ')
}

/**
 * A function body reduced to language-neutral tokens, so the GLSL and WGSL
 * copies can be compared as exact sequences rather than as multisets.
 *
 * The rules, in order:
 *   1. comments out, whitespace collapsed (skeleton);
 *   2. everything up to and including the first `{` is dropped -- the two
 *      signatures spell one thing too differently to normalise
 *      (`vec2 name (vec3 s)` vs `fn name(s: vec3f) -> vec2f`);
 *   3. WGSL vocabulary maps onto GLSL's: `vec2f(` becomes `vec2(`, `fract(A)`
 *      becomes `mod(A, 1.0)` where A holds no parenthesis (to_uv's argument
 *      is the only fract site and is paren-free), and the declaration
 *      keywords `var` / `let` join GLSL's `float` in being dropped, so
 *      `let y = ...` and `float y = ...` both reduce to `y = ...`;
 *   4. braces are dropped: the WGSL extractor reaches the function's closing
 *      brace and the GLSL one stops just short of it, and the if-chain
 *      structure survives in the `if` / `else` tokens anyway;
 *   5. the remainder is split into identifier, numeric-literal and
 *      single-character punctuation tokens.
 *
 * There is no uniform-name rule because none of the five bodies compared here
 * reads a uniform -- `u_*` appears only in main().
 */
function bodyTokens (body: string): string[] {
  const skel = skeleton(body)
  const normalised = skel
    .slice(skel.indexOf('{') + 1)
    .replace(/vec2f\s*\(/g, 'vec2(')
    .replace(/fract\s*\(([^()]*)\)/g, 'mod($1, 1.0)')
    .replace(/\b(?:var|let|float)\s+/g, '')
    .replace(/[{}]/g, '')
  return normalised.match(/[A-Za-z_]\w*|\d+(?:\.\d+)?|[^\sA-Za-z0-9_]/g) ?? []
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
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_MERCATOR')
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

  it('applies the latitude term in cylindrical and pannini', () => {
    // Defect F5. The legacy shader declared u_CamPOVLatitude and never read it,
    // and P3's Task 8 makes that a deliberate behaviour change. Copying the old
    // omission into the second backend would make the two backends disagree
    // only at non-zero latitude -- the hardest possible place to notice.
    // Planet left this table on 2026-09-28: its latitude is no longer a phi
    // offset but the tilt of a Mobius pre-transform, pinned by the 'tilts planet
    // through a Mobius pre-transform of the plane point' test.
    for (const fn of ['project_cylindrical', 'project_pannini']) {
      expect(skeleton(glslBody(fn)), `${fn} ignores latitude`).toMatch(/-\s*lat\b/)
    }
  })

  it('tilts planet through a Mobius pre-transform of the plane point', () => {
    // 2026-09-28 planet-drag-semantics spec section 2.1. The structural pins:
    // the half-angle trig of the tilt, the component-wise complex division,
    // and the denominator floor that keeps the excluded point's viewport
    // crossing finite (section 2.3). The 'transcribes the same formulas as
    // the WGSL, token for token' test holds the WGSL twin to the same shape,
    // and gate C holds both to the reference.
    const body = skeleton(glslBody('project_planet'))
    expect(body, 'half-angle trig of the tilt is missing').toContain('tilt * 0.5')
    expect(body, 'the complex division is not component-wise').toContain('den_re * den_re + den_im * den_im')
    expect(body, 'the excluded-point floor is missing').toContain('1e-15')
  })

  it('assigns the canonical branch-point value where p and q are both zero', () => {
    // 2026-09-28 planet-review-followups spec, section 2.2. Structural pins
    // for the guard: its condition, the canonical theta, and the num-based
    // phi discrimination (statement form, no ternary -- WGSL has none, and
    // the token-for-token test below compares the two bodies as sequences).
    // The 'transcribes the same formulas as the WGSL, token for token' test
    // holds the WGSL twin to the same statements; the f32 witness in
    // test/unit/reference.test.ts pins the values.
    const body = skeleton(glslBody('project_planet'))
    expect(body, 'the guard condition is missing').toContain('p == 0.0 && q == 0.0')
    expect(body, 'the canonical theta is missing').toContain('theta = 1.5 * PI')
    expect(body, 'the phi discrimination is missing').toContain('num_re == 0.0 && num_im == 0.0')
    expect(body, 'the phi pole value is missing').toContain('phi = PI')
    expect(body, 'the phi zero value is missing').toContain('phi = 0.0')

    // Ordered pin, the role and position net. The five pins above are
    // diagnostics only: the ordered string below contains all five
    // substrings, so they add no killing power beyond it -- their value is
    // naming which piece went missing when one of them fails. The token
    // parity is symmetric under an edit made to both files at once: swap
    // the phi arms, or hoist theta -= lng back above the guard (where
    // cylindrical and pannini carry it), and every other test in the repo
    // stays green -- the f32 witness pins lng at 0, and gate C's even
    // canvas never rasterises a guarded texel. The whole collapsed guard
    // plus its tail, one string.
    expect(body, 'the guard arms or position changed').toContain(
      'if (p == 0.0 && q == 0.0) { theta = 1.5 * PI; phi = PI; ' +
        'if (num_re == 0.0 && num_im == 0.0) { phi = 0.0; } } theta -= lng; return to_uv'
    )
  })

  it('planet no longer carries the phi latitude offset the tilt replaced', () => {
    // The pre-2026-09-28 body ended with 'atan(...) + HALF_PI - lat'. A merge
    // that keeps that term alongside the Mobius tilt passes every parity test
    // (both shaders edited identically) and every structural pin above (the
    // tilt tokens are all present) -- only gate C on a real GPU would notice.
    // The inverse of the cylindrical/pannini assertion above is the unit-level
    // tripwire for exactly that stale term. 'tilt = lat' and '- st' do not
    // match, and skeleton strips comments, so the assertion is exact.
    expect(skeleton(glslBody('project_planet')), 'the stale phi offset survived next to the tilt')
      .not.toMatch(/-\s*lat\b/)
  })

  it('subtracts an honestly converted povLongitude, not / 4.0', () => {
    // v0.2.2 subtracted degrees from radians; the port carried that through as
    // the deliberate retention recorded in v1-design §11.4 (B1), corrected
    // 2026-09-23 by user adjudication (pan-zoom-semantics spec §1, which
    // supersedes that retention). The WGSL twin and `lngOffset` in
    // src/core/reference.ts carry the same formula -- gate C holds the three
    // together.
    const body = skeleton(PANORAMA_GLSL_FRAGMENT)
    expect(body).toContain('u_povLongitude * PI / 180.0')
    expect(body).not.toMatch(/u_povLongitude \/ 4\.0/)
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

  it('transcribes the same formulas as the WGSL, token for token', () => {
    // The token comparison is the load-bearing assertion: each body is
    // normalised to a shared vocabulary (rules at bodyTokens) and compared as
    // an exact sequence, so an edit to one file's formula that does not appear
    // in the other -- a flipped sign, a swapped operand -- fails here. The
    // multiset checks below cannot do that: they are symmetric under edits
    // that preserve both (`theta -= lng` becoming `theta += lng` keeps every
    // literal and every atan call site), which is why they stay only as a
    // coarser first signal. Gate C remains the authority on rendering; this is
    // the unit-level tripwire for the actual failure mode of hand
    // transcription, one file edited and the other not.
    for (const fn of ['to_uv', 'project_linear', 'project_cylindrical', 'project_planet', 'project_pannini', 'project_mercator']) {
      expect(
        bodyTokens(glslBody(fn)),
        `${fn}: the GLSL body is not the WGSL body token for token`
      ).toEqual(bodyTokens(wgslBody(fn)))
    }

    // to_uv is absent from this loop on purpose: its GLSL carries mod's `1.0`
    // divisor where the WGSL's fract has none, so the raw literal multisets
    // differ by design -- the normalised comparison above, which applies the
    // fract-to-mod mapping, is where to_uv is held.
    for (const fn of ['project_linear', 'project_cylindrical', 'project_planet', 'project_pannini', 'project_mercator']) {
      const glsl = skeleton(glslBody(fn))
      const wgsl = skeleton(wgslBody(fn))

      const literals = (s: string) => (s.match(/\b\d+\.\d+\b/g) ?? []).sort()
      expect(literals(glsl), `${fn} literals differ`).toEqual(literals(wgsl))
      expect(
        (glsl.match(/atan\(/g) ?? []).length,
        `${fn} has a different number of atan call sites`
      ).toBe((wgsl.match(/atan\(/g) ?? []).length)
    }
  })

  it('project_mercator is the spec formula in both files: negated atanh(sin(lat)), asin(tanh) form', () => {
    // Mercator stays out of the latitude-usage loop above on purpose: its
    // term is `- atanh(sin(lat))`, which that loop's /-\s*lat\b/ regex does
    // not match. This pin is its substitute, and it holds both files to the
    // spec's two load-bearing choices: the NEGATED atanh (I2, centre parity
    // with cylindrical) and the asin(tanh) form (spec 2.4, f32-safe near the
    // poles where the exp form overflows). The token comparison above already
    // proves the two files agree with each other; this pins what they agree
    // ON.
    for (const body of [glslBody('project_mercator'), wgslBody('project_mercator')]) {
      expect(body).toContain('- atanh(sin(lat))')
      expect(body).toContain('asin(tanh(m))')
    }
  })
})
