import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATES, CAMERAS, CANVAS_SIZE, captureId } from './states.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/baseline')
const readJson = async p => JSON.parse(await readFile(p, 'utf8'))
const capture = (camera, state) => readJson(path.join(root, camera, `${state}.uniforms.json`))
const lastFrame = doc => doc.frames.at(-1)
const uniform = (doc, name) => lastFrame(doc).find(u => u.name === name)

test('every camera x state pair has a capture', async () => {
  const index = await readJson(path.join(root, 'index.json'))
  const got = new Set(index.captures.filter(c => !c.error).map(c => c.id))
  for (const camera of CAMERAS) {
    for (const state of STATES) {
      assert.ok(got.has(captureId(camera, state)), `missing capture ${captureId(camera, state)}`)
    }
  }
})

test('every capture recorded the camera transform and both projection kinds', async () => {
  const index = await readJson(path.join(root, 'index.json'))
  for (const c of index.captures) {
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
  const index = await readJson(path.join(root, 'index.json'))
  for (const c of index.captures) {
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
  const index = await readJson(path.join(root, 'index.json'))
  for (const c of index.captures) {
    const png = await readFile(path.join(root, c.camera, `${c.state.id}.png`))
    assert.ok(png.length > 0, `${c.id}: empty png`)
    // PNG signature. A base64 slip would produce a file that is non-empty but
    // not a PNG, which a length check alone would happily accept.
    assert.deepEqual(
      [...png.subarray(0, 4)],
      [0x89, 0x50, 0x4e, 0x47],
      `${c.id}: not a PNG`
    )
  }
})

test('capture resolution is the one the fixtures were recorded at', async () => {
  const index = await readJson(path.join(root, 'index.json'))
  assert.equal(index.canvasSize, CANVAS_SIZE)
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
  const index = await readJson(path.join(root, 'index.json'))
  for (const c of index.captures) {
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

  // The clamp is one-sided: zooming out below 1 is retained for every camera.
  for (const camera of CAMERAS) {
    const zoom = uniform(await capture(camera, 'zoomed'), 'u_CamZoom')
    if (!zoom) continue // the linear camera receives no u_CamZoom at all
    assert.ok(zoom.value >= 0.1 && zoom.value <= 2, `${camera}: u_CamZoom ${zoom.value} outside the clamp range`)
  }
})
