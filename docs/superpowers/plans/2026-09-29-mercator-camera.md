# Mercator 相机（第五投影）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch.

**Goal:** 给 pano.gl 增加第五个相机投影 `mercator`——cylindrical 的保角版（全图均匀比例尺、两极推到无穷远），全栈一次到位：常量管线、CPU float64 仲裁者、WGSL/GLSL 双 shader、拖拽语义（M 度量平移）、三门测试、demo lab 面板、README。

**Architecture:** 无几何、无顶点投影的单三角形架构下，新相机 = 一个逐片元公式，写三次：`src/core/reference.ts`（float64 仲裁者）、`panorama.wgsl`、`panorama.glsl`（两份手工转写，gate C 用像素对像素看守）。投影常量只有一个事实源 `src/core/projection-kinds.json`，经 `npm run gen:shaders` 生成进 shader。加宽 `ProjectionKind` 联合会让类型系统强制补齐所有 `Record<ProjectionKind, ...>` 与穷尽 switch——这是 Task 1 必须一个原子绿提交的原因。拖拽垂直通道在 M 度量空间平移（内容跟手），水平通道与 cylindrical 零差异。

**Tech Stack:** TypeScript 5（strict、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`）、neostandard（无分号、2 空格、单引号）、vitest（unit node 环境 / integration browser mode 真 GPU）、WGSL + GLSL ES 3.00。

**Spec:** `docs/superpowers/specs/2026-09-29-mercator-camera-design.md`（本 plan 的锚，公式与裁决以它为准）。

---

## 全局约束（每个 Task 都读一遍）

1. **commit 前缀一律 `task-mercator-camera:`**，commit message 结尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
2. **注释全英文**；导出的函数/类/接口用 TSDoc；局部注释只在读者会看错的地方写，且写 why 不写 what。代码风格 neostandard：**无分号、2 空格缩进、单引号**。
3. **`src/renderer/shaders/generated.ts` 永不手改**。改 `src/core/projection-kinds.json` 后跑 `npm run gen:shaders`。任何位置（TS 或 shader）**禁止手写投影 kind 的数值字面量**。
4. **改投影公式 = 同时改两个 shader 文件**（WGSL 与 GLSL）。只改一个是 gate C 存在要抓的失败。
5. `import type` 用于纯类型导入（`verbatimModuleSyntax` 开着，值导入类型是构建错误）。
6. 本 plan 中的**精确测试字面量**（如 `0.7038832845573474`）是 2026-09-29 用独立 scratch 脚本从数学推导出来的，**不是**从被测代码抄的。照抄进测试，不要"化简"。
7. 集成测试手势必须走 `test/integration/support/gestures.ts`（`InputController` 调 `setPointerCapture`，手造 PointerEvent 会假通过）；像素读回必须走 `support/canvas.ts` 且先 `await nextFrames(2)`。
8. 单测命令：`npx vitest run --project unit test/unit/<file>.test.ts`；集成：`npx vitest run --project integration test/integration/<file>.test.ts`（需要真 GPU 的 `integration` 项目）。本机没有 WebGPU 时集成测试留给协调者机器跑，单元与 typecheck 必须全绿。
9. Task 1 特殊：加宽联合后**中间状态注定是编译红的**（`CAMERA_CODES`、穷尽 switch 被 TS 强制补齐）——红阶段就是编译器本身。按步骤顺序做完，最后一次跑测试。

---

## File Structure（改动地图）

```
src/core/projection-kinds.json            Task 1   +mercator: 5（唯一事实源）
src/renderer/shaders/generated.ts         Task 1   生成物（gen:shaders 产出，禁手改）
src/core/types.ts                         Task 1   ProjectionKind + Projection 联合加宽
src/core/constants.ts                     Task 1   CAMERA_CODES / PROJECTION_KINDS 补齐
src/core/matrix.ts                        Task 1   buildProjection 文档注释两处（无代码改动）
src/core/reference.ts                     Task 1   projectMercator + switch case + 模块头豁免 + latOffset 文档
test/unit/constants.test.ts               Task 1   三处机械加宽
test/unit/reference.test.ts               Task 1   机械加宽（isDegenerate/nonLinear/两个数组）
                                         Task 2   mercator 不变量 describe（I1–I6 + 极点 + gd 恒等）
src/renderer/webgpu/shaders/panorama.wgsl Task 3   project_mercator + dispatch case + 四处注释
test/unit/shaders.test.ts                 Task 3   dispatch pin
src/renderer/webgl2/shaders/panorama.glsl Task 4   project_mercator + if-chain 分支 + 两处注释
test/unit/webgl2-shaders.test.ts          Task 4   常量 pin + 两个函数清单 + 结构性 pin
src/interaction/gestures.ts               Task 5   MercatorDrag + classifyDragMercator
test/unit/gestures.test.ts                Task 5   classifyDragMercator describe
src/interaction/input-controller.ts       Task 6   dragToMercatorPan（无单测：coverage 排除名单内，先例）
src/viewer/camera-controller.ts           Task 7   panMercator
test/unit/camera-controller.test.ts       Task 7   panMercator describe
src/viewer/viewer.ts                      Task 8   pan 处理器按 kind 分流 + snapshotProjection 注释
test/integration/mercator-drag.test.ts    Task 8   新文件：手势端到端（仅 integration 项目收集）
test/integration/support/viewer.ts        Task 9   PROJECTIONS + mercator
test/integration/user-story-camera-switch.test.ts Task 9 KINDS + mercator（与上者同一个提交，lockstep 测试看守）
test/integration/gate-b-projection.test.ts Task 10  CAMERAS 循环 + extent 行为 + 极点退化屏
test/integration/gate-c-cross-backend.test.ts Task 11 extentFor + CAMERAS + 状态扫描 + 仲裁腿
demo/lab/panels/camera.ts                 Task 12  KINDS + mercator
demo/lab/context.ts                       Task 12  defaultProjection extent 三元
demo/lab/main.ts                          Task 12  URL kind 列表
README.md                                 Task 13  相机表 + 五投影节 + rule of thumb
demo/shots/mercator.png                   Task 14  lab 截图 800×450 + 全量核验
```

不动的文件（spec §7 非目标，别"顺手"改）：`gate-a-pixels.test.ts`、`test/support/baseline.ts`（`LEGACY_EXTENT` 保持 legacy-only，gate B 用内联三元）、两个 renderer backend（对非线性 kind 通用，零改动）、`src/viewer/options.ts`（运行时校验只管 texture 投影）、`vitest.config.ts`（mercator-drag.test.ts 天然只被 `integration` 收集）、`user-story-video.test.ts`。

---

### Task 1: 常量管线 + CPU 仲裁者（一个原子绿提交）

**Files:**
- Modify: `src/core/projection-kinds.json`
- Modify: `src/core/types.ts`
- Modify: `src/core/constants.ts`
- Modify: `src/core/matrix.ts:95-106`（仅注释）
- Modify: `src/core/reference.ts`
- Modify: `test/unit/constants.test.ts`
- Modify: `test/unit/reference.test.ts`（仅机械加宽；不变量 describe 在 Task 2）

- [x] **Step 1: projection-kinds.json 加 mercator**

`camera` 对象在 `pannini` 之后加一行（保持既有缩进与逗号风格）：

```json
"mercator": 5
```

- [x] **Step 2: 跑生成器**

Run: `npm run gen:shaders`
Expected: 无输出报错；`git diff src/renderer/shaders/generated.ts` 可见 WGSL 块新增 `CAMERA_PROJECTION_MERCATOR`、GLSL 块新增对应 `#define`。

- [x] **Step 3: types.ts 加宽两个类型**

`ProjectionKind` 联合加 `'mercator'`。`Projection` 判别联合在 pannini 成员之后加：

```ts
  /**
   * The conformal cylinder (2026-09-29 mercator-camera spec): uniform scale
   * everywhere, poles at infinity. Same zoom anchor as cylindrical -- full
   * width 360 degrees at zoom 1 -- and the same 1x1 surface; the vertical
   * field is the Gudermannian pair of the latitude, spanning +/-85.051129
   * degrees (gd(pi), the EPSG:3857 cutoff) at zoom 1.
   */
  | { readonly kind: 'mercator', readonly zoom: number, readonly extent: readonly [number, number] }
```

