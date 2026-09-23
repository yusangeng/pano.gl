# 相机冻结修复（camera-freeze-fix）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 让 cylindrical / planet / pannini 三种非线性相机模型的平移（pan）与缩放（zoom）真正到达画布——方式是**整体删除** `WebGPUBackend.setCamera` 里的矩阵相等早退。

**Architecture:** 后端 `#dirty` 标志与相机 uniform 的唯一写入点都在 `#writeCameraUniforms()` 里，早退一删，uniform 写入与重绘标记同时恢复，无需第二刀。修复激活纬度平移（v1 着色器有意读取 `povLatitude`，v0.2.2 从不读）——这是**有意的分歧**，验收按 v1 自身语义（像素必须动），不按 v0.2.2 截图。

**Tech Stack:** TypeScript 5 strict / vitest（unit=node 项目，integration=浏览器真 GPU 项目）/ gl-matrix。

---

## 背景（开工前必读，零上下文也能懂）

### 缺陷与完整机制链

在非线性投影上，**没有任何相机变更到达过画布——平移与缩放全死**。逐环：

1. `src/core/matrix.ts:176-183`：三种非线性 kind 的 view 矩阵来自常量 `LEGACY_QUAD_VIEW`，`buildProjection` 只读 `extent`（zoom 按设计不进矩阵，`:128-130`）→ 这些 kind 的 clip 矩阵**与姿态、zoom 均无关**（opus 终审 node 探针实测：三种 kind 下 5 组 pose×zoom 矩阵 bit-identical）。
2. `src/renderer/webgpu/backend.ts` 的 `setCamera`：`if (mat4.equals(clip, this.#clip)) return` 这句早退，对非线性投影的**每一次**相机变更都成立（矩阵从不变）。
3. 早退跳过的不只是 uniform：`#writeCameraUniforms()` 的最后一行是 `this.#dirty = true`，而 `render()` 靠 `#dirty` 决定画不画——所以早退**一口气冻结了两样东西**：uniform 写入（`povLatitude`/`povLongitude`/`zoom` 的唯一写入点）和重绘标记。
4. 着色器从 uniform 读姿态（`panorama.wgsl`），不重写 uniform + 不置脏 = 画布永远停在旧帧。

归属：P2（matrix.ts）+ P3（早退骨架），p5 未触碰这两个文件（终审以 diff 归属核实）。

### 修复形状：删掉跳过，不是修好比较（用户裁决，2026-09-23）

opus 终审原建议「把比较条件补全成 pose/zoom/kind/extent 元组」。用户裁决改为**删除早退、每次都写**，理由：

- 错误的根因是「缓存跳过的前提写错了」（把矩阵当成了帧的唯一变化信号，对 3/4 的相机模型不成立）。删掉条件 = 前提不复存在，同类 bug 不可能复发；补全条件 = 留下一个将来加相机参数时必须记得同步扩展的比较。
- `#writeCameraUniforms()` 自带 `#dirty = true`，删早退后写入与重绘同时恢复，修复自洽完整。
- 代价已量过：渲染循环只在**要画的帧**才调 `setCamera`（`viewer.ts` 的 `#draw`），所以无条件写的上限是「每个绘制的帧多一次 96 字节上传 + 一次矩阵求逆」。播放中的视频约每秒几十帧，量级可忽略。
- P6 的 WebGL2 后端会照抄这次的选择——抄到的是「无条件写」这个不可能再犯同类错的形状。

### 为什么测试网必须是像素断言（门 A/B 对该缺陷族结构性失明）

- 门 A 只比较 `lat===0 && (LNG_INERT || lng===0)` 的非线性态（实践中只有 `origin`）——本缺陷族的姿态恰好全在它不比的维度上。
- 门 B 在用例间变 kind/extent，恰好触发 setSource 的冲刷路径，绕开 setCamera。
- 结论：**修复若回归，两道门都不会红**。真正的网是本卡的三条像素/上传断言（R1c 三件套）。

### v0.2.2 取证（为什么纬度断言按 v1 语义写）

