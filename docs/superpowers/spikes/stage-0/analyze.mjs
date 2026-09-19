/*
 * Determinism analysis for the stage-0 spike.
 *
 * Golden-image regression only works if a backend reproduces its own output
 * run to run. This compares the pixel-bearing fields within each backend's
 * runs (determinism) and across backends (portability), which together decide
 * where golden images may be generated and how wide the cross-backend
 * tolerance has to be.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, 'out')

function extractReport (file) {
  const txt = readFileSync(file, 'utf8')
  const start = txt.indexOf('\n{\n')
  const end = txt.indexOf('\n--- VERDICT ---')

  if (start === -1 || end === -1) return null

  try {
    return JSON.parse(txt.slice(start + 1, end))
  } catch (e) {
    return null
  }
}

/* Every field that carries rendered pixels, flattened to a comparable path. */
function pixelsOf (r) {
  const out = {}

  if (r.webgl1 && r.webgl1.render) out['webgl1.render'] = r.webgl1.render.pixel
  if (r.webgl2 && r.webgl2.render) out['webgl2.render'] = r.webgl2.render.pixel
  if (r.webgl2 && r.webgl2.defaultFramebufferPixel) out['webgl2.defaultFB'] = r.webgl2.defaultFramebufferPixel
  if (r.webgpu && r.webgpu.render) out['webgpu.render'] = r.webgpu.render.pixel

  const x = (r.webgpu && r.webgpu.externalTexture) || {}
  if (x.videoFrameFromCanvas && x.videoFrameFromCanvas.pixel) out['ext.videoFrame'] = x.videoFrameFromCanvas.pixel
  if (x.videoElementFromCaptureStream && x.videoElementFromCaptureStream.pixel) out['ext.videoElement'] = x.videoElementFromCaptureStream.pixel
  if (x.videoElementFromRecordedFile && x.videoElementFromRecordedFile.pixel) out['ext.decodedFile'] = x.videoElementFromRecordedFile.pixel

  return out
}

const files = readdirSync(outDir).filter(f => f.endsWith('.txt')).sort()

const reports = {}
for (const f of files) {
  const r = extractReport(path.join(outDir, f))
  if (r) reports[f] = r
  else console.log(`!! could not parse ${f}`)
}

const groups = {
  metal: Object.keys(reports).filter(k => k.startsWith('metal-')),
  swiftshader: Object.keys(reports).filter(k => k.startsWith('swiftshader-'))
}

console.log('='.repeat(72))
console.log('PER-BACKEND DETERMINISM (identical pixels across repeated runs?)')
console.log('='.repeat(72))

const representative = {}

for (const [name, keys] of Object.entries(groups)) {
  if (!keys.length) continue

  const perKey = {}
  for (const k of keys) {
    const px = pixelsOf(reports[k])
    for (const [field, val] of Object.entries(px)) {
      ;(perKey[field] ||= []).push(JSON.stringify(val))
    }
  }

  console.log(`\n[${name}]  runs=${keys.length}`)

  for (const [field, vals] of Object.entries(perKey)) {
    const unique = Array.from(new Set(vals))
    const stable = unique.length === 1
    console.log(`  ${stable ? 'STABLE  ' : 'VARIES  '} ${field.padEnd(20)} ${unique.join('  |  ')}`)
  }

  representative[name] = pixelsOf(reports[keys[0]])
}

console.log('\n' + '='.repeat(72))
console.log('CROSS-BACKEND DELTA (metal vs swiftshader, same scene)')
console.log('='.repeat(72))

const m = representative.metal || {}
const s = representative.swiftshader || {}

for (const field of Object.keys(m)) {
  if (!s[field]) { console.log(`  ${field.padEnd(20)} only in metal`); continue }

  const a = m[field]
  const b = s[field]
  const deltas = a.map((v, i) => Math.abs(v - b[i]))
  const max = Math.max(...deltas)

  console.log(`  ${field.padEnd(20)} maxDelta=${String(max).padStart(3)}  metal=${JSON.stringify(a)} swift=${JSON.stringify(b)}`)
}

console.log('\n' + '='.repeat(72))
console.log('ENVIRONMENT')
console.log('='.repeat(72))

for (const [name, keys] of Object.entries(groups)) {
  if (!keys.length) continue
  const r = reports[keys[0]]
  console.log(`\n[${name}]`)
  console.log(`  adapter: ${JSON.stringify(r.webgpu && r.webgpu.adapter && r.webgpu.adapter.info)}`)
  console.log(`  deviceFeatures: ${JSON.stringify(r.webgpu && r.webgpu.device && r.webgpu.device.features)}`)
  console.log(`  wgsl: ${JSON.stringify({
    immediates: !!(r.webgpu && r.webgpu.wgslFeatures && r.webgpu.wgslFeatures.immediates.supported),
    f16: !!(r.webgpu && r.webgpu.wgslFeatures && r.webgpu.wgslFeatures.f16.supported)
  })}`)
  console.log(`  glRenderer: ${r.webgl2 && r.webgl2.context && r.webgl2.context.unmaskedRenderer}`)
  console.log(`  codecs: ${JSON.stringify(r.webgpu && r.webgpu.externalTexture && r.webgpu.externalTexture.codecSupport)}`)
}
