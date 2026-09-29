/**
 * The socket between the lab shell and the panels, plus shared defaults.
 *
 * Panels never hold a viewer instance across swaps: the shell owns the
 * lifecycle (source swap, image <-> video recreation) and publishes the
 * current viewer through `ViewerBox`, so a panel wired once keeps working
 * after any recreation.
 */
import type { FramelessImageViewer, FramelessVideoViewer, BackendPreference, Projection, ProjectionKind } from '../../src/index'

export type SourceId = '2k' | '4k' | '8k' | 'video'

/** What the shell currently owns; published through `ViewerBox`. */
export interface LabViewer {
  readonly viewer: FramelessImageViewer | FramelessVideoViewer
  readonly mode: 'image' | 'video'
  readonly source: SourceId
}

/** Everything a panel may do. All state changes funnel through the shell. */
export interface LabContext {
  /** Applies a projection change and syncs the URL. */
  readonly setProjection: (projection: Projection) => void
  /** Applies a source change and syncs the URL. */
  readonly setSource: (source: SourceId) => void
  /** Applies a backend preference (recreates the viewer, pose carried); the URL follows on success. */
  readonly setBackend: (backend: BackendPreference) => void
  /** Viewer replacements; fires immediately with the current value. */
  readonly onViewer: (listener: (current: LabViewer | null) => void) => () => void
}

/** Observable holder for the viewer the shell currently owns. */
export class ViewerBox {
  #current: LabViewer | null = null
  readonly #listeners = new Set<(current: LabViewer | null) => void>()

  get current (): LabViewer | null {
    return this.#current
  }

  subscribe (listener: (current: LabViewer | null) => void): () => void {
    this.#listeners.add(listener)
    listener(this.#current)
    return () => { this.#listeners.delete(listener) }
  }

  publish (current: LabViewer | null): void {
    this.#current = current
    for (const listener of this.#listeners) listener(current)
  }
}

/**
 * Lab defaults per kind. fov is radians on the public boundary; the
 * non-linear defaults keep the legacy surface sizes (1x1 cylindrical and
 * mercator -- mercator's 1x1 per the 2026-09-29 mercator-camera spec §2.3 --
 * and 4x4 planet/pannini).
 */
export function defaultProjection (kind: ProjectionKind): Projection {
  if (kind === 'linear') return { kind, fov: (70 * Math.PI) / 180, aspect: 1 }
  const extent = kind === 'cylindrical' || kind === 'mercator' ? 1 : 4
  return { kind, zoom: 1, extent: [extent, extent] }
}
