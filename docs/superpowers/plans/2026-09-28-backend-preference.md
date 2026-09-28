# Backend Preference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** Add a strict create-time `backend` option (`'auto' | 'webgpu' | 'webgl2'`) to both public viewers, and a lab status-panel switch that consumes it.

**Architecture:** The preference is validated like every other option (a wrong union member from a JS caller gets a `TypeError`), threaded into `createBackend(canvas, preference)` where a forced value tries exactly one backend and rejects naming it — `'auto'`/omitted keeps today's WebGPU-first path byte-identical. The lab keeps the preference as shell state (URL bookmark, never the capability readback), and switching backends reuses the cross-class recreate machine (dispose + recreate, pose carried).

**Tech Stack:** TypeScript 5 (strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), vitest (node / browser-mode integration / no-webgpu projects), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-backend-preference-design.md` — §2's behaviour matrix is the contract this plan implements.

**Discipline (superloop):** commits use the `task-backend-preference:` prefix; only touch the files listed here; never merge into master.

---

## File Structure

| File | Change |
|---|---|
| `src/viewer/options.ts` | `BackendPreference` type, `assertBackend`, `backend?` field |
| `src/viewer/backend-factory.ts` | `createBackend(canvas, preference?)` branch |
| `src/viewer/image-viewer.ts` | thread `valid.backend` (one line) |
| `src/viewer/video-viewer.ts` | thread `valid.backend` (one line) |
| `src/index.ts` | export the type (additive; the surface is frozen but additive is allowed) |
| `test/unit/constructor-validation.test.ts` | validation cases |
| `test/unit/backend-factory.test.ts` | new: preference branch, node environment |
| `test/integration/support/viewer.ts` | factories gain a `backend` option |
| `test/integration/backend-preference.test.ts` | new user story (real-GPU project) |
| `test/integration/fallback/backend-preference.test.ts` | new negative (no-webgpu project) |
| `demo/lab/context.ts` | `setBackend` on `LabContext` |
| `demo/lab/main.ts` | preference state, URL in/out, recreate-on-switch, boot-failure param strip |
| `demo/lab/panels/status.ts` | segmented control |
| `README.md` | one sentence in the demo paragraph |

No CSS change: the `.segmented` styles already exist (`demo/lab/lab.css:72-83`).

---

### Task 1: The `BackendPreference` type and its validation

**Files:**
- Modify: `src/viewer/options.ts`
- Modify: `src/index.ts:11`
- Test: `test/unit/constructor-validation.test.ts`

- [x] **Step 1: Write the failing tests**

Append to `test/unit/constructor-validation.test.ts` (inside the file, after the last `describe`; nothing else in the file changes). The imports at the top already bring in both validate functions:

```ts
describe('backend preference', () => {
  const container = { nodeType: 1 } as unknown as HTMLElement

  it('accepts each member of the union and the omitted case', () => {
    // 'auto' is the spelled-out default; omitting the field must behave the
    // same way, or the option would be mandatory in all but name.
    for (const backend of ['auto', 'webgpu', 'webgl2'] as const) {
      expect(() => validateImageOptions({ container, src: '/a.png', backend })).not.toThrow()
    }
    expect(() => validateImageOptions({ container, src: '/a.png' })).not.toThrow()
  })

  it('rejects a wrong union member with a message that lists the valid values', () => {
    // TypeScript stops its own callers at compile time; this branch is for
    // the JavaScript caller. The message names all three valid values so the
    // fix needs no documentation lookup -- same reasoning as the projection
    // misspelling message above.
    expect(() => validateImageOptions({ container, src: '/a.png', backend: 'vulkan' } as never))
      .toThrow(/'auto', 'webgpu', 'webgl2'/)
  })

  it('covers the video entry point through validateVideoOptions', () => {
    // validateVideoOptions delegates to validateImageOptions; this pins that
    // the delegation actually carries the new field rather than validating
    // it in a video-only copy that could drift.
    expect(() => validateVideoOptions({ container, src: '/a.mp4', backend: 'webgl2' })).not.toThrow()
    expect(() => validateVideoOptions({ container, src: '/a.mp4', backend: 'directx' } as never))
      .toThrow(/backend/)
  })
})
```

- [x] **Step 2: Run them and verify the meaningful ones fail**

Run: `npx vitest run --project unit test/unit/constructor-validation.test.ts`
Expected: the two rejection tests FAIL (nothing throws yet). The acceptance tests may pass vacuously — there is no check to reject — which is exactly why the rejection tests are the red/green signal here.

- [x] **Step 3: Implement the type, the field and the assert**

In `src/viewer/options.ts`, add the type after `ImageProjection` (line 34):

```ts
/**
 * Which rendering backend a viewer should be created with.
 *
 * `'auto'` -- and omitting the field -- keeps the selection the library has
 * always made: WebGPU first, WebGL2 when no adapter appeared. `'webgpu'` and
 * `'webgl2'` are strict requests: if that backend is unavailable, `create`
 * rejects naming it rather than silently downgrading. The readback of what
 * was actually selected is `viewer.capabilities.backend`, whose values are
 * `'webgpu' | 'webgl2'` and deliberately NOT this union -- a preference is a
 * request, a capability is a fact, and one type holding both would let
 * `'auto'` appear as an answer to "what am I running on".
 */
