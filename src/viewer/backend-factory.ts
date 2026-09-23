/**
 * Picking a backend, and reporting which one was picked.
 *
 * Falling back is a programmable state rather than a log line, so an
 * application can show "your browser is using the slower renderer" or report
 * it. See `Capabilities`.
 */

import type { Backend } from '../renderer/backend'
import { describeCapabilities, type ProbeInput, type SelectedCapabilities } from '../renderer/capabilities'
import { WebGL2Backend } from '../renderer/webgl2/backend'
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

  const gl = typeof document !== 'undefined'
    ? document.createElement('canvas').getContext('webgl2')
    : null
  const hasWebGL2 = gl !== null

  // Read only on the no-adapter branch, so an adapter machine's answer is
  // byte-identical with what it was before this line existed. There, the value
  // stayed 0 and describeCapabilities clamped it up to the 2048 floor, while a
  // constructed WebGL2Backend reported the real clamped MAX_TEXTURE_SIZE
  // (typically 16384) -- probe() and createBackend answering the same question
  // differently is exactly what "downgrade is a programmable state" must not
  // allow.
  if (adapter === null && gl !== null) {
    maxTextureDimension = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  }

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

  // WebGPU first, always: it is the primary path and the one every feature is
  // developed against. WebGL2 is reached only when `acquireDevice()` came back
  // empty -- which is the case for a browser without `navigator.gpu` and for
  // one whose adapter request returned null (spec §6.5, §9.5).
  const webgl2 = WebGL2Backend.create(canvas)
  if (webgl2) return webgl2

  throw new Error(
    'no usable rendering backend: neither WebGPU nor WebGL2 is available in this browser'
  )
}
