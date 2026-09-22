/**
 * The public `probe()`, on both classes.
 *
 * `probe()` is the only way an application can ask "what will this browser give
 * me" before it has a container to render into, and it is deliberately not a
 * thrower: `{ backend: 'none' }` is an answer. E24(a) raised the concern that
 * `backend-factory.ts`'s `probe()` was a function with no caller and no test;
 * the four below are that caller.
 *
 * These run in the node project, so the environment they describe is real
 * rather than simulated: `document` is genuinely absent, and `navigator` is
 * genuinely present with no `gpu` member. What that environment exercises is
 * the no-backend path, and `describeCapabilities` turning it into `'none'`.
 *
 * The two branches this file CANNOT reach are the adapter ones --
 * `navigator.gpu.requestAdapter()` returning an adapter, and returning null.
 * Both need a GPU (or a fabricated one), and the browser projects exercise them
 * for real: the `integration` project on a real adapter, the `no-webgpu`
 * project under `--disable-gpu`. See the completion report.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { FramelessImageViewer } from '../../src/viewer/image-viewer'
import { FramelessVideoViewer } from '../../src/viewer/video-viewer'

afterEach(() => {
  // Unconditional, so a failed assertion cannot leave a fabricated `document`
  // behind for the next file in this worker.
  vi.unstubAllGlobals()
})

describe('probe() with no DOM at all', () => {
  it('answers "none" for the image viewer instead of throwing', async () => {
    // Both halves matter. `'none'` is the honest answer for a process with no
    // `document` -- there is no canvas, so WebGL2 cannot be probed -- and
    // "instead of throwing" is the documented contract: a caller deciding what
    // to do about a machine with no backend must not need a try/catch.
    await expect(FramelessImageViewer.probe()).resolves.toEqual({ backend: 'none' })
  })

  it('answers "none" for the video viewer too', async () => {
    // Separate because the two are separate static methods on separate
    // classes. A viewer whose `probe` was wired to nothing -- or to a copy of
    // its sibling -- would pass the test above.
    await expect(FramelessVideoViewer.probe()).resolves.toEqual({ backend: 'none' })
  })
})

describe('probe() with a DOM but no GPU', () => {
  /**
   * A `document` whose canvases can answer the one question `probe()` asks them
   * -- `getContext('webgl2') !== null`. Nothing else about the DOM is supplied
   * because nothing else is read.
   *
   * This is the smallest stand-in that separates "the public method delegates
   * to the device probe" from "the public method returns a literal". Without
   * it, both classes' `probe()` could be replaced by `return { backend: 'none' }`
   * and every assertion still pass -- and no test anywhere in this card would
   * notice, because Task 5's US5 asserts `'none'` from an environment where
   * `'none'` is also the correct answer.
   *
   * The fact it stands in for -- "a browser with WebGL2 can be detected by
   * asking a canvas" -- is asserted against a real browser by
   * `test/integration/support/require-no-webgpu.ts`, which fails loudly if the
   * WebGL2 context stops being available under `--disable-gpu`.
   */
  function stubCanvasWithWebGL2 (): void {
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: (id: string) => (id === 'webgl2' ? {} : null)
      })
    })
  }

  it('reports WebGL2 for the image viewer, at the spec-minimum texture floor', async () => {
    stubCanvasWithWebGL2()
    // The exact object, not a field of it: `maxTextureDimension: 2048` is
    // `MIN_TRUSTWORTHY_TEXTURE_DIMENSION` applied to a probe that found no
    // adapter reporting a limit of its own, and `externalTextures: false` is
    // the WebGL2 branch's deliberate downgrade of a WebGPU-only flag.
    await expect(FramelessImageViewer.probe()).resolves.toEqual({
      backend: 'webgl2',
      externalTextures: false,
      maxTextureDimension: 2048
    })
  })

  it('reports WebGL2 for the video viewer too', async () => {
    stubCanvasWithWebGL2()
    await expect(FramelessVideoViewer.probe()).resolves.toEqual({
      backend: 'webgl2',
      externalTextures: false,
      maxTextureDimension: 2048
    })
  })
})
