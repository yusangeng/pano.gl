import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir, mkdir, mkdtemp, writeFile, rm, cp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  STATES, CAMERAS, CANVAS_SIZE, captureId,
  FRAMES_PER_CAPTURE, isSoftwareRenderer, STATIC_FIXTURE_FILES
} from './states.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../test/fixtures/baseline')
const readJson = async p => JSON.parse(await readFile(p, 'utf8'))
const capture = (camera, state) => readJson(path.join(root, camera, `${state}.uniforms.json`))
const lastFrame = doc => doc.frames.at(-1)
const uniform = (doc, name) => lastFrame(doc).find(u => u.name === name)
const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/*
 * Every regular file under `dir`, as absolute paths -- relativisation happens
 * once, at the call site, because doing it per recursion level resolves the
 * child's relative strings against the process cwd instead of the fixture
 * root and invents phantom paths. Symlinks and other oddities are returned
 * too, so the orphan check fails on them rather than walking past them.
 */
const walk = async dir => {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...await walk(p))
    else out.push(p)
  }
  return out
}

/*
 * Minimal PNG decoder for the one job this suite needs: proving a fixture
 * holds real image content rather than a valid signature over garbage.
 * Supports exactly what Chromium's canvas encoder emits -- 8-bit RGBA,
 * non-interlaced -- and throws on any other shape, which is the right
 * behaviour for a verifier of frozen bytes.
 */
const decodePng = buf => {
  let off = 8
  let ihdr = null
  const idat = []
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') ihdr = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] }
    if (type === 'IDAT') idat.push(data)
    if (type === 'IEND') break
    off += 12 + len
  }
  if (!ihdr) throw new Error('png has no IHDR chunk')
  if (ihdr.depth !== 8 || ihdr.color !== 6 || ihdr.interlace !== 0) {
    throw new Error(`unsupported png shape: depth=${ihdr.depth} color=${ihdr.color} interlace=${ihdr.interlace}`)
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = ihdr.width * 4
  const px = Buffer.alloc(ihdr.height * stride)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[y * stride + i - 4] : 0
      const b = y > 0 ? px[(y - 1) * stride + i] : 0
      const c = (i >= 4 && y > 0) ? px[(y - 1) * stride + i - 4] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) v += paeth(a, b, c)
      px[y * stride + i] = v & 255
    }
  }
  return { width: ihdr.width, height: ihdr.height, pixels: px }
}

/*
 * A capture that failed is recorded in index.json as a stub carrying only
 * { id, camera, state, error } -- no uniformNames, and no files on disk. The
 * tests below iterate captures and read those fields, so without this filter a
 * single failed capture would surface as a pile of TypeErrors and ENOENTs that
 * bury the one useful message. Completeness is asserted directly by the first
 * two tests, which is where a missing capture should fail.
 */
const captured = index => index.captures.filter(c => !c.error)

// Read once at load: six tests were re-reading the same manifest.
const INDEX = await readJson(path.join(root, 'index.json'))

test('every camera x state pair has a capture', async () => {
  const got = new Set(captured(INDEX).map(c => c.id))
  for (const camera of CAMERAS) {
    for (const state of STATES) {
      assert.ok(got.has(captureId(camera, state)), `missing capture ${captureId(camera, state)}`)
    }
  }
})

test('every capture recorded the camera transform and both projection kinds', async () => {
  for (const c of INDEX.captures) {
    assert.ok(!c.error, `${c.id}: ${c.error}`)
    for (const name of ['u_CamTransMatrix', 'u_CamProjType', 'u_TexProjType']) {
      assert.ok(c.uniformNames.includes(name), `${c.id} is missing ${name}`)
    }
  }
})

