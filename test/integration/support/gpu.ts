/*
 * Helpers for rendering into an offscreen target and reading it back.
 *
 * Offscreen rather than the canvas because reading a canvas back means
 * `copyTextureToBuffer` on the swapchain texture, which is only valid inside the
 * frame that acquired it -- a timing constraint that would make tests flaky for
 * reasons unrelated to what they test. Everything under test is a function from
 * camera plus source to pixels; a texture this helper owns exercises exactly
 * that.
 *
 * The request carries plain data, not packed uniforms, and this calls the real
 * `setCamera`/`setSource`/`render`. A helper that handed the shader a pre-built
 * `invClip` would skip the matrix builder, and the matrix builder is half of
 * what these tests exist to check.
 */

import { WebGPUBackend } from '../../../src/renderer/webgpu/backend'
import type { CameraState, Projection } from '../../../src/core/types'
import type { RenderableSource } from '../../../src/renderer/backend'

/** Everything one offscreen render needs. */
export interface RenderRequest {
  readonly width: number
  readonly height: number
  readonly camera: CameraState
  readonly projection: Projection
  /**
   * The source, already decoded.
   *
   * An `ImageBitmap` rather than raw pixels, so the frame goes through the same
   * `copyExternalImageToTexture` call a viewer makes instead of a shortcut only
   * tests take. It is also a valid `TexImageSource`, so the same helper can
   * serve a WebGL2 backend later with no change.
   */
  readonly source: ImageBitmap
  readonly sourceWidth: number
  readonly sourceHeight: number
}

/** What one offscreen render produced. */
export interface RenderResult {
  readonly width: number
  readonly height: number
  /** RGBA8, top-down, row-major. */
  readonly rgba: Uint8Array
}

/**
 * Renders one frame offscreen and reads the pixels back.
 *
 * The whole product path runs: `setCamera` builds the matrix through
 * `buildCameraTransform`, the shader module is the shipped one, and the source
 * is a real decoded image. The only thing this skips is the swapchain.
 */
export async function renderOffscreen (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection } = request

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const backend = await WebGPUBackend.create(canvas)
  if (!backend) throw new Error('no WebGPU device available')

  const device = backend.device
  const target = device.createTexture({
    label: 'readback',
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
  })

  const source: RenderableSource = {
    state: {
      projection: 'equirectangular',
      width: request.sourceWidth,
      height: request.sourceHeight
    },
    kind: 'image',
    // The cast is forced by a type gap, not a runtime one: production hands the
    // backend an `HTMLImageElement`/`HTMLVideoElement`, which is what
    // `RenderableSource.element` is typed as, while this helper hands it the
    // decoded form. An `ImageBitmap` is exactly the other thing
    // `copyExternalImageToTexture` accepts, and the backend touches nothing
    // element-specific -- the lie is confined to this test helper.
    element: request.source as unknown as HTMLImageElement,
    version: 1
  }

  try {
    backend.setCamera(camera, projection)
    backend.setSource(source)
    backend.render(target.createView())
    const rgba = await readTexture(device, target, width, height)
    return { width, height, rgba }
  } finally {
    target.destroy()
    backend.dispose()
  }
}

/**
 * Copies a texture back to the CPU, top-down, RGBA8.
 *
 * `copyTextureToBuffer` requires `bytesPerRow` to be a multiple of 256, and four
 * bytes per pixel only clears that when the width is a multiple of 64. The 128px
 * fixtures happen to clear it; handling the padding anyway means the next test
 * that renders at some other size does not fail for a reason that reads like a
 * driver bug.
 */
async function readTexture (
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number
): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256
  const buffer = device.createBuffer({
    label: 'readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const encoder = device.createCommandEncoder({ label: 'readback' })
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height })
  device.queue.submit([encoder.finish()])

  await buffer.mapAsync(GPUMapMode.READ)
  const src = new Uint8Array(buffer.getMappedRange())
  // Copied out before `unmap`: the mapped range is only valid until then, and
  // the copy is what makes the de-padding safe.
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = y * bytesPerRow
    out.set(src.subarray(from, from + width * 4), y * width * 4)
  }
  buffer.unmap()
  buffer.destroy()
  return out
}

/*
 * `maxChannelDiff` is NOT defined here -- it is re-exported from ./canvas,
 * where P1 put it.
 *
 * Two definitions of "the worst channel difference" in one support directory is
 * exactly the drift these gates exist to prevent: they would agree today and
 * diverge on the day someone relaxed one of them. The re-export keeps this
 * file's import surface (`{ renderOffscreen, maxChannelDiff }`) intact for
 * the callers that were already written against it.
 */
export { maxChannelDiff } from './canvas'
