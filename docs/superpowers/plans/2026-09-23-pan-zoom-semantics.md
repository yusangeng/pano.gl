# pan 手感与 zoom 语义修正（pan-zoom-semantics）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 三个行为变更一次落齐——C1 非线性相机经度偏移改诚实换算（`* PI / 180`，取代 v1-design §11.4 B1 的「照旧」）；C2 zoom 方向修正（滚上=放大）；C3 linear 相机 zoom 以乘法式 fov 落地（clamp [15°, 110°]）。spec：`docs/superpowers/specs/2026-09-23-pan-zoom-semantics.md`（数值裁决在其 §4，本 plan 不复述理由只给实现）。

**Architecture:** `CameraController.zoom()` 重写为两种参数化同形的除法公式；lng 公式在 **WGSL / GLSL / reference 三处同一提交改齐**（门 C 红线）；门 A 可比集按新语义收窄重推导。uniform 布局、矩阵构建、公开 API、`gen:shaders` 管线全部零变化。

**Tech Stack:** TypeScript 5 strict / vitest（unit=node，integration=浏览器真 GPU）/ WGSL + GLSL ES 3.0。

---

## 背景（开工前必读，零上下文也能懂）

### C2 的方向链——为什么「方向反了」不是一个看法而是三步推论

1. `src/interaction/gestures.ts:60`：`classifyWheel` 产出 `step = -notches * 0.3`，**delta 正 = zoom in（放大）**（TSDoc 明文）。滚上（deltaY<0）→ delta 正。
2. `src/viewer/camera-controller.ts:119`：`next = zoom * (1 + delta)` → 滚上使 zoom **值变大**。
3. shader（`panorama.wgsl:159-168` = `reference.ts:144-153`）：zoom 只乘 `y`/`z`。cylindrical（extent 1×1，surface y,z ∈ [-0.5,0.5]）下 zoom=1 → theta 跨 ±π（一圈），zoom=0.5 → ±π/2（半圈）。**值越小视野越窄 = 放大。**

净效果：滚上（应放大）→ 值变大 → 画面**缩小**。v0.2.2 是对的（`ZoomPlugin → zoomValue += deltaY*50/20`，滚下值变大=缩小）。pinch 同链同反。这是移植引入的缺陷，直接修，无权衡。

### 统一公式与负分母陷阱（实现前必须理解的一条）

修后契约：**delta 正 = 画面放大 (1+delta) 倍**。两种参数化同形——参数越小视野越窄：

```
linear:     next_fov  = clamp(fov  / (1 + delta),  MIN_FOV, MAX_FOV)   // [15°, 110°] 弧度
non-linear: next_zoom = clamp(zoom / (1 + delta),  0.01,    1)
```

**陷阱**：公共 API `zoom(delta)` 不限幅度（现有测试就用 ±100 打顶）。`1 + delta` 在 `delta < -1` 时为负，除以负数把结果翻到数轴另一端，`clamp` 会把它钳到**放大顶格**——「缩小」请求落错端。`delta === -1` 则除零得 `Infinity`，恰好钳对。统一解法是**先钳分母**：

```ts
const scale = Math.max(1 + delta, Number.EPSILON)
```

真实输入层（`classifyWheel`/`classifyPinch`）已被 `MAX_STEP = 1` 挡在 `[-1, 1]`，但 API 直调可达，且现有 clamp 用例就用 `zoom(-100)`——这条路径必须有网（Task 1 的 clamp 用例正是打它的）。

### C1 的灵敏度含义（为什么红网要有一张 360° 往返）

- 旧（`/4`，度减自弧度）：姿态每 8π ≈ 25.13° 转一圈，14.3 倍（45/π）过敏。拖一屏宽（`classifyDrag` 产出 360° 姿态）≈ 画面转 14.3 圈。
- 新：姿态 360° = 恰一圈，与 linear 一致。
- **可执行断言**：非线性相机 `rotate(0, 360)` 往返后画面 ≈ 原样。旧树 360/25.13 ≈ 14.33 圈 ≠ 整数圈，**必不回原样**——此断言旧树红、新树绿。`rotate(0, 90)` 两树都动，不甄别，只作伴随断言。

### 门 A：预期零改动，且这个预期本身是要验的（2026-09-23 已测定）