test('the captured projection kind matches the camera under test', async () => {
  // Guards the fixture itself: a probe that silently fell back to the default
  // camera would otherwise produce a complete, self-consistent, wrong baseline.
  const EXPECTED = { perspective: 1, cylindrical: 2, planet: 3, pannini: 4 }
  for (const c of captured(INDEX)) {
    const doc = await readJson(path.join(root, c.camera, `${c.state.id}.uniforms.json`))
    const kind = uniform(doc, 'u_CamProjType')
    assert.ok(kind, `${c.id} has no u_CamProjType`)
    assert.equal(kind.value, EXPECTED[c.camera], `${c.id} projected as kind ${kind.value}`)
  }
})

test('camera rotation reaches the GPU', async () => {
  /*
   * The counter-test to the u_CamPOVLatitude finding: if rotation moved nothing
   * at all, every fixture would be worthless and this catches it.
   *
   * Which uniform carries the pose is camera-family dependent, and asserting on
   * the transform matrix alone would be wrong for three of the four:
   *
   *   - the linear camera receives no POV uniform at all and moves only
   *     u_CamTransMatrix;
   *   - the three non-linear cameras hold u_CamTransMatrix *constant* (it comes
   *     from the internal ortho camera, constructed at (0, 0) and never updated)
   *     and carry the pose solely in u_CamPOVLongitude.
   *
   * Both halves are asserted, so a future change that moves the pose into a
   * different uniform fails here rather than silently weakening the baseline.
   */
  const CARRIER = {
    perspective: 'u_CamTransMatrix',
    cylindrical: 'u_CamPOVLongitude',
    planet: 'u_CamPOVLongitude',
    pannini: 'u_CamPOVLongitude'
  }
  for (const camera of CAMERAS) {
    const name = CARRIER[camera]
    const a = uniform(await capture(camera, 'origin'), name)
    const b = uniform(await capture(camera, 'tilt'), name)
    assert.ok(a, `${camera}: origin has no ${name}`)
    assert.ok(b, `${camera}: tilt has no ${name}`)
    assert.notEqual(JSON.stringify(a.value), JSON.stringify(b.value), `${camera}: rotate() did not change ${name}`)
  }
})

test('pixels decode to a full RGBA frame', async () => {
  for (const c of captured(INDEX)) {
    const png = await readFile(path.join(root, c.camera, `${c.state.id}.png`))
    assert.ok(png.length > 0, `${c.id}: empty png`)
    // PNG signature. A base64 slip would produce a file that is non-empty but
    // not a PNG, which a length check alone would happily accept.
    assert.deepEqual(
      [...png.subarray(0, 4)],
      [0x89, 0x50, 0x4e, 0x47],
      `${c.id}: not a PNG`
    )
    // Decode, and tie the frame's own header to the declared capture
    // resolution -- independent of anything index.json says about it, so a
    // cropped or resized frame cannot pass as the fixture it claims to be.
    const { width, height } = decodePng(png)
    assert.equal(width, CANVAS_SIZE, `${c.id}: png is ${width}px wide, expected ${CANVAS_SIZE}`)
    assert.equal(height, CANVAS_SIZE, `${c.id}: png is ${height}px tall, expected ${CANVAS_SIZE}`)
  }
})

test('every frame carries real image content', async () => {
  /*
   * The content oracle. Everything else here is structural: ids present,
   * names plausible, hashes matching -- all of which a solid-colour frame
   * satisfies, whether it is black from a dead context or grey from a shader
   * that never ran. The probe's source is a longitude/latitude ramp with a
   * 16px checker, so any faithful render has thousands of distinct colours.
   * The floor sits an order of magnitude below the frozen baseline's measured
   * minimum (5774, perspective/origin) and three orders above a solid frame.
   */
  const MIN_DISTINCT = 1000
  for (const c of captured(INDEX)) {
    const { pixels } = decodePng(await readFile(path.join(root, c.camera, `${c.state.id}.png`)))
    const seen = new Set()
    for (let i = 0; i < pixels.length; i += 4) seen.add(pixels.readUInt32BE(i))
    assert.ok(seen.size >= MIN_DISTINCT, `${c.id}: only ${seen.size} distinct colours -- frame looks unrendered`)
  }
})

