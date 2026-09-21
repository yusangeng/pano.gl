/**
 * A video source.
 *
 * Two things make this the hardest file in the media layer:
 *
 * 1. A video frame is only valid inside the microtask that produced it.
 *    `importExternalTexture` returns a texture the browser destroys as soon as
 *    the task ends. A bind group holding it does not extend its life, and there
 *    is no error until it is used. So the renderer must consume `frame` within
 *    the task it was read in, and this class must never hand out a cached one.
 *
 * 2. There are two upload paths and no `flipY` on the fast one. The slow path
 *    supports flipY; the fast one does not. Since the sampler's v axis runs the
 *    same way for both, and both sources are top-left origin, neither should be
 *    flipped -- but that is an empirical claim, and
 *    `test/integration/video-orientation.test.ts` is what checks it.
 *
 * Neither point produces an option on this class. **Which upload path is used
 * is the backend's decision**, not the source's: the backend is the only thing
 * that has a device, and therefore the only thing that can tell whether
 * `Capabilities.externalTextures` holds. An `uploadPath` option here would be a
 * second vote on a question with one voter -- and the wrong vote would be
 * silent, because both paths render.
 */

import { Disposable, EventEmitter } from '../core/events'
import type { TextureProjection } from '../core/constants'
import { MEDIA_EVENT_MAP, type MediaEvents, type MediaSource, type MediaFrame } from './source'
import { planDownscale } from './downscale'

export interface VideoSourceOptions {
  readonly maxTextureDimension: number
  /** How the video's pixels are laid out. A property of the source, not the camera. */
  readonly projection?: TextureProjection
  /** `autoplay`, `loop`, `muted` -- passed through to the element. */
  readonly autoplay?: boolean
  readonly loop?: boolean
  readonly muted?: boolean
}

export class VideoSource extends Disposable implements MediaSource {
  readonly #events = new EventEmitter<MediaEvents>()
  readonly #element: HTMLVideoElement
  readonly #abort = new AbortController()
  readonly #options: VideoSourceOptions
  #listenerCount = 0
  #version = 0

  constructor (url: string, options: VideoSourceOptions) {
    super()
    this.#options = options
    this.#element = document.createElement('video')
    this.#element.crossOrigin = 'anonymous'
    this.#element.playsInline = true
    if (options.autoplay) this.#element.autoplay = true
    if (options.loop) this.#element.loop = true
    // Muted by default: an unmuted autoplay is blocked by every modern browser,
    // so the legacy default of playing with sound produced a video that simply
    // never started.
    this.#element.muted = options.muted ?? true

    for (const [domName, eventName] of MEDIA_EVENT_MAP) {
      this.#listen(domName, eventName)
    }
    // `loadedmetadata` is what makes naturalWidth/naturalHeight meaningful, and
    // it is not in the shared map because images have no equivalent.
    this.#listen('loadedmetadata', 'media-load')
    this.#listen('timeupdate', 'media-progress')

    this.#element.src = url
  }

