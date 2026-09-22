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
    // The count above cannot tell an idle loop from a dead one: 1 is satisfied
    // both by "skipped the frame and is still being polled" and by "gave up
    // after the first frame". The queue depth is what separates the two -- a
    // loop that is merely idle still has its next frame scheduled.
    expect(s.pending).toBe(1)
    // And an idle tick must not be a one-way door. An implementation that skips
    // this frame and every frame after it satisfies everything above, and
    // freezes the canvas permanently the first time the input goes quiet --
    // the legacy failure this loop exists to prevent.
    dirty = true
    s.tick(48)
    expect(draw).toHaveBeenCalledTimes(2)
  })

  it('asks shouldDraw before drawing, every tick', () => {
    // The contract that keeps getCurrentTexture() out of a no-op frame. If the
    // loop ever calls draw() first and checks afterwards, a dropped frame is a
    // WebGPU validation error rather than a wasted draw.
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
    expect(calls).toEqual(['check', 'draw'])
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

  it('a throw from shouldDraw stops the loop', () => {
    // shouldDraw is called OUTSIDE the try that surrounds draw, and
    // #scheduleNext is the last thing a tick does -- so an exception from here
    // escapes the frame callback and the next frame is never queued. The
    // production callback is a boolean read followed by a call that catches its
    // own failure, so a throw from it is a defect rather than a condition the
    // loop is built to survive.
    //
    // The queue depth is the assertion that carries this test. "The error
    // escaped" on its own would hold just as well for a loop that swallowed it
    // and rescheduled -- which is the shape that leaves a canvas frozen with no
    // event and no further attempt, the legacy failure this class exists to
    // prevent.
    const s = fakeScheduler()
    const draw = vi.fn()
    const loop = new RenderLoop({
      schedule: s.request,
      cancel: s.cancel,
      shouldDraw: () => { throw new Error('defective callback') },
      draw
    })
    loop.start()
    expect(s.pending).toBe(1)

    expect(() => s.tick(0)).toThrow('defective callback')
    expect(s.pending).toBe(0)
    // The frame never reached draw, so what stopped the loop is the check
    // rather than something raised from inside the frame itself.
    expect(draw).not.toHaveBeenCalled()

    // Nothing is queued, so a later tick cannot revive it: "stopped" and "idle"
    // differ exactly here, and an idle loop still holds a pending frame.
    s.tick(16)
    expect(draw).not.toHaveBeenCalled()
    expect(s.pending).toBe(0)
  })

  it('a throw from onError stops the loop, on the same path as shouldDraw', () => {
    // The asymmetry with draw is deliberate, and this test is what makes it a
    // contract rather than a coincidence: draw's failure is absorbed because a
    // failed draw and a skipped draw both leave the canvas unchanged, but a
    // throw from the reporter itself is a defect, and absorbing it would leave
    // a loop that neither draws nor reports. The exit is the same as
    // shouldDraw's -- #scheduleNext is never reached.
    const s = fakeScheduler()
    const draw = vi.fn(() => { throw new Error('device lost') })
    const loop = new RenderLoop({
      schedule: s.request,
      cancel: s.cancel,
      shouldDraw: () => true,
      draw,
      onError: () => { throw new Error('the reporter itself failed') }
    })
    loop.start()
    expect(s.pending).toBe(1)

    expect(() => s.tick(0)).toThrow('the reporter itself failed')
    expect(s.pending).toBe(0)
    // draw DID run: the loop reached the frame, so what stopped it is the
    // reporter and not an earlier failure.
    expect(draw).toHaveBeenCalledTimes(1)

    s.tick(16)
    expect(draw).toHaveBeenCalledTimes(1)
    expect(s.pending).toBe(0)
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
    // discarding shouldDraw's answer -- and so on, once per frame, for as long
    // as the failure lasts. On a permanently lost device that is a full-screen
    // redraw attempt every frame rather than a loop that stops. The behaviour is
    // incidental to where #drewOnce is assigned rather than a decision, and it
    // is pinned here so that changing it is deliberate.
    //
    // shouldDraw is still consulted on each of those ticks -- only its answer is
    // discarded -- so both counts are pinned. The call count is what distinguishes
    // this from the alternative, where the check is skipped entirely while the
    // first frame has not landed.
    const s = fakeScheduler()
    const shouldDraw = vi.fn(() => false)
    const draw = vi.fn(() => { throw new Error('device lost') })
    const loop = new RenderLoop({ schedule: s.request, cancel: s.cancel, shouldDraw, draw })
    loop.start()
    s.tick(0)
    s.tick(16)
    s.tick(32)
    expect(shouldDraw).toHaveBeenCalledTimes(3)
    expect(draw).toHaveBeenCalledTimes(3)
  })
})
