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
 */

/** One upload path's output: RGBA8, top-down, row-major. */
export interface PathRender {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

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
): Promise<{ external: PathRender, copy: PathRender }> {
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
  draw(pipeline(FRAGMENT_COPY), [
    { binding: 0, resource: copied.createView() },
    { binding: 1, resource: sampler }
  ])
  const copy = await readTarget()

  // A uniform frame is useless as a probe -- the test would pass on a black
  // screen -- and so is one whose top half and bottom half happen to match:
  // "is this upside down" is a question about the top against the bottom, so
  // the frame has to have a top and a bottom to tell apart. Hence the mean of
  // each half rather than "are there two colours in here".
  const halfMean = (from: number, to: number): number => {
    let sum = 0
    let count = 0
    for (let y = from; y < to; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        sum += external[i]! + external[i + 1]! + external[i + 2]!
        count += 3
      }
    }
    return sum / count
  }
  const half = Math.floor(size / 2)
  const top = halfMean(0, half)
  const bottom = halfMean(half, size)
  if (Math.abs(top - bottom) < 8) {
    throw new Error(
      `the fixture frame has no top/bottom contrast (top ${top}, bottom ${bottom}); ` +
      'orientation cannot be judged from it'
    )
  }

  return {
    external: { width: size, height: size, rgba: external },
    copy: { width: size, height: size, rgba: copy }
  }
}
