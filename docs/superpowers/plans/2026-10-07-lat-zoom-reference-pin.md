# lat≠0 × zoom≠1 Reference Pins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** Close the zoom-1-invisible shared-error gap (mercator-camera review, leftover risk #4) with exact float64 pins at latitude 30 × zoom 0.5 — the corner where a latitude-term or zoom-multiplier error carried identically by both shaders is invisible to every existing gate.

**Architecture:** Two test-only additions, no production code. (1) Four exact output pins in `test/unit/reference.test.ts` — one per non-linear camera, at surface point (1, 0.2, 0.3). (2) Four arbiter legs in `test/integration/gate-c-cross-backend.test.ts` at the same lat 30 × zoom 0.5 corner, each backend against the CPU reference. The unit pins give the error class a second opinion it cannot survive; the gate C legs carry the same corner into the pixel world.

**Tech Stack:** TypeScript 5 strict, vitest (unit node + integration browser mode).

**Spec / origin:** mercator-camera card 审查意见 · 遗留风险 #4（「lat≠0×zoom≠1 组合若两 shader 同错则仲裁不可见。未来闭环 = 增一条 lat≠0×zoom≠1 的 reference pin（独立小卡即可）」）。

**These are PINS, not TDD red-green.** The behavior they pin should already be correct. Expected: PASS on first run. A FAIL is a discovery — the shared-error class actually exists in the code — STOP and report it; do not adjust the literal, the tolerance, or the production code to force green.

**Independent-literal discipline:** every literal below was derived in `.vibe/aspect-fit-scratch-derive.mjs` part F (a scratch transcription of the WGSL formulas, NOT `src/core/reference.ts`), and cylindrical/pannini/mercator were re-derived by hand when this plan was written (the arithmetic is in the test comments). If a pin disagrees with the code by more than the tolerance, that is the finding — report it.

**Dependency:** `camera-aspect-fit`. Both files edited here are also edited by that card (reference.test.ts in its T3/T4, gate-c in its T8); serializing avoids conflicting edits on the same regions, and this card's pins then sit on top of the merged state.

---

### Task 1: exact output pins in reference.test.ts

**Files:**
- Test: `test/unit/reference.test.ts` (new describe at the end of the file)

- [ ] **Step 1: Write the pins**

Append to `test/unit/reference.test.ts` (after the last existing describe):

```ts
/*
 * The zoom-1-invisible shared error class (mercator-camera review, leftover
 * risk #4): if both shaders carry the SAME latitude-term x zoom error, gate
 * C's backend-vs-backend legs stay green (they agree with each other) and
 * the zoom-1 arbiter legs stay green (zoom 1 hides a zoom-multiplied error).
 * These float64 exact pins at lat 30 x zoom 0.5 are the second opinion that
 * error class cannot survive. PINS, not TDD red-green: they are expected to
 * pass on first run; a failure is a discovery -- stop and report, do not
 * adjust anything to force green.
 */
describe('exact output pins at lat 30 x zoom 0.5 (zoom-1-invisible gap)', () => {
  const POSE = { povLatitude: 30, povLongitude: 0 }

  interface PinRow {
    label: string
    projection: Projection
    u: number
    v: number
  }

  /*
   * Literals derived independently (scratch WGSL transcription), with the
   * hand re-derivations recorded per row: theta = 0.3*2pi*0.5 -> u 0.15 on
   * the 2pi-theta cameras; cylindrical phi = atan(0.1) + pi/2 - pi/6;
   * mercator m = 0.2*0.5*2pi - atanh(sin 30deg), phi = asin(tanh(m)) + pi/2;
   * pannini u = 2*atan(0.075)/2pi, phi = atan(0.1/sqrt(1.0225)) + pi/2 - pi/6.
   * Planet is the Mobius half-map -- the scratch value stands as the
   * independent source for it.
   */
  const ROWS: PinRow[] = [
    {
      label: 'cylindrical',
      projection: { kind: 'cylindrical', zoom: 0.5, extent: [1, 1] },
      u: 0.15,
      v: 0.3650588507638869
    },
    {
      label: 'planet',
      projection: { kind: 'planet', zoom: 0.5, extent: [4, 4] },
      u: 0.6222514566525765,
      v: 0.1373366170697792
    },
    {
      label: 'pannini',
      projection: { kind: 'pannini', zoom: 0.5, extent: [4, 4] },
      u: 0.0238286296045501,
      v: 0.3647101326787614
    },
    {
      label: 'mercator',
      projection: { kind: 'mercator', zoom: 0.5, extent: [1, 1] },
      u: 0.15,
      v: 0.5251242956493019
    }
  ]

  it.each(ROWS)('$label pins u and v for surface point (1, 0.2, 0.3)', ({ projection, u, v }) => {
    const r = project(1, 0.2, 0.3, POSE, projection)
    expect(r.u).toBeCloseTo(u, 12)
    expect(r.v).toBeCloseTo(v, 12)
  })
})
```

(`Projection` and `project` are the file's existing imports — the whole file is about them. `project`'s zoom comes from the projection record, exactly as every other test in the file uses it.)

- [ ] **Step 2: Run them**

