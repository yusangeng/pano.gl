/**
 * Backend selection, as a pure function.
 *
 * Kept free of actual GPU calls so the decision table can be unit tested. The
 * impure part -- asking the browser for an adapter -- lives in the backends.
 *
 * Falling back is a programmable state, not a log line. An application that
 * wants to tell the user "your browser is using the slower renderer" needs to
 * read that from somewhere, and this is that somewhere.
 */

import type { Capabilities } from './backend'

/** Raw probe results, gathered however the caller can. */
export interface ProbeInput {
  readonly hasWebGPU: boolean
  readonly hasWebGL2: boolean
  /** `null` when `navigator.gpu` exists but `requestAdapter()` returned null. */
  readonly adapter: Readonly<Record<string, string>> | null
  readonly maxTextureDimension: number
  readonly externalTextures: boolean
}

export type SelectedCapabilities = Capabilities | { readonly backend: 'none' }

/**
 * The smallest `maxTextureDimension2D` we will believe. A software adapter that
 * reports 0 would otherwise make every source look oversized.
 *
 * Exported because `WebGPUBackend` assembles its own `Capabilities` from the
 * adapter it acquired and has to apply the same floor. The rule is stated here
 * and must not be re-derived there.
 */
export const MIN_TRUSTWORTHY_TEXTURE_DIMENSION = 2048

/**
 * Decides which backend to use and what to report about it.
 *
 * WebGPU wins whenever it is genuinely available. The adapter check is not
 * redundant with the `navigator.gpu` check: a browser launched with
 * `--disable-gpu` still exposes `navigator.gpu` and returns `null` from
 * `requestAdapter()`, so a page can look WebGPU-capable while having no GPU at
 * all. That is a real user configuration, not just a test fixture.
 */
export function describeCapabilities (input: ProbeInput): SelectedCapabilities {
  if (input.hasWebGPU && input.adapter !== null) {
    return {
      backend: 'webgpu',
      adapter: input.adapter,
      maxTextureDimension: Math.max(MIN_TRUSTWORTHY_TEXTURE_DIMENSION, input.maxTextureDimension),
      externalTextures: input.externalTextures
    }
  }

  if (input.hasWebGL2) {
    return {
      backend: 'webgl2',
      // WebGL2 has no external-texture equivalent, and the capability must say
      // so rather than leaving a WebGPU-only flag set on a WebGL2 backend.
      externalTextures: false,
      // WebGL2's floor is the spec minimum. Using the same field for both
      // backends keeps callers from branching on `backend` to find the limit.
      maxTextureDimension: Math.max(2048, Math.min(16384, input.maxTextureDimension))
    }
  }

  return { backend: 'none' }
}