export type BackendPreference = 'auto' | 'webgpu' | 'webgl2'
```

Add the field to `ImageViewerOptions` (after `PTZ`, line 42) — `VideoViewerOptions` extends the interface and inherits it:

```ts
  /** Strict create-time backend request. Omitted means 'auto'; never mutable after create. */
  readonly backend?: BackendPreference
```

Add the assert after `assertProjection` (mirrors its shape and its reasoning):

```ts
/**
 * Asserts a backend preference and narrows it for the caller.
 *
 * Same class of check as `assertProjection`: the type system stops a
 * TypeScript caller, and what survives is the right-type-wrong-member value
 * arriving through a cast or from JavaScript. `undefined` passes -- it means
 * 'auto', which is the selection the library has always made.
 */
function assertBackend (value: unknown): asserts value is BackendPreference | undefined {
  if (value === undefined) return
  if (value !== 'auto' && value !== 'webgpu' && value !== 'webgl2') {
    throw new TypeError(
      `backend must be one of 'auto', 'webgpu', 'webgl2' (got ${String(value)})`
    )
  }
}
```

Call it from `validateImageOptions` (after `assertProjection(options.projection)`, line 129):

```ts
  assertBackend(options.backend)
```

In `src/index.ts` line 11, widen the export:

```ts
export type { ImageViewerOptions, VideoViewerOptions, ImageProjection, BackendPreference } from './viewer/options'
```

- [x] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run --project unit test/unit/constructor-validation.test.ts`
Expected: all PASS.
Run: `npm run typecheck`
Expected: clean.

- [x] **Step 5: Commit**

```bash
git add src/viewer/options.ts src/index.ts test/unit/constructor-validation.test.ts
git commit -m "task-backend-preference: add the backend option and its validation"
```

---

### Task 2: `createBackend` takes the preference

**Files:**
- Modify: `src/viewer/backend-factory.ts:65-87`
- Test: `test/unit/backend-factory.test.ts` (new)

This is testable in the node project: `acquireDevice()` returns null when `navigator.gpu` is absent (`src/renderer/webgpu/device.ts:74`), and a stub canvas whose `getContext` yields null makes `WebGL2Backend.create` return null (`src/renderer/webgl2/backend.ts:170-171`) — so every branch here ends in a throw whose message is the thing under test. The success branches need a real GPU and live in Tasks 4 and 5.

- [x] **Step 1: Write the failing tests**

Create `test/unit/backend-factory.test.ts`:

```ts
/**
 * `createBackend`'s preference branching, in the node project.
 *
 * The node environment is the honest one for the rejection paths:
 * `navigator` genuinely has no `gpu` member, and the canvas is a stub whose
 * `getContext` yields nothing, so each call ends in a throw whose message is
 * the assertion. The success halves -- a forced backend that answers -- need
 * a real GPU and live in the browser projects
 * (test/integration/backend-preference.test.ts and its fallback twin).
 */
import { describe, expect, it } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement

describe('createBackend with a preference', () => {
  it('the default keeps the legacy message when neither backend exists', async () => {
    await expect(createBackend(noCanvas)).rejects.toThrow(/no usable rendering backend/i)
  })

  it("explicit 'auto' follows the same path as the default", async () => {
    // 'auto' and the omitted argument must be one path, not two that could
    // drift: the compatibility promise is that callers who pass nothing see
    // byte-identical behaviour.
    await expect(createBackend(noCanvas, 'auto')).rejects.toThrow(/no usable rendering backend/i)
  })

  it("a forced 'webgpu' rejects, naming the requested backend", async () => {
    await expect(createBackend(noCanvas, 'webgpu'))
      .rejects.toThrow(/backend 'webgpu' was requested/i)
  })

  it("a forced 'webgl2' rejects, naming the requested backend", async () => {
    await expect(createBackend(noCanvas, 'webgl2'))
      .rejects.toThrow(/backend 'webgl2' was requested/i)
  })
})
```