终审读过 legacy `fshader.glsl` 原文与捕获的 uniforms/PNG：legacy 非线性路径逐片段读 `u_CamZoom` 与 `u_CamPOVLongitude`（经度平移在 v0.2.2 是**真回归**），但**从不读 `u_CamPOVLatitude`**（纬度平移在 v0.2.2 同样死）。v1 的 WGSL 读 `lat`（`phi = … - lat`），所以本修复会**激活纬度平移为新的有意行为**。纬度断言的期望值是「v1 自己渲染的东西会动」，不是「v0.2.2 截过的图」。

### 纪律与边界（越界 = plan 破裂，走 task-block）

- **击杀判据**：变异体只被 JSON 报告里**具名失败的用例**（`assertionResults[].status === 'failed'`）击杀；退出码不算数。变异在 `/tmp` 的 `git archive` 沙箱里做，落刀前后 sha 核对，工作树不动。
- **不动 `TARGET_FORMAT`**（`backend.ts:31`/`:317` 的 canvas 格式警告，修法方向 `getPreferredCanvasFormat()`）——归 P6（勘误 E35）。
- **不动 `CameraController.onChange`**（死面，`camera-controller.ts:181`）——归 P6/P7（勘误 E37）。
- **不动 US5 的两条断言与 `no-webgpu` project**（R1c 第 iii 条）。
- 注释一律英文；不写数值字面量的投影 kind；`import type` 用于纯类型导入。

---

### Task 1: 红网先行——三条测试在带缺陷的树上转红（只写测试，不碰 src）

**Files:**
- Modify: `test/unit/webgpu-backend.test.ts`（`describe('setCamera')` 块，约 `:395-465`）
- Modify: `test/integration/user-story-video.test.ts`（滚轮用例，约 `:145-185`）
- Modify: `test/integration/user-story-photo.test.ts`（拖拽用例之后插入新用例，约 `:73` 后）

- [ ] **Step 1: unit——删掉 skip 用例，换成 always-upload 红测**

在 `describe('setCamera')` 里，**整体删除**这个用例（它的前提随修复一起消失）：

```ts
  it('skips the upload when the clip matrix is unchanged', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setCamera({ povLatitude: 10, povLongitude: 20 }, { ...LINEAR })
    // Same pose, same projection: one upload, not two. The render loop calls
    // this every frame, so the equality check is what stops 60 uploads a second.
    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(1)
  })
```

原位插入：

```ts
  it('uploads the camera uniforms on every call, even when the matrix cannot see the change', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, CYLINDRICAL)
    h.backend.setCamera({ ...CAMERA }, { ...CYLINDRICAL })
    /*
     * Identical arguments, and the upload must happen anyway. On the
     * non-linear kinds the clip matrix is constant BY DESIGN (matrix.ts
     * builds their views from LEGACY_QUAD_VIEW), so a matrix-equality
     * early-out cannot tell "nothing changed" from "the camera moved in
     * the uniforms" -- the version this test replaced skipped both the
     * upload and the dirty flag on every camera change, freezing pan and
     * zoom on three of the four kinds. There is no skip left to get
     * wrong; the render loop already limits setCamera to frames that are
     * being drawn, so the unconditional write costs one small upload per
     * drawn frame.
     */
    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(2)
    // The second upload carries the camera too -- two writes that both
    // dropped the pose would satisfy the count above and freeze anyway.
    const view = uniformUpload(h, 1)
    expect(view.getFloat32(72, true)).toBe(CAMERA.povLatitude)
    expect(view.getFloat32(76, true)).toBe(CAMERA.povLongitude)
  })
```

（`uniformUpload(h, 1)` 读的是 `writeBuffer` 第 2 次调用的数据，helper 在 `:242`。）

- [ ] **Step 2: 跑它，确认红且红因正确**

Run: `npx vitest run test/unit/webgpu-backend.test.ts -t 'uploads the camera uniforms on every call'`
Expected: **FAIL**，`writeBuffer` 期望 2 实际 1——这正是缺陷的 unit 级形态（早退吃掉了第二次上传）。红在别处（如断言 72/76 偏移不对）= 写错了，先修测试。

- [ ] **Step 3: integration——恢复 US2 滚轮缩放的像素断言**