test('the projections and poses are visually distinguishable', async () => {
  /*
   * Pixel-domain counter-assertions, mirroring what the rotation test does
   * for uniforms: if every camera rendered the same picture, every
   * downstream pixel comparison would be noise against noise. Measured on
   * the frozen baseline -- the only byte-equal pairs anywhere in the matrix
   * are the two degenerate zoom states the degeneracy test pins on purpose.
   */
  const bytes = async id => readFile(path.join(root, `${id}.png`))

  const origins = CAMERAS.map(c => `${c}/origin`)
  for (let i = 0; i < origins.length; i++) {
    for (let j = i + 1; j < origins.length; j++) {
      const [a, b] = await Promise.all([bytes(origins[i]), bytes(origins[j])])
      assert.ok(!a.equals(b), `${origins[i]} and ${origins[j]} render identically`)
    }
  }

  for (const camera of CAMERAS) {
    const ids = ['origin', 'tilt', 'south'].map(s => `${camera}/${s}`)
    const bufs = await Promise.all(ids.map(bytes))
    for (let i = 0; i < bufs.length; i++) {
      for (let j = i + 1; j < bufs.length; j++) {
        assert.ok(!bufs[i].equals(bufs[j]), `${ids[i]} and ${ids[j]} render identically`)
      }
    }
  }
})

test('the manifest and the fixture tree agree, in both directions', async () => {
  /*
   * index.json is the text-diffable face of binary fixtures: a changed PNG is
   * supposed to surface as a changed pngSha256. That contract only holds if
   * something actually compares the hash to the bytes -- git will happily
   * accept a hand-edited PNG and a stale index.json in the same commit.
   *
   * The uniform streams are hashed for the same reason (review finding 1):
   * they are this phase's primary product -- the only carrier of the F10/F11
   * conclusions and of what P2 diffs against -- and until they were anchored,
   * a hand-edited value, a bad merge, or CRLF rewriting passed every
   * structural check while silently corrupting the record.
   */
  for (const c of captured(INDEX)) {
    const png = await readFile(path.join(root, c.camera, `${c.state.id}.png`))
    assert.equal(sha256(png), c.pngSha256, `${c.id}: png on disk does not match index.json pngSha256`)
    assert.equal(png.length, c.pngBytes, `${c.id}: png byte count drifted from index.json`)

    const uniformsBytes = await readFile(path.join(root, c.camera, `${c.state.id}.uniforms.json`))
    assert.equal(
      sha256(uniformsBytes),
      c.uniformsSha256,
      `${c.id}: uniforms.json on disk does not match index.json uniformsSha256`
    )

    const doc = JSON.parse(uniformsBytes.toString('utf8'))
    assert.equal(doc.camera, c.camera, `${c.id}: uniforms.json says camera ${doc.camera}`)
    assert.equal(doc.state.id, c.state.id, `${c.id}: uniforms.json says state ${doc.state.id}`)
    assert.equal(doc.frames.length, c.frameCount, `${c.id}: frame count drifted from index.json`)
    assert.equal(doc.frames.length, FRAMES_PER_CAPTURE, `${c.id}: expected ${FRAMES_PER_CAPTURE} frames`)

    /*
     * Names carry the whole evidence chain for the dead-uniform findings.
     * probe.html records a literal '?' when its name lookup fails, so a
     * name-recovery breakage would otherwise hide inside plausible-looking
     * data instead of failing here.
     */
    const names = [...new Set(doc.frames.flat().map(u => u.name))].sort()
    for (const n of names) assert.ok(n && n !== '?', `${c.id}: unnamed uniform write recorded`)
    assert.deepEqual(names, c.uniformNames, `${c.id}: uniform names drifted from index.json`)
  }

  /*
   * And the other direction (review finding 4): the loop above proves every
   * manifest entry has its files, not that every file has its entry. A matrix
   * entry that is renamed or removed would leave its old fixture on disk
   * forever -- orphaned, plausible-looking, and green under a verifier that
   * only enumerates the matrix. So the tree is enumerated and compared to
   * manifest claims plus the static root files, exactly.
   */
  const expected = new Set(STATIC_FIXTURE_FILES)
  for (const c of captured(INDEX)) {
    expected.add(`${c.camera}/${c.state.id}.png`)
    expected.add(`${c.camera}/${c.state.id}.uniforms.json`)
  }
  const onDisk = new Set((await walk(root)).map(p => path.relative(root, p)))
  const orphaned = [...onDisk].filter(f => !expected.has(f))
  const missing = [...expected].filter(f => !onDisk.has(f))
  assert.deepEqual(orphaned, [], 'files on disk that the manifest does not claim')
  assert.deepEqual(missing, [], 'manifest entries with no file on disk')
})

