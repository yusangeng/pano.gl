/**
 * A full-screen equirectangular image viewer.
 *
 * @example
 * ```ts
 * const viewer = await FramelessImageViewer.create({
 *   container: document.querySelector('#pano')!,
 *   src: '/panorama.jpg'
 * })
 * viewer.on('media-load', () => console.log('ready'))
 * ```
 */

import { Viewer, type ViewerInit } from './viewer'
import { validateImageOptions, assertSrc, type ImageViewerOptions, type ImageProjection } from './options'
import { createBackend, probe as probeDevice } from './backend-factory'
import { ImageSource } from '../media/image-source'
import type { Backend } from '../renderer/backend'
import type { SelectedCapabilities } from '../renderer/capabilities'

/**
 * Builds `ImageSource` options, leaving out the key the caller did not give.
 *
 * `exactOptionalPropertyTypes` is on, so `ImageSource`'s `projection?:` refuses
 * an explicit `undefined` (TS2379) -- and "the caller omitted the option" is
 * exactly an `undefined`. The two branches are the same thing to `ImageSource`,
 * which defaults to equirectangular: it is the type that refuses, not the
 * behaviour. Building the object here rather than at each call site keeps that
 * reasoning in one place, since both `create` and the `src` setter need it.
 *
 * The alternative fix is widening the option types in `src/media/` to
 * `projection?: TextureProjection | undefined`, which is arguably where it
 * belongs; that file is outside this card's scope.
 */
function imageSourceOptions (
  maxTextureDimension: number,
  projection: ImageProjection | undefined
): { maxTextureDimension: number, projection?: ImageProjection } {
  return projection === undefined
    ? { maxTextureDimension }
    : { maxTextureDimension, projection }
}

export class FramelessImageViewer extends Viewer {
  readonly #options: ImageViewerOptions
  #url: string

  /**
   * @param options - Already validated by `create`.
   * @param source - The initial source, already built for this device.
   * @param init - Container, canvas, camera and backend, assembled by `create`.
   */
  private constructor (options: ImageViewerOptions, source: ImageSource, init: ViewerInit) {
    super(init)
    this.#options = options
    this.#url = options.src
    // Through the base class, which owns the swap: it drops the old
    // subscriptions, disposes the old source and resets the version latch.
    // Doing it here by hand is how the latch gets missed, and a missed latch
    // shows up as "the image never appears" rather than as an error.
    this.setSource(source)
    if (options.PTZ === false) this.PTZ = false
  }

  /**
   * Creates a viewer, or throws.
   *
   * Async because acquiring a GPU device is. Throws rather than returning a
   * viewer that cannot draw: the legacy `createProgram` logged and returned
   * null, and the viewer reported success and rendered nothing forever.
   *
   * Deliberately not a constructor. The spec asks for
   * `new FramelessImageViewer(options)`, and a constructor cannot await the
   * device -- a constructor that returned a promise would type as the class and
   * be a `Promise` at runtime.
   *
   * @throws If the options are invalid, if no backend is available, or if the
   *   shader fails to compile.
   */
  static async create (options: ImageViewerOptions): Promise<FramelessImageViewer> {
    const valid = validateImageOptions(options)
    // The canvas is created here rather than by the caller: a device can only be
    // acquired for a canvas that already exists, and this is the one the backend
    // draws into -- so it is also the one that goes into the DOM.
    const canvas = document.createElement('canvas')

    let backend: Backend | undefined
    let source: ImageSource | undefined
    try {
      backend = await createBackend(canvas)
      source = new ImageSource(
        valid.src,
        imageSourceOptions(backend.capabilities.maxTextureDimension, valid.projection)
      )
      return new FramelessImageViewer(valid, source, {
        container: valid.container,
        canvas,
        camera: valid.camera,
        backend
      })
    } catch (error) {
      // Producers first, then the consumer, then the DOM -- the same order
      // `Viewer.dispose` uses. Without this, a device that was acquired and
      // then failed validation has no owner and nothing releases it.
      source?.dispose()
      backend?.dispose()
      canvas.remove()
      throw error
    }
  }

  /** The current source URL. */
  get src (): string { return this.#url }

  /**
   * Replaces the image.
   *
   * A new source for the same device and the same projection: a source swap is
   * not a reconfiguration, and re-reading the device limit each time would let a
   * viewer that survived a device change render at the wrong size.
   *
   * @throws If `url` is not a non-empty string.
   */
  set src (url: string) {
    this.assertAlive()
    assertSrc(url)
    this.#url = url
    this.setSource(this.#createSource(url))
  }

  #createSource (url: string): ImageSource {
    return new ImageSource(
      url,
      imageSourceOptions(this.capabilities.maxTextureDimension, this.#options.projection)
    )
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
