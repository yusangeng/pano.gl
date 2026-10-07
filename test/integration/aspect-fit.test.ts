import { describe, it, expect } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { makeContainer, canvasOf } from './support/dom'
import { nextFrames, readCanvas, maxChannelDiff } from './support/canvas'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'
import { ndcToSurface, project } from '../../src/core/reference'
import { resolveExtent } from '../../src/core/extent'
import type { NonLinearProjection } from '../../src/core/extent'

/*
 * The aspect-fit user story: mount square, reshape the container to 16:9
 * through the real ResizeObserver path, and check the presented pixels
 * against the float64 reference AT THE NEW ASPECT. A stretch -- the defect
 * this card removes -- displaces nearly every pixel and lands far above the
 * loose tolerance; the tight tolerances live in the gates, not here.
 */

/** The pose every leg mounts at; the reference compares against (0, 0). */
const POSE = { povLatitude: 0, povLongitude: 0 }

/** What `periodicSource` hands back: the mountable URL and the CPU-side fetch. */
interface PeriodicSource {
  readonly url: string
  readonly pixels: (u: number, v: number) => [number, number, number]
}

/** A periodic 64x64 equirectangular source as a data URL, gate-Source style. */
function periodicSource (): PeriodicSource {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('no 2d context for the synthetic source')
  const image = ctx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const i = (y * size + x) * 4
      image.data[i] = Math.round(128 + 120 * Math.cos(2 * Math.PI * u))
      image.data[i + 1] = Math.round(128 + 120 * Math.cos(2 * Math.PI * v))
      image.data[i + 2] = Math.round(128 + 120 * Math.sin(8 * Math.PI * u) * Math.sin(8 * Math.PI * v))
      image.data[i + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  const data = Array.from(image.data)
  // Nearest-neighbour fetch with REPEAT on u and CLAMP on v -- deliberately
  // not bilinear: the comparison samples away from texel edges, and a simple
  // fetch keeps this file's reference independent from cross-backend.ts.
  const pixels = (u: number, v: number): [number, number, number] => {
    const uu = ((u % 1) + 1) % 1
    const vv = Math.min(0.99999, Math.max(0, v))
    const i = (Math.floor(vv * size) * size + Math.floor(uu * size)) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!]
  }
  return { url: canvas.toDataURL('image/png'), pixels }
}

/**
 * The worst per-channel disagreement between a readback and the float64
 * reference at container aspect `aspect`, over the sampled grid.
 *
 * The ndc grid is taken in `read`'s own pixels, so the drawing buffer's dpr
 * and the readback's downscale cancel; `aspect` is the container's CSS
 * ratio, the same value the viewer itself resolved against.
 */
function sampleWorst (
  read: ImageData,
  source: PeriodicSource,
  projection: NonLinearProjection,
  aspect: number
): number {
  const extent = resolveExtent(projection, aspect)
  let worst = 0
  for (let py = 4; py < read.height; py += 8) {
    for (let px = 4; px < read.width; px += 8) {
      const ndcX = ((px + 0.5) / read.width) * 2 - 1
      const ndcY = 1 - ((py + 0.5) / read.height) * 2
      const surface = ndcToSurface(ndcX, ndcY, extent)
      // project() returns the UNFLIPPED reference v while the shaders sample
      // 1 - phi / PI, so the fetch flips it here -- cross-backend.ts's
      // referenceImage compensates the same way.
      const uv = project(surface[0], surface[1], surface[2], POSE, projection)
      const expected = source.pixels(uv.u, 1 - uv.v)
      const i = (py * read.width + px) * 4
      const got = [read.data[i]!, read.data[i + 1]!, read.data[i + 2]!]
      worst = Math.max(worst, maxChannelDiff(got, expected))
    }
  }
  return worst
}

describe('aspect fit (user story)', () => {
  for (const camera of ['cylindrical', 'planet'] as const) {
    it(`${camera} reframes without distortion when the container goes 16:9`, async (ctx) => {
      await skipIfPresentedCanvasBroken(ctx)
      const source = periodicSource()
      // Square mount: the framing at A=1 matches the square paper exactly,
      // which is what makes the 16:9 reshape a pure framing change.
      const container = makeContainer(360, 360)
      const projection: NonLinearProjection =
        camera === 'cylindrical'
          ? { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
          : { kind: 'planet', zoom: 1, extent: [4, 4] }
      const viewer = await FramelessImageViewer.create({
        container,
        src: source.url,
        camera: { projection }
      })
      try {
        await nextFrames(3)
        container.style.width = '640px'
        container.style.height = '360px'
        // ResizeObserver delivery + invalidate + a drawn frame + present.
        await nextFrames(5)

        const canvas = canvasOf(container)
        const read = await readCanvas(canvas, 160, 90)
        const worst = sampleWorst(read, source, projection, 640 / 360)
        // Loose on purpose: the readback downscales 640x360 -> 160x90 and
        // the fetch is nearest-neighbour, so a few channels of filtering
        // disagreement are expected. A stretch lands at O(100).
        expect(worst, `${camera} worst channel after 16:9 reshape`).toBeLessThanOrEqual(24)
      } finally {
        viewer.dispose()
        container.remove()
      }
    })
  }

  it('keeps the container fit when the camera is swapped in without a resize', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const source = periodicSource()
    // The stale-store window this leg guards: the container delivers its
    // aspect WHILE a linear camera is active (the branch that historically
    // returned early without storing the surface aspect -- the defect
    // cfb6e46 removed), then the camera is swapped with no resize to
    // re-deliver it. The swapped-in cylindrical must still resolve the
    // 2:1 container fit ([1, pi]), not the stale square placeholder
    // ([1, 2pi] -- a frame-wide displacement, far above the tolerance).
    // Kill scope (mutation drill 2026-10-07): the stale-store mutant -- the
    // linear branch skipping the surface-aspect store, pre-cfb6e46 -- lands
    // this leg at worst ~215 vs the tolerance 24, while the reshape legs
    // stay green.
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: source.url,
      camera: { projection: { kind: 'linear', fov: (75 * Math.PI) / 180, aspect: 2 } }
    })
    try {
      await nextFrames(3)
      const projection: NonLinearProjection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
      viewer.cameraOptions = { projection }
      await nextFrames(3)

      const canvas = canvasOf(container)
      const read = await readCanvas(canvas, 160, 80)
      const worst = sampleWorst(read, source, projection, 400 / 200)
      expect(worst, 'swap worst channel (stale-aspect mutant lands far above)').toBeLessThanOrEqual(24)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })
})
