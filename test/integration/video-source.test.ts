import { describe, it, expect } from 'vitest'
import { VideoSource } from '../../src/media/video-source'
import type { MediaEvents } from '../../src/media/source'

/*
 * Direct, like the image tests: this file is in the page, so a video source is
 * just a class. Nothing here needed a GPU either -- what it needed was a real
 * `<video>`, and running in a browser supplies that for free.
 */

/** Waits for one named event, or gives up. Every test below needs this. */
function once (src: VideoSource, name: 'media-load' | 'media-pause' | 'media-play' | 'media-seeked' | 'media-ended' | 'media-error' | 'media-progress'): Promise<void> {
  return new Promise(resolve => {
    const off = src.on(name, () => { off(); resolve() })
  })
}

/** A loaded, ready-to-play source. */
async function loaded (): Promise<VideoSource> {
  const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
  await once(src, 'media-load')
  return src
}

describe('VideoSource', () => {
  it('reports a zero size before metadata loads', () => {
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    expect(src.naturalSize).toEqual({ width: 0, height: 0 })
    expect(() => src.frame).toThrow(/metadata/i)
    src.dispose()
  })

  it('advances the version on media-load', async () => {
    const src = await loaded()
    expect(src.frame.version).toBe(1)
    src.dispose()
  })

  it('scales the upload size to maxTextureDimension', async () => {
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 256 })
    await once(src, 'media-load')
    expect(src.frame.state).toEqual({ projection: 'equirectangular', width: 256, height: 128 })
    src.dispose()
  })

  it('advances the version when the render loop ticks the source', async () => {
    // This is what drives per-frame re-upload. If it does not advance, a playing
    // video renders its first frame forever.
    //
    // The tick comes from the render loop and not from a DOM event, because no
    // event is fine-grained enough -- so that is what the test does. The
    // end-to-end half (a playing video whose drawn pixels actually change) is
    // P5's video user story; this pins the source's side of the contract.
    //
    // `play()` first, and that is not incidental: the tick only advances a video
    // that is actually producing frames. See the paused test below for the other
    // half of that guard.
    const src = await loaded()
    await src.play()

    const a = src.frame.version
    for (let i = 0; i < 3; i++) src.markFramePresented()
    const b = src.frame.version

    src.dispose()
    expect(b).toBeGreaterThan(a)
  })

  it('does not advance a paused video, so the loop can stop', async () => {
    // The other half of the guard, and the one that decides whether a viewer of
    // a paused video burns a full-screen fragment shader at the display's
    // refresh rate for as long as it is alive.
    //
    // The loop draws when the version moves and calls `markFramePresented` from
    // inside a draw, so "advance on every drawn frame" is self-sustaining: draw
    // -> bump -> draw. Nothing in v1 caps that (the legacy MAX_FRAME_RATE = 60
    // is gone), so the video's own state has to be what bounds it.
    const src = await loaded()
    await src.play()
    const paused = once(src, 'media-pause')
    src.pause()
    await paused

    // Read before dispose: dispose pauses the element too, so reading it
    // afterwards would assert teardown instead of the precondition.
    expect(src.element.paused).toBe(true)

    const a = src.frame.version
    for (let i = 0; i < 3; i++) src.markFramePresented()
    const b = src.frame.version

    src.dispose()
    expect(b).toBe(a)
  })

  it('resumes a stopped loop from the play event', async () => {
    // Why `media-play` bumps at all. Once a paused video stops advancing, the
    // loop stops drawing -- and `markFramePresented` is only reachable from
    // inside a draw. So without a bump from the event, a resumed video would
    // need a frame to get a frame: a deadlock whose symptom is "the video never
    // comes back".
    const src = await loaded()
    await src.play()
    const paused = once(src, 'media-pause')
    src.pause()
    await paused
    const stopped = src.frame.version

    // The listener goes on BEFORE play(): `play()` resolves after the event has
    // fired, so a listener attached afterwards would wait for a second play that
    // never comes, and the test would hang instead of failing.
    const played = once(src, 'media-play')
    await src.play()
    await played
    const resumed = src.frame.version

    src.dispose()
    expect(resumed).toBeGreaterThan(stopped)
  })

  it('reaches the screen on a seek while paused', async () => {
    // Same deadlock, different trigger: `media-seeked` is the only event that
    // reports "the displayed frame is now a different one" for a video that is
    // not playing.
    const src = await loaded()
    expect(src.element.paused).toBe(true)
    const before = src.frame.version

    // Halfway rather than a fixed second: the fixture only has to be a few
    // seconds long, and a seek past the end reports the end instead of a new
    // frame.
    const target = src.element.duration / 2
    expect(target).toBeGreaterThan(0)
    const seeked = once(src, 'media-seeked')
    src.element.currentTime = target
    await seeked

    const after = src.frame.version
    src.dispose()
    expect(after).toBeGreaterThan(before)
  })

  it('draws the last frame of a video', async () => {
    // Why `media-ended` bumps too. Once the video ends, `ended` and `paused` are
    // both true, so `markFramePresented` will never advance the version again --
    // and the decoded final frame may not have been drawn yet, because the loop's
    // next tick is what would have drawn it. Without this bump the video visibly
    // stops one frame early, which reads as "the video is fine, it just ends
    // there".
    //
    // The seek to just before the end is what keeps the test fast; it is
    // deliberate that the version is read AFTER the seek has settled, so what the
    // assertion measures is the ending and not the seek.
    const src = await loaded()
    const seeked = once(src, 'media-seeked')
    src.element.currentTime = Math.max(0, src.element.duration - 0.3)
    await seeked

    // `before` is read only after the play event settles, because media-play
    // bumps too and an earlier read would let the play bump satisfy the
    // assertion with media-ended dropped.
    const played = once(src, 'media-play')
    await src.play()
    await played
    const before = src.frame.version

    await once(src, 'media-ended')
    const after = src.frame.version

    src.dispose()
    expect(after).toBeGreaterThan(before)
  })

  it('hands out a fresh frame instead of a cached one', async () => {
    // The hazard: importExternalTexture's result is destroyed when the task that
    // made it ends, and a bind group holding it does NOT keep it alive, so a
    // source that memoised its frame would hand the renderer a value describing a
    // task that is already over.
    //
    // Asserted here as the source-side property that makes the GPU behaviour safe
    // -- no caching. The GPU half (a stale external texture is a validation
    // error) is a backend concern and is pinned by P3's tests.
    const src = await loaded()

    // Identical calls on an unchanged video must still produce two objects: the
    // next draw is what advances the version, so a video that is playing is what
    // this test needs. Playing also keeps `markFramePresented` from short-
    // circuiting on a paused element.
    await src.play()
    const a = src.frame
    const b = src.frame
    src.markFramePresented()
    const c = src.frame
    src.dispose()

    expect(a).not.toBe(b)
    expect(c.version).toBeGreaterThan(a.version)
    expect(a.element).toBe(b.element)
  })

  it('stops the element and removes every listener on dispose', async () => {
    const src = await loaded()
    await src.play()
    expect(src.listenerCount).toBe(10)
    src.dispose()
    expect(src.element.paused).toBe(true)
    expect(src.element.getAttribute('src')).toBe(null)
    expect(src.listenerCount).toBe(0)
  })

  it('leaves no zombie listeners that reach new subscribers', async () => {
    const src = await loaded()
    src.dispose()
    let calls = 0
    src.on('media-progress', () => { calls++ })
    src.element.dispatchEvent(new Event('timeupdate'))
    await new Promise(resolve => { setTimeout(resolve, 200) })
    expect(calls).toBe(0)
  })

  it('re-emits the element error as media-error', async () => {
    const src = new VideoSource('/fixtures/does-not-exist.mp4', { maxTextureDimension: 8192 })
    const evt = await new Promise<MediaEvents['media-error']>(resolve => {
      const off = src.on('media-error', e => { off(); resolve(e) })
    })
    expect(evt.error).toBeInstanceOf(Error)
    expect((evt.error as Error).message).toMatch(/failed to load .*does-not-exist\.mp4$/)
    expect(evt.target).toBe(src)
    src.dispose()
  })
})
