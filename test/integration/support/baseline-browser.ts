/*
 * The browser-side loader for P0's fixtures.
 *
 * The parsing and the derivations live in `baseline.ts` and are shared with the
 * Node-side parity test; this file is only the I/O, and in a browser the I/O is
 * a fetch.
 *
 * `import.meta.glob` rather than a template-literal `import()`: Vite's `?url`
 * suffix only resolves reliably on a static specifier, and a computed path
 * silently degrades to a runtime fetch of a path that is not served. The glob is
 * eager so callers get a plain lookups-by-path table instead of a promise per
 * entry, and `captureFile` (shared with the Node loader) supplies the keys --
 * which is what keeps the fixture layout in one place across both environments.
 */

import { captureFile, parseCaptureDoc, type Camera, type CaptureDoc } from '../../support/baseline'

/*
 * `{png,json}` and not `**`, so the glob skips `bundle.js` -- a few hundred KB of
 * v0.2.2 webpack output that is committed for the capture tool and that no test
 * reads. Globbing it would hand Vite an asset to process on every test run for
 * nothing.
 *
 * `query` rather than the older `as`: Vitest 5 runs on Vite 7, where `as` is
 * deprecated.
 */
const urls = import.meta.glob('../../fixtures/baseline/**/*.{png,json}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** The served URL for one fixture file. Throws rather than returning undefined. */
function fixtureUrl (path: string): string {
  const url = urls[`../../fixtures/baseline/${path}`]
  if (!url) throw new Error(`fixture not found: ${path}`)
  return url
}

/** Every capture state the baseline holds for a camera, read off the directory. */
export function statesOf (camera: string): string[] {
  const prefix = `../../fixtures/baseline/${camera}/`
  return Object.keys(urls)
    .filter(p => p.startsWith(prefix) && p.endsWith('.png'))
    .map(p => p.slice(prefix.length).replace(/\.png$/, ''))
    .sort()
}

/** Every camera the baseline holds, read off the directory. */
export function camerasOf (): Camera[] {
  const seen = new Set<Camera>()
  for (const p of Object.keys(urls)) {
    const rest = p.slice('../../fixtures/baseline/'.length)
    const slash = rest.indexOf('/')
    if (slash > 0) seen.add(rest.slice(0, slash) as Camera)
  }
  return [...seen].sort()
}

/** Decoded pixels plus the dimensions they came at. */
export interface DecodedImage {
  readonly width: number
  readonly height: number
  /** RGBA8, top-down, row-major. */
  readonly rgba: Uint8ClampedArray
}

/**
 * Decodes a fixture PNG.
 *
 * Via `createImageBitmap` + a 2D canvas rather than an image element, because
 * `getImageData` hands back raw bytes and `ImageBitmap` is itself a valid
 * `copyExternalImageToTexture` source -- so the same object serves as both the
 * comparison baseline and the renderer's input.
 *
 * `colorSpaceConversion: 'none'` and `premultiplyAlpha: 'none'` are both
 * load-bearing. The defaults let the browser colour-manage the image, which
 * silently changes pixel values; the baseline has to arrive as the bytes P0
 * wrote or every tolerance below is measuring the browser's colour pipeline.
 */
export async function decodeFixture (path: string): Promise<DecodedImage> {
  const response = await fetch(fixtureUrl(path))
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none'
  })

  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D context unavailable')
  ctx.drawImage(bitmap, 0, 0)
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  bitmap.close()

  return { width: canvas.width, height: canvas.height, rgba: data }
}

/** Reads one capture's recorded camera state and uniform stream. */
export async function readCaptureDoc (camera: string, stateId: string): Promise<CaptureDoc> {
  const response = await fetch(fixtureUrl(captureFile(camera, stateId, 'uniforms.json')))
  if (!response.ok) throw new Error(`${camera}/${stateId}: ${response.status}`)
  return parseCaptureDoc(await response.text(), camera, stateId)
}

/** A capture's metadata plus its decoded pixels. */
export interface Capture extends CaptureDoc {
  readonly image: DecodedImage
}

/** Reads one capture including its pixels. */
export async function loadCapture (camera: string, stateId: string): Promise<Capture> {
  const [doc, image] = await Promise.all([
    readCaptureDoc(camera, stateId),
    decodeFixture(captureFile(camera, stateId, 'png'))
  ])
  return { ...doc, image }
}

/** The source the P0 captures were made with, decoded. */
export function loadSource (): Promise<DecodedImage> {
  return decodeFixture('source.png')
}
