# P0 — 冻结基线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 在动任何一行旧代码之前，把 v0.2.2 的输出固化成可机读的 fixture —— 四个投影 × 多组相机状态的**像素**与**逐帧 uniform 流**。

**Architecture:** 一套浏览器内的捕获探针。它在页面加载旧版 bundle **之前**猴补 `WebGLRenderingContext.prototype` 的 uniform 方法与 `drawArrays`，从而在不修改任何产品代码的前提下录下每一帧实际发给 GPU 的东西。像素在 `drawArrays` 返回后立刻 `readPixels`（此时 drawing buffer 尚未被合成器消费），uniform 记录也在同一时刻封帧。

**Tech Stack:** Node 22 + Playwright（驱动）、原生 WebGL1（被观察对象）、无框架。

**为什么这一步不能省：** 旧实现是易腐资源。它一旦被删，「我有没有把投影改坏」就再也没有裁判了。而且——**uniform 流是本阶段的主要产物**，不是像素。像素要等 P3 整条管线跑通才能用；uniform 流让 P2 的 `core/` 在还没有渲染器的时候就能被验证。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `tools/baseline/package.json` | 探针的独立依赖（playwright） |
| `tools/baseline/capture.mjs` | Playwright 驱动：起浏览器、注入页面、收结果、写 fixture |
| `tools/baseline/probe.html` | 探针页：加载 bundle、猴补 GL、驱动 viewer、上报 |
| `tools/baseline/states.mjs` | 相机状态矩阵（驱动与校验共用，单一真源） |
| `tools/baseline/verify-fixtures.mjs` | 结构校验：fixture 齐全、字段完整、像素可解码 |
| `test/fixtures/baseline/index.json` | 捕获清单 + 每组的内容哈希 |
| `test/fixtures/baseline/<camera>/<state>.uniforms.json` | 逐帧 uniform 流 |
| `test/fixtures/baseline/<camera>/<state>.png` | 逐帧像素（仅最后一帧，PNG 无损） |
| `test/fixtures/baseline/source.png` | **捕获所用的素材图**，连同 fixture 一起提交 |
| `test/fixtures/baseline/bundle.js` | **v0.2.2 的构建产物，一并提交** |

> **为什么连 bundle 一起提交**：基线不能依赖「2027 年还能装上 Babel 6 + webpack 3」。`npm run build-debug` 的产物是自包含的 UMD，提交它，这个 fixture 就永久可复现。

> **探针是独立工具，继续用 Playwright 直接驱动，不进测试体系。** 它是 Node 侧的一次性采集脚本，有自己的 `tools/baseline/package.json`；被测的库跑的是 vitest 浏览器模式（P1），两者互不相干。别把探针改写成 vitest —— 它要加载的是 **v0.2.2 的 webpack bundle**，跟新工具链没有任何关系。

### 下游怎么读这些 fixture（P3 起）

P3 的门禁跑在 **vitest 浏览器模式**里，读基线不再经过 Node 文件系统：

```ts
// The `?url` suffix is Vite's: it hands back a served URL instead of the
// module, which is what lets a browser test fetch binary fixtures at all.
// test/integration/tsconfig.json carries "vite/client" so this typechecks.
import baselineUrl from '../../../test/fixtures/baseline/linear/origin.png?url'

const bitmap = await createImageBitmap(await (await fetch(baselineUrl)).blob())
```

两条要记住的：

1. **测试侧不再需要 pngjs。** 浏览器自带解码器。P0 自己的 `fixtures.test.mjs` 用的是 `node --test`，而且只校验 PNG 签名，本来也没依赖解码库。
2. **`createImageBitmap` 的通道序是 RGBA，而 WebGPU canvas 的 `getPreferredCanvasFormat()` 在 macOS 上是 `bgra8unorm`。** 也就是**基线侧和新渲染侧的原生字节序不一样**，门禁 A 比对前必须统一。P1 Task 8 的冒烟测试已经把 canvas 格式钉住了；P3 要在比对函数里显式处理，不能靠「读出来就对得上」。

---

### Task 1: 探针脚手架与状态矩阵

**Files:**
- Create: `tools/baseline/package.json`
- Create: `tools/baseline/states.mjs`
- Modify: `.gitignore`

- [x] **Step 1: 建探针目录与依赖**

`tools/baseline/package.json`：

