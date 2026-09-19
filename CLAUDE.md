# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`pano.gl` is a dependency-light WebGL viewer for equirectangular (360°) images and video. Two public entry points — `FramelessImageViewer` and `FramelessVideoViewer` — render a full-screen panorama into a container element, with four camera models (perspective / cylindrical / planet / pannini) and built-in pan-tilt-zoom.

All projection math happens **per-fragment in GLSL**, not per-vertex on the CPU. The CPU side only produces a transform matrix and a handful of scalar uniforms; `src/shader/fshader.glsl` converts the interpolated 3D position into equirectangular UVs. This is the single most important thing to understand before changing anything camera- or shader-related.

## Commands

```shell
npm i                                            # deps (babel 6 era; no lockfile drift guard)
npm start                                        # demo dev server, webpack-dev-server on :9900
npm run build                                    # build-debug + build-release -> ./.package
npm run build-debug                              # unminified UMD bundle + BundleSizeDebug.html
npm run build-release                            # minified UMD bundle + sourcemap + BundleSizeRelease.html
npm run es5                                      # babel src -> lib (this is what gets published)
npm run doc                                      # jsdoc -> ./doc
```

There is **no working test command**. `npm test` runs `babel-node node_modules/.bin/isparta cover node_modules/.bin/_mocha`, but the repository has no `test/` directory, no `.mocharc`/`mocha.opts`, and no test files. `_prebuild` and `_prepublish` are prefixed with `_` so npm never invokes them automatically — `npm run build` does **not** run tests. See "Testing" below.

## Build layout

Two independent outputs, both gitignored:

| Path | Produced by | Purpose |
|---|---|---|
| `.package/bundle.js`, `.package/bundle.min.js` | `webpack/{debug,release}.js` | UMD bundle, global `PanoGL`, with the GLSL inlined |
| `lib/` | `npm run es5` | ES5 transpile of `src/`, published to npm as `main` |

`package.json` points `main` at `lib/index.js` and `jsnext:main` at `src/index.js`. Because `.glsl` is only importable through `webpack-glsl-loader`, `lib/` will contain `require('../shader/vshader.glsl')` calls that no plain Node/babel process can resolve — only the webpack bundles are self-contained. Consumers importing `pano.gl/lib/...` must be bundling with a glsl loader of their own.

`npm run build-release` sets `UglifyJSPlugin.mangle.except: ['$super', '$', 'exports', 'require']` — the `$super` entry is load-bearing for the mixin/decorator runtime; don't remove it.

## Architecture

### Composition model: `litchy` mixins

Almost every class is assembled from mixins rather than inheritance, using `litchy`. A mixin is a *class factory* with the shape `superclass => class extends superclass`:

```js
export default superclass => class LinearProjection extends superclass { ... }

export default class PerspectiveCamera extends mix(Camera).with(Projection, Trans) { ... }
```

`mix(A).with(B, C)` applies C over B over A. Mixin order matters; the leftmost class in `with(...)` wins for duplicate members but all `super` chains still run.

`litchy`'s decorators are used pervasively and carry real semantics:

- `@eventable` — adds `on`/`off`/`trigger`; `trigger('*')` forwards every event.
- `@disposable` — adds `dispose()`; you must call `super.dispose()` from your own `dispose()`.
- `@undisposed` — guards a method/getter so calling it after `dispose()` throws instead of silently returning garbage. Applied to nearly every public member.
- `@hasid` — attaches a stable `id` (used by the renderer to detect camera swaps).

`dodele` supplies `Delegate` (declarative DOM listener binding) and `@callback(eventName, cssSelector)`, which routes a DOM event on a delegated node to a method. `param-check`'s `check(value, 'name').isNumber()` style argument validation is used at nearly every public boundary; keep it up when adding functions. `chivy` provides the `Logger`.

### Object graph

```
FramelessImageViewer / FramelessVideoViewer   (mix(Viewer).with(CameraFactory))
  └─ Viewer                (mix(Eventable).with(Delegate, RenderFlow))
       ├─ RenderFlow       owns Renderer + FrameDriver, exposes setCamera/setTexture/rotate/zoom
       │    ├─ Renderer            WebGL context, canvas, program, texture object, frame rate caps
       │    └─ FrameDriver         rAF loop, emits 'frame'
       ├─ ZoomPlugin / PanPlugin   DOM gesture recognizers -> synthetic 'zoom'/'pan' Events
       └─ Texture          (mix of provider + optional frame canvas)
            └─ ImageProvider | VideoProvider   media element, event re-emission, upload throttling
```

The concrete viewers are thin: they validate constructor args, build a camera via the `CameraFactory` mixin, build a `Provider` + `Texture`, and forward every `Texture` event up to themselves (rewriting `target` to the viewer). All behavior lives in `Viewer`/`RenderFlow`.

