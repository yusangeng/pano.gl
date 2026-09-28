# gate-c-planet-arbiter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** Give gate C a pixel-level third-party arbiter for planet — the same `compareWithReference` leg cylindrical already has, at the tilted pose STATES[1] (lat 30 / lng 45 / zoom 1), with a tolerance measured on the machine that runs it.

**Architecture:** One new `it()` in `test/integration/gate-c-cross-backend.test.ts`, directly after the existing cylindrical arbiter test. No support changes: `compareWithReference(camera, projection)` in `test/integration/support/cross-backend.ts` is kind-agnostic (it feeds the pair through `project()` in `src/core/reference.ts`), and `projectionFor('planet', s)` already yields the correct `{ kind: 'planet', zoom: 1, extent: [4, 4] }`. The only unknown is the tolerance, and the spec (`docs/superpowers/specs/2026-09-28-planet-review-followups-design.md` §3) forbids presetting it: it must be **measured, bounded, derived in a comment, and carry headroom** (容差四要求). The plan therefore lands the test in probe form first, runs it on a real GPU, then pins the bound by a stated rule from the printed numbers.

**Tech Stack:** TypeScript 5 (strict, neostandard: no semicolons, 2-space indent, single quotes), vitest browser mode (integration project: real GPU, Chromium).

---

## Context the executor needs

**Why this leg exists.** Gate C has two kinds of tests: pairwise WebGPU-vs-WebGL2 (≤2), and the arbiter leg that compares both against the float64 CPU reference. The pairwise leg is constructively blind to both shaders being wrong together — the formulas are hand-transcribed twice, and a transcription error repeated in both files agrees perfectly. The arbiter leg covered cylindrical only; planet (the longest, most error-prone formula chain in the file) had no third opinion. This leg closes that: if it ever fails while the pairwise tests pass, the two backends are consistently wrong together.

**Why state 1, why lat 30.** `STATES[1]` in the file is `{ povLatitude: 30, povLongitude: 45, fov: (75 * Math.PI) / 180, zoom: 1 }`. Lat 30 keeps the pole off-screen (no compression blow-up — that is the documented poles exception, a different test), lng 45 exercises a non-zero pose where the formulas can actually disagree, and the 128×128 even canvas never lands a fragment centre on a planet branch point (and those take a canonical value since 2026-09-28 regardless — card `planet-exact-hit-nan`, independent of this one).

**Why probe-then-pin.** The expected tolerance is genuinely unknown: planet's per-fragment Möbius chain (two f32 divisions, sqrt, atan) is longer than cylindrical's (whose pin is ≤3), but how much larger the accumulated channel difference is depends on the GPU's f32 transcendentals. The spec pins the procedure, not the number: measure first, then bound. The probe run needs a real GPU — the `integration` project asserts a non-null WebGPU adapter and fails loudly without one.

**Bound rule (fixed, only the measured input varies):** the pin is the **smallest power of two strictly greater than 2× the larger of the two measured maxima**. Rationale: the 2× factor absorbs run-to-run and driver variation; the power-of-two step absorbs a different f32 transcendental implementation (CI runs SwiftShader under `CI=1`; a dev machine runs hardware) without getting so loose that a real break — which shows up as a frame-wide uniform difference — hides under it.

**Repo rules in force:** English comments only; commit prefix `task-gate-c-planet-arbiter:`; end commit messages with `Co-Authored-By: Claude Code <noreply@anthropic.com>`; only touch `test/integration/gate-c-cross-backend.test.ts`; do not touch the cylindrical arbiter leg's ≤3, the pairwise legs' ≤2, or the poles exception test.

---

### Task 1: the probe leg

**Files:**
- Modify: `test/integration/gate-c-cross-backend.test.ts` (insert after the cylindrical arbiter `it`, which ends with the `expect(r.webgl2).toBeLessThanOrEqual(3)` line, before `it('the poles are the documented exception', ...)`)

- [x] **Step 1: Insert the probe test**

```ts
  it('the CPU reference arbitrates planet too, at a tilted pose', async () => {
    // 2026-09-28 planet-review-followups spec, section 3: gate C's arbiter leg
    // covered cylindrical only, so a pair of shaders agreeing on a wrong
    // planet transcription had no third opinion. State 1 (lat 30) keeps the
    // pole off-screen and the 128 even canvas never lands a fragment centre
    // on a branch point. PROBE FORM: the tolerance is measured before it is
    // pinned (spec's four requirements), so this run prints the maxima and
    // only asserts not-garbage; Task 2 replaces both with the pinned bound.
    const s = STATES[1]!
    const r = await compareWithReference(state(s), projectionFor('planet', s))

    console.log(`planet arbiter probe: webgpu=${r.webgpu} webgl2=${r.webgl2}`)
    expect(Number.isFinite(r.webgpu) && Number.isFinite(r.webgl2), 'probe: the maxima must be finite numbers').toBe(true)
    expect(r.webgpu, 'probe: not garbage (garbage is frame-wide, near the channel max)').toBeLessThan(128)
    expect(r.webgl2, 'probe: not garbage (garbage is frame-wide, near the channel max)').toBeLessThan(128)
  })
```

- [x] **Step 2: Run the integration project on this file**

Run: `npx vitest run --project integration test/integration/gate-c-cross-backend.test.ts`
Expected: ALL green (the probe bounds are deliberately loose). Note the `planet arbiter probe: webgpu=… webgl2=…` line in the output — those two numbers are the measured maxima. This needs a machine with WebGPU; the project's setup file fails loudly without one (that is by design — do not weaken it).

- [x] **Step 3: Record the measured maxima**

