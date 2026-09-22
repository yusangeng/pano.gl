import { describe, expect, it } from 'vitest'
import { FramelessImageViewer } from '../../../src/index'
import { makeContainer } from '../support/dom'

/*
 * US5: running where WebGPU is unavailable.
 *
 * No mask, no `addInitScript`, no control group. The project this file runs in
 * launches Chromium with --disable-gpu, and `require-no-webgpu.ts` asserts in a
 * `beforeAll` that the adapter really is absent AND that WebGL2 is still there --
 * so if the flag ever stops taking effect, this file fails loudly instead of
 * quietly re-testing the WebGPU path.
 *
 * The old version of this story needed a mask and a third control test because
 * the mask was applied from outside the page and there was no way to tell a
 * working mask from a broken page. A project does not have that failure mode:
 * the environment is either what it claims or the guard says it is not.
 *
 * A P5/P6 seam, and the reason the two assertions below look contradictory: in
 * this environment `probe()` answers 'webgl2' while `create()` still rejects
 * saying no backend exists. Both are true. `probe()` reports what THIS MACHINE
 * can do -- and under --disable-gpu, `navigator.gpu` is present but
 * `requestAdapter()` is null, so `describeCapabilities` falls to its WebGL2 arm,
 * which the same guard file proves is alive. `create()` reports what THIS
 * LIBRARY can serve -- and `backend-factory.ts` does not build a WebGL2 backend
 * until P6, so a machine that can only do WebGL2 cannot be served yet. When P6
 * lands the WebGL2 backend, the two answers converge and this comment -- and the
 * second test -- should go, as part of proving the fallback exists. Deleting the
 * first assertion instead, to make the pair look consistent, would erase the
 * recorded fact of the transition.
 */
describe('US5: running where WebGPU is unavailable', () => {
  it('probe() reports the machine honestly instead of throwing', async () => {
    // `probe()` must never throw: its whole reason for existing is to be
    // callable before anything is constructed, so that a caller can decide what
    // to do about a machine with no usable backend. And what it must say here is
    // 'webgl2', not 'none': WebGL2 is present in this project (the guard asserts
    // it), so 'none' would be the machine underreporting itself -- and an
    // application that branched on it would skip a fallback that would have
    // worked, once P6 serves it.
    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('webgl2')
  })

  it('create() fails with a message naming the backend situation', async () => {
    // An honest failure, not a black rectangle. The legacy `createProgram` logged
    // and returned null, and the viewer reported success and rendered nothing
    // forever -- which from the caller's side is indistinguishable from a slow
    // network.
    const container = makeContainer()
    await expect(FramelessImageViewer.create({ container, src: '/fixtures/panorama.png' }))
      .rejects.toThrow(/no usable rendering backend/i)
  })
})