### The camera contract

A camera is anything that satisfies `Camera`'s interface. Adding a new one means implementing:

- `geoVertexes` — flat `[x,y,z, ...]` triangle soup for the geometry this camera projects.
- `status()` — returns `{ Name: { type, value } }` where `Name` maps to a GLSL uniform `u_Name` and `type` is the **`gl` function name** (e.g. `'uniform1f'`, `'uniformMatrix4fv'`). `Renderer.render` walks this generically, so a new uniform needs no renderer change — only a matching `uniform` declaration in the shader. Return a superset when delegating (`PlanetCamera` merges its inner `OrthoCamera.status()`).
- `rotate(lat, lng)`, `zoom(delta)`, `povLatitude`/`povLongitude`, and a stable `id` (`@hasid`).

Then register it in **both** maps in `src/CameraFactory.js` (`cameraMap` and `defaultDataMap`) — the factory throws `TypeError: Can NOT find camera class` otherwise. `CameraFactory` is mixed into the two viewers; `viewer.cameraOptions = {...}` is a setter that reconstructs and swaps the camera at runtime.

Two families exist:

- **Linear** — `PerspectiveCamera` / `OrthoCamera` = `mix(Camera).with(LinearProjection, Trans)`. `LinearProjection` supplies pov angles, the view/projection/trans matrices and the cube geometry (`Cube` at radius 100, not `Sphere` — sphere tessellation was tried and abandoned). `Trans` supplies the projection matrix (`PerspectiveTrans` = `setPerspective`, `OrthoTrans` = `setOrtho`).
- **Non-linear** — `CylindricalCamera` / `PlanetCamera` / `PanniniCamera` compose `Camera` with a small `Polygon` (a flat quad) and own a private `OrthoCamera` purely to borrow its projection matrix; they override `status()` to also emit `CamGeoWidth`/`CamGeoHeight`/`CamPOV*`/`CamZoom`, which `fshader.glsl`'s `cam_proj_*` functions consume. Their visual behavior is entirely in the fragment shader.

`Camera.status()` is memoized behind the `dirty` flag — any setter that changes uniforms must set `this.dirty = true`, or the change will never reach the GPU.

`OrthoCamera` is deliberately not registered in the factory (commented out in `CameraFactory.js` and in the demo) — it is only an internal building block. `Texture`'s fisheye projection is likewise stubbed out (`throw new Error('Unimplemented projection type')`), and `tex_proj_fisheye` in the fragment shader returns `vec2(0.0, 0.0)`.

### Projection type constants are duplicated

`src/core/camera/projectionType.js` and the `#define CAMERA_PROJECTION_TYPE_*` / `TEXTURE_PROJECTION_TYPE_*` blocks at the top of `fshader.glsl` must stay numerically in sync. The JS constants are uploaded as `u_CamProjType` / `u_TexProjType` and compared in GLSL. There is no shared source of truth — changing one without the other silently renders the wrong projection.

### Renderer specifics

- A single GLSL program is shared by all cameras: `programs_` is keyed by the literal `'dummy'`, and both `getProgram` and `setVertexBuffer` ignore their `camera` argument for lookup. A camera that needs a *different* shader pair requires changing that.
- The vertex buffer is rebuilt only when `camera.id !== this.currentCameraId_`, so swapping cameras re-uploads geometry. `glu.initVertexBuffer` allocates a fresh `gl.createBuffer()` on every call and never deletes the previous one — expect buffer churn when switching cameras frequently.
- `MAX_FRAME_RATE = 60` throttles draw calls; `VideoProvider` separately throttles texture *uploads* to 30/s. Both matter for the `frameRate` / `updateRate` `RateCounter`s exposed on the viewer.
- The canvas is created with `class="renderer-canvas"` and a `renderer-canvas-<shortid>` id. The class is a hard dependency of the `@callback('zoom', '.renderer-canvas')` / `@callback('pan', '.renderer-canvas')` wiring in `Viewer` — renaming it breaks PTZ silently.
- `updateTextureObject` uses `gl.RGB` + `LINEAR` filtering with no mipmaps and no `CLAMP_TO_EDGE`, so the source frame must be power-of-two and equal in size to the canvas-drawn region. This is why the demo ships 2048/4096/8192-wide images and why `Texture` accepts a `frameSize` option to route through an intermediate 2D canvas when the source exceeds `MAX_TEXTURE_SIZE`.

### Texture and providers

`Texture` has two modes. Without `frameSize` it is `direct` — the `<img>`/`<video>` element is uploaded to the GPU as-is. With `frameSize` it owns a 2D canvas that the provider `drawImage`s into, which is the escape hatch for oversized media.