```json
{
  "name": "pano-gl-baseline-probe",
  "private": true,
  "type": "module",
  "scripts": {
    "capture": "node capture.mjs",
    "verify": "node verify-fixtures.mjs"
  },
  "devDependencies": {
    "playwright": "^1.63.0"
  }
}
```

- [x] **Step 2: 写状态矩阵**

`tools/baseline/states.mjs` —— 驱动与校验共用，避免两边各写一份：

```js
/*
 * The camera-state matrix every baseline capture walks. Kept in one module so the
 * capture driver and the fixture verifier cannot drift apart -- a verifier that
 * checks a different set of states than the capture wrote is worse than none.
 *
 * Angles are degrees, matching the legacy public API. `zoom` is the number of
 * discrete zoom steps applied via viewer.zoom(), not a scale factor.
 */

/** One point in camera-parameter space. */
export const STATES = [
  { id: 'origin',     lat: 0,   lng: 0,   zoom: 0 },
  { id: 'tilt',       lat: 30,  lng: 45,  zoom: 0 },
  { id: 'south',      lat: -60, lng: 180, zoom: 0 },
  { id: 'zoomed',     lat: 10,  lng: 300, zoom: 1 }
]

/** The camera types registered in v0.2.2's CameraFactory. Or thoCamera is not
 *  registered upstream and is deliberately absent here too. */
export const CAMERAS = ['perspective', 'cylindrical', 'planet', 'pannini']

/** Fixed capture resolution. Small enough to commit, large enough that all four
 *  projections differ visibly from each other. */
export const CANVAS_SIZE = 128

/** Stable identifier for one capture, used as its fixture path. */
export function captureId (camera, state) {
  return `${camera}/${state.id}`
}
```

- [x] **Step 3: 把探针产物加进 .gitignore（只忽略依赖）**

`.gitignore` 末尾追加：

```
# Baseline probe deps live with the probe, not at the repo root
tools/baseline/node_modules
```

**不要**忽略 `test/fixtures/baseline/` —— 那是本任务的唯一交付物。

- [x] **Step 4: 装依赖并验证**

Run: `cd tools/baseline && npm install && node -e "import('./states.mjs').then(m => console.log(m.STATES.length, m.CAMERAS.length))"`
Expected: `4 4`

- [x] **Step 5: Commit**

```bash
git add .gitignore tools/baseline/package.json tools/baseline/package-lock.json tools/baseline/states.mjs
git commit -m "chore(baseline): scaffold probe dir and camera-state matrix"
```

---

### Task 2: 构建并提交 v0.2.2 的 bundle

**Files:**
- Create: `test/fixtures/baseline/bundle.js`（由 `npm run build-debug` 产出后复制）

- [x] **Step 1: 确认工作区是干净的 v0.2.2**

Run: `git status --short && git log --oneline -1`
Expected: 除本任务的改动外无未提交内容；HEAD 是 `5737f6e npm version 0.2.2` 或其后的文档提交。

> `docs/` 与 `.gitignore` 的改动是允许的，它们不影响 bundle 内容。

- [x] **Step 2: 构建**

Run: `npm install && npm run build-debug`
Expected: 产出 `.package/bundle.js` 与 `.package/BundleSizeDebug.html`

- [x] **Step 3: 复制进 fixture 目录**

```bash
mkdir -p test/fixtures/baseline
cp .package/bundle.js test/fixtures/baseline/bundle.js
node -e "
const s = require('fs').readFileSync('test/fixtures/baseline/bundle.js','utf8')
console.log('bytes:', s.length)
console.log('has global PanoGL:', /PanoGL/.test(s))
console.log('has inlined GLSL:', /u_CamTransMatrix/.test(s))
"
```
Expected:
```
bytes: <某个 >100000 的数>
has global PanoGL: true
has inlined GLSL: true
```

**如果 `has inlined GLSL` 是 `false`**，说明 bundle 没有把 `.glsl` 内联进来 —— 停下，检查 `webpack/debug.js` 里 `webpack-glsl-loader` 的配置再继续。基线必须自包含。

- [x] **Step 4: Commit**

```bash
git add test/fixtures/baseline/bundle.js
git commit -m "chore(baseline): vendor the v0.2.2 UMD bundle for fixture reproducibility"
```

---

### Task 3: GL 猴补与录制逻辑

**Files:**
- Create: `tools/baseline/probe.html`