- [x] **Step 4: constants.ts 补齐（编译强制）**

`CAMERA_CODES` 表加一行（漏加即 TS 错——这个表就是这样存在的）；`PROJECTION_KINDS` 数组末尾追加 `'mercator'`：

```ts
  mercator: kinds.camera.mercator
```

```ts
export const PROJECTION_KINDS: readonly ProjectionKind[] = ['linear', 'cylindrical', 'planet', 'pannini', 'mercator']
```

- [x] **Step 5: matrix.ts 注释两处（无代码改动）**

`buildProjection` 的文档注释：
- `m = max(extent) / 2` 条目里的枚举改为：`cylindrical and mercator 1x1, planet and pannini 4x4`；
- `@param projection` 里的 `all four shader paths` 改为 `all five shader paths`。

mercator 走通用非线性正交路径（extent 1×1 与 cylindrical 同款），代码零改动。

- [x] **Step 6: reference.ts——公式、switch、模块头、latOffset**

(a) `projectPannini` 之后、`project()` 之前加（公式与 cylindrical 同款签名；`x` 不读，与 cylindrical 的注释同款钉住）：

```ts
function projectMercator (x: number, y: number, z: number, zoom: number, lng: number, lat: number): UV {
  // `x` is deliberately unread, exactly as in project_cylindrical.
  const yy = y * zoom
  const zz = z * zoom
  const theta = zz * TWO_PI - lng
  // The negated atanh(sin(lat)) mirrors cylindrical's "- lat" (spec I2): at
  // the screen centre the two cameras read the same source point.
  const M = yy * TWO_PI - Math.atanh(Math.sin(lat))
  // gd(M) + pi/2 in the asin/tanh form: tanh saturates at exactly +-1 and
  // asin's domain is closed, so any M -- including the +-Infinity an exact
  // pole pose produces -- stays finite and branch-free (spec 2.4: the exp
  // form overflows f32 near M = 88.7).
  const phi = Math.asin(Math.tanh(M)) + HALF_PI
  return toUV(theta, phi)
}
```

(b) `project()` 的 switch 在 pannini case 之后加：

```ts
    case 'mercator':
      return projectMercator(x, y, z, projection.zoom, lng, lat)
```

(c) 模块头：在列出三项已裁决例外（lngOffset、latOffset、planet 分支点）的段落之后加一段（非转写声明，与 latOffset 的"v1 自有"同类）：

```ts
 * Mercator (added 2026-09-29, mercator-camera spec) is not a transcription
 * at all: it has no v0.2.2 original. Its authority is the spec's analytic
 * invariants and gate C's three-way agreement, the same class of ownership
 * as the latitude term above.
```

(d) `latOffset` 的文档注释：把"cylindrical/pannini 减 φ、planet 当 Möbius 倾角"的枚举扩成三种用法，补一句 mercator——它减的是 `atanh(sin(lat))`，cylindrical `− lat` 的保角对应项。

- [x] **Step 7: constants.test.ts 三处**

(a) `uploads the numeric values the legacy shader hard-coded` 测试里，pannini 行之后加（带豁免注释——这不是 legacy 数字）：

```ts
  // 5 is not a legacy number: mercator has no v0.2.2 original. It is fixed by
  // the 2026-09-29 mercator-camera spec and frozen from the first release
  // that ships it.
  expect(cameraProjectionCode('mercator')).toBe(5)
```

(b) `keeps the wire numbers out of the public API` 测试的期望数组追加 `'mercator'`：

```ts
  expect(PROJECTION_KINDS).toEqual(['linear', 'cylindrical', 'planet', 'pannini', 'mercator'])
```

(c) `is the only place these numbers appear` 测试的违规正则加一个分支：`(linear|cylindrical|planet|pannini|equirectangular|mercator)`。

- [x] **Step 8: reference.test.ts 机械加宽（四处）**

(a) `isDegenerate` switch 在 `case 'cylindrical'` 之后加（I6：无分支、除数不为零、无 0/0 点）：

```ts
    case 'mercator':
      // tanh saturates, asin's domain is closed: nothing here can produce
      // NaN at any finite input, and the pole poses stay finite by design
      // (spec 2.5).
      return false
```

(b) `nonLinear` 数组（约 :59）照 cylindrical 兄弟项的形状追加：

```ts
    ['mercator', { kind: 'mercator', zoom: 1, extent: [1, 1] }] as const
```

(c)(d) 'output range' 测试的投影数组和 no-NaN 扫描的投影数组（约 :181 与 :215）各追加同款一项（照抄邻近 cylindrical 项的 `as const` 风格）。

- [x] **Step 9: 跑测试与类型检查（此时必须全绿）**

Run: `npx vitest run --project unit test/unit/constants.test.ts test/unit/reference.test.ts && npm run typecheck`
Expected: 全绿。若 typecheck 报某个 `Record<ProjectionKind, ...>` 或穷尽 switch 缺 mercator——这正是编译强制在干活，把缺的补上（但按本 plan 的地图，不该出现地图外的文件）。

- [x] **Step 10: Commit**

