/*
 * Gate C's tooling: the source all three paths sample, the GLSL half, and the
 * CPU arbiter.
 *
 * Gate C compares TWO HAND-TRANSCRIBED SHADERS, so the thing under test is the
 * shader source, not the backend object. Both halves therefore render offscreen
 * from the same decoded source with the same request: going through two real
 * `Backend`s would add the present/readback timing and give the two halves
 * different input paths (a WebGPU swapchain texture has no readPixels
 * equivalent), and then the comparison would be measuring the harnesses.
 *
 * The WebGPU half is P3's `renderOffscreen`, not a copy of it. The claim is
 * about the SHIPPED shader, so that side has to go through the shipped path.
 */

import { renderOffscreen, maxChannelDiff } from './gpu'
import type { RenderRequest, RenderResult } from './gpu'
import { mat4 } from 'gl-matrix'
import { buildCameraTransform } from '../../../src/core/matrix'
import { cameraProjectionCode, textureProjectionCode } from '../../../src/core/constants'
import { compileShader, linkProgram } from '../../../src/renderer/webgl2/context'
import { PANORAMA_GLSL_FRAGMENT, PANORAMA_GLSL_VERTEX } from '../../../src/renderer/webgl2/shaders'
import { ndcToSurface, project } from '../../../src/core/reference'
import type { CameraState, Projection } from '../../../src/core/types'

/**
 * Gate C renders at 128x128 and that number is not free: WebGPU's
 * copyTextureToBuffer requires bytesPerRow to be a multiple of 256, and
 * 128 * 4 = 512. Change the size and the WebGPU half fails with a validation
 * error that says nothing about the projection formulas.
 */
export const GATE_C_SIZE = 128

/**
 * The source every path in gate C samples.
 *
 * One definition for all three: the WebGPU renderer, the WebGL2 renderer and the
 * CPU reference all take these exact pixels. Two sources with "the same" pattern
 * is how a comparison ends up measuring the difference between two generators.
 *
 * An ImageBitmap because that is what P3's RenderRequest carries -- and because
 * it is a valid TexImageSource, so the GLSL half uploads it with the same
 * `texImage2D` a viewer's <img> goes through.
 *
 * Periodic in u and v on purpose. A ramp running 0..255 across the width has a
 * discontinuity at the seam, and a one-texel filtering difference there shows up
 * as a huge difference that has nothing to do with the projections. Periodic and
 * smooth means a sub-texel UV difference produces a proportionally small colour
 * difference, while the 8-cycle term keeps the image non-constant so a rotation
 * or a scale error cannot hide inside a flat region.
 */
