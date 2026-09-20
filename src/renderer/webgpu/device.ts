/**
 * Adapter and device acquisition, and the error handling WebGPU requires.
 *
 * Two things here have no WebGL1 analogue and are easy to get wrong:
 *
 * 1. Validation errors are asynchronous and do not throw. `createRenderPipeline`
 *    returns an invalid pipeline rather than raising, and drawing with it
 *    produces no pixels and no error. Every resource-creating call must be
 *    wrapped in a scope, or failures become invisible.
 *
 * 2. `device.lost` is a promise that resolves when the GPU process dies, the
 *    driver resets, or the tab is suspended. Unhandled, the canvas goes black
 *    permanently with no explanation.
 */

import { channels } from '../../diagnostics'

/** A device together with the promises it must be watched with. */
export interface AcquiredDevice {
  readonly adapter: GPUAdapter
  readonly device: GPUDevice
  /** Resolves with the reason string when the device is lost. */
  readonly lost: Promise<{ reason: string, message: string }>
}

/**
 * Runs `fn` inside a WebGPU validation error scope and throws if the scope
 * reports an error.
 *
 * @param device - The device to scope.
 * @param operation - Human-readable name for what is being attempted. Appears
 *   in the thrown error so the failing step is identifiable from a CI log.
 * @throws If the scope captures a validation error, or if `fn` itself throws.
 */
export async function withValidationScope<T> (
  device: GPUDevice,
  operation: string,
  fn: () => T | Promise<T>
): Promise<T> {
  device.pushErrorScope('validation')
  try {
    const result = await fn()
    const error = await device.popErrorScope()
    if (error) {
      throw new Error(`WebGPU validation error during ${operation}: ${error.message}`)
    }
    return result
  } catch (e) {
    // The scope must come off the stack even when the callback threw.
    // A leaked scope shifts every later pop by one, so the next unrelated
    // operation reports this one's error -- or, worse, reports nothing.
    await device.popErrorScope().catch(() => null)
    throw e
  }
}

/**
 * Requests an adapter and device.
 *
 * @returns `null` when the page has no WebGPU, or when the browser exposes the
 *   API but has no adapter to give -- which is what a browser launched with
 *   `--disable-gpu` reports. Callers must treat `null` as "use WebGL2", not as
 *   an error.
 */
export async function acquireDevice (): Promise<AcquiredDevice | null> {
  if (!('gpu' in navigator) || !navigator.gpu) return null

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    channels.gpu('requestAdapter() returned null; falling back to WebGL2')
    return null
  }

  const device = await adapter.requestDevice()

  // Attach the handler before anything can be created, so an immediate loss is
  // not missed. WebGPU intentionally does not auto-recover: without this the
  // page simply stops updating.
  const lost = device.lost.then(info => {
    channels.gpu('device lost: %s (%s)', info.reason, info.message)
    return { reason: info.reason, message: info.message }
  })

  channels.gpu('device acquired: %o', adapter.info)
  return { adapter, device, lost }
}