基线 PNG（`test/fixtures/baseline/`）是 v0.2.2 的历史记录，**不重捕、不改动**。C1 会动的是 `lng ≠ 0` 的非线性渲染——而 gate-a 的可比集过滤器（`gate-a-pixels.test.ts:58-68`）**早已把这些态排除**：本机实测 `LNG_INERT = false`（`origin` vs `tilt` 两张基线 PNG 有 22528/65536 字节不同——`/4` 偏移在捕获像素里是活的），于是非线性可比集只剩 `origin`（唯一 `lat===0 && lng===0` 的态；`tilt`(30,45)/`south`(-60,180)/`zoomed`(10,300) 见 `tools/baseline/states.mjs`，全部因 lat 或 lng 被排除）。`origin` 在 lng=0 处新旧公式等价（0 的任何倍数都是 0）——**门 A 预计零 diff 自然绿**。C2/C3 同样不在门 A 射程：v1 侧对非线性相机硬编码 `zoom: 1`（`:84`），从不重放捕获的 zoom 步进；perspective 的 zoom 藏在捕获矩阵里，fov 由 `legacyFovFrom` 读出，也不经过 `zoom()`。

「预计零改动」不是免检通行证：Task 3 Step 1 要跑门 A 证明它绿、确认可比集没有因 C1 变化，并在 `comparableStates` 补注释说明 lng≠0 态自 C1 起永久漂移、由既有过滤器排除（登记有意分歧，交叉引用 spec §5.2）。

### 纪律与边界（越界 = plan 破裂，走 task-block）

- **三处同步**：`panorama.wgsl` + `panorama.glsl` + `reference.ts` 的 lng 公式与注释**同一提交**。只改其一是门 C 存在的意义所针对的失败（CLAUDE.md 红线原文照抄）。
- **不动 `src/interaction/`**：`classifyWheel`/`classifyPinch`/`classifyDrag`/`STEP_PER_NOTCH` 全不动——产出端「正=放大」的契约本来是对的，方向修正在消费端 controller。
- **不动 `src/core/projection-kinds.json`、不跑生成以外的 `gen:shaders` 写入**：`src/renderer/shaders/generated.ts` 不得出现在本卡 diff。
- **公开 API 零 diff**：`src/index.ts` 不动。
- **US5 两条断言与 `no-webgpu` project 零 diff**（R1c-iii 边界延续）。
- 注释一律英文；`import type` 用于纯类型导入。
- 浏览器会话偶发连接超时是已登记平台抖动，同尖端重跑一次再判（先例：p5 合并回退的 vite 冷缓存竞态）。

---

### Task 1: 红网先行——旧树上先跑出具名红（只写测试，不碰 src）

**Files:**
- Modify: `test/unit/camera-controller.test.ts`（zoom 用例族，约 `:167-272`）
- Modify: `test/unit/reference.test.ts`（`exact output pins` 族，约 `:96-166`）
- Modify: `test/integration/user-story-video.test.ts`（US2 两条，约 `:145` 与 `:226`）
- Modify: `test/integration/user-story-photo.test.ts`（非线性平移用例之后插入）

