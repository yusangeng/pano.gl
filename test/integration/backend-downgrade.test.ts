import { afterEach, describe, expect, it, vi } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { canvasOf, makeContainer } from './support/dom'
import { countNonBlack, nextFrames, readCanvas } from './support/canvas'

/*
 * spec section 9.7: "block navigator.gpu and assert that it goes to WebGL2".
 *
 * This file runs in the `integration` project, where a real WebGPU adapter
 * exists -- so removing it here is a real change of state rather than a
 * no-op that would pass either way. That is the whole reason this environment
 * gets its own file and its own project, instead of being folded into the
 * fallback one.
 *
 * The mask is a plain assignment in the test body, not an init script. There is
 * no process boundary in browser mode, so there is no ordering question: the
 * probe reads `navigator.gpu` when it is called, and it is called after this.
 *
 * The downgrade is a programmable state (section 6.5), not a log line, so what
 * is asserted is the reported state -- `probe()` before construction and
 * `viewer.capabilities` after it -- plus the fact that the fallback renders. An
 * application that wants to tell the user "your browser is using the slower
 * renderer" reads it from exactly these two places.
 *
 * There is deliberately no `downgraded` event. The public event surface is
 * frozen (P5, src/index.ts) and a downgrade is a state, not an occurrence: it
 * is true from before the viewer exists, so there is no moment at which it could
 * fire. `device-lost` is the event for a backend that died, which is a different
 * thing and is tested in webgl2-smoke.
 */

const HAD_GPU = 'gpu' in Navigator.prototype

afterEach(() => {
  // Restored explicitly, not left to the next test file's fresh page: tests in
  // one file share a page, so a mask that outlives its test would make every
  // later test in this file run in the wrong environment -- and green.
  if (HAD_GPU) {
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => undefined
    })
  }
})

describe('WebGPU absent, WebGL2 present', () => {
  it('the premise holds: this project really had an adapter to take away', async () => {
    // Without this, a project that had silently stopped providing WebGPU would
    // make everything below pass while measuring nothing.
    expect(HAD_GPU).toBe(true)
    const adapter = await navigator.gpu.requestAdapter()
    expect(adapter, 'the integration project has no adapter, so this file has nothing to remove').not.toBeNull()

    delete (Navigator.prototype as { gpu?: unknown }).gpu
    expect('gpu' in navigator).toBe(false)
  })

  it('probe() reports webgl2 before anything is constructed', async () => {
    // `delete` on the prototype, not an own property set to undefined: the probe
    // tests `'gpu' in navigator`, which stays true for a shadowing property, and
    // the next line would then call requestAdapter() on undefined.
    delete (Navigator.prototype as { gpu?: unknown }).gpu

    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('webgl2')
    // The 'none' arm carries no externalTextures, so the read below needs the
    // union narrowed; the throw is for the compiler, the line above already
    // made it unreachable.
    if (caps.backend === 'none') throw new Error('probe() reported no backend')
    expect(caps.externalTextures).toBe(false)
  })

  it('the viewer renders the panorama instead of throwing', async () => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu

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
    const result = { backend: viewer.capabilities.backend, losses: losses.length }
    viewer.dispose()

    expect(result.backend).toBe('webgl2')
    expect(countNonBlack(image)).toBeGreaterThan(0.2 * image.width * image.height)
    expect(result.losses).toBe(0)
  })
})
