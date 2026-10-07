# Old-Four rotate: the applied delta (ADV-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** The `rotate` event reports the APPLIED latitude delta on every camera — the pose difference the drag actually produced after pole clamping — so a delta-summing consumer integrating the events always lands on the pose, never overshoots it.

**Architecture:** One emit-site change in `src/viewer/viewer.ts`'s old-four pan branch (the mercator branch already reports applied and is untouched), plus the event's TSDoc and the README row. No camera-controller change: the clamp lives in `rotate()` and stays where it is; this card only changes what the event reports. `lng` is deliberately unchanged — longitude never clamps, so its requested turn IS its applied turn.

**Tech Stack:** TypeScript 5 strict, vitest browser-mode integration (public surface only).

**Spec / origin:** mercator-camera card 审查意见 · 遗留风险 #6 / ADV-3（旧四款 rotate 极点 overshoot：requested 与 applied 的偏差使事件流与姿态脱钩）。pan-zoom-semantics spec §4 记录在案。aspect-fit spec §4 明确把「旧四款 overshoot 统一」列为本 spec 的非目标、指向独立后续卡——就是这张。

**Why the sum is exact (the test's central trick):** applied deltas telescope. Each event emits `pose_after − pose_before`, so summing any chunking of one drag gives `pose_final − pose_initial` bit-for-bit — clamped or not. The requested deltas have no such property away from the clamp (0.2 is not binary-exact, and the drag helper may deliver several moves), which is why the control leg asserts with `toBeCloseTo` while the clamped legs can use `toBe`.

**Independence:** no deps. The sibling card `camera-aspect-fit` edits the same pan handler's MERCATOR branch and `#drawFrame`; this card edits the old-four branch (viewer.ts ~lines 159-162) and the TSDoc — distinct hunks, clean merge either order. The drag literals here are aspect-independent (latitude comes from `deltaY / surface.height`, never the projection extent).

---

### Task 1: the failing story test

**Files:**
- Create: `test/integration/rotate-applied-delta.test.ts`
- Modify: `vitest.config.ts:239` (no-webgpu include — the mercator CRITICAL lesson: a story file not whitelisted there has ZERO executing tests in CI)

- [ ] **Step 1: Write the test**

Create `test/integration/rotate-applied-delta.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { makeContainer, canvasOf } from './support/dom'
import { nextFrames } from './support/canvas'
import { drag } from './support/gestures'

/*
 * The rotate event's lat is the APPLIED delta on EVERY camera (ADV-3,
 * mercator-camera review leftover risk #6): the pose difference the drag
 * actually produced, after rotate()'s +-90 clamp. The old four cameras used
 * to report the REQUESTED delta, which overshoots the clamped pose near the
 * poles -- a consumer summing the events drifts away from the pose exactly
 * where the camera stops moving. Mercator already reports applied (pinned in
 * mercator-drag.test.ts); this file pins the same contract for one of the
 * old four, through the public surface the way a user sees it.
 *
 * Why the clamped legs can use toBe: applied deltas telescope -- each event
 * emits pose_after - pose_before, so the sum over any chunking is exactly
 * pose_final - pose_initial. The control leg uses toBeCloseTo because away
 * from the clamp the sum is a sum of requested floats (0.2 is not
 * binary-exact), which can differ from the single-shot product by an ulp.
 */

describe('rotate reports the applied delta on the old-four cameras', () => {
  it('clamps at the pole: requested 90 from lat 89, applied 1', async () => {
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 89 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY -100 of height 200: requested lat = -(-100/200)*180 = +90,
      // which would land at 179; the clamp stops the pose at 90.
      await drag(canvasOf(container), { from: { x: 200, y: 150 }, to: { x: 200, y: 50 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBe(90)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBe(1)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('deep in the overshoot: requested 45 from lat 89.9, applied 0.1', async () => {
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 89.9 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY -50 of height 200: requested +45, pose would be 134.9, the
      // clamp stops it at 90: applied = 90 - 89.9 = 0.09999999999999432 in
      // float64, hence toBeCloseTo.
      await drag(canvasOf(container), { from: { x: 200, y: 125 }, to: { x: 200, y: 75 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBe(90)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBeCloseTo(0.1, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('away from the poles applied equals requested (control leg)', async () => {
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: {
        projection: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
        pose: { povLatitude: 30 }
      }
    })
    try {
      await nextFrames(3)
      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // deltaY -40 of height 200: requested +36, pose 66 -- no clamp in
      // force, so the applied delta IS the requested one. This leg passes
      // before AND after the change; it exists to pin that the unification
      // does not eat the mid-range behaviour.
      await drag(canvasOf(container), { from: { x: 200, y: 140 }, to: { x: 200, y: 100 } })
      await nextFrames(2)

      expect(viewer.cameraOptions.pose?.povLatitude).toBeCloseTo(66, 9)
      expect(rotations.reduce((s, r) => s + r.lat, 0)).toBeCloseTo(36, 9)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })
})
```

(If `makeContainer`/`canvasOf`/`drag`/`nextFrames` spell or import differently, mirror `test/integration/mercator-drag.test.ts`'s imports exactly — that file is the idiom source and this one copies its mount/drag/collect shape deliberately.)

- [ ] **Step 2: Whitelist the file for the no-webgpu project**

In `vitest.config.ts`, the no-webgpu `include` (line ~239) currently ends:

```ts
            'test/integration/(viewer-events|dispose-order|mercator-drag).test.ts'
```

Change it to:

```ts
            'test/integration/(viewer-events|dispose-order|mercator-drag|rotate-applied-delta).test.ts'
```

(If the sibling card `camera-aspect-fit` has already appended `|aspect-fit` to this alternation, keep it — add only your own name to the group.)

- [ ] **Step 3: Run to verify red**

Run: `npx vitest run --project integration test/integration/rotate-applied-delta.test.ts`
Expected: FAIL — the two pole legs report the REQUESTED delta today (event sums of 90 and 45 where 1 and 0.1 are pinned). The control leg (36 from 30) passes already; that is expected and fine.

Run: `npx vitest run --project no-webgpu test/integration/rotate-applied-delta.test.ts`
Expected: same shape — the file is collected (3 tests found), the two pole legs fail, the control passes. Collection is the point of the whitelist.

- [ ] **Step 4: Commit**

```bash
git add test/integration/rotate-applied-delta.test.ts vitest.config.ts
git commit -m "test: rotate applied-delta story -- red on the pole-clamp legs (rotate-applied-delta T1)"
```

---

### Task 2: emit the applied delta + docs

**Files:**
- Modify: `src/viewer/viewer.ts:159-162` (old-four pan branch)
- Modify: `src/viewer/viewer.ts:26-34` (ViewerEvents.rotate TSDoc)
- Modify: `README.md:119` (events table rotate row)

- [ ] **Step 1: The emit site**

In `src/viewer/viewer.ts`, the `'pan'` handler's old-four branch currently reads:

```ts
      const d = this.#input.dragToRotation(deltaX, deltaY, surface)
      if (d.lat === 0 && d.lng === 0) return
      this.#camera.rotate(d.lat, d.lng)
      this.events.emit('rotate', { lat: d.lat, lng: d.lng })
```

Replace it with:

```ts
      const d = this.#input.dragToRotation(deltaX, deltaY, surface)
      if (d.lat === 0 && d.lng === 0) return
      // Mirrors the mercator branch above: `lat` is the APPLIED delta -- the
      // pose difference the drag actually produced -- because rotate() clamps
      // latitude to +-90 near the poles, and a consumer summing the events
      // must land on the pose, not overshoot it. `lng` never clamps, so the
      // requested turn IS the applied one and stays as-is.
      const before = this.#camera.state.povLatitude
      this.#camera.rotate(d.lat, d.lng)
      this.events.emit('rotate', { lat: this.#camera.state.povLatitude - before, lng: d.lng })
```

(The mercator branch above it — `dragToMercatorPan` / `panMercator` — is NOT touched: it already emits applied, and `mercator-drag.test.ts` pins that.)

- [ ] **Step 2: The TSDoc**

In the same file, the `ViewerEvents.rotate` entry currently reads:

```ts
  After a drag. `lng` is the requested turn on every camera, unwrapped so delta-summing consumers keep working (`-72`, not `288`). `lat` is kind-dependent: `mercator` reports the APPLIED delta -- the pose difference its metre-metric pan actually produced -- while the other cameras report the REQUESTED linear delta, which can overshoot the clamped pose near the poles.
```

Replace with:

```ts
  After a drag. Both fields are the APPLIED deltas -- the pose differences the drag actually produced. `lng` never clamps, so it is also the requested turn, unwrapped so delta-summing consumers keep working (`-72`, not `288`); `lat` clamps at the poles (`povLatitude` is +-90), so near them the applied delta is smaller than the requested one. Summing events therefore always lands on the pose.
```

- [ ] **Step 3: The README row**

In `README.md`'s events table, the rotate row currently reads:

```markdown
| `rotate` | `{ lat, lng }` | After a drag. `lng` is the requested turn on every camera, unwrapped (`-72`, not `288`). `lat` is the applied delta on `mercator` (what the pan actually moved) and the requested one on the other cameras. |
```

Replace with:

```markdown
| `rotate` | `{ lat, lng }` | After a drag. Both fields are applied deltas (what the drag actually moved). `lng` never clamps, unwrapped (`-72`, not `288`); `lat` clamps at the poles (`povLatitude` is ±90), so near them it is smaller than the requested move. |
```

- [ ] **Step 4: Run green, then the regression sweep**

Run: `npx vitest run --project integration test/integration/rotate-applied-delta.test.ts --project no-webgpu test/integration/rotate-applied-delta.test.ts`
Expected: PASS — all 3 legs, both projects.

Run: `npx vitest run --project integration test/integration/mercator-drag.test.ts`
Expected: PASS — the applied-emit sibling is untouched.

Run: `npx vitest run --project integration --project no-webgpu`
Expected: PASS across both projects. Recon already established that no existing test pins an old-four requested-lat payload (`'rotate'` appears in tests only at mercator-drag (applied values, unchanged), viewer-events (type shape only) and user-story-photo (call counts only)) — so any failure here is a NEW interaction, not a stale pin: investigate it, do not delete it.

- [ ] **Step 5: Commit**

```bash
git add src/viewer/viewer.ts README.md
git commit -m "feat: rotate reports the applied delta on every camera, unifying the pole-clamp semantics (rotate-applied-delta T2)"
```

---

### Task 3: final verification chain

**Files:** none (verification only).

- [ ] **Step 1: The full chain**

```bash
npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
```

Expected: all green in order — gen-shaders idempotent, build succeeds, `npm test` green (unit untouched, integration + no-webgpu both collect the new story file), typecheck 0 errors across the three programs (README check included), lint clean, coverage branch ≥ 90% (record the number).

- [ ] **Step 2: Diff audit**

Run: `git diff --name-only master...HEAD`
Expected: exactly four files — `test/integration/rotate-applied-delta.test.ts`, `vitest.config.ts`, `src/viewer/viewer.ts`, `README.md`. Anything else means scope creep; remove it.

- [ ] **Step 3: No commit** (verification only) — proceed to the card's reporting flow (task-finish).

---

## Plan-level self-review (already applied)

- **Origin coverage:** risk #6/ADV-3's ask — the old-four overshoot unified to applied — is delivered at all three layers the review named: the emit site (Task 2 step 1), the documented contract (TSDoc + README, Task 2 steps 2-3), and a public-surface story test through real gestures (Task 1). `lng`'s contract is explicitly preserved (requested = applied there), which is the part of the old wording that was correct.
- **No placeholders:** every step carries the complete before/after; the only conditional instruction (the whitelist alternation if the sibling card landed first) has both branches spelled out.
- **Type consistency:** the event payload stays `{ lat: number, lng: number }`; `dragToRotation`/`rotate` signatures unchanged; no new symbols anywhere.
