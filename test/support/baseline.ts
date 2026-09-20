/*
 * Parsers and derivations for the v0.2.2 fixtures P0 captured.
 *
 * Shared by the unit-level matrix parity test and the render-level pixel gate,
 * because both have to agree on the same three derivations: what a capture's
 * camera state was, what fov the legacy matrix implies, and what quad extent
 * each non-linear camera used. Deriving any of them twice would create a second
 * source of truth for a question the fixture already answers.
 *
 * Deliberately free of I/O: the render-level gate runs in vitest's browser
 * mode, where `node:fs`, `path`, `__dirname` and pngjs do not exist, so a
 * single `readFileSync` in this file would make that whole test file fail to
 * load. Bytes come in as arguments; each environment supplies its own loader.
 */

/** The camera types P0 captured. `OrthoCamera` was never registered upstream. */
export const CAMERAS = ['perspective', 'cylindrical', 'planet', 'pannini'] as const
export type Camera = (typeof CAMERAS)[number]

/** The camera states P0 captured. Authoritative copy is `tools/baseline/states.mjs`. */
export const STATES = ['origin', 'tilt', 'south', 'zoomed'] as const

/** One point in camera-parameter space, as recorded in the fixture. */
export interface CapturedState {
  readonly id: string
  /** Degrees. */
  readonly lat: number
  /** Degrees. */
  readonly lng: number
  /** Discrete zoom steps applied via `viewer.zoom()`, not a scale factor. */
  readonly zoom: number
}

/** One uniform write, as the probe saw it. */
export interface UniformWrite {
  readonly name: string
  readonly value: number | number[]
}

/** A capture's uniform stream, keyed by uniform name. */
export type CapturedUniforms = Readonly<Record<string, number | number[]>>

/**
 * The legacy `CAMERA_WITH`/`CAMERA_HEGHT` per camera -- the quad's width and
 * height, which v1 calls `extent`. Read off
 * `legacy/core/camera/{Cylindrical,Planet,Pannini}Camera.js`.
 */
export const LEGACY_EXTENT: Record<Exclude<Camera, 'perspective'>, readonly [number, number]> = {
  cylindrical: [1, 1],
  planet: [4, 4],
  pannini: [4, 4]
}

/**
 * The legacy capture ran at 128x128, so aspect is 1. Read `fov` out of the
 * captured matrix rather than guessing it: the test is about whether the rest of
 * the pipeline agrees, and a wrong fov would produce a confident failure that
 * says nothing useful.
 *
 * cuon's `setPerspective` takes fovy in DEGREES and computes
 * `ct = cos(fovy/2) / sin(fovy/2) = 1 / tan(fovy/2)`, which is exactly
 * gl-matrix's `perspective` with fovy in radians.
 *
 * The capture holds `P * V`, not `P`, so the vertical scale is spread across a
 * whole row by the view rotation: element 5 alone is `f * cos(latitude)` and
 * only equals `f` at latitude 0. But math-row 1 of the product is `f` times the
 * (unit) up row of the view rotation -- the legacy eye sits at the origin, so
 * the view is a pure rotation -- and the length of that row is `f` at every
 * latitude. Column-major, that row is elements 1, 5 and 9.
 */
export function legacyFovFrom (matrix: readonly number[]): number {
  return 2 * Math.atan(1 / Math.hypot(matrix[1]!, matrix[5]!, matrix[9]!))
}

/**
 * A fixture file's path relative to the fixture root, POSIX-separated.
 *
 * Returned rather than opened so that the Node loader can join it to a
 * directory and the browser loader to a served URL, and so that the layout
 * lives in exactly one place.
 */
export function captureFile (
  camera: string,
  stateId: string,
  kind: 'uniforms.json' | 'png'
): string {
  return `${camera}/${stateId}.${kind}`
}

/** A capture's metadata without decoding its PNG. */
export interface CaptureDoc {
  readonly state: CapturedState
  /** The last frame's uniform values, keyed by name. */
  readonly captured: CapturedUniforms
  /** Every frame's uniform writes, in submission order. */
  readonly frames: readonly (readonly UniformWrite[])[]
}

/**
 * Parses one capture's recorded camera state and uniform stream.
 *
 * Takes the file's text, not a path -- see the module comment.
 *
 * Uses the last frame. The first frame after a camera swap may still be running
 * against the previous vertex buffer, because v0.2.2 rebuilds geometry only when
 * `camera.id` changes; the second is steady state and the third proves it.
 */
export function parseCaptureDoc (text: string, camera: string, stateId: string): CaptureDoc {
  const doc = JSON.parse(text) as { state: CapturedState, frames: UniformWrite[][] }

  const last = doc.frames.at(-1)
  if (!last) throw new Error(`${camera}/${stateId}: no frames recorded`)

  return {
    state: doc.state,
    captured: Object.fromEntries(last.map(u => [u.name, u.value])),
    frames: doc.frames
  }
}