export async function gateSource (): Promise<{ bitmap: ImageBitmap, size: number }> {
  const canvas = document.createElement('canvas')
  canvas.width = GATE_C_SIZE
  canvas.height = GATE_C_SIZE
  const ctx = canvas.getContext('2d')!

  const image = ctx.createImageData(GATE_C_SIZE, GATE_C_SIZE)

  for (let y = 0; y < GATE_C_SIZE; y++) {
    for (let x = 0; x < GATE_C_SIZE; x++) {
      const u = (x + 0.5) / GATE_C_SIZE
      const v = (y + 0.5) / GATE_C_SIZE
      const i = (y * GATE_C_SIZE + x) * 4
      image.data[i] = Math.round(128 + 127 * Math.cos(2 * Math.PI * u))
      image.data[i + 1] = Math.round(128 + 127 * Math.cos(2 * Math.PI * v))
      image.data[i + 2] = Math.round(
        128 + 127 * Math.sin(2 * Math.PI * 8 * u) * Math.sin(2 * Math.PI * 8 * v)
      )
      image.data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  // imageOrientation: 'none' -- the v flip lives in the shader. `createImageBitmap`
  // defaults to 'from-image', which would apply the EXIF orientation and, for a
  // canvas source, land on the opposite convention from the one the GLSL half
  // sets with UNPACK_FLIP_Y_WEBGL = false.
  return { bitmap: await createImageBitmap(canvas, { imageOrientation: 'none' }), size: GATE_C_SIZE }
}

/**
 * Renders one frame through the GLSL shader and reads the pixels back.
 *
 * Same product path as the WebGPU half: the matrix comes from
 * buildCameraTransform with this backend's depth convention, the shader is the
 * shipped one, the source is a real decoded image. Only the swapchain is
 * skipped.
 */
export async function renderOffscreenGLSL (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection, source } = request

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('renderOffscreenGLSL: no WebGL2 context')

  const program = linkProgram(
    gl,
    compileShader(gl, gl.VERTEX_SHADER, PANORAMA_GLSL_VERTEX, 'vertex'),
    compileShader(gl, gl.FRAGMENT_SHADER, PANORAMA_GLSL_FRAGMENT, 'fragment')
  )
  gl.useProgram(program)

  // Computed from the request, NOT read from a Backend: this harness has to be
  // able to disagree with the backend, or it cannot catch the backend being
  // wrong. See the note below.
  const clip = mat4.create()
  const invClip = mat4.create()
  // 'minus-one-to-one', where the WebGPU half passes 'zero-to-one'. This one
  // argument is the whole depth-convention difference between the backends; if
  // both halves were given the same one here, gate C would fail and the failure
  // would have nothing to do with the projection formulas.
  buildCameraTransform(camera, projection, 'minus-one-to-one', clip)
  mat4.invert(invClip, clip)

  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_invClip'), false, invClip)
  gl.uniform1i(gl.getUniformLocation(program, 'u_projKind'), cameraProjectionCode(projection.kind))
  gl.uniform1i(gl.getUniformLocation(program, 'u_texProjKind'), textureProjectionCode('equirectangular'))
  gl.uniform1f(gl.getUniformLocation(program, 'u_povLatitude'), camera.povLatitude)
  gl.uniform1f(gl.getUniformLocation(program, 'u_povLongitude'), camera.povLongitude)
  gl.uniform1f(gl.getUniformLocation(program, 'u_zoom'), projection.kind === 'linear' ? 1 : projection.zoom)
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0)

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // False: the v flip lives in the shader. Doing it here too would cancel it.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  // REPEAT on both axes, exactly as both shipped image paths wrap: the WebGPU
  // still sampler (webgpu/shaders/sampler.ts) and this backend's own image
  // branch (webgl2/backend.ts). CLAMP_TO_EDGE here would make the two halves
  // sample different rows wherever v leaves [0, 1] -- which the non-linear
  // projections' `- lat` term makes happen at any non-zero latitude -- and the
  // comparison would fail for a reason with nothing to do with the formulas.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  const bottomUp = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp)

  // readPixels is bottom-up; the WebGPU half and the CPU reference are both
  // top-down. Flipping here, once, is what makes the three comparable -- a
  // mismatch would look like a completely wrong projection.
  const topDown = new Uint8Array(bottomUp.length)
  const stride = width * 4
  for (let y = 0; y < height; y++) {
    topDown.set(bottomUp.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride)
  }

  gl.deleteTexture(texture)
  gl.deleteProgram(program)

  return { width, height, rgba: topDown }
}

/** Bilinear sample model matching the GPU's: LINEAR with REPEAT on both axes. */
function sample (
  data: Uint8ClampedArray,
  size: number,
  u: number,
  v: number
): [number, number, number] {
  // x - floor(x), which is what a REPEAT sampler does to a coordinate before
  // it interpolates. Clamp-to-edge here would disagree with both GPU halves
  // wherever a projection's v leaves [0, 1] -- at any non-zero latitude the
  // non-linear `- lat` term pushes phi past PI, and the GPUs wrap while a
  // clamping model would pin the edge row.
  const wrap = (x: number): number => {
    const w = x % 1
    return w < 0 ? w + 1 : w
  }
  const x = wrap(u) * size - 0.5
  const y = wrap(v) * size - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0

  const texel = (ix: number, iy: number, channel: number): number => {
    // Modular, not clamped: REPEAT blends the last source column into the
    // first at the seam, which is exactly the boundary behaviour both shipped
    // image paths have (webgpu/shaders/sampler.ts, webgl2/backend.ts).
    const cx = ((ix % size) + size) % size
    const cy = ((iy % size) + size) % size
    return data[(cy * size + cx) * 4 + channel]!
  }

  const mix = (channel: number): number => {
    const top = texel(x0, y0, channel) * (1 - fx) + texel(x0 + 1, y0, channel) * fx
    const bottom = texel(x0, y0 + 1, channel) * (1 - fx) + texel(x0 + 1, y0 + 1, channel) * fx
    return top * (1 - fy) + bottom * fy
  }

  return [mix(0), mix(1), mix(2)]
}

/**
 * Renders one frame on the CPU, in float64.
 *
 * The arbiter. When the two backends disagree, running all three and finding the
 * odd one out is what turns "they differ" into "this one is wrong".
 *
 * It inverts ndc to a surface point itself (ndcToSurface) instead of inverting
 * the float32 camera matrix the shaders use. An arbiter that shares the shaders'
 * precision and their matrix is not an independent opinion -- it would agree
 * with a wrong matrix by construction.
 *
 * Row 0 is the top row, matching both GPU harnesses, and the source is the same
 * pixels: all three paths must differ only in how they compute the projection.
 */
