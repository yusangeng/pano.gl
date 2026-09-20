/*
 * Drives probe.html across the full camera x state matrix and writes the
 * baseline fixtures.
 *
 * Usage: node capture.mjs
 */

import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STATES, CAMERAS, CANVAS_SIZE, captureId,
  FRAMES_PER_CAPTURE, isSoftwareRenderer
} from './states.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const fixtureRoot = path.join(repoRoot, 'test/fixtures/baseline')

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

const bundle = await readFile(path.join(fixtureRoot, 'bundle.js'))
// Both directions: a marker missing from probe.html would inject `undefined`
// into the page script, and a marker left unsubstituted would inject its own
// name -- either way the failure is much louder here than inside the browser.
const probeSrc = await readFile(path.join(here, 'probe.html'), 'utf8')
const substitutions = {
  __CANVAS_SIZE__: String(CANVAS_SIZE),
  __FRAMES_PER_CAPTURE__: String(FRAMES_PER_CAPTURE)
}
let html = probeSrc
for (const [marker, value] of Object.entries(substitutions)) {
  if (!html.includes(marker)) {
    throw new Error(`probe.html no longer contains the marker ${marker} -- check the page script`)
  }
  html = html.replaceAll(marker, value)
}

/*
 * channel: 'chromium' is load-bearing. Playwright's default headless launch is
 * chrome-headless-shell, which renders WebGL through SwiftShader. For a WebGL1
 * baseline that would probably still be reproducible, but it is a different
 * rasterizer than the one users have, and a baseline measured on the wrong
 * rasterizer is a baseline of the wrong thing.
 */
const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage()

/*
 * Without this, a wedged GPU process leaves page.evaluate hanging forever --
 * no output, no index.json, no error, just silence (review finding 6). 60s is
 * an order of magnitude above a healthy capture (~1s), so tripping it means
 * something is genuinely stuck.
 */
page.setDefaultTimeout(60_000)

page.on('console', m => console.log(`  [page:${m.type()}] ${m.text()}`))
page.on('pageerror', e => { console.error(`  [page:error] ${e.message}`) })

// Serving over http:// keeps the page in a secure context and gives the bundle
// a real origin to resolve against. Routing beats standing up a server.
await page.route('http://localhost/**', route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/bundle.js') {
    return route.fulfill({ body: bundle, contentType: 'application/javascript' })
  }
  return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' })
})

await page.goto('http://localhost/probe')

const sourceUrl = await page.evaluate(size => {
  // Reuse the probe's own generator so capture and probe cannot disagree.
  return window.__makeSource(size)
}, CANVAS_SIZE)

/*
 * Assert the rasterizer *before* producing anything. channel:'chromium' asks
 * for the real GPU, but nothing above verified we got it: headless Chromium
 * falls back to software rasterization without an error when its GPU process
 * cannot start, and 16 perfectly self-consistent captures taken on software
 * would pass every downstream check while being a baseline of the wrong
 * rasterizer. The predicate (states.mjs) also matches llvmpipe/lavapipe --
 * Mesa's software stack, the default fallback on headless Linux, which does
 * not say "software" anywhere in its string. The renderer string is recorded
 * in index.json so the frozen baseline also carries the provenance a
 * regeneration can be diffed against.
 */
const renderer = await page.evaluate(() => window.__rendererInfo())
if (!renderer || isSoftwareRenderer(renderer)) {
  throw new Error(`hardware rasterizer required, but the browser reports: ${renderer || 'no WebGL context'}`)
}
console.log(`renderer: ${renderer}`)

/*
 * The source the captures were made with, committed alongside them.
 *
 * A pixel gate cannot compare against these PNGs while rendering a different
 * panorama, and a consumer that regenerated this pattern would be a second copy
 * of it -- one that could silently drift from the one the baseline was actually
 * taken with. So the bytes are kept.
 */
const sourcePng = Buffer.from(sourceUrl.slice(sourceUrl.indexOf(',') + 1), 'base64')
await writeFile(path.join(fixtureRoot, 'source.png'), sourcePng)

/*
 * Both baseline inputs are anchored in the manifest (review finding 2):
 * source.png is the single input function of all 16 captures, and bundle.js
 * is the measured artifact itself. A wrong file, a truncated copy, or a
 * line-ending "normalization" of the 17k-line bundle would otherwise drift
 * silently until a downstream gate fails looking like a renderer bug.
 */
const index = {
  canvasSize: CANVAS_SIZE,
  renderer,
  capturedAt: new Date().toISOString(),
  sourceSha256: sha256(sourcePng),
  bundleSha256: sha256(bundle),
  captures: []
}

/*
 * Start from a clean slate. Nothing downstream reconciles the fixture tree
 * with index.json across runs, so a file left by a previous run -- a capture
 * that used to succeed, a matrix entry that no longer exists -- would sit
 * there looking exactly like a fresh product and silently satisfy a verifier
 * that enumerates the matrix. The static files (bundle.js, README.md) live at
 * the fixture root and are not touched; only the per-camera outputs go.
 */