Write the two numbers down (e.g. in the completion report draft): `webgpu = M1`, `webgl2 = M2`. Sanity-check them against the derivation in Task 2's comment: both should be single-digit to low-double-digit channel differences (cylindrical's pin is 3; planet's chain is a few links longer). **If either is near or above 64, stop and investigate before pinning** — that is not accumulated ulps, that is a real disagreement the pairwise legs cannot see, and pinning a bound under it would paper over exactly the defect this leg exists to catch. Investigate with the CPU reference arbiter in `src/core/reference.ts` (it is the arbiter by design; run the three-way comparison and find the odd one out).

- [x] **Step 4: Commit the probe (only if Task 2's pin lands in the same working session)**

Skip this step if pinning follows immediately — one commit for the pinned leg is cleaner. If the probe must be committed alone (session break), commit it as:

```bash
git add test/integration/gate-c-cross-backend.test.ts
git commit -m "task-gate-c-planet-arbiter: probe leg for the planet arbiter tolerance

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: pin the bound

**Files:**
- Modify: `test/integration/gate-c-cross-backend.test.ts` (the test added in Task 1)

- [x] **Step 1: Compute the bound from the measured maxima**

With `Mmax = max(M1, M2)` from Task 1's run: the bound is the smallest power of two strictly greater than `2 × Mmax`. Examples of the rule: Mmax = 3 → 2×3 = 6 → bound 8; Mmax = 9 → 18 → bound 32; Mmax = 17 → 34 → bound 64.

- [x] **Step 2: Replace the probe with the pinned test**

Replace the whole `it('the CPU reference arbitrates planet too, at a tilted pose', ...)` block from Task 1 with (fill `M1`, `M2` and `BOUND` with the measured values and the computed bound — every other placeholder-looking token is literal):

```ts
  it('the CPU reference arbitrates planet too, at a tilted pose', async () => {
    // 2026-09-28 planet-review-followups spec, section 3: gate C's arbiter leg
    // covered cylindrical only, so a pair of shaders agreeing on a wrong
    // planet transcription had no third opinion. State 1 (lat 30) keeps the
    // pole off-screen and the 128 even canvas never lands a fragment centre
    // on a branch point.
    //
    // Tolerance, per the spec's four requirements:
    // - measured: webgpu M1, webgl2 M2, probe run of this file on this
    //   machine's GPU (2026-09-28); the pin is not a guess;
    // - derived: planet runs a longer per-fragment chain than cylindrical
    //   (whose pin is <= 3 above) -- the Mobius complex division adds two
    //   f32 divisions plus sqrt and atan per fragment, and the 4x4 extent
    //   samples a wider stretch of the surface, so a few ulps per link land
    //   a few channels apart after the shared bilinear fetch, whose hardware
    //   weights are quantized to sub-texel bits;
    // - bounded: BOUND, the smallest power of two strictly above twice the
    //   larger measured maximum;
    // - headroom: the 2x factor plus the power-of-two step absorb a
    //   different f32 transcendental implementation (CI runs SwiftShader,
    //   this machine ran hardware) without masking a real break, which
    //   shows up as a frame-wide uniform difference far above this bound.
    const s = STATES[1]!
    const r = await compareWithReference(state(s), projectionFor('planet', s))

    expect(r.webgpu).toBeLessThanOrEqual(BOUND)
    expect(r.webgl2).toBeLessThanOrEqual(BOUND)
  })
```

- [x] **Step 3: Run the file green**

Run: `npx vitest run --project integration test/integration/gate-c-cross-backend.test.ts`
Expected: ALL green — the new leg comfortably inside BOUND, the cylindrical arbiter still ≤3, the pairwise legs still ≤2, the poles exception untouched.

- [x] **Step 4: Commit**

```bash
git add test/integration/gate-c-cross-backend.test.ts
git commit -m "task-gate-c-planet-arbiter: planet arbiter leg in gate C

compareWithReference at STATES[1] (planet lat 30 / lng 45 / zoom 1) gives
the tilted pose a third opinion next to the cylindrical leg. Tolerance
measured then pinned per the planet-review-followups spec section 3:
measured <M1>/<M2>, bound BOUND = smallest power of two strictly above
2x the larger maximum, derivation and headroom in the test comment.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

(Replace `<M1>/<M2>` and `BOUND` with the actual values in the commit message too.)

---

### Task 3: full verify

**Files:** none (verification only)

- [x] **Step 1: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: both clean (the integration tests sit in their own tsc program; the edit adds no imports).

- [x] **Step 2: The card verify**

Run: `npm run build && npm test`
Expected: ALL green — unit, integration, and the no-webgpu project (whose fallback tests never run gate C; the `no-webgpu` include list does not collect this file).

- [x] **Step 3: Write the completion report and finish**

Append to the task card's「完成报告」section: the measured maxima M1/M2 and the machine context (hardware GPU vs SwiftShader), the bound and the rule arithmetic, self-test results, deviations from this plan (none expected), residual risks (the bound is machine-measured; if a later machine exceeds it, re-measure rather than raise it blindly). Then run the superloop finish gate per the executor contract.

---

## Self-review notes (for the executor's benefit, not a task)

- `M1`, `M2` and `BOUND` are the only values this plan cannot pre-write — the spec forbids presetting the tolerance (§3: 数值不预设). Everything else in the pinned test is literal text; do not improvise comment wording.
- Do not "round up in advance": if Mmax = 4, the bound is 16 (2×4 = 8 → next power of two strictly greater), not 64. A loose bound is how a real regression hides.
- The leg's failure mode is failing while the pairwise legs pass — that combination means "both shaders wrong together" and is a finding, not a tolerance problem.
