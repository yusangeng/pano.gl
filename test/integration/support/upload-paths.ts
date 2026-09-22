/*
 * Renders one video frame through both WebGPU upload paths, offscreen, and
 * returns both readbacks.
 *
 * Deliberately not built on pano.gl's backend. The question is about the two
 * browser APIs, and the backend cannot answer it: each upload path is
 * self-consistent, so a backend test that only ever exercises the path its
 * device happens to support sees nothing wrong. The disagreement only shows up
 * when both paths render the same frame -- which is what P3's single shared
 * flip in `to_uv` assumes cannot happen.
 *
 * An ordinary module, and it runs in the page like everything else here: no
 * driver, no serialization boundary. The one thing this still needs is its own
 * device, because it must build pipelines the backend would never build.
 *
 * It answers with `unavailable` rather than a throw when the adapter cannot
 * produce a video-backed texture, because that is a property of the machine and
 * not a defect to report. What it never does is answer with a comparison it did
 * not measure, or excuse itself on the strength of a claim about the machine
 * that it did not just check: a flat frame is only ever `unavailable` after the
 * fixture has decoded with contrast of its own and the same device has rendered
 * a constant colour, and both of those are measured on the run that reports it.
 */

/** One upload path's output: RGBA8, top-down, row-major. */
export interface PathRender {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

/**
 * What one probe run produced.
 *
 * `unavailable` is an outcome rather than an exception because it is a fact
 * about the machine, not a failure of anything: some adapters cannot turn a
 * video element into a texture at all, and there the question this probe asks
 * has no subject. A caller that cannot tell the two apart has to either fail on
 * a healthy CI runner or pass without measuring, and both are worse than
 * saying so.
 */
export type VideoPathComparison =
  | { readonly kind: 'rendered', readonly external: PathRender, readonly copy: PathRender }
  | { readonly kind: 'unavailable', readonly detail: string }

/*
 * How much the two halves of the frame must differ, in mean 8-bit levels, for
 * "is this upside down" to be a question at all. The fixture measures ~28
 * through the decoder and ~21 through this path on a hardware adapter, against
 * 0 through either upload path on a software one -- so the threshold sits in a
 * wide gap rather than next to any of the measurements it has to separate.
 */
const MIN_HALF_CONTRAST = 8

/*
 * The vertex stage is shared by both paths on purpose. Both readbacks are then
 * produced by the same uv mapping into the same top-down layout, which is what
 * makes the comparison a measurement of the APIs rather than of the probe:
 * clip y=+1 maps to uv.y=0, and readback row 0 is v=0.
 *
 * The vertex stage and the fragment stage go into ONE module per path. WGSL
 * structs are module-scope, so a fragment module that only declares `fs` would
 * not know `VOut` -- plenty of WebGPU samples get away with two modules because
 * their fragment stage takes `@builtin(position)` instead.
 */
const VERTEX = `
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs (@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[i];
  var out: VOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = vec2f((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return out;
}
`

const FRAGMENT_EXTERNAL = `
@group(0) @binding(0) var src: texture_external;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs (in: VOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(src, samp, in.uv);
}
`

const FRAGMENT_COPY = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs (in: VOut) -> @location(0) vec4f {
  return textureSample(src, samp, in.uv);
}
`

/*
 * No texture and no bindings, so this says something no other readback here
 * can: the device renders. Three distinct non-zero channels, so "read back
 * black" is distinguishable from "read back a number" on every one of them.
 */
const FRAGMENT_SOLID = `
@fragment
fn fs (in: VOut) -> @location(0) vec4f {
  return vec4f(0.25, 0.5, 0.75, 1.0);
}
`

/**
 * Uploads one paused frame of `url` through each path and reads both back.
 *
 * @param url - Video URL, same-origin so the external texture is not tainted.
 * @param size - Square render size. 64 keeps the readback's bytesPerRow at the
 *   256-byte alignment `copyTextureToBuffer` demands.
 */
export async function renderVideoBothPaths (
  url: string,
  size = 64
): Promise<VideoPathComparison> {
  const adapter = await navigator.gpu.requestAdapter()
  if (adapter === null) throw new Error('no WebGPU adapter')
  const device = await adapter.requestDevice()

  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.src = url
  // `loadeddata`, not `loadedmetadata`: metadata describes the size while
  // `loadeddata` is the first event that guarantees a frame exists at all. A
  // paused frame is also what makes the two paths comparable -- there is
  // exactly one frame in play, so a difference is orientation rather than
  // timing.
  await new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', resolve, { once: true })
    video.addEventListener('error', () => reject(new Error(`video failed: ${url}`)), { once: true })
  })
  video.pause()
  // Seek once while paused. `loadeddata` alone leaves this Chromium's video with
  // no GPU-backed frame -- importExternalTexture then throws "doesn't have back
  // resource" even at readyState 4, and attaching the element to the document
  // does not change that (measured; see the Task 4 report). A seek is the least
  // it takes to force the decoder to present a frame, and it keeps every
  // property the comment above claims: the video stays paused, and there is
  // still exactly one frame in play. 0.5s because the probe was verified there;
  // `min(duration / 2)` keeps it inside any clip short enough to matter.
  video.currentTime = Math.min(0.5, video.duration / 2)
  await new Promise((resolve, reject) => {
    video.addEventListener('seeked', resolve, { once: true })
    video.addEventListener('error', () => reject(new Error(`video failed: ${url}`)), { once: true })
  })

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
  const target = device.createTexture({
    size: [size, size],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
  })
  const bytesPerRow = size * 4
  const readback = device.createBuffer({
    size: bytesPerRow * size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const pipeline = (fragment: string): GPURenderPipeline => {
    const shaderModule = device.createShaderModule({ code: `${VERTEX}\n${fragment}` })
    return device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs' },
      fragment: { module: shaderModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' }
    })
  }

  const readTarget = async (): Promise<Uint8Array> => {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [size, size])
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    // Copied out before `unmap`: the mapped range is only valid until then.
    const rgba = new Uint8Array(readback.getMappedRange().slice(0))
    readback.unmap()
    return rgba
  }

  const draw = (pipe: GPURenderPipeline, entries: GPUBindGroupEntry[]): void => {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: target.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    })
    pass.setPipeline(pipe)
    pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }))
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  // Path 1: importExternalTexture. No flipY exists on this path, so whatever
  // row order it produces is the row order everything else has to live with.
  //
  // Import, bind, draw and submit happen in one synchronous stretch with no
  // `await` between them, because the external texture is destroyed when this
  // task ends. The awaits that follow are after the submit, which is safe.
  const externalPipe = pipeline(FRAGMENT_EXTERNAL)
  draw(externalPipe, [
    { binding: 0, resource: device.importExternalTexture({ source: video }) },
    { binding: 1, resource: sampler }
  ])
  const external = await readTarget()

  // Path 2: copyExternalImageToTexture. `flipY: false` is the claim under test:
  // it should agree with the external path, because that is the value P3's
  // backend passes and the value no single shader flip can compensate for if
  // the two APIs disagreed.
  //
  // copyExternalImageToTexture does not scale, so a [size, size] copy of the
  // 512x256 fixture carries only its top-left quadrant and the comparison
  // degenerates to a constant. The probe copies the whole frame at its natural
  // size, and the normalised UV mapping scales it into the square render
  // target.
  const natural: [number, number] = [video.videoWidth, video.videoHeight]
  const copied = device.createTexture({
    size: natural,
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  })
  device.queue.copyExternalImageToTexture({ source: video, flipY: false }, { texture: copied }, natural)
  const copyPipe = pipeline(FRAGMENT_COPY)
  draw(copyPipe, [
    { binding: 0, resource: copied.createView() },
    { binding: 1, resource: sampler }
  ])
  const copy = await readTarget()

  // A uniform frame is useless as a probe -- the test would pass on a black
  // screen -- and so is one whose top half and bottom half happen to match:
  // "is this upside down" is a question about the top against the bottom, so
  // the frame has to have a top and a bottom to tell apart. Hence the mean of
  // each half rather than "are there two colours in here".
  const halfMean = (rgba: Uint8Array, width: number, from: number, to: number): number => {
    let sum = 0
    let count = 0
    for (let y = from; y < to; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        sum += rgba[i]! + rgba[i + 1]! + rgba[i + 2]!
        count += 3
      }
    }
    return sum / count
  }
  const halfContrast = (rgba: Uint8Array, width: number): number => {
    const rows = rgba.length / 4 / width
    const half = Math.floor(rows / 2)
    return Math.abs(halfMean(rgba, width, 0, half) - halfMean(rgba, width, half, rows))
  }
  const channelMax = (rgba: Uint8Array): number => {
    let max = 0
    for (let i = 0; i < rgba.length; i += 4) {
      max = Math.max(max, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, max)
    }
    return max
  }
  const half = Math.floor(size / 2)
  const top = halfMean(external, size, 0, half)
  const bottom = halfMean(external, size, half, size)

  // Either path having a top and a bottom is enough to compare them: the
  // comparison is the subject, and a path that came back flat while the other
  // did not is precisely the disagreement this probe exists to catch, so it
  // has to reach the assertion rather than be excused here.
  if (
    halfContrast(external, size) >= MIN_HALF_CONTRAST ||
    halfContrast(copy, size) >= MIN_HALF_CONTRAST
  ) {
    return {
      kind: 'rendered',
      external: { width: size, height: size, rgba: external },
      copy: { width: size, height: size, rgba: copy }
    }
  }

  // Both flat. Two very different machines produce that and they want opposite
  // outcomes, so measure which one this is instead of guessing. Both controls
  // run only here, where the frame is already known to be flat -- the ordinary
  // run pays nothing for them, and every number in the answer below was taken
  // on this run rather than remembered from an investigation.
  //
  // First the fixture, with WebGPU out of the picture entirely. A frame that
  // has no top and no bottom through the decoder is a broken fixture, which is
  // a failure and not an environment to skip in: no adapter could have
  // answered, but neither should this pass quietly.
  const decodeCanvas = document.createElement('canvas')
  decodeCanvas.width = natural[0]
  decodeCanvas.height = natural[1]
  const decodeContext = decodeCanvas.getContext('2d')
  if (decodeContext === null) throw new Error('no 2d context, so the fixture cannot be checked')
  decodeContext.drawImage(video, 0, 0)
  const decoded = new Uint8Array(
    decodeContext.getImageData(0, 0, natural[0], natural[1]).data
  )
  const decodedContrast = halfContrast(decoded, natural[0])
  if (decodedContrast < MIN_HALF_CONTRAST) {
    throw new Error(
      `the fixture has no top/bottom contrast through the decoder (${decodedContrast}); ` +
      'orientation cannot be judged from it'
    )
  }

  // Then the device, with no external image involved: a constant colour needs
  // no upload, so a device that renders black here is broken in a way that no
  // skip should cover up.
  const solidPipe = pipeline(FRAGMENT_SOLID)
  draw(solidPipe, [])
  const solidMax = channelMax(await readTarget())
  if (solidMax === 0) {
    throw new Error(
      'this device produced no pixels at all: a constant colour reads back black ' +
      `(max ${solidMax}) and so does the video frame (top ${top}, bottom ${bottom})`
    )
  }

  return {
    kind: 'unavailable',
    detail:
      `the WebGPU adapter here reports vendor "${adapter.info.vendor}" architecture ` +
      `"${adapter.info.architecture}". The fixture decodes with a top/bottom contrast of ` +
      `${decodedContrast.toFixed(1)} and the device renders a constant colour readably ` +
      `(max ${solidMax}), but a video frame reads back flat through both upload paths ` +
      `(top ${top}, bottom ${bottom}). Nothing this probe can do yields a video-backed ` +
      'texture on this adapter, so the comparison has no subject here; a hardware adapter ' +
      'runs it.'
  }
}
