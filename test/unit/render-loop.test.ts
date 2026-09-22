import { describe, it, expect, vi } from 'vitest'
import { RenderLoop } from '../../src/viewer/render-loop'

/** A controllable rAF stand-in. */
function fakeScheduler () {
  const queue = new Map<number, FrameRequestCallback>()
  let next = 1
  return {
    request: (cb: FrameRequestCallback) => { const id = next++; queue.set(id, cb); return id },
    cancel: (id: number) => { queue.delete(id) },
    /** Runs one tick at the given timestamp. */
    tick (time: number) {
      const pending = [...queue.entries()]
      queue.clear()
      for (const [, cb] of pending) cb(time)
    },
    get pending () { return queue.size }
  }
}

describe('RenderLoop', () => {
  it('draws the first frame even when nothing is dirty', () => {
    // The dirty flag starts clean after construction in some orderings; a loop
    // that skipped the first frame would show nothing until the user moved.
    const s = fakeScheduler()
    const draw = vi.fn()
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => false, draw })
    loop.start()
    s.tick(0)
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('skips drawing when nothing changed', () => {
    const s = fakeScheduler()
    const draw = vi.fn()
    let dirty = true
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => dirty, draw })
    loop.start()
    s.tick(0); dirty = false
    s.tick(16)
    s.tick(32)
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('asks shouldDraw before drawing, on every tick past the first', () => {
    // The contract that keeps getCurrentTexture() out of a no-op frame. If the
    // loop ever calls draw() first and checks afterwards, a dropped frame is a
    // WebGPU validation error rather than a wasted draw.
    //
    // The first tick is absent from the expectation because shouldDraw is not
    // asked at all on it: #tick short-circuits on `first` before reaching the
    // flag, which is what makes the first frame unconditional. The plan's
    // version of this test ticked once and expected ['check', 'draw']; that
    // ordering is not observable until the loop is past its first frame, so the
    // extra tick is what turns the plan's assertion into a true one.
    const s = fakeScheduler()
    const calls: string[] = []
    const loop = new RenderLoop({
      schedule: s.request,
      cancel: s.cancel,
      shouldDraw: () => { calls.push('check'); return true },
      draw: () => { calls.push('draw') }
    })
    loop.start()
    s.tick(0)
    s.tick(16)
    expect(calls).toEqual(['draw', 'check', 'draw'])
  })

  it('stops scheduling after stop()', () => {
    const s = fakeScheduler()
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => true, draw: vi.fn() })
    loop.start()
    s.tick(0)
    loop.stop()
    expect(s.pending).toBe(0)
  })

  it('a throw inside draw does not kill the loop', () => {
    // A device-lost mid-frame would otherwise stop the loop silently and the
    // canvas would freeze with no further events.
    const s = fakeScheduler()
    const onError = vi.fn()
    let calls = 0
    const loop = new RenderLoop({
      schedule: s.request,
      cancel: s.cancel,
      shouldDraw: () => true,
      draw: () => { calls++; if (calls === 1) throw new Error('device lost') },
      onError
    })
    loop.start()
    s.tick(0)
    s.tick(16)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
  })

  it('stop() then start() resumes', () => {
    const s = fakeScheduler()
    const draw = vi.fn()
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => true, draw })
    loop.start()
    s.tick(0)
    loop.stop()
    loop.start()
    s.tick(16)
    expect(draw).toHaveBeenCalledTimes(2)
  })

  it('dispose stops the loop and is idempotent', () => {
    const s = fakeScheduler()
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => true, draw: vi.fn() })
    loop.start()
    loop.dispose()
    loop.dispose()
    expect(s.pending).toBe(0)
  })

  it('start() twice schedules one frame, not two', () => {
    // Without the #running half of the guard, the second start() would queue a
    // second callback: two frames per tick, each drawing, forever.
    const s = fakeScheduler()
    const draw = vi.fn()
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => true, draw })
    loop.start()
    loop.start()
    expect(s.pending).toBe(1)
    s.tick(0)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(s.pending).toBe(1)
  })

  it('start() after dispose() schedules nothing', () => {
    // A restart reaching a disposed loop would schedule a frame that outlives
    // the resources the draw callback needs.
    const s = fakeScheduler()
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => true, draw: vi.fn() })
    loop.dispose()
    loop.start()
    expect(s.pending).toBe(0)
  })

  it('a throw with no onError handler still leaves the loop alive', () => {
    // onError is optional, and the swallow must not depend on it being there:
    // a caller that does not want error reporting still gets a loop that keeps
    // trying, rather than one that dies on the first device-lost frame.
    const s = fakeScheduler()
    let calls = 0
    const loop = new RenderLoop({
      schedule: s.request,
      cancel: s.cancel,
      shouldDraw: () => true,
      draw: () => { calls++; if (calls === 1) throw new Error('device lost') }
    })
    loop.start()
    s.tick(0)
    s.tick(16)
    expect(calls).toBe(2)
  })

  it('a frame that fires after stop() draws nothing', () => {
    // cancelAnimationFrame is not guaranteed to reach a callback that has
    // already been dispatched, so the callback re-checks #running when it runs
    // rather than trusting the cancel.
    const s = fakeScheduler()
    const draw = vi.fn()
    const loop = new RenderLoop({
      schedule: s.request,
      // Deliberately inert: the queued frame still runs, as a real rAF race does.
      cancel: () => {},
      shouldDraw: () => true,
      draw
    })
    loop.start()
    loop.stop()
    s.tick(0)
    expect(draw).not.toHaveBeenCalled()
  })

  it('stop() from inside draw does not reschedule', () => {
    // A draw that gives up -- the device-lost path -- must not have the frame
    // it is running inside queue the next one on its way out.
    const s = fakeScheduler()
    const loop = new RenderLoop({
      schedule: s.request,
      cancel: s.cancel,
      shouldDraw: () => true,
      draw: () => { loop.stop() }
    })
    loop.start()
    s.tick(0)
    expect(s.pending).toBe(0)
  })

  it('retries the first frame on every tick while draw keeps throwing', () => {
    // #drewOnce is set only AFTER a successful draw, so a first frame that
    // throws leaves it false and the next tick draws unconditionally again,
    // ignoring shouldDraw -- and so on, once per frame, for as long as the
    // failure lasts. On a permanently lost device that is a full-screen redraw
    // attempt every frame rather than a loop that stops. The behaviour is
    // incidental to where #drewOnce is assigned rather than a decision, and it
    // is pinned here so that changing it is deliberate.
    const s = fakeScheduler()
    const draw = vi.fn(() => { throw new Error('device lost') })
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw: () => false, draw })
    loop.start()
    s.tick(0)
    s.tick(16)
    s.tick(32)
    expect(draw).toHaveBeenCalledTimes(3)
  })
})