这是本阶段技术含量最高的一步。**先读完整段再动手。**

- [x] **Step 1: 写探针页骨架（含猴补）**

`tools/baseline/probe.html`：

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>pano.gl baseline probe</title></head>
<body>
  <!-- The renderer sizes its canvas from this container, so the container's
       size is what fixes capture resolution. DPR is deliberately left at 1 by
       the harness; v0.2.2 ignores devicePixelRatio anyway. -->
  <div id="stage"></div>
  <script src="/bundle.js"></script>
  <script>
  /*
   * Captures what v0.2.2 actually sends to the GPU, without touching a line of
   * product code. Every hook is installed before the viewer is constructed.
   *
   * Why monkey-patching rather than an instrumented build: the whole point of a
   * baseline is that it measures the shipped artifact. If we edit the source to
   * add logging we are measuring something else.
   */
  ;(function () {
    'use strict'

    var SIZE = __CANVAS_SIZE__

    // Location objects are opaque, so names have to be recovered by
    // intercepting getUniformLocation. A WeakMap keeps this leak-free.
    var nameOf = new WeakMap()
    var pending = []          // uniform writes accumulated for the current frame
    var frames = []           // completed frames for the current capture

    var origGetUniformLocation = WebGLRenderingContext.prototype.getUniformLocation
    var origUniform1f = WebGLRenderingContext.prototype.uniform1f
    var origUniform1i = WebGLRenderingContext.prototype.uniform1i
    var origUniformMatrix4fv = WebGLRenderingContext.prototype.uniformMatrix4fv
    var origDrawArrays = WebGLRenderingContext.prototype.drawArrays

    WebGLRenderingContext.prototype.getUniformLocation = function (program, name) {
      var loc = origGetUniformLocation.call(this, program, name)
      if (loc) nameOf.set(loc, name)
      return loc
    }

    WebGLRenderingContext.prototype.uniform1f = function (loc, v) {
      if (loc) pending.push({ name: nameOf.get(loc) || '?', value: v })
      return origUniform1f.call(this, loc, v)
    }

    WebGLRenderingContext.prototype.uniform1i = function (loc, v) {
      if (loc) pending.push({ name: nameOf.get(loc) || '?', value: v })
      return origUniform1i.call(this, loc, v)
    }

    WebGLRenderingContext.prototype.uniformMatrix4fv = function (loc, transpose, data) {
      if (loc) pending.push({ name: nameOf.get(loc) || '?', value: Array.from(data) })
      return origUniformMatrix4fv.call(this, loc, transpose, data)
    }

    /*
     * drawArrays is the frame boundary. Reading pixels immediately after the
     * original call is the only reliable moment: the drawing buffer is still
     * intact inside this task regardless of preserveDrawingBuffer, which
     * v0.2.2 does not set.
     */
    WebGLRenderingContext.prototype.drawArrays = function (mode, first, count) {
      var r = origDrawArrays.call(this, mode, first, count)

      var px = new Uint8Array(SIZE * SIZE * 4)
      this.readPixels(0, 0, SIZE, SIZE, this.RGBA, this.UNSIGNED_BYTE, px)

      frames.push({ uniforms: pending.slice(), pixels: px })
      pending.length = 0
      return r
    }

    // -- harness API, driven from outside via page.evaluate ------------------
    window.__probe = {
      reset: function () { frames.length = 0; pending.length = 0 },
      frames: function () { return frames },
      /*
       * Uniform values arrive as plain objects; the pixels are the only thing
       * that needs a lossless wire format. PNG through a 2D canvas is lossless
       * and compresses a smooth equirect pano down to a few KB.
       */
      encodePng: function (u8) {
        var c = document.createElement('canvas')
        c.width = SIZE; c.height = SIZE
        var ctx = c.getContext('2d')
        var img = ctx.createImageData(SIZE, SIZE)
        // GL origin is bottom-left; flip so the PNG reads top-down like every
        // other image tool expects.
        for (var y = 0; y < SIZE; y++) {
          var src = (SIZE - 1 - y) * SIZE * 4
          img.data.set(u8.subarray(src, src + SIZE * 4), y * SIZE * 4)
        }
        ctx.putImageData(img, 0, 0)
        return c.toDataURL('image/png')
      }
    }
  })()
  </script>
