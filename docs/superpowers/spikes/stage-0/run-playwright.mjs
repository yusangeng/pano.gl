/*
 * Playwright driver for the pano.gl stage-0 probe.
 *
 * This is the driver that matters for the rewrite, because Playwright is what
 * the project's integration and golden-image suites will actually use. The
 * dependency-free runner answers "can headless Chromium render"; this one
 * answers "will it render the way our CI invokes it".
 *
 * The specific claim under test: Playwright's default headless launch uses
 * `chromium_headless_shell`, which has no GPU at all, and the fix is an
 * explicit `channel: 'chromium'`. That claim is load-bearing for the CI design
 * and had only been read, never reproduced.
 *
 * Usage: node run-playwright.mjs
 */

import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const html = await readFile(path.join(here, 'index.html'), 'utf8')

async function run (label, launchOptions, browserType) {
  console.log(`\n${'='.repeat(72)}`)
  console.log(`CONFIG: ${label}`)
  console.log(`launch: ${JSON.stringify(launchOptions)}`)
  console.log('='.repeat(72))

  let browser
  try {
    browser = await browserType.launch(launchOptions)
  } catch (e) {
    console.log(`LAUNCH FAILED: ${String((e && e.message) || e)}`)
    return null
  }

  const version = browser.version()
  const executablePath = browserType.executablePath()

  const context = await browser.newContext()
  const page = await context.newPage()

  // Serving over http://localhost keeps the page in a secure context, which
  // WebGPU requires. Routing beats standing up a server for one page.
  await page.route('http://localhost/**', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ body: html, contentType: 'text/html; charset=utf-8' })
  })

  await page.goto('http://localhost/probe')

  let report = null
  try {
    await page.waitForFunction(() => window.__spikeReport !== undefined, null, { timeout: 120000 })
    report = await page.evaluate(() => window.__spikeReport)
  } catch (e) {
    console.log(`NO REPORT: page never finished (${String((e && e.message) || e)})`)
  }

  await browser.close()

  if (!report) return null

  const verdict = b => {
    const r = report[b]
    return r && r.ok ? `PASS` : `FAIL${r && r.error ? ' (' + r.error + ')' : ''}`
  }

  console.log(`browser.version():  ${version}`)
  console.log(`executablePath():   ${executablePath}`)
  console.log('')
  console.log(`  webgl1: ${verdict('webgl1')}`)
  console.log(`  webgl2: ${verdict('webgl2')}`)
  console.log(`  webgpu: ${verdict('webgpu')}`)

  const g = report.webgpu || {}
  if (g.adapter && g.adapter.info) {
    console.log(`  adapter: ${JSON.stringify(g.adapter.info)}`)
  }

  const p = g.projectionParity
  if (p && !p.error) {
    console.log(`  projection parity: hash=${p.bufferHash} maxDiffLat=${p.maxAbsDiffLat.toExponential(2)}`)
  }

  const x = g.externalTexture || {}
  if (x.videoElementFromRecordedFile) {
    const v = x.videoElementFromRecordedFile
    console.log(`  video decode: ${v.decoded ? 'OK' : 'FAIL'} ${v.pixel ? JSON.stringify(v.pixel) : (v.error || '')}`)
  }

  return { label, report, version, executablePath }
}

const results = []

// Mode 1 — Playwright's default. Expected to land on chromium_headless_shell.
results.push(await run('1: default headless (expect headless-shell, no GPU)', { headless: true }, chromium))

// Mode 2 — the documented fix.
results.push(await run('2: channel=chromium (full browser, --headless=new)', { channel: 'chromium', headless: true }, chromium))

console.log(`\n${'='.repeat(72)}`)
console.log('SUMMARY')
console.log('='.repeat(72))

for (const r of results) {
  if (!r) { console.log('  (config produced no report)'); continue }
  const g = r.report.webgpu || {}
  const gpu = g.ok ? `WebGPU=${JSON.stringify(g.adapter && g.adapter.info)}` : 'WebGPU=FAIL'
  console.log(`  ${r.label}`)
  console.log(`    binary: ${path.basename(r.executablePath)}`)
  console.log(`    ${gpu}`)
}
