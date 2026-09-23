import { describe, expect, it } from 'vitest'
import { WebGL2Backend } from '../../src/renderer/webgl2/backend'
import { compileShader } from '../../src/renderer/webgl2/context'
import type { DeviceLost, RenderableSource } from '../../src/renderer/backend'
import type { CameraState } from '../../src/core/types'

/*
 * The WebGL2 backend's own smoke tests -- not the gates, which are about the
 * shaders agreeing, and not the user stories, which are about what a user sees.
 * These are about the backend as an object: does it get a context, does it
 * refuse to construct when the shader will not compile, does it release the
 * context it took, and does it survive a loss.
 *
 * Everything is imported directly. Browser mode runs this file inside the page,
 * so there is no bridge, no page-side export, and no `window.__panoTest`: the
 * backend under test and the test are in one module system.
 *
 * This file runs in the `integration` project, which has a real WebGPU adapter.
 * That is fine and deliberate -- WebGL2 works there too, and running the
 * backend's own tests next to the WebGPU ones keeps the fallback from being
 * tested only in the environment where the primary path is absent.
 */

/** The pose every case uses. Its values are irrelevant; its presence is not. */
const ORIGIN: CameraState = { povLatitude: 0, povLongitude: 0 }

/** A 2x2 canvas in two horizontal color bands, as an image element: pixels known without a fixture file. */
async function twoToneSource (): Promise<RenderableSource> {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const ctx = canvas.getContext('2d')!
  // Horizontal bands, not a quadrant checkerboard: each column of a
  // 2-pixel-wide equirectangular texture spans 180 degrees of longitude, so a
  // 75-degree view from any longitude sees one column only and a quadrant
  // board renders solid. The row boundary sits on the equator -- where a
  // latitude-zero camera looks -- so both colors land in every frame it draws.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 2, 2)
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 2, 1)

  // A real <img>, not a bitmap: RenderableSource.element is typed
  // HTMLImageElement | HTMLVideoElement, and a backend uploads it through
  // texImage2D. Casting a bitmap in would typecheck only by lying about the
  // type, and the lie would be discovered by whichever backend later reads a
  // property the bitmap does not have.
  const image = new Image()
  image.src = canvas.toDataURL('image/png')
  await image.decode()

  return {
    state: { projection: 'equirectangular', width: 2, height: 2 },
    kind: 'image',
    element: image,
    version: 1
  }
}

/** Reads the framebuffer through the canvas's own context. */
function readGl (canvas: HTMLCanvasElement): number[] {
  const gl = canvas.getContext('webgl2')!
  const pixels = new Uint8Array(canvas.width * canvas.height * 4)
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return Array.from(pixels)
}

/** How much of the buffer is not black, 0..1. */
function nonBlackFraction (pixels: readonly number[]): number {
  let lit = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i]! > 0 || pixels[i + 1]! > 0 || pixels[i + 2]! > 0) lit++
  }
  return lit / (pixels.length / 4)
}

