/**
 * Pointer input for a viewer element.
 *
 * Uses Pointer Events rather than separate mouse and touch paths: one code path
 * covers mouse, touch, and pen, and multi-touch comes through as multiple
 * pointer ids rather than a separate `TouchEvent` API.
 *
 * Every listener is registered with a single AbortController, so disposal is
 * one call. The legacy code spread listeners across Delegate, ZoomPlugin,
 * PanPlugin and both providers, and three pairs had already come apart.
 *
 * Two behaviours worth knowing before editing:
 *
 * - `touch-action: none` is set on the element. Pointer Events cannot deliver
 *   reliable multi-touch while the browser is also panning the page, and there
 *   is no way to express "only for this gesture" -- it is all or nothing. This
 *   is a visible side effect on an element the caller owns, so the previous
 *   value is saved and restored on dispose.
 * - `preventDefault()` is NOT called on every handler. With `touch-action` set,
 *   it is unnecessary, and calling it on pointer events can suppress unrelated
 *   behaviour such as focus and text selection.
 */

import { Disposable, EventEmitter, type EventMap } from '../core/events'
import { classifyDrag, classifyPinch, classifyWheel, type SurfaceSize } from './gestures'

export interface InputEvents extends EventMap {
  pan: { deltaX: number, deltaY: number }
  zoom: { delta: number }
}

export class InputController extends Disposable {
  readonly #events = new EventEmitter<InputEvents>()
  readonly #element: HTMLElement
  readonly #abort = new AbortController()
  readonly #previousTouchAction: string
  /** Active pointers, in the order they went down. */
  readonly #pointers = new Map<number, { x: number, y: number }>()
  #previousPinchDistance = 0
  #ptzEnabled = true

  constructor (element: HTMLElement) {
    super()
    this.#element = element
    this.#previousTouchAction = element.style.touchAction
    element.style.touchAction = 'none'

    const signal = this.#abort.signal
    element.addEventListener('pointerdown', this.#onPointerDown, { signal })
    element.addEventListener('pointermove', this.#onPointerMove, { signal })
    element.addEventListener('pointerup', this.#onPointerUp, { signal })
    element.addEventListener('pointercancel', this.#onPointerUp, { signal })
    element.addEventListener('wheel', this.#onWheel, { signal, passive: false })
  }

  /**
   * Enables or disables pan-tilt-zoom.
   *
   * Disabling short-circuits the handlers but leaves the listeners bound, which
   * is the legacy behaviour: rebinding on every toggle would make the toggle
   * itself a source of leaks.
   */
  get PTZ (): boolean { return this.#ptzEnabled }
  set PTZ (value: boolean) { this.#ptzEnabled = value }

  on<K extends keyof InputEvents & string> (type: K, fn: (event: InputEvents[K]) => void): () => void {
    return this.#events.on(type, fn)
  }

  #onPointerDown = (evt: PointerEvent): void => {
    if (!this.#ptzEnabled) return
    // Track before capturing. setPointerCapture throws NotFoundError for a
    // pointer this browser does not consider active -- which is every pointer a
    // synthetic event can name, and the pointer is still tracked in that case:
    // losing the capture only means the gesture no longer survives the pointer
    // leaving the element, which must not abort the gesture itself.
    this.#pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    try {
      this.#element.setPointerCapture(evt.pointerId)
    } catch {
      // Scoped to this one call and deliberately swallowed: see above.
    }
    this.#previousPinchDistance = 0
  }

  #onPointerMove = (evt: PointerEvent): void => {
    if (!this.#ptzEnabled) return
    const previous = this.#pointers.get(evt.pointerId)
    if (!previous) return

    this.#pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })

    if (this.#pointers.size === 1) {
      this.#events.emit('pan', {
        deltaX: evt.clientX - previous.x,
        deltaY: evt.clientY - previous.y
      })
      return
    }

    if (this.#pointers.size === 2) {
      const distance = this.#pinchDistance()
      const delta = classifyPinch(this.#previousPinchDistance, distance)
      this.#previousPinchDistance = distance
      if (delta !== 0) this.#events.emit('zoom', { delta })
    }
  }

  #onPointerUp = (evt: PointerEvent): void => {
    this.#pointers.delete(evt.pointerId)
    this.#previousPinchDistance = 0
    if (this.#element.hasPointerCapture(evt.pointerId)) {
      this.#element.releasePointerCapture(evt.pointerId)
    }
  }

  #onWheel = (evt: WheelEvent): void => {
    if (!this.#ptzEnabled) return
    const delta = classifyWheel(evt)
    if (delta === 0) return
    // preventDefault is called here and only here: without it the page scrolls
    // while the panorama zooms. The listener is registered with `passive: false`
    // because Chromium treats wheel listeners on window, document and body as
    // passive by default, and the host element is caller-owned: the flag is what
    // guarantees preventDefault works whatever the viewer is mounted on.
    evt.preventDefault()
    this.#events.emit('zoom', { delta })
  }

  #pinchDistance (): number {
    const [a, b] = [...this.#pointers.values()]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /** Converts a drag to a rotation. Exposed so the viewer can apply its own scaling. */
  dragToRotation (deltaX: number, deltaY: number, surface: SurfaceSize): { lat: number, lng: number } {
    return classifyDrag({ deltaX, deltaY }, surface)
  }

  override dispose (): void {
    if (this.isDisposed) return
    this.#abort.abort()
    this.#pointers.clear()
    this.#events.removeAllListeners()
    // Restore what the caller's element looked like before we touched it. A
    // viewer that took over touch-action and did not give it back would leave
    // the host page unable to scroll over that element after disposal.
    this.#element.style.touchAction = this.#previousTouchAction
    super.dispose()
  }
}
