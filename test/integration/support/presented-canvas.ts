/*
 * A health probe for the one thing the viewer tests do that the gates do not:
 * draw to a canvas that is attached to the DOM.
 *
 * Runner facts behind this module (diagnostic runs 35917328609 and 35919775396,
 * ubuntu + google/swiftshader, 2026-09-24): a WebGPU device on that adapter
 * that renders to a presented canvas's swapchain dies within ~60-250ms of the
 * first draw. `device.lost` then reports reason 'destroyed' with the message
 * "Device was destroyed." although nothing called `destroy()` -- Dawn's label
 * for a death nobody asked for -- and the dead device's canvas never presents,
 * so a `toDataURL` readback sees a fully transparent surface. Offscreen
 * rendering on the same adapter is healthy: the three gates render and compare
 * real pixels every run, and a viewer that configures a presented canvas but
 * never draws (no source attached) keeps its device for the whole run. macOS
 * SwiftShader and real GPUs present fine -- the same red-triangle draw reads
 * back 2048/2048 non-black pixels locally.
 *
 * A viewer-mounting test on such a device fails in ways that look like anything
 * but a lost device: the device-lost observer disposes the viewer and removes
 * the canvas mid-test, so the next assertion sees a detached element, a
 * self-disposed viewer, or an empty readback. Those tests probe first and skip
 * here -- skip, not pass, in the shape of the video-import probe precedent in
 * video-orientation.test.ts.
 *
 * Fail-closed like every probe in this suite, at two layers: a plain 2D
 * canvas controls the readback tool itself before anything GPU-shaped runs,
 * and the offscreen control renders the same red triangle through
 * copyTextureToBuffer, which bypasses presentation. If EITHER reads back
 * empty the probe throws, so the calling test fails honestly instead of
 * skipping its way past a real regression. `unavailable` is only ever
 * reachable with both controls proven healthy.
 */

import type { TestContext } from 'vitest'
import { countNonBlack, nextFrames, readCanvas } from './canvas'

/** What the probe decided about drawing to a presented canvas on this device. */
export type PresentedCanvasVerdict =
  | { readonly kind: 'healthy' }
  | { readonly kind: 'unavailable'; readonly detail: string }

/*
 * One probe per test file. Browser mode gives every file its own iframe, so
 * module state caches per file for free: the first viewer-mounting test pays
 * ~100ms, the rest read the settled verdict.
 */
let probed: Promise<PresentedCanvasVerdict> | undefined

const RED_WGSL = `
  @vertex
  fn vs (@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(p[i], 0.0, 1.0);
  }

  @fragment
  fn fs () -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }
`

/** How many of the control's pixels must be non-black to call the device healthy. */
const CONTROL_MIN = (64 * 8) / 2

