/*
 * The Node-side loader for P0's fixtures.
 *
 * The parsing lives in `baseline.ts` and is shared with the browser-mode gates;
 * this file is the part that can only exist under Node. Keeping the split means
 * a browser test can import the derivations without dragging in `node:fs`.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { captureFile, parseCaptureDoc, type CaptureDoc } from './baseline'

/**
 * `__dirname` is `test/support` under vitest, which executes the TypeScript
 * source rather than a build.
 */
export const fixtureRoot = path.resolve(__dirname, '../fixtures/baseline')

/** Reads one capture's recorded camera state and uniform stream from disk. */
export function readCaptureDoc (camera: string, stateId: string): CaptureDoc {
  const text = readFileSync(
    path.join(fixtureRoot, captureFile(camera, stateId, 'uniforms.json')),
    'utf8'
  )
  return parseCaptureDoc(text, camera, stateId)
}

/*
 * There is deliberately no PNG reader here. Pixels are only compared by P3's
 * gate A, which runs in the browser and decodes with `createImageBitmap`; a
 * Node-side decoder would be dead code plus a dependency (pngjs) that nothing
 * else needs.
 */