把 `test/integration/user-story-video.test.ts` 里 `'a wheel zoom-out reaches the camera state of a non-linear projection'` 整个用例**替换**为（注意：原版在断言前就 `dispose`，像素读回必须在 dispose 之前，所以是整用例替换不是尾插）：

```ts
  it('a wheel zoom-out reaches the camera state of a non-linear projection', async () => {
    const inputs = captureRenderInputs()
    const { viewer, container } = await imageViewer({ camera: 'cylindrical' })
    const canvas = canvasOf(container)
    const zooms: string[] = []
    viewer.on('zoom', () => zooms.push('zoom'))
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    const before = await readCanvas(canvas)
    const drawsBefore = inputs.sourceCalls()

    // Scroll DOWN, which zooms out. Zoom is clamped to at most 1 and the default
    // is 1, so scrolling the other way is a no-op by design and a test written
    // that way would assert nothing.
    await wheel(canvas, 200)
    await nextFrames(2)

    const after = await readCanvas(canvas)
    const projection = viewer.cameraOptions.projection
    viewer.dispose()

    expect(zooms.length).toBeGreaterThan(0)
    // Narrowed before the field is read: `Projection` is a union and only the
    // non-linear members have `zoom`, so reading it without the guard does not
    // compile -- which is the union doing its job.
    if (projection.kind !== 'cylindrical') throw new Error(`expected cylindrical, got ${projection.kind}`)
    expect(projection.zoom).toBeLessThan(1)
    /*
     * The pixel half, back where the plan had it. It was red on the
     * unmodified tree (P2+P3 defect: setCamera's matrix-equality early-out
     * skipped the uniform write AND the dirty flag for every camera change
     * on the non-linear kinds -- their clip matrix is constant by design --
     * so zoom never reached the canvas). The redraw count is asserted first
     * so a failure names its half: "did not redraw" is the dirty flag,
     * "did not move the picture" is the uniform content. No gate covers
     * this family -- gate A compares only states this defect never touches,
     * gate B varies extent between cases, which reflushes through setSource
     * -- so this test is the net.
     */
    expect(inputs.sourceCalls() - drawsBefore, 'the zoom-out did not redraw').toBeGreaterThan(0)
    expect(maxChannelDiff(before.data, after.data), 'the zoom-out did not move the picture').toBeGreaterThan(2)
  })
```

- [ ] **Step 4: integration——US1 补非线性平移两半像素用例**

在 `test/integration/user-story-photo.test.ts` 的 `'dragging rotates the camera and changes the image'` 用例之后插入：

```ts
  it.each([
    { lat: 30, lng: 0, half: 'latitude' },
    { lat: 0, lng: 90, half: 'longitude' }
  ])('rotate() moves the picture on a non-linear camera: the $half half', async ({ lat, lng }) => {
    /*
     * The drag test above is the linear camera, where pose lives in the
     * clip matrix and always reached the canvas. On the non-linear kinds
     * the matrix is constant by design and the pose travels through the
     * uniforms -- the path the P2/P3 setCamera early-out froze. The two
     * halves are asserted separately because they fail separately: the
     * longitude half was a working feature in v0.2.2 (a regression), the
     * latitude half is new intended behaviour -- v0.2.2's shader never
     * read u_CamPOVLatitude, v1's WGSL does -- so the expected value here
     * is v1's own semantics (the pixels move), never the v0.2.2 capture.
     * Turn sizes are large on purpose: the sample window has to shift by
     * more than rounding for the diff to clear the bound. If a half ever
     * reads <= 2 WITH the redraw confirmed below, report it -- do not
     * loosen the bound or shrink the turn silently.
     */
    const inputs = captureRenderInputs()
    const { viewer, container } = await imageViewer({ camera: 'cylindrical' })
    const canvas = canvasOf(container)
    viewer.src = '/fixtures/panorama.png'
    await nextFrames(3)

    const before = await readCanvas(canvas)
    const drawsBefore = inputs.sourceCalls()
    viewer.rotate(lat, lng)
    await nextFrames(2)
    const after = await readCanvas(canvas)
    viewer.dispose()

    expect(inputs.sourceCalls() - drawsBefore, `rotate(${lat}, ${lng}) did not redraw`).toBeGreaterThan(0)
    expect(maxChannelDiff(before.data, after.data), `rotate(${lat}, ${lng}) did not move the picture`).toBeGreaterThan(2)
  })
```

