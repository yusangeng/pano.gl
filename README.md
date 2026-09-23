# pano.gl

[![Npm Info](https://nodei.co/npm/pano.gl.png?compact=true)](https://www.npmjs.com/package/pano.gl)

A dependency-light viewer for equirectangular (360°) images and video. WebGPU
first, WebGL2 as the fallback, four camera models and built-in pan-tilt-zoom —
two runtime dependencies, one of which is a logger.

The ESM bundle is 36.7 kB gzipped. That number is deliberately conservative:
the build ships `minify: false` so the code stays readable in `node_modules`,
and consumers who minify get it smaller.

```shell
npm install pano.gl
```

## Browser support

| Environment | Backend | Notes |
|---|---|---|
| WebGPU available | WebGPU | The primary path. `requestAdapter()` must return an adapter — a browser that exposes `navigator.gpu` but has no GPU still falls through. |
| No WebGPU, but WebGL2 | WebGL2 | Renders the same pixels as WebGPU (asserted by a cross-backend pixel gate). |
| Neither | — | `create()` throws; `probe()` returns `{ backend: 'none' }` so you can decide before constructing anything. |

WebGPU ships in current Chrome, Edge and Safari, and in Firefox on Windows;
WebGL2 covers essentially every browser released since 2017. If both work,
pano.gl uses WebGPU and you never have to think about it.

## Minimal example

```html
<div id="pano" style="width: 100vw; height: 100vh"></div>
```

```ts
import { FramelessImageViewer } from 'pano.gl'

const viewer = await FramelessImageViewer.create({
  container: document.querySelector<HTMLElement>('#pano')!,
  src: '/image/2048x1024.jpg'
})

viewer.on('media-error', (event) => console.error(event.error))
```

That is the whole API surface for the common case. Drag to pan, wheel or pinch
to zoom — no configuration, enabled by default (`PTZ = false` turns it off).
`src` is any URL of an equirectangular image; this one ships in the repo's
`demo/` directory. Creation is async because acquiring a GPU device is, and it
throws rather than handing you a viewer that cannot draw.

Video is the same shape, with the `<video>` element's own options passed
straight through:

```ts
import { FramelessVideoViewer } from 'pano.gl'

const viewer = await FramelessVideoViewer.create({
  container: document.querySelector<HTMLElement>('#pano')!,
  src: '/video/city.mp4',
  loop: true
})

await viewer.play() // rejects if the browser's autoplay policy refuses
```

## Constructor options

`FramelessImageViewer.create(options)` and `FramelessVideoViewer.create(options)`
share every option below; the video viewer adds the three marked.

| Option | Type | Default | Description |
|---|---|---|---|
| `container` | `HTMLElement` | — | The element the canvas is appended to. It should have a non-zero size. |
| `src` | `string` | — | URL of the source. For video, a URL — the viewer creates its own `<video>` element (`viewer.element` exposes it). |
| `projection` | `'equirectangular'` | `'equirectangular'` | How the source's pixels are laid out. A property of the source, not the camera. |
| `camera` | `{ projection, pose? }` | `linear`, 70° fov | The camera: which projection formula, and where it starts. See below. |
| `PTZ` | `boolean` | `true` | Built-in pan-tilt-zoom. |
| `autoplay` | `boolean` | — | Video only. |
| `loop` | `boolean` | — | Video only. |
| `muted` | `boolean` | `true` | Video only. Muted by default because browsers block unmuted autoplay. |

There is deliberately no `frameSize`: neither WebGPU nor WebGL2 has WebGL1's
power-of-two texture rule, and sources larger than the device's
`maxTextureDimension` are downscaled automatically.

### Camera

`camera.projection` is a discriminated union — `kind` picks the formula, and
each kind carries its own parameters:

| `kind` | Parameters | Fields |
|---|---|---|
| `'linear'` | `fov` (radians, clamped to 15°–110°), `aspect` | The classic perspective camera; `aspect` is maintained by the viewer from the container's size. |
| `'cylindrical'` | `zoom` (0.01–1), `extent` (1×1) | Full 360° horizontally, vertical lines stay vertical. |
| `'planet'` | `zoom` (0.01–1), `extent` (4×4) | The "little planet" look — the ground wraps into a sphere. |
| `'pannini'` | `zoom` (0.01–1), `extent` (4×4) | Pannini projection — very wide fields of view with verticals kept straight. |

`camera.pose` sets the starting orientation, `{ povLatitude, povLongitude }` in
degrees. At runtime, `viewer.cameraOptions` swaps the projection **and keeps
the pose**; `viewer.rotate(lat, lng)` and `viewer.zoom(delta)` drive it
programmatically (positive `delta` magnifies).

## Events

`viewer.on(name, handler)` returns its own unsubscribe function — no need to
keep the handler around for `off()`. `on('*', handler)` receives everything as
`(type, event)`.

| Event | Payload | Fired when |
|---|---|---|
| `media-load` | `{ target }` | Source metadata is ready. |
| `media-error` | `{ target, error }` | The source failed to load or decode. |
| `media-play` / `media-pause` / `media-ended` | `{ target }` | Playback state changes (video). |
| `media-seeking` / `media-seeked` | `{ target }` | Seeking (video). |
| `media-progress` | `{ target }` | Playback advances (video). |
| `rotate` | `{ lat, lng }` | After a drag. |
| `zoom` | `{ delta }` | After wheel or pinch. |
| `device-lost` | `{ reason, message }` | The GPU device or WebGL context went away. The viewer cleans itself up; render nothing until you rebuild. |

`target` is always the viewer itself.

## Capabilities

`viewer.capabilities` reports what the device actually does:

```ts
viewer.capabilities.backend              // 'webgpu' | 'webgl2'
viewer.capabilities.adapter              // e.g. { vendor: 'apple', architecture: 'apple-m2' }
viewer.capabilities.maxTextureDimension  // sources larger than this are downscaled
viewer.capabilities.externalTextures     // video sampled without a copy (WebGPU only)
```

To ask before constructing anything — for example to show "your browser is
using the slower renderer", or to decline gracefully — use the static probe:

```ts
const caps = await FramelessImageViewer.probe()
if (caps.backend === 'none') { /* show a fallback page */ }
```

`{ backend: 'none' }` is an answer, not an exception.

## dispose()

`dispose()` is mandatory and idempotent. It stops the render loop, detaches the
source, releases the GPU resources (on WebGL2, via `WEBGL_lose_context` —
browsers cap live contexts at roughly 16, and hitting the cap makes every new
viewer fail silently), removes the DOM listeners and the canvas. A lost device
fires `device-lost` and disposes itself.

## The four projections

The names only go so far — the four cameras differ in ways pictures convey
faster than prose. All four below are the same source — the linear camera at
its default 70° fov, the non-linear cameras at zoom 1:

| | |
|---|---|
| `linear` | `cylindrical` |
| ![linear](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/linear.png) | ![cylindrical](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/cylindrical.png) |
| `planet` | `pannini` |
| ![planet](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/planet.png) | ![pannini](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/pannini.png) |

Rule of thumb: `linear` for the photograph look, `cylindrical` when panning
wide without side-stretch, `planet` for the little-planet effect, `pannini`
when you want an ultrawide field with verticals still straight.

## Development

```shell
npm install
npm run start        # demo dev server (vite)
npm run build        # dist/ — ESM + CJS, unminified
npm test             # unit, then integration
npm run typecheck    # all three tsconfig programs
npm run lint         # eslint
npm run doc          # typedoc -> docs/api/ (generated, not committed)
```

The demo (`npm run start`) serves `demo/` with the assets used in the examples
above. Integration tests run in a real browser — on CI against a software
adapter (SwiftShader), locally against a real GPU — see `CLAUDE.md` for the
gates and conventions.

## Migrating from 0.2.x

1.0.0 is a rewrite: the entry points, constructor options and camera options
all changed, and there is no compatibility shim. Every difference is listed,
with the reason, in
[docs/migration-v0.2-to-v1.0.md](https://github.com/yusangeng/pano.gl/blob/master/docs/migration-v0.2-to-v1.0.md)
(written in Chinese).

## License

MIT