  #listen (domName: string, eventName: keyof MediaEvents & string): void {
    this.#listenerCount++
    this.#element.addEventListener(domName, () => {
      // The version advances on the events that change what should be on screen,
      // and NOT on every event. Getting this set wrong is a deadlock rather than
      // a glitch: the render loop only draws when a source's version moved, and
      // `markFramePresented` -- the other thing that moves it -- is only called
      // from inside a draw. A video that changed without bumping here would need
      // a frame to get a frame.
      //
      //   media-load    the first frame exists at all
      //   media-play    un-pauses a stopped loop; see `markFramePresented`
      //   media-seeked  a seek while paused has no other way to reach the screen
      //   media-ended   the last frame, drawn after `paused` has become true
      //
      // Deliberately NOT media-pause or media-progress: pausing changes nothing
      // (the current frame is already drawn), and `timeupdate` fires about four
      // times a second, which is far too coarse to be the thing that drives a
      // video at 60fps.
      if (
        eventName === 'media-load' ||
        eventName === 'media-play' ||
        eventName === 'media-seeked' ||
        eventName === 'media-ended'
      ) {
        this.#version++
      }
      this.#events.emit(eventName, {
        target: this,
        // A failed video load must reach the application as a value it can show,
        // not as a log line. Same reasoning as ImageSource.
        error: eventName === 'media-error' ? new Error(`failed to load ${this.#element.src}`) : undefined
      })
    }, { signal: this.#abort.signal })
  }

  /**
   * Advances the version while the video is actually producing frames.
   *
   * Called by the render loop after each draw, rather than driven by an event:
   * there is no DOM event for "a new frame is ready to sample", and `timeupdate`
   * fires only about four times a second. While the video plays, this is what
   * makes the next frame draw at all.
   *
   * The guard is what keeps a paused video from doing work forever. Without it
   * the version advances on every drawn frame, "drawn" is defined as "the version
   * moved", and the loop therefore redraws a full-screen fragment shader for a
   * video nobody is watching -- at the display's refresh rate, for as long as the
   * viewer is alive. The legacy codebase bounded that with a `MAX_FRAME_RATE = 60`
   * cap on draw calls; v1 has no such cap (a cap is a fixed-rate loop pretending
   * to be a reactive one), so the bound has to come from the video's own state.
   *
   * `ended` and not only `paused`: they are separate properties and `ended`
   * stays true after the last frame. Chromium sets `paused` at the end too
   * (measured), so this term is defensive there; an engine that left `paused`
   * false would otherwise re-upload at the refresh rate.
   *
   * The cost of reading the element here is one property read per drawn frame,
   * and the alternative -- a timer, or a `requestVideoFrameCallback` -- would
   * either poll or add a callback whose lifetime has to be managed alongside the
   * `AbortSignal`.
   */
  markFramePresented (): void {
    if (this.#element.paused || this.#element.ended) return
    this.#version++
  }

  on<K extends keyof MediaEvents & string> (type: K, fn: (event: MediaEvents[K]) => void): () => void {
    return this.#events.on(type, fn)
  }

  /**
   * The underlying element, for lifecycle inspection -- `paused`, current time,
   * and the like.
   *
   * Not the render path's way in: the renderer reads `frame.element`, so that
   * the element always arrives inside the snapshot that also carries `version`
   * and the upload size. Two ways to reach the element would mean two chances to
   * read it outside the task that made it valid.
   */
  get element (): HTMLVideoElement {
    return this.#element
  }

  get naturalSize (): { width: number, height: number } {
    return { width: this.#element.videoWidth, height: this.#element.videoHeight }
  }

  get frame (): MediaFrame {
    const { videoWidth: w, videoHeight: h } = this.#element
    if (w === 0 || h === 0) {
      // `HAVE_NOTHING` reports 0x0; `loadedmetadata` is what changes that.
      // Creating a texture from that is a validation error whose message says
      // nothing about metadata.
      throw new Error('video source metadata has not loaded yet')
    }
    const plan = planDownscale(w, h, this.#options.maxTextureDimension)
    return {
      state: {
        projection: this.#options.projection ?? 'equirectangular',
        width: plan.width,
        height: plan.height
      },
      kind: 'video',
      element: this.#element,
      version: this.#version
    }
  }

  async play (): Promise<void> {
    this.assertAlive()
    await this.#element.play()
  }

  pause (): void {
    this.assertAlive()
    this.#element.pause()
  }

  /**
   * How many DOM listeners this source currently holds.
   *
   * Same reasoning as `ImageSource.listenerCount`: "did dispose remove
   * everything" is otherwise unobservable. This class is the more interesting
   * case of the two, because it binds ten listeners -- the eight DOM event names
   * in the shared `MEDIA_EVENT_MAP`, plus `loadedmetadata` (which is what makes
   * the natural size meaningful and has no image equivalent) and `timeupdate` --
   * and drops every one of them by aborting a single signal.
   */
  get listenerCount (): number {
    return this.#listenerCount
  }

  override dispose (): void {
    if (this.isDisposed) return
    this.#abort.abort()
    this.#listenerCount = 0
    this.#events.removeAllListeners()
    // Stop decoding and release the network. `pause()`, then the `load()`
    // algorithm -- which aborts any in-flight fetch and resets the element.
    this.#element.pause()
    this.#element.removeAttribute('src')
    this.#element.load()
    super.dispose()
  }
}
