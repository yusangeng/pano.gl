/*
 * DIAGNOSTIC ROUND (2026-09-24) -- temporary, delete when the runner-only
 * failures are root-caused.
 *
 * The CI runner (ubuntu, SwiftShader) fails 26 integration tests that all pass
 * on macOS against the same SwiftShader adapter. The artifacts show symptoms
 * ("has been disposed", "no .pano-canvas", empty readbacks) but not causes.
 * This file is the lab: four self-passing probes that print the runner-side
 * facts the three live hypotheses need. It asserts nothing about the facts --
 * a diagnostic that goes red is a diagnostic that takes the other tests'
 * output down with it -- so every probe body is defensive and every result is
 * a log line under this file's name, prefixed `[runner-diagnostics]`.
 *
 * The hypotheses being separated:
 *
 * M1  the image upload path (HTMLImageElement, what src/media/image-source.ts
 *     hands the backend) fails on Linux SwiftShader, where the gates'
 *     ImageBitmap path does not -- the trace console warning
 *     "CopyExternalImageToTexture(): Browser fails extracting valid resource"
 *     points at exactly that call (backend.ts, copyExternalImageToTexture).
 * M2  importExternalTexture from video throws on this adapter (already
 *     established: video-orientation skips on it) -- probe C does not
 *     re-probe it, the video probe-skip extension is a separate commit.
 * M3  a presented raw WebGPU canvas reads back empty through toDataURL on
 *     Linux SwiftShader even when the draw succeeded (smoke's "expected +0 to
 *     be 2048"), which would poison every pixel assertion independently of
 *     M1.
 *
 * Probe B separates M3 from M1 (own pipeline, no library). Probe C separates
 * the upload paths from each other (same device, same texture shape, only the
 * element type differs). Probe D watches a real viewer frame by frame to see
 * WHEN the canvas disappears and what device-lost says.
 */

import { describe, it, vi } from 'vitest'
import { countNonBlack, nextFrames, readCanvas } from './support/canvas'
import { renderOffscreen } from './support/gpu'
import { imageViewer, PROJECTIONS } from './support/viewer'

function report (...parts: unknown[]): void {
  console.log('[runner-diagnostics]', ...parts)
}

function litFraction (image: ImageData): number {
  return countNonBlack(image) / (image.width * image.height)
}

