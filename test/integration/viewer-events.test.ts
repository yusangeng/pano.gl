import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'
import { Viewer } from '../../src/viewer/viewer'
import { ImageSource } from '../../src/media/image-source'
import type { MediaSource } from '../../src/media/source'
import type { DeviceLost } from '../../src/renderer/backend'
import { makeContainer } from './support/dom'
import { nextFrames } from './support/canvas'
import { captureRenderInputs, countDraws } from './support/spies'

/*
 * `Viewer.on`, both arms: a named event and `'*'`.
 *
 * The wildcard arm is worth a runtime test rather than only a type test,
 * because the failure it is exposed to is the one a compiler cannot see. The
 * overload only makes a two-parameter lambda typecheck; whether the call then
 * reaches `EventEmitter`'s wildcard set is a separate fact, decided by the
 * emitter's own `type === '*'` branch at runtime. An overload that compiles and
 * forwards nothing is the characteristic failure here, and every assertion
 * about types would stay green through it.
 *
 * Events are triggered through a real source rather than by reaching into the
 * emitter: `ImageSource` maps DOM `load` and `error` to `media-load` and
 * `media-error`, so both a success and a failure path are available from a
 * fixture that exists and a URL that does not. The alternative -- calling
 * `emit` directly -- would test the emitter and skip the viewer's forwarding,
 * which is the part under test.
 *
 * Same subclass as `dispose-order.test.ts`, for the same reason: `setSource` is
 * protected so that only a subclass can perform the four-part swap, and a test
 * that widened it to public would be the test dictating the API. The helper is
 * duplicated there rather than promoted to `support/`, because the two files
 * want different things from it and a shared one would have to grow options for
 * both.
 */
class SourcedViewer extends Viewer {
  install (source: MediaSource): void { this.setSource(source) }
}

/** A mounted viewer with no source yet, so a caller can subscribe before one lands. */
async function mount (): Promise<SourcedViewer> {
  const container = makeContainer()
  const canvas = document.createElement('canvas')
  const backend = await createBackend(canvas)
  return new SourcedViewer({ container, canvas, camera: undefined, backend })
}

function install (viewer: SourcedViewer, src: string): void {
  viewer.install(new ImageSource(src, {
    maxTextureDimension: viewer.capabilities.maxTextureDimension
  }))
}

afterEach(() => { vi.restoreAllMocks() })

/*
 * Compile-time pins on `Viewer.on`. They are never called -- they exist to be
 * typechecked, by `tsc --noEmit -p test/integration` inside `npm run typecheck`.
 *
 * They are here because this task added a second overload to `on`, and an
 * overload set is exactly the kind of change that can silently widen the arm
 * that was already right. Task 4 freezes the public surface, so a named event
 * whose payload had decayed to `unknown` would stop being a bug and become a
 * contract.
 *
 * Both directions are pinned because they fail differently and neither catches
 * what the other does:
 *
 * - the positive pin breaks if a payload widens to `unknown`;
 * - the negative pin breaks if it widens to `any`, where `event.reason` would
 *   satisfy `string` and the positive pin would go quiet. Only the
 *   `@ts-expect-error` sees that: a directive that is no longer needed is
 *   itself a compile error.
 *
 * The negative pin was checked before being relied on rather than assumed. It
 * holds for a reason worth recording: for a literal event name, the named
 * property wins over `ViewerEvents`' string index signature, so
 * `ViewerEvents['rotate']` is the real payload and not `unknown`. Under a
 * widened key it would become `unknown`, and `unknown` is not assignable to a
 * specific object type either -- so the pin survives that route as well.
 */
function typePins (viewer: Viewer): void {
  // A named event still carries its exact payload. The parameter is annotated
  // with the real type, which is the strongest form of this pin: the declared
  // payload has to be assignable to it, so a payload that widened to `unknown`
  // stops compiling here.
  viewer.on('rotate', (event: { lat: number, lng: number }) => consume(event))
  viewer.on('device-lost', (event: DeviceLost) => consume(event))

  // The wildcard arm takes two parameters, and `type` is a plain `string`
  // rather than the literal `'*'`, so a listener can branch on it. If that ever
  // narrowed, `consume<string>(type)` would fail to compile.
  viewer.on('*', (type, event) => {
    consume<string>(type)
    consume(event)
  })

  // A payload that does not match is still rejected.
  // @ts-expect-error -- 'rotate' carries { lat, lng }, not { nope }
  viewer.on('rotate', (event: { nope: number }) => consume(event))
}

/**
 * Consumes values so a pin can use its parameters without a `void` expression,
 * which this project's lint config rejects. Returns rather than assigns so the
 * callback stays assignable to a `void`-returning listener.
 */
function consume<T> (...values: T[]): number { return values.length }

describe('Viewer.on type pins', () => {
  it('are typechecked, not executed', () => {
    // `typePins` is never called -- it exists to be compiled by
    // `tsc --noEmit -p test/integration`, which `npm run typecheck` runs. This
    // reference keeps it from reading as an unused symbol.
    expect(typeof typePins).toBe('function')
  })
})

