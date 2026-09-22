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

  it('turns the wheel into zoom and stops the page scroll', () => {
    const el = host()
    const input = new InputController(el)
    const zooms: number[] = []
    input.on('zoom', e => zooms.push(e.delta))

    let defaultPrevented: boolean | undefined
    el.addEventListener('wheel', e => { defaultPrevented = e.defaultPrevented }, { once: true })
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: WheelDeltaMode.LINE, cancelable: true }))
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, deltaMode: WheelDeltaMode.PIXEL, cancelable: true }))

    input.PTZ = false
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: WheelDeltaMode.LINE, cancelable: true }))
    input.PTZ = true
    input.dispose()

    expect(defaultPrevented).toBe(true)
    expect(zooms.length).toBe(1)
    expect(zooms[0]).toBeCloseTo(0.3, 5)
  })

  it('zooms for a two-finger pinch and does not pan', () => {
    const el = host()
    const input = new InputController(el)
    const zooms: number[] = []
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    input.on('zoom', e => zooms.push(e.delta))
    input.on('pan', e => pans.push(e))

    // Block bodies, not expression bodies: an explicit `: void` annotation on an
    // expression-bodied arrow returning dispatchEvent's boolean is TS2322.
    const down = (id: number, x: number, y: number): void => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, clientX: x, clientY: y, bubbles: true }))
    }
    const move = (id: number, x: number, y: number): void => {
      el.dispatchEvent(new PointerEvent('pointermove', { pointerId: id, clientX: x, clientY: y, bubbles: true }))
    }
    const up = (id: number): void => {
      el.dispatchEvent(new PointerEvent('pointerup', { pointerId: id, bubbles: true }))
    }

    down(1, 100, 150)
    down(2, 300, 150)
    move(1, 0, 150)   // distance 300, gesture start: no delta
    move(2, 400, 150) // distance 400: log(4/3)
    move(2, 200, 150) // distance 200: log(1/2)
    up(1)
    move(2, 250, 170) // one finger left: pan resumes from (200,150)
    up(2)

    // A second gesture must not inherit the first gesture's distance.
    down(3, 100, 150)
    down(4, 120, 150)
    move(3, 80, 150)  // distance 40, gesture start: no delta
    move(4, 140, 150) // distance 60: log(3/2)
    up(3)
    up(4)
    input.dispose()

    expect(pans).toEqual([{ deltaX: 50, deltaY: 20 }])
    expect(zooms.map(z => +z.toFixed(5))).toEqual([0.28768, -0.69315, 0.40547])
  })

  it('ignores pointer moves that are not part of a gesture', () => {
    const el = host()
    const input = new InputController(el)
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    input.on('pan', e => pans.push(e))

    // Hover moves, no button down. Two, not one: the first alone would pass
    // under a mutant that stops returning before tracking, because it throws
    // on the undefined previous position only after polluting the map.
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 10, clientY: 10, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 40, clientY: 30, bubbles: true }))
    drag(el, [100, 100], [150, 130])
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 200, clientY: 160, bubbles: true }))
    input.dispose()
    expect(pans).toEqual([{ deltaX: 50, deltaY: 30 }])
  })

  it('PTZ off mid-gesture stops moves; re-enabling does not resurrect a disabled down', () => {
    // While PTZ is off, moves do not update tracking, so re-enabling resumes
    // from the last TRACKED position: the first enabled move emits the full
    // accumulated displacement, here {20,0} and not {10,0}.
    const el = host()
    const input = new InputController(el)
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    input.on('pan', e => pans.push(e))

    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }))
    input.PTZ = false
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 10, clientY: 0, bubbles: true }))
    input.PTZ = true
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 20, clientY: 0, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }))

    input.PTZ = false
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }))
    input.PTZ = true
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 100, bubbles: true }))
    input.dispose()
    expect(pans).toEqual([{ deltaX: 20, deltaY: 0 }])
  })

  it('ends the gesture on pointercancel and tolerates an unknown pointerup', () => {
    const el = host()
    const input = new InputController(el)
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    input.on('pan', e => pans.push(e))
    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 50, clientY: 0, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 42, bubbles: true }))
    input.dispose()
    expect(pans).toEqual([])
  })

  it('dragToRotation delegates to classifyDrag', () => {
    const el = host()
    const input = new InputController(el)
    const r = input.dragToRotation(100, 50, { width: 1000, height: 500 })
    input.dispose()
    expect(r.lng).toBeCloseTo(-36, 5)
    expect(r.lat).toBeCloseTo(-18, 5)
  })

  it('emits nothing after dispose', () => {
    const el = host()
    const input = new InputController(el)
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    const zooms: number[] = []
    input.on('pan', e => pans.push(e))
    input.on('zoom', e => zooms.push(e.delta))
    input.dispose()
    drag(el, [0, 0], [10, 10])
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: WheelDeltaMode.LINE, cancelable: true }))
    expect(pans).toEqual([])
    expect(zooms).toEqual([])
  })
})
