# Camera Aspect-Fit (container-shaped framing for the non-linear cameras) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** The four non-linear cameras stop stretching their square framing paper onto the container: the vertical extent is derived from the container's aspect so that one pixel at the screen centre covers the same panorama angle horizontally and vertically, with `fit: 'extent'` as the explicit manual-framing escape hatch that keeps the v0.2.2 pixel contract bit-identical.

**Architecture:** One new pure function `resolveExtent(projection, aspect)` in `src/core/extent.ts` is the single source of truth for the resolved surface extent, shared by `matrix.ts` (render path) and `reference.ts` (arbiter path). The ortho box becomes rectangular (`-m_x..m_x, -m_y..m_y`); `aspect` flows viewer → `Backend.setCamera` → `buildCameraTransform` → `buildProjection` → `resolveExtent`. Because the two paths share the derivation, I2's acceptance is a property test measured on `project`'s final output, never through `resolveExtent` (spec §5.3). Both shaders, the constants pipeline, the uniform layout and the whole linear chain are untouched.

**Tech Stack:** TypeScript 5 strict, vitest (unit node + integration browser mode), gl-matrix, playwright-core for the gallery re-shoot.

**Spec:** `docs/superpowers/specs/2026-09-30-camera-aspect-fit-design.md` — every task below cites its section. The spec's adjudications are final; do not re-litigate them in code comments.

**Independent-literal discipline:** every exact number in the new tests below was derived in `.vibe/aspect-fit-scratch-derive.mjs` (a scratch script that transcribes the WGSL formulas, NOT `src/core/reference.ts`). When a step says "derived independently", the literal is already in the step — do not regenerate it from the code under test. If a measured value disagrees with a plan literal by more than the stated tolerance, stop and report; do not silently re-derive.

**Commit discipline:** every task ends green (`npm run test:unit` at minimum; tasks touching integration files also run the affected integration file). Neostandard style: no semicolons, 2-space indent, single quotes, `import type` for types, English comments only. No TODO/FIXME anywhere in the branch diff.

---

### Task 1: `fit` on the Projection union + `resolveExtent`

Spec §2.2, §3.1, §2.4.

**Files:**
- Modify: `src/core/types.ts:44-56`
- Create: `src/core/extent.ts`
- Test: `test/unit/extent.test.ts` (new)

- [x] **Step 1: Write the failing test**

Create `test/unit/extent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveExtent } from '../../src/core/extent'
import type { Projection } from '../../src/core/types'

/*
 * Every literal below was derived independently (scratch transcription of the
 * WGSL formulas plus the spec 1.2 rate table), not by running resolveExtent:
 * expectations generated from the code under test are an echo chamber that
 * passes on any wrong rate constant.
 */
describe('resolveExtent', () => {
  it('derives the container-fit height from the per-camera rate (spec 1.2)', () => {
    // cylindrical: rate 2pi -- theta = z * 2pi against phi = atan(y), slope 1
    // at the centre, so the paper needs 2pi times the height per unit width.
    const cylindrical: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    expect(resolveExtent(cylindrical, 1)).toEqual([1, 6.283185307179586])
    expect(resolveExtent(cylindrical, 16 / 9)[1]).toBeCloseTo(3.5342917352885173, 12)
    expect(resolveExtent(cylindrical, 9 / 16)[1]).toBeCloseTo(11.170107212763709, 12)
    // The width is never touched: it is the zoom/extent[0] calibration knob.
    expect(resolveExtent(cylindrical, 9 / 16)[0]).toBe(1)

    // mercator / pannini / planet: rate 1 (conformal or centre-isotropic).
    const mercator: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1] }
    expect(resolveExtent(mercator, 16 / 9)).toEqual([1, 0.5625])
    expect(resolveExtent(mercator, 9 / 16)).toEqual([1, 1.7777777777777777])
    // I4: at a square viewport mercator keeps exactly the EPSG:3857 paper.
    expect(resolveExtent(mercator, 1)).toEqual([1, 1])

    const pannini: Projection = { kind: 'pannini', zoom: 1, extent: [4, 4] }
    expect(resolveExtent(pannini, 16 / 9)).toEqual([4, 2.25])
    expect(resolveExtent(pannini, 9 / 16)).toEqual([4, 7.111111111111111])

    const planet: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
    expect(resolveExtent(planet, 16 / 9)).toEqual([4, 2.25])
    expect(resolveExtent(planet, 9 / 16)).toEqual([4, 7.111111111111111])
  })

  it("fit 'extent' takes the tuple literally, at any viewport (spec 1.4, I6)", () => {
    const anamorphic: Projection = { kind: 'pannini', zoom: 1, extent: [4, 2], fit: 'extent' }
    expect(resolveExtent(anamorphic, 1)).toEqual([4, 2])
    expect(resolveExtent(anamorphic, 16 / 9)).toEqual([4, 2])
    expect(resolveExtent(anamorphic, 9 / 16)).toEqual([4, 2])
  })

  it('a fit value that is not the literal "extent" reads as container', () => {
    // Runtime-lenient on purpose, mirroring the unknown-kind handling: the
    // union is the set of legal values, and anything else degrades to the
    // default rather than throwing mid-frame.
    const typo = { kind: 'mercator', zoom: 1, extent: [1, 1], fit: 'contain' } as Projection
    expect(resolveExtent(typo, 2)).toEqual([1, 0.5])
  })

  it('rejects a non-positive or non-finite aspect', () => {
    const projection: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1] }
    expect(() => resolveExtent(projection, 0)).toThrow(/greater than 0/i)
    expect(() => resolveExtent(projection, -1)).toThrow(/greater than 0/i)
    expect(() => resolveExtent(projection, NaN)).toThrow(/greater than 0/i)
    // The guard fires in manual mode too: the aspect is the surface's shape,
    // invalid whatever the framing mode -- same ruling as setAspect's order.
    const manual: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1], fit: 'extent' }
    expect(() => resolveExtent(manual, 0)).toThrow(/greater than 0/i)
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit test/unit/extent.test.ts`
Expected: FAIL — `Cannot find module '../../src/core/extent'` (or the equivalent resolution error).

- [x] **Step 3: Add the `fit` field to the four non-linear union members**

In `src/core/types.ts`, replace the extent paragraph of the `Projection` doc comment (currently lines 34-36, `The pair is ordered \`[width, height]\`. Every extent in use is square, ...`) together with the four member lines, so the union reads:

```ts
/**
 * How the projection maps view directions onto the screen.
 *
 * `extent` is the part the legacy code hid inside quad geometry. The four
 * non-linear projections are not scale-invariant: `theta = z * TWO_PI` reads
 * the magnitude of `z`, so the size of the surface is part of the projection
 * itself (1x1 for cylindrical and mercator, 4x4 for planet and pannini).
 * Promoting it to a parameter is what lets the geometry subsystem disappear.
 *
 * The pair is ordered `[width, height]`. `extent[0]` is the horizontal
 * calibration (the zoom-1 anchor: cylindrical/mercator 360 degrees, pannini
 * 180, planet the globe). `extent[1]` is read ONLY under `fit: 'extent'`;
 * under the default `fit: 'container'` the height is derived from the
 * container's aspect so the centre pixel stays square (see `resolveExtent`
 * in `src/core/extent.ts` -- the single source of that derivation).
 *
 * `fit` is runtime-lenient: any value other than the literal `'extent'`
 * reads as `'container'`, mirroring the unknown-kind handling. It is a
 * literal union, so no finiteness assertion exists for it.
 *
 * The `kind` literals are deliberately re-spelled rather than derived from
 * `ProjectionKind`: that type is the set of legal values, this union is which
 * fields each value carries. If either side drifts, the
 * `Record<ProjectionKind, number>` table in `constants.ts` makes it a compile
 * error.
 */
export type Projection =
  | { readonly kind: 'linear'; readonly fov: number; readonly aspect: number }
  | {
      readonly kind: 'cylindrical'
      readonly zoom: number
      readonly extent: readonly [number, number]
      readonly fit?: 'container' | 'extent'
    }
  | {
      readonly kind: 'planet'
      readonly zoom: number
      readonly extent: readonly [number, number]
      readonly fit?: 'container' | 'extent'
    }
  | {
      readonly kind: 'pannini'
      readonly zoom: number
      readonly extent: readonly [number, number]
      readonly fit?: 'container' | 'extent'
    }
  /**
   * The conformal cylinder (2026-09-29 mercator-camera spec): uniform scale
   * everywhere, poles at infinity. Same zoom anchor as cylindrical -- full
   * width 360 degrees at zoom 1 -- and the same 1x1 surface; the vertical
   * axis maps to latitude through the Gudermannian, so the vertical field
   * spans gd(+-pi) = +-85.051129 degrees (the EPSG:3857 cutoff) at zoom 1.
   */
  | {
      readonly kind: 'mercator'
      readonly zoom: number
      readonly extent: readonly [number, number]
      readonly fit?: 'container' | 'extent'
    }
```

