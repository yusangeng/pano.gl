import { describe, it, expect, vi } from 'vitest'
import { withValidationScope, acquireDevice } from '../../src/renderer/webgpu/device'

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

  it('pops the scope exactly once when the scope reports an error', async () => {
    // The error-path throw lands in the same catch that handles callback
    // failures; without the guard flag the catch would pop a second time and
    // steal the scope of an enclosing withValidationScope call.
    const device = fakeDevice({ message: 'boom' } as GPUError)
    await expect(withValidationScope(device, 'texture upload', () => 1))
      .rejects.toThrow(/texture upload/)
    expect(device.popErrorScope).toHaveBeenCalledTimes(1)
  })

  it('awaits the callback before popping the scope', async () => {
    // The pop must observe every GPU call the callback issued, so it has to
    // await the callback's promise rather than racing it.
    const order: string[] = []
    const device = {
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn().mockImplementation(() => {
        order.push('pop')
        return Promise.resolve(null)
      })
    } as unknown as GPUDevice
    const result = await withValidationScope(device, 'upload', () => new Promise(resolve => {
      setTimeout(() => {
        order.push('callback')
        resolve('done')
      }, 5)
    }))
    expect(result).toBe('done')
    expect(order).toEqual(['callback', 'pop'])
  })

  it('rethrows the callback error even when the cleanup pop rejects', async () => {
    // A real device rejects the cleanup pop with an OperationError when the
    // scope stack is already empty; that rejection must not replace the
    // callback's own error.
    const device = {
      pushErrorScope: vi.fn(),
      popErrorScope: vi.fn().mockRejectedValue(new Error('OperationError: no scope'))
    } as unknown as GPUDevice
    await expect(
      withValidationScope(device, 'x', () => { throw new Error('callback blew up') })
    ).rejects.toThrow('callback blew up')
  })
})

describe('acquireDevice', () => {
  it('returns null when navigator has no gpu property', async () => {
    vi.stubGlobal('navigator', {})
    expect(await acquireDevice()).toBeNull()
    vi.unstubAllGlobals()
  })

  it('returns null when navigator.gpu is present but falsy', async () => {
    vi.stubGlobal('navigator', { gpu: undefined })
    expect(await acquireDevice()).toBeNull()
    vi.unstubAllGlobals()
  })

  it('returns null when requestAdapter() yields no adapter', async () => {
    // The no-adapter case is the WebGL2 fallback path, not an error.
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } })
    expect(await acquireDevice()).toBeNull()
    vi.unstubAllGlobals()
  })

  it('returns the adapter, the device and a lost promise with the loss info', async () => {
    const device = {
      lost: Promise.resolve({ reason: 'destroyed', message: 'bye' })
    } as unknown as GPUDevice
    const adapter = {
      info: { vendor: 'stub' },
      requestDevice: async () => device
    } as unknown as GPUAdapter
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => adapter } })

    const acquired = await acquireDevice()

    expect(acquired?.adapter).toBe(adapter)
    expect(acquired?.device).toBe(device)
    await expect(acquired?.lost).resolves.toEqual({ reason: 'destroyed', message: 'bye' })
    vi.unstubAllGlobals()
  })
})
