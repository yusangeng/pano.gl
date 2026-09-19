# Stage-0 spike (archived)

The throwaway probe that produced the evidence in
[`../../notes/stage-0-feasibility.md`](../../notes/stage-0-feasibility.md). It ran
before any design work, to answer questions that had to be settled by
measurement rather than by reading the WebGPU spec:

- can a headless CI browser get a WebGPU device at all, on more than one driver
- is the WGSL uniform address space really tight scalar packing, or std140
- does a column-major `gl-matrix` `Float32Array` upload to `mat4x4<f32>` without
  a transpose
- does `GPUExternalTexture` actually decode an H.264 video, or does the code need
  the `captureStream` fallback
- does `device.destroy()` really trigger `device.lost`

**This directory is archived, not maintained.** It is frozen at the state that
produced the report. It is not part of the build, not a workspace member, and its
`package.json` is deliberately not wired into anything — do not run `npm install`
from the repository root expecting it to be picked up.

To re-run it:

```bash
cd docs/superpowers/spikes/stage-0
npm install
node run.mjs          # or run-playwright.mjs for the browser half
```

`out/` holds the raw driver transcripts the report quotes. They are the reason
the report's numbers can be checked rather than taken on faith — in particular
`metal-*.txt` and `swiftshader-*.txt` are the two independent drivers that
established the uniform layout.