- [x] **Step 2: Run them and verify they fail**

Run: `npx vitest run --project unit test/unit/backend-factory.test.ts`
Expected: the two forced-preference tests FAIL — the current one-parameter signature ignores the second argument, so no `'webgpu' was requested` message exists. The two auto tests PASS against the current code (that is the compatibility pin, not a vacuous pass).

- [x] **Step 3: Implement the branch**

Replace `createBackend` in `src/viewer/backend-factory.ts` (lines 65-87) with:

```ts
/**
 * Creates a backend for the given canvas.
 *
 * A forced preference is strict: exactly the named backend is tried, and a
 * null result rejects naming it. Falling back anyway would be the silent
 * downgrade this option exists to make impossible -- a caller who wants the
 * fallback passes 'auto' or nothing.
 *
 * @throws If the requested backend is unavailable, or (on 'auto') if neither
 *   backend is. Constructing a viewer that can never draw is what the legacy
 *   `createProgram` did -- it logged and returned null, and the viewer
 *   reported success. A viewer that cannot render is not a viewer.
 */
export async function createBackend (
  canvas: HTMLCanvasElement,
  preference: BackendPreference = 'auto'
): Promise<Backend> {
  if (preference !== 'auto') {
    const forced = preference === 'webgpu'
      ? await WebGPUBackend.create(canvas)
      : WebGL2Backend.create(canvas)
    if (forced) return forced
    throw new Error(`backend '${preference}' was requested but is unavailable in this browser`)
  }

  const webgpu = await WebGPUBackend.create(canvas)
  if (webgpu) return webgpu

  // WebGPU first, always: it is the primary path and the one every feature is
  // developed against. WebGL2 is reached only when `acquireDevice()` came back
  // empty -- which is the case for a browser without `navigator.gpu` and for
  // one whose adapter request returned null (spec §6.5, §9.5).
  const webgl2 = WebGL2Backend.create(canvas)
  if (webgl2) return webgl2

  throw new Error(
    'no usable rendering backend: neither WebGPU nor WebGL2 is available in this browser'
  )
}
```

Add the import next to the existing ones at the top of the file:

```ts
import type { BackendPreference } from './options'
```

- [x] **Step 4: Run the tests**

Run: `npx vitest run --project unit test/unit/backend-factory.test.ts`
Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add src/viewer/backend-factory.ts test/unit/backend-factory.test.ts
git commit -m "task-backend-preference: createBackend honours a forced preference"
```

---

### Task 3: Thread the option through both viewers

**Files:**
- Modify: `src/viewer/image-viewer.ts:90`
- Modify: `src/viewer/video-viewer.ts:77`

No new unit tests: the threading adds no branch (an `undefined`-able argument into a defaulted parameter), and the behaviour it produces is Tasks 4 and 5's subject. The existing suites are the regression net for the default path.

- [x] **Step 1: Pass the validated option at both call sites**

`src/viewer/image-viewer.ts` line 90:

```ts
      backend = await createBackend(canvas, valid.backend)
```

`src/viewer/video-viewer.ts` line 77:

```ts
      backend = await createBackend(canvas, valid.backend)
```

`valid.backend` is `BackendPreference | undefined`; the default parameter turns `undefined` into `'auto'`, so both callers keep one path.

- [x] **Step 2: Run the unit suite and the typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: all PASS / clean.

- [x] **Step 3: Commit**

```bash
git add src/viewer/image-viewer.ts src/viewer/video-viewer.ts
git commit -m "task-backend-preference: thread the backend option into both creates"
```

---

### Task 4: Real-GPU integration user story

**Files:**
- Modify: `test/integration/support/viewer.ts`
- Test: `test/integration/backend-preference.test.ts` (new)

- [x] **Step 1: Extend the factories**

In `test/integration/support/viewer.ts`, add the type import (the factory stays on the public surface — `src/index.ts` — per this support file's own rule):

```ts
import type { BackendPreference } from '../../../src/index'
```

Add `backend?: BackendPreference` to both factory option objects, and one spread to each `create` call (the exactOptionalPropertyTypes pattern this file already uses for `camera`/`autoplay`):

`imageViewer` — options type gains `readonly backend?: BackendPreference`, and the create call gains, after the `camera` spread:

```ts
    ...(options.backend === undefined ? {} : { backend: options.backend })
```

`videoViewer` — identical addition, after its `camera` spread.

- [x] **Step 2: Write the user story**

Create `test/integration/backend-preference.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canvasOf } from './support/dom'
import { countNonBlack, maxChannelDiff, nextFrames, readCanvas } from './support/canvas'
import { imageViewer } from './support/viewer'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'

