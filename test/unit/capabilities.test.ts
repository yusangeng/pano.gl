import { describe, it, expect } from 'vitest'
import {
  describeCapabilities, type ProbeInput, type SelectedCapabilities
} from '../../src/renderer/capabilities'
import type { Capabilities } from '../../src/renderer/backend'

const base: ProbeInput = {
  hasWebGPU: true,
  hasWebGL2: true,
  adapter: { vendor: 'apple', architecture: 'metal-3' },
  maxTextureDimension: 16384,
  externalTextures: true
}

/**
 * Narrows away the 'none' variant. Every test that asserts on capability
 * fields already asserts `backend` first, but `expect(...).toBe(...)` does not
 * narrow the type, so the field accesses below need this to compile.
 */
function selected (caps: SelectedCapabilities): Capabilities {
  if (caps.backend === 'none') throw new Error('expected a backend to be selected')
  return caps
}

describe('describeCapabilities', () => {
  it('prefers webgpu when everything is available', () => {
    expect(describeCapabilities(base).backend).toBe('webgpu')
  })

  it('falls back to webgl2 when the page has no navigator.gpu', () => {
    const caps = selected(describeCapabilities({ ...base, hasWebGPU: false }))
    expect(caps.backend).toBe('webgl2')
    // The fallback must drop the WebGPU-only capability too, not just the label.
    // A backend label of webgl2 with externalTextures: true would have callers
    // take a code path the backend cannot serve.
    expect(caps.externalTextures).toBe(false)
  })

  it('falls back to webgl2 when an adapter cannot be obtained', () => {
    // navigator.gpu exists but requestAdapter() returned null -- exactly the
    // condition the `no-webgpu` project reproduces with --disable-gpu. This is
    // the silent-downgrade case, and it must be visible in the reported
    // capabilities.
    const caps = selected(describeCapabilities({ ...base, adapter: null }))
    expect(caps.backend).toBe('webgl2')
    expect(caps.adapter).toBeUndefined()
  })

  it('reports no backend when neither is available', () => {
    const caps = describeCapabilities({ ...base, hasWebGPU: false, hasWebGL2: false })
    expect(caps.backend).toBe('none')
  })

  it('prefers webgpu even when webgl2 is unavailable', () => {
    // The webgpu branch must not consult hasWebGL2: the two supports are
    // independent, and requiring both would silently report 'none' in a
    // WebGPU-only environment that has everything it needs.
    expect(describeCapabilities({ ...base, hasWebGL2: false }).backend).toBe('webgpu')
  })

  it('prefers the webgpu adapter description when webgpu wins', () => {
    expect(selected(describeCapabilities(base)).adapter).toEqual({ vendor: 'apple', architecture: 'metal-3' })
  })

  it('passes externalTextures: false through on the webgpu branch', () => {
    // Every other webgpu test passes externalTextures: true, so an
    // implementation that hardcoded the flag to true would pass all of them.
    // The value is the adapter's to report, not the selection's to decide.
    const caps = selected(describeCapabilities({ ...base, externalTextures: false }))
    expect(caps.externalTextures).toBe(false)
  })

  it('clamps a nonsensical max texture dimension up to a usable floor', () => {
    // Some software adapters report 0 or a tiny value. Passing that through
    // would make every source look oversized and route everything through the
    // downscale path for no reason.
    expect(selected(describeCapabilities({ ...base, maxTextureDimension: 0 })).maxTextureDimension)
      .toBeGreaterThanOrEqual(2048)
  })

  it('pins both clamp boundaries of maxTextureDimension with exact values', () => {
    // Exact values, not inequalities, because a moved boundary must fail by
    // name: 4096 still satisfies a >= 2048 check, which is how a shifted floor
    // would slip through. The webgpu floor exists because a software adapter
    // may report 0 or a value below anything usable.
    const webgpuCases: readonly (readonly [number, number])[] = [
      [-1, 2048],
      [0, 2048],
      [2048, 2048],
      [16384, 16384]
    ]
    for (const [reported, expected] of webgpuCases) {
      const caps = selected(describeCapabilities({ ...base, maxTextureDimension: reported }))
      expect(caps.maxTextureDimension).toBe(expected)
    }

    // The webgl2 branch clamps both ways: floor up to 2048, the spec minimum,
    // and ceiling down to 16384 -- a driver claiming more than the guaranteed
    // maximum is not believed, because oversized uploads would fail at draw
    // time instead of at selection time.
    const webgl2Cases: readonly (readonly [number, number])[] = [
      [0, 2048],
      [1024, 2048],
      [4096, 4096],
      [999999, 16384]
    ]
    for (const [reported, expected] of webgl2Cases) {
      const caps = selected(describeCapabilities({ ...base, hasWebGPU: false, maxTextureDimension: reported }))
      expect(caps.maxTextureDimension).toBe(expected)
    }
  })
})
