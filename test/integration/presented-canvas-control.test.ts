import { describe, expect, it, vi } from 'vitest'
import { probePresentedCanvas } from './support/presented-canvas'

/*
 * The refusal path of the presented-canvas probe's tool control, provoked on
 * purpose for once. Every gated test exercises the control's HAPPY path (it
 * runs first inside runProbe), but nothing anywhere forced an empty readback
 * through it -- and a fail-closed guard whose refusal has never been observed
 * is a claim, not a property: a regression that zeroed the threshold or
 * inverted the condition would turn every readback verdict into `unavailable`,
 * mass-skip every gated test, and leave the build green (the close-out CR's
 * test-quality round flagged exactly this shape). This file is the proof that
 * an empty readback THROWS rather than degrading into a verdict.
 *
 * The mock is hoisted ahead of every import in this file, so the probe's
 * module-level cache is seeded through it on its first call -- and because
 * browser mode gives each test file its own iframe, no other file can observe
 * this mock. Nothing GPU-shaped is reached: the control this exercises sits
 * before the adapter probe, which is why this file runs the same on a real
 * GPU, on SwiftShader, and in a world with no WebGPU at all.
 *
 * The offscreen control's throw (same file, second arm) is NOT provoked here:
 * reaching it needs a device that creates successfully yet renders offscreen
 * to nothing, a condition no mock short of the GPUBuffer layer can stage. It
 * shares the readback-empty-throws shape this file proves; its own trigger
 * stays a device-level fact, recorded in the task card's self-review.
 */
vi.mock('./support/canvas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./support/canvas')>()
  return {
    ...actual,
    // All-zero RGBA reads back as fully black: countNonBlack gives 0, far
    // under the control's half-the-pixels bar, which is the exact reading a
    // broken toDataURL drift would produce.
    readCanvas: vi.fn(async () => new ImageData(8, 8))
  }
})

describe('presented-canvas probe controls', () => {
  it('fails, not skips, when the readback helper reads back empty', async () => {
    await expect(probePresentedCanvas())
      .rejects.toThrow(/readback helper itself is broken/)
  })
})
