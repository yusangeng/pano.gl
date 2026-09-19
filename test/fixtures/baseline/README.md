# v0.2.2 baseline fixtures

Captured from the vendored `bundle.js` (the shipped UMD build) by
`tools/baseline/capture.mjs`. Regenerate with:

```shell
cd tools/baseline && npm install && node capture.mjs
```

## What is here

- `<camera>/<state>.png` — the last of three steady-state frames, 128x128, lossless.
- `<camera>/<state>.uniforms.json` — every uniform write for all three frames,
  in submission order, keyed by the name recovered from `getUniformLocation`.
- `source.png` — the panorama every capture was rendered from, committed so that
  a later pixel comparison renders the same image rather than regenerating one.
- `index.json` — capture manifest: the observed uniform set per camera, byte
  count and sha256 per PNG, so a changed fixture shows up in a text diff.
  `fixtures.test.mjs` fails if the manifest and the bytes on disk ever
  disagree, so the hash column is enforced, not decorative.

PNG rows are top-down, flipped at encode time because the GL origin is
bottom-up. A renderer reading its own framebuffer from row 0 is already in the
same orientation, so a comparison needs no flip in either direction.

## Reproducibility

Checked by re-running the full capture on a later run and diffing the working
tree: **every one of the 16 PNGs and all 16 uniform streams came back
byte-identical**, and `index.json` differed only in `capturedAt`. So the
`pngSha256` column is a cross-run invariant rather than a record of one
afternoon, and a pixel gate comparing against these files is comparing against
something that can be re-derived on demand.

Two things this does not cover, and neither is a defect in the harness:

- **Same machine, same browser build.** `capture.mjs` pins Playwright's
  `channel: 'chromium'` so the rasteriser is the real one rather than
  SwiftShader, but a future Chromium could legitimately round differently. If a
  regeneration ever produces different pixels, that is the first thing to
  suspect, and the right response is to decide deliberately whether the locked
  baseline moves rather than to silently accept new bytes.
- **GPU-dependent rounding.** A different machine's driver may not reproduce
  these bytes exactly. Anything comparing across machines needs a tolerance,
  which is what gate C already assumes between the two backends.

If you regenerate and get a diff anywhere other than `capturedAt`, do not commit
it until you know why. The whole point of freezing this is that it stops moving.

## Why three frames

v0.2.2 rebuilds geometry only when `camera.id` changes
(`Renderer.setVertexBuffer`), so the first frame after a camera swap can still
be running against the previous camera's vertex buffer. The second is steady
state; the third is recorded as evidence that it is steady. The driver refuses a
capture that does not produce exactly three frames, or whose three frames
disagree with each other, and consumers that only want the answer should use
the last frame.

In this harness all three frames of every capture are identical — uniforms and
pixels both — and `capture.mjs` asserts that before writing anything, so the
steady-state claim is enforced rather than assumed. They agree because each
capture constructs a fresh viewer — so `currentCameraId_` starts undefined and
the first render rebuilds — and the recorder is reset well after load. The
extra frames are cheap insurance, not a workaround for an observed transient.

## Observed uniform set

| camera | uniforms received |
|---|---|
| `perspective` | `u_CamProjType`, `u_CamTransMatrix`, `u_Sampler`, `u_TexProjType` |
| `cylindrical` / `planet` / `pannini` | the above plus `u_CamPOVLongitude`, `u_CamZoom` |

Note what is **absent**, because it is the substance of F5 and F6 below:
`u_CamPOVLatitude`, `u_CamGeoWidth` and `u_CamGeoHeight` are declared in
`fshader.glsl` but never referenced, so the GLSL compiler drops them,
`getUniformLocation` returns null, and `Renderer.render` skips them. The CPU
still builds all three values every frame and throws them away.

## Known findings recorded by this baseline

Every finding below is a measurement from these captures, not a reading of the
source. Spec §11 carries the corresponding numbered entries.

