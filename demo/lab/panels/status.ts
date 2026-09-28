/**
 * Backend/capability status bar: everything the device said about itself.
 *
 * Pure display -- consumes the probe result once, never touches a viewer.
 * On a WebGL2 fallback the panel points at the gpu diagnostics channel,
 * which is where the selection decision is traced.
 */
import { VERSION } from '../../../src/index'
import type { Capabilities, SelectedCapabilities } from '../../../src/index'
import { h } from '../dom'

function row (label: string, value: string): HTMLElement {
  return h('div', { class: 'row' },
    h('span', { class: 'row-label', text: label }),
    h('span', { class: 'row-value', text: value }))
}

export function mountStatusPanel (host: HTMLElement, selected: SelectedCapabilities): void {
  if (selected.backend === 'none') {
    host.append(h('span', { class: 'badge badge-none', text: 'no backend' }))
    return
  }
  const caps: Capabilities = selected
  const textureHint = caps.maxTextureDimension >= 8192
    ? ' (8K passes through)'
    : ' (8K sources downscale)'
  host.append(
    h('div', { class: 'status-head' },
      h('span', { class: `badge badge-${caps.backend}`, text: caps.backend === 'webgpu' ? 'WebGPU' : 'WebGL2' }),
      h('span', { class: 'row-value', text: `v${VERSION}` })),
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
