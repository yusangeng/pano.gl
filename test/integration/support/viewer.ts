/*
 * Creating viewers from a test.
 *
 * Imports `src/index.ts` and nothing deeper: this is the same surface a user of
 * the library has, and a helper that reached past it would let a user-story test
 * exercise something no user can reach without the test itself importing an
 * internal symbol -- which is the thing the discipline above is about.
 */

import { FramelessImageViewer, FramelessVideoViewer } from '../../../src/index'
import type { Projection } from '../../../src/core/types'
import { makeContainer } from './dom'

/*
 * The four projections, fully spelled out.
 *
 * `satisfies` rather than a type annotation: each entry is checked against the
 * union member it names, so a change to `Projection` breaks this file at
 * typecheck instead of at runtime in whichever test happens to use that camera.
 * An annotation would widen each entry to the whole union and lose that.
 *
 * `fov` is in radians. The legacy value was 70 degrees, because cuon's
 * `mat4.perspective` took degrees; the conversion lives here, once, rather than
 * at every call site.
 */
export const PROJECTIONS = {
  linear: { kind: 'linear', fov: (70 * Math.PI) / 180, aspect: 1 },
  cylindrical: { kind: 'cylindrical', zoom: 1, extent: [1, 1] },
  planet: { kind: 'planet', zoom: 1, extent: [4, 4] },
  pannini: { kind: 'pannini', zoom: 1, extent: [4, 4] }
} satisfies Record<string, Projection>

export type ProjectionName = keyof typeof PROJECTIONS

/** A viewer and the container it lives in. */
export interface Mounted<V> {
  readonly viewer: V
  readonly container: HTMLElement
}

/*
 * The plan's draft of these factories omitted `src` when the caller did, which
 * cannot work against the frozen surface: `ImageViewerOptions.src` is required
 * and `assertSrc` rejects its absence at runtime just as the compiler does.
 * There is no construct-without-a-source state to hand a test, so an omitted
 * `src` defaults to the fixture instead -- and every test that then assigns
 * `viewer.src` is still exercising the public setter, which is what the
 * user-story layer is for.
 *
 * One consequence tests have to respect: this factory's viewer starts loading
 * the fixture DURING `create`, so its `media-load` may fire before a test's
 * listener goes on. Counts taken from a listener attached after this call are
 * therefore baselines, not absolutes -- wait with `>=` for a load a test
 * triggered, and wait on pixels or pose where it was the initial frame that
 * mattered.
 */
const IMAGE_FIXTURE = '/fixtures/panorama.png'
const VIDEO_FIXTURE = '/fixtures/clip.mp4'

/**
 * Creates an image viewer in its own container.
 *
 * No DPR stubbing and no backend stubbing: the project's `deviceScaleFactor`
 * already sets the density, and whether a WebGPU backend exists is the
 * environment's business -- `user-story-no-webgpu.test.ts` runs in the project
 * where it does not.
 */
export async function imageViewer (
  options: { src?: string, camera?: ProjectionName, size?: readonly [number, number] } = {}
): Promise<Mounted<FramelessImageViewer>> {
  const container = makeContainer(...(options.size ?? []))
  const viewer = await FramelessImageViewer.create({
    container,
    src: options.src ?? IMAGE_FIXTURE,
    ...(options.camera === undefined ? {} : { camera: { projection: PROJECTIONS[options.camera] } })
  })
  return { viewer, container }
}

/** The video counterpart. `muted` and `autoplay` are the caller's business. */
export async function videoViewer (
  options: {
    src?: string
    camera?: ProjectionName
    size?: readonly [number, number]
    autoplay?: boolean
    loop?: boolean
  } = {}
): Promise<Mounted<FramelessVideoViewer>> {
  const container = makeContainer(...(options.size ?? []))
  const viewer = await FramelessVideoViewer.create({
    container,
    src: options.src ?? VIDEO_FIXTURE,
    ...(options.camera === undefined ? {} : { camera: { projection: PROJECTIONS[options.camera] } }),
    ...(options.autoplay === undefined ? {} : { autoplay: options.autoplay }),
    ...(options.loop === undefined ? {} : { loop: options.loop })
  })
  return { viewer, container }
}
