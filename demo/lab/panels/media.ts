/**
 * Media source workbench: 2K/4K/8K/video switching and the video transport.
 *
 * Source changes funnel through the shell (`ctx.setSource`): same-class
 * swaps use the `src` setter and survive intact; image <-> video recreates
 * the viewer with the pose carried over. The transport row is the reference
 * example for `play()` / `pause()` / `element.currentTime` -- including a
 * `play()` rejection shown, not swallowed.
 */
import type { FramelessVideoViewer } from '../../../src/index'
import type { LabContext, SourceId } from '../context'
import { h } from '../dom'
import { formatTimecode } from '../format'

const SOURCES: ReadonlyArray<{ readonly id: SourceId, readonly label: string }> = [
  { id: '2k', label: '2K' },
  { id: '4k', label: '4K' },
  { id: '8k', label: '8K' },
  { id: 'video', label: 'Video' }
]

/** Seek slider resolution; the input position is a fraction of duration. */
const SEEK_STEPS = 1000

export function mountMediaPanel (host: HTMLElement, ctx: LabContext): void {
  host.append(h('h3', { text: 'Media Source' }))
  const sourceBar = h('div', { class: 'segmented' })
  const buttons = new Map<SourceId, HTMLButtonElement>()
  for (const { id, label } of SOURCES) {
    const button = h('button', { type: 'button', text: label })
    button.addEventListener('click', () => ctx.setSource(id))
    buttons.set(id, button)
    sourceBar.append(button)
  }
  const chip = h('span', { class: 'chip chip-loading', text: 'idle' })
  const playHint = h('p', { class: 'hint', hidden: true })
  const transport = h('div', { class: 'transport', hidden: true })
  host.append(sourceBar,
    h('div', { class: 'row' }, h('span', { class: 'row-label', text: 'state' }), chip),
    playHint, transport)

  function setChip (className: string, text: string): void {
    chip.className = `chip ${className}`
    chip.textContent = text
  }

  let cleanup: (() => void) | null = null

  ctx.onViewer((current) => {
    cleanup?.()
    cleanup = null
    // Hidden AND emptied: the row's controls are wired to the viewer being
    // discarded, so they must not linger in the DOM behind the hidden flag.
    transport.hidden = true
    transport.replaceChildren()
    playHint.hidden = true
    if (current === null) return
    for (const [id, button] of buttons) button.classList.toggle('active', id === current.source)
    setChip('chip-loading', 'loading')
    const viewer = current.viewer
    const offs = [
      viewer.on('media-load', () => setChip('chip-loaded', 'loaded')),
      viewer.on('media-error', (event) => setChip('chip-error', `error: ${String(event.error)}`))
    ]
    // The mode field discriminates the union; the cast is the documented
    // narrowing (video.element exists only on FramelessVideoViewer).
    cleanup = current.mode === 'video'
      ? wireTransport(viewer as FramelessVideoViewer, offs)
      : () => { for (const off of offs) off() }
  })

  /**
   * Builds the transport row against one video viewer instance. Everything
   * created here dies with the returned cleanup, so a viewer recreation can
   * never leave a stale <video> element wired into the panel.
   */
  function wireTransport (video: FramelessVideoViewer, offs: Array<() => void>): () => void {
    const element = video.element
    const ac = new AbortController()
    const listen = (name: string, fn: () => void): void => {
      element.addEventListener(name, fn, { signal: ac.signal })
    }

    const play = h('button', { type: 'button', text: 'Play' })
    const seek = h('input', { class: 'slider', type: 'range', min: '0', max: String(SEEK_STEPS), step: '1', value: '0' })
    const time = h('span', { class: 'readout', text: '--:-- / --:--' })
    const mute = h('button', { type: 'button', text: 'Mute' })
    transport.replaceChildren(play, seek, time, mute)
    transport.hidden = false

    let scrubbing = false
    let alive = true
    const refreshPlay = (): void => {
      play.textContent = element.paused ? 'Play' : 'Pause'
    }
    const refreshMute = (): void => {
      mute.textContent = element.muted ? 'Unmute' : 'Mute'
    }
    const refreshTime = (): void => {
      const duration = element.duration
      time.textContent = `${formatTimecode(element.currentTime)} / ${formatTimecode(duration)}`
      if (!scrubbing && Number.isFinite(duration) && duration > 0) {
        seek.value = String(Math.round((element.currentTime / duration) * SEEK_STEPS))
      }
    }

    play.addEventListener('click', () => {
      if (element.paused) {
        // The rejection is shown, not swallowed: an unmuted play() can be
        // refused by the browser's autoplay policy, and the lab exists to
        // make that visible.
        video.play().catch((error) => {
          // The wiring may already be dead: a source switch disposes the viewer,
          // which pauses the element and rejects a still-pending play(). A
          // refusal from a dead viewer is not a message for the panel now on
          // screen.
          if (!alive) return
          playHint.hidden = false
          playHint.textContent = `play() refused: ${String(error)}`
        })
      } else {
        video.pause()
      }
    })
    seek.addEventListener('input', () => {
      scrubbing = true
      const duration = element.duration
      if (Number.isFinite(duration) && duration > 0) {
        element.currentTime = (Number(seek.value) / SEEK_STEPS) * duration
      }
    })
    seek.addEventListener('change', () => { scrubbing = false })
    mute.addEventListener('click', () => {
      element.muted = !element.muted
      refreshMute()
    })

    listen('timeupdate', refreshTime)
    listen('durationchange', refreshTime)
    listen('loadedmetadata', refreshTime)
    offs.push(
      // Resumed playback retracts the refusal message (a later play() can
      // succeed after an earlier one was refused). media-play is also the
      // only play-start signal for the button label, so the refresh stays.
      video.on('media-play', () => {
        playHint.hidden = true
        refreshPlay()
      }),
      video.on('media-pause', refreshPlay),
      video.on('media-ended', refreshPlay))

    refreshPlay()
    refreshMute()
    refreshTime()
    return () => {
      alive = false
      ac.abort()
      for (const off of offs) off()
    }
  }
}
