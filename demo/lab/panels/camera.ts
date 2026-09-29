/**
 * Camera/projection workbench: kind switching plus the per-kind tunables.
 *
 * This file is the reference example for projection changes. Every change
 * funnels through `ctx.setProjection`, which is `viewer.cameraOptions =
 * { projection }` in the shell -- pose kept, which is why the view does not
 * jump when the kind buttons are clicked.
 */
import type { CameraState, Projection, ProjectionKind } from '../../../src/index'
import { PROJECTION_KINDS } from '../../../src/core/constants'
import type { LabContext } from '../context'
import { defaultProjection } from '../context'
import { h } from '../dom'
import { formatPlain, formatSignedDegrees } from '../format'

// The one source of truth for the kinds (core/projection-kinds.json through
// the generator): a literal here would drift the day a sixth projection lands.
const KINDS: ReadonlyArray<ProjectionKind> = PROJECTION_KINDS

/** zoom lives in [0.01, 1] -- two decades, so the slider is logarithmic. */
const ZOOM_MIN = 0.01

/** Log-slider resolution; the input's max is the same value. */
const SLIDER_STEPS = 1000

function zoomToSlider (zoom: number): number {
  return Math.round((SLIDER_STEPS * Math.log(zoom / ZOOM_MIN)) / Math.log(1 / ZOOM_MIN))
}

function sliderToZoom (position: number): number {
  return ZOOM_MIN * Math.pow(1 / ZOOM_MIN, position / SLIDER_STEPS)
}

function sliderRow (
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  format: (v: number) => string,
  onInput: (v: number) => void
): HTMLElement {
  const input = h('input', {
    class: 'slider',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value)
  })
  const readout = h('span', { class: 'readout', text: format(value) })
  input.addEventListener('input', () => {
    const v = Number(input.value)
    // Callback first: the linear fov path reads layout (surfaceAspect), and
    // a write-then-read order would force one synchronous layout per tick.
    onInput(v)
    readout.textContent = format(v)
  })
  return h('label', { class: 'slider-row' },
    h('span', { class: 'row-label', text: label }), input, readout)
}

export function mountCameraPanel (host: HTMLElement, ctx: LabContext, stage: HTMLElement): void {
  host.append(h('h3', { text: 'Camera / Projection' }))
  const kindBar = h('div', { class: 'segmented' })
  const controls = h('div')
  const poseValue = h('span', { class: 'row-value', text: '-' })
  host.append(kindBar, controls,
    h('div', { class: 'row' }, h('span', { class: 'row-label', text: 'pose' }), poseValue))

  /** Per-kind memory, so switching away and back restores what was tuned. */
  const memory = new Map<ProjectionKind, Projection>(KINDS.map(kind => [kind, defaultProjection(kind)]))
  /**
   * The linear aspect is the stage's live width/height ratio -- the same value
   * the viewer's own resize handler feeds setAspect -- measured at every write
   * so no cached value can go stale across a resize.
   */
  const surfaceAspect = (): number => {
    const width = stage.clientWidth
    const height = stage.clientHeight
    // Collapsed layout: fall back to square rather than NaN/Infinity (same
    // rationale as the viewer's own zero-size guard in its resize handler).
    return width > 0 && height > 0 ? width / height : 1
  }

  const currentKind = (): ProjectionKind => {
    const active = kindBar.querySelector('button.active')
    return (active?.getAttribute('data-kind') ?? 'linear') as ProjectionKind
  }

  const apply = (): void => {
    const remembered = memory.get(currentKind())
    if (remembered === undefined) return
    if (remembered.kind === 'linear') {
      ctx.setProjection({ ...remembered, aspect: surfaceAspect() })
      return
    }
    ctx.setProjection(remembered)
  }

  function renderKind (kind: ProjectionKind): void {
    for (const button of Array.from(kindBar.children)) {
      button.classList.toggle('active', button.getAttribute('data-kind') === kind)
    }
    controls.replaceChildren()
    const remembered = memory.get(kind)
    if (remembered === undefined) return
    if (remembered.kind === 'linear') {
      controls.append(
        sliderRow('fov', 15, 110, 1, Math.round((remembered.fov * 180) / Math.PI),
          v => `${v}°`,
          v => {
            memory.set('linear', { kind: 'linear', fov: (v * Math.PI) / 180, aspect: surfaceAspect() })
            apply()
          }),
        h('div', { class: 'row' },
          h('span', { class: 'row-label', text: 'aspect' }),
          h('span', { class: 'row-value', text: surfaceAspect().toFixed(2) })))
      return
    }
    controls.append(
      sliderRow('zoom', 0, SLIDER_STEPS, 1, zoomToSlider(remembered.zoom),
        v => formatPlain(sliderToZoom(v)),
        v => {
          const current = memory.get(kind)
          if (current === undefined || current.kind === 'linear') return
          memory.set(current.kind, { kind: current.kind, zoom: sliderToZoom(v), extent: current.extent })
          apply()
        }),
      sliderRow('extent', 0.5, 8, 0.1, remembered.extent[0],
        v => formatPlain(v),
        v => {
          const current = memory.get(kind)
          if (current === undefined || current.kind === 'linear') return
          memory.set(current.kind, { kind: current.kind, zoom: current.zoom, extent: [v, v] })
          apply()
        }))
  }

  /** Adopt the viewer's authoritative (possibly clamped) projection. */
  function refreshFromViewer (projection: Projection): void {
    memory.set(projection.kind, projection)
    renderKind(projection.kind)
  }

  for (const kind of KINDS) {
    const button = h('button', { type: 'button', text: kind, 'data-kind': kind })
    button.addEventListener('click', () => {
      renderKind(kind)
      apply()
    })
    kindBar.append(button)
  }

  let off: (() => void) | null = null
  ctx.onViewer((current) => {
    off?.()
    off = null
    if (current === null) return
    refreshFromViewer(current.viewer.cameraOptions.projection)
    const refreshPose = (): void => {
      // The getter always returns a full pose (the optional in the type serves the setter); the cast documents that contract.
      const state = current.viewer.cameraOptions.pose as CameraState
      poseValue.textContent =
        `lat ${formatSignedDegrees(state.povLatitude)} lng ${formatSignedDegrees(state.povLongitude)}`
    }
    refreshPose()
    // rotate carries a delta -- the signal to re-read the absolute pose.
    // zoom moves the projection parameters -- the signal to re-read sliders.
    const offRotate = current.viewer.on('rotate', refreshPose)
    const offZoom = current.viewer.on('zoom', () => refreshFromViewer(current.viewer.cameraOptions.projection))
    off = () => { offRotate(); offZoom() }
  })
}
