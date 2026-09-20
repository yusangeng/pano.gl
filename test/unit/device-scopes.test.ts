import { describe, it, expect, vi } from 'vitest'
import { withValidationScope } from '../../src/renderer/webgpu/device'

/** Minimal stand-in for a GPUDevice's error-scope pair. */
function fakeDevice (result: GPUError | null) {
  return {
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn().mockResolvedValue(result)
  } as unknown as GPUDevice
}

describe('withValidationScope', () => {
  it('returns the callback result when no validation error occurs', async () => {
    const device = fakeDevice(null)
    const result = await withValidationScope(device, 'pipeline', () => 42)
    expect(result).toBe(42)
    expect(device.pushErrorScope).toHaveBeenCalledWith('validation')
  })

  it('throws when the scope reports an error', async () => {
    // The whole point. WebGPU validation errors are asynchronous and do not
    // throw: createRenderPipeline returns an invalid pipeline and rendering
    // silently produces nothing. Without this wrapper the library reproduces
    // the legacy renderer's "constructed successfully, draws nothing forever"
    // failure with a different API.
    const device = fakeDevice({ message: 'shader compilation failed' } as GPUError)
    await expect(
      withValidationScope(device, 'pipeline creation', () => 42)
    ).rejects.toThrow(/pipeline creation.*shader compilation failed/s)
  })

  it('names the operation in the error so the failure is locatable', async () => {
    const device = fakeDevice({ message: 'boom' } as GPUError)
    await expect(withValidationScope(device, 'texture upload', () => 1))
      .rejects.toThrow(/texture upload/)
  })

  it('pops the scope even when the callback throws', async () => {
    // A scope left on the stack shifts every later scope's result by one, so
    // the next unrelated operation reports someone else's error.
    const device = fakeDevice(null)
    await expect(
      withValidationScope(device, 'x', () => { throw new Error('callback blew up') })
    ).rejects.toThrow('callback blew up')
    expect(device.popErrorScope).toHaveBeenCalledTimes(1)
  })

  it('supports async callbacks', async () => {
    const device = fakeDevice(null)
    const result = await withValidationScope(device, 'upload', async () => 'done')
    expect(result).toBe('done')
  })
})
