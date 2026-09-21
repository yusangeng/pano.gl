import { describe, it, expect } from 'vitest'
import { ImageSource } from '../../src/media/image-source'

/*
 * Runs in a real browser because everything here is a DOM concern: when `load`
 * fires, what `naturalWidth` is before it, whether listeners actually come off.
 *
 * No `page.evaluate` and no `window.__panoTest`: in vitest's browser mode this
 * file is already in the page. The only thing that used to justify the round
 * trip was that Playwright drove from Node.
 */

describe('ImageSource', () => {
  it('reports a zero size before the image loads, and throws if asked to upload', () => {
    // The failure this pins: a source that has not loaded looks like a 0x0
    // image, and a 0x0 texture is a WebGPU validation error thrown far from the
    // cause.
    const src = new ImageSource('/fixtures/panorama.png')
    expect(src.naturalSize).toEqual({ width: 0, height: 0 })
    expect(() => src.frame).toThrow(/not loaded/i)
    src.dispose()
  })

  it('becomes readable once the image loads', async () => {
    const src = new ImageSource('/fixtures/panorama.png')
    await new Promise<void>(resolve => {
      const off = src.on('media-load', () => { off(); resolve() })
    })

    const frame = src.frame
    expect(frame.kind).toBe('image')
    expect(frame.state.width).toBeGreaterThan(0)
    expect(frame.state.height).toBeGreaterThan(0)
    expect(frame.version).toBeGreaterThan(0)
    src.dispose()
  })

  it('re-emits the element error as media-error rather than throwing', async () => {
    // A 404 must reach the application as an event. The legacy provider attached
    // an error listener that only logged, so an application had no way to show
    // "this image failed to load".
    const src = new ImageSource('/fixtures/does-not-exist.png')
    const outcome = await Promise.race([
      new Promise<string>(resolve => {
        const off = src.on('media-error', () => { off(); resolve('media-error') })
      }),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 5000))
    ])
    src.dispose()
    expect(outcome).toBe('media-error')
  })

  it('dispose aborts every DOM listener', () => {
    // Counted, not asserted by reading the source. The legacy code leaked three
    // listeners across four files precisely because nobody could see the count.
    const src = new ImageSource('/fixtures/panorama.png')
    expect(src.listenerCount).toBeGreaterThan(0)
    src.dispose()
    expect(src.listenerCount).toBe(0)
  })
})
