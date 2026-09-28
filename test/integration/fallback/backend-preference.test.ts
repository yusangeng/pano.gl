import { describe, expect, it } from 'vitest'
import { FramelessImageViewer, FramelessVideoViewer } from '../../../src/index'
import { makeContainer } from '../support/dom'

/*
 * The forced-'webgpu' rejections, in the project that exists to hold
 * them: --disable-gpu took the WebGPU adapter away (this project's setup
 * asserts it), so 'webgpu' is a request this environment genuinely cannot
 * honour while WebGL2 still answers. (A forced-'webgl2' rejection cannot
 * happen here -- WebGL2 answers -- which is why that half lives in the node
 * unit project instead.) The real-GPU twin
 * (test/integration/backend-preference.test.ts) holds the success half.
 */
describe('forced backend preference without WebGPU', () => {
  it("forcing 'webgpu' rejects, naming the requested backend", async () => {
    // The message is the contract: a caller deciding what to do about a
    // machine without the requested backend has to be told WHICH backend
    // failed, or 'auto' and 'webgpu' failures are indistinguishable.
    await expect(FramelessImageViewer.create({
      container: makeContainer(),
      src: '/fixtures/panorama.png',
      backend: 'webgpu'
    })).rejects.toThrow(/backend 'webgpu' was requested/i)
  })

  it('the default still falls back to WebGL2 rather than rejecting', async () => {
    // The control for the test above: strictness belongs to the explicit
    // request. A caller who passed nothing keeps the fallback the library
    // has always performed -- the compatibility red line of spec §2.
    const viewer = await FramelessImageViewer.create({
      container: makeContainer(),
      src: '/fixtures/panorama.png'
    })
    const backend = viewer.capabilities.backend
    viewer.dispose()
    expect(backend).toBe('webgl2')
  })

  it("forcing 'webgpu' on the video viewer rejects, naming the requested backend", async () => {
    // The image rejection above covers one entry point; the video entry has
    // its own threading to lose, and this is the project where losing it
    // shows: without the forced value the default would fall back to WebGL2
    // and create would RESOLVE. The rejection fires in createBackend, before
    // any media loads, so the fixture path is only a valid-looking string.
    await expect(FramelessVideoViewer.create({
      container: makeContainer(),
      src: '/fixtures/clip.mp4',
      backend: 'webgpu'
    })).rejects.toThrow(/backend 'webgpu' was requested/i)
  })
})