async function runProbe (): Promise<PresentedCanvasVerdict> {
  /*
   * Control for the measurement tool itself, before anything GPU-shaped is
   * created: the same readCanvas + countNonBlack pair every verdict below is
   * computed with, exercised on a plain 2D fill no device is involved in.
   * The offscreen control further down proves the DEVICE can render, but it
   * reads through copyTextureToBuffer and never touches readCanvas -- so a
   * toDataURL drift would otherwise read back empty here, call every healthy
   * device `unavailable`, and skip every gated test on a green build. An
   * empty readback HERE means the helper is broken: throw, because a probe
   * whose ruler is bent must fail tests, not excuse them.
   */
  const toolCanvas = document.createElement('canvas')
  toolCanvas.width = 8
  toolCanvas.height = 8
  const toolCtx = toolCanvas.getContext('2d')
  if (toolCtx === null) {
    throw new Error('no 2d context, so the readback helper cannot be controlled')
  }
  toolCtx.fillStyle = 'red'
  toolCtx.fillRect(0, 0, 8, 8)
  const toolImage = await readCanvas(toolCanvas)
  const toolNonBlack = countNonBlack(toolImage)
  if (toolNonBlack < toolImage.width * toolImage.height / 2) {
    throw new Error(
      `the canvas readback helper itself is broken (${toolNonBlack} of ` +
      `${toolImage.width * toolImage.height} non-black from a plain 2D fill); ` +
      'every readback-based verdict would be a lie, so this fails rather than skips'
    )
  }

  /*
   * No adapter is the WebGL2 world (the no-webgpu project asserts exactly
   * this), where the mechanism this probe detects cannot occur: it is specific
   * to WebGPU presentation. Those tests run their WebGL2 course unchanged.
   */
  const adapter = await navigator.gpu?.requestAdapter()
  if (adapter === null || adapter === undefined) return { kind: 'healthy' }
  const device = await adapter.requestDevice()

  let lost: GPUDeviceLostInfo | undefined
  device.lost.then((info) => { lost = info })

  const module = device.createShaderModule({ code: RED_WGSL })
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' }
  })

  /*
   * Control: the same draw into an offscreen rgba8unorm target, read back
   * through copyTextureToBuffer. 64 pixels wide because bytesPerRow must be a
   * multiple of 256 and 64 * 4 bytes is exactly that. This arm never touches a
   * presented surface, so an empty result here indicts the device, not the
   * presentation -- and throws rather than skipping.
   */
  const controlTexture = device.createTexture({
    label: 'presented-canvas-probe-control',
    size: { width: 64, height: 8 },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
  })
  const controlBuffer = device.createBuffer({
    size: 64 * 8 * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })
  const controlEncoder = device.createCommandEncoder()
  const controlPass = controlEncoder.beginRenderPass({
    colorAttachments: [{
      view: controlTexture.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  })
  controlPass.setPipeline(pipeline)
  controlPass.draw(3)
  controlPass.end()
  controlEncoder.copyTextureToBuffer(
    { texture: controlTexture },
    { buffer: controlBuffer, bytesPerRow: 256, rowsPerImage: 8 },
    [64, 8, 1]
  )
  device.queue.submit([controlEncoder.finish()])
  await controlBuffer.mapAsync(GPUMapMode.READ)
  const controlBytes = new Uint8Array(controlBuffer.getMappedRange().slice(0))
  controlBuffer.unmap()
  let controlNonBlack = 0
  for (let i = 0; i < controlBytes.length; i += 4) {
    if (controlBytes[i]! > 0 || controlBytes[i + 1]! > 0 || controlBytes[i + 2]! > 0) controlNonBlack++
  }
  if (controlNonBlack < CONTROL_MIN) {
    throw new Error(
      `the device cannot render offscreen (${controlNonBlack} of 512 control pixels non-black ` +
      `on adapter ${adapter.info.vendor}/${adapter.info.architecture}); ` +
      'this is a device failure, not a presentation failure, and must not be skipped'
    )
  }

  /*
   * Presented arm: an 8x8 canvas appended to the document, configured exactly
   * the way the failing tests' viewers configure theirs (rgba8unorm, opaque),
   * drawn into, given two frames to present, then read back the way every
   * pixel-asserting test reads a canvas.
   */
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  document.body.appendChild(canvas)
  try {
    const ctx = canvas.getContext('webgpu')
    if (ctx === null) throw new Error('no webgpu context for the probe canvas')
    ctx.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque' })

    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store'
      }]
    })
    pass.setPipeline(pipeline)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])

    await nextFrames(2)
    const image = await readCanvas(canvas)
    const nonBlack = countNonBlack(image)
    if (nonBlack >= image.width * image.height / 2 && lost === undefined) {
      return { kind: 'healthy' }
    }

    // The readback is empty or the device is already gone: give the loss a
    // moment to land so the detail can quote it when it does.
    await nextFrames(6)
    const lossPart = lost !== undefined
      ? `; the device was lost ${lost.reason} ("${lost.message}") with no destroy() called`
      : '; the device was still alive at the readback'
    return {
      kind: 'unavailable',
      detail:
        `presented-canvas WebGPU is broken on adapter ${adapter.info.vendor}/${adapter.info.architecture}: ` +
        `a red triangle drawn to a DOM-presented rgba8unorm canvas read back ${nonBlack} of ` +
        `${image.width * image.height} non-black pixels${lossPart}, while the same draw offscreen ` +
        `read back ${controlNonBlack} of 512. The Linux SwiftShader CI adapter kills devices that ` +
        'draw to a presented canvas, and every viewer-mounting test would fail on that cascade.'
    }
  } finally {
    canvas.remove()
    device.destroy()
  }
}

/**
 * Probes whether this device can render to a DOM-presented WebGPU canvas.
 *
 * Cached per test file: the first call runs the probe, later calls reuse it.
 * Never throws for the broken-presentation condition -- that is the
 * `unavailable` verdict -- but does throw if the device cannot render at all
 * offscreen, which is a failure no test should skip past.
 */
export function probePresentedCanvas (): Promise<PresentedCanvasVerdict> {
  probed ??= runProbe()
  return probed
}

/**
 * Skips `ctx` when this device cannot keep a presented-canvas WebGPU device
 * alive, with the measured reason printed and attached to the skip.
 *
 * For viewer-mounting tests: mount first is not an option, because on an
 * affected device the viewer's first draw is what kills it.
 */
export async function skipIfPresentedCanvasBroken (ctx: TestContext): Promise<void> {
  const verdict = await probePresentedCanvas()
  if (verdict.kind === 'unavailable') {
    // Printed as well as handed to `skip`: the verbose reporter shows the
    // note, the default one passes the skip through quietly (same reason as
    // the video-orientation skip).
    console.warn(`presented-canvas: ${verdict.detail}`)
    ctx.skip(verdict.detail)
  }
}
