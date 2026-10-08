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

/**
 * Tolerance 24, measured (probe runs of this file on this machine's GPU,
 * 2026-10-07): cylindrical 15, planet 21, swap 15 -- never fabricated. The
 * mechanism's own floor sits just under the bar: the blue channel's 8-cycle
 * term has an adjacent-texel delta of ~46, so a sample landing midway
 * between texels disagrees with the GPU's bilinear by ~23, which means 24
 * is barely above what CORRECT filtering can produce. A probe above 24 on
 * a different rasteriser (CI's SwiftShader) is a tolerance event: record
 * the measured value and re-derive the bound from it. A real break is a
 * frame-wide displacement and lands at 200+ (the kill-scope drill below).
 */
const TOLERANCE = 24

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
      // Sampled at texel EDGES (x / size) where gateSource samples texel
      // centres ((x + 0.5) / size) -- harmless for a periodic pattern.
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
  // not bilinear: a simple fetch keeps this file's reference independent
  // from cross-backend.ts. The grid does NOT steer away from texel edges;
  // a sample landing midway between texels simply disagrees with the GPU's
  // bilinear by up to the ~23 floor TOLERANCE sits above (see its comment).
  // The shipped image samplers REPEAT on BOTH axes, so this fetch agrees
  // with the GPU only while the sampled v stays inside [0, 1) -- which
  // every leg here guarantees by pose: at lat 0 the sampled phi range is
  // interior except at planet's exact screen centre, where v_ref = 0 (the
  // canonical branch point); the 160x90 readback grid steps by 8 from 4,
  // so no sample ever lands on the (79.5, 44.5) centre. A future posed leg
  // must switch this fetch to REPEAT on v, or it will pin edge rows the GPU
  // wraps and disagree everywhere.
  const pixels = (u: number, v: number): [number, number, number] => {
    const uu = ((u % 1) + 1) % 1
    const vv = Math.min(0.99999, Math.max(0, v))
    const i = (Math.floor(vv * size) * size + Math.floor(uu * size)) * 4
    return [data[i]!, data[i + 1]!, data[i + 2]!]
  }
  return { url: canvas.toDataURL('image/png'), pixels }
}

/**
 * The worst sampled disagreement: the number, the sample that produced it,
 * and both colours there -- gate C's convention
 * (gate-c-cross-backend.test.ts), so a failure is a diagnosis rather than
 * a number.
 */
interface WorstSample {
  readonly worst: number
  readonly px: number
  readonly py: number
  readonly got: readonly [number, number, number]
  readonly expected: readonly [number, number, number]
}

/**
 * The worst per-channel disagreement between a readback and the float64
 * reference at container aspect `aspect`, over the sampled grid, with the
 * sample that produced it.
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
): WorstSample {
  const extent = resolveExtent(projection, aspect)
  let w: WorstSample = { worst: 0, px: 0, py: 0, got: [0, 0, 0], expected: [0, 0, 0] }
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
      const got: [number, number, number] = [read.data[i]!, read.data[i + 1]!, read.data[i + 2]!]
      const diff = maxChannelDiff(got, expected)
      // >=, not >, so a readback that agrees everywhere still reports the
      // last real sample rather than the seed above.
      if (diff >= w.worst) w = { worst: diff, px, py, got, expected }
    }
  }
  return w
}

// Keyed so a camera missing from the table is a type error, not a
// silently-borrowed paper (the reference reads the same record, so a
// non-canonical extent would stay green).
const PAPERS = { cylindrical: [1, 1], planet: [4, 4] } as const

describe('aspect fit (user story)', () => {
  for (const camera of ['cylindrical', 'planet'] as const) {
    it(`${camera} reframes without distortion when the container goes 16:9`, async (ctx) => {
      await skipIfPresentedCanvasBroken(ctx)
      const source = periodicSource()
      // Square mount: the 16:9 reshape changes exactly one input -- the
      // aspect the fit resolves against -- so any distortion the comparison
      // finds is attributable to the fit alone.
      const container = makeContainer(360, 360)
      const projection: NonLinearProjection = { kind: camera, zoom: 1, extent: PAPERS[camera] }
      // Mounted through create directly rather than support/viewer's
      // imageViewer: the data-URL source and the per-leg paper are the
      // story's own inputs, which that helper's fixture-and-PROJECTIONS
      // shape does not take.
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
        const w = sampleWorst(read, source, projection, 640 / 360)
        // Loose on purpose: the readback downscales 640x360 -> 160x90 and
        // the fetch is nearest-neighbour, so a few channels of filtering
        // disagreement are expected. A stretch lands at O(100).
        // Mirror of the swap leg's kill scope (mutation drill 2026-10-07):
        // a mutant that skips the aspect store on the NON-LINEAR branch --
        // the render resolving 1:1 while the reference resolves 16:9 -- is
        // killed HERE and stays green on the swap leg; the two legs cover
        // each other's blind side.
        expect(
          w.worst,
          `${camera} after 16:9 reshape: worst channel ${w.worst} at (${w.px}, ${w.py}): ` +
            `got ${JSON.stringify(w.got)} vs expected ${JSON.stringify(w.expected)}`
        ).toBeLessThanOrEqual(TOLERANCE)
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
      const w = sampleWorst(read, source, projection, 400 / 200)
      expect(
        w.worst,
        `swap (stale-aspect mutant lands far above): worst channel ${w.worst} at (${w.px}, ${w.py}): ` +
          `got ${JSON.stringify(w.got)} vs expected ${JSON.stringify(w.expected)}`
      ).toBeLessThanOrEqual(TOLERANCE)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })
})
