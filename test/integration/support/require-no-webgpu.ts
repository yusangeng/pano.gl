import { beforeAll, expect } from 'vitest'

/*
 * The mirror of require-webgpu. If --disable-gpu ever stops taking effect the
 * fallback project would quietly start testing the WebGPU path instead, and
 * "the WebGL2 downgrade works" would become a claim backed by tests that never
 * went near WebGL2.
 */
beforeAll(async () => {
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
  expect(
    adapter,
    'this project must run WITHOUT a WebGPU adapter, but got one -- ' +
      '--disable-gpu is not taking effect'
  ).toBeNull()

  expect(
    document.createElement('canvas').getContext('webgl2'),
    'WebGL2 must still work here; without it the fallback has nothing to fall ' +
      'back to and the test would be measuring the wrong failure'
  ).not.toBeNull()
})