- [ ] **Step 1: unit camera-controller——翻转四条、新增两条**

  1. `'zoom only applies to projections that have one'`（:167）整体替换为：

  ```ts
    it('zoom reaches the linear projection as fov', () => {
      const c = new CameraController(undefined, { kind: 'linear', fov: Math.PI / 2, aspect: 2 })
      c.consumeDirty()
      c.zoom(0.5)
      const p = c.projection
      if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
      // (PI / 2) / 1.5 -- the unified contract: a positive delta magnifies by
      // (1 + delta), and a narrower fov IS the magnification for the linear
      // camera. v1 returned at the kind guard (a no-op), which was a port
      // regression: v0.2.2's PerspectiveTrans.zoom adjusted fov and worked.
      expect(p.fov).toBeCloseTo(Math.PI / 3)
      // The spread must carry the caller's aspect through -- losing it would
      // stretch the picture on the next non-square resize.
      expect(p.aspect).toBe(2)
      expect(c.consumeDirty()).toBe(true)
    })
  ```

  2. `'zoom clamps to the projection range'`（:174）的断言与注释翻转——放大顶格在**下限**，缩小顶格在**上限**：

  ```ts
    c.zoom(100)   // magnify far past the floor
    expect(zoomOf()).toBe(0.01)
    c.zoom(-100)  // shrink far past the ceiling -- and past the negative divisor
    expect(zoomOf()).toBe(1)
  ```

  （第二条同时是负分母路径的网：`1 + (-100) < 0`，实现若不钳分母会得到负值钳到 0.01，期望 1 即红。）注释里「The range is ported legacy behaviour」一句删去——范围不再是移植遗产，出处改写为 spec §4 的用户裁决。

  3. `'zoom moves by the delta, in the direction the delta asks for'`（:197）：起点 `{ zoom: 0.6 }`，`zoom(0.5)` 后期望 `toBe(0.4)`（0.6/1.5 精确；原 0.5/1.5 是循环小数，换成整除组合）。注释同步：正 delta 是放大，值变小。

  4. `'a zoom that clamps back to the value already held is a no-op'`（:212）：`c.zoom(0.5)`（原顶格写法）改为 `c.zoom(-0.5)`——新语义下从 ceiling=1 缩小 → `1/0.5=2` → 钳回 1 → no-op。`c.zoom(5e-17)` 一句原样保留（分母路径不变）。

  5. 新增（linear 的 clamp 两端 + 同值守卫）：

  ```ts
    it('linear zoom clamps to [15°, 110°] and pins at both ends', () => {
      const max = (110 * Math.PI) / 180
      const min = (15 * Math.PI) / 180
      const c = new CameraController(undefined, { kind: 'linear', fov: max, aspect: 1 })
      c.consumeDirty()
      c.zoom(-100) // shrink past the ceiling: already there, no-op
      expect(c.consumeDirty()).toBe(false)
      c.zoom(100)  // magnify past the floor: lands ON min, dirty
      const p = c.projection
      if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
      expect(p.fov).toBeCloseTo(min)
      expect(c.consumeDirty()).toBe(true)
    })
  ```

  6. `'does not write through to the projection the caller passed'`（:315 一带）：`zoomed.zoom(0.5)` 的期望 `zoom: 0.75` 改为 `zoom: 0.5 / 1.5`（写成表达式，与实现产出逐位同值）。该用例长注释里「start at zoom 1, call zoom(0.5), and the clamp returns 1」的反例推导按新语义重写——新公式下的空转陷阱是「**在 ceiling=1 处缩小**」（`zoom(-0.5)` → 1/0.5=2 → 钳回 1 → 早退），而「在 1 处放大」（`zoom(0.5)` → 1/1.5≈0.667）是有效写出。用例的另一半（setAspect 不写穿）不动。

  **调用点普查（已闭合，勿再漏）**：全仓 `grep -rn '\.zoom('` 共 14 处调用，本 Task 翻转 6 处（:170/:191+193/:205/:223/:315，另新增 linear 两条），其余语义存活零改动——`:226`（`5e-17` 分母路径）、`:242`/`:266`（零 delta 早退）、`:286-289`（非有限值守卫，新实现 `assertFinite` 仍在最前）、`:396`（notify：0.5 起 delta 0.5，新公式 0.5/1.5≠0.5，仍写出仍通知）。`src/viewer/viewer.ts:164/:278` 两处是纯转发，无独立测试面。`test/support/baseline.ts:30` 只是 v0.2.2 捕获态的文档注释，无 v1 重放。

- [ ] **Step 2: unit reference——`exact output pins` 六条期望值按新公式重算**

  `:96/:107/:121/:132/:144/:156` 六条用例的 `povLongitude: 350` / `90` 输入不动，期望值全部按 `lng = povLongitude * PI / 180` 重算（例：cylindrical :96 `theta = 0.5*2π - 350π/180 = π - 6.1087 = -2.9671`，`u = wrap01(theta/2π) = 0.52783…`）。**每条用例注释里的手推同步重写**——旧注释推导的是 `/4` 混合量，留着就是错文档。锚点自查：`povLongitude: 0` 时新旧公式输出必须逐位相同（`test/unit/baseline.test.ts` 与 `output range` 族 `:168-200` 不在本步改动范围，修后必须保持绿——它们红了说明改坏的是 wrap 而不是 lng）。