```bash
git add -A
git commit -m "task-mercator-camera: add the mercator kind to the constants pipeline and the CPU reference

The union widening is compile-forced everywhere it matters (CAMERA_CODES,
the reference switch), so the pipeline, the float64 arbiter and the
mechanical test widenings land as one green commit.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: reference 不变量单测（I1–I6 + 极点 + gd 恒等）

**Files:**
- Modify: `test/unit/reference.test.ts`

背景：Task 1 已把 `projectMercator` 落地（编译强制的），所以本任务的"红"用一步变异检查代替（Step 3）——证明这些 pin 真的咬人。

- [ ] **Step 1: 在文件末尾追加 describe**

文件顶部已有 `project` 导入、`CameraState`/`Projection` 类型导入和 `const state: CameraState = { povLatitude: 0, povLongitude: 0 }`（:5），直接用。

```ts
describe('mercator (2026-09-29 mercator-camera spec)', () => {
  const mercator: Projection = { kind: 'mercator', zoom: 1, extent: [1, 1] }

  it('I1: the default pose is a bit-exact identity -- lat 0, y 0 gives v = 0.5 exactly', () => {
    // atanh(sin 0) = 0 exactly and tanh(0)/asin(0) are exact, so no rounding
    // stands between the input and v = 0.5. u: theta = 0.5*2pi - 350deg wraps
    // to 19/36.
    const uv = project(1, 0, 0.5, { povLatitude: 0, povLongitude: 350 }, mercator)
    expect(uv.u).toBeCloseTo(0.5277777777777778, 12)
    expect(uv.v).toBe(0.5)
  })

  it('zoom scales both terms: the half-zoom frame halves theta and M', () => {
    // (1, 0.25, 0.5) at zoom 0.5: zz = 0.25 -> u wraps to 5/18; yy = 0.125 ->
    // M = pi/4 exactly, so v = (gd(pi/4) + pi/2)/pi.
    const uv = project(1, 0.25, 0.5, { povLatitude: 0, povLongitude: 350 },
      { kind: 'mercator', zoom: 0.5, extent: [1, 1] })
    expect(uv.u).toBeCloseTo(0.2777777777777778, 12)
    expect(uv.v).toBeCloseTo(0.7276661003867785, 12)
  })

  it('the latitude term is negated atanh(sin(lat)), the same direction as the -lat term in cylindrical', () => {
    // (1, 0.25, 0) at lat 45, lng 0: theta = 0 -> u = 0 exactly; M = pi/2 -
    // atanh(sin 45deg). A positive sign instead would put M at ~2.452 and v at
    // ~0.945 -- a visible flip this pin exists to catch.
    const uv = project(1, 0.25, 0, { povLatitude: 45, povLongitude: 0 }, mercator)
    expect(uv.u).toBe(0)
    expect(uv.v).toBeCloseTo(0.7038832845573474, 12)
  })

  it('I2: at the same pose the centre reads the same source point as cylindrical', () => {
    // Centre of the surface, y = z = 0. gd is odd, so
    // phi = gd(-atanh(sin lat)) + pi/2 = pi/2 - lat -- cylindrical's centre
    // term for term. Float64 agrees exactly at lat -45 and 0 and to the last
    // ulp at the others; 1e-12 is far above an ulp and far below anything a
    // wrong sign or a stray pi/2 tail could produce.
    const cylindrical: Projection = { kind: 'cylindrical', zoom: 1, extent: [1, 1] }
    for (const lat of [-80, -45, 0, 45, 80]) {
      const pose = { povLatitude: lat, povLongitude: 0 }
      const m = project(1, 0, 0, pose, mercator)
      const c = project(1, 0, 0, pose, cylindrical)
      expect(m.v, `lat ${lat}`).toBeCloseTo(c.v, 12)
      expect(m.u, `lat ${lat}`).toBeCloseTo(c.u, 12)
    }
  })

  it('I3: v is strictly inside (0, 1) for moderate y -- the poles are asymptotes, not clamps', () => {
    for (const y of [-2, -0.5, 0, 0.5, 2]) {
      const v = project(1, y, 0, state, mercator).v
      expect(v, `y ${y}`).toBeGreaterThan(0)
      expect(v, `y ${y}`).toBeLessThan(1)
    }
  })

  it('float64 tanh saturates: extreme y collapses onto the pole rows exactly', () => {
    // The honest float64 limit, same family as the pole poses below: tanh
    // rounds to exactly 1.0 once |M| passes ~19, so y = +-100 (M = +-200pi)
    // pins v to exactly 0 / 1. Mathematically the range is open; in float64
    // it closes at the same saturation the exact-pole poses rely on.
    expect(project(1, 100, 0, state, mercator).v).toBe(1)
    expect(project(1, -100, 0, state, mercator).v).toBe(0)
  })

  it('pole poses collapse the frame onto one pole row: lat +-90 gives v = 0 / 1 exactly', () => {
    // sin((+-90deg)*pi/180) rounds to exactly +-1 in float64, atanh(1) is
    // +Infinity, no finite yy moves it, and phi lands on 0 / pi exactly. u
    // stays finite: theta never reads latitude.
    const up = project(1, 0.5, 0.3, { povLatitude: 90, povLongitude: 10 }, mercator)
    expect(up.v).toBe(0)
    expect(Number.isFinite(up.u)).toBe(true)
    expect(project(1, 0.5, 0.3, { povLatitude: -90, povLongitude: 10 }, mercator).v).toBe(1)
  })

  it('the asin(tanh) form and the textbook 2*atan(e^M) - pi/2 form are the same function', () => {
    // Spec 2.4: the implementation form must not be mistaken for a formula
    // change. The two agree to the last few ulps of float64 -- precision 15
    // fails at M = 6 (diff 3.1e-15), so the pin is 14.
    for (const m of [0.5, 1, 3, 6]) {
      const asinForm = Math.asin(Math.tanh(m))
      const expForm = 2 * Math.atan(Math.exp(m)) - Math.PI / 2
      expect(asinForm, `M ${m}`).toBeCloseTo(expForm, 14)
    }
  })

  it('zoom 1 with extent 1x1 spans gd(pi) = 85.051129deg, the EPSG:3857 cutoff', () => {
    // Spec 2.3: the screen edges at y = +-0.5 sit at v = 0.5 +- gd(pi)/pi.
    const top = project(1, 0.5, 0, state, mercator).v
    const bottom = project(1, -0.5, 0, state, mercator).v
    expect(top).toBeCloseTo(0.9725062709989257, 12)
    expect(bottom).toBeCloseTo(0.0274937290010743, 12)
    expect(top - 0.5).toBeCloseTo(0.5 - bottom, 12)
  })
})
```

- [ ] **Step 2: 跑测试**

Run: `npx vitest run --project unit test/unit/reference.test.ts`
Expected: 全绿。

- [ ] **Step 3: 变异检查——证明 pin 咬人**

临时把 `src/core/reference.ts` 里 `projectMercator` 的 `const M = yy * TWO_PI - Math.atanh(Math.sin(lat))` 改成 `+ Math.atanh(...)`，重跑 Step 2 命令。
Expected: **至少 I2、lat-term、zoom-edges 三个测试红**。改回原样，重跑确认全绿。（变异必须完全恢复——`git diff` 为空才算完。）

- [ ] **Step 4: Commit**

```bash
git add test/unit/reference.test.ts
git commit -m "task-mercator-camera: pin the mercator invariants on the float64 reference

I1 bit-exact identity, I2 centre parity with cylindrical, the open range
with its honest float64 saturation limit, exact-pole collapse, the gd/exp
identity, and the EPSG:3857 screen-edge pin. Sign-flip mutation verified
the pins fail.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: WGSL——公式 + dispatch + 注释

**Files:**
- Modify: `src/renderer/webgpu/shaders/panorama.wgsl`
- Modify: `test/unit/shaders.test.ts`

- [ ] **Step 1: 先写失败的 dispatch pin**

`test/unit/shaders.test.ts` 的 dispatch pin 组（现有 `case CAMERA_PROJECTION_PANNINI:` 断言之后，约 :91-94）加：

```ts
    expect(STRIPPED).toContain('case CAMERA_PROJECTION_MERCATOR:')
```

Run: `npx vitest run --project unit test/unit/shaders.test.ts`
Expected: FAIL——`case CAMERA_PROJECTION_MERCATOR:` 不存在。

- [ ] **Step 2: panorama.wgsl 加公式**

`project_pannini` 结束（`:270`）与 `panorama_uv` 之间插入：

```wgsl
/*
 * The fifth projection is v1's own (2026-09-29 mercator-camera spec): there is
 * no v0.2.2 original to transcribe. It is cylindrical's conformal twin --
 * uniform scale everywhere, poles at infinity -- sharing cylindrical's
 * horizontal term exactly.
 */
fn project_mercator(s: vec3f, zoom: f32, lng: f32, lat: f32) -> vec2f {
  // `s.x` is deliberately unread, exactly as in project_cylindrical.
  let y = s.y * zoom;
  let z = s.z * zoom;

  let theta = z * TWO_PI - lng;
  // The negated atanh(sin(lat)) mirrors cylindrical's "- lat": at the screen
  // centre the two cameras read the same source point (spec I2).
  let m = y * TWO_PI - atanh(sin(lat));
  // gd(m) + pi/2 in the asin/tanh form: tanh saturates at +-1 and asin's
  // domain is closed, so no branch and no guard (spec 2.4 -- the exp form
  // overflows f32 near m = 88.7).
  let phi = asin(tanh(m)) + HALF_PI;
  return to_uv(theta, phi);
}
```

- [ ] **Step 3: dispatch 加 case**

switch 里 `CAMERA_PROJECTION_PANNINI` case 之后、`default` 之前加：

```wgsl
    case CAMERA_PROJECTION_MERCATOR: { uv = project_mercator(surface, camera.zoom, lng, lat); }
```

- [ ] **Step 4: 四处注释更新**

1. 文件头 `:7-8`：`the non-linear three read it as the quad point` → `the non-linear four read it as the quad point`。
2. 转写块注释 `:97-117`：`The four projections are transcribed statement for statement from the v0.2.2 shader` → 改为「五个中的四个是逐句转写；mercator（2026-09-29）是 v1 自有——cylindrical 的保角孪生，无 v0.2.2 原件」的表述（英文），并保留原有两个"看似转写错误其实不是"的要点；结尾 `Keep all four in the same shape` → `Keep all five in the same shape`。
3. `:135-140`：`The three non-linear projections below` → `The four non-linear projections below`。
4. `panorama_uv` 的 lat 注释 `:294-302`：在"cylindrical and pannini still subtract it"处补 mercator——它减的是 `atanh(sin(lat))`，`- lat` 的保角对应项。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run --project unit test/unit/shaders.test.ts`
Expected: 全绿（含 Step 1 的新 pin）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/webgpu/shaders/panorama.wgsl test/unit/shaders.test.ts
git commit -m "task-mercator-camera: project through mercator in the WGSL path

Formula plus dispatch case plus the comment sites that enumerate the
projections. The dispatch pin lands red-first.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: GLSL 孪生 + 双 shader 守望测试

**Files:**
- Modify: `src/renderer/webgl2/shaders/panorama.glsl`
- Modify: `test/unit/webgl2-shaders.test.ts`

背景：GLSL 的 dispatch 是 **if-链不是 switch**（ES 3.00 的 `#define` case 标签是移植性陷阱）。`webgl2-shaders.test.ts` 的 token 归一化（`bodyTokens`：剥注释、`vec2f(`→`vec2(`、丢 `let|float`、丢大括号）会让逐行同形的两个函数体 token 序列完全一致——这是本任务的红线：**两边必须逐行同形**。

