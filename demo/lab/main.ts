/**
 * Lab shell: probes the device, owns the viewer lifecycle, mounts the panels.
 *
 * The three swap paths the lab exists to demonstrate, each with its own API:
 *  - projection change -> `viewer.cameraOptions = { projection }` (pose kept)
 *  - same-class source  -> `viewer.src = url` (pose and projection kept)
 *  - image <-> video    -> dispose + recreate the other class, pose carried over
 *
 * The URL query (`?projection=planet&zoom=0.5&source=video`) is lab state as
 * a bookmark: read once at boot, written back on every change.
 */
import { FramelessImageViewer, FramelessVideoViewer } from '../../src/index'
import type { CameraState, Projection, SelectedCapabilities } from '../../src/index'
import { ViewerBox, defaultProjection } from './context'
import type { LabContext, LabViewer, SourceId } from './context'
import { h } from './dom'
import { mountStatusPanel } from './panels/status'
import './lab.css'

const SOURCE_URLS: Readonly<Record<SourceId, string>> = {
  '2k': '/image/2048x1024.jpg',
  '4k': '/image/4096x2048.jpg',
  '8k': '/image/8192x4096.jpg',
  video: '/video/city.mp4'
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
function readUrlState (): { projection: Projection, source: SourceId } {
  const params = new URLSearchParams(window.location.search)
  const kindParam = params.get('projection')
  const sourceParam = params.get('source')
  const source = SOURCE_IDS.find(s => s === sourceParam) ?? '2k'
  const fallback = defaultProjection(
    (['linear', 'cylindrical', 'planet', 'pannini'] as const).find(k => k === kindParam) ?? 'linear')
  if (fallback.kind === 'linear') {
    const fovDeg = parseNumber(params.get('fov'), 15, 110, (fallback.fov * 180) / Math.PI)
    return { projection: { kind: 'linear', fov: (fovDeg * Math.PI) / 180, aspect: fallback.aspect }, source }
  }
  const extent = parseNumber(params.get('extent'), 0.5, 8, fallback.extent[0])
  return {
    projection: {
      kind: fallback.kind,
      zoom: parseNumber(params.get('zoom'), 0.01, 1, fallback.zoom),
      extent: [extent, extent]
    },
    source
  }
}

/** Bookmark out: the URL always mirrors what is on screen. */
function writeUrlState (current: LabViewer): void {
  const projection = current.viewer.cameraOptions.projection
  const params = new URLSearchParams({ projection: projection.kind, source: current.source })
  if (projection.kind === 'linear') {
    params.set('fov', String(Math.round((projection.fov * 180) / Math.PI)))
  } else {
    params.set('zoom', projection.zoom.toFixed(2))
    params.set('extent', projection.extent[0].toFixed(2))
  }
  window.history.replaceState(null, '', `?${params.toString()}`)
}

function showBanner (banner: HTMLElement, title: string, detail: string, fatal: boolean): void {
  const card = h('div', { class: 'banner-card' }, h('h2', { text: title }), h('p', { text: detail }))
  if (fatal) {
    const reload = h('button', { type: 'button', text: 'Reload' })
    reload.addEventListener('click', () => window.location.reload())
    card.append(reload)
  }
  banner.replaceChildren(card)
  banner.hidden = false
}

async function boot (): Promise<void> {
  const stage = required<HTMLElement>('#stage')
  const banner = required<HTMLElement>('#page-banner')
  const selected: SelectedCapabilities = await FramelessImageViewer.probe()
  mountStatusPanel(required('#status-panel'), selected)

  if (selected.backend === 'none') {
    showBanner(banner, 'No rendering backend',
      'Neither WebGPU nor WebGL2 is available in this browser, so there is nothing to render with. Try a browser with WebGPU (or at least WebGL2) enabled.', true)
    return
  }

  const viewers = new ViewerBox()

  const installViewer = async (
    source: SourceId,
    projection: Projection,
    pose?: Partial<CameraState>
  ): Promise<void> => {
    const camera = pose === undefined ? { projection } : { projection, pose }
    const viewer = source === 'video'
      ? await FramelessVideoViewer.create({ container: stage, src: SOURCE_URLS[source], camera })
      : await FramelessImageViewer.create({ container: stage, src: SOURCE_URLS[source], camera })
    viewer.on('device-lost', (lost) => {
      // v1 has no automatic recovery; the lab says so instead of pretending.
      required('#status-panel').classList.add('lost')
      showBanner(banner, 'Device lost', `${lost.reason}: ${lost.message}. v1 has no automatic recovery -- reload to retry.`, true)
    })
    const handle: LabViewer = { viewer, mode: source === 'video' ? 'video' : 'image', source }
    viewers.publish(handle)
    writeUrlState(handle)
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
      writeUrlState(handle)
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

  // ctx has no consumer until the camera panel mounts (Task 4); the
  // directive is removed there.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const ctx: LabContext = {
    setProjection: (projection) => {
      const current = viewers.current
      if (current === null) return
      current.viewer.cameraOptions = { projection }
      writeUrlState(current)
    },
    setSource: (source) => {
      applySource(source).catch((error) => showBanner(banner, 'Source switch failed', String(error), true))
    },
    onViewer: (listener) => viewers.subscribe(listener)
  }

  // Panel mounts are added here by Tasks 3-6, BEFORE installViewer publishes
  // the first viewer, so panels observe the full lifecycle from the null
  // state; a later mount would still receive the current viewer, because
  // subscribe fires the listener immediately.

  const state = readUrlState()
  await installViewer(state.source, state.projection)
}

await boot().catch((error) => {
  const banner = document.querySelector<HTMLElement>('#page-banner')
  if (banner !== null) showBanner(banner, 'Viewer creation failed', String(error), true)
})
