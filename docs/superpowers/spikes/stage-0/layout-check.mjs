import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
const html = await readFile('index.html', 'utf8')

for (const [label, opts] of [
  ['metal (real GPU)', { channel: 'chromium', headless: true }],
  ['swiftshader', { channel: 'chromium', headless: true,
    args: ['--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader', '--enable-unsafe-webgpu'] }]
]) {
  const b = await chromium.launch(opts)
  const page = await (await b.newContext()).newPage()
  await page.route('http://localhost/**', r =>
    r.request().method() === 'POST' ? r.fulfill({ status: 204, body: '' })
                                    : r.fulfill({ body: html, contentType: 'text/html' }))
  await page.goto('http://localhost/probe')
  await page.waitForFunction(() => window.__spikeReport !== undefined, null, { timeout: 180000 })
  const r = await page.evaluate(() => window.__spikeReport)
  await b.close()

  const L = r.webgpu && r.webgpu.uniformLayout
  console.log(`\n### ${label} ###`)
  if (!L) { console.log('  no result'); continue }
  if (L.error) { console.log(`  ERROR: ${L.error}`); continue }
  console.log(`  scalarsPacked(4B align) : ${L.scalarsPacked}`)
  console.log(`  matrixColumnMajor       : ${L.matrixColumnMajor}`)
  console.log(`  gotA  : ${JSON.stringify(L.gotA)}  expect [7, 11, 1.25, 2.5]`)
  console.log(`  gotB  : ${JSON.stringify(L.gotB)}  expect [3.75, 4.0625, 5.125, 6.5]`)
  console.log(`  gotClip: ${JSON.stringify(L.gotClip)}  expect [2.5, 4.5, 3.5, 1]`)
  console.log(`  VERDICT: ${L.ok ? 'PASS' : 'FAIL'}`)
}
