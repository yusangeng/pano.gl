import { describe, it, expect } from 'vitest'
import { InputController } from '../../src/interaction/input-controller'
import { WheelDeltaMode } from '../../src/interaction/gestures'

/**
 * A positioned element to drive. Each test makes its own, and the page is torn
 * down between test files, so nothing has to be cleaned up by hand.
 */
function host (style: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const el = document.createElement('div')
  Object.assign(el.style, { width: '400px', height: '300px', position: 'fixed', top: '0px' }, style)
  document.body.appendChild(el)
  return el
}

/** One complete press-drag-release, in page coordinates. */
function drag (el: HTMLElement, from: [number, number], to: [number, number]): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: from[0], clientY: from[1], bubbles: true }))
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: to[0], clientY: to[1], bubbles: true }))
  el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: to[0], clientY: to[1], bubbles: true }))
}

describe('InputController', () => {
  it('pans the camera and emits pan events', () => {
    const el = host()
    const input = new InputController(el)
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    input.on('pan', e => pans.push(e))

    drag(el, [100, 100], [150, 130])
    input.dispose()
    expect(pans).toEqual([{ deltaX: 50, deltaY: 30 }])
  })

  it('with PTZ = false stops the events without unbinding', () => {
    // Toggling must not rebind listeners; rebinding on every toggle is itself a
    // leak source. So the assertion is both "no events" and "re-enabling works".
    const el = host()
    const input = new InputController(el)
    let count = 0
    input.on('pan', () => count++)

    drag(el, [0, 0], [10, 0])
    const afterEnabled = count

    input.PTZ = false
    drag(el, [0, 0], [20, 0])
    const afterDisabled = count

    input.PTZ = true
    drag(el, [0, 0], [30, 0])
    const afterReenabled = count

    input.dispose()
    expect(afterEnabled).toBe(1)
    expect(afterDisabled).toBe(1)
    expect(afterReenabled).toBe(2)
  })

  it('carries wheel constants that still match the real WheelEvent', () => {
    // gestures.ts restates deltaMode's numbers instead of reading the global, so
    // that it stays testable in Node. This is the other half of that trade: the
    // restated values are checked against the browser's.
    expect(WheelDeltaMode.PIXEL).toBe(WheelEvent.DOM_DELTA_PIXEL)
    expect(WheelDeltaMode.LINE).toBe(WheelEvent.DOM_DELTA_LINE)
    expect(WheelDeltaMode.PAGE).toBe(WheelEvent.DOM_DELTA_PAGE)
  })

  it('restores touch-action on dispose', () => {
    // The viewer sets touch-action: none on an element it does not own. Leaving
    // it set would stop the host page from scrolling over that element forever.
    const el = host({ touchAction: 'pan-y' })
    const input = new InputController(el)
    expect(el.style.touchAction).toBe('none')
    input.dispose()
    expect(el.style.touchAction).toBe('pan-y')
  })
})
