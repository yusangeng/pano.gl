/**
 * The animation frame loop.
 *
 * Two things about this differ from the legacy FrameDriver:
 *
 * 1. It does not redraw unconditionally. The legacy loop ran a full-screen
 *    fragment shader sixty times a second forever, including for a still image
 *    that had not changed since it loaded. Here `shouldDraw` decides, and a
 *    static image renders exactly once.
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
   */
  readonly shouldDraw: () => boolean
  readonly draw: () => void
  /** Called when `draw` throws. The loop keeps running. */
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
    const first = !this.#drewOnce
    if (!first && !this.#options.shouldDraw()) return

    try {
      this.#options.draw()
      this.#drewOnce = true
    } catch (error) {
      // Deliberately swallowed. A device-lost mid-frame would otherwise stop
      // the loop silently, and the canvas would freeze with no event and no
      // further attempt -- the exact failure the legacy code had, where a
      // context loss produced a permanently black canvas.
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