for (const camera of CAMERAS) {
  await rm(path.join(fixtureRoot, camera), { recursive: true, force: true })
}

for (const camera of CAMERAS) {
  for (const state of STATES) {
    const id = captureId(camera, state)
    process.stdout.write(`capturing ${id} ... `)
    try {
      const result = await page.evaluate(
        ([c, s, u]) => window.__capture(c, s, u),
        [camera, state, sourceUrl]
      )

      /*
       * A short frame list means the recorder stopped early, which would make
       * the "steady state" claim empty while still resolving successfully. That
       * is a failed capture, not a smaller fixture.
       */
      if (result.frames.length !== FRAMES_PER_CAPTURE) {
        throw new Error(`expected ${FRAMES_PER_CAPTURE} frames, got ${result.frames.length}`)
      }

      /*
       * The three frames exist to prove steady state; collecting them only
       * means something if something asserts it. A transient first frame --
       * eased camera, late texture effect -- would otherwise be frozen into
       * the baseline while every structural check passes. PNG data URLs are
       * base64 of the exact bytes, so string equality is byte equality.
       */
      const first = result.frames[0]
      const steady = result.frames.every(
        f => f.png === first.png && JSON.stringify(f.uniforms) === JSON.stringify(first.uniforms)
      )
      if (!steady) {
        throw new Error('frames differ across the three-frame window -- no steady state')
      }

      const dir = path.join(fixtureRoot, camera)
      await mkdir(dir, { recursive: true })

      // PNG data URL -> raw bytes. Binary, so a text diff will not show it;
      // index.json carries a hash so a changed fixture is still visible.
      const png = Buffer.from(result.frames.at(-1).png.split(',')[1], 'base64')
      await writeFile(path.join(dir, `${state.id}.png`), png)

      const uniforms = result.frames.map(f => f.uniforms)
      const uniformsJson = JSON.stringify({ camera, state, frames: uniforms }, null, 2)
      await writeFile(path.join(dir, `${state.id}.uniforms.json`), uniformsJson)

      index.captures.push({
        id,
        camera,
        state,
        frameCount: result.frames.length,
        pngBytes: png.length,
        pngSha256: sha256(png),
        // The uniform stream is the phase's own primary product -- the only
        // carrier of the F10/F11 conclusions and of what P2 will diff
        // against. Anchoring it closes the last un-hashed output (review
        // finding 1): a hand-edited value, a bad merge, or CRLF rewriting
        // used to pass every structural check.
        uniformsSha256: sha256(Buffer.from(uniformsJson)),
        uniformNames: [...new Set(uniforms.flat().map(u => u.name))].sort()
      })
      console.log(`ok (${result.frames.length} frames, ${png.length}B)`)
    } catch (e) {
      console.log(`FAILED: ${e.message}`)
      /*
       * The two files of a state are written separately, so the throw can
       * land between them -- a fresh png next to a stale uniforms.json, or
       * either next to files from a previous successful run of a state that
       * now fails. A failed capture must leave nothing behind that a
       * matrix-enumerating verifier could mistake for its fixture.
       */
      await rm(path.join(fixtureRoot, camera, `${state.id}.png`), { force: true })
      await rm(path.join(fixtureRoot, camera, `${state.id}.uniforms.json`), { force: true })
      index.captures.push({ id, camera, state, error: e.message })
    }
  }
}

await browser.close()

await writeFile(path.join(fixtureRoot, 'index.json'), JSON.stringify(index, null, 2))

const failed = index.captures.filter(c => c.error)
console.log(`\n${index.captures.length - failed.length}/${index.captures.length} captures ok`)
if (failed.length) {
  console.error('failed:', failed.map(f => f.id).join(', '))
  process.exit(1)
}

/*
 * Fail closed (review finding 5). Everything asserted so far compares frames
 * to each other -- steady state, frame count, the software gate -- so a
 * context that dies mid-capture and hands back three identical black frames
 * sails through with exit 0. The content oracle lives in the test suite, and
 * the regeneration instructions people actually follow say "run capture.mjs"
 * and trust its exit code. So the exit code has to carry the suite: this
 * re-runs every fixture assertion (hashes, content, provenance) over what is
 * now on disk, and a red suite means this script failed, not "captured fine,
 * verify separately".
 */
const verifyEnv = { ...process.env }
delete verifyEnv.NODE_TEST_CONTEXT
const verified = spawnSync(process.execPath, [path.join(here, 'verify-fixtures.mjs')], {
  stdio: 'inherit',
  env: verifyEnv
})
if (verified.status !== 0) {
  console.error('\ncapture completed but the fixture suite rejected the result -- not a valid baseline')
  process.exit(1)
}