test('the two baseline inputs are pinned (source and bundle)', async () => {
  /*
   * source.png is the single input function of all 16 captures; bundle.js is
   * the measured artifact itself. Neither was anchored anywhere (review
   * finding 2): a wrong file, a truncated copy, or a line-ending rewrite of
   * the 17k-line bundle would drift silently until a downstream pixel gate
   * failed looking like a renderer bug.
   */
  const source = await readFile(path.join(root, 'source.png'))
  assert.equal(sha256(source), INDEX.sourceSha256, 'source.png on disk does not match index.json sourceSha256')
  const bundle = await readFile(path.join(root, 'bundle.js'))
  assert.equal(sha256(bundle), INDEX.bundleSha256, 'bundle.js on disk does not match index.json bundleSha256')
})

test('capture resolution is the one the fixtures were recorded at', async () => {
  assert.equal(INDEX.canvasSize, CANVAS_SIZE)
})

test('the baseline records a hardware rasterizer', async () => {
  /*
   * Provenance, pinned where verify re-executes it rather than only where
   * capture.mjs enforced it once. channel:'chromium' is supposed to buy the
   * real GPU, but headless Chromium silently falls back to software
   * rasterization when its GPU process cannot start, and 16 self-consistent
   * captures off a software rasterizer would pass every structural check here
   * while being a baseline of the wrong thing. The predicate is shared with
   * the capture gate via states.mjs and also names llvmpipe/lavapipe/SoftPipe
   * -- the software stacks of headless Linux CI, which do not contain the
   * word "software". The string itself stays otherwise unpinned: a different
   * machine legitimately reports a different GPU.
   */
  assert.ok(INDEX.renderer, 'index.json records no renderer string at all')
  assert.ok(
    !isSoftwareRenderer(INDEX.renderer),
    `the frozen baseline was captured on: ${INDEX.renderer}`
  )
})

test('the dead uniforms reach no camera (pins F5 and F6)', async () => {
  /*
   * These three are declared in fshader.glsl and built by every non-linear
   * camera's status(), but nothing reads them, so the GLSL compiler drops them
   * and getUniformLocation returns null. Their absence is the evidence for F5
   * (latitude cannot reach the GPU) and F6 (GeoWidth/GeoHeight are computed
   * every frame and thrown away).
   *
   * Pinned rather than merely noted: if a regression makes one of them active,
   * every pixel gate downstream changes meaning, and this is where that shows up
   * as a one-line failure instead of a mysterious tolerance problem.
   */
  const dead = ['u_CamPOVLatitude', 'u_CamGeoWidth', 'u_CamGeoHeight']
  for (const c of captured(INDEX)) {
    for (const name of dead) {
      assert.ok(!c.uniformNames.includes(name), `${c.id} unexpectedly received ${name}`)
    }
  }
})

