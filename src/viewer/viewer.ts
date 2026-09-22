/**
 * The shared viewer, composed rather than mixed in.
 *
 * The legacy version was `mix(Viewer).with(CameraFactory)` where `Viewer` was
 * itself `mix(Eventable).with(Delegate, RenderFlow)`. The problem was not the
 * syntax but the semantics: the viewer WAS a Delegate and WAS a RenderFlow, so
 * every member landed in one namespace, initialisation order was decided
 * implicitly by mixin order, and `dispose` chained through `super` -- which is
 * why five separate teardown steps were missing.
 *
 * Here each collaborator is a field and `dispose` names them in order.
 */

import { Disposable, EventEmitter, type EventMap, type WildcardListener } from '../core/events'
import { channels } from '../diagnostics'
import type { Projection } from '../core/types'
import type { Backend, Capabilities, DeviceLost } from '../renderer/backend'
import type { MediaSource } from '../media/source'
import { CameraController, DEFAULT_PROJECTION } from './camera-controller'
import { InputController } from '../interaction/input-controller'
import { RenderLoop } from './render-loop'
import type { CameraOptions } from './types'

/**
 * Everything the viewer can emit.
 *
 * The eight `media-*` events are the source's, re-emitted with `target` rewritten
 * to the viewer. They are declared here rather than left to the source's own
 * `MediaEvents`, because a consumer holds a viewer and never a source:
 * `viewer.on('media-play', ...)` has to typecheck against the payload the viewer
 * actually hands out, which is `{ target: Viewer }`.
 */
export interface ViewerEvents extends EventMap {
  rotate: { lat: number, lng: number }
  zoom: { delta: number }
  'device-lost': DeviceLost
  'media-load': { target: Viewer }
  'media-error': { target: Viewer, error: unknown }
  'media-play': { target: Viewer }
  'media-pause': { target: Viewer }
  'media-ended': { target: Viewer }
  'media-seeking': { target: Viewer }
  'media-seeked': { target: Viewer }
  'media-progress': { target: Viewer }
}

/** What the constructor needs. Subclasses assemble it; nobody else does. */
export interface ViewerInit {
  /** The element the canvas is appended to. */
  readonly container: HTMLElement
  /**
   * The canvas to draw into.
   *
   * Created by the caller, not here, because acquiring a GPU device needs a
   * canvas and is asynchronous: it has to exist before this constructor runs, and
   * the backend was built from it. Ownership transfers at construction -- the
   * viewer appends it and removes it on dispose, so there is exactly one canvas
   * and the one the backend draws into is the one in the DOM. The legacy viewer
   * built its own canvas internally, which is why `renderer-canvas` (the class
   * its gesture callbacks were bound to) was not the canvas anybody was drawing
   * into.
   */
  readonly canvas: HTMLCanvasElement
  readonly camera: CameraOptions | undefined
  readonly backend: Backend
}

/**
 * A copy of a projection, deep enough that nothing the caller holds aliases the
 * controller's.
 *
 * `extent` is copied as well as the object: it is an array, so a shallow copy
 * would still share it, and `projection.extent[0] = 4` would reach the shader
 * through a write that looks like it touches only the caller's own value.
 *
 * The `linear` branch has no `extent` to copy -- the four-member union is why
 * this is written per kind rather than as a single `structuredClone`.
 *
 * A module-level function rather than a private method because it is genuinely
 * pure and reads no instance state. That matters at exactly one call site: the
 * constructor needs the copy before `#camera` exists, so a private method would
 * be running against a half-initialised `this` and would stay safe only for as
 * long as nobody later had it read a field.
 */
function snapshotProjection (projection: Projection): Projection {
  return projection.kind === 'linear'
    ? { ...projection }
    : { ...projection, extent: [...projection.extent] }
}

export class Viewer extends Disposable {
  protected readonly events = new EventEmitter<ViewerEvents>()
  readonly #camera: CameraController
  readonly #input: InputController
  readonly #backend: Backend
  readonly #loop: RenderLoop
  protected readonly canvas: HTMLCanvasElement
  /** The current source. Assigned through `setSource`, never directly. */
  protected source: MediaSource | undefined
  #sourceOffs: Array<() => void> = []
  #offDeviceLost: (() => void) | undefined
  #lastSourceVersion = -1
  #disposing = false

