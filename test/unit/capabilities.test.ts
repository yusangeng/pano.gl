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

  it('prefers the webgpu adapter description when webgpu wins', () => {
    expect(selected(describeCapabilities(base)).adapter).toEqual({ vendor: 'apple', architecture: 'metal-3' })
  })

  it('clamps a nonsensical max texture dimension up to a usable floor', () => {
    // Some software adapters report 0 or a tiny value. Passing that through
    // would make every source look oversized and route everything through the
    // downscale path for no reason.
    expect(selected(describeCapabilities({ ...base, maxTextureDimension: 0 })).maxTextureDimension)
      .toBeGreaterThanOrEqual(2048)
  })
})