describe("Viewer.on('*')", () => {
  it('receives the event type and the payload for a real event', async () => {
    const viewer = await mount()

    const seen: Array<{ type: string, event: unknown }> = []
    viewer.on('*', (type, event) => { seen.push({ type, event }) })

    install(viewer, '/fixtures/panorama.png')
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0))

    // The payload is the viewer's, not the source's: `target` is rewritten on
    // the way through, because an application is handed a viewer and never a
    // source. Asserting the identity rather than the shape is what makes this a
    // check of the whole forward rather than of the emitter alone.
    expect(seen[0]?.type).toBe('media-load')
    expect((seen[0]?.event as { target: unknown }).target).toBe(viewer)
  })

  it('stops receiving once its unsubscribe function has been called', async () => {
    const viewer = await mount()
    const seen: string[] = []
    const off = viewer.on('*', (type) => { seen.push(type) })

    // A named listener that outlives the wildcard. Without it, "the wildcard
    // saw nothing" would also hold for a second event that never fired at all,
    // and the assertion below has to be able to tell those two apart.
    const named: string[] = []
    viewer.on('media-error', () => { named.push('media-error') })

    install(viewer, '/fixtures/panorama.png')
    await vi.waitFor(() => expect(seen).toContain('media-load'))
    off()
    off() // The emitter documents this as safe to call twice.

    const before = seen.length
    install(viewer, '/fixtures/no-such-image.png')

    await vi.waitFor(() => expect(named).toContain('media-error'))
    expect(seen.length, 'the wildcard kept receiving after it unsubscribed').toBe(before)
  })

  it('is told the same payload the named listener is, for the same event', async () => {
    const viewer = await mount()

    const named: unknown[] = []
    const wildcard: unknown[] = []
    viewer.on('media-load', (event) => { named.push(event) })
    viewer.on('*', (type, event) => { if (type === 'media-load') wildcard.push(event) })

    install(viewer, '/fixtures/panorama.png')
    await vi.waitFor(() => expect(named.length).toBeGreaterThan(0))

    expect(wildcard.length).toBeGreaterThan(0)
    // One dispatch, one payload object. Two listeners seeing different objects
    // would mean the re-emit ran twice, which is the shape a duplicated
    // subscription takes.
    expect(wildcard[0]).toBe(named[0])
  })
})

describe('swapping the source', () => {
  it('redraws, even when the new source reports the version the old one ended on', async () => {
    /*
     * The version latch, and the user-visible defect when it is wrong.
     *
     * `version` is the backend's only pixel identity, and every `ImageSource`
     * starts its counter at 0 and bumps it to 1 on load -- so the outgoing
     * source and the incoming one END ON THE SAME NUMBER. `Viewer.setSource`
     * resets `#lastSourceVersion` to -1 precisely so that the new source's
     * first version cannot compare equal to the old one's last; without that,
     * `#sourceChanged` reads the swap as "unchanged", draws nothing, and the
     * canvas keeps showing the previous picture. No error, no event -- the new
     * image simply never appears.
     *
     * Both sources point at the same URL on purpose. The collision needs the
     * two counters to agree, and using one fixture twice is the cheapest way to
     * guarantee it without reaching into either source.
     */
    const draws = countDraws()
    const inputs = captureRenderInputs()
    const viewer = await mount()
    install(viewer, '/fixtures/panorama.png')
    await vi.waitFor(() => expect(draws(), 'nothing was drawn, so a swap cannot be seen').toBeGreaterThan(0))

    // Let the first frames and the resize observer settle, so the delta below
    // can only be the swap: a resize arriving later would dirty the camera and
    // draw on its own, and this test would pass without the latch.
    await nextFrames(3)
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Move the camera off the origin BEFORE the swap. The default pose IS the
    // origin, so "the swap must not move the camera" asserted against a viewer
    // that never moved agrees with the mutant by coincidence -- it would be
    // testing the default, not the swap. Same trap `rotate(20, 30)` closes in
    // `viewer-render-input.test.ts`.
    const settled = draws()
    viewer.rotate(20, 30)
    await vi.waitFor(() => {
      expect(draws(), 'the rotate never reached a frame').toBeGreaterThan(settled)
    })
    // Sampled only once that frame has landed. Taken any earlier, the rotate's
    // own draw would fall inside the delta and the assertion below would pass
    // without the latch.
    const before = draws()

    const loaded = new Promise<void>((resolve) => {
      const off = viewer.on('media-load', () => { off(); resolve() })
    })
    install(viewer, '/fixtures/panorama.png')
    await loaded

    await vi.waitFor(() => {
      expect(draws(), 'the new image was never drawn, so the old one is still on the canvas').toBeGreaterThan(before)
    })
    /*
     * The swap must leave the camera where it was. A `setSource` that reset the
     * pose would put the viewer back at the origin and the new image would still
     * appear -- the wait above is satisfied by any frame at all, and a reset
     * pose dirties the camera and draws one on its own -- so nothing above can
     * see it.
     */
    expect(viewer.cameraOptions.pose, 'the source swap moved the camera').toEqual({ povLatitude: 20, povLongitude: 30 })
    await vi.waitFor(() => {
      expect(inputs.lastCamera()?.state, 'the backend was left on the pre-swap pose')
        .toEqual({ povLatitude: 20, povLongitude: 30 })
    })
    viewer.dispose()
  })
})