(Keep the mercator member's existing doc comment attached as shown; only the field lines change.)

- [x] **Step 4: Implement `resolveExtent`**

Create `src/core/extent.ts`:

```ts
import type { Projection } from './types'
import { assertPositive } from './validate'

/** Every `Projection` member except the linear one. */
export type NonLinearProjection = Exclude<Projection, { kind: 'linear' }>

const TWO_PI = 2 * Math.PI

/**
 * Resolves the surface extent a non-linear camera is rendered on for the
 * container aspect `aspect` (width / height).
 *
 * `fit: 'extent'` takes the tuple literally -- manual framing (anamorphic
 * lenses, locked framing, the v0.2.2 legacy box). The default -- missing,
 * `'container'`, or any unrecognized value -- keeps `extent[0]` as the
 * horizontal calibration and derives the height so that one pixel at the
 * screen centre covers the same panorama angle horizontally and vertically:
 * `extent_y = extent_x * (k_x / k_y) / aspect`, where the rate ratio is 2pi
 * for cylindrical (theta = z * 2pi against phi = atan(y), centre slope 1)
 * and 1 for the cameras that are conformal or centre-isotropic (mercator,
 * pannini, planet).
 *
 * No clamping and no special cases: the cameras' own asymptotes make every
 * derived paper height graceful (spec I5). The derivation never reads zoom --
 * zoom cancels on both sides of the equidistance condition, which is what
 * keeps it a purely horizontal framing knob (spec I3).
 */
export function resolveExtent (
  projection: NonLinearProjection,
  aspect: number
): readonly [number, number] {
  assertPositive(aspect, 'aspect')
  if (projection.fit === 'extent') return [projection.extent[0], projection.extent[1]]
  const rate = projection.kind === 'cylindrical' ? TWO_PI : 1
  return [projection.extent[0], (projection.extent[0] * rate) / aspect]
}
```

- [x] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project unit test/unit/extent.test.ts`
Expected: PASS (4 tests).

- [x] **Step 6: Commit**

```bash
git add src/core/types.ts src/core/extent.ts test/unit/extent.test.ts
git commit -m "feat: resolveExtent -- the single source of the container-fit extent (aspect-fit T1)"
```

---

### Task 2: `CameraController` learns the surface aspect

Spec §3.2. The controller stores the container's W/H for the non-linear kinds; the linear branch keeps writing `projection.aspect` exactly as today. Guard order — assert before kind branch — must survive (it is pinned by an existing test).

**Files:**
- Modify: `src/viewer/camera-controller.ts`
- Test: `test/unit/camera-controller.test.ts:509-576`

- [x] **Step 1: Rewrite the affected tests first**

In `test/unit/camera-controller.test.ts`:

(a) Replace the test `setAspect leaves a non-linear projection alone` (currently at ~line 536) with:

```ts
  it('setAspect stores the surface aspect for the non-linear kinds, dirtying without rewriting the projection', () => {
    // The other four cameras derive their surface shape from the container at
    // draw time (resolveExtent); the projection tuple stays the user's
    // calibration. What setAspect writes here is the controller's cached W/H,
    // and a change must dirty the frame -- the picture reframes, it does not
    // repaint: an undirty setAspect would leave a resized viewer rendering the
    // old framing until the camera moved.
    const c = new CameraController(undefined, cylindrical())
    c.consumeDirty()
    c.setAspect(2)
    expect(c.projection).toEqual(cylindrical())
    expect(c.surfaceAspect).toBe(2)
    expect(c.consumeDirty()).toBe(true)
  })

  it('surfaceAspect defaults to 1 before the first resize', () => {
    // Same story as the linear placeholder aspect: unknowable at construction,
    // and 1 is the least-visible wrong value -- the square framing every
    // existing square-extent render already assumed.
    const c = new CameraController(undefined, cylindrical())
    expect(c.surfaceAspect).toBe(1)
  })
```

(b) Extend `setAspect is a no-op when the aspect did not change` (currently at ~line 547) by appending a non-linear leg inside the same test:

```ts
    const nonLinear = new CameraController(undefined, cylindrical())
    nonLinear.consumeDirty()
    nonLinear.setAspect(1)
    expect(nonLinear.consumeDirty()).toBe(false)
```

(Keep the existing linear body and comment untouched; add the leg after it.)

(c) Add one pin that a manual `fit` survives a projection swap (spec §5.4, camera-controller row):

```ts
  it('setProjection keeps a manual fit', () => {
    // fit travels inside the projection record; nothing on the controller
    // reads or rewrites it. The pin exists so a future normalization step
    // (say, defaulting fit to 'container' on store) cannot silently drop the
    // manual-framing mode.
    const c = new CameraController(undefined, cylindrical())
    c.setProjection({ kind: 'cylindrical', zoom: 1, extent: [1, 1], fit: 'extent' })
    expect(c.projection).toEqual({ kind: 'cylindrical', zoom: 1, extent: [1, 1], fit: 'extent' })
  })
```

- [x] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run --project unit test/unit/camera-controller.test.ts`
Expected: FAIL — `c.surfaceAspect is not a function` on the new tests.

- [x] **Step 3: Implement**

In `src/viewer/camera-controller.ts`:

(a) Add the field next to `#projection` (match the class's existing private-field style):

```ts
  /*
   * The container's width/height for the non-linear kinds, defaulting to 1
   * until the first resize -- the same placeholder story as the linear
   * projection's aspect. Consumed at draw time through resolveExtent; never
   * cached further (spec 3.2: resolve per frame, store only the input).
   */
  #surfaceAspect = 1
```

(b) Add the getter next to the other getters (e.g. beside `get projection`):

```ts
  /** The container aspect the non-linear kinds resolve their extent against. */
  get surfaceAspect (): number {
    return this.#surfaceAspect
  }
```

(c) Replace `setAspect` (currently: assert, early-return for non-linear, equality guard, rewrite, dirty, notify) with:

```ts
  setAspect (aspect: number): void {
    assertPositive(aspect, 'aspect')
    if (this.#projection.kind === 'linear') {
      if (this.#projection.aspect === aspect) return
      this.#projection = { ...this.#projection, aspect }
    } else {
      if (this.#surfaceAspect === aspect) return
      this.#surfaceAspect = aspect
    }
    this.#dirty = true
    this.#notify()
  }
```

(The assert stays above the kind branch — the existing `rejects a non-positive aspect` test pins that order for both kinds, and it must keep passing unchanged.)

- [x] **Step 4: Run to verify green**

Run: `npx vitest run --project unit test/unit/camera-controller.test.ts`
Expected: PASS — the whole file, including the untouched `rejects a non-positive aspect`.

- [x] **Step 5: Commit**

```bash
git add src/viewer/camera-controller.ts test/unit/camera-controller.test.ts
git commit -m "feat: camera controller tracks the surface aspect for the non-linear kinds (aspect-fit T2)"
```

---

### Task 3: `ndcToSurface` goes per-axis + the fourth adjudicated departure

Spec §3.3 (reference row), §5.2. Square extents are bit-identical to the old `max/2` collapse (it was only observable on asymmetric extents, which is exactly what this card makes legitimate).

**Files:**
- Modify: `src/core/reference.ts` (`ndcToSurface` + module header)
- Test: `test/unit/reference.test.ts` (ndcToSurface describe)

- [x] **Step 1: Rewrite the asymmetric ndcToSurface test first**

In `test/unit/reference.test.ts`, find the `describe('ndcToSurface')` block and the test `uses max(extent) / 2 on both axes for an asymmetric extent` (`ndcToSurface(0.5, -0.5, [2, 6])` → `[1, -1.5, 1.5]`). Replace it with:

```ts
  it('scales each axis by its own half of the resolved extent', () => {
    // ndcToSurface takes the RESOLVED extent (what resolveExtent handed back
    // for the container); each axis scales by its own half. The old
    // max(extent)/2 collapse was only observable on asymmetric extents --
    // exactly the extents the container fit now produces legitimately.
    // [2, 6]: y reads 6/2 = 3, z reads 2/2 = 1.
    expect(ndcToSurface(0.5, -0.5, [2, 6])).toEqual([1, -1.5, 0.5])
    // [4, 2] with the transposition the old comment warned about: y reads
    // 2/2 = 1, z reads 4/2 = 2. A transposed implementation swaps these two.
    expect(ndcToSurface(-0.25, 0.75, [4, 2])).toEqual([1, 0.75, -0.5])
  })
```

(Leave the square-tuple corner and interior pins in that describe untouched — they hold bit-for-bit.)

Also update the comment in the `the %s projection does NOT ignore magnitude` test that says `max(extent) / 2` (around line 79): change that phrase to `its own half of the extent, per axis`. Comment-only change.

- [x] **Step 2: Run to verify red**

Run: `npx vitest run --project unit test/unit/reference.test.ts`
Expected: FAIL — the new per-axis test (old implementation returns `[1, -1.5, 1.5]` for the first case).

- [x] **Step 3: Implement**

In `src/core/reference.ts`, replace `ndcToSurface`'s body and doc comment so the function reads (keep the exported name and the `[number, number, number]` return shape it has today):

```ts
/**
 * Recovers the surface point an NDC position maps to, on the RESOLVED extent
 * (the tuple `resolveExtent` returns for the container -- buildProjection
 * resolves the same value for the ortho box, which is why this inverts it).
 * Each axis scales by its own half-extent; x stays pinned at 1, the plane the
 * legacy quad sat on.
 */
export function ndcToSurface (
  ndcX: number,
  ndcY: number,
  extent: readonly [number, number]
): readonly [number, number, number] {
  return [1, (ndcY * extent[1]) / 2, (ndcX * extent[0]) / 2]
}
```

(If the current signature's parameter or return annotations differ cosmetically, keep the current ones — only the scaling logic and the doc change.)

- [x] **Step 4: Add the fourth adjudicated departure to the module header**

In the same file's module header, after the planet-branch-points departure (2026-09-28) and before the mercator exemption note, insert:

```ts
 * - aspect fit (2026-10-07, camera-aspect-fit spec): v0.2.2 sized the ortho
 *   box as max(extent)/2 on BOTH axes -- a square box inherited from the
 *   square quad geometry -- so every non-square container stretched the
 *   picture vertically. The user-adjudicated correction derives the box per
 *   axis from the container (resolveExtent); same class as lngOffset (an
 *   inherited framework defect corrected by adjudication), and like it, the
 *   legacy behaviour stays reachable bit-for-bit through fit:'extent' with a
 *   square tuple, which is how gate A keeps watching the v0.2.2 pixels.
```

- [x] **Step 5: Run to verify green**

Run: `npx vitest run --project unit test/unit/reference.test.ts`
Expected: PASS — the whole file.

- [x] **Step 6: Commit**

```bash
git add src/core/reference.ts test/unit/reference.test.ts
git commit -m "feat: ndcToSurface reads the resolved extent per axis; fourth adjudicated departure recorded (aspect-fit T3)"
```

---

### Task 4: the screen-centre equidistance property test (I2's independent arbiter)

Spec §5.3. This test must NEVER call `resolveExtent` — the render path and the reference share that function, so a test through it derives nothing independently. The extents here are hand-resolved from the spec §1.2 rate table with in-test constants.

The recipe below was verified numerically before this plan was written: worst deviation `4.30645062795762e-11` over 8 pose-cases × 3 aspects × 2 zooms (scratch part D, final recipe). Three measurement artifacts are designed out:

1. **Branch cuts**: pannini/planet `atan` fixups make a ±ε pair straddle the cut; differences are taken wrap-safe, mapped into `(-0.5, 0.5]` turns.
2. **Planet tilt 0 is the pole at screen centre** (φ even in y there — first-order dv vanishes); planet is measured at tilt 30/45 only.
3. **Conformal cameras are isotropic in the sphere's PHYSICAL metric**: longitude differences are weighted by cos(latitude of the screen-centre point) — `cos|lat|` for mercator, `sin|tilt|` for planet (tilt rolls a point at polar angle |tilt| to the centre, latitude 90°−|tilt|). Cylindrical/pannini are measured in the coordinate metric (weight 1) at any pose. Magnitudes on both axes: planet's dv is negative at tilted poses, and the property is about rates, not orientation.

**Files:**
- Test: `test/unit/reference.test.ts` (new describe at the end)

- [ ] **Step 1: Write the test**

Append to `test/unit/reference.test.ts`:

```ts
/*
 * The aspect-fit contract, I2: at the screen centre, one pixel covers the
 * same panorama angle horizontally and vertically. Spec 5.3: this must be
 * measured on project()'s FINAL output and must never go through
 * resolveExtent -- the render path and this module share that function, so a
 * test that calls it has no independent opinion. The extents below are
 * hand-resolved from the spec's 1.2 rate table (2pi for cylindrical, 1 for
 * the rest) with constants written here, which is the second opinion.
 *
 * Verified before this test was written: worst |2*du*w - A*dv| =
 * 4.30645062795762e-11 over these cases (finite-difference truncation
 * scale); 1e-9 leaves an order of magnitude of headroom without admitting a
 * real rate error, which lands at O(1).
 */
describe('screen-centre equidistance (aspect fit, I2)', () => {
  /** Turn-difference mapped into (-0.5, 0.5], so a seam-straddling pair reads as epsilon, not as -1. */
  const wrapTurns = (d: number): number => d - Math.round(d)

  interface EquidistanceCase {
    kind: 'cylindrical' | 'planet' | 'pannini' | 'mercator'
    extentX: number
    pose: { povLatitude: number, povLongitude: number }
    /** cos of the screen-centre point's latitude: 1 for the coordinate metric. */
    weight: number
    why: string
  }

  const CASES: ReadonlyArray<EquidistanceCase> = [
    {
      kind: 'cylindrical', extentX: 1,
      pose: { povLatitude: 0, povLongitude: 0 }, weight: 1,
      why: 'coordinate metric at the equator'
    },
    {
      kind: 'cylindrical', extentX: 1,
      pose: { povLatitude: 30, povLongitude: 45 }, weight: 1,
      why: 'coordinate metric at any pose: the rates never read the pose'
    },
    {
      kind: 'pannini', extentX: 4,
      pose: { povLatitude: 0, povLongitude: 0 }, weight: 1,
      why: 'centre column is isotropic in the coordinate metric'
    },
    {
      kind: 'pannini', extentX: 4,
      pose: { povLatitude: 30, povLongitude: 45 }, weight: 1,
      why: 'coordinate metric, off-equator pose'
    },
    {
      kind: 'mercator', extentX: 1,
      pose: { povLatitude: 0, povLongitude: 0 }, weight: 1,
      why: 'conformal; both metrics agree where the centre sits at M = 0'
    },
    {
      kind: 'mercator', extentX: 1,
      pose: { povLatitude: 30, povLongitude: 45 }, weight: Math.cos((30 * Math.PI) / 180),
      why: 'conformal: physical metric, centre latitude is the pose latitude'
    },
    {
      kind: 'planet', extentX: 4,
      pose: { povLatitude: 30, povLongitude: 45 }, weight: Math.sin((30 * Math.PI) / 180),
      why: 'tilt 0 is the pole at centre (degenerate metric) so planet starts at 30; centre latitude 90-30 = 60, cos 60 = sin 30'
    },
    {
      kind: 'planet', extentX: 4,
      pose: { povLatitude: 45, povLongitude: 45 }, weight: Math.sin((45 * Math.PI) / 180),
      why: 'second tilt; cos 45 = sin 45'
    }
  ]

  it.each(CASES)('$kind at lat $pose.povLatitude stays equidistant across aspects and zooms', ({ kind, extentX, pose, weight, why }) => {
    void why // recorded in the case table for the reader, not asserted
    const eps = 1e-4
    // The rate table, hand-transcribed (spec 2.1) -- NOT resolveExtent.
    const rate = kind === 'cylindrical' ? 2 * Math.PI : 1

    for (const aspect of [1, 16 / 9, 9 / 16]) {
      for (const zoom of [1, 0.5]) {
        const projection: Projection = { kind, zoom, extent: [extentX, extentX] }
        const halfX = extentX / 2
        const halfY = (extentX * rate) / aspect / 2

        // Screen centre +/- eps, as the inverted camera transform delivers
        // it: ndc x maps to the paper's z axis, ndc y to y (pinned separately
        // by the gate B surface-reconstruction tests in matrix.test.ts).
        const px = project(1, 0, eps * halfX, pose, projection)
        const mx = project(1, 0, -eps * halfX, pose, projection)
        const py = project(1, eps * halfY, 0, pose, projection)
        const my = project(1, -eps * halfY, 0, pose, projection)

        const du = Math.abs(wrapTurns(px.u - mx.u))
        const dv = Math.abs(py.v - my.v)
        // du is per 2*eps of ndc x = eps*W pixels; dv likewise per eps*H.
        // Equal angle per pixel horizontally and vertically is
        // |dtheta|*w = A*|dphi| with A = W/H, which in turn/v units is:
        expect(
          Math.abs(2 * du * weight - aspect * dv),
          `${kind} aspect ${aspect} zoom ${zoom} lat ${pose.povLatitude}`
        ).toBeLessThan(1e-9)
      }
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --project unit test/unit/reference.test.ts`
Expected: PASS (all 8 cases). If any case fails by O(1), the rate constant or the weight is wrong — STOP and report; do not loosen the tolerance. If it fails by ~1e-7..1e-5, report that too (it would contradict the pre-verified 4.3e-11 and means the transcription here drifted).

- [ ] **Step 3: Commit**

```bash
git add test/unit/reference.test.ts
git commit -m "test: screen-centre equidistance property -- I2's independent arbiter, bypassing resolveExtent (aspect-fit T4)"
```

---

### Task 5: rectangular ortho + the aspect signature cascade

Spec §3.3 (the whole table), §3.4 (zero-touch list — the shaders are NOT in this task), §5.1 (gate A pin lands in the same commit so every commit stays green).

One commit changes the signature everywhere, because a defaulted parameter would let a stale caller silently render the square box — the exact defect this card removes. Call sites: `Backend.setCamera` interface, both backend implementations, `viewer.ts #drawFrame`, `test/integration/support/gpu.ts`, `test/integration/support/cross-backend.ts` (GLSL leg + referenceImage), `test/integration/webgl2-smoke.test.ts`, `test/unit/webgpu-backend.test.ts`, `test/unit/matrix.test.ts`, `test/unit/matrix-baseline.test.ts`, `test/integration/gate-a-pixels.test.ts`.

**Files:**
- Modify: `src/core/matrix.ts`
- Modify: `src/renderer/backend.ts:76`
- Modify: `src/renderer/webgpu/backend.ts` (setCamera)
- Modify: `src/renderer/webgl2/backend.ts` (setCamera)
- Modify: `src/viewer/viewer.ts:375`
- Modify: `test/integration/support/gpu.ts:91`
- Modify: `test/integration/support/cross-backend.ts:119,244`
- Modify: `test/integration/webgl2-smoke.test.ts:89,152,215`
- Modify: `test/unit/webgpu-backend.test.ts`
- Modify: `test/unit/matrix.test.ts`
- Modify: `test/unit/matrix-baseline.test.ts`
- Modify: `test/integration/gate-a-pixels.test.ts:89-92`

- [ ] **Step 1: Write the new matrix tests first**

In `test/unit/matrix.test.ts`:

(a) Every existing `buildProjection(projection, depth, out)` and `buildCameraTransform(state, projection, depth, out)` call gains a final `1` (aspect 1) — the depth-convention tests (~lines 19-20, 33-34, 41-42), the buildCameraTransform composition test (~lines 97, 100), the surface-reconstruction CASES loop (~line 157), and the fragment-stage reconstruction (~line 202). Mechanical edit; assertions unchanged.

(b) Replace the test `bases the box half-width on the largest extent axis, not per axis` (~line 53) with:

```ts
  it('sizes the box per axis from a manual extent tuple (fit extent)', () => {
    // fit 'extent' takes the tuple literally: [4, 2] is a [-2, 2] x [-1, 1]
    // box, so gl[0] = 2/(2*2) = 0.5 and gl[5] = 2/(2*1) = 1 -- independent
    // per-axis scales, the rectangular-ortho contract the fragment
    // reconstruction reads the surface through. Both orderings, so a
    // transposed implementation fails at least one of them loudly.
    for (const [extent, sx, sy] of [[[4, 2], 0.5, 1], [[2, 4], 1, 0.5]] as const) {
      const manual: Projection = { kind: 'planet', zoom: 1, extent, fit: 'extent' }
      const gl = buildProjection(manual, 'minus-one-to-one', mat4.create(), 1)
      const zo = buildProjection(manual, 'zero-to-one', mat4.create(), 1)
      expect(gl[0]).toBeCloseTo(sx, 12)
      expect(gl[5]).toBeCloseTo(sy, 12)
      expect(zo[0]).toBeCloseTo(sx, 12)
      expect(zo[5]).toBeCloseTo(sy, 12)
    }
  })

  it('derives the container-fit height per camera rate', () => {
    // Literals derived independently from the rate table, not by running
    // resolveExtent. Cylindrical at A=2 resolves [1, 1] to [1, pi]:
    // gl[0] = 1/(1/2) = 2, gl[5] = 1/(pi/2) = 0.6366197723675814.
    const cylindrical: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    const gl = buildProjection(cylindrical, 'minus-one-to-one', mat4.create(), 2)
    expect(gl[0]).toBeCloseTo(2, 12)
    expect(gl[5]).toBeCloseTo(0.6366197723675814, 12)

    // Pannini at A=16/9 resolves [4, 4] to [4, 2.25]:
    // gl[0] = 2/4 = 0.5, gl[5] = 2/2.25 = 0.8888888888888888.
    const pannini: Projection = { kind: 'pannini', zoom: 1, extent: [4, 4] }
    const zo = buildProjection(pannini, 'zero-to-one', mat4.create(), 16 / 9)
    expect(zo[0]).toBeCloseTo(0.5, 12)
    expect(zo[5]).toBeCloseTo(0.8888888888888888, 12)
  })

  it("fit extent with a square tuple is bit-identical at any viewport (I6)", () => {
    // The legacy collapse was m = max(extent)/2; for a square tuple that is
    // exactly per-axis halves, so fit 'extent' + square tuple reproduces the
    // legacy matrix WHATEVER the container. This is what lets gate A keep
    // watching the v0.2.2 pixels instead of re-shooting the baseline. toEqual,
    // not toBeCloseTo: I6 is a bit-for-bit claim.
    const probe: Projection = { kind: 'planet', zoom: 1, extent: [4, 4], fit: 'extent' }
    const reference = buildProjection(probe, 'minus-one-to-one', mat4.create(), 1)
    for (const aspect of [16 / 9, 9 / 16, 2.39]) {
      const other = buildProjection(probe, 'minus-one-to-one', mat4.create(), aspect)
      expect(other).toEqual(reference)
    }
    expect(reference[0]).toBe(0.5)
    expect(reference[5]).toBe(0.5)
  })
```

(c) In the `gate B: surface reconstruction` describe, the four CASES projections gain `fit: 'extent'` (their span assertions read the raw tuple, and the container default at A=1 would resolve cylindrical to [1, 2π]):

```ts
  const CASES: ReadonlyArray<{
    camera: 'cylindrical' | 'planet' | 'pannini' | 'mercator'
    extent: readonly [number, number]
  }> = [
    { camera: 'cylindrical', extent: [1, 1] },
    { camera: 'planet', extent: [4, 4] },
    { camera: 'pannini', extent: [4, 4] },
    { camera: 'mercator', extent: [1, 1] }
  ]
```

and inside the loop the projection literal becomes `{ kind: camera, zoom: 1, extent, fit: 'extent' }`. Then append one container-fit case to the same describe:

```ts
  it('resolves the container fit before sizing the box (cylindrical at A=1 spans 1 x 2pi)', () => {
    // The container default at a square viewport: cylindrical's rate is 2pi,
    // so [1, 1] resolves to [1, 2pi] -- the same reconstruction as above, with
    // the span read from the RESOLVED pair rather than the tuple.
    const clip = buildCameraTransform(
      { povLatitude: 0, povLongitude: 0 },
      { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
      'zero-to-one',
      mat4.create(),
      1
    )
    const invClip = mat4.invert(mat4.create(), clip)
    if (!invClip) throw new Error('the camera transform must be invertible')

    const corners = [
      surfaceAt(invClip, -1, -1), surfaceAt(invClip, 1, -1),
      surfaceAt(invClip, -1, 1), surfaceAt(invClip, 1, 1)
    ]
    for (const c of corners) expect(c.x).toBeCloseTo(1, 3)
    const ys = corners.map(c => c.y)
    const zs = corners.map(c => c.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(1, 3)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2 * Math.PI, 3)
    expect(Math.max(...ys) + Math.min(...ys)).toBeCloseTo(0, 3)
    expect(Math.max(...zs) + Math.min(...zs)).toBeCloseTo(0, 3)
  })
```

(The existing `sizes the non-linear ortho box to half the largest extent` test at ~line 40 keeps passing at aspect 1 — planet's rate is 1 — leave it; optionally retitle it `...to half the extent at a square viewport`.)

(d) `test/unit/matrix-baseline.test.ts`: every non-linear projection literal `{ kind: camera, zoom: 1, extent: LEGACY_EXTENT[camera] }` gains `fit: 'extent'` (I6: the captured baselines must keep comparing bit-for-bit), and every `buildCameraTransform({ povLatitude, povLongitude }, projection, 'minus-one-to-one', mat4.create())` call gains a final `, 1`.

- [ ] **Step 2: Run to verify red**

Run: `npx vitest run --project unit test/unit/matrix.test.ts`
Expected: FAIL on `sizes the box per axis...` and `derives the container-fit height...` (today's builder ignores the aspect argument and collapses to max/2). The I6 test may already pass (the current code ignores aspect entirely) — that one is a pin, not a red.

- [ ] **Step 3: Implement `matrix.ts`**

In `src/core/matrix.ts`:

(a) Add the import: `import { resolveExtent } from './extent'`.

(b) Replace `buildProjection` so the non-linear branch resolves per axis (keep `NEAR`/`FAR`/`QUAD_NEAR`/`QUAD_FAR` exactly as they are):

```ts
/**
 * Builds the clip-space projection.
 *
 * The linear camera keeps its own `projection.aspect` as the authority -- the
 * `aspect` argument is the container's W/H and is deliberately ignored here.
 * The non-linear cameras resolve their surface extent against it
 * (`resolveExtent`): `fit: 'container'` derives the paper height so the
 * centre pixel stays square whatever the container's shape; `fit: 'extent'`
 * takes the tuple literally, which for a square tuple reproduces the legacy
 * `max(extent)/2` square box bit-for-bit at any viewport (the v0.2.2 pixel
 * contract gate A watches).
 */
export function buildProjection (
  projection: Projection,
  depth: DepthRange,
  out: mat4,
  aspect: number
): mat4 {
  if (projection.kind === 'linear') {
    if (depth === 'zero-to-one') {
      return perspectiveZO(out, projection.fov, projection.aspect, NEAR, FAR)
    }
    return perspective(out, projection.fov, projection.aspect, NEAR, FAR)
  }
  const [extentX, extentY] = resolveExtent(projection, aspect)
  if (depth === 'zero-to-one') {
    return orthoZO(out, -extentX / 2, extentX / 2, -extentY / 2, extentY / 2, QUAD_NEAR, QUAD_FAR)
  }
  return ortho(out, -extentX / 2, extentX / 2, -extentY / 2, extentY / 2, QUAD_NEAR, QUAD_FAR)
}
```

(Adapt to the file's real spelling of the gl-matrix imports and the existing early-return shape; the contract is: aspect param last, resolveExtent for non-linear, per-axis ortho, and the old `m = max(extent)/2` comment block replaced by the story above.)

(c) `buildCameraTransform` gains the same trailing `aspect: number` parameter and passes it to `buildProjection`.

- [ ] **Step 4: Cascade the signature**

(a) `src/renderer/backend.ts` — the interface method becomes:

```ts
  setCamera (state: CameraState, projection: Projection, aspect: number): void
```

(b) `src/renderer/webgpu/backend.ts` setCamera: signature gains `aspect: number`; the `buildCameraTransform(state, projection, 'zero-to-one', clip)` call gains `, aspect`.

(c) `src/renderer/webgl2/backend.ts` setCamera: same with `'minus-one-to-one'`.

(d) `src/viewer/viewer.ts:375` — `#drawFrame`'s call becomes:

```ts
      this.#backend.setCamera(this.#camera.state, this.#camera.projection, this.#camera.surfaceAspect)
```

(e) `test/integration/support/gpu.ts:91` — `renderOffscreen`'s call becomes `backend.setCamera(camera, projection, request.width / request.height)` (the offscreen target IS the viewport; its shape is the honest aspect).

(f) `test/integration/support/cross-backend.ts` — the GLSL leg's `buildCameraTransform(camera, projection, 'minus-one-to-one', clip)` (~line 119) gains `, request.width / request.height` (adapt to the real variable names in scope), and `referenceImage`'s extent line (~line 244) becomes:

```ts
  const extent = projection.kind === 'linear'
    ? ([2, 2] as const)
    : resolveExtent(projection, request.width / request.height)
```

with `import { resolveExtent } from '../../src/core/extent'` added. (The linear `[2, 2]` stays: linear is scale-invariant, so the tuple is inert there.)

(g) `test/integration/webgl2-smoke.test.ts` — the three `backend!.setCamera(ORIGIN, { kind: 'linear', ... })` calls (~lines 89, 152, 215) each gain `, 1`.

(h) `test/unit/webgpu-backend.test.ts` — every `h.backend.setCamera(CAMERA, LINEAR)` / `(..., CYLINDRICAL)` / `(..., MOVED, { ...CYLINDRICAL })` call gains `, 1`, and the singular-matrix mock's parameter list (~line 458) gains `_aspect` before `out`:

```ts
    vi.mocked(buildCameraTransform).mockImplementationOnce((_state, _projection, _depth, _aspect, out) => {
```

(i) `test/integration/gate-a-pixels.test.ts` — the non-linear state construction (~lines 89-92) gains the pin (spec §5.1; the baseline is NOT re-shot):

```ts
    : { kind: camera, zoom: 1, extent: LEGACY_EXTENT[camera], fit: 'extent' }
```

- [ ] **Step 5: Run unit green, then the gates**

Run: `npx vitest run --project unit`
Expected: PASS — all unit files.

Run: `npx vitest run --project integration test/integration/gate-a-pixels.test.ts test/integration/gate-c-cross-backend.test.ts test/integration/gate-b-projection.test.ts`
Expected: PASS — gate A bit-stable through `fit: 'extent'`; gate C green because both backends and the reference now share the resolved extent; gate B green because its assertions are pose-diff and extent[0]-sensitivity based, which the framing change preserves.

If gate A fails: the `fit: 'extent'` pin did not land everywhere it must (check the second `camerasOf()`-style construction if the file has more than one), or I6 broke — do not touch tolerance.

- [ ] **Step 6: Commit**

```bash
git add src/core/matrix.ts src/renderer/backend.ts src/renderer/webgpu/backend.ts src/renderer/webgl2/backend.ts src/viewer/viewer.ts test/integration/support/gpu.ts test/integration/support/cross-backend.ts test/integration/webgl2-smoke.test.ts test/unit/webgpu-backend.test.ts test/unit/matrix.test.ts test/unit/matrix-baseline.test.ts test/integration/gate-a-pixels.test.ts
git commit -m "feat: rectangular ortho from the container aspect across the render chain; gate A pinned to fit extent (aspect-fit T5)"
```

---

### Task 6: mercator drag metres scale by the resolved extent_y

Spec §4 (the classifyDragMercator row and the viewer pan row). Today's hardcoded `extent[1] = 1` was a placeholder from before this mechanism existed; one screen height of drag = `2π · zoom · extent_y` metres.

**Files:**
- Modify: `src/interaction/gestures.ts` (`classifyDragMercator`)
- Modify: `src/interaction/input-controller.ts` (`dragToMercatorPan`)
- Modify: `src/viewer/viewer.ts` (mercator pan branch, ~lines 145-157)
- Test: `test/unit/gestures.test.ts:118-160`
- Test: `test/integration/ptz.test.ts:205-215`
- Test: `test/integration/mercator-drag.test.ts`

- [ ] **Step 1: Write the failing unit tests first**

In `test/unit/gestures.test.ts`, inside the `classifyDragMercator` describe (surface `{ width: 400, height: 200 }`):

(a) Every existing call gains the new `extentY` argument with value `1` — their literals are unchanged (the placeholder semantics they pinned become the explicit resolved value at a square-ish framing).

(b) Add:

```ts
  it('scales the metres by the resolved extent_y (one screen height = 2pi*zoom*extentY)', () => {
    // A 16:9 container resolves mercator [1, 1] to [1, 0.5625]; a 9:16 one
    // to [1, 1.7778]. Pannini-shaped papers scale the same way. Derived
    // independently: 2pi*1*2.25 = 14.137166941154069;
    // 2pi*0.5*2.25 = 7.0685834705770345.
    const surface = { width: 400, height: 200 }
    const up = { deltaX: 0, deltaY: -200 }
    expect(classifyDragMercator(up, surface, 1, 2.25).meters).toBeCloseTo(14.137166941154069, 10)
    expect(classifyDragMercator(up, surface, 0.5, 2.25).meters).toBeCloseTo(7.0685834705770345, 10)
    // lng never reads the extent.
    expect(classifyDragMercator(up, surface, 1, 2.25).lng).toBe(0)
  })
```

(Adapt the call shape to the file's actual helper spelling — if the describe builds `delta`/`surface` once, reuse them.)

- [ ] **Step 2: Run to verify red**

Run: `npx vitest run --project unit test/unit/gestures.test.ts`
Expected: FAIL — `classifyDragMercator` takes no `extentY` (TypeError, wrong arity at runtime under esbuild).

- [ ] **Step 3: Implement**

(a) `src/interaction/gestures.ts` — `classifyDragMercator` gains the parameter and the factor (keep the zero-size guard exactly as it is):

```ts
export function classifyDragMercator (
  delta: { deltaX: number, deltaY: number },
  surface: { width: number, height: number },
  zoom: number,
  extentY: number
): { lng: number, meters: number } {
  if (surface.width <= 0 || surface.height <= 0) return { lng: 0, meters: 0 }
  return {
    lng: -(delta.deltaX / surface.width) * 360,
    meters: -(delta.deltaY / surface.height) * 2 * Math.PI * zoom * extentY
  }
}
```

(Keep the function's real doc comment; add one line to it: the metres are per the RESOLVED extent — one screen height of drag is `2π · zoom · extent_y` metres on the paper.)

(b) `src/interaction/input-controller.ts` — `dragToMercatorPan(deltaX, deltaY, surface, zoom, extentY)` gains the parameter and passes it through (thin passthrough, same as today).

(c) `src/viewer/viewer.ts` — in the `'pan'` handler's mercator branch (~line 145), resolve the extent and pass it:

```ts
      if (projection.kind === 'mercator') {
        // Content-follows-hand in the metre metric (mercator-camera spec
        // section 4): one screen height of drag is 2pi*zoom*extent_y metres
        // on the RESOLVED paper, so the drag scales with the framing the
        // viewer actually shows. `rotate` still reports the APPLIED delta --
        // the pose difference the pan actually produced.
        const extentY = resolveExtent(projection, this.#camera.surfaceAspect)[1]
        const d = this.#input.dragToMercatorPan(deltaX, deltaY, surface, projection.zoom, extentY)
        if (d.meters === 0 && d.lng === 0) return
        const before = this.#camera.state.povLatitude
        this.#camera.panMercator(d.meters, d.lng)
        this.events.emit('rotate', { lat: this.#camera.state.povLatitude - before, lng: d.lng })
        return
      }
```

(Preserve the branch's existing comment text where it overlaps — the intent is: only the `extentY` resolution and the extra argument are new.) Add `import { resolveExtent } from '../core/extent'` at the top.

- [ ] **Step 4: Update the twin and the end-to-end literals**

(a) `test/integration/ptz.test.ts` (~line 208): `input.dragToMercatorPan(100, -50, { width: 1000, height: 500 }, 0.5)` gains `, 1` — its literals (`lng` −36, `meters` 0.3141592653589793) are unchanged at extentY 1.

(b) `test/integration/mercator-drag.test.ts` — the tests mount in a 400×200 container, so the viewer now resolves extent_y = 0.5 and the pose literals move. Update exactly these pins (derived independently; `2π·0.16·0.5 = 0.5026548245743669`):

- test 1 (`a vertical drag pans in the metre metric...`): pose and event latitude `49.801690337054204` → `27.658619791226776` (both places), and the derivation comment: `metres = -(deltaY/h)*2pi*zoom*extent_y = 2pi*0.16*0.5` .
- test 4 (`metres scale by the zoom in force...`): after `viewer.zoom(1)` the zoom halves to 0.5, so metres halve again: pose `27.658619791226776` → `14.250753735296483`; update the comment's arithmetic accordingly.
- test 5 (`the rotate event carries the applied delta...`): from lat 89, `L = 89.39506770045162`, applied `= 0.39506770045161943`.
- tests 2 and 3 (horizontal drags) are unchanged — metres are 0 and the `deltaM === 0` shortcut keeps latitude bit-exact.

Each updated comment keeps the "derived independently" phrasing already in the file.

- [ ] **Step 5: Run green**

Run: `npx vitest run --project unit test/unit/gestures.test.ts`
Expected: PASS.

Run: `npx vitest run --project integration test/integration/mercator-drag.test.ts --project no-webgpu test/integration/mercator-drag.test.ts`
Expected: PASS in both projects (the no-webgpu run proves the WebGL2 leg of the same story).

- [ ] **Step 6: Commit**

```bash
git add src/interaction/gestures.ts src/interaction/input-controller.ts src/viewer/viewer.ts test/unit/gestures.test.ts test/integration/ptz.test.ts test/integration/mercator-drag.test.ts
git commit -m "feat: mercator drag metres scale by the resolved extent_y (aspect-fit T6)"
```

---

### Task 7: gate B gains the aspect dimension

Spec §5.4 (gate B row): 1:1 / 16:9 / 9:16 × four cameras, screen edges against the reference **with the resolved extent**.

**Files:**
- Modify: `test/integration/gate-b-projection.test.ts`

- [ ] **Step 1: Add the test**

Append a new test to the file's top-level describe (it imports `compareWithReference` from `./support/cross-backend`; check the file's existing imports and add `import { compareWithReference } from './support/cross-backend'` if absent):

```ts
  it('frames every camera against the reference at three container shapes', async () => {
    // The aspect-fit framing contract at the pixel level (spec 5.4, gate B
    // row): at each container shape the rendered screen edges must land
    // where the float64 reference puts them, with the extent RESOLVED for
    // that shape. A wrong rate constant (say cylindrical forgetting its 2pi)
    // displaces the poles off-screen and shows up frame-wide, far above 2.
    // 256x144 is 16:9, 144x256 is 9:16, 128x128 the square.
    const SHAPES: ReadonlyArray<{ width: number, height: number, label: string }> = [
      { width: 256, height: 144, label: '16:9' },
      { width: 144, height: 256, label: '9:16' },
      { width: 128, height: 128, label: '1:1' }
    ]
    for (const camera of CAMERAS) {
      const extent = camera === 'mercator' ? [1, 1] : LEGACY_EXTENT[camera]
      const projection = { kind: camera, zoom: 1, extent } as Projection
      for (const shape of SHAPES) {
        const r = await compareWithReference(
          { povLatitude: 0, povLongitude: 0 },
          projection,
          shape
        )
        expect(r.webgpu, `${camera} ${shape.label} webgpu vs reference`).toBeLessThanOrEqual(2)
        expect(r.webgl2, `${camera} ${shape.label} webgl2 vs reference`).toBeLessThanOrEqual(2)
      }
    }
  })
```

`compareWithReference` today renders at `GATE_C_SIZE` squares. Widen it in `test/integration/support/cross-backend.ts` with an optional shape parameter that defaults to the square (so every existing caller is untouched):

```ts
export async function compareWithReference (
  camera: CameraState,
  projection: Projection,
  shape: { width: number, height: number } = { width: GATE_C_SIZE, height: GATE_C_SIZE }
): Promise<{ webgpu: number, webgl2: number }>
```

and thread `shape.width`/`shape.height` into the render-request objects it builds for both backends (read the function body first and mirror its existing construction style; the reference leg already reads `width`/`height` from the same request, so `referenceImage` follows for free). Give `renderBothBackends` the same optional shape parameter in this same commit, with the same square default — Task 8 relies on it.

Check the file for the exact helper names (`CAMERAS`, `LEGACY_EXTENT` — gate B already declares both) and adapt the spelling; the contract is: three shapes × four cameras, both backends against the reference, tolerance 2, projections carry NO `fit` (the container default is the behaviour under test).

- [ ] **Step 2: Run**

Run: `npx vitest run --project integration test/integration/gate-b-projection.test.ts`
Expected: PASS. A failure above tolerance on one camera at one shape = a framing bug the unit property test could not see (it tests the reference, not the render path through the matrix) — investigate, do not loosen.

- [ ] **Step 3: Commit**

```bash
git add test/integration/gate-b-projection.test.ts test/integration/support/cross-backend.ts
git commit -m "test: gate B covers the three container shapes against the resolved-extent reference (aspect-fit T7)"
```

---

### Task 8: gate C covers the rectangular ortho path

Spec §5.4 (gate C row): at least square + 16:9 + 9:16, three-way agreement.

**Files:**
- Modify: `test/integration/gate-c-cross-backend.test.ts`
- Modify: `test/integration/support/cross-backend.ts` (if the shape parameter was not added in Task 7)

- [ ] **Step 1: Add the test**

Append to the main describe (the four non-linear kinds only, spelt explicitly — linear keeps its own `projection.aspect` authority, and its behaviour at rectangular offscreen sizes is not this card's contract):

```ts
  it('agrees across backends and the reference on rectangular viewports (aspect-fit 5.4)', async () => {
    // The rectangular ortho box travels through invClip, which the shaders
    // consume without knowing anything changed -- this leg proves both
    // backends build the box from the SAME resolved extent. Posed (lat 30),
    // so the latitude terms are non-trivial, exactly like the square arbiter
    // legs above.
    const s: State = { povLatitude: 30, povLongitude: 45, fov: (75 * Math.PI) / 180, zoom: 1 }
    const KINDS = ['cylindrical', 'planet', 'pannini', 'mercator'] as const
    for (const shape of [
      { width: 256, height: 144, label: '16:9' },
      { width: 144, height: 256, label: '9:16' }
    ]) {
      for (const kind of KINDS) {
        const diff = await renderBothBackends(state(s), projectionFor(kind, s), shape)
        expect(
          diff.max,
          `${kind} ${shape.label} backend-vs-backend worst channel`
        ).toBeLessThanOrEqual(2)
      }
      // The arbiter at the same shapes: cylindrical <= 3, planet <= 4 (the
      // two square pins above carry the four-requirement rationale; the
      // chains are unchanged by the box's shape), mercator <= 3. Pannini is
      // new as an arbitration leg: measure first (run once, read the printed
      // values), then keep the <= 3 pin with the measured values recorded
      // here in a comment -- never fabricate a 'measured' line (the
      // four-requirement protocol the planet leg records above).
      const rCyl = await compareWithReference(state(s), projectionFor('cylindrical', s), shape)
      expect(rCyl.webgpu, `cylindrical ${shape.label}`).toBeLessThanOrEqual(3)
      expect(rCyl.webgl2, `cylindrical ${shape.label}`).toBeLessThanOrEqual(3)
      const rPlanet = await compareWithReference(state(s), projectionFor('planet', s), shape)
      expect(rPlanet.webgpu, `planet ${shape.label}`).toBeLessThanOrEqual(4)
      expect(rPlanet.webgl2, `planet ${shape.label}`).toBeLessThanOrEqual(4)
      const rMerc = await compareWithReference(state(s), projectionFor('mercator', s), shape)
      expect(rMerc.webgpu, `mercator ${shape.label}`).toBeLessThanOrEqual(3)
      expect(rMerc.webgl2, `mercator ${shape.label}`).toBeLessThanOrEqual(3)
      const rPannini = await compareWithReference(state(s), projectionFor('pannini', s), shape)
      expect(rPannini.webgpu, `pannini ${shape.label}`).toBeLessThanOrEqual(3)
      expect(rPannini.webgl2, `pannini ${shape.label}`).toBeLessThanOrEqual(3)
    }
  })
```

(`renderBothBackends`/`compareWithReference` take the optional shape parameter added in Task 7; `projectionFor` and `state` are the file's existing helpers, used exactly as the square arbiter legs above use them. If `projectionFor` does not exist under that name, use whatever the existing legs call and keep the posed state literal; if `projectionFor` hardcodes `zoom: 1` rather than reading `s.zoom`, that is fine here — this test sits at zoom 1.)

If a pannini leg measures above 3: record the measured pair in the comment and pin the smallest power of two strictly above twice the larger measured value — the protocol the planet leg documents — and say so in the commit message.

- [ ] **Step 2: Run**

Run: `npx vitest run --project integration test/integration/gate-c-cross-backend.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/integration/gate-c-cross-backend.test.ts test/integration/support/cross-backend.ts
git commit -m "test: gate C covers rectangular viewports, pannini joins the arbitration legs (aspect-fit T8)"
```

---

### Task 9: the user story — resize reframes without distortion

Spec §5.4 (aspect-fit.test.ts row). Public surface only: `FramelessImageViewer`, a generated periodic source, a container resize through the real ResizeObserver path, canvas readback vs the in-page CPU reference at the new aspect. Loose tolerance (~24/channel): precision is the gates' job; this test's guarded failure is a stretch, which produces frame-wide differences far above that.

**Files:**
- Create: `test/integration/aspect-fit.test.ts`
- Modify: `vitest.config.ts` (no-webgpu include — the mercator CRITICAL lesson: a story file not whitelisted there has ZERO executing tests in CI)

- [ ] **Step 1: Write the test**

Create `test/integration/aspect-fit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { makeContainer, canvasOf } from './support/dom'
import { nextFrames, readCanvas, maxChannelDiff } from './support/canvas'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'
import { ndcToSurface, project } from '../../src/core/reference'
import { resolveExtent } from '../../src/core/extent'
import type { Projection } from '../../src/core/types'

/*
 * The aspect-fit user story: mount square, reshape the container to 16:9
 * through the real ResizeObserver path, and check the presented pixels
 * against the float64 reference AT THE NEW ASPECT. A stretch — the defect
 * this card removes — displaces nearly every pixel and lands far above the
 * loose tolerance; the tight tolerances live in the gates, not here.
 */

/** A periodic 64x64 equirectangular source as a data URL, gate-Source style. */
function periodicSource (): { url: string, pixels: (x: number, y: number) => [number, number, number] } {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('no 2d context for the synthetic source')
  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = (y * size + x) * 4
      image.data[i]! = Math.round(128 + 120 * Math.cos(2 * Math.PI * u))
      image.data[i + 1]! = Math.round(128 + 120 * Math.cos(2 * Math.PI * v))
      image.data[i + 2]! = Math.round(128 + 120 * Math.sin(8 * Math.PI * u) * Math.sin(8 * Math.PI * v))
      image.data[i + 3]! = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const data = Array.from(image.data)
  // Nearest-neighbour fetch with REPEAT on u and CLAMP on v -- deliberately
  // not bilinear: the comparison samples away from texel edges, and a simple
  // fetch keeps this file's reference independent from cross-backend.ts.
  const pixels = (u: number, v: number): [number, number, number] => {
    const uu = ((u % 1) + 1) % 1
    const vv = Math.min(0.99999, Math.max(0, v))
    const i = (Math.floor(vv * size) * size + Math.floor(uu * size)) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!]
  }
  return { url: canvas.toDataURL('image/png'), pixels }
}

const POSE = { povLatitude: 0, povLongitude: 0 }

describe('aspect fit (user story)', () => {
  for (const camera of ['cylindrical', 'planet'] as const) {
    it(`${camera} reframes without distortion when the container goes 16:9`, async (ctx) => {
      await skipIfPresentedCanvasBroken(ctx)
      const source = periodicSource()
      // Square mount: the framing at A=1 matches the square paper exactly,
      // which is what makes the 16:9 reshape a pure framing change.
      const container = makeContainer(360, 360)
      const projection: Projection =
        camera === 'cylindrical'
          ? { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
          : { kind: 'planet', zoom: 1, extent: [4, 4] }
      const viewer = await FramelessImageViewer.create({
        container,
        src: source.url,
        camera: { projection }
      })
      try {
        await nextFrames(3)
        container.style.width = '640px'
        container.style.height = '360px'
        // ResizeObserver delivery + invalidate + a drawn frame + present.
        await nextFrames(5)

        const canvas = canvasOf(container)
        const read = await readCanvas(canvas, 160, 90)
        const extent = resolveExtent(projection, 640 / 360)

        let worst = 0
        for (let py = 4; py < 90; py += 8) {
          for (let px = 4; px < 160; px += 8) {
            const ndcX = ((px + 0.5) / 160) * 2 - 1
            const ndcY = 1 - ((py + 0.5) / 90) * 2
            const surface = ndcToSurface(ndcX, ndcY, extent)
            const uv = project(surface[0], surface[1], surface[2], POSE, projection)
            const expected = source.pixels(uv.u, 1 - uv.v)
            const i = (py * 160 + px) * 4
            const got = [read.data[i]!, read.data[i + 1]!, read.data[i + 2]!]
            worst = Math.max(worst, maxChannelDiff(got, expected))
          }
        }
        // Loose on purpose: the readback downscales 640x360 -> 160x90 and
        // the fetch is nearest-neighbour, so a few channels of filtering
        // disagreement are expected. A stretch lands at O(100).
        expect(worst, `${camera} worst channel after 16:9 reshape`).toBeLessThanOrEqual(24)
      } finally {
        viewer.dispose()
        container.remove()
      }
    })
  }
})
```

Two cautions the executor must verify on first run: (1) `project`'s `v` is unflipped in the reference convention — cross-backend's referenceImage samples with `1 - v`, mirrored above; if the first run shows a systematic v-mirror (worst ≈ 200+ on HALF the samples and ≈0 on the rest), the flip convention in this file is wrong, not the renderer — fix the sampling line and note it in the commit. (2) The canvas drawing buffer may be dpr-scaled; `readCanvas` downscales to 160x90 regardless, and the ndc grid is taken in readback coordinates, so dpr cancels — but the ASPECT fed to `resolveExtent` must be the container's css aspect (640/360), which is what the viewer itself used.

- [ ] **Step 2: Whitelist the story in the no-webgpu project**

In `vitest.config.ts`, the no-webgpu `include` (the whitelist whose third line currently reads `'test/integration/(viewer-events|dispose-order|mercator-drag).test.ts'`) — extend that third line to:

```ts
            'test/integration/(viewer-events|dispose-order|mercator-drag|aspect-fit).test.ts'
```

(Only `aspect-fit` is added here. The sibling card `rotate-applied-delta` adds its own name to this same alternation in its own commit — if it has already landed, the line will already carry `|rotate-applied-delta` and you keep it; never remove another card's name from the whitelist.)

- [ ] **Step 3: Run both projects**

Run: `npx vitest run --project integration test/integration/aspect-fit.test.ts`
Expected: PASS (2 tests).

Run: `npx vitest run --project no-webgpu`
Expected: the file is collected and its 2 tests PASS on WebGL2 with a null adapter (that is the point of the whitelist).

- [ ] **Step 4: Commit**

```bash
git add test/integration/aspect-fit.test.ts vitest.config.ts
git commit -m "test: aspect-fit user story -- resize reframes without distortion, whitelisted for no-webgpu (aspect-fit T9)"
```

---

### Task 10: README + CLAUDE.md

Spec §6, §5.2. `scripts/check-readme-options.mjs` only checks the constructor-options table — the camera table is free to change, and `npm run typecheck` runs it anyway.

**Files:**
- Modify: `README.md:93-99` (camera table), `README.md:167-171` (rule of thumb)
- Modify: `CLAUDE.md` (the arbiter paragraph)

- [ ] **Step 1: README camera table**

The four non-linear rows' Parameters column gains `fit`; the Fields column keeps its text. New rows:

```markdown
| `kind` | Parameters | Fields |
|---|---|---|
| `'linear'` | `fov` (radians, clamped to 15°–110°), `aspect` | The classic perspective camera; `aspect` is maintained by the viewer from the container's size. |
| `'cylindrical'` | `zoom` (0.01–1), `extent` (1×1), `fit` | Full 360° horizontally, vertical lines stay vertical. |
| `'planet'` | `zoom` (0.01–1), `extent` (4×4), `fit` | The "little planet" look — the ground wraps into a sphere. |
| `'pannini'` | `zoom` (0.01–1), `extent` (4×4), `fit` | Pannini projection — very wide fields of view with verticals kept straight. |
| `'mercator'` | `zoom` (0.01–1), `extent` (1×1), `fit` | Conformal cylinder — uniform scale everywhere, poles at infinity. |
```

Directly after the table (before the `camera.pose` paragraph), insert:

```markdown
For the four non-linear kinds, `zoom` (with `extent[0]`) controls the
horizontal span only; the vertical framing follows the container's shape so
the picture is never stretched — at the screen centre, one pixel covers the
same panorama angle in both directions. `fit: 'extent'` opts out: the
`extent` pair is then taken literally as `[width, height]` (anamorphic
lenses, locked framing, or reproducing the pre-1.0 square behaviour), with
`extent[1]` ignored under the default `fit: 'container'`.
```

- [ ] **Step 2: README rule of thumb**

Append one sentence to the rule-of-thumb paragraph (after "`mercator` when every latitude must share one scale — the map look, poles pushed to infinity."):

```markdown
On the non-linear cameras the container's shape is honoured automatically;
reach for `fit: 'extent'` only when you need a locked manual frame.
```

- [ ] **Step 3: CLAUDE.md — three departures become four**

In the arbiter paragraph, change `with three adjudicated exceptions` to `with four adjudicated exceptions`, and after the planet branch-points clause (`... instead of the faithful \`atan(0/0)\` NaN.`) insert:

```markdown
; and the square ortho box, which since 2026-10-07 resolves per axis from the container's aspect (the camera-aspect-fit spec) instead of collapsing to `max(extent)/2` on both axes — reachable bit-for-bit via `fit: 'extent'` with a square tuple, which is how gate A keeps its baseline
```

(Keep the following mercator-exemption sentence intact.)

- [ ] **Step 4: Verify and commit**

Run: `npm run typecheck`
Expected: 0 errors, `check-readme-options` green.

```bash
git add README.md CLAUDE.md
git commit -m "docs: aspect-fit semantics in README; fourth adjudicated departure in CLAUDE.md (aspect-fit T10)"
```

---

### Task 11: gallery re-shoot (five screenshots)

Spec §6: today's five 800×450 shots all carry the 1.78×/3.53× vertical stretch; after this card they would showcase the old defect. Re-shoot at the same 800×450 through the demo lab URLs — which now render undistorted by default. The mercator-card precedent: playwright-core capture, `source=4k`, `.dock{display:none}` injected, fresh reload per camera (zoom resets to 1).

**Files:**
- Modify: `demo/shots/linear.png`, `cylindrical.png`, `planet.png`, `pannini.png`, `mercator.png`

- [ ] **Step 1: Write the capture script**

Create `.vibe/shoot-gallery.mjs` (`.vibe` is gitignored; the worktree will not have it yet — creating the directory is fine):

```js
// Gallery re-shoot for camera-aspect-fit: 800x450 through the demo lab.
// playwright-core has no bundled browser; channel 'chrome' is what this
// machine has (the same route that shot mercator.png). The dock is hidden so
// the shots show pure rendering, like the existing four.
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:5175'
const SHOTS = [
  ['linear', 'linear.png'],
  ['cylindrical', 'cylindrical.png'],
  ['planet', 'planet.png'],
  ['pannini', 'pannini.png'],
  ['mercator', 'mercator.png']
]

const browser = await chromium.launch({ channel: 'chrome' })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 })
  for (const [kind, file] of SHOTS) {
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${BASE}/?projection=${kind}&source=4k`, { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '.dock{display:none}' })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `demo/shots/${file}` })
    if (errors.length > 0) throw new Error(`${kind}: page errors ${errors.join('; ')}`)
    console.log(`${kind} -> demo/shots/${file} (${errors.length} page errors)`)
  }
} finally {
  await browser.close()
}
```

- [ ] **Step 2: Start the demo server and run it**

```bash
npm run start -- --port 5175 --strictPort &
node .vibe/shoot-gallery.mjs http://localhost:5175
kill %1
```

(5175 to stay clear of the main checkout's 5173 and the lab-smoke precedent's 5174. If `channel: 'chrome'` fails to launch, find an executable with `npx playwright-core install --dry-run 2>/dev/null || true` guidance absent — fall back to pointing `executablePath` at any local Chromium and record the substitution in the commit message.)

Expected output: five `kind -> demo/shots/kind.png (0 page errors)` lines.

- [ ] **Step 3: Verify the artifacts**

Run: `git diff --stat -- demo/shots/ && file demo/shots/*.png`
Expected: all five modified; each PNG 800×450 (the `file` output or `sips -g pixelWidth -g pixelHeight demo/shots/*.png`). Sanity: each file roughly in the existing siblings' size class (700–900 KB; a blank or black frame is tens of KB — that is the failure signal).

Visual sanity (the point of the re-shoot): in `cylindrical.png` the horizon band sits mid-frame with no vertical smear; in `mercator.png` the pole rows are NOT stretched off-frame. If a `/browse` session with GPU is unavailable, the size/diff checks plus the story tests carry the verification — record which route was taken.

- [ ] **Step 4: Commit**

```bash
git add demo/shots/
git commit -m "docs: gallery re-shot at 800x450 under the container-fit default framing (aspect-fit T11)"
```

---

### Task 12: final verification chain

**Files:** none (verification only).

- [ ] **Step 1: The full chain, in this order**

```bash
npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
```

Expected, in order: gen-shaders idempotent (working tree unchanged — `git status` clean afterwards); build succeeds; `npm test` all green (unit, integration, no-webgpu — including the new aspect-fit.test.ts in both GPU and no-webgpu projects); typecheck 0 errors across the three programs + check-readme-options; lint zero warnings; coverage branch ≥ 90% (the enforced threshold — record the number).

- [ ] **Step 2: The zero-touch audit**

Run: `git diff --name-only master...HEAD -- src/renderer/shaders/generated.ts src/renderer/webgpu/shaders/panorama.wgsl src/renderer/webgl2/shaders/panorama.glsl src/core/projection-kinds.json src/index.ts`
Expected: EMPTY (spec §3.4 — the shaders, the constants pipeline and the public surface are untouched; `generated.ts` must show no diff because `gen:shaders` is idempotent and nothing it reads changed).

- [ ] **Step 3: Self-review against the spec**

Walk spec §8's file-anchor table and confirm every row is either changed by a task above or explicitly zero-touch. Check §2.3's invariants each have a pin: I1 (width untouched — extent.test + matrix derivation test), I2 (Task 4), I3 (resolveExtent never reads zoom — structural + the property test's zoom loop), I4 (extent.test mercator A=1 → [1,1]), I5 (property test spans 9:16 aspect; mercator's asymptote — no NaN assertions regress in reference.test), I6 (matrix I6 bit-identity + gate A green without re-shooting). Fix gaps inline before reporting done.

- [ ] **Step 4: No commit** (verification only) — proceed to the card's reporting flow (task-finish).

---

## Plan-level self-review (already applied)

- **Spec coverage:** §1.2/§2.2 → T1; §2.4 → T1; §3.2 → T2; §3.3 reference row → T3; §5.2 → T3; §5.3 → T4; §3.3 matrix/backend/viewer rows + §5.1 → T5; §4 → T6; §5.4 gate B/C/story rows → T7/T8/T9; §6 → T10/T11; §2.3 invariants → T1/T4/T5 pins (map in T12 step 3); §3.4 zero-touch → T12 step 2 audit; §7 non-goals — nothing in the plan touches drag-unification, letterbox, linear, magic values, k configurability, or shaders.
- **No placeholders:** every step carries complete code or an exact mechanical instruction with the resulting code stated; the two "adapt to the file's real spelling" notes (T3 signature cosmetics, T5 gl-matrix import shape) are name-fidelity instructions, not deferred content.
- **Type consistency:** `resolveExtent(projection: NonLinearProjection, aspect: number): readonly [number, number]` used identically in T1/T5/T6/T9; `setCamera(state, projection, aspect)` in T5's interface, both backends, viewer, gpu.ts; `classifyDragMercator(delta, surface, zoom, extentY)` / `dragToMercatorPan(..., zoom, extentY)` in T6; `buildProjection(projection, depth, out, aspect)` / `buildCameraTransform(state, projection, depth, out, aspect)` throughout T5.
