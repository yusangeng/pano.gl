/**
 * A media element wrapped so the renderer can consume it without knowing what
 * kind of element it is.
 *
 * The snapshot design matters for one specific reason: a video frame is only
 * valid inside the task that produced it. WebGPU's `importExternalTexture`
 * is destroyed at the end of the current task and a bind group holding one does
 * NOT keep it alive. So the renderer must never store the source beyond the
 * frame it is drawing, and the type says so -- a frame is a plain snapshot of
 * numbers plus the element reference, not a handle to GPU memory.
 */

import type { Disposable, EventMap } from '../core/events'
import type { RenderableSource } from '../renderer/backend'

/**
 * One frame of a source: core's upload description plus what only a media
 * element can tell you.
 *
 * **This type is `RenderableSource` from `src/renderer/backend.ts`.** It is
 * declared here as an alias, not as a second interface with the same four
 * members, and every source implementation's `frame` getter satisfies it
 * directly. That is what lets `Viewer` hand a frame to `backend.setSource`
 * with no conversion step.
 *
 * An earlier draft declared the four members again. A structurally identical
 * copy compiles -- and then drifts the first time either side gains a field.
 * The drift is invisible until someone swaps a source into a backend, because
 * before that the two types are never compared; a `type` alias makes the
 * comparison happen at the declaration instead.
 *
 * Why the fields are where they are: `state` is `SourceState` from `core/types`,
 * and `core` is DOM-free by construction, so the element and the frame counter
 * cannot live there. What `core` describes is the part every backend needs --
 * how the pixels are laid out and how big the upload is -- and the rest is the
 * DOM layer's.
 */
export type MediaFrame = RenderableSource

/** Events a source re-emits from its underlying element. */
export interface MediaEvents extends EventMap {
  'media-load': { target: unknown }
  'media-error': { target: unknown, error: unknown }
  'media-play': { target: unknown }
  'media-pause': { target: unknown }
  'media-ended': { target: unknown }
  'media-seeking': { target: unknown }
  'media-seeked': { target: unknown }
  'media-progress': { target: unknown }
}

/**
 * A source of pixels.
 *
 * Implementations own their DOM listeners and must remove all of them in
 * `dispose`. The `AbortController` pattern is the intended mechanism.
 */
export interface MediaSource extends Disposable {
  /** The current frame. Valid only for the duration of the current task. */
  readonly frame: MediaFrame
  /**
   * The element's natural size, before any downscaling.
   *
   * Separate from `frame.state.width`/`frame.state.height`, which are the
   * upload size. Interaction needs the display size; the renderer needs the
   * upload size.
   */
  readonly naturalSize: { readonly width: number, readonly height: number }
  /**
   * Subscribes to the events this source re-emits from its element.
   *
   * On the interface rather than only on the implementations: the viewer
   * forwards these to its own consumers, and it holds a `MediaSource`, so a
   * subscription it cannot see through the interface would push it towards a
   * cast or towards knowing the concrete class.
   */
  on<K extends keyof MediaEvents & string> (type: K, fn: (event: MediaEvents[K]) => void): () => void
  /**
   * Tells the source that a frame was just drawn from it.
   *
   * A video's pixels change with no event fine-grained enough to drive an
   * upload: `timeupdate` fires about four times a second, far too coarse for
   * 60fps. So the render loop ticks this after drawing and the version advances.
   *
   * On the interface, not only on `VideoSource`, so the render loop can tick
   * whatever source it holds without asking which kind it is. An image source
   * ignores it: its pixels change exactly once, on `load`, and that is where its
   * version bump lives.
   */
  markFramePresented (): void
}

/**
 * The DOM event names a source re-emits, mapped to the name it re-emits them
 * as. Shared so both implementations stay in step -- the legacy ImageProvider
 * and VideoProvider each carried their own list and they had already drifted.
 */
export const MEDIA_EVENT_MAP: ReadonlyArray<readonly [string, keyof MediaEvents & string]> = [
  ['load', 'media-load'],
  ['error', 'media-error'],
  ['play', 'media-play'],
  ['pause', 'media-pause'],
  ['ended', 'media-ended'],
  ['seeking', 'media-seeking'],
  ['seeked', 'media-seeked'],
  ['progress', 'media-progress']
] as const
