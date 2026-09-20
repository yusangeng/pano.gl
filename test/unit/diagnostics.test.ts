import { describe, it, expect } from 'vitest'
import { channels, enableChannels } from '../../src/diagnostics'

describe('diagnostics', () => {
  it('exposes the trace channels the library actually uses', () => {
    expect(Object.keys(channels).sort()).toEqual(
      ['camera', 'gpu', 'input', 'media', 'renderer', 'viewer'].sort()
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

  it('restores the previous state when the returned undo runs', () => {
    const before = channels.gpu.enabled
    const restore = enableChannels('pano:*')
    expect(channels.gpu.enabled).toBe(true)
    restore()
    expect(channels.gpu.enabled).toBe(before)
  })

  it('treats an empty pattern as enable nothing', () => {
    const restore = enableChannels('')
    try {
      expect(Object.values(channels).some(fn => fn.enabled)).toBe(false)
    } finally {
      restore()
    }
  })
})
