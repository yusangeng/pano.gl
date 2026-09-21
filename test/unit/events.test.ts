import { describe, it, expect, vi } from 'vitest'
import { EventEmitter, Disposable } from '../../src/core/events'

interface FakeEvents extends Record<string, unknown> {
  ping: { n: number }
  pong: { s: string }
}

class Emitter extends EventEmitter<FakeEvents> {
  firePing (n: number): void { this.emit('ping', { n }) }
}

describe('EventEmitter', () => {
  it('delivers the payload to a listener', () => {
    const e = new Emitter()
    const fn = vi.fn()
    e.on('ping', fn)
    e.firePing(3)
    expect(fn).toHaveBeenCalledWith({ n: 3 })
  })

  it('returns an unsubscribe function that works', () => {
    // The return value is the point: `off(type, fn)` requires the caller to
    // keep the exact function reference, and the usual leak is a listener
    // registered with an inline arrow that nobody can name at teardown time.
    const e = new Emitter()
    const fn = vi.fn()
    const off = e.on('ping', fn)
    off()
    e.firePing(1)
    expect(fn).not.toHaveBeenCalled()
  })

  it('unsubscribing twice is harmless', () => {
    const e = new Emitter()
    const off = e.on('ping', vi.fn())
    off()
    expect(() => off()).not.toThrow()
  })

  it('a listener that unsubscribes during dispatch does not break the others', () => {
    // Iterating the live array would skip the next listener after a removal.
    const e = new Emitter()
    const order: string[] = []
    const offA = e.on('ping', () => { order.push('a'); offA() })
    e.on('ping', () => order.push('b'))
    e.firePing(1)
    e.firePing(2)
    expect(order).toEqual(['a', 'b', 'b'])
  })

  it('off() removes only the given listener', () => {
    const e = new Emitter()
    const a = vi.fn()
    const b = vi.fn()
    e.on('ping', a)
    e.on('ping', b)
    e.off('ping', a)
    e.firePing(1)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('wildcard listeners receive the type alongside the payload', () => {
    // The legacy `trigger('*')` is kept, but typed: the handler is told which
    // event it is looking at, so it does not have to sniff the payload shape.
    const e = new Emitter()
    const seen: Array<[string, unknown]> = []
    e.on('*', (type, evt) => seen.push([type, evt]))
    e.firePing(7)
    expect(seen).toEqual([['ping', { n: 7 }]])
  })

  it('keeps event types separate', () => {
    const e = new Emitter()
    const pong = vi.fn()
    e.on('pong', pong)
    e.firePing(1)
    expect(pong).not.toHaveBeenCalled()
  })

  it('removeAllListeners clears everything including wildcards', () => {
    const e = new Emitter()
    const fn = vi.fn()
    e.on('ping', fn)
    e.on('*', fn)
    e.removeAllListeners()
    e.firePing(1)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('Disposable', () => {
  class Res extends Disposable {
    disposed = 0
    override dispose (): void { this.disposed++; super.dispose() }
  }

  it('runs dispose exactly once', () => {
    // Idempotence is load-bearing: dispose is reachable from the public API and
    // from device-loss handling, and both can fire.
    const r = new Res()
    r.dispose()
    r.dispose()
    expect(r.disposed).toBe(1)
  })

  it('reports its state', () => {
    const r = new Res()
    expect(r.isDisposed).toBe(false)
    r.dispose()
    expect(r.isDisposed).toBe(true)
  })

  it('assertAlive throws after disposal and is a no-op before', () => {
    // ~8 public boundaries call this. It is not a decorator on 100 members:
    // the internal async paths that actually cause use-after-dispose
    // (a rAF callback reaching a dead renderer) never touch a public member.
    const r = new Res()
    expect(() => r.assertAlive()).not.toThrow()
    r.dispose()
    expect(() => r.assertAlive()).toThrow(/disposed/)
  })
})