/**
 * How far the forced and default viewer paths may disagree, per channel.
 *
 * Gate C bounds the two hand-transcribed shaders at 2/255 on identical
 * offscreen requests (gate-c-cross-backend.test.ts). The viewer paths add
 * canvas presentation on top of the shaders, and the 64x32 bilinear
 * downscale in readCanvas is a convex combination -- it cannot amplify a
 * per-channel difference. 4 = 2 (shaders) + 2 (presentation), and a read
 * above it means the forced path changed projection semantics, not backend.
 * If this ever fails with everything else green, report it -- do not loosen
 * the bound silently.
 */
const MAX_CROSS_BACKEND_DIFF = 4

/*
 * The backend preference, through the public surface. The no-webgpu twin
 * (test/integration/fallback/backend-preference.test.ts) holds the rejection
 * half; this file runs where an adapter is guaranteed, so it holds the
 * success half and the cross-backend equivalence.
 */
describe('create with a backend preference', () => {
  it("forcing 'webgl2' renders the same picture the default path renders", async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const forced = await imageViewer({ backend: 'webgl2' })
    const auto = await imageViewer()
    await nextFrames(2)

    // Read everything back before dispose: dispose destroys the device, and
    // capabilities/pixels read after it answer questions about a dead viewer.
    const forcedImage = await readCanvas(canvasOf(forced.container))
    const autoImage = await readCanvas(canvasOf(auto.container))
    const forcedBackend = forced.viewer.capabilities.backend
    const autoBackend = auto.viewer.capabilities.backend
    forced.viewer.dispose()
    auto.viewer.dispose()

    // The two selections differ -- the force took effect, and the default
    // still follows the WebGPU-first path this project guarantees an adapter
    // for (its setup file asserts one).
    expect(forcedBackend).toBe('webgl2')
    expect(autoBackend).toBe('webgpu')
    // Content net: a blank pair of readbacks satisfies the diff bound
    // vacuously, so both halves must first prove they drew something.
    expect(countNonBlack(forcedImage)).toBeGreaterThan(0)
    expect(countNonBlack(autoImage)).toBeGreaterThan(0)
    expect(maxChannelDiff(forcedImage.data, autoImage.data)).toBeLessThanOrEqual(MAX_CROSS_BACKEND_DIFF)
  })

  it("forcing 'webgpu' pins the primary path explicitly", async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // 'webgpu' on this machine agrees with 'auto' -- that is the point: the
    // pin is a guarantee about selection, not a change in rendering. The
    // environment where it would reject is the no-webgpu project's twin file.
    const { viewer, container } = await imageViewer({ backend: 'webgpu' })
    await nextFrames(2)
    const image = await readCanvas(canvasOf(container))
    const backend = viewer.capabilities.backend
    viewer.dispose()

    expect(backend).toBe('webgpu')
    expect(countNonBlack(image)).toBeGreaterThan(0)
  })
})
```

- [x] **Step 3: Run it in the integration project**

Run: `npx vitest run --project integration test/integration/backend-preference.test.ts`
Expected: both PASS. If the cross-backend diff bound fails, follow the constant's comment: report with the measured worst diff, do not loosen it here.

- [x] **Step 4: Commit**

```bash
git add test/integration/support/viewer.ts test/integration/backend-preference.test.ts
git commit -m "task-backend-preference: real-GPU user story for the forced backends"
```

---

### Task 5: No-WebGPU rejection twin

**Files:**
- Test: `test/integration/fallback/backend-preference.test.ts` (new)

This file is collected only by the `no-webgpu` project (per `vitest.config.ts` includes), whose setup asserts the adapter is null and WebGL2 answers — exactly the environment where forcing `'webgpu'` must reject.

- [x] **Step 1: Write the tests**

Create `test/integration/fallback/backend-preference.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FramelessImageViewer } from '../../../src/index'
import { makeContainer } from '../support/dom'

/*
 * The forced-preference rejections, in the project that exists to hold
 * them: --disable-gpu took the WebGPU adapter away (this project's setup
 * asserts it), so 'webgpu' is a request this environment genuinely cannot
 * honour while WebGL2 still answers. The real-GPU twin
 * (test/integration/backend-preference.test.ts) holds the success half.
 */
