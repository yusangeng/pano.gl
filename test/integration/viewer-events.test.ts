import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'
import { Viewer } from '../../src/viewer/viewer'
import { ImageSource } from '../../src/media/image-source'
import type { MediaSource } from '../../src/media/source'
import { makeContainer } from './support/dom'

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