test('the observed degenerate states are pinned (F5 + F11 + F12 compose)', async () => {
  /*
   * cylindrical and planet render `zoomed` byte-identically to `origin`, for
   * three independent reasons that all happen to cancel:
   *
   *   - longitude 300 wraps to 0 under the `% 25` guard (F11);
   *   - latitude is never sent, so lat=10 has no effect (F5);
   *   - zoom-in is clamped away by `clamp(value, 0.1, 1)` (F12).
   *
   * This asserts the composition, not any of the three bugs, and it is here to
   * make a *change* in it loud. Anyone regenerating these fixtures after fixing
   * one of the three will see this fail, which is the intended prompt to decide
   * deliberately whether the locked baseline should move.
   */
  const same = async (camera, a, b) => {
    const [x, y] = await Promise.all([
      readFile(path.join(root, camera, `${a}.png`)),
      readFile(path.join(root, camera, `${b}.png`))
    ])
    return x.equals(y)
  }

  assert.ok(await same('cylindrical', 'origin', 'zoomed'), 'cylindrical/zoomed is no longer identical to origin')
  assert.ok(await same('planet', 'origin', 'zoomed'), 'planet/zoomed is no longer identical to origin')

  // Pannini clamps zoomValue to 2, so its zoom survives and the state is real.
  // This is the positive half: the equality above is a property of the clamp,
  // not of the state matrix being unable to express zoom at all.
  assert.ok(!(await same('pannini', 'origin', 'zoomed')), 'pannini/zoomed collapsed onto origin')

  /*
   * The clamp is one-sided: zooming out below 1 is retained for every camera
   * that receives a zoom uniform at all. Presence is asserted per camera
   * rather than skipped: a change that makes the GLSL compiler drop u_CamZoom
   * would otherwise delete this pin with zero failures -- the dead-uniform
   * pin cannot notice, because it only lists uniforms that are already dead.
   */
  const EXPECTS_ZOOM = { perspective: false, cylindrical: true, planet: true, pannini: true }
  for (const camera of CAMERAS) {
    const zoom = uniform(await capture(camera, 'zoomed'), 'u_CamZoom')
    if (!EXPECTS_ZOOM[camera]) {
      assert.ok(!zoom, `${camera}: received u_CamZoom ${zoom && zoom.value}, but v0.2.2 never sent one`)
      continue
    }
    assert.ok(zoom, `${camera}: u_CamZoom vanished from the zoomed state`)
    assert.ok(zoom.value >= 0.1 && zoom.value <= 2, `${camera}: u_CamZoom ${zoom.value} outside the clamp range`)
  }
})

test('verify-fixtures.mjs fails loudly when the fixtures are broken', { skip: process.env.BASELINE_VERIFY_NEGATIVE_TEST === '1' ? 'nested run of the negative test' : false }, async () => {
  /*
   * task-finish gate 6 trusts this exit code: a wrapper that exits 0 on a
   * broken fixture tree would make every downstream gate vacuous. The failure
   * branch has to be executed at least once to be believed.
   *
   * Runs against a throwaway copy of the harness with an empty manifest -- the
   * completeness test fails there, which is the cheapest realistic breakage.
   * The committed fixtures are never touched.
   *
   * The marker env var stops the copy's own copy of this test from spawning
   * another copy of itself: without it this test would recurse without bound,
   * one temp directory per level, for as long as the OS allows.
   */
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'baseline-verify-'))
  try {
    const toolsDir = path.join(tmp, 'tools', 'baseline')
    await mkdir(toolsDir, { recursive: true })
    for (const f of ['verify-fixtures.mjs', 'fixtures.test.mjs', 'states.mjs']) {
      await cp(path.join(here, f), path.join(toolsDir, f))
    }
    const fixRoot = path.join(tmp, 'test', 'fixtures', 'baseline')
    await mkdir(fixRoot, { recursive: true })
    await writeFile(path.join(fixRoot, 'index.json'), JSON.stringify({ canvasSize: CANVAS_SIZE, captures: [] }))

    const r = spawnSync(process.execPath, ['verify-fixtures.mjs'], {
      cwd: toolsDir,
      encoding: 'utf8',
      env: { ...process.env, BASELINE_VERIFY_NEGATIVE_TEST: '1' }
    })
    assert.equal(r.status, 1, `expected exit 1 on broken fixtures, got ${r.status}\nstderr: ${r.stderr}`)
    assert.match(r.stderr, /capture\.mjs/, 'the failure should tell the operator how to regenerate')
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