describe('forced backend preference without WebGPU', () => {
  it("forcing 'webgpu' rejects, naming the requested backend", async () => {
    // The message is the contract: a caller deciding what to do about a
    // machine without the requested backend has to be told WHICH backend
    // failed, or 'auto' and 'webgpu' failures are indistinguishable.
    await expect(FramelessImageViewer.create({
      container: makeContainer(),
      src: '/fixtures/panorama.png',
      backend: 'webgpu'
    })).rejects.toThrow(/backend 'webgpu' was requested/i)
  })

  it('the default still falls back to WebGL2 rather than rejecting', async () => {
    // The control for the test above: strictness belongs to the explicit
    // request. A caller who passed nothing keeps the fallback the library
    // has always performed -- the compatibility red line of spec §2.
    const viewer = await FramelessImageViewer.create({
      container: makeContainer(),
      src: '/fixtures/panorama.png'
    })
    const backend = viewer.capabilities.backend
    viewer.dispose()
    expect(backend).toBe('webgl2')
  })
})
```

- [x] **Step 2: Run it in the no-webgpu project**

Run: `npx vitest run --project no-webgpu test/integration/fallback/backend-preference.test.ts`
Expected: both PASS.

- [x] **Step 3: Commit**

```bash
git add test/integration/fallback/backend-preference.test.ts
git commit -m "task-backend-preference: no-webgpu rejection twin for the forced backends"
```

---

### Task 6: The lab switch

**Files:**
- Modify: `demo/lab/context.ts`
- Modify: `demo/lab/main.ts`
- Modify: `demo/lab/panels/status.ts`

- [x] **Step 1: Widen `LabContext`**

In `demo/lab/context.ts`, extend the type import (line 9) with `BackendPreference`:

```ts
import type { FramelessImageViewer, FramelessVideoViewer, BackendPreference, Projection, ProjectionKind } from '../../src/index'
```

Add to `LabContext` after `setSource`:

```ts
  /** Applies a backend preference (recreates the viewer, pose carried) and syncs the URL. */
  readonly setBackend: (backend: BackendPreference) => void
```

- [x] **Step 2: Rework `main.ts`**

Five edits to `demo/lab/main.ts`. First, the module doc comment (lines 1-11) — add the fourth swap path after the image↔video line:

```ts
 *  - backend preference -> dispose + recreate with the `backend` option (pose carried)
