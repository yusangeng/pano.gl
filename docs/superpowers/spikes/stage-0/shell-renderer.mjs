import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
const html = await readFile('index.html', 'utf8')

const b = await chromium.launch({ headless: true })
const page = await (await b.newContext()).newPage()
await page.route('http://localhost/**', r =>
  r.request().method() === 'POST' ? r.fulfill({ status: 204, body: '' })
                                  : r.fulfill({ body: html, contentType: 'text/html' }))
await page.goto('http://localhost/probe')
await page.waitForFunction(() => window.__spikeReport !== undefined, null, { timeout: 120000 })
const r = await page.evaluate(() => window.__spikeReport)
await b.close()

console.log('webgl1 renderer:', r.webgl1.context && r.webgl1.context.unmaskedRenderer)
console.log('webgl2 renderer:', r.webgl2.context && r.webgl2.context.unmaskedRenderer)
console.log('webgl2 render   :', r.webgl2.render && r.webgl2.render.matches)
console.log('webgpu error    :', r.webgpu && r.webgpu.error)
console.log('hasNavigatorGpu :', r.webgpu && r.webgpu.hasNavigatorGpu)
console.log('secureContext   :', r.isSecureContext)
