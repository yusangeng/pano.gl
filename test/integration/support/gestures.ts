/*
 * Real input, because the controller captures the pointer.
 *
 * `InputController` calls `setPointerCapture` in `pointerdown`, and that throws
 * `NotFoundError: No active pointer with the given id is found` for a pointerId
 * the browser does not consider active -- which is every pointerId on a
 * JS-constructed `PointerEvent`, except one.
 *
 * That one exception is why this needs saying out loud: `1` IS the mouse's
 * pointerId in Chromium, so `new PointerEvent('pointerdown', { pointerId: 1 })`
 * silently works and the capture silently takes effect. A test written that way
 * passes by coincidence of the id, and its sibling written with `999` fails with
 * "the image did not change" -- which reads as a broken camera, not a broken
 * test. `userEvent` has no such coincidence to depend on.
 */

import { userEvent } from 'vitest/browser'

/** Element-relative coordinates, which is what `dragAndDrop` positions take. */
export interface DragOptions {
  readonly from: { x: number, y: number }
  readonly to: { x: number, y: number }
}

/**
 * One press, one move, one release -- a pan of exactly `to - from`.
 *
 * Exactly one move matters: the controller accumulates deltas, so a provider
 * that interpolated the drag into several moves would still end at the same
 * place but would not be the same gesture to a test asserting on a single
 * `pan` event. `dragThrough`, below, is that provider, for the tests that
 * want the several-move gesture.
 *
 * Source and target are the same element on purpose. This is a pan, not a
 * drag-and-drop: there is no second element to drop onto, and a different
 * target would make the provider wrap the gesture in DataTransfer events the
 * viewer never listens for.
 */
export async function drag (
  element: Element,
  { from, to }: DragOptions
): Promise<void> {
  await userEvent.dragAndDrop(element, element, {
    sourcePosition: from,
    targetPosition: to
  })
}

/**
 * One press, N held moves, one release -- the multi-move gesture `drag`
 * cannot express.
 *
 * Exists because vitest 5's browser `userEvent` has no `pointer` primitive:
 * `dragAndDrop` is always exactly one move per gesture, and no combination
 * of its other methods presses and then moves. Without a multi-move drag, a
 * pan handler that captured its baseline once per GESTURE instead of once
 * per MOVE is indistinguishable from the correct one -- every single-move
 * test passes under it.
 *
 * The events are synthetic, which this file's header warns about -- but the
 * warning's failure mode does not reach here. `InputController` tracks the
 * pointer in `pointerdown` BEFORE calling `setPointerCapture` and swallows
 * the capture failure by design, so a synthetic pointerId the browser does
 * not consider active still pans; the capture only mattered for a pointer
 * leaving the element mid-gesture, and these moves stay on it. The pointerId
 * deliberately avoids the mouse's, so nothing rides on Chromium's
 * id-1 coincidence. Tests using this helper MUST assert the resulting event
 * count: a delivery regression then fails loudly instead of passing an
 * empty sum.
 *
 * `points` are client coordinates the deltas are taken between: the first is
 * the press, the last is the release, and every one in between is one held
 * move -- one `pan` event each.
 */
export async function dragThrough (
  element: Element,
  points: ReadonlyArray<{ x: number, y: number }>
): Promise<void> {
  const first = points[0]
  if (!first) return
  const base = {
    bubbles: true,
    cancelable: true,
    pointerId: 999,
    pointerType: 'touch',
    isPrimary: true
  }
  const at = (p: { x: number, y: number }, buttons: number): PointerEventInit => ({
    ...base,
    buttons,
    clientX: p.x,
    clientY: p.y
  })
  element.dispatchEvent(new PointerEvent('pointerdown', at(first, 1)))
  for (const point of points.slice(1)) {
    element.dispatchEvent(new PointerEvent('pointermove', at(point, 1)))
  }
  const last = points[points.length - 1]
  if (last) element.dispatchEvent(new PointerEvent('pointerup', at(last, 0)))
}

/**
 * Scrolls over the element.
 *
 * Assert on the DIRECTION of the resulting change, never on the magnitude.
 * `userEvent.wheel` does not deliver the delta it is handed: measured,
 * `{ delta: { y: 200 } }` arrives as `deltaY: 100`, `{ direction: 'down' }` as
 * `50`, `{ direction: 'up' }` as `-50`. A test asserting "zoom went down by the
 * amount I scrolled" is asserting on the provider's scaling factor.
 *
 * Positive `deltaY` is a scroll down, which the controller turns into a
 * negative zoom step -- zoom OUT. That direction matters at the default: zoom
 * is clamped to at most 1, and under the divide contract a negative step
 * computes 1 / (1 - step) > 1, which clamps straight back to the ceiling -- so
 * scrolling DOWN from a fresh viewer is the no-op, and a test written that way
 * asserts nothing. Scrolling up (a positive step, 1 / (1 + step) < 1) is the
 * direction that moves.
 */
export async function wheel (element: Element, deltaY: number): Promise<void> {
  await userEvent.wheel(element, { delta: { y: deltaY } })
}
