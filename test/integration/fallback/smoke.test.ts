import { expect, test } from 'vitest'

test('this project really is the no-WebGPU one', () => {
  // require-no-webgpu.ts asserts the substance; this asserts the plumbing,
  // so a project that silently ran zero tests cannot look like a pass.
  expect(navigator.gpu).toBeDefined()
  expect(document.createElement('canvas').getContext('webgl2')).not.toBeNull()
})