</body>
</html>
```

- [x] **Step 2: 写确定性素材生成器（追加到同一段脚本，`__probe` 之前）**

基线素材不能是外部文件 —— 那会让 fixture 依赖一个可能消失的 URL。用确定性图案：

```js
    /*
     * A deterministic equirectangular test pattern. Must be power-of-two and
     * equal to the capture size: v0.2.2's updateTextureObject uses gl.RGB with
     * LINEAR filtering and no mipmaps, so a non-power-of-two source is a
     * texture-completeness bug, not a test.
     *
     * The pattern is a coordinate ramp rather than noise so that a projection
     * error shows up as a smooth spatial shift instead of an unreadable hash.
     */
    function makeSourceDataUrl (size) {
      var c = document.createElement('canvas')
      c.width = size; c.height = size
      var ctx = c.getContext('2d')
      var img = ctx.createImageData(size, size)
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var i = (y * size + x) * 4
          img.data[i]     = Math.round((x / (size - 1)) * 255)   // longitude ramp
          img.data[i + 1] = Math.round((y / (size - 1)) * 255)   // latitude ramp
          img.data[i + 2] = ((x >> 4) + (y >> 4)) % 2 ? 200 : 60 // checker, 16px
          img.data[i + 3] = 255
        }
      }
      ctx.putImageData(img, 0, 0)
      return c.toDataURL('image/png')
    }
```

- [x] **Step 3: 写捕获驱动函数（追加）**

```js
    /*
     * One capture = one freshly constructed viewer. Reusing a viewer across
     * cameras would carry over the previous camera's pov state, and reusing one
     * across states makes the uniform stream depend on which states ran before
     * it -- both destroy reproducibility.
     */
    window.__capture = function (camera, state, sourceUrl) {
      return new Promise(function (resolve, reject) {
        var stage = document.getElementById('stage')
        stage.innerHTML = ''
        stage.style.width = SIZE + 'px'
        stage.style.height = SIZE + 'px'
        var host = document.createElement('div')
        host.style.width = SIZE + 'px'
        host.style.height = SIZE + 'px'
        stage.appendChild(host)

        var viewer
        try {
          viewer = new PanoGL.FramelessImageViewer({
            container: host,
            src: sourceUrl,
            cameraOptions: { type: camera }
          })
        } catch (e) { return reject(e) }

        var settled = false
        var fail = function (e) { if (!settled) { settled = true; reject(e) } }
        setTimeout(function () { fail(new Error('capture timed out for ' + camera)) }, 20000)

        viewer.on('media-load', function () {
          // Let the first frame after load land, then drive the camera.
          requestAnimationFrame(function () {
            window.__probe.reset()
            if (state.lng) viewer.rotate(state.lat, state.lng)
            else if (state.lat) viewer.rotate(state.lat, 0)
            for (var i = 0; i < state.zoom; i++) viewer.zoom(1)

            // Three frames: the first may predate the camera swap's vertex
            // buffer rebuild, the second is the steady state, the third proves
            // it is steady. The uniform stream needs all three.
            var n = 0
            ;(function tick () {
              if (++n < 3) return requestAnimationFrame(tick)
              var f = window.__probe.frames()
              if (!f.length) return fail(new Error('no frame drawn for ' + camera))
              resolve({
                frames: f.map(function (fr) {
                  return { uniforms: fr.uniforms, png: window.__probe.encodePng(fr.pixels) }
                })
              })
            })()
          })
        })
        viewer.on('media-error', fail)
      })
    }
```

- [x] **Step 4: 用占位尺寸跑通页面（先不写驱动）**

把 `__CANVAS_SIZE__` 换成一个真实数字不是这一步的事 —— 先确认语法没问题：

Run: `node --check <(sed 's/__CANVAS_SIZE__/128/' tools/baseline/probe.html | sed -n '/<script>$/,/<\/script>/p' | grep -v '^<') 2>&1 || echo "(expected: node cannot parse HTML; check manually)"`

> 这条命令本来就跑不通，它只是逼你**肉眼再读一遍** `probe.html`。HTML 里的脚本没有独立的语法检查工具，这是本仓库的现实。

- [x] **Step 5: Commit**

```bash
git add tools/baseline/probe.html
git commit -m "feat(baseline): GL-level uniform and pixel recorder for the v0.2.2 probe"
```

---

### Task 4: Playwright 驱动与捕获执行

**Files:**
- Create: `tools/baseline/capture.mjs`

- [x] **Step 1: 写驱动**

`tools/baseline/capture.mjs`：

```js
/*
 * Drives probe.html across the full camera x state matrix and writes the
 * baseline fixtures.
 *
 * Usage: node capture.mjs
 */