（`rotate(lat, lng)` 是绝对设值——`survives a whole session` 用例里 `rotate(15, 45)` 后位姿恰为 `{15, 45}` 可证。`imageViewer({ camera: 'cylindrical' })` 每轮新构，绝对值即所需。）

- [ ] **Step 5: 两条 integration 各自跑一遍，确认红且红因正确**

Run: `npx vitest run test/integration/user-story-video.test.ts -t 'wheel zoom-out'`
Expected: **FAIL**，红在 `'the zoom-out did not redraw'` 或 `'did not move the picture'`（修复前两者都成立——脏标记没置、像素没动；`sourceCalls` 差分若意外 >0，则红必然在像素半边，同样正确）。

Run: `npx vitest run test/integration/user-story-photo.test.ts -t 'rotate() moves the picture'`
Expected: **FAIL** ×2（latitude / longitude 两条参数化），红因同上。

- [ ] **Step 6: 不提交**

红状态是证据不是交付物。三条测试与修复在 Task 2 末尾同一个提交里落地。

### Task 2: 修复——删早退，无条件写（src 唯一改动）

**Files:**
- Modify: `src/renderer/webgpu/backend.ts`（`setCamera`，约 `:343-366`）

- [ ] **Step 1: 替换 setCamera 方法体**

现状（删除目标）：

```ts
  setCamera (state: CameraState, projection: Projection): void {
    this.#state = state
    this.#projection = projection

    // WebGPU's clip space has z in [0, 1]; GL's is [-1, 1]. This is the one
    // place the two backends genuinely differ, and the matrix builder takes it
    // as a parameter precisely so neither has to know about the other.
    const clip = mat4.create()
    buildCameraTransform(state, projection, 'zero-to-one', clip)

    if (mat4.equals(clip, this.#clip)) return

    mat4.copy(this.#clip, clip)
    // The fragment stage inverts it. `invert` returns null when the matrix is
    // singular; every matrix this builder produces is invertible, so a null here
    // means the builder changed shape, and silently rendering black would hide it.
    if (!mat4.invert(this.#invClip, clip)) {
      throw new Error('camera clip matrix is singular')
    }

    this.#writeCameraUniforms()
  }
```

替换为：

```ts
  setCamera (state: CameraState, projection: Projection): void {
    this.#state = state
    this.#projection = projection

    // WebGPU's clip space has z in [0, 1]; GL's is [-1, 1]. This is the one
    // place the two backends genuinely differ, and the matrix builder takes it
    // as a parameter precisely so neither has to know about the other.
    const clip = mat4.create()
    buildCameraTransform(state, projection, 'zero-to-one', clip)

    mat4.copy(this.#clip, clip)
    // The fragment stage inverts it. `invert` returns null when the matrix is
    // singular; every matrix this builder produces is invertible, so a null here
    // means the builder changed shape, and silently rendering black would hide it.
    if (!mat4.invert(this.#invClip, clip)) {
      throw new Error('camera clip matrix is singular')
    }

    // Unconditional upload, deliberately. The non-linear kinds build their
    // view from the constant LEGACY_QUAD_VIEW (see matrix.ts), so their clip
    // matrix does not depend on the camera at all -- pose and zoom reach the
    // shader through these uniforms alone. A matrix-equality early-out here
    // skipped the upload AND the dirty flag (both live in
    // #writeCameraUniforms) for every camera change on those kinds, freezing
    // pan and zoom on three of the four camera models. No skip means no
    // premise to get wrong; the render loop already calls setCamera only on
    // frames it is drawing, so this costs one small upload per drawn frame.
    this.#writeCameraUniforms()
  }
```

（`mat4.equals` 在本文件仅此一处使用；`mat4` 本体仍被 `create`/`copy`/`invert` 使用，import 不动。）

- [ ] **Step 2: 三条网转绿**

Run: `npx vitest run test/unit/webgpu-backend.test.ts -t 'uploads the camera uniforms on every call'`
Expected: PASS（2 次上传，第二次带 pose）。

