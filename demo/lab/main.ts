/**
 * Lab shell: probes the device, owns the viewer lifecycle, mounts the panels.
 *
 * The three swap paths the lab exists to demonstrate, each with its own API:
 *  - projection change -> `viewer.cameraOptions = { projection }` (pose kept)
 *  - same-class source  -> `viewer.src = url` (pose and projection kept)
 *  - image <-> video    -> dispose + recreate the other class, pose carried over
 *  - backend preference -> dispose + recreate with the `backend` option (pose carried, video playback restarts)
 *
 * The URL query (`?projection=planet&zoom=0.5&source=video`) is lab state as
 * a bookmark: read once at boot, written back on every change.
 */
import { FramelessImageViewer, FramelessVideoViewer } from '../../src/index'
import type { BackendPreference, CameraState, Projection, SelectedCapabilities } from '../../src/index'
import { assetUrl } from '../asset-url'
import { ViewerBox, defaultProjection } from './context'
import type { LabContext, LabViewer, SourceId } from './context'
import { h } from './dom'
import { mountStatusPanel } from './panels/status'
import { mountCameraPanel } from './panels/camera'
import { mountMediaPanel } from './panels/media'
import { mountEventLogPanel } from './panels/eventlog'
import './lab.css'

// assetUrl: the deployed demo lives under /pano.gl/ on GitHub Pages, so
// root-absolute media paths must resolve against the page's real base.
const SOURCE_URLS: Readonly<Record<SourceId, string>> = {
  '2k': assetUrl('/image/2048x1024.jpg'),
  '4k': assetUrl('/image/4096x2048.jpg'),
  '8k': assetUrl('/image/8192x4096.jpg'),
  video: assetUrl('/video/city.mp4')
}

const SOURCE_IDS: ReadonlyArray<SourceId> = ['2k', '4k', '8k', 'video']

function required<E extends Element> (selector: string): E {
  const el = document.querySelector<E>(selector)
  if (el === null) throw new Error(`lab: ${selector} missing from the page`)
  return el
}

