import { describe, it, expect } from 'vitest'
import { channels, enableChannels } from '../../src/diagnostics'

describe('diagnostics', () => {
  it('exposes the trace channels the library actually uses', () => {
    expect(Object.keys(channels).sort()).toEqual(
      ['camera', 'gpu', 'input', 'media', 'renderer', 'viewer'].sort()
    )
  })

  it('pins the pano: namespace prefix of every channel', () => {
    // The prefix is the module's whole contract with the DEBUG environment:
    // every documented example (DEBUG=pano:*) silently breaks if a channel
    // drifts to a bare name, while the object-key test above stays green.
    expect(Object.entries(channels).map(([, fn]) => fn.namespace).sort()).toEqual(
      ['pano:camera', 'pano:gpu', 'pano:input', 'pano:media', 'pano:renderer', 'pano:viewer'].sort()
    )
  })

  it('leaves every channel silent by default', () => {
    // A library that writes to the console on import is a library people
    // uninstall. debug's whole value here is that the default is silence.
    for (const fn of Object.values(channels)) {
      expect(fn.enabled).toBe(false)
    }
  })

  it('enables exactly the namespaces that match the pattern', () => {
    const restore = enableChannels('pano:gpu')
    try {
      expect(channels.gpu.enabled).toBe(true)
      expect(channels.media.enabled).toBe(false)
    } finally {
      restore()
    }
  })

  it('honours skip patterns, as the documented DEBUG example promises', () => {
    const restore = enableChannels('pano:*,-pano:media')
    try {
      expect(channels.gpu.enabled).toBe(true)
      expect(channels.media.enabled).toBe(false)
    } finally {
      restore()
    }
  })

  it('restores the previous state when the returned undo runs', () => {
    const before = channels.gpu.enabled
    const restore = enableChannels('pano:*')
    try {
      expect(channels.gpu.enabled).toBe(true)
    } finally {
      restore()
    }
    expect(channels.gpu.enabled).toBe(before)
  })

  it('undo restores a partially-enabled previous state, not just all-off', () => {
    // The discriminating case for the undo: previous state carries its own
    // enable list. An undo that clobbers it (e.g. drops to all-off, or loses
    // skip entries) passes the all-off round-trip above and fails only here.
    const restoreFirst = enableChannels('pano:gpu')
    try {
      const restoreSecond = enableChannels('pano:*')
      try {
        expect(channels.media.enabled).toBe(true)
      } finally {
        restoreSecond()
      }
      expect(channels.gpu.enabled).toBe(true)
      expect(channels.media.enabled).toBe(false)
    } finally {
      restoreFirst()
    }
  })

  it('treats an empty pattern as enable nothing', () => {
    const restore = enableChannels('')
    try {
      expect(Object.values(channels).some(fn => fn.enabled)).toBe(false)
    } finally {
      restore()
    }
  })

  it('treats an unparsable pattern as enable-nothing, not an error', () => {
    // debug's parser silently ignores garbage; pin that inherited leniency
    // so a future debug major that starts throwing shows up as a red test
    // here rather than as a crashed host page later.
    const restore = enableChannels('not a pattern!')
    try {
      expect(Object.values(channels).some(fn => fn.enabled)).toBe(false)
    } finally {
      restore()
    }
  })
})