Run: `npx vitest run test/integration/user-story-video.test.ts -t 'wheel zoom-out'`
Expected: PASS。

Run: `npx vitest run test/integration/user-story-photo.test.ts -t 'rotate() moves the picture'`
Expected: PASS ×2。

- [ ] **Step 3: 全量 unit 不回归**

Run: `npm run test:coverage`
Expected: 全绿，四门槛（statements/branches/functions/lines ≥90%）过。特别关注 `webgpu-backend.test.ts` 里既有的 `'repacks the uniforms when a source swap changes the texture projection'`（setSource 路径的 writeBuffer 计数——setCamera 无条件写后计数起点变了，若该用例红，读它的计数注释按新事实重排数字并记入偏离，不许为绿而绿）与 `'throws when the clip matrix is singular'`（早退删除后首调用即 throw，仍应绿）。

- [ ] **Step 4: 提交（测试与修复同一提交）**

```bash
git add src/renderer/webgpu/backend.ts test/unit/webgpu-backend.test.ts test/integration/user-story-photo.test.ts test/integration/user-story-video.test.ts
git commit -m "task-camera-freeze-fix: fix(renderer): drop the matrix-equality early-out from setCamera

The non-linear kinds build their view from the constant LEGACY_QUAD_VIEW,
so their clip matrix never depends on pose or zoom -- the early-out skipped
the uniform write AND the dirty flag for every camera change on three of
four camera models, freezing pan and zoom. Upload unconditionally; the
render loop already limits setCamera to drawn frames.

Restore the US2 zoom pixel assertion and add the non-linear pan pixel net
(both halves, latitude per v1 semantics -- v0.2.2 never read it).

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

### Task 3: 收口——verify 六连 + 变异抽查 + 卡面报告

- [ ] **Step 1: verify 六连（卡片 verify 原样当面跑）**

Run: `npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build`
Expected: 全绿。浏览器会话偶发连接超时是已登记的平台抖动——已跑用例全绿、恰好缺一个 project 的文件时，同尖端重跑一次，两次同签名才升级为缺陷。

- [ ] **Step 2: 变异抽查（证明网真的网住了）**

在 `/tmp` 的 `git archive <HEAD>` 沙箱（软链 worktree 的 `node_modules`，落刀前 sentinel sha 核对）把早退加回去：

```ts
    if (mat4.equals(clip, this.#clip)) return
```

（插回 `buildCameraTransform` 调用之后、`mat4.copy` 之前。）三 project 完整跑，JSON 报告里**具名**转红的必须至少含：

- `webgpu-backend` · `uploads the camera uniforms on every call, even when the matrix cannot see the change`
- `user-story-photo` · `rotate() moves the picture on a non-linear camera: the latitude half` 与 `... longitude half`
- `user-story-video` · `a wheel zoom-out reaches the camera state of a non-linear projection`

还原后与 `git show HEAD:src/renderer/webgpu/backend.ts` 的 blob sha256 对照相符。任一具名杀手缺席 = 网有洞，回 Task 1 补，不许带洞交卷。

- [ ] **Step 3: 卡面登记**

任务卡「完成报告」节写四要素：做了什么 / 自测结果（verify 数字 + 变异击杀名单）/ 偏离 plan 的点（含 Step 3 of Task 2 里任何计数重排）/ 遗留风险（若有）。plan 复选框全勾。

---

## 完成标准

- [ ] 三条网在带缺陷的树上各跑出过一次**具名红**（Step 2/5 的记录写进完成报告）
- [ ] `src/renderer/webgpu/backend.ts` 的早退已删，`#writeCameraUniforms()` 无条件执行；src 改动仅此一处
- [ ] `npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build` 全绿
- [ ] 变异抽查：早退加回后，上列四个具名用例全部转红；还原 sha 核对相符
- [ ] US5 两条断言与 `no-webgpu` project 零 diff（R1c 第 iii 条）
- [ ] `TARGET_FORMAT`（E35）与 `CameraController.onChange`（E37）零 diff
- [ ] 卡面完成报告四要素齐全，plan 复选框全勾