```

Second, the type import (line 13):

```ts
import type { BackendPreference, CameraState, Projection, SelectedCapabilities } from '../../src/index'
```

Third, `readUrlState` (line 44) — read the backend param and carry it through both returns:

```ts
/** Bookmark in: invalid values silently fall back (a bookmark is a convenience, not an interface). */
function readUrlState (): { projection: Projection, source: SourceId, backend: BackendPreference } {
  const params = new URLSearchParams(window.location.search)
  const kindParam = params.get('projection')
  const sourceParam = params.get('source')
  const source = SOURCE_IDS.find(s => s === sourceParam) ?? '2k'
  // The preference, never the capability: a bookmark taken on a WebGPU
  // machine must not pin a WebGL2-only machine to 'webgpu' (spec §3).
  const backend: BackendPreference =
    (['auto', 'webgpu', 'webgl2'] as const).find(b => b === params.get('backend')) ?? 'auto'
  const fallback = defaultProjection(
    (['linear', 'cylindrical', 'planet', 'pannini'] as const).find(k => k === kindParam) ?? 'linear')
  if (fallback.kind === 'linear') {
    const fovDeg = parseNumber(params.get('fov'), 15, 110, (fallback.fov * 180) / Math.PI)
    return {
      projection: { kind: 'linear', fov: (fovDeg * Math.PI) / 180, aspect: fallback.aspect },
      source,
      backend
    }
  }
  const extent = parseNumber(params.get('extent'), 0.5, 8, fallback.extent[0])
  return {
    projection: {
      kind: fallback.kind,
      zoom: parseNumber(params.get('zoom'), 0.01, 1, fallback.zoom),
      extent: [extent, extent]
    },
    source,
    backend
  }
}
```

Fourth, `writeUrlState` (line 67) — take the preference, write it:

```ts
/** Bookmark out: the URL always mirrors what is on screen. */
function writeUrlState (current: LabViewer, backend: BackendPreference): void {
  const projection = current.viewer.cameraOptions.projection
  // 'backend' mirrors the shell's PREFERENCE, not viewer.capabilities.backend
  // -- the same reasoning as readUrlState's parse above.
  const params = new URLSearchParams({ projection: projection.kind, source: current.source, backend })
  if (projection.kind === 'linear') {
    params.set('fov', String(Math.round((projection.fov * 180) / Math.PI)))
  } else {
    params.set('zoom', projection.zoom.toFixed(2))
    params.set('extent', projection.extent[0].toFixed(2))
  }
  try {
    window.history.replaceState(null, '', `?${params.toString()}`)
  } catch {
    // Safari throws past its replaceState rate cap. The URL is a convenience
    // mirror, so a dropped write beats throwing out of an event listener,
    // which would starve every listener registered after this one.
  }
}
```

Fifth, `boot()` — hoist the URL read and the box above the status mount, hold the preference in one place, add `setBackend`, and thread the preference into every create/write. Replace the body from `const stage` (line 96) to the end of `boot` (line 198) with:

```ts
  const stage = required<HTMLElement>('#stage')
  const banner = required<HTMLElement>('#page-banner')
  const selected: SelectedCapabilities = await FramelessImageViewer.probe()
  // Hoisted above the panel mounts so the status switch knows the initial
  // preference: pure URL reading, nothing here needs a viewer.
  const state = readUrlState()
  let backendPref: BackendPreference = state.backend
  const viewers = new ViewerBox()

  // The control shows the preference; the badge above it shows the fact.
  // Switching backends is the cross-class swap's machine again -- the
  // backend binds to the canvas and the device at create time, so there is
  // nothing to mutate -- with one addition the other swaps do not have: the
  // URL must follow only on success, because the lab's banners are terminal
  // and Reload is their only recovery. writeUrlState runs inside
  // installViewer, i.e. after a successful create, so a failed force leaves
  // the bookmark on the last working state and Reload is a way out, not a
  // loop (spec §3). installViewer is referenced before its definition; a
  // click cannot fire between this definition and that one, because there
  // is no await between them.
  const setBackend = (backend: BackendPreference): void => {
    if (backend === backendPref) return
    backendPref = backend
    const current = viewers.current
    if (current === null) return
    const carried = current.viewer.cameraOptions
    // The box holds null across the async recreate, so re-entrant clicks no-op.
    viewers.publish(null)
    current.viewer.dispose()
    installViewer(current.source, carried.projection, carried.pose)
      .catch((error) => showBanner(banner, 'Backend switch failed', String(error)))
  }

  mountStatusPanel(required('#status-panel'), selected, backendPref, setBackend)

  if (selected.backend === 'none') {
    showBanner(banner, 'No rendering backend',
      'Neither WebGPU nor WebGL2 is available in this browser, so there is nothing to render with. Try a browser with WebGPU (or at least WebGL2) enabled.')
    return
  }

  let urlWriteTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Collapses high-frequency changes (wheel zoom, slider drags) into one
   * trailing bookmark write. Browsers cap replaceState at roughly 100 calls
   * per 30 seconds, and WebKit throws past its cap; one write per event
   * both stalls at the cap and, there, throws out of the listener. The
   * handle is re-read at flush time rather than captured, so a same-class
   * source swap cannot leak a stale source id into the URL.
   */
  const scheduleUrlWrite = (): void => {
    if (urlWriteTimer !== null) clearTimeout(urlWriteTimer)
    urlWriteTimer = setTimeout(() => {
      urlWriteTimer = null
      const current = viewers.current
      if (current !== null) writeUrlState(current, backendPref)
    }, 250)
  }

  const installViewer = async (
    source: SourceId,
    projection: Projection,
    pose?: Partial<CameraState>
  ): Promise<void> => {
    const camera = pose === undefined ? { projection } : { projection, pose }
    // 'auto' is a member of the union, so the preference passes through
    // unconditionally -- no spread dance for the default case.
    const viewer = source === 'video'
      ? await FramelessVideoViewer.create({ container: stage, src: SOURCE_URLS[source], camera, backend: backendPref })
      : await FramelessImageViewer.create({ container: stage, src: SOURCE_URLS[source], camera, backend: backendPref })
    viewer.on('device-lost', (lost) => {
      // v1 has no automatic recovery; the lab says so instead of pretending.
      // Dropping the handle also detaches the panels: the banner stops
      // pointers, but keyboard focus can still reach their controls, and a
      // panel edit would otherwise call into a dead viewer.
      viewers.publish(null)
      required('#status-panel').classList.add('lost')
      showBanner(banner, 'Device lost', `${lost.reason}: ${lost.message}. v1 has no automatic recovery -- reload to retry.`)
    })
    // Wheel zoom mutates the projection inside the library without passing
    // through the shell, so the bookmark needs its own hook here. The write
    // is debounced above and reads the handle at flush time.
    viewer.on('zoom', scheduleUrlWrite)
    const handle: LabViewer = { viewer, mode: source === 'video' ? 'video' : 'image', source }
    viewers.publish(handle)
    writeUrlState(handle, backendPref)
  }

  const applySource = async (target: SourceId): Promise<void> => {
    const current = viewers.current
    if (current === null || current.source === target) return
    if ((target === 'video') === (current.mode === 'video')) {
      // Same class: a source swap is not a reconfiguration -- pose and
      // projection survive the `src` setter, which is the point of this path.
      current.viewer.src = SOURCE_URLS[target]
      const handle = { viewer: current.viewer, mode: current.mode, source: target }
      viewers.publish(handle)
      writeUrlState(handle, backendPref)
      return
    }
    // Cross class: the one migration v1 leaves to the application. Carry the
    // pose over by hand, then rebuild the other viewer from scratch.
    const carried = current.viewer.cameraOptions
    // The box holds null across the async recreate, so re-entrant clicks no-op and panels drop their dead viewer instead of calling into it.
    viewers.publish(null)
    current.viewer.dispose()
    await installViewer(target, carried.projection, carried.pose)
  }

  const ctx: LabContext = {
    setProjection: (projection) => {
      const current = viewers.current
      if (current === null) return
      current.viewer.cameraOptions = { projection }
      scheduleUrlWrite()
    },
    setSource: (source) => {
      applySource(source).catch((error) => showBanner(banner, 'Source switch failed', String(error)))
    },
    setBackend,
    onViewer: (listener) => viewers.subscribe(listener)
  }

  // Panel mounts happen here, BEFORE installViewer publishes
  // the first viewer, so panels observe the full lifecycle from the null
  // state; a later mount would still receive the current viewer, because
  // subscribe fires the listener immediately.
  mountCameraPanel(required('#camera-panel'), ctx, stage)
  mountMediaPanel(required('#media-panel'), ctx)
  mountEventLogPanel(required('#eventlog-panel'), ctx)

  await installViewer(state.source, state.projection)