- [ ] **Step 3: integration US2——两条翻转**

  1. `'a wheel zoom-out reaches the camera state of a non-linear projection'`（:145）：`wheel(canvas, 200)` 改 `wheel(canvas, -200)`（**滚上**），用例名改 `'a wheel zoom-in reaches the camera state of a non-linear projection'`，注释改述方向契约（`classifyWheel` 正=放大；新公式 `zoom / (1+delta)` 从默认 1 只能向下走，滚下是 ceiling 上的 no-op）。断言 `projection.zoom < 1`、redraw 差分、像素差分三件全保留。
  2. `'zoom is a no-op for the linear camera'`（:226）整体替换：

  ```ts
    it('a wheel zoom reaches the linear projection as fov', async () => {
      const inputs = captureRenderInputs()
      const { viewer, container } = await imageViewer()
      const canvas = canvasOf(container)
      const zooms: string[] = []
      viewer.on('zoom', () => zooms.push('zoom'))
      viewer.src = '/fixtures/panorama.png'
      await nextFrames(3)

      const before = await readCanvas(canvas)
      const drawsBefore = inputs.sourceCalls()
      const fovBefore = (() => {
        const p = viewer.cameraOptions.projection
        if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
        return p.fov
      })()

      await wheel(canvas, -200)
      await nextFrames(2)

      const after = await readCanvas(canvas)
      const p = viewer.cameraOptions.projection
      viewer.dispose()

      expect(zooms.length).toBeGreaterThan(0)
      if (p.kind !== 'linear') throw new Error(`expected linear, got ${p.kind}`)
      // Scroll UP magnifies: a narrower fov. v1 returned at the kind guard and
      // the frame never changed -- the test this one replaces pinned that no-op.
      expect(p.fov).toBeLessThan(fovBefore)
      expect(inputs.sourceCalls() - drawsBefore, 'the zoom did not redraw').toBeGreaterThan(0)
      expect(maxChannelDiff(before.data, after.data), 'the zoom did not move the picture').toBeGreaterThan(2)
    })
  ```

  3. `'the public zoom() method reaches the projection the backend receives'`（:192-224）：`viewer.zoom(-0.5)` 改 `viewer.zoom(1)`，断言字面量 `{ kind: 'cylindrical', zoom: 0.5, extent: [1, 1] }` **保持不变**（新公式 1/(1+1)=0.5，恰好仍是 0.5）。注释「zoom is relative: -0.5 halves the default of 1」按新契约重写（delta 1 = 放大一倍：1/2=0.5；旧注的「-0.5 减半」在新语义下是从 1 出发的 ceiling no-op，waitFor 等不到 zoom 0.5 会超时）。其余断言（pre-zoom 帧、pose 不动、cameraOptions 终值）原样。

- [ ] **Step 4: integration photo——新增灵敏度红网**

  在 `'rotate() moves the picture on a non-linear camera'` 两半之后插入：

  ```ts
    it('a full 360° turn on a non-linear camera returns to the picture it started from', async () => {
      /*
       * The panning-sensitivity net for the lng fix. Under the old /4 offset a
       * 360° pose was ~14.33 turns (one turn per 25.13° of pose), so it landed
       * anywhere BUT home; under the honest degree conversion 360° is exactly
       * one turn and the pixels must come back. The 90° companion below moves
       * under BOTH formulas and only proves the camera turns at all -- the
       * round trip is the half that can fail.
       */
      const { viewer, container } = await imageViewer({ camera: 'cylindrical' })
      const canvas = canvasOf(container)
      viewer.src = '/fixtures/panorama.png'
      await nextFrames(3)

      const home = await readCanvas(canvas)
      viewer.rotate(0, 90)
      await nextFrames(2)
      const quarter = await readCanvas(canvas)
      viewer.rotate(0, 270)
      await nextFrames(2)
      const back = await readCanvas(canvas)
      viewer.dispose()

      expect(maxChannelDiff(home.data, quarter.data), 'a 90° turn did not move the picture').toBeGreaterThan(2)
      expect(maxChannelDiff(home.data, back.data), 'a 360° round trip did not come home').toBeLessThanOrEqual(2)
    })
  ```

