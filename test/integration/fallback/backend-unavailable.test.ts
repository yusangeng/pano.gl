import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FramelessImageViewer } from '../../../src/index'
import { makeContainer } from '../support/dom'

/*
 * Neither backend. This is the one environment that has no real-world
 * equivalent worth reproducing with a launch flag -- a browser that has WebGL2
 * but no WebGPU and refuses to give a context -- so it is masked.
 *
 * It builds on the no-webgpu project rather than replacing it: that project
 * already guarantees the adapter is absent (require-no-webgpu.ts asserts it), so
 * this file only has to take WebGL2 away. Masking both here would mean the
 * project's own guard could stop working and nothing would notice.
 *
 * `getContext` is patched on the prototype and only for 'webgl2'. The mask
 * covers exactly the assumption under test -- WebGL2 absent -- and nothing
 * else: blanking every context type would quietly turn "neither backend" into
 * "a page with almost no canvas capability at all", a stronger premise than
 * the one spec 9.7 asks this file to hold, and one whose extra restrictions
 * no assertion here is watching.
 */

const original = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    if (type === 'webgl2') return null
    return (original as (...args: unknown[]) => unknown).call(this, type, ...rest)
  } as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = original
})

describe('neither backend available', () => {
  it('create() rejects, naming the situation', async () => {
    // Constructing a viewer that can never draw is what the legacy createProgram
    // did: it logged, returned null, and the viewer reported success. A viewer
    // that cannot render is not a viewer.
    const container = makeContainer()
    const canvases = (): number => document.querySelectorAll('canvas').length
    const before = canvases()

    const attempt = async (): Promise<string> => {
      try {
        // `src` is required and validated BEFORE the backend is chosen, so it
        // must be a real URL here: without it the throw would be 'src must be
        // a string' and the assertion below would never see the backend's own
        // message.
        await FramelessImageViewer.create({ container, src: '/fixtures/panorama.png' })
        return ''
      } catch (error) {
        return String(error)
      }
    }

    const first = await attempt()
    // A second attempt, to show the failure is a property of the environment and
    // not of state the first one left behind.
    const second = await attempt()

    expect(first).toMatch(/no usable rendering backend/i)
    expect(second).toMatch(/no usable rendering backend/i)
    // And it did not leave a canvas in the DOM. No viewer-count hook is asserted
    // here: P5 exposes none, and the viewer phase owns that surface -- inventing
    // one from P6 would put a second owner on it.
    expect(canvases()).toBe(before)
  })

  it('probe() reports none rather than throwing', async () => {
    // probe() must be usable to decide what to do BEFORE constructing anything,
    // which means it cannot be the thing that throws.
    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('none')
  })
})