export async function referenceImage (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection, source } = request

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = GATE_C_SIZE
  sourceCanvas.height = GATE_C_SIZE
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0)
  const sourceData = ctx.getImageData(0, 0, GATE_C_SIZE, GATE_C_SIZE).data

  // Only the linear projection is scale-invariant, and for it the extent is
  // unread. The other three carry theirs in the projection itself -- which is
  // what let the geometry subsystem disappear.
  const extent = projection.kind === 'linear' ? ([2, 2] as const) : projection.extent
  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Pixel centres, and ndc y is inverted because ndc +1 is the top row.
      const ndcX = ((x + 0.5) / width) * 2 - 1
      const ndcY = 1 - ((y + 0.5) / height) * 2

      const [sx, sy, sz] = ndcToSurface(ndcX, ndcY, extent)
      // project() returns the UNFLIPPED equirect v (phi / PI -- see toUV in
      // src/core/reference.ts), while both shaders' to_uv sample 1 - phi / PI.
      // The flip is compensated here, once, so the arbiter reads the same
      // texture rows both GPUs read; sampling v raw would mirror the image
      // vertically and disagree on the wrap-antisymmetric channel.
      const { u, v } = project(sx, sy, sz, camera, projection)
      const [r, g, b] = sample(sourceData, GATE_C_SIZE, u, 1 - v)

      const i = (y * width + x) * 4
      rgba[i] = Math.round(r)
      rgba[i + 1] = Math.round(g)
      rgba[i + 2] = Math.round(b)
      rgba[i + 3] = 255
    }
  }

  return { width, height, rgba }
}

/** The worst per-channel difference between two rendered images. */
export interface GateCDiff {
  readonly max: number
  readonly x: number
  readonly y: number
  /** The four channels of each image at (x, y), so a failure is diagnosable. */
  readonly a: readonly number[]
  readonly b: readonly number[]
}

/**
 * Where the worst difference is, and both colours there.
 *
 * The worst VALUE comes from maxChannelDiff, so that "worst channel difference"
 * means one thing across the whole suite; this only locates it, which
 * maxChannelDiff does not report.
 */
function locate (a: ArrayLike<number>, b: ArrayLike<number>, width: number): Omit<GateCDiff, 'max'> {
  let best = 0
  let at = 0
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i]! - b[i]!)
    if (diff > best) { best = diff; at = i }
  }
  const pixel = Math.floor(at / 4)
  return {
    x: pixel % width,
    y: Math.floor(pixel / width),
    a: Array.from({ length: 4 }, (_, c) => a[pixel * 4 + c]!),
    b: Array.from({ length: 4 }, (_, c) => b[pixel * 4 + c]!)
  }
}

/** The full diagnosis for one pair of images. */
function diagnose (a: ArrayLike<number>, b: ArrayLike<number>, width: number): GateCDiff {
  return { max: maxChannelDiff(a, b), ...locate(a, b, width) }
}

/** The request all three paths are given. Identical, including the source pixels. */
export async function gateRequest (camera: CameraState, projection: Projection): Promise<RenderRequest> {
  // One source per call, handed to all three paths. Two sources with "the same"
  // pattern is how a comparison ends up measuring the difference between two
  // generators.
  const { bitmap, size } = await gateSource()
  return {
    width: GATE_C_SIZE,
    height: GATE_C_SIZE,
    camera,
    projection,
    source: bitmap,
    sourceWidth: size,
    sourceHeight: size
  }
}

/**
 * Renders one camera state through both shaders and returns the worst channel
 * difference between them.
 */
export async function renderBothBackends (
  camera: CameraState,
  projection: Projection
): Promise<GateCDiff> {
  const request = await gateRequest(camera, projection)
  const webgpu = await renderOffscreen(request)
  const webgl2 = await renderOffscreenGLSL(request)
  request.source.close()
  return diagnose(webgpu.rgba, webgl2.rgba, GATE_C_SIZE)
}

/**
 * The same two renders, measured against the CPU reference instead.
 *
 * The third opinion that makes a disagreement actionable: when the two backends
 * differ, running this says which of them is wrong. It is also the only thing
 * that can catch a mistake present in BOTH transcriptions -- the one failure
 * mode the A/B comparison is blind to by construction.
 */
export async function compareWithReference (
  camera: CameraState,
  projection: Projection
): Promise<{ webgpu: number, webgl2: number }> {
  const request = await gateRequest(camera, projection)
  const reference = await referenceImage(request)
  const webgpu = await renderOffscreen(request)
  const webgl2 = await renderOffscreenGLSL(request)
  request.source.close()

  return {
    webgpu: maxChannelDiff(reference.rgba, webgpu.rgba),
    webgl2: maxChannelDiff(reference.rgba, webgl2.rgba)
  }
}
