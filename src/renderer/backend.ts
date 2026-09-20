/**
 * What the viewer needs from a rendering backend.
 *
 * The interface is deliberately state-in / pixels-out: no matrices are passed
 * as matrices, no depth convention is named, no GPU type appears. A backend is
 * a function from "what should be on screen" to "pixels", and everything that
 * differs between WebGL2 and WebGPU stays behind this line.
 */

import type { CameraState, Projection, SourceState } from '../core/types'

/**
 * A source as a backend sees it.
 *
 * `SourceState` alone is not enough to draw one: it describes the upload -- how
 * the pixels are laid out and how big they are -- and says nothing about where
 * they come from. A backend needs both, so this pairs them. `state` is
 * `SourceState` from `core/types` rather than a re-declared shape, because
 * `core` is the layer both backends already agree on.
 *
 * **This is the definition and `MediaFrame` is an alias to it**, not the other
 * way round. `src/media/source.ts` (P4) writes `export type MediaFrame =
 * RenderableSource`, so there is exactly one declaration of these four members
 * and no conversion anywhere in the path from a loaded `<img>` to a bind group.
 * The renderer layer cannot import from the media layer -- the dependency runs
 * the other way -- so the declaration has to live here, on the consuming side.
 */
export interface RenderableSource {
  /** The upload description: layout and size. */
  readonly state: SourceState
  readonly kind: 'image' | 'video'
  /** Where the pixels come from. Never retained past the current task. */
  readonly element: HTMLImageElement | HTMLVideoElement
  /**
   * Bumped whenever the underlying pixels change.
   *
   * This is how "does the GPU texture need re-uploading" gets answered without
   * the backend subscribing to media events. An image bumps it once, on load; a
   * video bumps it on every frame it presents. It replaces the legacy
   * `needUpdate_` latch, which the *consumer* had to clear -- and "who clears
   * it" is where that kind of flag goes wrong.
   */
  readonly version: number
}

/** What this device can actually do, as opposed to what the API spec allows. */
export interface Capabilities {
  readonly backend: 'webgpu' | 'webgl2'
  /** Adapter description, when the backend can supply one. */
  readonly adapter?: Readonly<Record<string, string>>
  /** `maxTextureDimension2D`, the limit that decides whether a source must be downscaled. */
  readonly maxTextureDimension: number
  /** True when the source can be sampled without a copy. Video only, WebGPU only. */
  readonly externalTextures: boolean
}

/**
 * A rendering backend.
 *
 * Lifecycle: construct, then `resize` before the first `render`, then any number
 * of `setCamera`/`setSource`/`render` calls, then `dispose` exactly once.
 * `dispose` is idempotent.
 */
export interface Backend {
  readonly kind: 'webgpu' | 'webgl2'
  readonly capabilities: Capabilities

  /** Sets the camera pose and projection. Takes effect on the next `render`. */
  setCamera (state: CameraState, projection: Projection): void

  /**
   * Sets the source to sample, or `null` to draw nothing.
   *
   * Called once per frame by the render loop, not once per source: a video's
   * pixels change every frame and the only value that says so is `version`.
   *
   * Implementations must not retain `source.element` beyond the current task --
   * a video frame is invalidated when the task that produced it ends, and a
   * retained reference is a use-after-free rather than a stale frame. Retaining
   * the rest of the object is fine.
   */
  setSource (source: RenderableSource | null): void

  /** Draws one frame. */
  render (): void

  /**
   * Resizes the drawing surface.
   *
   * @param cssWidth - Layout width in CSS pixels.
   * @param cssHeight - Layout height in CSS pixels.
   * @param dpr - Device pixel ratio. The backing store is `cssWidth * dpr` wide.
   */
  resize (cssWidth: number, cssHeight: number, dpr: number): void

  /**
   * Registers a device-loss observer and returns an unsubscribe function.
   *
   * Without this the backend has no channel to report that it died, and the
   * viewer's `device-lost` event can never fire -- a lost device would show up
   * as a canvas that silently stops updating, which is exactly the v0.2.2
   * behaviour the design set out to fix (it handled neither WebGL context loss
   * nor anything else).
   *
   * Registering twice replaces the previous observer; the returned function
   * unregisters only if this call is still the current one, so calling a stale
   * unsubscribe after a re-register is a no-op rather than a surprise removal.
   */
  onDeviceLost (fn: (lost: DeviceLost) => void): () => void

  dispose (): void
}

/**
 * Why a device went away.
 *
 * `reason` is the API's own token -- WebGPU's `GPUDeviceLostReason` string
 * (`'destroyed'`, `'unknown'`) or WebGL2's `'context-lost'`, which WebGL does
 * not otherwise name. `message` is whatever detail the backend could extract;
 * WebGL2 has none, so it supplies a fixed explanatory string rather than an
 * empty one, so that a consumer logging it always gets something actionable.
 *
 * This is also the payload of the viewer's public `device-lost` event, so the
 * internal and external shapes cannot drift.
 */
export interface DeviceLost {
  readonly reason: string
  readonly message: string
}