`updateTexture(texture)` returns a boolean meaning "the GPU texture must be re-uploaded this frame"; `direct` returns a latched `needUpdate_` flag, indirect returns whether a redraw occurred. Providers re-emit the media element's DOM events as `media-<type>` (see `mediaEventTypes` in `VideoProvider`), which bubble up through `Texture` → viewer, so consumers can listen for `media-load`, `media-error`, `media-play`, etc. on the viewer itself.

`dispose()` is genuinely required: `RenderFlow.dispose` tears down the rAF driver, renderer, texture and camera, and `VideoProvider` detaches ~23 DOM listeners. Note that both `RenderFlow` and `Renderer` call `window.removeEventLstener(...)` (sic — the typo is in the source, and it means resize listeners are never actually removed).

### Gestures

`PanPlugin` and `ZoomPlugin` bind raw listeners through `Delegate.on$`, track their own gesture state, and dispatch a **synthetic bubbling `Event('pan'|'zoom')` with custom properties attached** (`delta`, `deltaX`, `deltaY`, `distance`) onto the target element. `Viewer.onPan`/`onZoom` catch them via `@callback` and convert pixel deltas into degrees/fov via `this.frameWidth`/`frameHeight`. Every handler calls `preventDefault()`. Setting `viewer.PTZ = false` short-circuits both without unbinding anything.

## Testing

There is currently no test suite. Per the project's conventions, tests belong in `test/unit/{sourceFileName}.test.{ext}` and `test/integration/{userStoryName}.test.{ext}`, using mocha + chai (chai is already a devDependency), with ≥90% branch coverage.

Two practical obstacles to be aware of before adding the first test:

1. `npm test` invokes `isparta` + `_mocha` with no configuration — a `test/` directory and a `mocha.opts` (or a rewritten script) must exist first.
2. `Renderer` and anything importing it pull in `require('*.glsl')`, which only webpack's `webpack-glsl-loader` resolves. Headless unit tests need either a `require.extensions['.glsl']` hook in a mocha setup file, or the shader source factored out of the module graph. Anything touching `Renderer` also needs a real or stubbed WebGL context, plus `window`/`document` — the modules read `window.requestAnimationFrame` and `document.createElement` at import time.

Pure-logic modules that are cheap to test in isolation: `utils/clamp`, `utils/Throttle`, `utils/RateCounter`, `utils/selectorToElement`, the `geometry/*` meshers (`flatten`/`mesh`/`clone`), and the camera matrix math in `LinearProjection` / `PerspectiveTrans` / `OrthoTrans` (the `status()` memoization behind `dirty` is a good branch-coverage target).

## Conventions

- **standardjs style**: no semicolons, 2-space indent, single quotes. There is no linter or `.eslintrc` installed — the README badge is aspirational, so match the surrounding code by hand.
- File-level JSDoc block with the class/function name and `@author Y3G` heads every module. Existing comments are mostly Chinese; new comments should be written in English.
- Babel 6 with `transform-decorators-legacy` + `transform-class-properties` — decorators on getters/setters (`@undisposed get foo()`) and class-property decorators are both in use and required. Don't "modernize" these to Babel 7 decorator semantics without migrating the whole codebase.
- Default exports only; `src/index.js` re-exports the two viewer classes as named exports.
- `vendor/cuon.js` is a vendored copy of the WebGL "cuon" matrix helper library, imported as `{ Matrix4 }`. It is not an npm dependency and not covered by any build tooling — edit in place if needed.
- `konph` and `polygala` are declared in `dependencies` but have no references anywhere in `src/`.

## Known rough edges

- `demo/webpack.config.js` sets `entry: './index.js'` but the tracked file is `demo/Index.js`. This resolves on case-insensitive filesystems (macOS) and fails on Linux/CI.
- `window.removeEventLstener` (typo) in `RenderFlow.dispose` and `Renderer.dispose` — resize listeners leak on dispose.
- `CylindricalCamera` and `PanniniCamera` both declare `export default class PlanetCamera` and accept a `zoom` constructor option they then ignore (hardcoding `this.zoomValue = 1`). `CylindricalCamera` ignores its `zoomValue` setter's `check(...)` (unlike its siblings), and `PanniniCamera`'s `zoomValue` clamp upper bound is `2` where the others use `1`.
- `povLongitude` setters on the three non-linear cameras do `long % 25` (an error-accumulation guard) where `LinearProjection` wraps into `[0, 360)`.
- `Camera` and `OrthoCamera` are `@disposable` but declare no `dispose()` of their own, so `Camera` sets `camera_ = null` in `RenderFlow.dispose` without disposing it. `Texture.dispose()` does dispose its provider.
- `.travis.yml` targets Node 9 and runs `npm run build` only.
