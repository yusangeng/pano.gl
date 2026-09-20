import { describe, it, expect } from 'vitest'
import { parseCaptureDoc } from '../support/baseline'

/*
 * Pins parseCaptureDoc's last-frame contract with synthetic input.
 *
 * Every captured fixture happens to record identical matrices in all three of
 * its frames, so the parity test cannot tell whether the parser reads the last
 * frame or the first -- and the last frame is the semantic anchor: it is the
 * frame the captured PNG shows, which is what P3's pixel gate compares against.
 * Synthetic frames with distinct values make the choice observable, and the
 * empty-stream rejection is exercised here because no fixture ever triggers it.
 */

const state = { id: 'origin', lat: 0, lng: 0, zoom: 0 }

describe('parseCaptureDoc', () => {
  it('keys the captured uniforms off the last frame', () => {
    const doc = parseCaptureDoc(JSON.stringify({
      state,
      frames: [
        [{ name: 'u_CamTransMatrix', value: [1, 0, 0, 0] }],
        [{ name: 'u_CamTransMatrix', value: [2, 0, 0, 0] }]
      ]
    }), 'planet', 'origin')

    expect(doc.captured.u_CamTransMatrix).toEqual([2, 0, 0, 0])
    expect(doc.frames).toHaveLength(2)
  })

  it('rejects a capture with no frames', () => {
    expect(() => parseCaptureDoc(JSON.stringify({ state, frames: [] }), 'planet', 'origin'))
      .toThrow(/no frames recorded/)
  })
})
