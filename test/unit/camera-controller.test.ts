import { describe, it, expect, vi } from 'vitest'
import { CameraController } from '../../src/viewer/camera-controller'
import type { Projection } from '../../src/core/types'

// Fully-specified projections: `as const` on a partial literal would look like a
// Projection without being one, and the point of these fixtures is that they are
// actually assignable.
//
// `fov` is in RADIANS. cuon's `mat4.perspective` took degrees and P2's
// `legacyFovFrom` exists to invert that, so a fixture in degrees would be a
// fixture of a different quantity -- 90 would mean 5157 degrees of field of view.
const linear: Projection = { kind: 'linear', fov: Math.PI / 2, aspect: 1 }
const cylindrical: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }

describe('CameraController', () => {
  it('starts at the given pose', () => {
    const c = new CameraController({ povLatitude: 10, povLongitude: 20 }, linear)
    expect(c.state).toEqual({ povLatitude: 10, povLongitude: 20 })
  })

  it('defaults to the origin when no pose is given', () => {
    const c = new CameraController(undefined, linear)
    expect(c.state).toEqual({ povLatitude: 0, povLongitude: 0 })
  })

  it('clamps latitude instead of wrapping it', () => {
    // Latitude 100 must NOT become -80. Wrapping at the poles puts the viewer
    // past the point where the equirectangular mapping is defined and the
    // matrix goes singular. Longitude wraps; latitude does not.
    const c = new CameraController(undefined, linear)
    c.setPose({ povLatitude: 100, povLongitude: 0 })
    expect(c.state.povLatitude).toBe(90)
    c.setPose({ povLatitude: -100, povLongitude: 0 })
    expect(c.state.povLatitude).toBe(-90)
  })

  it('wraps longitude into [0, 360)', () => {
    const c = new CameraController(undefined, linear)
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
    const c = new CameraController(undefined, linear)
    expect(c.consumeDirty()).toBe(true)   // first frame always draws
    expect(c.consumeDirty()).toBe(false)
    c.rotate(5, 5)
    expect(c.consumeDirty()).toBe(true)
    expect(c.consumeDirty()).toBe(false)
  })

  it('rotate applies a relative delta and accumulates', () => {
    const c = new CameraController(undefined, linear)
    c.rotate(10, 20)
    c.rotate(5, 5)
    expect(c.state).toEqual({ povLatitude: 15, povLongitude: 25 })
  })

  it('rotate clamps and wraps through the same path as setPose', () => {
    const c = new CameraController(undefined, linear)
    c.rotate(200, 400)
    expect(c.state).toEqual({ povLatitude: 90, povLongitude: 40 })
  })

  it('rotate by zero does not dirty the controller', () => {
    // Otherwise every pointermove that did not move anything forces a redraw.
    const c = new CameraController(undefined, linear)
    c.consumeDirty()
    c.rotate(0, 0)
    expect(c.consumeDirty()).toBe(false)
  })

  it('zoom only applies to projections that have one', () => {
    const c = new CameraController(undefined, { kind: 'linear', fov: Math.PI / 2, aspect: 1 })
    c.consumeDirty()
    c.zoom(0.5)
    expect(c.consumeDirty()).toBe(false)
  })

  it('zoom clamps to the projection range', () => {
    // The discriminant is a string, so the guard in `zoom()` is a real narrowing
    // and not a numeric comparison: a wrong guard would fall through to reading
    // `zoom` off the linear variant, where it does not exist, and the camera
    // would end up with a NaN fov rather than a clamped zoom.
    const c = new CameraController(undefined, cylindrical)
    const zoomOf = (): number => {
      const p = c.projection
      return p.kind === 'cylindrical' ? p.zoom : NaN
    }

    c.zoom(100)
    expect(zoomOf()).toBeLessThanOrEqual(1)
    c.zoom(-100)
    expect(zoomOf()).toBeGreaterThan(0)
  })

  it('replacing the projection marks dirty and does not reset the pose', () => {
    // cameraOptions is a live setter. Swapping the projection must not move the
    // camera -- the legacy version reconstructed the whole camera and silently
    // reset the pose to the origin.
    const c = new CameraController({ povLatitude: 30, povLongitude: 60 }, linear)
    c.consumeDirty()
    c.setProjection(cylindrical)
    expect(c.state).toEqual({ povLatitude: 30, povLongitude: 60 })
    expect(c.consumeDirty()).toBe(true)
  })

  it('notifies subscribers on change but not on a no-op', () => {
    const c = new CameraController(undefined, linear)
    const fn = vi.fn()
    c.onChange(fn)
    c.rotate(1, 1)
    expect(fn).toHaveBeenCalledTimes(1)
    c.rotate(0, 0)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('setAspect rewrites the linear projection and marks dirty', () => {
    // The surface's aspect is knowledge only the viewer's resize handler has, and
    // for the linear camera it IS the projection's aspect. Without this the first
    // frame of a 16:9 viewer would be rendered with the default square aspect.
    const c = new CameraController(undefined, linear)
    c.consumeDirty()
    c.setAspect(2)
    expect(c.projection).toEqual({ kind: 'linear', fov: Math.PI / 2, aspect: 2 })
    expect(c.consumeDirty()).toBe(true)
  })

  it('setAspect leaves a non-linear projection alone', () => {
    // The other three cameras get their surface shape from the quad's extent,
    // which the shader reads; there is no aspect field to write and inventing one
    // would be a field nothing consumes.
    const c = new CameraController(undefined, cylindrical)
    c.consumeDirty()
    c.setAspect(2)
    expect(c.projection).toEqual(cylindrical)
    expect(c.consumeDirty()).toBe(false)
  })

  it('setAspect is a no-op when the aspect did not change', () => {
    // ResizeObserver fires on every layout pass, including ones that changed only
    // the position, so an unchanged aspect must not cost a full redraw.
    const c = new CameraController(undefined, linear)
    c.consumeDirty()
    c.setAspect(1)
    expect(c.consumeDirty()).toBe(false)
  })

  it('rejects a non-positive aspect', () => {
    // Reached through `#resize` with `height === 0` if the guard there were ever
    // dropped, and a zero aspect makes the projection matrix singular.
    const c = new CameraController(undefined, linear)
    expect(() => c.setAspect(0)).toThrow(/greater than 0/i)
    expect(() => c.setAspect(-1)).toThrow(/greater than 0/i)
    expect(() => c.setAspect(NaN)).toThrow(/greater than 0/i)
  })

  it('invalidate forces the next frame to draw', () => {
    // Called after a resize reallocated the drawing buffer: the buffer is clear
    // now, so a frame has to be drawn whether or not the camera moved.
    const c = new CameraController(undefined, linear)
    c.consumeDirty()
    c.invalidate()
    expect(c.consumeDirty()).toBe(true)
  })

  it('rejects a non-finite angle rather than producing a NaN matrix', () => {
    // A NaN latitude silently produces a matrix of NaNs, which draws black with
    // no error anywhere. Better to fail at the boundary.
    const c = new CameraController(undefined, linear)
    expect(() => c.setPose({ povLatitude: NaN, povLongitude: 0 })).toThrow(/finite/i)
    expect(() => c.rotate(0, Infinity)).toThrow(/finite/i)
  })
})
