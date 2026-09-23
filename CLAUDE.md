# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pano.gl` is a dependency-light viewer for equirectangular (360°) images and video. Two public entry points — `FramelessImageViewer` and `FramelessVideoViewer`, both re-exported from `src/index.ts` — render a full-screen panorama into a container element, with four camera models (`linear`, `cylindrical`, `planet`, `pannini`) and built-in pan-tilt-zoom.

TypeScript 5, strict. Two rendering backends behind one interface: WebGPU (primary) and WebGL2 (fallback, for browsers that have no WebGPU).

**The most important thing to understand before touching anything camera- or shader-related:** there is no geometry and no vertex-stage projection. v0.2.x projected a quad's vertices in the vertex stage and let the rasteriser interpolate the rest; v1 draws a single fullscreen triangle and recovers the surface point per fragment by inverting the camera matrix. The GPU never interpolates a position. Every intuition carried over from the old architecture — vertex buffers, attribute layout, per-camera meshes — describes something that no longer exists.

## Commands

```shell
npm install
npm run start              # demo dev server (vite)
npm run build              # vite build -> dist/ (index.js ESM + index.cjs CJS, unminified, plus .d.ts)
npm test                   # unit, then integration
npm run test:unit          # vitest run --project unit
npm run test:integration   # vitest run --project integration --project no-webgpu
npm run test:coverage      # vitest run --project unit --coverage (90% branch threshold, enforced)
npm run typecheck          # three tsc programs: root, test/integration, tsconfig.scripts.json
npm run lint               # eslint src test scripts demo/**/*.ts
npm run gen:shaders        # regenerate src/renderer/shaders/generated.ts
npm run doc                # typedoc -> docs/api (generated, gitignored)
```

Run a single unit test: `npx vitest run test/unit/events.test.ts`. Run a single integration test: `npx vitest run --project integration test/integration/gate-c-cross-backend.test.ts`. The gates have no fallback twin — the `no-webgpu` project collects only `test/integration/fallback/` and the four user-story files, per its `include` in `vitest.config.ts`.

Integration tests need a real GPU to be meaningful. The `integration` project launches Chromium with `channel: 'chromium'` from `launchOptions` in `vitest.config.ts` — launch flags cannot come from an environment variable — and its setup file asserts a non-null adapter precisely so that a machine without WebGPU fails loudly instead of silently re-testing nothing. Under `CI=1` the same project adds the SwiftShader flags so software WebGPU exists; the `no-webgpu` project's setup file asserts the adapter **is** null, which is what proves `--disable-gpu` actually took effect.

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

It also reproduces v0.2.2 behaviour **including that version's bugs**, because the acceptance criterion is "renders what v0.2.2 rendered" — with one adjudicated exception: `lngOffset` used to subtract `povLongitude / 4`, degrees subtracted from a radian angle (~14.3× oversensitive panning). That was a v0.2.2 defect, corrected 2026-09-23 by user adjudication in the pan-zoom-semantics spec (§1), superseding v1-design §11.4 B1.

### Projection constants have exactly one source of truth

`src/core/projection-kinds.json` → `scripts/gen-shader-constants.mjs` → `src/renderer/shaders/generated.ts`, which exports `WGSL_CONSTANTS` and `GLSL_CONSTANTS`. The TypeScript constants (`cameraProjectionCode`, `textureProjectionCode` in `src/core/constants.ts`) and both shaders' constant blocks are all derived from that one file.

Never write a numeric literal for a projection kind, in TypeScript or in a shader. The numbers used to be maintained by hand in several places at once and agreed only by luck. Change the JSON and run `npm run gen:shaders`.

### The two shaders are hand-transcribed, and gate C holds them together

`src/renderer/webgpu/shaders/panorama.wgsl` and `src/renderer/webgl2/shaders/panorama.glsl` contain the same four projection formulas, written twice. Nothing in the type system or the build connects them — the constants they share come from the generator, but the formulas do not.

`test/integration/gate-c-cross-backend.test.ts` is what keeps them from drifting: it renders every camera state through both shaders and compares the pixels, with the CPU reference as the tiebreaker. **Changing a projection formula means changing both files.** A change made in one of them is the failure this gate exists to catch.

