/**
 * An image source.
 *
 * Uploaded exactly once. `version` starts at 0 and becomes 1 when the image
 * loads, so the renderer's "does this need uploading" question is answered by a
 * number that changes once, rather than by a latched flag that has to be
 * cleared by the consumer.
 */

import { Disposable, EventEmitter } from '../core/events'
import type { TextureProjection } from '../core/constants'
import { MEDIA_EVENT_MAP, type MediaEvents, type MediaSource, type MediaFrame } from './source'
import { planDownscale } from './downscale'

export class ImageSource extends Disposable implements MediaSource {
  readonly #events = new EventEmitter<MediaEvents>()
  readonly #element: HTMLImageElement
  readonly #abort = new AbortController()
  #listenerCount = 0
  #version = 0

  // TextureProjection from core/constants, not a re-typed 'equirectangular'
  // literal: the string becomes the numeric `texProjKind` field of the camera
  // uniform through `textureProjectionCode`, so a second spelling of it here
  // is a second thing to keep in sync.
  readonly #projection: TextureProjection

  /**
   * @param url - Image URL.
   * @param options - Device limit and the source's texture projection.
   */
  constructor (url: string, options: { maxTextureDimension?: number, projection?: TextureProjection } = {}) {
    super()
    this.#element = new Image()
    // Required for reading the image into a WebGPU texture without tainting.
    this.#element.crossOrigin = 'anonymous'
    // 8192 is the WebGPU spec's guaranteed minimum for maxTextureDimension2D,
    // so it is always safe to assume. The viewer passes the real limit.
    this.#maxTextureDimension = options.maxTextureDimension ?? 8192
    this.#projection = options.projection ?? 'equirectangular'

    for (const [domName, eventName] of MEDIA_EVENT_MAP) {
      this.#listen(domName, eventName)
    }

    this.#element.src = url
  }

  readonly #maxTextureDimension: number

  #listen (domName: string, eventName: keyof MediaEvents & string): void {
    this.#listenerCount++
    this.#element.addEventListener(domName, (evt) => {
      // Only `load` bumps the version, because only `load` means the pixels
      // changed -- an image's pixels change exactly once. Bumping on every event
      // would make `error` look like new content, and the render loop's whole
      // dirty check is "has this version moved".
      if (eventName === 'media-load') this.#version++
      this.#events.emit(eventName, {
        target: this,
        error: eventName === 'media-error' ? new Error(`failed to load ${this.#element.src}`) : undefined
      })
    }, { signal: this.#abort.signal })
  }

  /**
   * How many DOM listeners this source currently holds.
   *
   * Public and read-only on purpose: what no other public member shows is
   * the listener bookkeeping (`isDisposed` answers 'did dispose run' but
   * says nothing about the listeners), and the legacy codebase leaked
   * listeners in four files for exactly that reason. The count is zeroed by
   * hand alongside the abort, so it certifies that dispose ran; whether the
   * aborted listeners actually stopped delivering events is a separate
   * fact, pinned by the integration suite's zombie-listener test rather
   * than by this counter.
   */
  get listenerCount (): number {
    return this.#listenerCount
  }

  /** Subscribes to this source's re-emitted media events. */
  on<K extends keyof MediaEvents & string> (type: K, fn: (event: MediaEvents[K]) => void): () => void {
    return this.#events.on(type, fn)
  }

  get naturalSize (): { width: number, height: number } {
    return { width: this.#element.naturalWidth, height: this.#element.naturalHeight }
  }

  get frame (): MediaFrame {
    const { naturalWidth: w, naturalHeight: h } = this.#element
    if (w === 0 || h === 0) {
      // Throwing here rather than returning a 0x0 state keeps the failure at the
      // point of use. A 0x0 texture is a WebGPU validation error that surfaces
      // during texture creation, with nothing pointing back to "not loaded yet".
      throw new Error('image source is not loaded yet')
    }
    const plan = planDownscale(w, h, this.#maxTextureDimension)
    return {
      // The backend consumes this field and nothing else -- it is core's
      // SourceState, so `Backend.setSource` takes it without a conversion.
      state: { projection: this.#projection, width: plan.width, height: plan.height },
      kind: 'image',
      element: this.#element,
      version: this.#version
    }
  }

  /** The scale the current source would be uploaded at. 1 when it fits. */
  get uploadScale (): number {
    const { naturalWidth: w, naturalHeight: h } = this.#element
    if (w === 0 || h === 0) return 1
    return planDownscale(w, h, this.#maxTextureDimension).scale
  }

  /**
   * Nothing to do: an image's pixels change exactly once, on `load`, and that is
   * where `#version` is bumped. It exists because `MediaSource` declares it, so
   * the render loop can tick any source without knowing which kind it holds.
   */
  markFramePresented (): void {
    // Intentionally empty. See the TSDoc above.
  }

  override dispose (): void {
    if (this.isDisposed) return
    // One call removes every listener registered with this signal. The legacy
    // providers paired addEventListener/removeEventListener by hand across four
    // files, and three pairs had already come apart.
    this.#abort.abort()
    this.#listenerCount = 0
    this.#events.removeAllListeners()
    // Release the decoded image. Without this, a viewer that swapped sources
    // keeps the previous image's decoded bitmap alive.
    this.#element.src = ''
    super.dispose()
  }
}
