/**
 * `createBackend`'s preference branching, in the node project.
 *
 * The node environment is the honest one for the rejection paths:
 * `navigator` genuinely has no `gpu` member, and the canvas is a stub whose
 * `getContext` yields nothing, so each call ends in a throw whose message is
 * the assertion. The success halves -- a forced backend that answers -- need
 * a real GPU and live in the browser projects
 * (test/integration/backend-preference.test.ts and its fallback twin).
 */
import { describe, expect, it } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement

describe('createBackend with a preference', () => {
  it('the default keeps the legacy message when neither backend exists', async () => {
    await expect(createBackend(noCanvas)).rejects.toThrow(/no usable rendering backend/i)
  })

  it("explicit 'auto' follows the same path as the default", async () => {
    // 'auto' and the omitted argument must be one path, not two that could
    // drift: the compatibility promise is that callers who pass nothing see
    // byte-identical behaviour.
    await expect(createBackend(noCanvas, 'auto')).rejects.toThrow(/no usable rendering backend/i)
  })

  it("a forced 'webgpu' rejects, naming the requested backend", async () => {
    await expect(createBackend(noCanvas, 'webgpu'))
      .rejects.toThrow(/backend 'webgpu' was requested/i)
  })

  it("a forced 'webgl2' rejects, naming the requested backend", async () => {
    await expect(createBackend(noCanvas, 'webgl2'))
      .rejects.toThrow(/backend 'webgl2' was requested/i)
  })
})
