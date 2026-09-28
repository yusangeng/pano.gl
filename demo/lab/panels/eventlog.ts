/**
 * Event stream + diagnostics: every viewer event, plus the debug channels.
 *
 * The wildcard subscription is the point: `on('*', (type, event) => ...)`
 * receives everything the viewer emits, which is what fills the log. The
 * ring is capped so a long gesture cannot grow it without bound.
 */
import { enableChannels } from '../../../src/index'
import type { LabContext } from '../context'
import { h } from '../dom'
import { formatPayload, formatStamp } from '../format'

// Mirrors the channel names of the library's `channels` record
// (src/diagnostics.ts). The public surface exports enableChannels but not
// the names themselves, so a typo here would enable nothing, silently.
const CHANNELS = ['viewer', 'renderer', 'gpu', 'camera', 'media', 'input'] as const
const MAX_ROWS = 200

export function mountEventLogPanel (host: HTMLElement, ctx: LabContext): void {
  host.append(h('h3', { text: 'Event Log' }))
  const log = h('div', { class: 'log' })
  const filters = new Map<string, boolean>([['rotate', true], ['zoom', true]])
  let follow = true

  const chipRow = h('div', { class: 'chiprow' })
  for (const type of filters.keys()) {
    const chip = h('button', { type: 'button', class: 'chip active', text: type })
    chip.addEventListener('click', () => {
      filters.set(type, !(filters.get(type) ?? false))
      chip.classList.toggle('active', filters.get(type) === true)
    })
    chipRow.append(chip)
  }
  const followButton = h('button', { type: 'button', class: 'chip active', text: 'following' })
  followButton.addEventListener('click', () => {
    follow = !follow
    followButton.textContent = follow ? 'following' : 'paused'
    followButton.classList.toggle('active', follow)
  })
  const clear = h('button', { type: 'button', class: 'chip', text: 'clear' })
  clear.addEventListener('click', () => log.replaceChildren())

  const boxes = h('div', { class: 'chiprow' })
  const boxState = new Map<string, boolean>(CHANNELS.map(channel => [channel, false]))
  let undoChannels: (() => void) | null = null
  const applyChannels = (): void => {
    undoChannels?.()
    undoChannels = null
    const namespaces = CHANNELS
      .filter(channel => boxState.get(channel) === true)
      .map(channel => `pano:${channel}`)
      .join(',')
    if (namespaces === '') {
      // Nothing checked: restoring the pre-panel baseline beats enabling the
      // empty set -- enableChannels('') would clear the persisted debug key
      // (debug's save() removes it on an empty pattern), taking the
      // developer's saved channels with it.
      return
    }
    undoChannels = enableChannels(namespaces)
  }
  for (const channel of CHANNELS) {
    const box = h('input', { type: 'checkbox' })
    box.addEventListener('change', () => {
      boxState.set(channel, box.checked)
      applyChannels()
    })
    boxes.append(h('label', { class: 'check' }, box, h('span', { text: channel })))
  }

  host.append(
    h('div', { class: 'panel-bar' }, chipRow, followButton, clear),
    log,
    h('div', { class: 'diag' },
      h('div', { class: 'label', text: 'Diagnostics' }),
      boxes,
      h('p', {
        class: 'hint',
        text: 'Traces print to the browser console (debug). Enabled channels persist across reloads via localStorage.'
      })))

  let off: (() => void) | null = null
  ctx.onViewer((current) => {
    off?.()
    off = null
    if (current === null) return
    off = current.viewer.on('*', (type, event) => {
      if (filters.get(type) === false) return
      const row = h('div', { class: `log-row log-${type}` },
        h('span', { class: 'log-stamp', text: formatStamp() }),
        h('span', { class: 'log-type', text: type }),
        h('span', { class: 'log-payload', text: formatPayload(type, event) }))
      log.append(row)
      while (log.childElementCount > MAX_ROWS) log.firstElementChild?.remove()
      if (follow) log.scrollTop = log.scrollHeight
    })
  })
}