function parseNumber (raw: string | null, min: number, max: number, fallback: number): number {
  const value = raw === null || raw.trim() === '' ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/** Bookmark in: invalid values silently fall back (a bookmark is a convenience, not an interface). */
function readUrlState (): { projection: Projection, source: SourceId, backend: BackendPreference } {
  const params = new URLSearchParams(window.location.search)
  const kindParam = params.get('projection')
  const sourceParam = params.get('source')
  const source = SOURCE_IDS.find(s => s === sourceParam) ?? '2k'
  // The preference, never the capability: a bookmark taken on a WebGPU
  // machine must not pin a WebGL2-only machine to 'webgpu' (spec §3).
  const backend: BackendPreference =
    (['auto', 'webgpu', 'webgl2'] as const).find(b => b === params.get('backend')) ?? 'auto'
  const fallback = defaultProjection(
    (['linear', 'cylindrical', 'planet', 'pannini'] as const).find(k => k === kindParam) ?? 'linear')
  if (fallback.kind === 'linear') {
    const fovDeg = parseNumber(params.get('fov'), 15, 110, (fallback.fov * 180) / Math.PI)
    return {
      projection: { kind: 'linear', fov: (fovDeg * Math.PI) / 180, aspect: fallback.aspect },
      source,
      backend
    }
  }
  const extent = parseNumber(params.get('extent'), 0.5, 8, fallback.extent[0])
  return {
    projection: {
      kind: fallback.kind,
      zoom: parseNumber(params.get('zoom'), 0.01, 1, fallback.zoom),
      extent: [extent, extent]
    },
    source,
    backend
  }
}

/** Bookmark out: the URL always mirrors what is on screen. */
function writeUrlState (current: LabViewer, backend: BackendPreference): void {
  const projection = current.viewer.cameraOptions.projection
  // 'backend' mirrors the shell's PREFERENCE, not viewer.capabilities.backend
  // -- the same reasoning as readUrlState's parse above.
  const params = new URLSearchParams({ projection: projection.kind, source: current.source, backend })
  if (projection.kind === 'linear') {
    params.set('fov', String(Math.round((projection.fov * 180) / Math.PI)))
  } else {
    params.set('zoom', projection.zoom.toFixed(2))
    params.set('extent', projection.extent[0].toFixed(2))
  }
  try {
    window.history.replaceState(null, '', `?${params.toString()}`)
  } catch {
    // Safari throws past its replaceState rate cap. The URL is a convenience
    // mirror, so a dropped write beats throwing out of an event listener,
    // which would starve every listener registered after this one.
  }
}

function showBanner (banner: HTMLElement, title: string, detail: string): void {
  const card = h('div', { class: 'banner-card' }, h('h2', { text: title }), h('p', { text: detail }))
  // Every lab banner is terminal: v1 has no in-page recovery, reload is the out.
  const reload = h('button', { type: 'button', text: 'Reload' })
  reload.addEventListener('click', () => window.location.reload())
  card.append(reload)
  banner.replaceChildren(card)
  banner.hidden = false
}

async function boot (): Promise<void> {
  const stage = required<HTMLElement>('#stage')
  const banner = required<HTMLElement>('#page-banner')
  const selected: SelectedCapabilities = await FramelessImageViewer.probe()
  // Hoisted above the panel mounts so the status switch knows the initial
  // preference: pure URL reading, nothing here needs a viewer.
  const state = readUrlState()
  let backendPref: BackendPreference = state.backend
  let pendingBackend: BackendPreference | null = null
  const viewers = new ViewerBox()

  // The control shows the preference; the badge above it shows the fact.
  // Switching backends is the cross-class swap's machine again -- the
  // backend binds to the canvas and the device at create time, so there is
  // nothing to mutate -- with one addition the other swaps do not have: the
  // URL must follow only on success, because the lab's banners are terminal
  // and Reload is their only recovery. writeUrlState runs inside
  // installViewer, i.e. after a successful create, so a failed force leaves
  // the bookmark on the last working state and Reload is a way out, not a
  // loop (spec §3). installViewer is referenced before its definition; a
  // click cannot fire between this definition and that one, because there
  // is no await between them.
  const setBackend = (backend: BackendPreference): void => {
    // A click inside the recreate window queues rather than mutates: the
    // landing installViewer drains it, so the last click wins and the URL
    // never names a backend the viewer is not running.
    const current = viewers.current
    if (current === null) {
      pendingBackend = backend
      return
    }
    if (backend === backendPref) return
    backendPref = backend
    const carried = current.viewer.cameraOptions
    viewers.publish(null)
    current.viewer.dispose()
    installViewer(current.source, carried.projection, carried.pose)
      .catch((error) => showBanner(banner, 'Backend switch failed', String(error)))
  }

  mountStatusPanel(required('#status-panel'), selected, () => backendPref, setBackend, (listener) => viewers.subscribe(listener))

  if (selected.backend === 'none') {
    showBanner(banner, 'No rendering backend',
      'Neither WebGPU nor WebGL2 is available in this browser, so there is nothing to render with. Try a browser with WebGPU (or at least WebGL2) enabled.')
    return
  }

  let urlWriteTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Collapses high-frequency changes (wheel zoom, slider drags) into one
   * trailing bookmark write. Browsers cap replaceState at roughly 100 calls
   * per 30 seconds, and WebKit throws past its cap; one write per event
   * both stalls at the cap and, there, throws out of the listener. The
   * handle is re-read at flush time rather than captured, so a same-class
   * source swap cannot leak a stale source id into the URL.
   */
  const scheduleUrlWrite = (): void => {
    if (urlWriteTimer !== null) clearTimeout(urlWriteTimer)
    urlWriteTimer = setTimeout(() => {
      urlWriteTimer = null
      const current = viewers.current
      if (current !== null) writeUrlState(current, backendPref)
    }, 250)
  }

  const installViewer = async (
    source: SourceId,
    projection: Projection,
    pose?: Partial<CameraState>
  ): Promise<void> => {
    const camera = pose === undefined ? { projection } : { projection, pose }
    // 'auto' is a member of the union, so the preference passes through
    // unconditionally -- no spread dance for the default case.
    const viewer = source === 'video'
      ? await FramelessVideoViewer.create({ container: stage, src: SOURCE_URLS[source], camera, backend: backendPref })
      : await FramelessImageViewer.create({ container: stage, src: SOURCE_URLS[source], camera, backend: backendPref })
    viewer.on('device-lost', (lost) => {
      // v1 has no automatic recovery; the lab says so instead of pretending.
      // Dropping the handle also detaches the panels: the banner stops
      // pointers, but keyboard focus can still reach their controls, and a
      // panel edit would otherwise call into a dead viewer.
      viewers.publish(null)
      required('#status-panel').classList.add('lost')
      showBanner(banner, 'Device lost', `${lost.reason}: ${lost.message}. v1 has no automatic recovery -- reload to retry.`)
    })
    // Wheel zoom mutates the projection inside the library without passing
    // through the shell, so the bookmark needs its own hook here. The write
    // is debounced above and reads the handle at flush time.
    viewer.on('zoom', scheduleUrlWrite)
    const handle: LabViewer = { viewer, mode: source === 'video' ? 'video' : 'image', source }
    viewers.publish(handle)
    writeUrlState(handle, backendPref)
    // Drain a backend click that landed while this create was in flight. The
    // read-and-clear must precede the call: setBackend may start another
    // recreate, and a stale pending would replay a superseded click. Covers
    // both entry paths -- a backend switch and a cross-class source swap.
    const queued = pendingBackend
    pendingBackend = null
    if (queued !== null) setBackend(queued)
  }

  const applySource = async (target: SourceId): Promise<void> => {
    const current = viewers.current
    if (current === null || current.source === target) return
    if ((target === 'video') === (current.mode === 'video')) {
      // Same class: a source swap is not a reconfiguration -- pose and
      // projection survive the `src` setter, which is the point of this path.
      current.viewer.src = SOURCE_URLS[target]
      const handle = { viewer: current.viewer, mode: current.mode, source: target }
      viewers.publish(handle)
      writeUrlState(handle, backendPref)
      return
    }
    // Cross class: the one migration v1 leaves to the application. Carry the
    // pose over by hand, then rebuild the other viewer from scratch.
    const carried = current.viewer.cameraOptions
    // The box holds null across the async recreate, so re-entrant clicks no-op and panels drop their dead viewer instead of calling into it.
    viewers.publish(null)
    current.viewer.dispose()
    await installViewer(target, carried.projection, carried.pose)
  }

  const ctx: LabContext = {
    setProjection: (projection) => {
      const current = viewers.current
      if (current === null) return
      current.viewer.cameraOptions = { projection }
      scheduleUrlWrite()
    },
    setSource: (source) => {
      applySource(source).catch((error) => showBanner(banner, 'Source switch failed', String(error)))
    },
    setBackend,
    onViewer: (listener) => viewers.subscribe(listener)
  }

  // Panel mounts happen here, BEFORE installViewer publishes
  // the first viewer, so panels observe the full lifecycle from the null
  // state; a later mount would still receive the current viewer, because
  // subscribe fires the listener immediately.
  mountCameraPanel(required('#camera-panel'), ctx, stage)
  mountMediaPanel(required('#media-panel'), ctx)
  mountEventLogPanel(required('#eventlog-panel'), ctx)

  await installViewer(state.source, state.projection)
}

await boot().catch((error) => {
  // A boot that failed because of a backend param in the URL would come back
  // to the same failure on Reload -- and Reload is the banner's only
  // recovery. The strip is unconditional rather than cause-sorted, so it also
  // fires after failures the param had nothing to do with, and its cost is
  // asymmetric by member: auto agrees with a working 'webgpu' force
  // (selection is WebGPU-first), but a working 'webgl2' force on a
  // dual-capable machine reloads onto WebGPU. That downgrade after an
  // unrelated failure is the accepted price of not cause-sorting; matching
  // error text to the param would be brittler than the state it protects
  // (spec §3/§4).
  const params = new URLSearchParams(window.location.search)
  if (params.get('backend') !== null) {
    params.delete('backend')
    // An emptied query writes the bare path, not a trailing '?' -- the other
    // URL writers in this file never leave a bare question mark behind.
    const query = params.toString()
    try {
      window.history.replaceState(null, '', query === '' ? window.location.pathname : `?${query}`)
    } catch {
      // Same guard as writeUrlState: a history API that throws (a sandboxed
      // iframe, an opaque origin) must not preempt the banner below -- an
      // unstripped param costs a retry in 'auto', a preempted banner costs
      // the page's only explanation.
    }
  }
  const banner = document.querySelector<HTMLElement>('#page-banner')
  if (banner !== null) {
    showBanner(banner, 'Viewer creation failed', String(error))
  } else {
    // A page without the banner element still owes the console the failure
    // instead of a silently blank stage.
    console.error(error)
  }
})