- [ ] **Step 1: 先写失败的测试（三处）**

`test/unit/webgl2-shaders.test.ts`：

(a) 常量 pin 测试（现有 `CAMERA_PROJECTION_PANNINI` 断言之后）加：

```ts
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_MERCATOR')
```

(b) 'transcribes the same formulas as the WGSL, token for token' 测试（`:234`）的两个清单各加 `'project_mercator'`：

```ts
    for (const fn of ['to_uv', 'project_linear', 'project_cylindrical', 'project_planet', 'project_pannini', 'project_mercator']) {
```

```ts
    for (const fn of ['project_linear', 'project_cylindrical', 'project_planet', 'project_pannini', 'project_mercator']) {
```

(c) 同 describe 末尾追加结构性 pin（mercator 不进现有 `/-\s*lat\b/` 纬度循环——它的纬度用法是 `- atanh(sin(lat))`，不匹配那个正则；这是刻意的设计，注释里写明）：

```ts
  it('project_mercator is the spec formula in both files: negated atanh(sin(lat)), asin(tanh) form', () => {
    // Mercator stays out of the latitude-usage loop above on purpose: its
    // term is `- atanh(sin(lat))`, which that loop's /-\s*lat\b/ regex does
    // not match. This pin is its substitute, and it holds both files to the
    // spec's two load-bearing choices: the NEGATED atanh (I2, centre parity
    // with cylindrical) and the asin(tanh) form (spec 2.4, f32-safe near the
    // poles where the exp form overflows). The token comparison above already
    // proves the two files agree with each other; this pins what they agree
    // ON.
    for (const body of [glslBody('project_mercator'), wgslBody('project_mercator')]) {
      expect(body).toContain('- atanh(sin(lat))')
      expect(body).toContain('asin(tanh(m))')
    }
  })
```

Run: `npx vitest run --project unit test/unit/webgl2-shaders.test.ts`
Expected: FAIL——GLSL 里还没有 `project_mercator`。

- [ ] **Step 2: panorama.glsl 加公式**

`project_pannini` 之后、`panorama_uv` 之前插入（**与 WGSL 逐行同形**；GLSL 兄弟函数签名风格是 `vec2 name (vec3 s, ...)`，空格照抄）：

```glsl
/*
 * The fifth projection is v1's own (2026-09-29 mercator-camera spec): there is
 * no v0.2.2 original to transcribe. It is cylindrical's conformal twin --
 * uniform scale everywhere, poles at infinity -- sharing cylindrical's
 * horizontal term exactly.
 */
vec2 project_mercator (vec3 s, float zoom, float lng, float lat) {
  // `s.x` is deliberately unread, exactly as in project_cylindrical.
  float y = s.y * zoom;
  float z = s.z * zoom;

  float theta = z * TWO_PI - lng;
  // The negated atanh(sin(lat)) mirrors cylindrical's "- lat": at the screen
  // centre the two cameras read the same source point (spec I2).
  float m = y * TWO_PI - atanh(sin(lat));
  // gd(m) + pi/2 in the asin/tanh form: tanh saturates at +-1 and asin's
  // domain is closed, so no branch and no guard (spec 2.4 -- the exp form
  // overflows f32 near m = 88.7).
  float phi = asin(tanh(m)) + HALF_PI;
  return to_uv(theta, phi);
}
```

- [ ] **Step 3: if-链加分支**

`u_projKind == CAMERA_PROJECTION_PANNINI` 分支之后、最终 `else { uv = vec2(0.0, 0.0); }` 之前插入：

```glsl
  } else if (u_projKind == CAMERA_PROJECTION_MERCATOR) {
    uv = project_mercator(surface, u_zoom, lng, lat);
```

- [ ] **Step 4: 两处注释更新**

1. `:103-110`：`The three non-linear projections` → `The four non-linear projections`。
2. lat 注释（`:263-271`，WGSL `:294-302` 的镜像）：补 mercator 的第三种用法，与 WGSL 侧同句。

- [ ] **Step 5: 跑测试**

Run: `npx vitest run --project unit test/unit/webgl2-shaders.test.ts test/unit/shaders.test.ts`
Expected: 全绿。token-for-token 测试通过 = 两份公式逐行同形。

- [ ] **Step 6: 变异检查（双 shader 看守的"咬人"证明）**

临时把 **GLSL** 里 mercator 的 `- atanh(sin(lat))` 改成 `+ atanh(sin(lat))`（只改一个文件），重跑 Step 5 命令。
Expected: token-for-token 测试与结构性 pin **双红**——单边改公式正是它们存在的理由。改回，重跑全绿，`git diff` 为空。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/webgl2/shaders/panorama.glsl test/unit/webgl2-shaders.test.ts
git commit -m "task-mercator-camera: the GLSL twin of project_mercator

