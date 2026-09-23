import { describe, it, expect, vi } from 'vitest'
import { CameraController, DEFAULT_PROJECTION } from '../../src/viewer/camera-controller'
import type { Projection } from '../../src/core/types'

// Fully-specified projections: `as const` on a partial literal would look like a
// Projection without being one, and the point of these fixtures is that they are
// actually assignable.
//
// `fov` is in RADIANS. cuon's `mat4.perspective` took degrees and P2's
// `legacyFovFrom` exists to invert that, so a fixture in degrees would be a
// fixture of a different quantity -- 90 would mean 5157 degrees of field of view.
//
// Factories rather than shared constants, and that is load-bearing. The
// controller stores the reference it is handed, so one module-level object would
// be a channel between tests: a controller that wrote through to its projection
// would corrupt every later test that used the same object, and which test went
// red would depend on file order. Measured on the write-in-place mutant: the file
// failed while the test that named the contract passed on its own. A per-test
// object closes the channel, so a write-through fails the test that asserts it
// rather than whichever test happens to run next. It also keeps every test
// independent under `--sequence.shuffle`.
const linear = (): Projection => ({ kind: 'linear', fov: Math.PI / 2, aspect: 1 })
const cylindrical = (): Projection => ({ kind: 'cylindrical', zoom: 1, extent: [1, 1] })

