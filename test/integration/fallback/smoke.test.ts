import { expect, test } from 'vitest'

test('this project really is the no-WebGPU one', () => {
  // require-no-webgpu.ts asserts the substance; this asserts the plumbing.
  // It cannot catch an include pattern that matches zero files -- vitest
  // exits 0 with no warning in that case (measured, Task 8 quality review);
  // the CI job (Task 9) asserts the project counts instead.
  expect(navigator.gpu).toBeDefined()
  expect(document.createElement('canvas').getContext('webgl2')).not.toBeNull()
})
