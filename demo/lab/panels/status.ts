/**
 * Backend/capability status bar: everything the device said about itself,
 * plus the switch that asks for a backend by name.
 *
 * The badge and the rows are FACTS about the LIVE viewer: every publish from
 * the shell re-renders the panel from `viewer.capabilities`, so a backend
 * switch flips the badge and the hint with it; while the box is null --
 * before the first viewer, across an async recreate -- they fall back to the
 * boot probe's facts. The segmented control is the shell's PREFERENCE, what
 * the next `create` will request, and on a WebGPU machine with 'auto'
 * selected the two deliberately disagree (control: auto, badge: WebGPU). A
 * backend this browser cannot honour is left clickable on purpose: the
 * full-page banner it raises is the strict `backend` semantics being
 * demonstrated, not a state to grey out (spec 2026-09-28-backend-preference §3).
 */
import { VERSION } from '../../../src/index'
import type { BackendPreference, Capabilities, SelectedCapabilities } from '../../../src/index'
import type { LabViewer } from '../context'
import { h } from '../dom'

function row (label: string, value: string): HTMLElement {
  return h('div', { class: 'row' },
    h('span', { class: 'row-label', text: label }),
    h('span', { class: 'row-value', text: value }))
}

const BACKENDS: ReadonlyArray<{ readonly value: BackendPreference, readonly label: string }> = [
  { value: 'auto', label: 'auto' },
  { value: 'webgpu', label: 'WebGPU' },
  { value: 'webgl2', label: 'WebGL2' }
]

export function mountStatusPanel (
  host: HTMLElement,
  selected: SelectedCapabilities,
  getBackend: () => BackendPreference,
  setBackend: (backend: BackendPreference) => void,
  onViewer: (listener: (current: LabViewer | null) => void) => () => void
): void {
  if (selected.backend === 'none') {
    host.append(h('span', { class: 'badge badge-none', text: 'no backend' }))
    return
  }
  // One render path for the whole lifecycle: the shell's ViewerBox fires the
  // listener immediately with null (probe facts), then again on every
  // publish -- first viewer, source swap, backend switch, device loss.
  const render = (current: LabViewer | null): void => {
    // While the box is null across an async recreate the panel shows probe
    // facts; the switch replaces the whole viewer, so there is nothing more
    // precise to show until the new one publishes.
    const caps: Capabilities = current === null ? selected : current.viewer.capabilities
    const textureHint = caps.maxTextureDimension >= 8192
      ? ' (8K passes through)'
      : ' (8K sources downscale)'

    // The active state is read from getBackend() at render time: the
    // preference lives in the shell, and every publish re-renders, so the
    // control keeps no local state of its own.
    const control = h('div', { class: 'segmented' })
    for (const { value, label } of BACKENDS) {
      const button = h('button', { type: 'button', text: label })
      if (value === getBackend()) button.classList.add('active')
      button.addEventListener('click', () => setBackend(value))
      control.append(button)
    }

    host.replaceChildren(
      h('div', { class: 'status-head' },
        h('span', { class: `badge badge-${caps.backend}`, text: caps.backend === 'webgpu' ? 'WebGPU' : 'WebGL2' }),
        h('span', { class: 'row-value', text: `v${VERSION}` })),
      control,
      row('devicePixelRatio', String(window.devicePixelRatio)),
      row('maxTextureDimension', `${caps.maxTextureDimension}${textureHint}`),
      row('externalTextures', caps.externalTextures ? 'yes' : 'no'))
    for (const [key, value] of Object.entries(caps.adapter ?? {})) {
      host.append(row(key, value))
    }
    if (caps.backend === 'webgl2') {
      host.append(h('p', {
        class: 'hint',
        text: 'Why WebGL2? Enable the gpu channel under Diagnostics and read the browser console.'
      }))
    }
  }
  onViewer(render)
}