```

And the module-level catch at the bottom (line 200) gains the param strip:

```ts
await boot().catch((error) => {
  // A boot that died with a backend param in the URL would come back to the
  // same death on Reload -- and Reload is the banner's only recovery. Drop
  // the param so a reload retries in 'auto'; on a machine where the forced
  // backend does work, auto selects the same one anyway, so the strip costs
  // nothing (spec §3/§4).
  const params = new URLSearchParams(window.location.search)
  if (params.get('backend') !== null) {
    params.delete('backend')
    window.history.replaceState(null, '', `?${params.toString()}`)
  }
  const banner = document.querySelector<HTMLElement>('#page-banner')
  if (banner !== null) {
    showBanner(banner, 'Viewer creation failed', String(error))
  } else {
    // A page without the banner element still owes the console the failure
    // instead of a silently blank stage.
    console.error(error)
  }
})
```

- [x] **Step 3: Add the control to the status panel**

Replace `demo/lab/panels/status.ts` in full:

```ts
/**
 * Backend/capability status bar: everything the device said about itself,
 * plus the switch that asks for a backend by name.
 *
 * The badge and the rows are FACTS -- what the device handed out. The
 * segmented control is the shell's PREFERENCE, what the next `create` will
 * request, and on a WebGPU machine with 'auto' selected the two deliberately
 * disagree (control: auto, badge: WebGPU). A backend this browser cannot
 * honour is left clickable on purpose: the full-page banner it raises is the
 * strict `backend` semantics being demonstrated, not a state to grey out
 * (spec 2026-09-28-backend-preference §3).
 */
import { VERSION } from '../../../src/index'
import type { BackendPreference, Capabilities, SelectedCapabilities } from '../../../src/index'
import { h } from '../dom'

function row (label: string, value: string): HTMLElement {
  return h('div', { class: 'row' },
    h('span', { class: 'row-label', text: label }),
    h('span', { class: 'row-value', text: value }))
}

const BACKENDS: ReadonlyArray<{ readonly value: BackendPreference, readonly label: string }> = [
  { value: 'auto', label: 'auto' },
  { value: 'webgpu', label: 'WebGPU' },
  { value: 'webgl2', label: 'WebGL2' }
]