Line-for-line the WGSL body, dispatched through the if-chain (not a
switch: #define case labels are an ES 3.00 portability hazard). The
token-for-token tripwire and a structural sign pin land red-first;
one-sided-sign mutation verified both bite.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: gestures——classifyDragMercator

**Files:**
- Modify: `src/interaction/gestures.ts`
- Test: `test/unit/gestures.test.ts`

- [ ] **Step 1: 先写失败的测试**

`test/unit/gestures.test.ts`：import 行把 `classifyDragMercator` 加进现有的 gestures 导入；文件末尾追加：

```ts
describe('classifyDragMercator', () => {
  const surface = { width: 400, height: 200 }

  it('a full-height upward drag is 2pi metres at zoom 1 -- one screen spans M in [-pi, pi]', () => {
    // Spec 2.3: zoom 1 with extent 1x1 shows exactly gd(pi) = 85.051129deg
    // of latitude either way of centre, so one screen height IS 2pi metres.
    const d = classifyDragMercator({ deltaX: 0, deltaY: -200 }, surface, 1)
    expect(d.meters).toBeCloseTo(2 * Math.PI, 10)
    expect(d.lng).toBe(0)
  })

  it('zoom halves the metre span of the same pixels', () => {
    const d = classifyDragMercator({ deltaX: 0, deltaY: -200 }, surface, 0.5)
    expect(d.meters).toBeCloseTo(Math.PI, 10)
  })

  it('horizontal: lng matches classifyDrag exactly (I5, the theta row is shared)', () => {
    const delta = { deltaX: 100, deltaY: 0 }
    expect(classifyDragMercator(delta, surface, 1).lng)
      .toBeCloseTo(classifyDrag(delta, surface).lng, 10)
    expect(classifyDragMercator(delta, surface, 1).lng).toBeCloseTo(-90, 10)
  })

  it('the vertical sign is scene-follows-hand, same inversion as classifyDrag', () => {
    const up = classifyDragMercator({ deltaX: 0, deltaY: -50 }, surface, 1).meters
    const down = classifyDragMercator({ deltaX: 0, deltaY: 50 }, surface, 1).meters
    expect(up).toBeGreaterThan(0)
    expect(down).toBeLessThan(0)
  })

  it('a zero-sized surface reports no movement', () => {
    expect(classifyDragMercator({ deltaX: 10, deltaY: 10 }, { width: 0, height: 0 }, 1))
      .toEqual({ meters: 0, lng: 0 })
  })
})
```

Run: `npx vitest run --project unit test/unit/gestures.test.ts`
Expected: FAIL——`classifyDragMercator` 未导出。

- [ ] **Step 2: 实现**

`src/interaction/gestures.ts`：`classifyDrag` 之后加：

```ts
/** The Mercator twin of {@link DragRotation}: metres of map latitude, degrees of longitude. */
export interface MercatorDrag {
  readonly meters: number
  readonly lng: number
}

/**
 * Classifies a drag for the Mercator camera: vertical motion as a translation
 * in the map's metre metric, horizontal as degrees of longitude.
 *
 * The metre formula is the vertical twin of `classifyDrag`'s longitude: one
 * screen height spans `2*pi*zoom` metres, so the same pixels span half the
 * metres at zoom 0.5 (spec section 4). The sign follows the same
 * scene-follows-hand inversion as `classifyDrag` -- drag up, and the content
 * that was below centre comes to centre.
 *
 * A non-positive surface dimension yields zero metres and zero degrees, the
 * same guard `classifyDrag` has: a collapsed container must not turn the
 * division into infinity or NaN.
 */
export function classifyDragMercator (delta: DragInput, surface: SurfaceSize, zoom: number): MercatorDrag {
  if (surface.width <= 0 || surface.height <= 0) return { meters: 0, lng: 0 }
  return {
    lng: -(delta.deltaX / surface.width) * 360,
    meters: -(delta.deltaY / surface.height) * 2 * Math.PI * zoom
  }
}
```

（`DragInput`/`SurfaceSize` 若与文件内的实际名字不同，以 `classifyDrag` 的签名为准对齐——照抄它的参数类型。）

- [ ] **Step 3: 跑测试**

Run: `npx vitest run --project unit test/unit/gestures.test.ts`
Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add src/interaction/gestures.ts test/unit/gestures.test.ts
git commit -m "task-mercator-camera: classify mercator drags in the metre metric

One screen height is 2*pi*zoom metres; horizontal stays classifyDrag's
longitude (I5). Zero-size guard mirrors the existing twin.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: input-controller——dragToMercatorPan

**Files:**
- Modify: `src/interaction/input-controller.ts`

无单测文件：`input-controller` 在 coverage 排除名单里（`vitest.config.ts` 根配置），既有方法也没有 1:1 单测，本任务照先例。逻辑本身在 `classifyDragMercator`（Task 5 已全测）。

- [ ] **Step 1: 加方法**

`dragToRotation` 之后加（import 处把 `classifyDragMercator` 与 `type MercatorDrag` 加进 `./gestures` 的现有导入）：

```ts
  /** Classifies a pan event for the Mercator camera. See {@link classifyDragMercator}. */
  dragToMercatorPan (deltaX: number, deltaY: number, surface: SurfaceSize, zoom: number): MercatorDrag {
    return classifyDragMercator({ deltaX, deltaY }, surface, zoom)
  }
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 绿。

- [ ] **Step 3: Commit**

```bash
git add src/interaction/input-controller.ts
git commit -m "task-mercator-camera: expose dragToMercatorPan beside dragToRotation

Thin pass-through; the maths is classifyDragMercator's and already
unit-pinned. No unit twin: input-controller is coverage-excluded by
precedent.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: camera-controller——panMercator

**Files:**
- Modify: `src/viewer/camera-controller.ts`
- Test: `test/unit/camera-controller.test.ts`

- [ ] **Step 1: 先写失败的测试**

`test/unit/camera-controller.test.ts`：文件已有 `CameraController` 导入与各投影的工厂先例（照抄 `cylindrical` 工厂的写法）。文件末尾追加：

```ts
describe('panMercator', () => {
  const mercator = (): Projection => ({ kind: 'mercator', zoom: 1, extent: [1, 1] })

  it('translates by metres in the map metric: lat 0 pan(1) -> 49.6049deg', () => {
    // lat' = asin(tanh(atanh(sin 0) + 1)) * 180/pi, derived independently:
    // tanh(1) = 0.761594..., asin -> 0.865769... rad.
    const c = new CameraController(undefined, mercator())
    c.panMercator(1, 0)
    expect(c.state.povLatitude).toBeCloseTo(49.6049374208547, 12)
  })

  it('moves both axes from a tilted pose', () => {
    const c = new CameraController({ povLatitude: 60, povLongitude: 10 }, mercator())
    c.panMercator(-2, 5)
    expect(c.state.povLatitude).toBeCloseTo(-36.40531310489626, 12)
    expect(c.state.povLongitude).toBe(15)
  })

  it('saturates onto the pole without crossing it or producing NaN', () => {
    // tanh(1e9) is exactly 1.0 in float64, so asin lands exactly on +-pi/2.
    const up = new CameraController({ povLatitude: 0, povLongitude: 0 }, mercator())
    up.panMercator(1e9, 0)
    expect(up.state.povLatitude).toBe(90)
    const down = new CameraController({ povLatitude: -30, povLongitude: 0 }, mercator())
    down.panMercator(-1e9, 0)
    expect(down.state.povLatitude).toBe(-90)
  })

  it('the exact pole is absorbing: a finite delta cannot leave it', () => {
    // atanh(sin(90deg)) = atanh(1) = +Infinity, and +Infinity + finite stays
    // +Infinity in float64. Only setPose/rotate leave the pole (spec 2.5).
    const c = new CameraController({ povLatitude: 90, povLongitude: 0 }, mercator())
    c.panMercator(-1, 0)
    expect(c.state.povLatitude).toBe(90)
  })

  it('a purely horizontal pan keeps latitude bit-exact', () => {
    // lat 45 is a value where the atanh -> tanh -> asin round trip comes back
    // one ulp short (measured 7.1e-15deg); the deltaM === 0 shortcut exists so
    // a horizontal drag does not jitter latitude and dirty a full-redraw
    // frame for nothing.
    const c = new CameraController({ povLatitude: 45, povLongitude: 0 }, mercator())
    c.panMercator(0, -72)
    expect(c.state.povLatitude).toBe(45)
    expect(c.state.povLongitude).toBe(288)
  })

  it('a zero delta is a no-op that does not dirty', () => {
    const c = new CameraController(undefined, mercator())
    c.consumeDirty()
    c.panMercator(0, 0)
    expect(c.consumeDirty()).toBe(false)
  })

  it('rejects non-finite deltas', () => {
    const c = new CameraController(undefined, mercator())
    expect(() => c.panMercator(Number.NaN, 0)).toThrow(/finite/i)
    expect(() => c.panMercator(0, Number.POSITIVE_INFINITY)).toThrow(/finite/i)
  })
})
```

Run: `npx vitest run --project unit test/unit/camera-controller.test.ts`
Expected: FAIL——`panMercator` 不存在。

- [ ] **Step 2: 实现**

`src/viewer/camera-controller.ts`：`rotate`（`:106-111`）之后加：

```ts
  /**
   * Pans the Mercator camera: `deltaM` in the map's metre metric, `deltaLng`
   * in degrees.
   *
   * The latitude update inverts the projection's own latitude term --
   * `lat' = asin(tanh(atanh(sin lat) + deltaM))` -- so the content under the
   * finger stays under the finger at every latitude and zoom (spec section 4;
   * the metre formula lives in `classifyDragMercator`). Programmatic rotation
   * keeps its degree-linear shape; this is the gesture path only.
   */
  panMercator (deltaM: number, deltaLng: number): void {
    assertFinite(deltaM, 'deltaM')
    assertFinite(deltaLng, 'deltaLng')
    if (deltaM === 0 && deltaLng === 0) return
    // A purely horizontal pan must not touch latitude: the atanh/tanh/asin
    // round trip is exact in real arithmetic but only ~1 ulp in float64
    // (measured 7.1e-15deg at lat 45, 1.4e-14 at lat 80), and every jitter
    // dirties a full-redraw frame.
    const lat = deltaM === 0
      ? this.#state.povLatitude
      : Math.asin(Math.tanh(Math.atanh(Math.sin(this.#state.povLatitude * Math.PI / 180)) + deltaM)) * 180 / Math.PI
    this.#apply(lat, this.#state.povLongitude + deltaLng)
  }
```

- [ ] **Step 3: 跑测试**

Run: `npx vitest run --project unit test/unit/camera-controller.test.ts`
Expected: 全绿（`#apply` 自带 clamp/wrap/dirty 语义，与 rotate 共用）。

- [ ] **Step 4: 变异检查**

临时删掉 `deltaM === 0` 三元 shortcut（让水平 pan 也走公式）。重跑。
Expected: `keeps latitude bit-exact` 红（差 1 ulp）。恢复，全绿，`git diff` 为空。

- [ ] **Step 5: Commit**

```bash
git add src/viewer/camera-controller.ts test/unit/camera-controller.test.ts
git commit -m "task-mercator-camera: pan mercator by metres of map latitude

Inverts the projection's own latitude term so content follows the
finger at every latitude; pole-absorbing and bit-exact-horizontal
behaviour pinned, shortcut-mutation verified.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: viewer 分流 + 手势端到端集成测试

**Files:**
- Modify: `src/viewer/viewer.ts:61-63`（注释）、`:134-142`（pan 处理器）
- Create: `test/integration/mercator-drag.test.ts`

- [ ] **Step 1: 先写失败的集成测试**

新文件 `test/integration/mercator-drag.test.ts`（从 `test/integration/` 到 src 是 `'../../src'`；注意 support/ 下的文件才是 `'../../../src'` 深度）：

```ts
import { describe, it, expect } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { makeContainer, canvasOf } from './support/dom'
import { drag } from './support/gestures'
import { nextFrames } from './support/canvas'
import { skipIfPresentedCanvasBroken } from './support/presented-canvas'

/*
 * The mercator gesture story end to end: a drag on the canvas moves the pose
 * in the metre metric (spec section 4) and the public 'rotate' event still
 * carries degrees -- the APPLIED delta, not the metres. Mounts through the
 * public class directly rather than support/viewer's PROJECTIONS table, which
 * Task 9 widens; the pose assertions do not need that harness.
 */
describe('mercator drag (user story)', () => {
  it('a vertical drag pans in the metre metric and reports applied degrees', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: { projection: { kind: 'mercator', zoom: 1, extent: [1, 1] } }
    })
    try {
      await nextFrames(3)

      const rotations: Array<{ lat: number, lng: number }> = []
      viewer.on('rotate', (r) => { rotations.push(r) })

      // 32px of 200px height upward: metres = -(deltaY/h)*2pi*zoom
      // = 2pi*0.16 = 1.0053096491487339, derived independently.
      await drag(canvasOf(container), { from: { x: 200, y: 100 }, to: { x: 200, y: 68 } })
      await nextFrames(2)

      const pose = viewer.cameraOptions.pose
      expect(pose.povLatitude).toBeCloseTo(49.801690337054204, 9)
      expect(pose.povLongitude).toBe(0)
      // Each 'rotate' carries its own applied delta. The drag helper delivers
      // exactly one move, so this is one event; the sum keeps the assertion
      // tied to the pose even if the provider ever batches differently.
      expect(rotations.length).toBeGreaterThanOrEqual(1)
      const totalLat = rotations.reduce((s, r) => s + r.lat, 0)
      const totalLng = rotations.reduce((s, r) => s + r.lng, 0)
      expect(totalLat).toBeCloseTo(49.801690337054204, 9)
      expect(totalLng).toBe(0)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })

  it('a horizontal drag moves longitude only, latitude bit-exact', async (ctx) => {
    await skipIfPresentedCanvasBroken(ctx)
    const container = makeContainer(400, 200)
    const viewer = await FramelessImageViewer.create({
      container,
      src: '/fixtures/panorama.png',
      camera: { projection: { kind: 'mercator', zoom: 1, extent: [1, 1] } }
    })
    try {
      await nextFrames(3)

      // 80px of 400px width rightward: lng = -(80/400)*360 = -72, wrapped to
      // 288. deltaY is 0, so the deltaM === 0 shortcut keeps latitude at
      // exactly 0 -- this exercises the no-jitter path through the whole
      // stack.
      await drag(canvasOf(container), { from: { x: 100, y: 100 }, to: { x: 180, y: 100 } })
      await nextFrames(2)

      const pose = viewer.cameraOptions.pose
      expect(pose.povLatitude).toBe(0)
      expect(pose.povLongitude).toBe(288)
    } finally {
      viewer.dispose()
      container.remove()
    }
  })
})
```

Run（有真 GPU 的机器）: `npx vitest run --project integration test/integration/mercator-drag.test.ts`
Expected: FAIL——pan 处理器还在走 `dragToRotation`，姿态对不上（纬度差得远：角度线性 vs 米度量）。

- [ ] **Step 2: viewer.ts pan 处理器分流**

把 `:134-142` 的 pan 处理器整体替换为：

```ts
    this.#input.on('pan', ({ deltaX, deltaY }) => {
      const surface = { width: this.canvas.clientWidth, height: this.canvas.clientHeight }
      const projection = this.#camera.projection
      if (projection.kind === 'mercator') {
        // Content-follows-hand in the metre metric (mercator-camera spec
        // section 4): the event still speaks degrees -- the APPLIED delta,
        // which is what a clamped pan actually moved.
        const d = this.#input.dragToMercatorPan(deltaX, deltaY, surface, projection.zoom)
        if (d.meters === 0 && d.lng === 0) return
        const before = this.#camera.state.povLatitude
        this.#camera.panMercator(d.meters, d.lng)
        this.events.emit('rotate', { lat: this.#camera.state.povLatitude - before, lng: d.lng })
        return
      }
      const d = this.#input.dragToRotation(deltaX, deltaY, surface)
      if (d.lat === 0 && d.lng === 0) return
      this.#camera.rotate(d.lat, d.lng)
      this.events.emit('rotate', { lat: d.lat, lng: d.lng })
    })
```

同文件 `:60-63` `snapshotProjection` 的注释里 `the four-member union` → `the five-member union`。

- [ ] **Step 3: 跑测试**

Run: `npx vitest run --project integration test/integration/mercator-drag.test.ts`
Expected: 全绿。
Run: `npm run typecheck`
Expected: 绿。

- [ ] **Step 4: Commit**

```bash
git add src/viewer/viewer.ts test/integration/mercator-drag.test.ts
git commit -m "task-mercator-camera: route mercator pans through the metre metric

The pan handler branches on projection.kind; 'rotate' still emits
degrees, now the applied delta. End-to-end drag story pinned through
the public viewer.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: 测试基建加宽（PROJECTIONS 与 KINDS 同一提交）

**Files:**
- Modify: `test/integration/support/viewer.ts:27-32`
- Modify: `test/integration/user-story-camera-switch.test.ts:8`

背景：camera-switch 有一个 lockstep 测试（`:73-81`）断言 `Object.keys(PROJECTIONS)` 与 `KINDS` 集合相等——两边必须同一个提交加宽，否则一边红。且 camera-switch 在 `no-webgpu` 项目也跑，mercator 用例必须在 WebGL2 上成立（Task 4 的 GLSL 孪生 + gate C 保证）。

- [ ] **Step 1: 两边同时加宽**

`support/viewer.ts` 的 `PROJECTIONS`（表头注释 "The four projections" → five）加：

```ts
  mercator: { kind: 'mercator', zoom: 1, extent: [1, 1] }
```

`user-story-camera-switch.test.ts` 的 `KINDS`（`:8`）：

```ts
const KINDS = ['linear', 'cylindrical', 'planet', 'pannini', 'mercator'] as const
```

同文件 lockstep 测试上方注释若枚举 "the four the public union names" 之类字样，同步改 five。

- [ ] **Step 2: 跑测试（两个项目都要绿）**

Run: `npx vitest run --project integration test/integration/user-story-camera-switch.test.ts && npx vitest run --project no-webgpu test/integration/user-story-camera-switch.test.ts`
Expected: 全绿——参数化循环自动多出 mercator 用例（从别的模型切入 mercator、pose 保持、像素变化 >2），lockstep 测试自动覆盖新键。

- [ ] **Step 3: Commit**

```bash
git add test/integration/support/viewer.ts test/integration/user-story-camera-switch.test.ts
git commit -m "task-mercator-camera: widen the camera-switch harness to mercator

PROJECTIONS and KINDS in one commit -- the lockstep test compares the
two key sets. The mercator case must hold on WebGL2 too, which the
GLSL twin and gate C carry.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: gate B——纬度响应 + extent 行为 + 极点退化屏

**Files:**
- Modify: `test/integration/gate-b-projection.test.ts`

- [ ] **Step 1: CAMERAS 循环纳入 mercator**

`:20` 改为：

```ts
  const CAMERAS = ['cylindrical', 'planet', 'pannini', 'mercator'] as const
```

`:34` 的 `extent: LEGACY_EXTENT[camera]` 改为（`LEGACY_EXTENT` 是 legacy 键控的，在 `test/support/baseline.ts`——**不动它**；mercator 的 1×1 是本 spec 的选择，不是 legacy 值，写死在这份测试里）：

```ts
          projection: { kind: camera, zoom: 1, extent: camera === 'mercator' ? [1, 1] : LEGACY_EXTENT[camera] },
```

（若 `as const`/类型报错，照 `LEGACY_EXTENT[camera]` 的推断加 `as const` 于 `[1, 1]`。）

- [ ] **Step 2: 新增两个测试（describe 内、capture-docs 测试之后）**

```ts
  it('mercator is extent-sensitive: the surface size is part of the projection', async () => {
    // Same camera, same source, extent 1x1 vs 2x2: the ortho box scales y/z
    // before the formula sees them, so the frame must change. An
    // extent-blind mercator (say, one special-cased in the matrix) would
    // render these identical -- which is exactly what this catches.
    const source = await loadSource()
    const bitmap = await createImageBitmap(
      new ImageData(source.rgba.slice(), source.width, source.height)
    )

    const render = (extent: readonly [number, number]) =>
      renderOffscreen({
        width: 128,
        height: 128,
        camera: { povLatitude: 0, povLongitude: 0 },
        projection: { kind: 'mercator', zoom: 1, extent },
        source: bitmap,
        sourceWidth: source.width,
        sourceHeight: source.height
      })

    const [a, b] = await Promise.all([render([1, 1]), render([2, 2])])
    bitmap.close()
    expect(maxChannelDiff(a.rgba, b.rgba)).toBeGreaterThan(2)
  })

  it('a pole pose collapses the mercator frame onto one source row', async () => {
    // Row r of a 64x64 synthetic source is the uniform shade 4r, so "how many
    // rows are on screen" is readable from the pixels. At povLatitude 90 the
    // f32 chain is atanh(sin(lat)) = +Infinity, M = -Infinity whatever y
    // says, and every fragment lands on the SAME pole row: the frame is
    // uniform. At lat 0 the frame spans nearly all rows and is not. The
    // uniformity spread, not WHICH row, is the assertion: the shader's v is
    // flipped and the sampler repeats, so naming the row would pin a
    // convention this test does not need (the reference unit tests pin which
    // v each pole gives).
    const rows = 64
    const pixels = new Uint8ClampedArray(rows * rows * 4)
    for (let r = 0; r < rows; r++) {
      const shade = r * 4
      for (let c = 0; c < rows; c++) {
        const i = (r * rows + c) * 4
        pixels[i] = shade
        pixels[i + 1] = shade
        pixels[i + 2] = shade
        pixels[i + 3] = 255
      }
    }
    const bitmap = await createImageBitmap(new ImageData(pixels, rows, rows))

    const spread = (rgba: Uint8Array) => {
      let min = 255
      let max = 0
      for (let i = 0; i < rgba.length; i += 4) {
        min = Math.min(min, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
        max = Math.max(max, rgba[i]!, rgba[i + 1]!, rgba[i + 2]!)
      }
      return max - min
    }

    const render = async (povLatitude: number) =>
      renderOffscreen({
        width: 128,
        height: 128,
        camera: { povLatitude, povLongitude: 0 },
        projection: { kind: 'mercator', zoom: 1, extent: [1, 1] },
        source: bitmap,
        sourceWidth: rows,
        sourceHeight: rows
      })

    const [pole, equator] = await Promise.all([render(90), render(0)])
    bitmap.close()

    // One source row on screen: one shade everywhere (2 absorbs a single
    // bilinear step at a row boundary).
    expect(spread(pole.rgba)).toBeLessThanOrEqual(2)
    // The equator frame shows many rows.
    expect(spread(equator.rgba)).toBeGreaterThan(2)
  })
```

（I2 的中心奇偶在 unit 层已按位级 pin（Task 2），像素级不再重复——中心片元不落在 ndc 0 上，像素级奇偶天生不精确，spec 的 gate B 行由以上三个用例 + unit 覆盖。）

- [ ] **Step 3: 跑测试**

Run: `npx vitest run --project integration test/integration/gate-b-projection.test.ts`
Expected: 全绿（mercator 纬度响应用例自动生成）。

- [ ] **Step 4: Commit**

```bash
git add test/integration/gate-b-projection.test.ts
git commit -m "task-mercator-camera: gate B covers mercator latitude, extent and poles

Inline 1x1 extent (LEGACY_EXTENT stays legacy-only), extent
sensitivity, and the pole-pose row collapse on a synthetic
row-shaded source.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: gate C——跨后端一致 + 仲裁腿

**Files:**
- Modify: `test/integration/gate-c-cross-backend.test.ts`

- [ ] **Step 1: extentFor 与 CAMERAS**

`:46-47` 改为：

```ts
const extentFor = (kind: Kind): readonly [number, number] =>
  kind === 'cylindrical' || kind === 'mercator' ? [1, 1] : [4, 4]
```

（其 doc 注释的数字来源句补一句：mercator 1×1 是 2026-09-29 spec §2.3 的选择，非 legacy quad。）

`:54` 改为：

```ts
const CAMERAS: readonly Kind[] = ['linear', 'cylindrical', 'planet', 'pannini', 'mercator']
```

主矩阵自动多出 mercator × 4 状态（≤2）；极点测试 `:141` 的 `for (const kind of CAMERAS)` 自动纳入 mercator@89.5（<64——mercator 的 theta 不读纬度，无经度压缩问题，预期远低于界）。

- [ ] **Step 2: 状态扫描 describe（spec §5 要求的 lat × zoom 覆盖）**

文件末尾（现有 describe 之后）追加：

```ts
describe('gate C: mercator state sweep (spec section 5)', () => {
  // Spec 2026-09-29 section 5: gate C must cover mercator across the latitude
  // range INCLUDING the pole poses and across the zoom range. The exact poles
  // are row collapses, not the longitude compression that motivates the 89.5
  // relaxation above, and mercator's theta never reads latitude, so every
  // state here holds to the same <= 2 as the main matrix.
  //
  // If a state fails on first run, measure it before writing any number down
  // -- never fabricate a 'measured' line (the four-requirement protocol the
  // planet arbiter comment records above).
  for (const lat of [-90, -45, 0, 45, 90]) {
    for (const zoom of [0.01, 0.5, 1]) {
      it(`mercator lat ${lat} zoom ${zoom}`, async () => {
        const diff = await renderBothBackends(
          { povLatitude: lat, povLongitude: 30 },
          { kind: 'mercator', zoom, extent: [1, 1] }
        )
        expect(
          diff.max,
          `worst channel ${diff.max} at (${diff.x}, ${diff.y}): ` +
            `webgpu ${JSON.stringify(diff.a)} vs webgl2 ${JSON.stringify(diff.b)}`
        ).toBeLessThanOrEqual(2)
      })
    }
  }
})
```

- [ ] **Step 3: 仲裁腿（第三意见）**

现有 describe 内、planet 仲裁测试（`:106-134`）之后加，初始 pin 3（与 cylindrical 同级：mercator 的逐片元链是 atanh/tanh/asin 三个超越函数 + 1×1 extent 窄采样，不比 cylindrical 长；**注释按 planet 腿的四要求协议写，measured 一行首次跑时用实测值填，禁止编造**）：

```ts
  it('the CPU reference arbitrates mercator too, at a tilted pose', async () => {
    // The mercator-camera spec's acceptance criterion is gate C three-way
    // agreement, so the arbiter leg is not optional for this camera: a pair
    // of shaders agreeing on a wrong mercator transcription has no third
    // opinion without it. State 1 (lat 30) keeps the pose non-trivial.
    //
    // Tolerance, per the four requirements (fill 'measured' from the first
    // probe run on this machine's GPU -- do NOT guess it):
    // - measured: webgpu <FILL>, webgl2 <FILL>, probe run of this file
    //   (2026-09-29); the pin is not a guess;
    // - derived: the per-fragment chain is atanh/tanh/asin -- three f32
    //   transcendentals over a 1x1 extent's narrow sample, the same class
    //   of cost as cylindrical's pin (<= 3) above, with no Mobius division
    //   and no second atan;
    // - bounded: 3, matching the cylindrical pin the chain is comparable
    //   to; raise only with a measured reason recorded here;
    // - headroom: the shared bilinear fetch's quantized hardware weights
    //   are most of the distance between the shaders and float64, the same
    //   argument as the cylindrical leg.
    const s = STATES[1]!
    const r = await compareWithReference(state(s), projectionFor('mercator', s))

    expect(r.webgpu).toBeLessThanOrEqual(3)
    expect(r.webgl2).toBeLessThanOrEqual(3)
  })
```

首跑时把 `<FILL>` 换成实测值（临时 `console.log(r)` 或让断言消息报出）。若实测 > 3，按四要求重推界并在注释里记录推导，不许静默放水。

- [ ] **Step 4: 跑测试**

Run: `npx vitest run --project integration test/integration/gate-c-cross-backend.test.ts`
Expected: 全绿——4 状态主矩阵 mercator、15 态扫描、极点 89.5、仲裁腿三方一致。

- [ ] **Step 5: Commit**

```bash
git add test/integration/gate-c-cross-backend.test.ts
git commit -m "task-mercator-camera: gate C sweeps mercator states and arbitrates

Main matrix, the spec's lat x zoom sweep including exact poles, and a
third-opinion leg against the float64 reference with the
four-requirement tolerance protocol.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: demo lab 三处

**Files:**
- Modify: `demo/lab/panels/camera.ts:15`
- Modify: `demo/lab/context.ts:58-62`
- Modify: `demo/lab/main.ts:58-59`

- [ ] **Step 1: 三处加宽**

`panels/camera.ts:15`：

```ts
const KINDS: ReadonlyArray<ProjectionKind> = ['linear', 'cylindrical', 'planet', 'pannini', 'mercator']
```

（每个 kind 的面板状态是 per-kind Map，zoom/extent 滑条对非线性 kind 通用——mercator 进了 KINDS 和 defaultProjection 就自动工作。）

`context.ts` `defaultProjection` 的 extent 三元（doc 注释同步：1×1 是 cylindrical 与 mercator，4×4 是 planet/pannini，mercator 的 1×1 来自 2026-09-29 spec §2.3）：

```ts
  const extent = kind === 'cylindrical' || kind === 'mercator' ? 1 : 4
```

`main.ts` readUrlState 的 kind 白名单（`:58-59`）：

```ts
  const kind = (['linear', 'cylindrical', 'planet', 'pannini', 'mercator'] as const).find(k => k === kindParam) ?? 'linear'
```

（照抄该行现有写法，只往数组里加 `'mercator'`。）

- [ ] **Step 2: 类型检查 + 手动冒烟**

Run: `npm run typecheck`
Expected: 绿（demo 在根 tsconfig 程序内）。

Run: `npm run start`，浏览器开 `http://localhost:5173/?projection=mercator`
Expected: lab 以 mercator 打开；相机面板可选 mercator；zoom/extent 滑条工作；垂直拖拽内容跟手（高纬不压扁）；URL 直达生效。截图留到 Task 14。看完停掉 dev server。

- [ ] **Step 3: Commit**

```bash
git add demo/lab/panels/camera.ts demo/lab/context.ts demo/lab/main.ts
git commit -m "task-mercator-camera: mercator in the demo lab

KINDS, the default-projection extent ternary, and the URL kind list;
the generic zoom/extent sliders carry it from there.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 13: README

**Files:**
- Modify: `README.md:93-98`（相机表）、`:153-168`（投影节）

- [ ] **Step 1: 相机表加行**

`camera.projection` 的 kind 表 pannini 行之后加（spec §6 逐字）：

```markdown
| `'mercator'` | `zoom` (0.01–1), `extent` (1×1) | Conformal cylinder — uniform scale everywhere, poles at infinity. |
```

（列结构与既有行严格对齐——先看 pannini 行再写。）

- [ ] **Step 2: "The four projections" 节改五**

标题 `## The four projections` → `## The five projections`；正文 `the four cameras differ` → `the five cameras differ`、`All four below are the same source` → `All five below are the same source`；截图表改三列两行：

```markdown
| | | |
|---|---|---|
| `linear` | `cylindrical` | `planet` |
| ![linear](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/linear.png) | ![cylindrical](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/cylindrical.png) | ![planet](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/planet.png) |
| `pannini` | `mercator` | |
| ![pannini](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/pannini.png) | ![mercator](https://raw.githubusercontent.com/yusangeng/pano.gl/master/demo/shots/mercator.png) | |
```

（`mercator.png` 由 Task 14 产出；README 插图非门禁物，本任务先行引用。）

rule-of-thumb 段末补一句：

```markdown
`mercator` when every latitude must share one scale — the map look, poles
pushed to infinity.
```

- [ ] **Step 3: 校验脚本**

Run: `node scripts/check-readme-options.mjs`
Expected: 绿（该脚本只校验 options 表 vs `options.ts`，本任务不触它的管辖，跑它是防手滑）。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "task-mercator-camera: document mercator in the README

Kind-table row, the five-projection gallery (3+2) and the
uniform-scale rule of thumb.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 14: lab 截图 + 全量核验

**Files:**
- Create: `demo/shots/mercator.png`（800×450，与既有四张同规格）

- [ ] **Step 1: 截图**

Run: `npm run start`，浏览器（本仓库规则：网页浏览走 `/browse`）开 `http://localhost:5173/?projection=mercator`，视口/截取 800×450（与 `demo/shots/` 既有四张一致：同一源、zoom 1、默认姿态）。保存为 `demo/shots/mercator.png`。

浏览器截图在本环境不可得时：在任务卡「完成报告」写明偏离（README 插图非门禁物），保留 README 引用，跳过本步。

- [ ] **Step 2: 全量核验（顺序不可换：gen 在最前）**

```bash
npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
```

Expected: 全绿。coverage 的 90% 分支门槛不变——新增纯函数（`classifyDragMercator`、`panMercator`、`projectMercator`）已被 Task 2/5/7 全覆盖，预期净增不降。

- [ ] **Step 3: Commit**

```bash
git add demo/shots/mercator.png
git commit -m "task-mercator-camera: mercator lab shot

800x450 from the demo lab at zoom 1, matching the other four.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

（若 Step 1 跳过且无文件可提交，改为 `git commit --allow-empty` 记录核验结论，message 写明 `task-mercator-camera: full verification green (no shot: <reason>)`。）

---

## 收尾（执行侧）

1. 逐 Task 勾选本 plan 的 checkbox。
2. 三轮整改循环 + `task-finish`（六连查）——见任务卡与 superloop-work skill；**禁用 finishing-a-development-branch**。
3. 完成报告写进任务卡「完成报告」节：做了什么 / 自测结果（贴全量核验输出摘要）/ 偏离 plan 的点（预期偏离：gate C 仲裁腿的 measured 实测值、README 截图可得性）/ 遗留风险。

## Spec 覆盖对照（审查用）

| spec 条目 | 落点 |
|---|---|
| §2.1 公式三家同形 | Task 1（reference）、Task 3（WGSL）、Task 4（GLSL） |
| §2.2 I1–I6 | Task 2（逐条单测） |
| §2.3 K=2π / 85.051° / 屏沿 v | Task 2（zoom-edges pin）、Task 5（满屏 2π 米） |
| §2.4 asin(tanh) vs exp | Task 2（gd 恒等 pin）、Task 3/4（公式注释）、Task 4（结构 pin） |
| §2.5 极点数值行为 | Task 2（±90 → v 0/1）、Task 7（吸收性）、Task 10（退化屏） |
| §3 常量管线单源 | Task 1 |
| §4 拖拽四处落点 | Task 5/6/7/8 |
| §5 测试矩阵 7 行 | Task 2（reference）、Task 5（gestures）、Task 7（camera-controller）、Task 1（constants）、Task 10（gate B）、Task 11（gate C）、Task 9（用户故事）+ Task 8（端到端补充） |
| §6 demo lab + README | Task 12、Task 13、Task 14 |
| §7 非目标 | File Structure 节末的「不动的文件」清单 |
| §8 落点 18 路径 | File Structure 地图全覆盖 + 三处 spec 未列的实勘补充：`demo/lab/main.ts`（URL 白名单）、`test/unit/shaders.test.ts`（dispatch pin）、`test/unit/webgl2-shaders.test.ts`（token 守望） |
