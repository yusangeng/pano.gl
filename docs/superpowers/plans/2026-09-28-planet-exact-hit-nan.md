# planet-exact-hit-nan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** Replace the NaN that planet's Möbius reduction produces at its exact branch points (`p = q = 0` → `atan(0/0)`) with a spec-defined canonical value, implemented identically in WGSL, GLSL and the float64 reference.

**Architecture:** A single guard block after phi's formula assigns `theta = 1.5 * PI` and a num-based phi at every site where `p` and `q` are both exactly zero. The same statements land in all three formula copies (`panorama.wgsl`, `panorama.glsl`, `projectPlanet` in `src/core/reference.ts`); `theta -= lng` moves after the guard so the canonical theta receives the longitude subtraction like every other fragment. The existing token-for-token parity test holds the two shaders together; the f32 witness in `test/unit/reference.test.ts` pins the guarded values.

**Tech Stack:** TypeScript 5 (strict, neostandard: no semicolons, 2-space indent, single quotes), WGSL, GLSL ES 3.00, vitest.

---

## Context the executor needs

**The five branch points.** `p = q = 0` is reached at five sites:

- **A** — the lat = 0 screen centre `(y, z) = (0, 0)`: `w = 0` makes the numerator exactly zero. In float64 too, so the reference has always produced NaN here.
- **4 × B** — exact-hit sites at the ±90 latitude clamps, reachable in f32 only: f32 `sin` and `cos` of the same f32 half-angle round to identical bits, so on the **Möbius pole** columns `(y, lat) = (+1, −90)` and `(−1, +90)` the denominator's real part cancels to +0, and on the **tilt-centre** columns `(y, lat) = (−1, −90)` and `(+1, +90)` the numerator is ±0 with `d2 = 2` (no floor can reach it). The user-visible defect was ≤2 NaN texels on odd-parity viewports dragged to exactly ±90.

**The canonical rule (measured 2026-09-28 against the real reference, spec `docs/superpowers/specs/2026-09-28-planet-review-followups-design.md` §2.1–2.2, committed on master):**

