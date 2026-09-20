import { describe, it, expect } from 'vitest'
import { WebGPUBackend } from '../../src/renderer/webgpu/backend'
import { acquireDevice } from '../../src/renderer/webgpu/device'

/*
 * The setup file for this project already asserted that requestAdapter()
 * returns non-null, so a null from `create` below is a real failure and not
 * the "this machine has no GPU" case.
 */

describe('WebGPU backend lifecycle', () => {
  it('can be created and disposed, twice', async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    document.body.appendChild(canvas)

    const backend = await WebGPUBackend.create(canvas)
    expect(backend).not.toBeNull()
    backend!.dispose()
    // Disposal is reachable from a viewer's teardown path, which can run twice
    // when a source swap and a destroy race. It has to be idempotent.
    backend!.dispose()
  })

  it('reports device loss', async () => {
    // The failure mode the spec calls out: WebGPU does not auto-recover, so a
    // lost device that nothing listens for means a permanently black canvas and
    // no message anywhere.
    const acquired = await acquireDevice()
    expect(acquired).not.toBeNull()

    const lost = acquired!.device.lost.then(() => 'lost')
    acquired!.device.destroy()
    const outcome = await Promise.race([
      lost,
      new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))
    ])
    expect(outcome).toBe('lost')
  })
})
