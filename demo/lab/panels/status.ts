/**
 * Backend/capability status bar: everything the device said about itself,
 * plus the switch that asks for a backend by name.
 *
 * The badge and the rows are FACTS -- what the device handed out. The
 * segmented control is the shell's PREFERENCE, what the next `create` will
 * request, and on a WebGPU machine with 'auto' selected the two deliberately
 * disagree (control: auto, badge: WebGPU). A backend this browser cannot
 * honour is left clickable on purpose: the full-page banner it raises is the
 * strict `backend` semantics being demonstrated, not a state to grey out
 * (spec 2026-09-28-backend-preference §3).
 */
import { VERSION } from '../../../src/index'
import type { BackendPreference, Capabilities, SelectedCapabilities } from '../../../src/index'
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
  backend: BackendPreference,
  setBackend: (backend: BackendPreference) => void
): void {
  if (selected.backend === 'none') {
    host.append(h('span', { class: 'badge badge-none', text: 'no backend' }))
    return
  }
  const caps: Capabilities = selected
  const textureHint = caps.maxTextureDimension >= 8192
    ? ' (8K passes through)'
    : ' (8K sources downscale)'

  // Local active-state only: the preference changes nowhere but here (the
  // shell's setBackend no-ops a repeat), so there is nothing to subscribe to.
  const control = h('div', { class: 'segmented' })
  const buttons = new Map<BackendPreference, HTMLButtonElement>()
  for (const { value, label } of BACKENDS) {
    const button = h('button', { type: 'button', text: label })
    if (value === backend) button.classList.add('active')
    button.addEventListener('click', () => {
      for (const [candidate, b] of buttons) b.classList.toggle('active', candidate === value)
      setBackend(value)
    })
    buttons.set(value, button)
    control.append(button)
  }

  host.append(
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
