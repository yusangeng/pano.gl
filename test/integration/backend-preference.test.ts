import { describe, expect, it } from 'vitest'
import { canvasOf } from './support/dom'
import { countNonBlack, maxChannelDiff, nextFrames, readCanvas } from './support/canvas'
import { imageViewer } from './support/viewer'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'

/**
 * How far the forced and default viewer paths may disagree, per channel.
 *
 * Gate C bounds the two hand-transcribed shaders at 2/255 on identical
 * offscreen requests (gate-c-cross-backend.test.ts). The viewer paths add
 * canvas presentation on top of the shaders, and the 64x32 bilinear
 * downscale in readCanvas is a convex combination -- it cannot amplify a
 * per-channel difference. 4 = 2 (shaders) + 2 (presentation), and a read
 * above it means the forced path changed projection semantics, not backend.
 * If this ever fails with everything else green, report it -- do not loosen
 * the bound silently.
 */
const MAX_CROSS_BACKEND_DIFF = 4

/*
 * The backend preference, through the public surface. The no-webgpu twin
 * (test/integration/fallback/backend-preference.test.ts) holds the rejection
 * half; this file runs where an adapter is guaranteed, so it holds the
 * success half and the cross-backend equivalence.
 */
describe('create with a backend preference', () => {
  it("forcing 'webgl2' renders the same picture the default path renders", async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const forced = await imageViewer({ backend: 'webgl2' })
    const auto = await imageViewer()
    await nextFrames(2)

    // Read everything back before dispose: dispose destroys the device, and
    // capabilities/pixels read after it answer questions about a dead viewer.
    const forcedImage = await readCanvas(canvasOf(forced.container))
    const autoImage = await readCanvas(canvasOf(auto.container))
    const forcedBackend = forced.viewer.capabilities.backend
    const autoBackend = auto.viewer.capabilities.backend
    forced.viewer.dispose()
    auto.viewer.dispose()

    // The two selections differ -- the force took effect, and the default
    // still follows the WebGPU-first path this project guarantees an adapter
    // for (its setup file asserts one).
    expect(forcedBackend).toBe('webgl2')
    expect(autoBackend).toBe('webgpu')
    // Content net: a blank pair of readbacks satisfies the diff bound
    // vacuously, so both halves must first prove they drew something.
    expect(countNonBlack(forcedImage)).toBeGreaterThan(0)
    expect(countNonBlack(autoImage)).toBeGreaterThan(0)
    expect(maxChannelDiff(forcedImage.data, autoImage.data)).toBeLessThanOrEqual(MAX_CROSS_BACKEND_DIFF)
  })

  it("forcing 'webgpu' pins the primary path explicitly", async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    // 'webgpu' on this machine agrees with 'auto' -- that is the point: the
    // pin is a guarantee about selection, not a change in rendering. The
    // environment where it would reject is the no-webgpu project's twin file.
    const { viewer, container } = await imageViewer({ backend: 'webgpu' })
    await nextFrames(2)
    const image = await readCanvas(canvasOf(container))
    const backend = viewer.capabilities.backend
    viewer.dispose()

    expect(backend).toBe('webgpu')
    expect(countNonBlack(image)).toBeGreaterThan(0)
  })
})