describe('CameraController', () => {
  it('starts at the given pose', () => {
    const c = new CameraController({ povLatitude: 10, povLongitude: 20 }, linear())
    expect(c.state).toEqual({ povLatitude: 10, povLongitude: 20 })
  })

  it('defaults to the origin when no pose is given', () => {
    const c = new CameraController(undefined, linear())
    expect(c.state).toEqual({ povLatitude: 0, povLongitude: 0 })
  })

  it('normalises the pose it is constructed with', () => {
    // Every other fixture in this file is already normalised, so the clamp and
    // the wrap are no-ops on all of them and nothing observes that they run at
    // all. The constructor does no validating of its own -- it relies entirely on
    // clampLatitude and wrapLongitude -- so dropping either call drops the
    // documented throw with it, and a NaN then reaches the matrix and draws a
    // black frame with nothing reported. The pose is a public option, so this is
    // the boundary, not an internal path.
    expect(new CameraController({ povLatitude: 100, povLongitude: 0 }, linear()).state.povLatitude).toBe(90)
    expect(new CameraController({ povLatitude: -100, povLongitude: 0 }, linear()).state.povLatitude).toBe(-90)
    expect(new CameraController({ povLatitude: 0, povLongitude: -10 }, linear()).state.povLongitude).toBe(350)
    expect(new CameraController({ povLatitude: 0, povLongitude: 370 }, linear()).state.povLongitude).toBe(10)

    expect(() => new CameraController({ povLatitude: NaN, povLongitude: 0 }, linear())).toThrow(/finite/i)
    expect(() => new CameraController({ povLatitude: 0, povLongitude: NaN }, linear())).toThrow(/finite/i)
  })

  it('clamps latitude instead of wrapping it', () => {
    // Latitude 100 must NOT become -80. Wrapping at the poles puts the viewer
    // past the point where the equirectangular mapping is defined and the
    // matrix goes singular. Longitude wraps; latitude does not.
    const c = new CameraController(undefined, linear())
    c.setPose({ povLatitude: 100, povLongitude: 0 })
    expect(c.state.povLatitude).toBe(90)
    c.setPose({ povLatitude: -100, povLongitude: 0 })
    expect(c.state.povLatitude).toBe(-90)
  })

  it('wraps longitude into [0, 360)', () => {
    const c = new CameraController(undefined, linear())
    c.setPose({ povLatitude: 0, povLongitude: 370 })
    expect(c.state.povLongitude).toBe(10)
    c.setPose({ povLatitude: 0, povLongitude: -10 })
    expect(c.state.povLongitude).toBe(350)
    c.setPose({ povLatitude: 0, povLongitude: 360 })
    expect(c.state.povLongitude).toBe(0)
  })

  it('marks itself clean after read and dirty after a change', () => {
    // The dirty flag is what lets a static image render exactly once instead of
    // sixty times a second forever.
    const c = new CameraController(undefined, linear())
    expect(c.consumeDirty()).toBe(true)   // first frame always draws
    expect(c.consumeDirty()).toBe(false)
    c.rotate(5, 5)
    expect(c.consumeDirty()).toBe(true)
    expect(c.consumeDirty()).toBe(false)
  })

  it('rotate applies a relative delta and accumulates', () => {
    const c = new CameraController(undefined, linear())
    c.rotate(10, 20)
    c.rotate(5, 5)
    expect(c.state).toEqual({ povLatitude: 15, povLongitude: 25 })

    // Negative deltas. Every other rotate in this file sends zero or a positive
    // number, so `+ Math.abs(delta)` on either axis survives the whole suite --
    // and this is not a corner: the interaction layer's `classifyDrag` negates
    // both axes, so a rightward or downward drag arrives here negative. Half of
    // every pan is in the direction nothing tested.
    //
    // Each axis is driven alone before the mixed pair, because a mixed pair
    // cannot say which of the two `+ delta` terms a mutation touched; and the
    // values are exact, so a sign error has nowhere to hide behind a magnitude.
    c.rotate(-5, 0)
    expect(c.state).toEqual({ povLatitude: 10, povLongitude: 25 })

    c.rotate(0, -3.5)
    expect(c.state).toEqual({ povLatitude: 10, povLongitude: 21.5 })

    c.rotate(-4, 8.5)
    expect(c.state).toEqual({ povLatitude: 6, povLongitude: 30 })
  })

  it('rotate clamps and wraps through the same path as setPose', () => {
    const c = new CameraController(undefined, linear())
    c.rotate(200, 400)
    expect(c.state).toEqual({ povLatitude: 90, povLongitude: 40 })
  })

  it('rotate by zero does not dirty the controller', () => {
    // Otherwise every pointermove that did not move anything forces a redraw.
    const c = new CameraController(undefined, linear())
    c.consumeDirty()
    c.rotate(0, 0)
    expect(c.consumeDirty()).toBe(false)
  })

  it('rotate moves only the axis that was given a delta', () => {
    // A purely horizontal drag reaches this method as `rotate(-0, -3.5)`: the
    // interaction layer divides a zero pixel delta by the surface size, so the
    // untouched axis arrives as zero rather than absent. The zero guard must
    // therefore be an `&&` -- under an `||` it returns early whenever *either*
    // delta is zero, so every axis-aligned drag is swallowed before it reaches
    // `#apply` and only diagonal drags move the camera at all. The `rotate(0, 0)`
    // case above cannot see the difference: it is the one input on which the two
    // operators agree.
    const c = new CameraController(undefined, linear())
    c.consumeDirty()

    c.rotate(0, 5)
    expect(c.state).toEqual({ povLatitude: 0, povLongitude: 5 })
    expect(c.consumeDirty()).toBe(true)

    c.rotate(5, 0)
    expect(c.state).toEqual({ povLatitude: 5, povLongitude: 5 })
    expect(c.consumeDirty()).toBe(true)
  })

  it('setPose to a pose that normalises to the current one is a no-op', () => {
    // A redundant setPose must not cost a full-screen redraw, for the same
    // reason rotate-by-zero must not: the interaction layer re-derives an
    // absolute pose on every pointermove, and most of those moves land on the
    // angle it already had. The guard compares NORMALISED angles against the
    // stored ones -- 380 is the same longitude as 20 -- so a guard that compared
    // the raw arguments would find a change here, and a guard that fell through
    // would notify subscribers as well as dirtying the frame.
    const c = new CameraController({ povLatitude: 10, povLongitude: 20 }, linear())
    const fn = vi.fn()
    c.onChange(fn)
    c.consumeDirty()

    c.setPose({ povLatitude: 10, povLongitude: 20 })
    expect(c.consumeDirty()).toBe(false)
    expect(fn).not.toHaveBeenCalled()

    c.setPose({ povLatitude: 10, povLongitude: 380 })
    expect(c.consumeDirty()).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('zoom reaches the linear projection as fov', () => {
    const c = new CameraController(undefined, { kind: 'linear', fov: Math.PI / 2, aspect: 2 })
    c.consumeDirty()
    c.zoom(0.5)
    const p = c.projection
    if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
    // (PI / 2) / 1.5 -- the unified contract: a positive delta magnifies by
    // (1 + delta), and a narrower fov IS the magnification for the linear
    // camera. v1 returned at the kind guard (a no-op), which was a port
    // regression: v0.2.2's PerspectiveTrans.zoom adjusted fov and worked.
    expect(p.fov).toBeCloseTo(Math.PI / 3)
    // The spread must carry the caller's aspect through -- losing it would
    // stretch the picture on the next non-square resize.
    expect(p.aspect).toBe(2)
    expect(c.consumeDirty()).toBe(true)
  })

  it('zoom clamps to the projection range', () => {
    // The discriminant is a string, so the guard in `zoom()` is a real narrowing
    // and not a numeric comparison: a wrong guard would fall through to reading
    // `zoom` off the linear variant, where it does not exist, and the camera
    // would end up with a NaN fov rather than a clamped zoom.
    //
    // The bounds are asserted exactly rather than by inequality. `<= 1` and
    // `> 0` are satisfied by any range inside (0, 1], so both constants could be
    // moved -- the ceiling to 0.5, the floor to 0.5 -- and the whole usable range
    // could collapse to a single point with this test still green. The bounds
    // are the user-adjudicated spec values (pan-zoom-semantics spec section 4,
    // 2026-09-23), not ported legacy behaviour.
    //
    // The second arm is the negative-divisor net: 1 + (-100) < 0, and an
    // implementation that divides `zoom / (1 + delta)` without clamping the
    // divisor first produces a negative zoom that the outer clamp then pins
    // to the floor 0.01 -- expecting 1 is what catches it.
    const c = new CameraController(undefined, cylindrical())
    const zoomOf = (): number => {
      const p = c.projection
      return p.kind === 'cylindrical' ? p.zoom : NaN
    }

    c.zoom(100)   // magnify far past the floor
    expect(zoomOf()).toBe(0.01)
    c.zoom(-100)  // shrink far past the ceiling -- and past the negative divisor
    expect(zoomOf()).toBe(1)

    // Planet pins the same endpoints through a second non-linear kind. It
    // shares the else-branch with cylindrical, so under the unified contract
    // this arm is green because the branch is green -- the edit it exists for
    // is a future "restore the legacy per-kind clamps" one: planet's legacy
    // range was [0.1, 2], and with no test instantiating planet through
    // zoom() that edit would redden nothing while changing what every planet
    // user gets. Pannini is deliberately left without an arm: it shares the
    // same branch, and a third instantiation of one line pins nothing the two
    // here have not.
    const planet = new CameraController(undefined, { kind: 'planet', zoom: 1, extent: [4, 4] })
    const zoomOfPlanet = (): number => {
      const p = planet.projection
      return p.kind === 'planet' ? p.zoom : NaN
    }
    planet.zoom(100)
    expect(zoomOfPlanet()).toBe(0.01)
    planet.zoom(-100)
    expect(zoomOfPlanet()).toBe(1)
  })

  it('linear zoom clamps to [15°, 110°] and pins at both ends', () => {
    const max = (110 * Math.PI) / 180
    const min = (15 * Math.PI) / 180
    const c = new CameraController(undefined, { kind: 'linear', fov: max, aspect: 1 })
    c.consumeDirty()
    c.zoom(-100) // shrink past the ceiling: already there, no-op
    expect(c.consumeDirty()).toBe(false)
    c.zoom(100)  // magnify past the floor: lands ON min, dirty
    const p = c.projection
    if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
    expect(p.fov).toBeCloseTo(min)
    expect(c.consumeDirty()).toBe(true)
  })

  it('zoom moves by the delta, in the direction the delta asks for', () => {
    // Every other zoom test starts at or saturates against the ceiling, where a
    // zoom-in is clamped away -- so a `zoom` with no effect at all would satisfy
    // all of them. Starting below the ceiling is what makes the sign and the
    // magnitude observable.
    //
    // Under the unified contract a positive delta magnifies, which DIVIDES
    // the parameter: 0.6 / 1.5, written as the expression because that is
    // bit-identical to what the implementation divides out (the decimal 0.4
    // is a different double, one ulp above it -- and 0.5 / 1.5 was rejected
    // as the fixture because it is a repeating fraction no literal can pin).
    const half: Projection = { kind: 'cylindrical', zoom: 0.6, extent: [1, 1] }
    const c = new CameraController(undefined, half)
    c.consumeDirty()
    c.zoom(0.5)

    const p = c.projection
    expect(p.kind === 'cylindrical' ? p.zoom : NaN).toBe(0.6 / 1.5)
    expect(c.consumeDirty()).toBe(true)
  })

  it('a zoom that clamps back to the value already held is a no-op', () => {
    // A wheel held at the ceiling is an unbounded stream of NEGATIVE deltas
    // under the unified contract -- shrinking is what the ceiling pins: from
    // zoom 1, zoom(-0.5) computes 1 / (1 - 0.5) = 2 and clamps back to 1,
    // while magnifying at 1 (zoom(0.5) -> 1 / 1.5 = 0.667...) is a real
    // write. And a delta below the float64 epsilon rounds to the value
    // already held. Both land on the same no-redraw case `#apply` and
    // `setAspect` guard; without it each event costs a full-screen redraw
    // and a subscriber wake for a picture that cannot change.
    const c = new CameraController(undefined, cylindrical())
    const fn = vi.fn()
    c.onChange(fn)
    c.consumeDirty()

    c.zoom(-0.5)
    expect(c.consumeDirty()).toBe(false)

    c.zoom(5e-17)
    expect(c.consumeDirty()).toBe(false)

    expect(fn).not.toHaveBeenCalled()
  })

  it('zoom by zero does not dirty the controller', () => {
    // Cylindrical on purpose: a linear projection returns at the kind guard
    // whatever the delta is, so a linear fixture would pass this test without the
    // zero guard existing at all. A wheel notch or a pinch that nets to nothing
    // is the common input, not the corner, and each one would otherwise allocate
    // a projection, dirty the frame and wake every subscriber.
    const c = new CameraController(undefined, cylindrical())
    const fn = vi.fn()
    c.onChange(fn)
    c.consumeDirty()
    c.zoom(0)
    expect(c.consumeDirty()).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('zoom by zero is a no-op even when the current zoom is out of range', () => {
    // The zero guard is NOT redundant with the equal-value guard below it, which
    // only catches a clamp that lands back on the value already held. That
    // reasoning assumes the zoom in hand is one `zoom()` produced, and this
    // controller's is not: the constructor and setProjection take a Projection as
    // given and validate nothing, so `Projection.zoom` being a bare number makes
    // 5 reachable. Without the zero guard, zoom(0) falls through to the clamp and
    // snaps 5 to 1 -- dirtying the frame and waking every subscriber for a wheel
    // event that asked for nothing.
    //
    // This pins what zoom(0) does when holding such a zoom; it does not bless the
    // unclamped state that produced it. Nothing here validates an incoming
    // projection, and whether anything should is a separate question from this
    // guard -- one this fixture deliberately leaves open.
    const c = new CameraController(undefined, { kind: 'cylindrical', zoom: 5, extent: [1, 1] })
    const fn = vi.fn()
    c.onChange(fn)
    c.consumeDirty()

    c.zoom(0)
    expect(c.projection).toEqual({ kind: 'cylindrical', zoom: 5, extent: [1, 1] })
    expect(c.consumeDirty()).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('rejects a non-finite zoom delta', () => {
    // The same argument as setPose's finiteness guard: a NaN that reached the
    // assignment would make the projection's zoom NaN, and an all-NaN matrix
    // draws black with nothing reported anywhere. Cylindrical on purpose -- it is
    // the variant where the assignment actually happens, so this is the fixture
    // in which the check is load-bearing rather than incidentally satisfied.
    //
    // The linear case is here for the guard's position, and it is the only input
    // the two possible positions disagree on: checked before the kind guard a NaN
    // throws, checked after it the linear camera returns first and the NaN is
    // swallowed. A NaN must not throw on one camera model and pass silently on
    // another -- a public contract that varies by projection kind is the kind of
    // difference nobody finds until it bites.
    const c = new CameraController(undefined, cylindrical())
    expect(() => c.zoom(NaN)).toThrow(/finite/i)
    expect(() => c.zoom(Infinity)).toThrow(/finite/i)
    // Linear has no zoom to change, and still refuses the input.
    expect(() => new CameraController(undefined, linear()).zoom(NaN)).toThrow(/finite/i)
  })

  it('does not write through to the projection the caller passed', () => {
    // The controller stores the reference it is handed, so an implementation that
    // assigned in place would reach back into the caller's own object. Asserted
    // against objects built here, and that is the point: while the fixtures were
    // module-level constants, every test shared one, so a write-through was caught
    // by whichever test ran next rather than by any assertion about this
    // contract -- measured, the file went red while the test that should have
    // named it passed alone. With a per-test object the failure lands here, and
    // lands here whether the file runs whole, shuffled, or one test at a time.
    //
    // Each half asserts the controller's own projection DID move before asserting
    // the caller's did not, and that order is not decoration. Without it the test
    // is satisfied by an implementation that writes nothing at all, and the
    // obvious fixture lands exactly there under the unified formula: start at
    // zoom 1, call zoom(-0.5), and 1 / (1 - 0.5) = 2 clamps back to 1, the
    // equal-value guard returns early, and no assignment is reached --
    // magnifying at 1 (zoom(0.5) -> 1 / 1.5 = 0.667...) is the real write.
    // Starting below the ceiling is what makes the write happen and the
    // assertion mean something.
    //
    // Inbound only. What `setProjection` accepts and whether the `projection`
    // getter should hand out a snapshot are Task 3's questions; this says nothing
    // about either.
    const passedToZoom: Projection = { kind: 'cylindrical', zoom: 0.5, extent: [1, 1] }
    const zoomed = new CameraController(undefined, passedToZoom)
    zoomed.zoom(0.5)
    expect(zoomed.projection).toEqual({ kind: 'cylindrical', zoom: 0.5 / 1.5, extent: [1, 1] })
    expect(passedToZoom).toEqual({ kind: 'cylindrical', zoom: 0.5, extent: [1, 1] })

    const passedToAspect: Projection = { kind: 'linear', fov: Math.PI / 2, aspect: 1 }
    const resized = new CameraController(undefined, passedToAspect)
    resized.setAspect(2)
    expect(resized.projection).toEqual({ kind: 'linear', fov: Math.PI / 2, aspect: 2 })
    expect(passedToAspect).toEqual({ kind: 'linear', fov: Math.PI / 2, aspect: 1 })
  })

  it('replacing the projection marks dirty and does not reset the pose', () => {
    // cameraOptions is a live setter. Swapping the projection must not move the
    // camera -- the legacy version reconstructed the whole camera and silently
    // reset the pose to the origin.
    const c = new CameraController({ povLatitude: 30, povLongitude: 60 }, linear())
    c.consumeDirty()
    c.setProjection(cylindrical())
    expect(c.state).toEqual({ povLatitude: 30, povLongitude: 60 })
    expect(c.consumeDirty()).toBe(true)
  })

  it('notifies subscribers on change but not on a no-op', () => {
    const c = new CameraController(undefined, linear())
    const fn = vi.fn()
    c.onChange(fn)
    c.rotate(1, 1)
    expect(fn).toHaveBeenCalledTimes(1)
    c.rotate(0, 0)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('onChange returns an unsubscribe that detaches the listener', () => {
    // A later Viewer.dispose() detaches its camera listener through exactly this
    // function, so a no-op here leaves a disposed viewer still reacting to camera
    // changes -- a leak that stays invisible until something is disposed and
    // something else is still moving.
    const c = new CameraController(undefined, linear())
    const fn = vi.fn()
    const off = c.onChange(fn)

    c.rotate(1, 1)
    expect(fn).toHaveBeenCalledTimes(1)

    off()
    c.rotate(1, 1)
    // Counted rather than `not.toHaveBeenCalled()`, which would also pass if the
    // listener had been firing twice per change from the start.
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('notifies every subscriber, and an unsubscribe detaches only its own', () => {
    // Every other test here registers exactly one listener, which makes "remove
    // my listener" and "remove every listener" indistinguishable -- and the
    // second is what a `clear()` returns. The unsubscribe is what a viewer's
    // dispose will call, so detaching everyone would silently kill the
    // application's own subscription the moment one viewer went away.
    const c = new CameraController(undefined, linear())
    const first = vi.fn()
    const second = vi.fn()
    const off = c.onChange(first)
    c.onChange(second)

    c.rotate(1, 1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    off()
    c.rotate(1, 1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('zoom and setProjection notify their subscribers', () => {
    // Both change what the renderer draws, so a subscriber that only ever heard
    // about pans would miss them.
    const half: Projection = { kind: 'cylindrical', zoom: 0.5, extent: [1, 1] }
    const c = new CameraController(undefined, half)
    const fn = vi.fn()
    c.onChange(fn)

    c.zoom(0.5)
    expect(fn).toHaveBeenCalledTimes(1)
    c.setProjection(linear())
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('notifies from a snapshot, so a listener that detaches another still reaches it', () => {
    // With a live Set the detaching listener would remove a listener still to be
    // visited, and that listener would silently miss a change it was subscribed
    // to when the notification began.
    const c = new CameraController(undefined, linear())
    const victim = vi.fn()
    let detachVictim: () => void = () => {}
    c.onChange(() => { detachVictim() })
    detachVictim = c.onChange(victim)

    c.rotate(1, 1)
    expect(victim).toHaveBeenCalledTimes(1)
  })

  it('setAspect rewrites the linear projection and marks dirty', () => {
    // The surface's aspect is knowledge only the viewer's resize handler has, and
    // for the linear camera it IS the projection's aspect. Without this the first
    // frame of a 16:9 viewer would be rendered with the default square aspect.
    const c = new CameraController(undefined, linear())
    c.consumeDirty()
    c.setAspect(2)
    expect(c.projection).toEqual({ kind: 'linear', fov: Math.PI / 2, aspect: 2 })
    expect(c.consumeDirty()).toBe(true)
  })

  it('setAspect writes an aspect that shrank', () => {
    // Every other setAspect in this file either raises the aspect or passes the
    // value already held, so `===` degenerating to `>=` survives all of them: the
    // equality guard would return for anything smaller and the projection would
    // keep the old, wider aspect. A shrinking container is the ordinary
    // ResizeObserver path rather than an edge case, and the symptom is a silently
    // stretched picture with a correctly-sized canvas, which is the kind of thing
    // that survives to a release. Asserted exactly, since `>=` writes nothing and
    // any inequality-shaped assertion is satisfied by the stale value.
    const c = new CameraController(undefined, { kind: 'linear', fov: Math.PI / 2, aspect: 2 })
    c.consumeDirty()
    c.setAspect(0.5)
    expect(c.projection).toEqual({ kind: 'linear', fov: Math.PI / 2, aspect: 0.5 })
    expect(c.consumeDirty()).toBe(true)
  })

  it('setAspect leaves a non-linear projection alone', () => {
    // The other three cameras get their surface shape from the quad's extent,
    // which the shader reads; there is no aspect field to write and inventing one
    // would be a field nothing consumes.
    const c = new CameraController(undefined, cylindrical())
    c.consumeDirty()
    c.setAspect(2)
    expect(c.projection).toEqual(cylindrical())
    expect(c.consumeDirty()).toBe(false)
  })

  it('setAspect is a no-op when the aspect did not change', () => {
    // ResizeObserver fires on every layout pass, including ones that changed only
    // the position, so an unchanged aspect must not cost a full redraw.
    const c = new CameraController(undefined, linear())
    c.consumeDirty()
    c.setAspect(1)
    expect(c.consumeDirty()).toBe(false)
  })

  it('rejects a non-positive aspect', () => {
    // Reached through `#resize` with `height === 0` if the guard there were ever
    // dropped, and a zero aspect makes the projection matrix singular.
    //
    // The kind guard must sit BELOW the assert, and the non-linear controller is
    // what pins that: checked first, it returns for every other camera model and
    // the invalid aspect is swallowed there while still throwing on a linear one.
    // An aspect is the surface's shape rather than the projection's -- a zero one
    // is invalid whatever the camera model -- so a contract that varied by kind
    // would be the kind of difference nobody finds until it bites. Same ruling as
    // `zoom`'s guard order.
    const c = new CameraController(undefined, linear())
    expect(() => c.setAspect(0)).toThrow(/greater than 0/i)
    expect(() => c.setAspect(-1)).toThrow(/greater than 0/i)
    expect(() => c.setAspect(NaN)).toThrow(/greater than 0/i)

    const nonLinear = new CameraController(undefined, cylindrical())
    expect(() => nonLinear.setAspect(0)).toThrow(/greater than 0/i)
    expect(() => nonLinear.setAspect(-1)).toThrow(/greater than 0/i)
    expect(() => nonLinear.setAspect(NaN)).toThrow(/greater than 0/i)
  })

  it('invalidate forces the next frame to draw', () => {
    // Called after a resize reallocated the drawing buffer: the buffer is clear
    // now, so a frame has to be drawn whether or not the camera moved.
    const c = new CameraController(undefined, linear())
    c.consumeDirty()
    c.invalidate()
    expect(c.consumeDirty()).toBe(true)
  })

  it('rejects a non-finite angle rather than producing a NaN matrix', () => {
    // A NaN latitude silently produces a matrix of NaNs, which draws black with
    // no error anywhere. Better to fail at the boundary.
    const c = new CameraController(undefined, linear())
    expect(() => c.setPose({ povLatitude: NaN, povLongitude: 0 })).toThrow(/finite/i)
    expect(() => c.rotate(0, Infinity)).toThrow(/finite/i)
  })

  it('names the offending angle, so the two guards cannot be swapped', () => {
    // The name is the only thing that says WHICH of a caller's two angles was
    // wrong, and every other assertion here is `/finite/i` -- a pattern the guards
    // satisfy however they are named. The frame is black either way; what a wrong
    // name costs is the hour spent looking at the angle that was already correct.
    //
    // Two properties, and they need different inputs. That each name belongs to
    // the angle it names shows up as soon as ONE of the two is invalid: the four
    // singly-invalid pairs below leave the other offender finite, so the guard
    // that fires is unambiguous and its name can be read off. The ORDER of the two
    // guards is invisible to those -- with one angle finite, that guard passes
    // whichever line it sits on, and the NaN is caught under its own name either
    // way, so reordering changes nothing observable. Only both-invalid input makes
    // the order visible: the first line is then the one that throws, and its name
    // is what the caller sees. The last two assertions are the only ones that a
    // reordering of the pair can fail.
    //
    // `rotate(Infinity, 0)` is also the axis nothing else covers: the test above
    // only ever sends the infinity down the longitude, so a dropped latitude guard
    // was invisible.
    const c = new CameraController(undefined, linear())
    expect(() => c.setPose({ povLatitude: NaN, povLongitude: 0 })).toThrow(/povLatitude/)
    expect(() => c.setPose({ povLatitude: 0, povLongitude: NaN })).toThrow(/povLongitude/)
    expect(() => c.rotate(Infinity, 0)).toThrow(/deltaLat/)
    expect(() => c.rotate(0, Infinity)).toThrow(/deltaLng/)

    // Both angles invalid: the order of the two guards is the only thing left to
    // decide which name comes back.
    expect(() => c.setPose({ povLatitude: NaN, povLongitude: NaN })).toThrow(/povLatitude/)
    expect(() => c.rotate(Infinity, Infinity)).toThrow(/deltaLat/)
  })
})

describe('DEFAULT_PROJECTION', () => {
  it('is the legacy 70-degree linear camera', () => {
    // Nothing else pins this number. The plan's viewer fixtures spell the same
    // value out independently and gate A derives its fov from the captured
    // baseline, so a wrong one would reach every caller who does not name a
    // projection and show up only as a visibly wrong field of view.
    expect(DEFAULT_PROJECTION).toEqual({ kind: 'linear', fov: (70 * Math.PI) / 180, aspect: 1 })
  })
})
