# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **The v1 migration is staged and not finished.** This file describes the **target** — the pano.gl that P0–P7 in `docs/superpowers/plans/` build. A path or command named here may not exist yet; the phase that creates it is the plan of the same name, and the plans are authoritative about order. While a phase is in flight, prefer its plan over this file. P7 Task 4 deletes this note once every claim below has been checked against the finished code.

## What this is

`pano.gl` is a dependency-light viewer for equirectangular (360°) images and video. Two public entry points — `FramelessImageViewer` and `FramelessVideoViewer`, both re-exported from `src/index.ts` — render a full-screen panorama into a container element, with four camera models (`linear`, `cylindrical`, `planet`, `pannini`) and built-in pan-tilt-zoom.

TypeScript 5, strict. Two rendering backends behind one interface: WebGPU (primary) and WebGL2 (fallback, for browsers that have no WebGPU).

**The most important thing to understand before touching anything camera- or shader-related:** there is no geometry and no vertex-stage projection. Each backend draws a single fullscreen triangle and recovers the surface point per fragment by inverting the camera matrix. The GPU never interpolates a position.

## Commands

```shell
npm install
npm run start              # demo dev server (vite)
npm run build              # tsup -> dist/ (ESM + CJS), unminified
npm test                   # unit, then integration
npm run test:unit          # vitest run
npm run test:integration   # playwright test
npm run test:coverage      # vitest run --coverage (90% branch threshold, enforced)
npm run typecheck          # tsc --noEmit, then the integration program (test/integration/tsconfig.json)
npm run lint               # eslint
npm run gen:shaders        # regenerate src/renderer/shaders/generated.ts
npm run doc                # API docs (typedoc)
```

Run a single unit test: `npx vitest run test/unit/clamp.test.ts`. Run a single integration test: `npx playwright test gate-c-cross-backend`.

Integration tests need a real GPU to be meaningful. `playwright.config.ts` sets `channel: 'chromium'` and the `gpuPage` fixture asserts a non-null adapter precisely so that a machine without WebGPU fails loudly instead of silently re-testing nothing. Chromium launch flags can only come from `use.launchOptions.args` — Playwright reads no environment variable for them.

## Layout and layering

Layers, lowest first. A layer may import from the layers below it and no others:

1. `src/core/` — pure. No DOM, no GPU, no timers.
2. `src/renderer/`, `src/media/` — each may import `core/` only; they do not import each other.

   That second rule is why `RenderableSource` and `DeviceLost` are declared in `src/renderer/backend.ts` and not in the media layer. A backend has to be handed something it can upload from, and "a description of the pixels plus the element they live in" is media's concept — but the dependency runs renderer ← media, never renderer → media, so the renderer owns the declaration and `MediaFrame` is an alias of it. If you find yourself wanting to import a media type into `renderer/`, this is the thing you are about to break.

3. `src/interaction/`
4. `src/viewer/` — assembles the rest. `src/index.ts` is the frozen public surface.

Key files:

- `src/core/types.ts` — `CameraState`, `Projection`, `SourceState`
- `src/core/matrix.ts` — `buildViewMatrix` / `buildProjection` / `buildCameraTransform` / `DepthRange`
- `src/core/reference.ts` — the four projections in CPU float64
- `src/core/projection-kinds.json` — the source of truth for the projection type constants
- `src/renderer/backend.ts` — the `Backend` interface, `Capabilities`, `RenderableSource`, `DeviceLost`
- `src/renderer/capabilities.ts` — `describeCapabilities`, the one place capability rules live
- `src/renderer/webgpu/`, `src/renderer/webgl2/` — the two implementations
- `src/renderer/shaders/generated.ts` — generated; never edit
- `src/viewer/backend-factory.ts` — WebGPU → WebGL2 selection
- `scripts/gen-shader-constants.mjs` — the generator

## Architecture

### One triangle, and the fragment stage does the projection

Both backends draw three vertices covering the viewport, with no vertex buffer and no attributes; the vertex stage derives its position from `gl_VertexID` / `vertex_index`. The fragment stage takes the interpolated ndc position, multiplies it by `u_invClip` (`invClip * vec4(ndc, 1.0, 1.0)`), and divides by w to recover the point on the surface the old rasteriser would have interpolated. It then converts that point to equirectangular UVs.

This is why there is no geometry subsystem: the four camera models differ only in a per-fragment formula, and the surface size each one is evaluated on (`extent`, 1×1 for cylindrical and 4×4 for planet/pannini) is a property of the `Projection`, not of any mesh.

### Depth range is the backends' only matrix difference

WebGL2's ndc z is `[-1, 1]`; WebGPU's is `[0, 1]`. The CPU side passes `'minus-one-to-one'` or `'zero-to-one'` to `buildCameraTransform` accordingly. `DepthRange` is a string-literal union — use it, and do not invent spellings.

The shaders need to know nothing about this: both conventions put the far plane at ndc z = +1, so the `1.0` in the reconstruction's z slot is correct under either, and the same fragment source works for both backends.

### The CPU reference is the arbiter

