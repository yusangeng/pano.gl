/*
 * Stage-0 harness for the pano.gl rewrite.
 *
 * Serves the probe page over http://127.0.0.1 (a secure context, which WebGPU
 * requires), launches a headless Chromium against it, and collects the result
 * the page POSTs back.
 *
 * Deliberately dependency-free: the npm registry is unreachable in this
 * environment, and a CI feasibility claim is only worth anything if it rests on
 * something that actually ran here.
 *
 * Usage:
 *   node run.mjs --name=<label> --chrome=<path> [--timeout=45000] -- [chrome flags...]
 */

import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

function parseArgs (argv) {
  const out = { flags: [], name: 'unnamed', timeout: 45000 }

  let i = 0
  for (; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { i++; break }
    if (a.startsWith('--name=')) out.name = a.slice(7)
    else if (a.startsWith('--chrome=')) out.chrome = a.slice(9)
    else if (a.startsWith('--timeout=')) out.timeout = Number(a.slice(10))
  }

  out.flags = argv.slice(i)
  return out
}

const args = parseArgs(process.argv.slice(2))

if (!args.chrome) {
  console.error('missing --chrome=<path>')
  process.exit(2)
}

const page = await readFile(path.join(here, 'index.html'), 'utf8')

let resolveResult
const resultPromise = new Promise(resolve => { resolveResult = resolve })

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      res.writeHead(204).end()
      resolveResult(Buffer.concat(chunks).toString('utf8'))
    })
    return
  }

  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page)
    return
  }

  res.writeHead(404).end('not found')
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const url = `http://127.0.0.1:${port}/`

const userDataDir = await mkdtemp(path.join(tmpdir(), 'pano-spike-'))

// A distinct user-data-dir keeps this from colliding with the user's running
// Chrome, which would otherwise make the launch fail or silently reuse a
// profile that has different GPU flags baked in.
const chromeArgs = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
  `--user-data-dir=${userDataDir}`,
  ...args.flags,
  url
]

const child = spawn(args.chrome, chromeArgs, {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe']
})

let stderr = ''
child.stderr.on('data', d => { stderr += d.toString() })
child.stdout.on('data', () => {})

let timedOut = false
const timer = setTimeout(() => { timedOut = true; resolveResult(null) }, args.timeout)

const payload = await resultPromise

clearTimeout(timer)

/* Chrome's helper processes outlive a SIGTERM to the parent, so kill the whole
 * process group and then confirm it is gone before reporting. */
function killTree () {
  try { process.kill(-child.pid, 'SIGKILL') } catch (e) { /* already gone */ }
}

killTree()
await new Promise(resolve => setTimeout(resolve, 300))
killTree()

server.close()
await rm(userDataDir, { recursive: true, force: true }).catch(() => {})

const header = `\n${'='.repeat(70)}\nCONFIG: ${args.name}\n${'='.repeat(70)}`
console.log(header)
console.log(`chrome: ${args.chrome}`)
console.log(`flags:  ${args.flags.length ? args.flags.join(' ') : '(none)'}`)

if (timedOut) {
  console.log(`\nRESULT: TIMEOUT after ${args.timeout}ms — page never posted a report.`)
  console.log(`--- chrome stderr (tail) ---\n${stderr.split('\n').slice(-25).join('\n')}`)
  process.exit(1)
}

console.log(payload)

// A machine-readable verdict per backend, so the matrix can be assembled
// without re-reading the full report by eye.
try {
  const r = JSON.parse(payload)
  console.log('\n--- VERDICT ---')
  console.log(`webgl1: ${r.webgl1 && r.webgl1.ok ? 'PASS' : 'FAIL'}  ${r.webgl1 && r.webgl1.error ? '(' + r.webgl1.error + ')' : ''}`)
  console.log(`webgl2: ${r.webgl2 && r.webgl2.ok ? 'PASS' : 'FAIL'}  ${r.webgl2 && r.webgl2.error ? '(' + r.webgl2.error + ')' : ''}`)
  console.log(`webgpu: ${r.webgpu && r.webgpu.ok ? 'PASS' : 'FAIL'}  ${r.webgpu && r.webgpu.error ? '(' + r.webgpu.error + ')' : ''}`)
  if (r.webgpu && r.webgpu.adapter && r.webgpu.adapter.info) {
    console.log(`webgpu adapter: ${JSON.stringify(r.webgpu.adapter.info)}`)
  }
  if (r.webgpu && r.webgpu.projectionParity) {
    const p = r.webgpu.projectionParity
    if (p.error) {
      console.log(`  projection parity: ERROR ${p.error}`)
    } else {
      console.log(`  projection parity: hash=${p.bufferHash} maxDiffU=${p.maxAbsDiffU.toExponential(2)} maxDiffV=${p.maxAbsDiffV.toExponential(2)} maxDiffLon=${p.maxAbsDiffLon.toExponential(2)} maxDiffLat=${p.maxAbsDiffLat.toExponential(2)} (${p.samples} samples)`)
    }
  }
  if (r.webgpu && r.webgpu.externalTexture) {
    const x = r.webgpu.externalTexture
    const vf = x.videoFrameFromCanvas
    const ve = x.videoElementFromCaptureStream
    console.log(`  video (VideoFrame from canvas):  ${vf && vf.imported ? 'IMPORTED' : 'FAILED'} ${vf && vf.pixel ? 'pixel=' + JSON.stringify(vf.pixel) + ' near=' + vf.nearSource : (vf && vf.error) || ''}`)
    console.log(`  video (HTMLVideoElement stream): ${ve && ve.played ? 'PLAYED' : 'FAILED'} ${ve && ve.pixel ? 'pixel=' + JSON.stringify(ve.pixel) + ' near=' + ve.nearSource : (ve && ve.error) || ''}`)
    const vr = x.videoElementFromRecordedFile
    console.log(`  video (decoded from file):       ${vr && vr.decoded ? 'DECODED' : 'FAILED'} ${vr && vr.pixel ? `${vr.mime} ${vr.blobBytes}B pixel=${JSON.stringify(vr.pixel)} near=${vr.nearSource}` : (vr && vr.error) || ''}`)
    if (x.codecSupport) console.log(`  codecs: ${JSON.stringify(x.codecSupport)}`)
  }
  if (r.webgpu && r.webgpu.wgslFeatures) {
    const w = r.webgpu.wgslFeatures
    console.log(`  wgsl immediates=${w.immediates && w.immediates.supported} f16=${w.f16 && w.f16.supported}`)
  }
} catch (e) {
  console.log('\n--- VERDICT --- (payload was not valid JSON)')
}