- `theta := 1.5 * PI` — the **+z-side one-sided limit**, measured identical at all five sites (u → 0.75 from +z, 0.25 from −z). The preferred alternative (reproducing the four B sites' float64 values) measured infeasible: those values are `{0, 0.5, 0.5, 0}` — one-ulp landing artifacts, not constant.
- `phi` by numerator: `PI` where the denominator is the zero factor (pole sites, `num` survives), `0` where the numerator is the zero factor (centre and A sites). A theta-only guard would leave phi collapsed at `0` (shader v = 1) while the pole sites' v limit is 0 — that is why phi is in the guard.
- Statement form: two nested `if`s, **no ternary** — WGSL has no ternary operator, and the token-for-token parity test normalises only `var|let|float`/`vec2f`/`fract`, so a GLSL `?:` against a WGSL `select()` would break parity.

**Exact pin values (all measured, all bit-exact — `toBe`, not `toBeCloseTo`):**

| site | reference f64 u | reference f64 v | f32 witness u | f32 witness v (shader coords, flipped) | d2 |
|---|---|---|---|---|---|
| A `(y=0, lat=0)` | 0.75 | 0 | 0.75 | 1 | 1 |
| pole `(y=+1, lat=−90)` | 0 | 1 | 0.75 | 0 | fround(1e-15) |
| pole `(y=−1, lat=+90)` | 0.5 | 1 | 0.75 | 0 | fround(1e-15) |
| centre `(y=−1, lat=−90)` | 0.5 | 0 | 0.75 | 1 | 2 |
| centre `(y=+1, lat=+90)` | 0 | 0 | 0.75 | 1 | 2 |

Reference f64 at A with `povLongitude: 90`: u = 0.5 exactly (`(1.5π − π/2)/2π`). This pins that the guard sits **before** `theta -= lng`.

**What must NOT change:** every pixel the gates render. GATE_C_SIZE = 128 (even) and gate A/B canvases are even, so no gate fragment ever lands on a branch point — gates A/B/C must stay green with zero baseline changes. Near-site behaviour is untouched: the guard condition is exact-zero, the fixup table no-ops at branch points (q = ±0 fails both `< 0` and `> 0`), and the off-site ladder values were measured bit-identical.

**Repo rules in force:** English comments only; TSDoc/why-comments; no `atan2` anywhere; never edit `src/renderer/shaders/generated.ts`; commit prefix `task-planet-exact-hit-nan:`; end commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`; only touch files in the card scope.

---

### Task 1: reference.ts guard + float64 pins

**Files:**
- Modify: `src/core/reference.ts` (`projectPlanet`, ~lines 206–228)
- Test: `test/unit/reference.test.ts`

- [x] **Step 1: Add the failing canonical-value test**

In `test/unit/reference.test.ts`, inside `describe('planet tilt (the steerable centre, 2026-09-28 spec)', ...)`, insert this `it` **after** the `it('pins the Mobius pole the other blocks sample around', ...)` block (ends ~line 583) and **before** the `it('witnesses the f32 floored path...')` block:

```ts
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
      // [y, lat, u, v] -- Mobius pole sites first, then tilt centres.
      [1, -90, 0, 1],
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
```

(`projection` is the describe-level `const projection: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }` — reuse it, do not redeclare.)

- [x] **Step 2: Run to verify the new test fails**

Run: `npx vitest run test/unit/reference.test.ts`
Expected: FAIL — `takes the canonical branch-point value` reports `expected NaN to be 0.75` (the centre's u is the faithful NaN). Every other test in the file passes.

- [x] **Step 3: Add the guard to projectPlanet in src/core/reference.ts**

Replace the tail of `projectPlanet` (currently `let theta = Math.atan(p / q)` through `return toUV(theta, phi)`) with:

```ts
  let theta = Math.atan(p / q)

  if (q < 0) {
    theta = PI + theta
  } else if (q > 0 && p < 0) {
    theta = TWO_PI + theta
  }

  let phi = Math.atan(r / Math.sqrt(p * p + q * q)) + HALF_PI

  // The Mobius reduction's branch points: p = q = 0 makes the atan above
  // atan(0/0) and collapses phi's argument to -1/0. The canonical values
  // are the +z-side one-sided limits, measured identical at every branch
  // point: theta = 1.5*PI, and phi = PI where the denominator is the zero
  // factor (the Mobius pole, num nonzero) versus 0 where the numerator is
  // (w = 0: the lat = 0 centre, and the tilt centres at the +-90 clamps).
  // 2026-09-28 planet-review-followups spec, section 2.2. In float64 this
  // guard fires only at the lat = 0 centre -- at the +-90 exact-hit sites
  // sin and cos of the half-angle differ by one ulp, num and den stay
  // nonzero, and the formula's own finite values stand (pinned, as
  // non-normative artifacts, in test/unit/reference.test.ts).
  if (p === 0 && q === 0) {
    theta = 1.5 * PI
    phi = PI
    if (numRe === 0 && numIm === 0) {
      phi = 0
    }
  }

  theta -= lng
  return toUV(theta, phi)
}
```

Two changes beyond the insertion: `const phi` becomes `let phi`, and `theta -= lng` moves from before phi's line to after the guard (no data dependency; the canonical theta must receive the same longitude subtraction as every other fragment's).

- [x] **Step 4: Run — one expected failure remains**

Run: `npx vitest run test/unit/reference.test.ts`
Expected: the new canonical test PASSES. `keeps the NaNs the legacy shader produced at the degenerate points` now FAILS on its planet line (`expected 0.75 to be NaN`) — that pin is the old stance this task removes. Everything else passes.

- [x] **Step 5: Flip the three planet-departure edits in reference.test.ts**

5a. The file-header comment above `isDegenerate` becomes:

```ts
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
```

5b. The `planet` case inside `isDegenerate` becomes:

```ts
    case 'planet':
      // The Mobius branch points (p = q = 0, including y = z = 0 at lat 0)
      // take a canonical value since 2026-09-28, so nothing here is
      // degenerate any more -- the sweeps below now cover (0, 0) too.
      return false