Run: `npx vitest run --project unit test/unit/reference.test.ts`
Expected: PASS — the whole file, including the 4 new pins. A pin failing by O(1) means a latitude-term or zoom error in that camera's reference path — STOP and report (that is this card's entire reason to exist, found live). A failure of a few ulps (past `toBeCloseTo`'s 12 digits) means the transcription here drifted — re-derive by hand from the formulas in the comment, and only then amend the literal with the corrected value and a note in the commit.

- [ ] **Step 3: Commit**

```bash
git add test/unit/reference.test.ts
git commit -m "test: exact output pins at lat 30 x zoom 0.5 -- the zoom-1-invisible gap closed (lat-zoom-pin T1)"
```

---

### Task 2: gate C arbiter legs at the same corner

The unit pins watch the reference; these legs watch the pixels. Both backends against the CPU reference at lat 30 / lng 45 / zoom 0.5 — the state where a shared shader error cannot hide behind backend agreement.

**Files:**
- Test: `test/integration/gate-c-cross-backend.test.ts` (new test in the main describe, after the existing arbiter legs)

- [ ] **Step 1: Add the legs**

Append to the main describe (adapt the import of `Projection` to whatever the file already does — it builds projections throughout):

```ts
  it('arbitrates the lat!=0 x zoom!=1 corner for all four non-linear cameras', async () => {
    // The zoom-1-invisible shared error class (mercator-camera review,
    // leftover risk #4): backend-vs-backend agreement cannot see an error
    // both shaders share, and the zoom-1 legs cannot see a zoom-multiplied
    // latitude term. This leg sits at lat 30 / zoom 0.5 with the float64
    // reference as the tiebreaker, both backends against it.
    //
    // Tolerances follow the square legs above: cylindrical <= 3 and
    // planet <= 4 (their documented chains), mercator <= 3. Pannini is NEW
    // as an arbitration kind: measure first (run once, read the printed
    // values from the failure message), then keep the <= 3 pin with the
    // measured pair recorded here in a comment -- the four-requirement
    // protocol the planet leg documents. Never fabricate a 'measured' line.
    const s: State = { povLatitude: 30, povLongitude: 45, fov: (75 * Math.PI) / 180, zoom: 0.5 }
    const EXTENT = {
      cylindrical: [1, 1],
      planet: [4, 4],
      pannini: [4, 4],
      mercator: [1, 1]
    } as const
    for (const kind of ['cylindrical', 'planet', 'pannini', 'mercator'] as const) {
      const projection = { kind, zoom: 0.5, extent: EXTENT[kind] } as Projection
      const r = await compareWithReference(state(s), projection)
      const tolerance = kind === 'planet' ? 4 : 3
      expect(r.webgpu, `${kind} lat30 zoom0.5 webgpu vs reference`).toBeLessThanOrEqual(tolerance)
      expect(r.webgl2, `${kind} lat30 zoom0.5 webgl2 vs reference`).toBeLessThanOrEqual(tolerance)
    }
  })
```

(`State`, `state` and `compareWithReference` are the file's existing helpers, used exactly as the square arbiter legs above use them. No `fit` on the projections: at the default square offscreen size the container fit degenerates to the square paper for mercator/pannini/planet and to [1, 2π] for cylindrical — both backends and the reference resolve the same extent, which is what agreement means here. The mercator sweep legs above already follow this no-fit pattern.)

- [ ] **Step 2: Run**

Run: `npx vitest run --project integration test/integration/gate-c-cross-backend.test.ts`
Expected: PASS. If the pannini leg measures above 3: record the measured pair in the comment and pin the smallest power of two strictly above twice the larger measured value — the protocol the planet leg documents — and say so in the commit message. If any leg fails far above its tolerance (frame-wide, not a chain), that is the shared-error class found live at the pixel level — STOP and report.

- [ ] **Step 3: Commit**

```bash
git add test/integration/gate-c-cross-backend.test.ts
git commit -m "test: gate C arbiter legs at lat 30 x zoom 0.5, pannini joins arbitration (lat-zoom-pin T2)"
```

---

### Task 3: final verification chain

**Files:** none (verification only).

- [ ] **Step 1: The full chain**

```bash
npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
```

Expected: all green in order — gen-shaders idempotent (tree unchanged), build succeeds, `npm test` green across unit / integration / no-webgpu with the new pins and legs collected, typecheck 0 errors across the three programs, lint clean, coverage branch ≥ 90% (record the number; a test-only card moves it barely).

- [ ] **Step 2: Diff audit**

Run: `git diff --name-only master...HEAD`
Expected: exactly two files — `test/unit/reference.test.ts`, `test/integration/gate-c-cross-backend.test.ts`. Anything else in the diff means scope creep; remove it.

- [ ] **Step 3: No commit** (verification only) — proceed to the card's reporting flow (task-finish).

---

## Plan-level self-review (already applied)

- **Origin coverage:** risk #4's ask — 「增一条 lat≠0×zoom≠1 的 reference pin」 — is delivered twice over: the unit exact pins (reference path, four cameras) and the gate C arbiter legs (pixel path, four cameras). The shared-error class is now visible to at least one independent opinion at every level.
- **No placeholders:** both tests carry complete code; the only executor judgment calls are the two explicitly-protocol-gated ones (pannini measure-first; ulp-level literal correction with hand re-derivation), each with its decision rule written out.
- **Type consistency:** `project(x, y, z, pose, projection)` with zoom inside the projection record (Task 1); `compareWithReference(cameraState, projection)` at the default square shape (Task 2) — no signature from the aspect-fit card is needed here, which is why the deps edge is about edit-serialization, not compilation.