describe('WebGL2Backend', () => {
  it('renders a non-empty frame', async () => {
    const canvas = document.createElement('canvas')
    const backend = WebGL2Backend.create(canvas)
    expect(backend, 'WebGL2Backend.create returned null in a browser that has WebGL2').not.toBeNull()

    backend!.resize(64, 64, 1)
    // Radians, not degrees: `Projection.fov` is documented in radians (P2's
    // legacyFovFrom; see src/viewer/camera-controller.ts), and the plan's
    // literal `fov: 75` handed the matrix 75 radians -- a deterministic but
    // nonsensical camera whose vertical span was +-11 degrees and vertically
    // mirrored, too narrow for the both-colors assertion below to ever fire.
    backend!.setCamera(ORIGIN, { kind: 'linear', fov: (75 * Math.PI) / 180, aspect: 1 })
    backend!.setSource(await twoToneSource())
    backend!.render()

    const pixels = readGl(canvas)
    const capabilities = backend!.capabilities
    backend!.dispose()

    // Not `toBe(gl.MAX_TEXTURE_SIZE)`: the reported value goes through
    // describeCapabilities, which clamps it into [2048, 16384] because a
    // software adapter can report 0 and make every source look oversized.
    expect(capabilities.maxTextureDimension).toBeGreaterThanOrEqual(2048)
    expect(capabilities.externalTextures).toBe(false)
    expect(nonBlackFraction(pixels)).toBeGreaterThan(0.5)

    // Both colors have to appear, not merely any non-black pixel: a
    // constant-UV fallback painting one texel over the whole frame would score
    // 1.0 on the fraction too. White carries green; red does not.
    let sawWhite = false
    let sawRed = false
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 1]! > 200) sawWhite = true
      if (pixels[i]! > 200 && pixels[i + 1]! < 64) sawRed = true
    }
    expect(sawWhite).toBe(true)
    expect(sawRed).toBe(true)
  })

  it('throws rather than yielding a dead backend when the shader will not compile', () => {
    // The legacy path returned null here and the viewer reported success. A
    // viewer that cannot render is not a viewer, so the failure has to be loud
    // and it has to happen where the shader is compiled.
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')!
    expect(() => {
      compileShader(gl, gl.FRAGMENT_SHADER, 'void main(){ this is not glsl }', 'fragment')
    }).toThrow(/failed to compile/i)
  })

  it('repeated create/dispose does not exhaust the context limit', () => {
    // Browsers cap live WebGL contexts (commonly at 16). WEBGL_lose_context is
    // what releases one immediately; without it, the 17th viewer silently fails
    // and the only symptom is a viewer that draws nothing.
    const failures: number[] = []
    for (let i = 0; i < 20; i++) {
      const canvas = document.createElement('canvas')
      const backend = WebGL2Backend.create(canvas)
      if (backend === null) { failures.push(i); continue }
      backend.dispose()
    }
    expect(failures).toEqual([])
  })

  it('a lost context is reported, and a restored one draws again', async () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const backend = WebGL2Backend.create(canvas)
    expect(backend).not.toBeNull()

    const lost: DeviceLost[] = []
    const unsubscribe = backend!.onDeviceLost(l => lost.push(l))

    backend!.resize(32, 32, 1)
    backend!.setCamera(ORIGIN, { kind: 'linear', fov: (75 * Math.PI) / 180, aspect: 1 })
    backend!.setSource(await twoToneSource())
    backend!.render()
    const before = nonBlackFraction(readGl(canvas))

    // A synthetic loss, dispatched by hand so preventDefault() and the report
    // can be asked about directly. It has to come after `before`: render() is a
    // deliberate no-op while the backend is lost, so a draw after this point
    // would read black regardless of the restore path.
    const synthetic = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(synthetic)
    // Asserted here, not after the restore: the handler runs synchronously
    // under dispatchEvent, and a deleted preventDefault would otherwise die by
    // the restore await timing out rather than by these assertions naming it.
    expect(synthetic.defaultPrevented).toBe(true)
    expect(lost[0]?.reason).toBe('context-lost')

    const restored = new Promise<void>(resolve => {
      canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true })
    })

    const gl = canvas.getContext('webgl2')!
    // Taken while the context is alive and kept: a lost context returns null
    // from getExtension(), so restoreContext() later has to go through the
    // object taken before the loss.
    const lose = gl.getExtension('WEBGL_lose_context')!
    // Waiting for the loss event itself, not for a timer: a timer only proves
    // that time passed. The once listener is registered after the synthetic
    // dispatch, so only the real loss can settle it.
    const realLoss = new Promise<void>(resolve => {
      canvas.addEventListener('webglcontextlost', () => resolve(), { once: true })
    })
    lose.loseContext()
    await realLoss
    // The synthetic dispatch, then the real loss: two reports, not one.
    const lostCount = lost.length

    // setSource inside the loss window must be a silent no-op, not an error.
    // The null first, as the viewer clearing its source mid-loss: that is what
    // makes the second call reach the allocation line, which it otherwise
    // never would (the first upload left a texture behind, and only
    // #onContextRestored drops it).
    //
    // Honest about what this can pin: the WebGL spec allows createTexture()
    // to return null on a lost context, and the backend's guard is what keeps
    // that from being an allocation error thrown on every frame of the window.
    // THIS Chromium returns a live object instead (measured: both with the
    // loss preventDefaulted and without), so here the unguarded path is a
    // silent no-op chain and this assertion passes either way -- it pins the
    // contract for spec-conforming browsers, not a difference observable on
    // this one. The upload belongs to the frame after the restore, where
    // #onContextRestored has dropped the texture and the next setSource
    // re-uploads whatever source the viewer hands over.
    backend!.setSource(null)
    const duringLoss = await twoToneSource()
    expect(() => backend!.setSource(duringLoss)).not.toThrow()

    lose.restoreContext()
    await restored

    // A second source object, because the first one's element was released --
    // which is the documented setSource contract, and the reason a restore
    // cannot redraw on its own. See the non-goals.
    backend!.setCamera(ORIGIN, { kind: 'linear', fov: (75 * Math.PI) / 180, aspect: 1 })
    backend!.setSource(await twoToneSource())
    backend!.render()
    const after = nonBlackFraction(readGl(canvas))

    unsubscribe()
    backend!.dispose()
    canvas.remove()

    // The synthetic dispatch, then the real loss: two reports, not one.
    expect(lostCount).toBe(2)
    expect(before).toBeGreaterThan(0.5)
    expect(after).toBeGreaterThan(0.5)
  })
})
