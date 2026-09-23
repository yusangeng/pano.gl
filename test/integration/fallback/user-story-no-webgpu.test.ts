import { describe, expect, it, vi } from 'vitest'
import { FramelessImageViewer } from '../../../src/index'
import { canvasOf, makeContainer } from '../support/dom'
import { countNonBlack, nextFrames, readCanvas } from '../support/canvas'

/*
 * US5: running where WebGPU is unavailable.
 *
 * No mask, no addInitScript, no control group. This file runs in the
 * `no-webgpu` project, which launches Chromium with --disable-gpu, and
 * `require-no-webgpu.ts` asserts in a beforeAll that the adapter really is
 * absent AND that WebGL2 is still there -- so if the flag ever stops taking
 * effect this file fails loudly instead of quietly re-testing the WebGPU path.
 *
 * The environment is the mask. That is why there is no third control test here:
 * a project does not have the failure mode a shim does, because there is no
 * shim to fail. (P5's version of this file asserted the honest pre-P6 outcome,
 * that create() threw. P6 flips it -- see the completion criteria.)
 */
describe('US5: running where WebGPU is unavailable', () => {
  it('probe() reports webgl2 instead of throwing', async () => {
    // probe() must never throw: its whole reason for existing is to be callable
    // before anything is constructed, so that a caller can decide what to do
    // about a machine with no usable backend.
    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('webgl2')
    // `SelectedCapabilities` has a 'none' arm that carries nothing else, so the
    // reads below need the union narrowed. The throw is for the compiler: the
    // line above has already made it unreachable.
    if (caps.backend === 'none') throw new Error('probe() reported no backend')
    // The WebGPU-only capability is dropped along with the label. A backend
    // reporting webgl2 with externalTextures: true sends callers down a path
    // this backend cannot serve.
    expect(caps.externalTextures).toBe(false)
  })

  it('the viewer renders the panorama instead of throwing', async () => {
    // The end-to-end form of the same claim: not "the label says webgl2", but
    // "a 360 photo appears". Before P6 this threw.
    const container = makeContainer()
    // `src` is required at construction (the frozen surface has no src-less
    // viewer), and re-assigning the same URL once the listeners are on is what
    // keeps the load observable: the construction-time load may land before a
    // listener could attach, and the swap through the public setter is a real
    // load either way.
    const viewer = await FramelessImageViewer.create({ container, src: '/fixtures/panorama.png' })
    const losses: unknown[] = []
    viewer.on('device-lost', e => losses.push(e))
    const loaded: string[] = []
    viewer.on('media-load', () => loaded.push('load'))
    viewer.src = '/fixtures/panorama.png'

    await vi.waitFor(() => expect(loaded).toContain('load'), { timeout: 5000 })
    await nextFrames(2)
    const image = await readCanvas(canvasOf(container))
    const backend = viewer.capabilities.backend
    // Pins Task 3's probe fix end to end: probe() (which reads MAX_TEXTURE_SIZE
    // when there is no adapter) and a constructed viewer must report the SAME
    // clamped maxTextureDimension, not just the same backend label. A probe
    // that under-reports would make apps pre-downscale sources the viewer can
    // actually take.
    const probed = await FramelessImageViewer.probe()
    const constructed = viewer.capabilities.maxTextureDimension
    viewer.dispose()

    expect(backend).toBe('webgl2')
    // Same narrowing as test 1: 'none' is the arm with no maxTextureDimension,
    // and probe() answering it here is itself the failure.
    if (probed.backend === 'none') throw new Error('probe() reported no backend')
    expect(constructed).toBe(probed.maxTextureDimension)
    expect(countNonBlack(image)).toBeGreaterThan(0.2 * image.width * image.height)
    // A downgrade is not a device loss, and reporting it as one would make every
    // consumer's error path fire on a page that is working perfectly.
    expect(losses).toHaveLength(0)
  })
})
