/*
 * Drives probe.html across the full camera x state matrix and writes the
 * baseline fixtures.
 *
 * Usage: node capture.mjs
 */

import { chromium } from 'playwright'
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATES, CAMERAS, CANVAS_SIZE, captureId } from './states.mjs'

/** Every capture must record this many frames; probe.html collects them. */
const FRAMES_PER_CAPTURE = 3

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const fixtureRoot = path.join(repoRoot, 'test/fixtures/baseline')

const bundle = await readFile(path.join(fixtureRoot, 'bundle.js'), 'utf8')
const html = (await readFile(path.join(here, 'probe.html'), 'utf8'))
  .replace('__CANVAS_SIZE__', String(CANVAS_SIZE))

if (html.includes('__CANVAS_SIZE__')) {
  throw new Error('CANVAS_SIZE placeholder was not substituted -- check the marker in probe.html')
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
 * The source the captures were made with, committed alongside them.
 *
 * A pixel gate cannot compare against these PNGs while rendering a different
 * panorama, and a consumer that regenerated this pattern would be a second copy
 * of it -- one that could silently drift from the one the baseline was actually
 * taken with. So the bytes are kept.
 */
await writeFile(
  path.join(fixtureRoot, 'source.png'),
  Buffer.from(sourceUrl.slice(sourceUrl.indexOf(',') + 1), 'base64')
)

const index = { canvasSize: CANVAS_SIZE, capturedAt: new Date().toISOString(), captures: [] }

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
      await writeFile(
        path.join(dir, `${state.id}.uniforms.json`),
        JSON.stringify({ camera, state, frames: uniforms }, null, 2)
      )

      index.captures.push({
        id,
        camera,
        state,
        frameCount: result.frames.length,
        pngBytes: png.length,
        pngSha256: createHash('sha256').update(png).digest('hex'),
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