import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATES, CAMERAS, CANVAS_SIZE, captureId } from './states.mjs'

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

for (const camera of CAMERAS) {
  for (const state of STATES) {
    const id = captureId(camera, state)
    process.stdout.write(`capturing ${id} ... `)
    try {
      const result = await page.evaluate(
        ([c, s, u]) => window.__capture(c, s, u),
        [camera, state, sourceUrl]
      )

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
        uniformNames: [...new Set(uniforms.flat().map(u => u.name))].sort()
      })
      console.log(`ok (${result.frames.length} frames, ${png.length}B)`)
    } catch (e) {
      console.log(`FAILED: ${e.message}`)
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
```

- [x] **Step 2: 把素材生成器暴露给驱动（改 `probe.html`）**

在 `probe.html` 里，`window.__probe = {...}` 之前补上：

```js
    // Exposed so the capture driver gets the exact same source the probe would
    // generate internally -- two copies of this generator would silently
    // diverge and the fixtures would not match the probe.
    window.__makeSource = function (size) { return makeSourceDataUrl(size) }
```

并把 `__capture` 里的 `sourceUrl` 直接用传入值（它已经这么做了）。

- [x] **Step 3: 执行捕获**

Run: `cd tools/baseline && node capture.mjs`
Expected：16 行 `capturing <camera>/<state> ... ok (3 frames, <N>B)`，末行 `16/16 captures ok`

- [x] **Step 4: 人工核对产物**

Run:
```bash
node -e "
const idx = require('./test/fixtures/baseline/index.json')
for (const c of idx.captures) console.log(c.id, c.frameCount, (c.uniformNames||[]).join(','))
"
```
Expected：每行含 `u_CamTransMatrix`、`u_CamProjType`、`u_TexProjType`、`u_Sampler`；非线性相机**额外**含 `u_CamGeoWidth`、`u_CamGeoHeight`、`u_CamZoom`。

**如果非线性相机缺 `u_CamZoom`** —— 那是真实的发现（说明当前 `zoom` 选项被忽略，与 spec §11 的 F12 相关）。**不要修**，记进 fixture，在 spec 的缺陷清单上核对。

- [x] **Step 5: 核对 F5（非线性相机 povLatitude 无效）**

```bash
node -e "
const fs = require('fs')
const a = JSON.parse(fs.readFileSync('test/fixtures/baseline/cylindrical/origin.uniforms.json'))
const b = JSON.parse(fs.readFileSync('test/fixtures/baseline/cylindrical/tilt.uniforms.json'))
// The last frame of each capture, keyed by uniform name.
const pick = f => Object.fromEntries(f.uniforms.map(u => [u.name, u.value]))
const fa = pick(a.frames.at(-1)), fb = pick(b.frames.at(-1))
for (const n of ['u_CamPOVLatitude','u_CamPOVLongitude','u_CamTransMatrix']) {
  console.log(n, JSON.stringify(fa[n]) === JSON.stringify(fb[n]) ? 'IDENTICAL' : 'differs')
}
"
```

**判读**：`u_CamPOVLatitude` 若为 `IDENTICAL` → **F5 证实**（`rotate(30, 45)` 完全没进入这个 uniform）。`u_CamTransMatrix` 应当 `differs`。

- [x] **Step 6: 核对 F10（旧着色器文件作用域的 `lng` 初始化是否生效）**

这一步**不能靠读代码定论**。`legacy/src/shader/fshader.glsl` 里 `float lng = u_CamPOVLongitude / 2.0;` 是文件作用域的非恒定初始化，在 GLSL ES 1.0 里**非法** —— 有的驱动会把它编译成 0，那样旧的非线性相机根本不会转。哪种情况发生了，只有实测知道：

```bash
node -e "
const fs = require('fs')
const read = s => fs.readFileSync('test/fixtures/baseline/cylindrical/' + s + '.png')
// Same PNG encoder on both sides, so byte equality is pixel equality here.
console.log('cylindrical origin vs tilt:', Buffer.compare(read('origin'), read('tilt')) === 0 ? 'IDENTICAL' : 'differ')
"
```

**为什么这两个状态能判定**：`cylindrical` 的 `phi` 不读纬度，两个状态的 `zoom` 都是 0，纬度本来就被忽略 —— 这个投影能看见的唯一输入差异**只有经度**（0 vs 45）。

**判读**：
- `IDENTICAL` ⇒ `lng` 被编译成 0，**F10 在捕获所用的 Chromium/Metal 上成立**：旧的非线性相机不响应转动。
- `differ` ⇒ 它生效了，那这份 fixture 的像素里带着「把度数当弧度减」的旋转。

**两个结论都必须写进 `test/fixtures/baseline/README.md`**，因为 P3 门禁 A 要**读这个结论来决定哪些状态可比**（F5 让非零纬度不可比；F10 让非零经度可能不可比，取决于这里测出什么）。门禁 A 会自己重测一遍，但 README 是给人看的那份记录。

把 F5 / F10 的结论一并写进 `test/fixtures/baseline/README.md`（Step 7 建），并据此在 spec §11 里把这两条从【待验证】改成【核码】或删除。

- [x] **Step 7: 写 fixture 说明**

`test/fixtures/baseline/README.md`：

```markdown
# v0.2.2 baseline fixtures

Captured from the vendored `bundle.js` (the shipped UMD build) by
`tools/baseline/capture.mjs`. Regenerate with:

```shell
cd tools/baseline && npm install && node capture.mjs
```

## What is here

- `<camera>/<state>.png` — the last of three steady-state frames, 128x128, lossless.
- `<camera>/<state>.uniforms.json` — every uniform write for all three frames,
  in submission order, keyed by the name recovered from `getUniformLocation`.
- `source.png` — the panorama every capture was rendered from, committed so that
  a later pixel comparison renders the same image rather than regenerating one.
- `index.json` — capture manifest, including the observed uniform set per camera.

PNG rows are top-down, flipped at encode time because the GL origin is
bottom-up. A renderer reading its own framebuffer from row 0 is already in the
same orientation, so a comparison needs no flip in either direction.

## Why three frames

The first frame after a camera swap may still be running against the previous
vertex buffer, because v0.2.2 rebuilds geometry only when `camera.id` changes.
The second is steady state; the third proves it is steady. Consumers that only
want the answer should use the last frame.

## Known findings recorded by this baseline

- `u_CamGeoWidth` / `u_CamGeoHeight` are uploaded by every non-linear camera and
  read by nothing in the shader.
- `u_CamPOVLatitude` / `u_CamPOVLongitude` / `u_CamTransMatrix`: see the two
  findings recorded below.
- F5 (non-linear cameras ignore latitude): `<Step 5 的结论>`
- F10 (the file-scope `lng` initializer): `<Step 6 的结论>`

## Why the F10 finding matters downstream

P3's gate A compares new renders against these PNGs. Its comparable set is
derived from the two findings above, not written down:

- F5 makes every non-zero latitude incomparable for the three non-linear
  cameras, because v1 deliberately makes latitude effective where v0.2.2
  ignored it.
- F10 decides whether non-zero longitude is comparable too. If the invalid
  file-scope initializer compiled to zero, longitude never reached a pixel and
  those states are comparable; if it took effect, the pixels carry a rotation
  produced by subtracting degrees from radians, which v1 does not reproduce.

Both are recorded here so that a reviewer can see why the pixel gate runs on
fewer states than the matrix gate, rather than having to rediscover it.
```

（Step 5 与 Step 6 的结论追加到此文件末尾的「Known findings」节。）

- [x] **Step 8: Commit**

```bash
git add tools/baseline/capture.mjs tools/baseline/probe.html test/fixtures/baseline/
git commit -m "feat(baseline): capture pixel and uniform-stream fixtures for v0.2.2"
```

---

### Task 5: fixture 结构校验

**Files:**
- Create: `tools/baseline/verify-fixtures.mjs`
- Create: `tools/baseline/fixtures.test.mjs`

- [x] **Step 1: 写失败测试**

`tools/baseline/fixtures.test.mjs`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { STATES, CAMERAS, CANVAS_SIZE, captureId } from './states.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/baseline')
const readJson = async p => JSON.parse(await readFile(p, 'utf8'))

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
    const last = doc.frames.at(-1)
    const kind = last.find(u => u.name === 'u_CamProjType')
    assert.ok(kind, `${c.id} has no u_CamProjType`)
    assert.equal(kind.value, EXPECTED[c.camera], `${c.id} projected as kind ${kind.value}`)
  }
})

test('camera rotation reaches the transform matrix', async () => {
  // The counter-test to the u_CamPOVLatitude finding: if rotation moved nothing
  // at all, every fixture is worthless and this catches it.
  const pick = (doc, i) => {
    const u = doc.frames.at(-1).find(x => x.name === 'u_CamTransMatrix')
    assert.ok(u, 'no u_CamTransMatrix')
    return u.value.join(',')
  }
  for (const camera of CAMERAS) {
    const a = pick(await readJson(path.join(root, camera, 'origin.uniforms.json')))
    const b = pick(await readJson(path.join(root, camera, 'tilt.uniforms.json')))
    assert.notEqual(a, b, `${camera}: rotate() did not change u_CamTransMatrix`)
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
```

- [x] **Step 2: 跑测试，确认失败**

Run: `cd tools/baseline && node --test fixtures.test.mjs`
Expected: FAIL —— `ENOENT ... index.json`（本任务尚未写校验脚本，但 fixture 由 Task 4 产出，此处应当已经存在）。若 Task 4 已完成，则应当**全部 PASS**；此时改跑 Step 3 并把这一步记录为「基线已就位」。

- [x] **Step 3: 写 verify 包装脚本**

`tools/baseline/verify-fixtures.mjs`：

```js
/*
 * Entry point the superloop task's `verify` command calls. Kept as a separate
 * file from the test so the test can be run directly during development while
 * CI has one stable command to invoke.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const r = spawnSync(process.execPath, ['--test', path.join(here, 'fixtures.test.mjs')], {
  stdio: 'inherit'
})

if (r.status !== 0) {
  console.error('\nBaseline fixtures are missing or malformed. Regenerate with:')
  console.error('  cd tools/baseline && node capture.mjs')
  process.exit(1)
}
```

- [x] **Step 4: 跑校验**

Run: `cd tools/baseline && node verify-fixtures.mjs`
Expected: 6 个测试全 PASS，退出码 0

- [x] **Step 5: Commit**

```bash
git add tools/baseline/verify-fixtures.mjs tools/baseline/fixtures.test.mjs
git commit -m "test(baseline): structural verification of the captured fixtures"
```

---

### Task 6: 与上游缺陷清单对齐

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-pano-gl-v1-design.md`

- [x] **Step 1: 用实测结论更新 spec**

对 §11 的每一条：如果本阶段产生了实测证据（F5 的 `u_CamPOVLatitude`、F6 的 `u_CamGeo*`、F12 的 zoom uniform），把标注从 **【核码】** 改成 **【实测】** 并补上 fixture 路径；如果实测**证伪**了某条，删掉该行并在 §12 记录证伪过程。

- [x] **Step 2: 更新 §10.2 的 P0 行**

把 P0 的验收标准从计划时态改成完成时态，附 `index.json` 的路径。

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-19-pano-gl-v1-redesign.md
git commit -m "docs(spec): fold baseline measurements back into the defect inventory"
```

---

## 完成标准

- [x] `cd tools/baseline && node verify-fixtures.mjs` 退出码 0
- [x] `test/fixtures/baseline/index.json` 含 16 条无 error 的 capture
- [x] 四个相机各自的 `u_CamProjType` 与 `CameraFactory` 的注册值一致
- [x] `test/fixtures/baseline/README.md` 记录了 F5 的实测结论
- [x] `test/fixtures/baseline/bundle.js` 已提交（基线自包含）
- [x] spec §11 的相关条目已从【核码】升级为【实测】或删除

## 交给下游的东西

| 产物 | 消费者 |
|---|---|
| `*.uniforms.json` 的逐帧矩阵与标量 | **P2** —— `core/` 的投影数学在没有渲染器时就能对拍 |
| `*.png` | **P3 门禁 A** —— 全屏三角形是否服务全部四个投影。**读法见上文「下游怎么读这些 fixture」**：浏览器模式里经 `?url` + `fetch` + `createImageBitmap`，通道序 RGBA，与 WebGPU canvas 的 BGRA 不同，比对前必须统一 |
| `index.json` 的 uniform 名清单 | **P3** —— WGSL uniform 结构体的字段来源 |
