/**
 * A full-screen equirectangular video viewer.
 *
 * @example
 * ```ts
 * const viewer = await FramelessVideoViewer.create({
 *   container: document.querySelector('#pano')!,
 *   src: '/panorama.mp4',
 *   loop: true
 * })
 * viewer.on('media-ended', () => console.log('done'))
 * ```
 */

import { Viewer, type ViewerInit } from './viewer'
import { validateVideoOptions, assertSrc, type VideoViewerOptions } from './options'
import { createBackend, probe as probeDevice } from './backend-factory'
import { VideoSource, type VideoSourceOptions } from '../media/video-source'
import type { Backend } from '../renderer/backend'
import type { SelectedCapabilities } from '../renderer/capabilities'

/**
 * Builds `VideoSourceOptions`, leaving out the keys the caller did not give.
 *
 * Same reason as `imageSourceOptions` in `image-viewer.ts`: with
 * `exactOptionalPropertyTypes` on, `autoplay?: boolean` and its neighbours
 * refuse an explicit `undefined`, and "the caller omitted the option" is
 * exactly an `undefined`. `VideoSource` supplies its own defaults for all
 * three -- `muted` in particular, which is why it is the one key that is
 * always present.
 */
function videoSourceOptions (
  maxTextureDimension: number,
  options: VideoViewerOptions & { muted: boolean }
): VideoSourceOptions {
  return {
    maxTextureDimension,
    ...(options.projection === undefined ? {} : { projection: options.projection }),
    ...(options.autoplay === undefined ? {} : { autoplay: options.autoplay }),
    ...(options.loop === undefined ? {} : { loop: options.loop }),
    muted: options.muted
  }
}

export class FramelessVideoViewer extends Viewer {
  /** The concrete type, not `MediaSource`: `element` and `play` are not on the interface. */
  #source: VideoSource
  readonly #options: VideoViewerOptions & { muted: boolean }
  #url: string

  private constructor (options: VideoViewerOptions & { muted: boolean }, source: VideoSource, init: ViewerInit) {
    super(init)
    this.#options = options
    this.#source = source
    this.#url = options.src
    this.setSource(source)
    if (options.PTZ === false) this.PTZ = false
  }

  /**
   * Creates a viewer, or throws.
   *
   * Same body as the image viewer, with `validateVideoOptions` and
   * `VideoSource`. Async because acquiring a GPU device is; throws rather than
   * returning a viewer that cannot draw.
   *
   * @throws If the options are invalid, if no backend is available, or if the
   *   shader fails to compile.
   */
  static async create (options: VideoViewerOptions): Promise<FramelessVideoViewer> {
    const valid = validateVideoOptions(options)
    const canvas = document.createElement('canvas')

    let backend: Backend | undefined
    let source: VideoSource | undefined
    try {
      backend = await createBackend(canvas)
      source = new VideoSource(
        valid.src,
        videoSourceOptions(backend.capabilities.maxTextureDimension, valid)
      )
      return new FramelessVideoViewer(valid, source, {
        container: valid.container,
        canvas,
        camera: valid.camera,
        backend
      })
    } catch (error) {
      // Producers first, then the consumer, then the DOM -- the same order
      // `Viewer.dispose` uses.
      source?.dispose()
      backend?.dispose()
      canvas.remove()
      throw error
    }
  }

  /** The current source URL. */
  get src (): string { return this.#url }

  /**
   * Replaces the video.
   *
   * A new source for the same device and the same projection, carrying the
   * options the constructor was given: a source swap is not a reconfiguration.
   *
   * @throws If `url` is not a non-empty string.
   */
  set src (url: string) {
    this.assertAlive()
    assertSrc(url)
    this.#url = url
    const source = this.#createSource(url)
    this.#source = source
    this.setSource(source)
  }

  #createSource (url: string): VideoSource {
    return new VideoSource(
      url,
      videoSourceOptions(this.capabilities.maxTextureDimension, this.#options)
    )
  }

  /**
   * Starts playback.
   *
   * The rejection is passed through rather than swallowed: an unmuted `play()`
   * is refused by the browser's autoplay policy, and a caller that wants to show
   * a "tap to play" affordance has to be able to see that. A caller that does
   * not care writes `void viewer.play()`.
   */
  async play (): Promise<void> {
    this.assertAlive()
    await this.#source.play()
  }

  /** Pauses playback. */
  pause (): void {
    this.assertAlive()
    this.#source.pause()
  }

  /**
   * The `<video>` element.
   *
   * Exposed because the element is where `currentTime`, `duration` and
   * `readyState` live, and because a caller that wants to hand the stream to
   * something else needs it. Media events are re-emitted on the viewer, so this
   * is not the way to listen for them.
   */
  get element (): HTMLVideoElement {
    return this.#source.element
  }

  /**
   * Probes the device without constructing a viewer.
   *
   * The `SelectedCapabilities` return is what makes "ask first, then decide"
   * possible: `{ backend: 'none' }` is an answer, not a thrown error. See the
   * differences table.
   */
  static async probe (): Promise<SelectedCapabilities> {
    return probeDevice()
  }
}
