import { expect, test } from 'vitest'
import { countNonBlack, nextFrames, readCanvas } from './support/canvas'

test('the browser has a real WebGPU adapter', async () => {
  // Non-null: require-webgpu.ts already asserted it. This test's job is to
  // report WHICH adapter, so a machine slipping to a software rasteriser is
  // visible in the log rather than inferred from pixel tolerances later --
  // under a reporter that shows stdout. Vitest's default reporter swallows
  // console.log from passing tests (measured, Task 8 quality review); the
  // CI job (Task 9) is what makes this line visible on every run.
  const adapter = await navigator.gpu!.requestAdapter()
  // GPUAdapterInfo's fields are prototype getters on Chromium (measured on
  // 153 / playwright 1.63): JSON.stringify sees no own enumerable properties
  // and prints "{}", which would eat exactly the signal this log exists to
  // surface.
  console.log('adapter:', adapter!.info.vendor, adapter!.info.architecture)
  expect(
    adapter!.info.vendor,
    'a machine slipping to a software rasteriser must be visible here, not inferred from tolerances later'
  ).toBeTruthy()
})

test('a WebGPU canvas reads back as RGBA, after frames have passed', async () => {
  /*
   * The whole chain in one test: a real device, a canvas configured the way
   * P3's backend will configure it, one frame drawn, and pixels read out of
   * it after the frame boundary. Every later phase asserts on pixels, so if
   * any link here is broken the failures show up there as renderer bugs.
   *
   * `rgba8unorm`, not getPreferredCanvasFormat(). That returns bgra8unorm on
   * macOS, so a canvas whose format follows the host makes every pixel
   * assertion platform-dependent -- which is why the backend pins the format
   * instead (P3) and why this test pins the same one.
   */
  const adapter = await navigator.gpu!.requestAdapter()
  const device = await adapter!.requestDevice()

  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('webgpu')
  expect(ctx, 'no webgpu context on a canvas in a project with a real adapter').not.toBeNull()
  ctx!.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque' })

  const module = device.createShaderModule({
    code: `
      @vertex
      fn vs (@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        return vec4f(p[i], 0.0, 1.0);
      }

      @fragment
      fn fs () -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }
    `
  })
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' }
  })

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx!.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  })
  pass.setPipeline(pipeline)
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])

  // Two frames, not one. The canvas is only presented after the submit has
  // been through the compositor, and reading inside the drawing task would
  // pass even if nothing were ever presented.
  await nextFrames(2)

  const image = await readCanvas(canvas)
  expect(countNonBlack(image), 'the canvas read back empty').toBe(image.width * image.height)

  // Red, not blue. This is the assertion that catches a channel swap, and it
  // is the reason nothing in this repo reorders bytes: getImageData converts
  // to RGBA on the way out, so a `bgraToRgba`-shaped helper would turn a
  // correct readback into a wrong one -- and, applied to both sides of a
  // comparison, would keep passing while doing it.
  expect(Array.from(image.data.slice(0, 4))).toEqual([255, 0, 0, 255])
})
