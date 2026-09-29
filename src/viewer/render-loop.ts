/**
 * The animation frame loop.
 *
 * Two load-bearing choices:
 *
 * 1. `shouldDraw` decides, so a static image renders exactly once instead of
 *    running a full-screen fragment shader sixty times a second forever.
 *
 * 2. `shouldDraw` is asked BEFORE the frame is drawn. That ordering is a
 *    hard requirement on WebGPU: acquiring the swapchain texture and then not
 *    submitting a command buffer is a validation error. Callers implement
 *    `shouldDraw` so that acquiring happens inside `draw`, after the check.
 */

import { Disposable } from '../core/events'

export interface RenderLoopOptions {
  /** `requestAnimationFrame`. Injected so the loop is testable without a DOM. */
  readonly schedule: (cb: FrameRequestCallback) => number
  /** `cancelAnimationFrame`. */
  readonly cancel: (handle: number) => void
  /**
   * Whether this frame needs drawing. Called once per tick, before `draw`.
   *
   * Implementations should consume their dirty state here, not in `draw`.
   *
   * Throwing from here stops the loop: the call sits outside the `try` that
   * surrounds `draw`, so an exception escaping it means the next frame is never
   * scheduled. Deliberately not caught -- the production implementation is a
   * boolean read plus a call that catches its own failure, so a throw here is
   * a defect in the callback, not a condition to survive. See `onError`.
   */
  readonly shouldDraw: () => boolean
  readonly draw: () => void
  /**
   * Called when `draw` throws. The loop keeps running.
   *
   * The ONE callback failure the loop absorbs, because a `draw` that failed and
   * a `draw` never attempted both leave the canvas unchanged -- a device lost
   * mid-frame would otherwise freeze the canvas with no event and no further
   * attempt.
   *
   * Throwing from `onError` itself stops the loop, on the same path as
   * `shouldDraw`. That asymmetry is intentional: swallowing every callback
   * failure and rescheduling regardless is what makes a broken renderer look
   * like a working one with nothing to draw. A throw here is not silent either
   * -- an exception escaping a `requestAnimationFrame` callback reaches
   * `window.onerror`.
   */
  readonly onError?: (error: unknown) => void
}

export class RenderLoop extends Disposable {
  readonly #options: RenderLoopOptions
  #handle: number | undefined
  #running = false
  #drewOnce = false

  constructor (options: RenderLoopOptions) {
    super()
    this.#options = options
  }

  /** Starts the loop. Harmless if already running. */
  start (): void {
    if (this.#running || this.isDisposed) return
    this.#running = true
    this.#scheduleNext()
  }

  /** Stops the loop, leaving it restartable. */
  stop (): void {
    this.#running = false
    if (this.#handle !== undefined) {
      this.#options.cancel(this.#handle)
      this.#handle = undefined
    }
  }

  #scheduleNext (): void {
    this.#handle = this.#options.schedule(() => {
      this.#handle = undefined
      if (!this.#running) return
      this.#tick()
      if (this.#running) this.#scheduleNext()
    })
  }

  #tick (): void {
    // The first frame draws unconditionally: a loop whose dirty state started
    // false would show nothing at all until the user interacted.
    //
    // shouldDraw is still ASKED on that tick; only its answer is discarded. The
    // call is not without consequence -- implementations consume their dirty
    // flag here, and the camera controller's starts true -- so short-circuiting
    // it would leave the flag set and make the second frame redraw what the
    // first already drew. A still image would render twice, which is the exact
    // thing this loop exists to prevent.
    const first = !this.#drewOnce
    const dirty = this.#options.shouldDraw()
    if (!first && !dirty) return

    try {
      this.#options.draw()
      this.#drewOnce = true
    } catch (error) {
      // Deliberately swallowed: a device lost mid-frame would otherwise freeze
      // the canvas with no event and no further attempt.
      this.#options.onError?.(error)
    }
  }

  /**
   * Stops the loop and marks this object disposed.
   *
   * Deliberately no `if (this.isDisposed) return` guard. `Disposable` makes
   * itself idempotent by installing an OWN no-op `dispose` property on the
   * instance after the first call, and property lookup consults own properties
   * before the prototype chain -- so a second `dispose()` never reaches this
   * override at all. A guard would be unreachable: `isDisposed` can only be
   * true once `super.dispose()` has run, and that same call is what installed
   * the shadow.
   */
  override dispose (): void {
    this.stop()
    super.dispose()
  }
}