`src/core/reference.ts` implements the same four projections in float64 and is the executable specification for them. When the two backends disagree, or a backend disagrees with the captured baseline, running all three and finding the odd one out is what turns "they differ" into "this one is wrong". It is deliberately independent: it inverts ndc to a surface point itself rather than reusing the camera matrix, because an arbiter that shares the shaders' precision and their matrix would agree with a wrong matrix by construction.

It also reproduces v0.2.2 behaviour **including that version's bugs**, because the acceptance criterion is "renders what v0.2.2 rendered". The one to know about is `lngOffset`, which subtracts `povLongitude / 4` — degrees subtracted from a radian angle. That is not a degree conversion, and "fixing" it changes panning sensitivity, which is a separate user-visible decision rather than a port.

### Projection constants have exactly one source of truth

`src/core/projection-kinds.json` → `scripts/gen-shader-constants.mjs` → `src/renderer/shaders/generated.ts`, which exports `WGSL_CONSTANTS` and `GLSL_CONSTANTS`. The TypeScript constants (`cameraProjectionCode`, `textureProjectionCode` in `src/core/constants.ts`) and both shaders' constant blocks are all derived from that one file.

Never write a numeric literal for a projection kind, in TypeScript or in a shader. The numbers used to be maintained by hand in several places at once and agreed only by luck. Change the JSON and run `npm run gen:shaders`.

### The two shaders are hand-transcribed, and gate C holds them together

`src/renderer/webgpu/shaders/panorama.wgsl` and `src/renderer/webgl2/shaders/panorama.glsl` contain the same four projection formulas, written twice. Nothing in the type system or the build connects them — the constants they share come from the generator, but the formulas do not.

`test/integration/gate-c-cross-backend.test.ts` is what keeps them from drifting: it renders every camera state through both shaders and compares the pixels, with the CPU reference as the tiebreaker. **Changing a projection formula means changing both files.** A change made in one of them is the failure this gate exists to catch.

### Camera state is pose only

`CameraState` is `{ povLatitude, povLongitude }`, in degrees. Field of view, zoom and extent belong to the `Projection`, which is a discriminated union over the four kinds. Putting `zoom` on the camera state is a type error, and that is intentional.

Camera state is memoised per render behind a dirty flag: a setter that changes what the GPU sees must mark it dirty, or the change never reaches a frame.

## Testing

- **Unit** — `test/unit/{sourceFileName}.test.ts`, vitest, node environment. 90% branch coverage is a build failure, not a target. Cover the normal path, the invalid-input path and the boundary. Unit tests must not reach a GPU context.
- **Integration** — `test/integration/{userStoryName}.test.ts`, Playwright, one file per user story, driving the real library in a real page. The page-side surface they use is `window.__panoTest`, typed as `PanoTestApi`; hooks live in `demo/test-entry-hooks/*.ts` and are merged automatically, so a phase that adds a hook adds a file rather than editing a shared one. Never re-declare that shape at a call site with a cast — the whole point of the shared declaration is that "what the page provides" and "what the test takes" are constrained by one type.
  - `PanoTestApi` is declared as a **global** interface (`declare global`), and a hook file widens it with a `declare global` block of its own. Global interfaces merge by name across files with no import and no registration step, which is exactly why the shape was chosen: a hook file cannot forget to wire itself in. An *exported* interface would instead force every hook to write `declare module '../test-entry'` — a relative specifier that has to resolve correctly from a file in a subdirectory, and which augments nothing at all, silently, when it does not.
  - The hook files are loaded by `import.meta.glob('./test-entry-hooks/*.ts', { eager: true })` in `demo/test-entry.ts`. `import.meta.glob` is invisible to the type system and the hook modules are not in the integration program's `include`, so a test file that uses a hook imports its module type-only (`import type {} from '../../demo/test-entry-hooks/webgl2'`) purely to pull the augmentation into the program.
  - `Window.__panoTest` is declared once, in `demo/test-entry.ts` — that is the half a type-only hook import cannot supply, and it is why the two `tsconfig` programs are split. The root `tsconfig.json` covers `src`, `test/unit` and `scripts` and **excludes** `test/integration`; `test/integration/tsconfig.json` covers the integration tests plus `demo/**` and carries `vite/client` types, because `import.meta.glob` needs them. `npm run typecheck` runs both. `demo/` must not enter the root program: a pure library's `tsc --noEmit` should not have to know Vite exists.
- **Gates** — `gate-a-pixels` compares against the v0.2.2 baseline captured in `test/fixtures/baseline/`; `gate-b-projection` covers the surface-extent and latitude behaviour; `gate-c-cross-backend` is described above. Gate A must be green before gate C's tolerance means anything: two backends that are wrong in the same way agree with each other perfectly.

## Conventions

- neostandard style: no semicolons, 2-space indent, single quotes.
- `import type` for type-only imports — `verbatimModuleSyntax` is on, so a value import of a type is a build error.
- `noUncheckedIndexedAccess` is on deliberately. `arr[i]` is `T | undefined`. Do not turn it off to quiet an index; that strictness is what let the old runtime argument checker be removed.
- English comments. TSDoc on exported functions, classes and interfaces; local comments only where a reader would otherwise get it wrong, and they should say why rather than what.
- Named exports, with the two viewer classes and their option types as the only public surface.
- Never edit `src/renderer/shaders/generated.ts`. Edit `src/core/projection-kinds.json` and run `npm run gen:shaders`.