- **F5 (non-linear cameras ignore latitude) — confirmed, and mechanically
  stronger than "ignored".** `u_CamPOVLatitude` never appears in the stream at
  all: it is a dead uniform, so the value cannot reach the GPU even in principle.
  The shader agrees independently — `cam_proj_cylindrical` computes
  `phi = atan(y) + HALF_PI`, which reads no latitude term. Resolves V3.
- **Non-linear pose travels only through `u_CamPOVLongitude`.** For all three
  non-linear cameras `u_CamTransMatrix` is byte-identical across all four states
  (it comes from the internal `ortho_` camera, which is constructed with
  `povLatitude: 0, povLongitude: 0` and never updated). The linear camera is the
  opposite: its matrix differs per state and it receives no POV uniform at all.
- **F10 (the file-scope `lng` initializer) — it takes effect.** `cylindrical`
  `origin` and `tilt` PNGs differ, and `lng` is the only consumer of
  `u_CamPOVLongitude` in the shader (`theta = z * TWO_PI - lng / 2.0` and two
  more sites downstream). So the non-constant global initializer is not merely
  tolerated by ANGLE, it is live: non-zero longitude really does rotate the
  non-linear projections. This is what makes the B1 behaviour in spec §11.4
  observable rather than theoretical.
- **F6** — `u_CamGeoWidth` / `u_CamGeoHeight` are dead uniforms (see the table
  above).
- **F11** — the `% 25` longitude guard is directly visible. `tilt` is driven with
  a longitude delta of 45 and the shader receives `20`; `south` with 180 receives
  `5`; `zoomed` with 300 receives `0`, because 300 is an exact multiple of 25.
- **F12** — the zoom clamp is one-sided, not merely inconsistent.
  `CylindricalCamera` and `PlanetCamera` set `zoomValue_ = clamp(value, 0.1, 1)`,
  an **upper** bound of 1, so zooming *in* is silently discarded; only zoom-out
  below 1 survives. `PanniniCamera` clamps to 2 and is the one camera whose
  `u_CamZoom` moves off 1.
- **L1 is worse than a resize-listener leak.** `RenderFlow.dispose` calls the
  misspelled `window.removeEventLstener` as its **first** statement, so it
  throws before reaching `driver_.dispose()`. The consequence is not only a
  leaked resize listener: the `requestAnimationFrame` render loop is never
  cancelled. Every viewer ever constructed keeps rendering forever. The recorder
  in `probe.html` has to filter draws by canvas identity for exactly this reason.

## Consequence for gate A: which states are comparable

`cylindrical/zoomed` and `planet/zoomed` are **byte-identical to their `origin`**
in this baseline. Three independent bugs compose to produce that: longitude 300
wraps to 0 under `% 25` (F11), latitude is never sent (F5), and zoom-in is
clamped away (F12). It is a correct record of v0.2.2 and a useful regression
anchor — but it is not a distinct state for those two cameras.

So the comparable set for a pixel gate is derived, not assumed:

- **F5** restricts the three non-linear cameras to `lat == 0` states, because v1
  deliberately makes latitude effective where v0.2.2 ignored it. In this matrix
  that leaves `origin` alone; `tilt`, `south` and `zoomed` all carry non-zero
  latitude.
- **F10** does *not* restrict further. Because the file-scope initializer is
  live, v0.2.2's rotation is real, and v1 reproduces the same B1 arithmetic on
  purpose (spec §11.4) — so non-zero longitude remains comparable. Had the
  initializer compiled to zero, v0.2.2 would have shown no rotation while v1
  showed one, and non-zero longitude would have been incomparable too.
- The linear camera is unrestricted on both counts, and its pose demonstrably
  reaches the GPU through `u_CamTransMatrix`.
- `zoom` is comparable only where `u_CamZoom` actually moves, i.e. `pannini`.
  For the other cameras the state is still worth capturing (it pins the clamp
  bug), but a comparison there asserts "still refused to zoom", which is a
  statement about the bug rather than about the projection.

Both findings are recorded here so that a reviewer can see why the pixel gate
runs on fewer states than the matrix gate, rather than having to rediscover it.