- [ ] **Step 5: 各自跑红，确认红且红因正确**

  Run: `npx vitest run test/unit/camera-controller.test.ts -t 'zoom'`
  Expected: **FAIL** ×N——linear-fov 两条（现为 no-op，fov 不动）、clamp 方向两条（旧公式放大顶格在 1）、方向数值一条（0.6×1.5=0.9 ≠ 0.4）。同值守卫一条**保持绿**（`zoom(-0.5)` 旧公式 1×0.5=0.5 ≠ 1 会置脏——此条也红，红因是 no-op 失效，同样正确）。

  Run: `npx vitest run test/unit/reference.test.ts`
  Expected: **FAIL** ×6（pins 族），红因全部是 `u` 期望值不符。

  Run: `npx playwright test user-story-video -g 'zoom'`
  Expected: **FAIL** ×3——①滚上翻转用例（旧树滚上=缩小：从 1 打 ceiling clamp no-op，zoom 断言与像素断言都红）；②`:192` 方法用例（旧公式 `zoom(1)` → 1×2 → clamp 1，waitFor 等不到 zoom 0.5，超时红）；③linear fov 用例（旧树 kind 早退，fov 不动）。

  Run: `npx playwright test user-story-photo -g '360° turn'`
  Expected: **FAIL**——红在 `'did not come home'`（14.33 圈不回原样），`'90° turn'` 半边绿。

- [ ] **Step 6: 不提交**

  红状态是证据不是交付物，与修复在 Task 2 末尾同一提交落地。

### Task 2: 修复——zoom() 重写 + lng 三处同步（src 改动全在本 Task）

**Files:**
- Modify: `src/viewer/camera-controller.ts`（`zoom()`，约 `:114-129`；新增两个模块级常量）
- Modify: `src/core/reference.ts`（`lngOffset` :73-76 + 文件头与函数上的两段大注释）
- Modify: `src/renderer/webgpu/shaders/panorama.wgsl`（`:245` lng 行 + `:235-244` 注释）
- Modify: `src/renderer/webgl2/shaders/panorama.glsl`（对应 lng 行与注释——本卡 deps 锁在 P6 之后，开工时该文件已在 master；若不在，停手走 task-block，不要自建 GLSL）
- Modify: `src/viewer/viewer.ts`（`zoom` 的 TSDoc「No-op for the linear projection」，约 `:276`）
- Modify: `CLAUDE.md`（「The CPU reference is the arbiter」节 lngOffset 段落改述）

- [ ] **Step 1: camera-controller——常量与 zoom() 重写**

  模块级新增（`DEFAULT_PROJECTION` 旁）：

  ```ts
  /**
   * Linear zoom bounds in radians: 15° and 110°. Below 15° a handful of source
   * pixels stretch across the viewport; past 110° rectilinear distortion
   * dominates. User-adjudicated 2026-09-23, see the pan-zoom-semantics spec §4.
   */
  const MIN_FOV = (15 * Math.PI) / 180
  const MAX_FOV = (110 * Math.PI) / 180
  ```

  `zoom()` 整体替换：

  ```ts
    /**
     * Zooms by a relative magnification: a positive delta magnifies the picture
     * by (1 + delta), a negative one shrinks it by the same factor.
     *
     * Both parameterisations divide by (1 + delta) -- fov for the linear camera,
     * zoom for the others -- because in both a smaller parameter is a narrower
     * field, so ONE formula serves four cameras and the wheel step feels the
     * same on each. v1 multiplied instead (`zoom * (1 + delta)`), reading the
     * "positive is zoom in" wheel contract backwards and inverting wheel and
     * pinch relative to v0.2.2; and it returned at the kind guard for linear,
     * which v0.2.2's fov-adjusting PerspectiveTrans.zoom never did.
     *
     * No-op for a zero delta and for a delta whose clamped result is the value
     * already held (a wheel pinned at a limit).
     */
    zoom (delta: number): void {
      assertFinite(delta, 'zoom delta')
      if (delta === 0) return
      // A public-API delta below -1 would flip the divisor's sign and clamp a
      // "shrink" onto the most-magnified end of the range. Clamping the divisor
      // keeps every delta on the monotone path; the real input layer already
      // bounds its deltas to [-1, 1] (WheelZoom.MAX_STEP).
      const scale = Math.max(1 + delta, Number.EPSILON)
      if (this.#projection.kind === 'linear') {
        const next = Math.min(MAX_FOV, Math.max(MIN_FOV, this.#projection.fov / scale))
        if (next === this.#projection.fov) return
        this.#projection = { ...this.#projection, fov: next }
      } else {
        const next = Math.min(1, Math.max(0.01, this.#projection.zoom / scale))
        if (next === this.#projection.zoom) return
        this.#projection = { ...this.#projection, zoom: next }
      }
      this.#dirty = true
      this.#notify()
    }
  ```

  类头注释若提及「No-op … linear」（`/** Changes the zoom of the current projection. No-op for the linear one. */` :114）已被方法 TSDoc 覆盖，随之删除不重复。