### Camera state is pose only

`CameraState` is `{ povLatitude, povLongitude }`, in degrees. Field of view, zoom and extent belong to the `Projection`, which is a discriminated union over the four kinds. Putting `zoom` on the camera state is a type error, and that is intentional.

Camera state is memoised per render behind a dirty flag: a setter that changes what the GPU sees must mark it dirty, or the change never reaches a frame.

There is no camera factory and nothing to register a camera into. Adding a camera model means: a new kind on the `Projection` union in `src/core/types.ts`, the constant in `src/core/projection-kinds.json` (then `npm run gen:shaders`), the formula written once in each shader, and a float64 copy in `src/core/reference.ts`. Gate C stays red until all of them agree.

## Testing

- **Unit** — `test/unit/{sourceFileName}.test.ts`, vitest, node environment. 90% branch coverage is a build failure, not a target. Cover the normal path, the invalid-input path and the boundary. Unit tests must not reach a GPU context.
- **Integration** — `test/integration/{userStoryName}.test.ts`, vitest **browser mode**: the test file itself runs inside the page and imports the library directly. User-story tests exercise the public surface the way a user does — `src/index.ts`, imported directly or through the viewer constructors in `support/viewer.ts` — while the gates and the infrastructure tests beside them (`dispose-order`, `uniform-layout`, ...) import `src/` internals, because pinning those internals is their job. There is no page-side surface and there must never be one again: tests reaching into the page through a global existed only as a workaround for running outside the page, and browser mode removed that premise. Rebuilding it would reintroduce exactly the indirection the mode exists to avoid.
  - Gestures go through `support/gestures.ts`, which wraps vitest's `userEvent` rather than hand-building `PointerEvent`s. `InputController` calls `setPointerCapture`, which throws for any pointerId the browser does not consider active — and pointerId `1` silently works in Chromium, so a hand-built event passes by coincidence while its sibling built with `999` fails with a symptom that reads as a broken camera.
  - Pixel readback goes through `support/canvas.ts`, and `await nextFrames(2)` comes first: a rAF-scheduled render has to land before the canvas is observable.
  - The projects and their guards live in `vitest.config.ts`: `integration` (real GPU, `channel: 'chromium'`, setup file asserts a non-null adapter), `no-webgpu` (`--disable-gpu`, setup file asserts a null adapter; `test/integration/fallback/` runs only in this project) and `unit` (node environment).
  - `npm run typecheck` is three programs, and the split is not decorative. The root `tsconfig.json` covers `src`, `test/unit` and `demo` and excludes `test/integration`. `test/integration/tsconfig.json` covers the integration tests alone and adds `@webgpu/types` and `vite/client` — the latter because `support/baseline-browser.ts` loads the baseline fixtures with `import.meta.glob`. `tsconfig.scripts.json` covers the build and test configs (`vite.config.ts`, `vitest.config.ts`, `scripts/**/*.mjs`) with node types. Demo's first-party TypeScript sits in the root program and needs no `vite/client`; the boundary that matters is that library code never knows Vite exists — `import.meta.glob` and Vite types appear only in test support and config files.
- **Gates** — `gate-a-pixels` compares against the v0.2.2 baseline captured in `test/fixtures/baseline/`; `gate-b-projection` covers the surface-extent and latitude behaviour; `gate-c-cross-backend` is described above. Gate A must be green before gate C's tolerance means anything: two backends that are wrong in the same way agree with each other perfectly.

## Conventions

- neostandard style: no semicolons, 2-space indent, single quotes.
- `import type` for type-only imports — `verbatimModuleSyntax` is on, so a value import of a type is a build error.
- `noUncheckedIndexedAccess` is on deliberately. `arr[i]` is `T | undefined`. Do not turn it off to quiet an index; that strictness is what let the old runtime argument checker be removed.
- English comments. TSDoc on exported functions, classes and interfaces; local comments only where a reader would otherwise get it wrong, and they should say why rather than what.
- Named exports, with the two viewer classes and their option types as the only public surface.
- Never edit `src/renderer/shaders/generated.ts`. Edit `src/core/projection-kinds.json` and run `npm run gen:shaders`.
