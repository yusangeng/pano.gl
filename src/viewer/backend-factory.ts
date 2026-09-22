/**
 * Picking a backend, and reporting which one was picked.
 *
 * Falling back is a programmable state rather than a log line, so an
 * application can show "your browser is using the slower renderer" or report
 * it. See `Capabilities`.
 */

import type { Backend } from '../renderer/backend'
import { describeCapabilities, type ProbeInput, type SelectedCapabilities } from '../renderer/capabilities'
import { WebGPUBackend } from '../renderer/webgpu/backend'

/**
 * Probes the device without constructing a viewer.
 *
 * Existing because an application needs to decide what to do before it has a
 * container to render into -- and because a viewer that silently downgraded
 * with no way to ask would be the legacy `createProgram` failure again, in a
 * new place.
 *
 * `SelectedCapabilities` rather than `Capabilities`: "there is no backend at
 * all" is a state a caller has to be able to see and act on, and it is not a
 * capability of anything. Throwing instead would turn the most reasonable use
 * of this function -- ask first, then decide -- into a try/catch.
 */
export async function probe (): Promise<SelectedCapabilities> {
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
  let adapter: Record<string, string> | null = null
  let maxTextureDimension = 0

  if (hasWebGPU) {
    const a = await navigator.gpu.requestAdapter()
    if (a) {
      adapter = a.info as unknown as Record<string, string>
      maxTextureDimension = a.limits.maxTextureDimension2D
    }
  }

  const hasWebGL2 = typeof document !== 'undefined' &&
    document.createElement('canvas').getContext('webgl2') !== null

  return describeCapabilities({
    hasWebGPU,
    adapter,
    hasWebGL2,
    maxTextureDimension,
    externalTextures: adapter !== null
  } satisfies ProbeInput)
}

/**
 * Creates a backend for the given canvas.
 *
 * @throws If neither backend is available. Constructing a viewer that can never
 *   draw is what the legacy `createProgram` did -- it logged and returned null,
 *   and the viewer reported success. A viewer that cannot render is not a
 *   viewer.
 */
export async function createBackend (canvas: HTMLCanvasElement): Promise<Backend> {
  const webgpu = await WebGPUBackend.create(canvas)
  if (webgpu) return webgpu

  // The WebGL2 backend arrives in P6. Until then, a page without WebGPU cannot
  // be served, and saying so is better than a black rectangle.
  throw new Error(
    'no usable rendering backend: WebGPU is unavailable and the WebGL2 fallback is not implemented yet'
  )
}