- [ ] **Step 2: reference.ts——lngOffset 与两段大注释**

  ```ts
  function lngOffset (state: CameraState): number {
    return (state.povLongitude * PI) / 180
  }
  ```

  文件头「Two consequences worth stating up front」里的第二条（`/4` 混合单位）与 `lngOffset` 上的整段考古注释**改写不删除**：保留 v0.2.2 曾有此缺陷与量化（14.3×、`% 25` 补丁、GLSL 初始化隐患）的记载，处置改为「2026-09-23 用户裁决修正，取代 v1-design §11.4 B1，见 pan-zoom-semantics spec §1」。wgsl:242 注释里「Recorded as a deliberate retention in spec §11.4 (B1)」的指向同步换到新 spec——**三处注释必须互指一致**。

- [ ] **Step 3: 两个 shader 同步（同一提交，门 C 红线）**

  WGSL `:245`：

  ```wgsl
  let lng = camera.povLongitude * PI / 180.0;
  ```

  GLSL 对应行同式（`PI` 的拼法以该文件既有常量为准）。两侧注释按 Step 2 的口径改写（旧缺陷记载 + 新 spec 指向 + 三处同步警示）。**改完先跑 `npm run gen:shaders -- --check`**——它必须保持 up to date（本卡不动投影常量；红了说明误触了 JSON/生成管线）。

- [ ] **Step 4: viewer.ts TSDoc + CLAUDE.md 段落**

  `viewer.ts:276` 一带：「No-op for the linear projection, which has no zoom.」改为陈述统一契约（正 delta 放大；linear 以 fov 参数化，clamp [15°, 110°]）。`CLAUDE.md`「The CPU reference is the arbiter」节的 lngOffset 段落：删「reproduces … including that version's bugs」框架下对 `/4` 的现行时描述，改述为「曾是 v0.2.2 缺陷、2026-09-23 修正（spec 链接）」。

- [ ] **Step 5: 全部红网转绿 + 全量 unit**

  Run: `npx vitest run test/unit/camera-controller.test.ts test/unit/reference.test.ts`
  Expected: 全绿（含未动的 `output range` / `baseline.test.ts` / 同值守卫 / 零 delta / 非有限值族）。

  Run: `npx playwright test user-story-video user-story-photo`
  Expected: 全绿（`360° round trip` 的 `did not come home` 半边此刻必须绿）。

  Run: `npm run test:coverage`
  Expected: 四门槛 ≥90% 全过（新分支 `zoom()` 两路 + 负分母路径均有网）。

- [ ] **Step 6: 提交（红网与修复同一提交）**

  ```bash
  git add src/viewer/camera-controller.ts src/core/reference.ts \
    src/renderer/webgpu/shaders/panorama.wgsl src/renderer/webgl2/shaders/panorama.glsl \
    src/viewer/viewer.ts CLAUDE.md \
    test/unit/camera-controller.test.ts test/unit/reference.test.ts \
    test/integration/user-story-video.test.ts test/integration/user-story-photo.test.ts
  git commit -m "task-pan-zoom-semantics: fix(core,renderer,viewer): honest lng conversion, zoom direction, linear fov zoom

C1: the non-linear lng offset subtracts povLongitude/4 -- degrees off a
radian angle -- making pan ~14.3x oversensitive (one turn per 25.13 deg
of pose). Convert honestly (* PI / 180) in WGSL, GLSL and reference.ts
together; supersedes v1-design 11.4 B1 by user adjudication.

C2: zoom() multiplied (zoom * (1 + delta)) against a wheel contract
where positive means magnify, inverting wheel and pinch vs v0.2.2.

C3: linear zoom lands as multiplicative fov clamped [15, 110] deg --
v0.2.2's PerspectiveTrans.zoom adjusted fov and worked; the v1 no-op
was a port regression.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
  ```