  constructor (init: ViewerInit) {
    super()
    this.canvas = init.canvas
    this.canvas.className = 'pano-canvas'
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%'
    })
    init.container.appendChild(this.canvas)

    this.#backend = init.backend
    // The projection is copied here too. This is the door a real application
    // comes through -- a public viewer class passes its caller's `camera`
    // straight in -- and `CameraController` stores what it is given, so without
    // this the caller keeps write access to live camera state and a write
    // through it never marks the controller dirty. The pose needs no copy:
    // the controller rebuilds it from scalars.
    this.#camera = new CameraController(
      init.camera?.pose,
      init.camera?.projection ? snapshotProjection(init.camera.projection) : DEFAULT_PROJECTION
    )
    this.#input = new InputController(this.canvas)

    this.#loop = new RenderLoop({
      schedule: (cb) => window.requestAnimationFrame(cb),
      cancel: (h) => window.cancelAnimationFrame(h),
      // Consuming the dirty flags HERE, before draw() acquires the swapchain
      // texture. On WebGPU, acquiring and not submitting is a validation error.
      shouldDraw: () => this.#camera.consumeDirty() || this.#sourceChanged(),
      draw: () => this.#drawFrame(),
      // A trace channel, not `console.error`. An application that wants to report
      // a failed frame reads the channel; one that does not is not shouted at.
      // Spec 7.3: results travel as events, process as debug.
      onError: (error) => { channels.viewer('frame failed %o', error) }
    })

    // The only channel through which a lost device can be reported. Registered
    // before the first frame -- a device can go away at any time, including
    // during startup.
    this.#offDeviceLost = this.#backend.onDeviceLost((lost) => {
      // Emitted BEFORE the teardown below, and that order is the point: a
      // consumer that learns about the loss can still read the viewer, and a
      // listener that calls `dispose()` itself finds the work already done
      // instead of re-entering it (`#disposing`).
      this.events.emit('device-lost', lost)
      this.dispose()
    })

    this.#input.on('pan', ({ deltaX, deltaY }) => {
      const d = this.#input.dragToRotation(deltaX, deltaY, {
        width: this.canvas.clientWidth,
        height: this.canvas.clientHeight
      })
      if (d.lat === 0 && d.lng === 0) return
      this.#camera.rotate(d.lat, d.lng)
      this.events.emit('rotate', { lat: d.lat, lng: d.lng })
    })
    this.#input.on('zoom', ({ delta }) => {
      this.#camera.zoom(delta)
      this.events.emit('zoom', { delta })
    })

    this.#resize()
    this.#observeResize()
    this.#loop.start()
  }

  /**
   * Subscribes to viewer events. Returns an unsubscribe function.
   *
   * `'*'` receives every event as `(type, event)` -- the typed form of the legacy
   * `trigger('*')`.
   */
  on<K extends keyof ViewerEvents & string> (type: K, fn: (event: ViewerEvents[K]) => void): () => void
  on (type: '*', fn: WildcardListener<ViewerEvents>): () => void
  on (type: string, fn: (...args: never[]) => void): () => void {
    // Bound as well as cast, and the bind is load-bearing. A cast alone detaches
    // the method from its receiver, and `EventEmitter.on` reads `this`:
    // measured, the unbound form threw "Cannot read properties of undefined
    // (reading '#listeners')" from inside the emitter. `bind` keeps the method
    // attached; the cast only widens the signature to the emitter's
    // implementation one, which is the signature it really has -- TypeScript
    // simply does not offer an implementation signature to callers. Neither
    // public overload can be called from here: the first demands a one-argument
    // callback and the second demands the literal `'*'`.
    const dispatch = this.events.on.bind(this.events) as
    (type: string, fn: (...args: never[]) => void) => () => void
    return dispatch(type, fn)
  }

  /**
   * The device's real limits, as reported by the backend in use.
   *
   * Copied, against the same boundary as `cameraOptions` and for the same
   * reason: this getter is public, the backend is not, and a caller of the
   * constructor holds the backend object. Returning its record directly hands
   * every caller write access to state other callers read -- and the field that
   * suffers is `maxTextureDimension`, the number that decides whether a source
   * must be downscaled, so the corruption is shared rather than local to one
   * application.
   *
   * `adapter` is copied too. `Readonly<Record<string, string>>` is a
   * compile-time modifier exactly as `Projection`'s `readonly` fields are, so a
   * shallow copy would still share the record. Its values are strings, so one
   * more level closes it completely and there is no third level to chase.
   *
   * The backend keeps handing out its live reference, as it should: that is the
   * internal path, and copying there would allocate on every read for nobody's
   * benefit.
   */
  get capabilities (): Capabilities {
    const capabilities = this.#backend.capabilities
    return capabilities.adapter
      ? { ...capabilities, adapter: { ...capabilities.adapter } }
      : { ...capabilities }
  }

  get PTZ (): boolean { return this.#input.PTZ }
  set PTZ (value: boolean) {
    this.assertAlive()
    this.#input.PTZ = value
  }

  /**
   * The camera, as a copy.
   *
   * `CameraController` hands out the objects it holds, and `Projection`'s
   * `readonly` fields are a compile-time modifier only -- so returning them
   * directly would give the caller a writable alias to viewer state. The damage
   * is not that the state moves but that it moves *silently*: a write through
   * the alias leaves the controller's dirty flag clear, so the change never
   * reaches a frame, and the application is left holding an object that
   * disagrees with what is on screen.
   *
   * Copied here and in the setter, which are human-frequency calls, and NOT on
   * `#drawFrame`'s path, which runs once per frame and reads the live reference
   * so that a frame costs no allocation.
   */
  get cameraOptions (): CameraOptions {
    return {
      pose: { ...this.#camera.state },
      projection: snapshotProjection(this.#camera.projection)
    }
  }

  set cameraOptions (options: CameraOptions) {
    this.assertAlive()
    // Only the projection is replaced; the pose is kept. The legacy setter
    // rebuilt the whole camera and reset it to the origin, so changing the
    // projection silently threw away where the user was looking. A caller that
    // wants to move the camera sets `pose` through `rotate` or `setPose`, which
    // is where the clamping lives.
    if (options.pose) this.#camera.setPose({ ...this.#camera.state, ...options.pose })
    // Copied on the way in as well as on the way out. `setProjection` stores
    // what it is given, so passing the caller's object through would leave that
    // caller holding write access to the camera's projection -- the same silent
    // no-redraw write the getter's copy exists to prevent, reaching the state
    // by the other door. Copying on one side only is the arrangement that is
    // incoherent; copying on both closes it. The pose needs no copy here:
    // `setPose` builds a new object rather than adopting this one.
    this.#camera.setProjection(snapshotProjection(options.projection))
  }

  /** Rotates the camera. Public so applications can drive it programmatically. */
  rotate (lat: number, lng: number): void {
    this.assertAlive()
    this.#camera.rotate(lat, lng)
  }

  /** Zooms. No-op for the linear projection, which has no zoom. */
  zoom (delta: number): void {
    this.assertAlive()
    this.#camera.zoom(delta)
  }

  /**
   * Installs a source, replacing any previous one.
   *
   * Written once, here, because a source swap has four parts that must happen
   * together: drop the old subscriptions, dispose the old source, subscribe the
   * new one, and reset the version latch. A subclass that did its own swap would
   * get one of them wrong, and the one it would get wrong is the version latch --
   * which shows up as "the new image never appears", not as an error.
   *
   * @param source - The new source, or `undefined` to detach (what `dispose`
   *   does). A detached viewer draws the background.
   */
  protected setSource (source: MediaSource | undefined): void {
    for (const off of this.#sourceOffs) off()
    this.#sourceOffs = []
    this.source?.dispose()
    this.source = source
    // A new source starts its own version counter at 0, so the latch has to go
    // back to a value no source can produce. Otherwise a swap to a source that
    // has not advanced yet reads as "unchanged" and the canvas keeps the old
    // image.
    this.#lastSourceVersion = -1
    if (source) this.#sourceOffs = this.#forwardMediaEvents(source)
  }

  /**
   * Re-emits a source's media events as the viewer's own.
   *
   * Eight explicit lines rather than a loop over the event names: a loop types
   * the name as a union of all eight, which destroys the emitter's
   * one-name-to-one-payload correlation, and every line would then need a cast.
   * Eight lines is the cheaper half of that trade, and a cast here would quietly
   * accept a payload that does not match the event.
   *
   * `target` is rewritten to the viewer because the source is an implementation
   * detail: an event pointing at it would hand the application an object it was
   * never given.
   */
  #forwardMediaEvents (source: MediaSource): Array<() => void> {
    return [
      source.on('media-load', () => { this.events.emit('media-load', { target: this }) }),
      source.on('media-error', (e) => { this.events.emit('media-error', { target: this, error: e.error }) }),
      source.on('media-play', () => { this.events.emit('media-play', { target: this }) }),
      source.on('media-pause', () => { this.events.emit('media-pause', { target: this }) }),
      source.on('media-ended', () => { this.events.emit('media-ended', { target: this }) }),
      source.on('media-seeking', () => { this.events.emit('media-seeking', { target: this }) }),
      source.on('media-seeked', () => { this.events.emit('media-seeked', { target: this }) }),
      source.on('media-progress', () => { this.events.emit('media-progress', { target: this }) })
    ]
  }

  #resizeObserver: ResizeObserver | undefined

  #observeResize (): void {
    // ResizeObserver rather than a window resize listener: a viewer inside a
    // flex layout or a resizable panel changes size without the window doing so.
    // The legacy code listened on window and additionally called
    // `window.removeEventLstener` -- a typo, so its listener was never removed.
    this.#resizeObserver = new ResizeObserver(() => this.#resize())
    this.#resizeObserver.observe(this.canvas)
  }

  #resize (): void {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    this.#backend.resize(width, height, window.devicePixelRatio || 1)

    // The resize reallocated the drawing buffer, which clears it, so the next
    // frame has to be drawn whether or not the camera changed -- and the linear
    // projection's aspect IS this surface's, which is knowledge only this method
    // has (see `CameraController.setAspect`).
    this.#camera.invalidate()
    // Both axes, not height alone: a collapsed side panel or a splitter dragged
    // shut is zero wide with its height intact, and that is the one layout
    // where width / height is 0 -- a value `setAspect` rejects. A height-only
    // guard turns that layout into a `create()` rejection naming `aspect`, an
    // option the caller never wrote, and after construction into an uncaught
    // throw from inside the ResizeObserver callback on every layout pass.
    if (width > 0 && height > 0) this.#camera.setAspect(width / height)
  }

  #sourceChanged (): boolean {
    if (!this.source) return false
    try {
      const version = this.source.frame.version
      if (version === this.#lastSourceVersion) return false
      this.#lastSourceVersion = version
      return true
    } catch {
      // A source whose metadata has not loaded throws on `frame`. That is not an
      // error condition for the loop -- there is simply nothing to draw yet.
      return false
    }
  }

  #drawFrame (): void {
    const source = this.source
    if (source) {
      // Read the frame fresh every frame. An external texture is destroyed at
      // the end of the task that created it, so a cached snapshot is a
      // use-after-free rather than a stale frame. The frame object is handed to
      // the backend as-is: `MediaFrame` and P3's `RenderableSource` have the same
      // fields by construction, so there is no adapter to drift.
      try {
        this.#backend.setSource(source.frame)
      } catch {
        // Metadata has not loaded yet, so there is no upload description. Not an
        // error: drawing nothing is the correct frame.
        this.#backend.setSource(null)
      }
    } else {
      this.#backend.setSource(null)
    }
    this.#backend.setCamera(this.#camera.state, this.#camera.projection)
    this.#backend.render()
    // After the draw, not before: `version` has to describe the frame just drawn
    // while the backend is reading it. A video advances its version here, which
    // is what makes the next frame draw at all; an image ignores it.
    source?.markFramePresented()
  }

  /**
   * Releases everything, in order.
   *
   * Order matters and is the reason this is written out rather than inherited:
   * stop the producer before dismantling the consumer. The loop must die first,
   * or a frame in flight reaches a destroyed backend.
   *
   * Idempotent, and re-entrant-safe: the device-lost observer calls this from
   * inside a backend callback, and `#disposing` is what keeps that from running
   * the teardown twice before `super.dispose()` has marked the object disposed.
   */
  override dispose (): void {
    if (this.#disposing) return
    this.#disposing = true

    this.#loop.dispose()            // 1. stop producing frames
    this.#offDeviceLost?.()         // 2. stop accepting device-loss reports
    this.#input.dispose()           // 3. stop producing gestures
    this.setSource(undefined)       // 4. stop producing source changes
    this.#backend.dispose()         // 5. tear down the consumer
    this.#resizeObserver?.disconnect()
    this.events.removeAllListeners()
    this.canvas.remove()
    super.dispose()
  }
}