```

5c. In `it('keeps the NaNs the legacy shader produced at the degenerate points', ...)`, delete the planet block

```ts
    const planet: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
    // The planet centre is the one degenerate point that lies ON the surface
    // itself (x is never read, so the x = 1 plane does not save it).
    expect(project(1, 0, 0, state, planet).u).toBeNaN()
```

and extend the leading comment with the departure note, so the test reads:

```ts
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
```

- [x] **Step 6: Run the whole file green**

Run: `npx vitest run test/unit/reference.test.ts`
Expected: PASS, all tests. (The range/no-NaN sweeps now include planet (0, 0): the guarded value u = 0.75, v = 0 is inside [0, 1] and finite — if a sweep fails, the guard's values are wrong, not the sweep.)

- [x] **Step 7: Commit**

```bash
git add src/core/reference.ts test/unit/reference.test.ts
git commit -m "task-planet-exact-hit-nan: canonical branch-point value in the float64 reference

The Mobius reduction's p = q = 0 sites (lat 0 centre, and the f32-only
+-90 exact-hit sites) took atan(0/0) = NaN. The guard assigns the +z-side
one-sided limits per the 2026-09-28 planet-review-followups spec 2.2:
theta = 1.5*PI, phi = PI/0 by which factor is zero. The faithful-NaN pin
for the centre flips to the canonical 0.75/0, the four B-site float64
artifacts are pinned as non-normative, and planet leaves isDegenerate.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: both shaders, structural pins, f32 witness

**Files:**
- Modify: `src/renderer/webgpu/shaders/panorama.wgsl` (`project_planet`, ~lines 172–236)
- Modify: `src/renderer/webgl2/shaders/panorama.glsl` (`project_planet`, ~lines 147–215)
- Test: `test/unit/webgl2-shaders.test.ts`
- Test: `test/unit/reference.test.ts` (the f32 witness block)

The two shaders must be edited **identically** — the token-for-token parity test fails between the two edits, which is expected; do not run it as a checkpoint between them.

- [x] **Step 1: Add the failing structural pin**

In `test/unit/webgl2-shaders.test.ts`, immediately after the `it('tilts planet through a Mobius pre-transform of the plane point', ...)` test, add:

```ts
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
  })
```

- [x] **Step 2: Run to verify it fails**

Run: `npx vitest run test/unit/webgl2-shaders.test.ts`
Expected: FAIL — `assigns the canonical branch-point value` (the guard is absent). The token-for-token parity test still PASSES (neither shader edited yet).

- [x] **Step 3: Edit the WGSL — comment rewrite + guard**

In `src/renderer/webgpu/shaders/panorama.wgsl`, `project_planet`:

3a. Replace the comment tail that currently ends the long floor comment block (the old text below starts mid-sentence on purpose: the line above it in the file ends "…the floor stops one" and joins this block's first word "link short:" — the replacement's first line is the same continuation, so the seam reads through unchanged):

```wgsl
  // link short: at the lat = +-90 clamps, f32 sin and cos of the same f32
  // half-angle round to the same bits, den_re cancels to +0, the floor then
  // yields zn = yn = +-0, and atan(p / q) becomes atan(0 / 0) = NaN. The
  // tilt's own centre w' = 0 (y = tan(tilt / 2), exactly +-1 at those same
  // clamps) is a second NaN site with d2 = 2, beyond any floor. Both need
  // lat exactly at the clamp and a fragment centre landing exactly on them:
  // at zoom 1 that is odd width with height = 2 mod 4, and other zoom
  // values reach the same y = +-1 through other rational rows; both are
  // the single-NaN-texel class the lat = 0 centre pixel has always carried,
  // kept rather than normalised per the reference's faithful-NaN stance. The
  // float64 reference deliberately carries no floor -- it is the arbiter, and
  // its tests sample around the pole, never on it.
```

with:

```wgsl
  // link short: at the lat = +-90 clamps, f32 sin and cos of the same f32
  // half-angle round to the same bits, den_re cancels to +0, the floor then
  // yields zn = yn = +-0, and atan(p / q) becomes atan(0 / 0) = NaN. The
  // tilt's own centre w' = 0 (y = tan(tilt / 2), exactly +-1 at those same
  // clamps) is a second such site with d2 = 2, beyond any floor. Both need
  // lat exactly at the clamp and a fragment centre landing exactly on them:
  // at zoom 1 that is odd width with height = 2 mod 4, and other zoom
  // values reach the same y = +-1 through other rational rows. Since
  // 2026-09-28 these branch points take the canonical value instead of the
  // NaN this comment used to record as kept (planet-review-followups spec,
  // section 2.2, superseding the faithful-NaN stance): the guard after
  // phi's formula below assigns theta and phi their +z-side one-sided
  // limits, measured identical at every branch point on the float64
  // arbiter. The float64 reference still carries no floor -- it is the
  // arbiter -- but it carries the same guard, firing in float64 only at
  // the lat = 0 centre.
```

3b. Replace the statement tail

```wgsl
  theta -= lng;

  let phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;
  return to_uv(theta, phi);
```

with:

```wgsl
  var phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;

  // The Mobius reduction's branch points: p and q both exactly zero make
  // the atan above atan(0/0) and collapse phi's argument to -1/0. The
  // canonical values are the +z-side one-sided limits, measured identical
  // at every branch point on the float64 arbiter (2026-09-28
  // planet-review-followups spec, section 2.2): theta = 1.5*PI, and
  // phi = PI where the denominator is the zero factor (the Mobius pole,
  // num nonzero) versus 0 where the numerator is (w = 0). The lng
  // subtraction runs after the guard so the canonical theta receives it
  // like every other fragment's.
  if (p == 0.0 && q == 0.0) {
    theta = 1.5 * PI;
    phi = PI;
    if (num_re == 0.0 && num_im == 0.0) {
      phi = 0.0;
    }
  }

  theta -= lng;
  return to_uv(theta, phi);
```

(`theta` is already `var`; `phi` changes from `let` to `var`.)

- [x] **Step 4: Edit the GLSL — the same two edits, token for token**

In `src/renderer/webgl2/shaders/panorama.glsl`, `project_planet`:

4a. Replace the identical comment tail (same text as 3a's old block, same mid-sentence start) with the identical new block from 3a.

4b. Replace the statement tail

```glsl
  theta -= lng;

  float phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;
  return to_uv(theta, phi);
```

with:

```glsl
  float phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;

  // The Mobius reduction's branch points: p and q both exactly zero make
  // the atan above atan(0/0) and collapse phi's argument to -1/0. The
  // canonical values are the +z-side one-sided limits, measured identical
  // at every branch point on the float64 arbiter (2026-09-28
  // planet-review-followups spec, section 2.2): theta = 1.5*PI, and
  // phi = PI where the denominator is the zero factor (the Mobius pole,
  // num nonzero) versus 0 where the numerator is (w = 0). The lng
  // subtraction runs after the guard so the canonical theta receives it
  // like every other fragment's.
  if (p == 0.0 && q == 0.0) {
    theta = 1.5 * PI;
    phi = PI;
    if (num_re == 0.0 && num_im == 0.0) {
      phi = 0.0;
    }
  }

  theta -= lng;
  return to_uv(theta, phi);
```

(GLSL locals are mutable, so `float phi` needs no keyword change; the guard text is byte-identical to the WGSL's.)

- [x] **Step 5: Run the shader tests green**

Run: `npx vitest run test/unit/webgl2-shaders.test.ts`
Expected: PASS, all tests — the new structural pins, the token-for-token parity (the guard landed in both bodies), the literal multiset and atan-count checks (`1.5` and `0.0` added equally to both), the atan2 ban and the `- lat` tripwire (the guard mentions neither).

- [x] **Step 6: Flip the f32 witness in reference.test.ts**

In `test/unit/reference.test.ts`, `it('witnesses the f32 floored path the shaders run: floor fires, atan(0/0) remains', ...)`:

6a. Retitle to `it('witnesses the f32 floored path the shaders run: floor fires, branch points take the canonical value', ...)`, and in the block's leading comment extend the elisions sentence `lng pinned at 0 (theta -= 0 changes no bit)` to `lng pinned at 0 (theta -= 0 changes no bit, before or after the guard)`.

6b. In the `shaderPlanet` body, replace

```ts
      let theta = Math.atan(f(p / q))
      if (q < 0) theta = f(f(Math.PI) + theta)
      else if (q > 0 && p < 0) theta = f(f(f(2) * F32_PI) + theta)
      const phi = f(f(Math.atan(f(r / f(Math.sqrt(f(f(p * p) + f(q * q))))))) + f(F32_PI / f(2)))
      const u = f(theta / f(f(2) * F32_PI))
      const v = f(1 - f(phi / f(Math.PI)))
      return { u, v, d2 }
```

with the guarded transcription (same statement order as the shaders):

```ts
      let theta = Math.atan(f(p / q))
      if (q < 0) theta = f(f(Math.PI) + theta)
      else if (q > 0 && p < 0) theta = f(f(f(2) * F32_PI) + theta)
      let phi = f(f(Math.atan(f(r / f(Math.sqrt(f(f(p * p) + f(q * q))))))) + f(F32_PI / f(2)))
      // The shaders' branch-point guard, transcribed: f32(f32(1.5) * PI)
      // then divides by f32(2) * PI exactly, so u is the canonical 0.75
      // bit for bit, and phi takes the site's own limit.
      if (p === 0 && q === 0) {
        theta = f(f(1.5) * F32_PI)
        phi = F32_PI
        if (numRe === 0 && numIm === 0) {
          phi = 0
        }
      }
      const u = f(theta / f(f(2) * F32_PI))
      const v = f(1 - f(phi / f(Math.PI)))
      return { u, v, d2 }
```

6c. Replace the exact-sites comment and loop

```ts
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
```

with:

```ts
    // Exactly on the branch points, all four (both clamps, both signs of
    // y): the guard fires and u is the canonical 0.75 bit for bit
    // (f32(f32(1.5) * PI) / (f32(2) * PI) is exact), while v takes the phi
    // limit of its site -- 0 on the Mobius pole (num survives the
    // cancellation, phi = PI), 1 on the tilt centre (num is the zero
    // factor, phi = 0, flipped by to_uv). The d2 pins still say which site
    // is which: the pole's denominator zero is floored up from 0, the
    // centre's own w' = 0 carries d2 = O(1) -- no floor can ever reach
    // that one.
    const exactSites: Array<[number, number, 'pole' | 'centre']> = [
      [1, -90, 'pole'],
      [-1, 90, 'pole'],
      [-1, -90, 'centre'],
      [1, 90, 'centre']
    ]
    for (const [y, latDeg, kind] of exactSites) {
      const hit = shaderPlanet(y, 0, latDeg)
      expect(hit.u, `u canonical on the ${kind} site (y=${y}) at lat=${latDeg}`).toBe(0.75)
      expect(hit.v, `v at the ${kind} limit on (y=${y}) lat=${latDeg}`).toBe(kind === 'pole' ? 0 : 1)
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

    // The lat = 0 centre (the A-class site) through the same f32 path: the
    // guard fires here too, with d2 = 1 -- an ordinary division, the floor
    // nowhere near firing -- u canonical, v at the phi = 0 limit.
    const centre = shaderPlanet(0, 0, 0)
    expect(centre.u).toBe(0.75)
    expect(centre.v).toBe(1)
    expect(centre.d2).toBe(1)
```

- [x] **Step 7: Run the reference tests green**

Run: `npx vitest run test/unit/reference.test.ts`
Expected: PASS, all tests — the near-site ladder pins are untouched (the guard is exact-zero and was measured not to perturb any rung; if a ladder pin fails, the guard condition or the transcription is wrong).

- [x] **Step 8: Commit**

```bash
git add src/renderer/webgpu/shaders/panorama.wgsl src/renderer/webgl2/shaders/panorama.glsl \
  test/unit/webgl2-shaders.test.ts test/unit/reference.test.ts
git commit -m "task-planet-exact-hit-nan: canonical branch-point guard in both shaders

Same statements, token for token, in WGSL and GLSL: after phi's formula,
p == 0 && q == 0 assigns theta = 1.5*PI and phi = PI/0 by which Mobius
factor is zero; theta -= lng moves after the guard so the canonical theta
is longitude-rotated like every other fragment. The f32 witness gains the
same guard; the exact-hit u pins flip from NaN to the canonical 0.75 and
v to the per-site limit. Structural pins added for the guard expressions.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: erratum in the planet-drag-semantics spec

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md` (§2.3, ~line 79)

- [x] **Step 1: Append the dated erratum to §2.3**

At the end of the §2.3 paragraph (the one carrying the existing `**2026-09-28 勘误（plan 期推导）**：` — append after its last sentence `…且测试采样点避开分母零点。`), append:

```markdown
**2026-09-28 二次勘误（planet-review-followups spec §2.4）**：上文「极限值连续（p, q → 0，r → 1, phi → π）」在**精确分支点**不成立——floor 在极点**附近**交付有限 zn/yn（f32 证人钉住的档位），但 lat 恰 ±90 的精确命中站点上 f32 `sin`/`cos` 对同一半角舍入到同一位，`den_re` 恰 +0（Möbius 极点站点）或分子恰 ±0（倾斜中心站点，d2 = 2，任何 d2 下限夹持够不着）→ `p = q = 0` → `atan(0/0) = NaN`；phi 的连续极限也按站点分侧（极点站点 → π，中心站点 → 0），不存在单一 phi 极限值。按 2026-09-28 用户裁决，分支点在三处实现（WGSL / GLSL / reference.ts）由显式守卫取规范值 `theta = 1.5·π`、phi 按零因子侧取 π/0，详见 planet-review-followups spec §2.1–2.2。本 spec 的任务卡是历史记录，实现以该 spec 为准。
```

- [x] **Step 2: Proofread the erratum**

Re-read the appended paragraph: no typos, the two spec cross-references (`planet-review-followups spec §2.4` / `§2.1–2.2`) match the section numbers of `docs/superpowers/specs/2026-09-28-planet-review-followups-design.md` (the erratum clause lives in its §2.4; the rule in §2.1–2.2).

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md
git commit -m "task-planet-exact-hit-nan: second erratum in the planet-drag-semantics spec 2.3

The 'limits stay continuous' claim does not hold at the exact branch
points: the floor delivers finite zn/yn near the pole, but at the exact
+-90 hit sites p = q = 0 and atan(0/0) = NaN, and phi's limit is
side-dependent. Records the 2026-09-28 adjudication that supersedes it.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: full verify

**Files:** none (verification only)

- [x] **Step 1: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean (three tsc programs; eslint over src, test, scripts, demo).

- [x] **Step 2: Build**

Run: `npm run build`
Expected: clean (`dist/` ESM + CJS + `.d.ts`).

- [x] **Step 3: The card verify — unit then integration**

Run: `npm test`
Expected: ALL green. In particular:
- Gates A/B/C pass with **zero pixel change** — every gate canvas is even-sized, so no gate fragment lands on a branch point and the guard never fires under test. A gate failure means the guard fired somewhere it must not (or a transcription typo changed ordinary pixels): fix before finishing, do not touch baselines.
- The `no-webgpu` project's fallback tests are unaffected (no shader-pipeline change beyond the formula text).

- [x] **Step 4: Write the completion report and finish**

Append to the task card's「完成报告」section: what was done (guard in three places, pin flips, erratum), self-test results (the commands above with outcomes), deviations from this plan (none expected), residual risks (none expected — if any gate behaved unexpectedly and was resolved, record it). Then run the superloop finish gate per the executor contract.

---

## Self-review notes (for the executor's benefit, not a task)

- The guard's phi discrimination reads `num_re`/`num_im` (`numRe`/`numIm` in reference.ts) — the Möbius locals already in scope in all three bodies; no new declarations anywhere.
- Do not "simplify" `theta = 1.5 * PI` to `theta = PI + HALF_PI` or any other spelling: the token parity and the structural pin compare the literal text, and the three copies must stay同文 (character-identical modulo language spelling).
- The ladder pins in the witness (`u homing on 0.75`, floor firing at eps = 1e-8) were measured bit-identical after the guard lands; they are the regression net for "the guard leaks off-site".