describe('runner diagnostics (temporary, 2026-09-24)', () => {
  it('prints the adapter, device and canvas-format facts', { timeout: 30000 }, async () => {
    try {
      const adapter = await navigator.gpu!.requestAdapter()
      // GPUAdapterInfo's fields are prototype getters on Chromium; printing
      // them one by one, not JSON.stringify (which sees "{}" here).
      report('adapter vendor:', adapter!.info.vendor, 'architecture:', adapter!.info.architecture)
      report('preferred canvas format:', navigator.gpu.getPreferredCanvasFormat())
      report('maxTextureDimension2D:', adapter!.limits.maxTextureDimension2D)

      const device = await adapter!.requestDevice()
      device.lost.then((info) => report('probe-A device.lost:', info.reason, info.message))
      report('probe-A device acquired')
      device.destroy()
    } catch (error) {
      report('probe A threw:', error)
    }
  })

  /*
   * M3 isolation: draw with a pipeline this file owns (no library code, no
   * source texture) onto a presented canvas, then read it back the way every
   * pixel-asserting test does. Runs twice: the library's pinned rgba8unorm
   * and the host's preferred format, so a format-dependent present bug cannot
   * hide behind the pinned one.
   */
  it('reads back a presented raw WebGPU canvas in both canvas formats', { timeout: 30000 }, async () => {
    try {
      const adapter = await navigator.gpu!.requestAdapter()
      const device = await adapter!.requestDevice()
      device.lost.then((info) => report('probe-B device.lost:', info.reason, info.message))

      for (const format of ['rgba8unorm', navigator.gpu.getPreferredCanvasFormat()] as const) {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        document.body.appendChild(canvas)
        const ctx = canvas.getContext('webgpu')
        ctx!.configure({ device, format, alphaMode: 'opaque' })

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
          fragment: { module, entryPoint: 'fs', targets: [{ format }] },
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
        await nextFrames(2)

        const image = await readCanvas(canvas)
        report('probe-B', format, 'nonBlack:', countNonBlack(image), 'of', image.width * image.height,
          'first pixel:', Array.from(image.data.slice(0, 4)))
        canvas.remove()
      }
      device.destroy()
    } catch (error) {
      report('probe B threw:', error)
    }
  })

  /*
   * M1 isolation: the same render request through renderOffscreen twice --
   * once with an ImageBitmap source (the gates' arm, green on the runner) and
   * once with an HTMLImageElement (the production arm via
   * src/media/image-source.ts, suspected on the runner). renderOffscreen runs
   * the backend's own setSource/render, so both arms go through the exact
   * copyExternalImageToTexture call the viewer makes; the only difference is
   * the element type. Readback is copyTextureToBuffer, which bypasses
   * presentation, so this measures the upload alone.
   *
   * A first draft hand-rolled the copy and read the source texture back
   * directly; it read all-zeros on macOS for BOTH element types, which cannot
   * be true while the gates are green -- an unfaithful probe is worse than no
   * probe, so this one rides the gates' proven path instead.
   */
  it('renders the fixture through the backend as ImageBitmap and as HTMLImageElement', { timeout: 30000 }, async () => {
    try {
      const response = await fetch('/fixtures/panorama.png')
      const bitmap = await createImageBitmap(await response.blob())

      // The production element, built the way src/media/image-source.ts
      // builds it: an <img>, anonymous crossOrigin, URL src, decoded.
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = '/fixtures/panorama.png'
      await img.decode()
      report('probe-C fixture decoded: bitmap', bitmap.width + 'x' + bitmap.height,
        'img', img.naturalWidth + 'x' + img.naturalHeight)

      const request = {
        width: 128,
        height: 64,
        camera: { povLatitude: 0, povLongitude: 0 },
        projection: PROJECTIONS.linear,
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
        source: bitmap
      }

      async function nonBlackThrough (source: ImageBitmap, label: string): Promise<void> {
        try {
          const result = await renderOffscreen({ ...request, source })
          let nonBlack = 0
          for (let i = 0; i < result.rgba.length; i += 4) {
            if (result.rgba[i]! > 0 || result.rgba[i + 1]! > 0 || result.rgba[i + 2]! > 0) nonBlack++
          }
          report('probe-C', label, 'nonBlack:', nonBlack, 'of', result.width * result.height)
        } catch (error) {
          report('probe-C', label, 'renderOffscreen threw:', error)
        }
      }

      await nonBlackThrough(bitmap, 'ImageBitmap')
      // Same cast, same reason as the one inside renderOffscreen: the type
      // says ImageBitmap, the runtime accepts both, and the production arm
      // needs the <img> handed over as-is.
      await nonBlackThrough(img as unknown as ImageBitmap, 'HTMLImageElement')
    } catch (error) {
      report('probe C threw:', error)
    }
  })

  /*
   * M1 cascade: the first test of user-story-photo, instrumented instead of
   * asserted. Prints after every stage whether the canvas is still mounted,
   * whether device-lost fired (with its reason), and what a readback sees --
   * so the runner log shows the moment the viewer falls over, not just the
   * assertAlive error the next test sees.
   */
  it('follows a real image viewer through its first frames', { timeout: 30000 }, async () => {
    let viewer: Awaited<ReturnType<typeof imageViewer>>['viewer'] | undefined
    try {
      const mounted = await imageViewer()
      viewer = mounted.viewer
      // capabilities.adapter is GPUAdapterInfo with prototype getters;
      // JSON.stringify sees "{}" (same trap smoke.test.ts documents), so the
      // fields go onto the log one by one.
      report('probe-D after create: backend:', viewer.capabilities.backend,
        'adapter:', viewer.capabilities.adapter?.vendor, viewer.capabilities.adapter?.architecture,
        'externalTextures:', viewer.capabilities.externalTextures)

      const lost: string[] = []
      viewer.on('device-lost', (event) => {
        lost.push(`${event.reason} (${event.message})`)
        report('probe-D device-lost event:', event.reason, event.message)
      })
      const loaded: string[] = []
      viewer.on('media-load', () => loaded.push('media-load'))
      viewer.src = '/fixtures/panorama.png'
      await vi.waitFor(() => { if (!loaded.includes('media-load')) throw new Error('media-load not seen yet') }, { timeout: 5000 })
      report('probe-D media-load fired; canvas mounted:', mounted.container.querySelector('.pano-canvas') !== null)

      const stage = async (label: string, frames: number): Promise<void> => {
        await nextFrames(frames)
        const canvas = mounted.container.querySelector<HTMLCanvasElement>('.pano-canvas')
        if (canvas === null) {
          report('probe-D', label, 'canvas REMOVED; deviceLost:', lost.length > 0 ? lost.join(', ') : 'none')
          return
        }
        const image = await readCanvas(canvas)
        report('probe-D', label, 'litFraction:', litFraction(image), 'deviceLost:',
          lost.length > 0 ? lost.join(', ') : 'none')
      }

      await stage('after +1 frame', 1)
      await stage('after +2 frames', 2)
      await stage('after +20 frames', 20)
    } catch (error) {
      report('probe D threw:', error)
    } finally {
      try { viewer?.dispose() } catch { /* already disposed by a device loss */ }
    }
  })
})