### Task 3: 门 A 验证登记 + 收口

- [ ] **Step 1: gate-a 零改动验证 + 有意分歧登记**

  背景节的测定已给出预期：非线性可比集只剩 `origin`（lng=0，新旧公式等价），C2/C3 不在门 A 射程（v1 侧硬编码 zoom:1）。本步做三件事：① 跑 `npx playwright test gate-a-pixels` 亲证全绿（连同 'has a non-empty comparable set' 那条——它防的是集合意外清空）；② 在 `comparableStates` 的注释块补一段：lng≠0 的非线性态自 C1（2026-09-23，spec §5.2）起**永久漂移**，由既有过滤器排除，属登记在案的有意分歧，不是待修的红；③ 确认 `git diff` 里 `test/fixtures/baseline/` 与 `test/support/baseline.ts` 零改动。若门 A 意外红：停下按红态取证——要么 C1 改坏了 wrap/纬度路径，要么测定前提（LNG_INERT=false）不成立，两者都不是「收窄可比集」能治的，走 task-block。

- [ ] **Step 2: verify 六连（卡片 verify 原样当面跑）**

  Run: `npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build`
  Expected: 全绿。特别确认：门 B 全绿（lng 不在其射程，红则改坏了别的东西）；门 C 全绿（两 shader 同步的直接证明）；`no-webgpu` project 全绿且零 diff。

- [ ] **Step 3: 变异抽查（/tmp git-archive 沙箱，具名击杀才算数）**

  装置沿既有纪律：`git archive HEAD` 解 `/tmp` + 软链 `node_modules`，锚点恰好命中一次，落刀前后 sentinel sha 与 `git show HEAD:<path>` 对照。三个变异体、三 project 完整跑，JSON 报告里具名 `status === 'failed'` 的必须至少含：

  1. **lng 加回 `/4`**（只改 wgsl 一处）：`reference` 的 pins 族不会红（它们测 CPU 侧）——杀手必须是**门 C**（cross-backend 像素比对：wgsl 与 glsl 公式分叉）与 photo 的 `360° round trip`。若门 C 未红，报告并停手——那是门 C 失效，比变异存活严重。
  2. **zoom 公式换回乘法**（`/ scale` → `* scale`）：`camera-controller` 的 `'zoom moves by the delta…'`（0.6→0.9≠0.4）与 `'zoom clamps to the projection range'`（方向对调）具名红。
  3. **linear 早退加回**（`if (kind === 'linear') return`）：`camera-controller` 的 `'zoom reaches the linear projection as fov'` 与 US2 的 `'a wheel zoom reaches the linear projection as fov'` 具名红。

  还原后 sha 双向核对相符。

- [ ] **Step 4: 卡面登记**

  任务卡「完成报告」节写四要素：做了什么 / 红网证据与自测结果（verify 数字 + 变异击杀名单 + 门 A 收窄清单）/ 偏离 plan 的点 / 遗留风险。plan 复选框全勾。

---

## 完成标准

- [ ] Task 1 全部红网在带缺陷树上各跑出过一次**具名红**（Step 5 的记录写进完成报告）
- [ ] lng 公式三处（wgsl / glsl / reference）同一提交改齐，三处注释互指一致且指向 pan-zoom-semantics spec；门 C 全绿
- [ ] `zoom()` 统一为 `param / max(1 + delta, EPSILON)` 两路 clamp；负分母路径有具名网
- [ ] linear zoom 到达 fov（unit + US2 双证），clamp [15°, 110°] 两端有网
- [ ] 非线性 `360° round trip` 灵敏度网在位且绿
- [ ] 门 A 零 diff 自然绿（非线性可比集 = `origin` 不因 C1 变化），`comparableStates` 注释登记 lng≠0 有意分歧；基线 PNG 与 `test/support/baseline.ts` 零改动
- [ ] `npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build` 全绿
- [ ] 变异抽查三体具名击杀（含变异体 1 的门 C 必红），还原 sha 核对相符
- [ ] `src/index.ts`、`src/interaction/**`、`src/renderer/shaders/generated.ts`、US5 与 `no-webgpu` project 零 diff
- [ ] 卡面完成报告四要素齐全，plan 复选框全勾