export function mountStatusPanel (
  host: HTMLElement,
  selected: SelectedCapabilities,
  backend: BackendPreference,
  setBackend: (backend: BackendPreference) => void
): void {
  if (selected.backend === 'none') {
    host.append(h('span', { class: 'badge badge-none', text: 'no backend' }))
    return
  }
  const caps: Capabilities = selected
  const textureHint = caps.maxTextureDimension >= 8192
    ? ' (8K passes through)'
    : ' (8K sources downscale)'

  // Local active-state only: the preference changes nowhere but here (the
  // shell's setBackend no-ops a repeat), so there is nothing to subscribe to.
  const control = h('div', { class: 'segmented' })
  const buttons = new Map<BackendPreference, HTMLButtonElement>()
  for (const { value, label } of BACKENDS) {
    const button = h('button', { type: 'button', text: label })
    if (value === backend) button.classList.add('active')
    button.addEventListener('click', () => {
      for (const [candidate, b] of buttons) b.classList.toggle('active', candidate === value)
      setBackend(value)
    })
    buttons.set(value, button)
    control.append(button)
  }

  host.append(
    h('div', { class: 'status-head' },
      h('span', { class: `badge badge-${caps.backend}`, text: caps.backend === 'webgpu' ? 'WebGPU' : 'WebGL2' }),
      h('span', { class: 'row-value', text: `v${VERSION}` })),
    control,
    row('devicePixelRatio', String(window.devicePixelRatio)),
    row('maxTextureDimension', `${caps.maxTextureDimension}${textureHint}`),
    row('externalTextures', caps.externalTextures ? 'yes' : 'no'))
  for (const [key, value] of Object.entries(caps.adapter ?? {})) {
    host.append(row(key, value))
  }
  if (caps.backend === 'webgl2') {
    host.append(h('p', {
      class: 'hint',
      text: 'Why WebGL2? Enable the gpu channel under Diagnostics and read the browser console.'
    }))
  }
}
```

- [x] **Step 4: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [x] **Step 5: Browser QA (目检)**

Run `npm run start`, open the lab URL, and check:
1. The control renders under the badge; on a WebGPU machine `auto` is active while the badge reads WebGPU.
2. Drag the picture, then click `WebGL2`: the badge flips to WebGL2, the "Why WebGL2?" hint appears, the view keeps its pose, and the URL gains `backend=webgl2`.
3. Click `WebGPU`: badge flips back, pose kept, URL updated.
4. Reload with `?backend=vulkan` in the URL: boots silently as auto.
5. The forced-unavailable banner itself is covered by the no-webgpu test project, not by this machine — note that in the completion report rather than trying to force it here.

- [x] **Step 6: Commit**

```bash
git add demo/lab/context.ts demo/lab/main.ts demo/lab/panels/status.ts
git commit -m "task-backend-preference: lab status-panel switch with bookmark and recreate"
```

---

### Task 7: README and the full gate

**Files:**
- Modify: `README.md:181-187`

- [ ] **Step 1: One sentence in the demo paragraph**

In `README.md`, in the paragraph starting `` `npm run start` serves `demo/` `` (line 181), extend the enumeration. Replace:

```markdown
landing page is an interactive lab — projection switching with live readouts,
2K/4K/8K/video sources, backend capabilities, an event stream and the
diagnostics channels — and `minimal.html` is the example above as a runnable
page.
```

with:

```markdown
landing page is an interactive lab — projection switching with live readouts,
2K/4K/8K/video sources, backend capabilities, an event stream and the
diagnostics channels, plus an auto/WebGPU/WebGL2 switch that exercises the
`backend` create option — and `minimal.html` is the example above as a
runnable page.
```

- [ ] **Step 2: The full verify**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green — three tsc programs, eslint, then unit + both browser projects (301+ tests; the two new files add 4 integration cases and 7 unit cases).

Run: `npm run test:coverage`
Expected: green at the 90% branch threshold (the new `src/` branches are the assert's four and the factory's three, all covered by Task 1/2 tests).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "task-backend-preference: mention the lab backend switch in the README"
```

---

## Spec coverage check (done at plan time)

| Spec section | Where |
|---|---|
| §1 type + field + assert + index export | Task 1 |
| §1 `createBackend(canvas, preference)` threading | Tasks 2-3 |
| §2 matrix — auto column unchanged | Task 2 auto tests, Task 3 regression run, Task 5 fallback test |
| §2 matrix — forced rejection with named backend | Task 2 unit, Task 5 integration |
| §2 forced webgl2 renders same picture | Task 4 |
| §3 control/badge split, recreate with pose, URL bookmark, write-on-success, boot strip | Task 6 |
| §4 error paths 1-4 | Tasks 1, 2, 5, 6 |
| §5 unit / real-GPU / no-webgpu / 目检 | Tasks 1-2, 4, 5, 6 Step 5 |
| §6 file list | matches the File Structure table (lab.css deliberately absent — `.segmented` already exists) |
| §7 acceptance 1-6 | Tasks 3/5 (1), 2/5 (2), 4 (3), 1 (4), 6 (5), 7 (6) |
