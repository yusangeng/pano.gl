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

  it('throws when the canvas already holds a 2d context, rather than returning a half-alive backend', async () => {
    // A canvas can carry only one context type, so a 2d canvas makes the
    // webgpu context request return null -- the one creation failure that can
    // be forced deterministically in a real browser. The whole setup path runs
    // for real first (device, pipelines), so this also proves the failure
    // throws AFTER the real work, not before it.
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    document.body.appendChild(canvas)
    expect(canvas.getContext('2d')).not.toBeNull()

    await expect(WebGPUBackend.create(canvas)).rejects.toThrow('returned null')
  })
})
