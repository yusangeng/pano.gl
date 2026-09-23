import { describe, it, expect } from 'vitest'
import { ImageSource } from '../../src/media/image-source'

/*
 * Runs in a real browser because everything here is a DOM concern: when `load`
 * fires, what `naturalWidth` is before it, whether listeners actually come off.
 *
 * No `page.evaluate` round trip and no page-side export: in vitest's browser
 * mode this file is already in the page. The only thing that used to justify
 * the round trip was that Playwright drove from Node.
 */

describe('ImageSource', () => {
  it('reports a zero size before the image loads, and throws if asked to upload', () => {
    // The failure this pins: a source that has not loaded looks like a 0x0
    // image, and a 0x0 texture is a WebGPU validation error thrown far from the
    // cause.
    //
    // A URL no other test fetches, because "before the image loads" is only
    // observable while decoding is pending: the spec lets an image that is
    // already fully decoded in the session's memory cache complete inside the
    // `src =` assignment itself, and this suite has enough consumers of the
    // plain fixture URL that a warm cache made `naturalSize` read 512x256
    // synchronously -- a green-suite flake, once in a parallel run. A unique
    // query keeps the cache cold for exactly this construction, and changes
    // nothing else about the test.
    const src = new ImageSource(`/fixtures/panorama.png?uncached=${Math.random()}`)
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
    // Exactly 1: the image loads once and only `load` bumps the version. The
    // backend re-uploads when the version moves, so "greater than zero" would
    // let a version that never stops moving pass as healthy.
    expect(frame.version).toBe(1)
    // markFramePresented is a no-op for images: pixels change once, on load.
    // If it bumped the version, every rendered frame would re-upload the
    // image texture.
    src.markFramePresented()
    src.markFramePresented()
    expect(src.frame.version).toBe(1)
    src.dispose()
  })

  it('scales the upload size to maxTextureDimension and reports uploadScale', async () => {
    // The option is the class's only capability wiring: without it the class
    // would hand the backend an oversized state and texture creation would
    // fail with a device validation error -- the exact failure downscale
    // exists to prevent. 512x256 under a 256 limit: scale = min(256/512,
    // 256/256) = 0.5 (a power of two, exact in floating point), so the state
    // is 256x128 and uploadScale is exactly 0.5.
    const src = new ImageSource('/fixtures/panorama.png', { maxTextureDimension: 256 })
    await new Promise<void>(resolve => {
      const off = src.on('media-load', () => { off(); resolve() })
    })
    expect(src.frame.state).toEqual({ projection: 'equirectangular', width: 256, height: 128 })
    expect(src.uploadScale).toBe(0.5)

    // The default path: the same fixture under the 8192 default fits as-is,
    // and a cold source reports 1 rather than throwing.
    const cold = new ImageSource('/fixtures/panorama.png')
    expect(cold.uploadScale).toBe(1)
    cold.dispose()

    const plain = new ImageSource('/fixtures/panorama.png')
    await new Promise<void>(resolve => {
      const off = plain.on('media-load', () => { off(); resolve() })
    })
    expect(plain.uploadScale).toBe(1)
    expect(plain.frame.state).toEqual({ projection: 'equirectangular', width: 512, height: 256 })
    plain.dispose()
    src.dispose()
  })

  it('re-emits the element error as media-error rather than throwing', async () => {
    // A 404 must reach the application as an event carrying the failure as its
    // payload. The legacy provider attached an error listener that only
    // logged, so an application had no way to show "this image failed to
    // load".
    const src = new ImageSource('/fixtures/does-not-exist.png')
    const evt = await new Promise<{ target: unknown, error: unknown }>(resolve => {
      const off = src.on('media-error', payload => { off(); resolve(payload) })
    })
    src.dispose()
    expect(evt.error).toBeInstanceOf(Error)
    // element.src is absolute, so anchor on the path tail rather than the port.
    expect((evt.error as Error).message).toMatch(/failed to load .*does-not-exist\.png$/)
    expect(evt.target).toBe(src)
  })

  it('leaves no zombie listeners that reach new subscribers', async () => {
    // The only public observation point for "abort actually removed the DOM
    // listeners": dispose clears existing subscribers, so the probe subscribes
    // after dispose. A leaked listener (abort removed from dispose) would
    // re-emit into that fresh subscription when the element fires again.
    const src = new ImageSource('/fixtures/panorama.png')
    await new Promise<void>(resolve => {
      const off = src.on('media-load', () => { off(); resolve() })
    })
    const element = src.frame.element
    src.dispose()

    let calls = 0
    src.on('media-load', () => { calls++ })
    element.dispatchEvent(new Event('load'))
    // dispatchEvent is synchronous, but dispose's own src='' queues a task;
    // give it a beat so the count reflects everything the element emits.
    await new Promise(resolve => setTimeout(resolve, 200))
    expect(calls).toBe(0)
  })

  it('releases the decoded image on dispose', async () => {
    // Setting src to '' breaks the request and the browser resets naturalWidth
    // to 0, so a disposed source throws like an unloaded one instead of
    // vending a fully uploadable frame forever.
    const src = new ImageSource('/fixtures/panorama.png')
    await new Promise<void>(resolve => {
      const off = src.on('media-load', () => { off(); resolve() })
    })
    expect(() => src.frame).not.toThrow()
    src.dispose()
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(() => src.frame).toThrow(/not loaded/i)
  })

  it('dispose zeroes the listener count', () => {
    // The hand-maintained count certifies that dispose ran; whether the
    // listeners actually came off is what the zombie test above observes.
    const src = new ImageSource('/fixtures/panorama.png')
    expect(src.listenerCount).toBeGreaterThan(0)
    src.dispose()
    expect(src.listenerCount).toBe(0)
  })
})
