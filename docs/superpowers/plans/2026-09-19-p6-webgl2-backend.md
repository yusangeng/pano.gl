# P6 — WebGL2 backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

> **（2026-09-20 登记，P1 终末全分支审查 MINOR 6；协调侧预补）**：`CLAUDE.md` 的 Commands 表与 Testing 节仍含 Playwright 时代的桥接写法（`npm run test:integration # playwright test`、`npx playwright test ...`、`playwright.config.ts`、`window.__panoTest` / `demo/test-entry-hooks`）。这些段落先于 P1 的 vitest 浏览器模式拍板、**已作废**：集成测试跑 vitest 浏览器模式、测试文件直接 import 被测代码、**没有桥**。本期的命令与测试约定（含门禁 C 的写法与 `no-webgpu` project 的用法）以本 plan 与任务卡为准，不以 CLAUDE.md 为准。CLAUDE.md 头部告示覆盖的是「还没造」，不覆盖「已废弃且现在要做相反的事」；该文件的重写归 P7 Task 4。

> **（2026-09-20 登记，P1 终末复审补遗 S1；协调侧预补）**：P1 已把库打包器从 tsup 裁决换为 **vite lib mode**（`build` = `vite build`，仓库无 tsup / tsup.config.ts——本文旧版「P1 创建 tsup.config.ts」的前提为假，P1 创建的是 `vite.config.ts`）。本文凡涉及 tsup / `tsup.config.ts` / esbuild `?raw` 插件处均已按此勘误：`?raw` 是 Vite 原生约定，vitest、demo 与 `vite build`（lib mode）**全部直接支持，构建侧零配置**；构建侧验证 = `npm run build` 后 grep dist（Task 1 Step 5）。

**Goal:** 第二个后端。四个投影在 WebGL2 下与 WebGPU 逐像素一致（门禁 C），P5 的全部用户故事在 WebGL2 下同样通过。

**Architecture:** 同一个 `Backend` 接口的第二个实现。**着色器是转写的，不是生成的** —— 四个投影公式在两份源码里各写一遍，门禁 C 是它们不漂移的唯一保证。

**Tech Stack:** WebGL2 / GLSL ES 3.00 · vitest 浏览器模式

---

## 先想清楚：这个后端值不值

WebGL2 后端是**永久的第二份实现**：第二个着色器、第二套资源生命周期、第二个要跟着改的地方。每个投影 bug 现在有两个可能的位置。

**为什么还是要做：** Safari 的 WebGPU 支持起步晚，而 360 全景的主要消费场景之一是移动端。没有 WebGL2 就无法覆盖。

**但要明确它的定位：** WebGL2 是**降级路径**，不是对等路径。所以 ——

- **不加 WebGL2 独有的功能**，`Backend` 接口不为它做任何妥协
- 它的验收标准是「与 WebGPU 一致」，不是「性能好」
- 它**不参与**新功能的开发，功能只在 WebGPU 侧先做

**如果哪天移动端 WebGPU 普及到不需要它了，删掉它是允许的**，因为它没有污染接口。

---

## 前置依赖（开工前确认）

开工前逐条确认。**每一条都是别人产出的东西，缺一条就在这里停下，不要在本计划里绕过去。**

| 依赖 | 出自 | 为什么必须先在 |
|---|---|---|
| `RenderableSource` | P3 Task 1，`src/renderer/backend.ts` | 后端 `setSource` 的参数类型。**它的形状是 `{ state: SourceState, kind, element, version }`，`projection` 在 `state` 里面** —— 直接读 `source.projection` 是编译错误 |
| `describeCapabilities` | P3 Task 1，`src/renderer/capabilities.ts` | 能力上报的唯一入口。**不要在这里重写它的钳位规则**，见下面「能力上报」 |
| `PANORAMA_WGSL` 的**最终**形态 | P3 Task 3 + Task 8 Step 3 | P3 的 Task 8 会给三个非线性投影的 `phi` 加 `- lat` 并同步改 `src/core/reference.ts`。**转写 Task 3 的中间版本会漏掉纬度**，门禁 C 在非零纬度上立刻红 |
| `src/core/reference.ts` | P2，P3 Task 8 Step 3 同步 | 门禁 C 的裁判。它必须和着色器同步读到 `povLatitude`，否则裁判自己就是错的 |
| `?raw` 着色器导入通道 | P3 Task 3 的说明 + 本计划 Task 1 | `?raw` 是 Vite 的原生约定，vitest、demo 与 `vite build`（lib mode）均直接支持，**构建侧零配置**；Task 1 Step 5 的「build 后 grep dist」把源码进产物钉成断言，防的是配置回归 |
| P1 的 `integration` / `no-webgpu` 两个 project 与它们的守卫 | P1 Task 8 | 门禁 C 与后端冒烟测试都要求真适配器，由 `integration` 的 `require-webgpu.ts` 保证；降级测试跑在 `no-webgpu` 里，由 `require-no-webgpu.ts` 保证它**真的**没有适配器 |
| `extent` 由调用方给 | P2 | `Projection` 的非线性分支带 `extent`（圆柱 1×1，planet/pannini 4×4）。它不在几何里，也不由后端推导 |
| 浏览器模式的测试写法 | P3 / P4 / P5 | 测试文件本身就在页面里，直接 `import` 被测代码。**没有页面侧出口、没有 hook、没有 `window.__panoTest`** —— 本计划的 Task 3/4/6 全部照此办理 |
| `renderOffscreen` / `maxChannelDiff` / `RenderRequest` / `RenderResult` | P3 Task 3，`test/integration/support/gpu.ts` | 门禁 C 的 WebGPU 半边、请求/响应类型与差值计算都用它们。**门禁 C 的主张是关于出厂着色器的，所以 WebGPU 侧必须走出厂路径**，而不是一个为了对上这个测试而写的 harness |
| `support/canvas.ts` | P1 Task 8 | `readCanvas` / `nextFrames` / `countNonBlack` / `maxChannelDiff`。**P6 不重写它们**，`support/gpu.ts` 已经把 `maxChannelDiff` 转口自这里 |
| P5 的四个用户故事文件 | P5 Task 5 | Task 5 让它们在 WebGL2 下重跑。四个文件**除 photo 的后端标签断言外一字不改**——那一条的期望值改为从浏览器实际状态推导（推导不是分叉：两个 project 跑同一段代码，各自算出各自的真值），其余改的是 project 的 `include` |
| P5 的 `test/integration/fallback/user-story-no-webgpu.test.ts` | P5 Task 5 | Task 5/6 把它翻成 WebGL2 的正面断言，并补两种更极端的环境 |

**关于依赖顺序：`support/canvas.ts` 是 P1 建的，`support/gpu.ts` 是 P3 建的，`support/spies.ts` 与 `support/viewer.ts` 是 P5 建的。** P6 只新建 `support/cross-backend.ts`，其余四个是**扩**，不是重写。

**关于 `Backend` 接口：P6 不改它。** `onDeviceLost (fn: (lost: DeviceLost) => void): () => void` 已经由 P3 Task 1 声明（含「重复注册即替换、返回的退订函数只在自己仍是当前观察者时生效」的语义），P6 是**实现**方。如果开工时发现接口上没有它，停下并上报 —— 接口属于 P3。

**接口的一个硬约束要提前知道：** `setSource` 的文档要求实现**不得在本次任务之后保留 `source.element`**。这直接决定了 WebGL2 在上下文恢复后**无法自动重画**（没有源元素可重新上传），本计划 Task 3 把它写成了明确的限制，而不是假装恢复了。

---

## 关键设计决定：不共享 uniform 布局

**WebGL2 用具名 uniform（`getUniformLocation`），不复用 `CAMERA_UNIFORM_LAYOUT`。**

这个决定**由本计划做出**，P3 的交接表已经不把布局交给 P6（`CAMERA_UNIFORM_LAYOUT` 那一行被划掉，并注明「见 P6 的说明」）。两边没有分歧，也不需要谁更正谁 —— 只是一个决定写在一个地方。

| | WebGPU | WebGL2 |
|---|---|---|
| 传参方式 | 一个 96 字节的 uniform block | **7 条 `uniform` 声明**（6 个值 + 1 个 sampler），各自 `getUniformLocation` |
| 布局 | 紧凑标量（P3 Task 6 用往返测试钉死） | **不适用** |
| 若改用 UBO | —— | 偏移与上面**恰好相同**，总大小 96 字节 |

> **7，不是 8。** 本文曾写「8 个具名 uniform」，那是照着错的 std140 规则数出来的：`mat4` + 5 个标量 + 采样器 = 7 条声明（`u_invClip` / `u_projKind` / `u_texProjKind` / `u_povLatitude` / `u_povLongitude` / `u_zoom` / `u_tex`）。Task 1 的测试逐条列出这 7 个名字，`UNIFORM_NAMES` 也必须是这 7 个 —— 任何一处数错，`getUniformLocation` 都会返回 `null`，然后本计划的实现当场抛异常。

**为什么「恰好相同」却不这么做：**

- std140 的标量对齐是**它自身的大小**（4 字节），只有数组与结构体才向上取整到 16。**「std140 里每个标量独占 16 字节」是错的**，曾写在本文里，照着它算出来的「192 字节」也是错的。按真规则，`mat4` 之后的五个标量落在 64/68/72/76/80，块大小向上补到 16 的倍数即 96 —— 和 WGSL 的紧凑布局一致。
- 但**规则集仍然不是同一套**（std140 对 `vec3` 与数组有自己的取整规则，WGSL 的 uniform 地址空间对数组元素步长另有要求）。今天这份 struct 恰好一致，是巧合，不是保证；将来加一个字段就可能不一致，而且**不一致不会报错**。
- UBO 在这里**换不到任何东西**：一帧一次 draw call，一个 block。它要多一个 buffer、一次 `bindBufferBase`、一套绑定点的生命周期。
- 具名 uniform **会在错的时候报错**：`getUniformLocation` 返回 `null`，本计划的实现当场抛异常。UBO 的偏移写错则是静默读到垃圾 —— 那正是 P3 要为 WGSL 补往返测试的原因。

所以：

- WebGL2 走 `gl.uniformMatrix4fv` / `gl.uniform1i` / `gl.uniform1f`，各写各的
- **共享的是四个投影公式的语义，不是它们的存储方式**
- 门禁 C 比对**渲染结果**，不是 uniform 流

> **副作用（好的）：** 「两个后端的偏移不一致」这一整类 bug 从结构上消失了。

---

## 深度约定在哪一层

**WebGL2 的 ndc z ∈ [-1, 1]，WebGPU 的 ∈ [0, 1]。** 差别只在 CPU 侧建矩阵时：

- WebGL2：`buildCameraTransform(state, projection, 'minus-one-to-one', out)`
- WebGPU：`buildCameraTransform(state, projection, 'zero-to-one', out)`

**两边都用 `DepthRange` 的字面量，不要写 `'gl'` / `'zo'`** —— 那个拼法不属于任何类型，写出来就编译不过（这句话是有来历的：本条曾以 `'gl'` 的形式出现在本文的代码里）。

**片元着色器不需要知道** —— 两个约定下 far 平面都在 ndc z = +1，所以片元里那句 `invClip * vec4(ndc, 1.0, 1.0)` 两边都成立。**这是 P3 那个设计留给 P6 的礼物，不要在这里改掉。**

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/renderer/webgl2/shaders/panorama.glsl` | GLSL ES 3.00 的片元（转写自最终的 WGSL） |
| `src/renderer/webgl2/shaders/index.ts` | 拼接生成的常量 + 顶点源码 + `#version` 头 |
| `src/renderer/webgl2/context.ts` | 取上下文、编译、链接、错误检查 |
| `src/renderer/webgl2/backend.ts` | `Backend` 的 WebGL2 实现 |
| `test/integration/support/cross-backend.ts` | 门禁 C 的全部工具：源图、GLSL 离屏渲染、CPU 裁判、差值定位（Task 4） |
| `test/integration/webgl2-smoke.test.ts` | 后端自身的冒烟 + 上下文丢失/恢复（Task 3） |
| `test/integration/gate-c-cross-backend.test.ts` | **门禁 C**（Task 4） |
| `test/integration/backend-downgrade.test.ts` | 「没有 `navigator.gpu`，有 WebGL2」（Task 6，跑在 `integration` project 里，靠掩码造出该环境） |
| `test/integration/fallback/backend-unavailable.test.ts` | 「两个后端都没有」（Task 6，跑在 `no-webgpu` project 里） |

**Modify：**

| 文件 | 改动 | 归属 |
|---|---|---|
| `src/viewer/backend-factory.ts` | `createBackend` 加 WebGL2 分支；`probe()` 在无适配器分支读 `MAX_TEXTURE_SIZE`（Task 3，FIX 2） | P5 |
| `test/integration/support/spies.ts` | `countDraws` 同时包住两个后端的 `render`（Task 5） | P5 |
| `vitest.config.ts` | `no-webgpu` project 的 `include` 扩到四个用户故事（Task 5） | P1 |
| `test/integration/fallback/user-story-no-webgpu.test.ts` | 翻成 WebGL2 的正面断言（Task 5） | P5 |

**P5 的四个用户故事文件（photo / video / camera-switch / media-failure）不需要改一个字。** 见 Task 5。

> **本计划不建任何页面侧出口。** `demo/` 一个字节都不改 —— 那套 `demo/test-entry-hooks/*` / `window.__panoTest` 在 P3 换成浏览器模式时已经删掉了，P6 不把它长回来。**如果你发现自己正在写一个 hook 文件，那是走错路了**：浏览器模式下 `import` 就是全部。

---

### Task 1: GLSL ES 3.00 着色器

**Files:**
- Create: `src/renderer/webgl2/shaders/panorama.glsl`
- Create: `src/renderer/webgl2/shaders/index.ts`
- Test: `test/unit/webgl2-shaders.test.ts`

- [x] **Step 1: 转写**

`src/renderer/webgl2/shaders/panorama.glsl`：

```glsl
// pano.gl panorama shader, WebGL2 backend.
//
// A line-by-line transcription of src/renderer/webgpu/shaders/panorama.wgsl as
// it stands AFTER P3's Task 8 -- that is, including the `- lat` term the three
// non-linear projections gained when latitude stopped being ignored (defect
// F5). Transcribing the earlier version of that file loses the latitude term,
// and gate C fails on every state whose povLatitude is not zero.
//
// Transcribed by hand rather than generated: the two languages differ enough
// that a translator would be a project of its own, and a translator that got
// the projections subtly wrong would be worse than two files a human can read
// side by side.
//
// The cost of hand transcription is drift. Gate C is what prevents it: every
// camera state is rendered through both backends and the pixels are compared.
// If you change a formula here, change it in the WGSL too, and check
// src/core/reference.ts -- the CPU reference is the arbiter when the two
// backends disagree.
//
// THREE THINGS IN THIS FILE LOOK WRONG AND ARE NOT. Each has already been
// wrong once, which is why each has a test that names it:
//
//   1. `to_uv` has no `+ 0.5`. Adding one rotates the panorama half a turn.
//   2. `to_uv` flips v (`1.0 - phi / PI`). Removing the flip renders it upside
//      down.
//   3. No `atan2` anywhere, and no `theta -= lng` with a converted longitude.
//      The quadrant fixups and the `povLongitude / 4.0` are transcriptions of
//      v0.2.2, bugs included. See the comments at each site.
//
// WHAT IS *NOT* SHARED: the uniform layout. WebGPU packs the camera into one
// 96-byte block; WebGL2 uses named uniforms. The semantics are shared, the
// storage is not. See the plan's "关键设计决定".
//
// The fragment stage inverts the camera matrix to recover the surface point the
// legacy rasteriser would have interpolated. Both depth conventions put the far
// plane at ndc z = +1, so this file does not need to know which convention
// built the matrix.

// `#define CAMERA_PROJECTION_*` and `#define TEXTURE_PROJECTION_EQUIRECTANGULAR`
// are prepended above this file by shaders/index.ts, generated from
// src/core/projection-kinds.json. They are the only place those numbers appear;
// there is no numeric literal for a projection kind anywhere below.

precision highp float;
// Not required by ES 3.00 in the fragment stage, but the projection codes are
// integers compared against the generated `#define`s, and that comparison has
// exactly one correct outcome. Pinning the precision removes one variable.
precision highp int;

// Interpolated from the vertex stage rather than derived from gl_FragCoord:
// the builtin is in framebuffer pixels, which would need the viewport size,
// which would mean another uniform and a resolution-dependent bug class.
in vec2 v_ndc;

uniform mat4 u_invClip;
uniform int u_projKind;
uniform int u_texProjKind;
uniform float u_povLatitude;
uniform float u_povLongitude;
uniform float u_zoom;

uniform sampler2D u_tex;

out vec4 outColor;

const float PI = 3.141592653589793;
const float HALF_PI = 1.5707963267948966;
const float TWO_PI = 6.283185307179586;

// Equirectangular coordinate from an angle pair.
//
// `mod` here does the same job as the WGSL's `fract` -- it folds u into
// [0, 1) -- and no more. The legacy shader did none of even that: it handed
// texture2D a raw ratio and the texture object's default REPEAT wrap did the
// work. The cross-seam and cross-pole LINEAR blend is likewise the sampler's,
// not this function's, and clamp-to-edge cannot express it. On WebGPU the
// still sampler is REPEAT on both axes for exactly that blend (see
// src/renderer/webgpu/shaders/sampler.ts; gate A measured the seam blend at
// up to 124 LSB), while WebGPU video is edge-clamped by
// textureSampleBaseClampToEdge whatever the sampler's modes say -- an API
// limit of its entry point, not a decision to treat video differently. The
// WebGL2 sampler modes are Task 3's to set, and they must match WebGPU per
// source kind: still textures REPEAT on both axes, video clamp-to-edge.
//
// `mod` is x - y * floor(x / y), the same function as WGSL's `fract` for a
// divisor of 1.0. WGSL's `%` is NOT the same (it truncates toward zero) and
// would put a seam in the panorama wherever theta is negative. If you copy this
// line back to the WGSL, `fract` is the one to use.
//
// v is FLIPPED. The legacy upload set UNPACK_FLIP_Y_WEBGL, so its sampler read
// a vertically mirrored image compared with the source file. P3 decided the
// flip lives in the shader once, for every source path, so the two backends
// cannot disagree about it -- which means this backend uploads with
// UNPACK_FLIP_Y_WEBGL explicitly false (see backend.ts) and reverses the flip
// here. Removing it from one side only flips the picture, and removing it from
// both would break gate A against the baseline.
vec2 to_uv (float theta, float phi) {
  return vec2(mod(theta / TWO_PI, 1.0), 1.0 - phi / PI);
}

// The linear (perspective) projection. Scale-invariant -- every term is a
// ratio, which is why the cube could be replaced by a triangle.
//
// `atan(s.z / s.x)` plus the fixups is deliberately NOT `atan(s.z, s.x)`. The
// two agree here, but the same shape is load-bearing in project_pannini, where
// they do not, and keeping all four projections in the reference's shape is
// what makes the two files readable side by side.
vec2 project_linear (vec3 s) {
  float theta = atan(s.z / s.x);

  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  float phi = atan(s.y / sqrt(s.x * s.x + s.z * s.z)) + HALF_PI;
  return to_uv(theta, phi);
}

// The three non-linear projections read the MAGNITUDE of their input, so the
// size of the surface being projected is part of the projection. That size
// lives in the camera matrix (see `buildProjection` in src/core/matrix.ts) and
// arrives here already baked into `s`; this file never sees an extent.
//
// `lng` and `lat` are in RADIANS and are already the values the formulas
// consume. The degree conversion, and the `/ 4.0` that is NOT a degree
// conversion, happen at the call site in main().

vec2 project_cylindrical (vec3 s, float zoom, float lng, float lat) {
  // `s.x` is deliberately unread, exactly as in the WGSL and in the legacy
  // shader, where the quad pinned it at 1.
  float y = s.y * zoom;
  float z = s.z * zoom;

  float theta = z * TWO_PI - lng;
  float phi = atan(y) + HALF_PI - lat;
  return to_uv(theta, phi);
}

vec2 project_planet (vec3 s, float zoom, float lng, float lat) {
  float y = s.y * zoom;
  // The negation is in the WGSL and in the legacy shader, and it is easy to
  // drop. Without it the planet projection renders mirrored and inside out.
  float z = -(s.z * zoom);

  float m = 1.0 + z * z + y * y;

  float p = (2.0 * z) / m;
  float q = (2.0 * y) / m;
  float r = (m - 2.0) / m;

  float theta = atan(p / q);

  if (q < 0.0) {
    theta = PI + theta;
  } else if (q > 0.0 && p < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  float phi = atan(r / sqrt(p * p + q * q)) + HALF_PI - lat;
  return to_uv(theta, phi);
}

vec2 project_pannini (vec3 s, float zoom, float lng, float lat) {
  float y = s.y * zoom;
  float z = s.z * zoom;

  // `z * 0.5 / s.x`, not `z * 0.5 * s.x`. This is the only term in any of the
  // four projections that reads the magnitude of x rather than its ratio, and
  // it is why the reconstruction has to recover x = 1 exactly instead of some
  // far-plane distance. See buildProjection in src/core/matrix.ts.
  float theta = 2.0 * atan((z * 0.5) / s.x);

  // These fixups test x and z AFTER theta has been doubled. `atan(z * 0.5 *
  // zoom, s.x) * 2.0` is not the same function: the two-argument atan is
  // quadrant-correct before the doubling, this one after.
  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  float phi = atan(y / sqrt(s.x * s.x + z * z)) + HALF_PI - lat;
  return to_uv(theta, phi);
}

void main () {
  // Recover the surface point the legacy rasteriser would have interpolated.
  //
  // The 1.0 in the z slot: both depth conventions put the far plane at ndc
  // z = +1, and the camera matrix is built so that inverting it there lands on
  // the legacy surface -- the far plane for the linear camera, whose direction
  // is all that matters, and exactly (1, y, z) for the other three, because
  // their ortho projection is built with far = 1. Do not change this to 0.0 for
  // WebGL2: the matrix was built with the GL convention, where the far plane is
  // at +1 just as it is under the ZO convention.
  vec4 homogeneous = u_invClip * vec4(v_ndc, 1.0, 1.0);
  vec3 surface = homogeneous.xyz / homogeneous.w;

  // `CameraState.povLongitude` is in DEGREES. The legacy shader declared
  // `float lng = u_CamPOVLongitude / 2.0` at file scope and each non-linear
  // projection then subtracted `lng / 2.0`, so what actually came off a radian
  // angle was `povLongitude / 4` -- degrees subtracted from radians. That is a
  // bug in v0.2.2, reproduced on purpose: the acceptance criterion is "renders
  // what v0.2.2 rendered", and correcting it changes panning sensitivity, which
  // v1 deliberately does not do -- recorded as a retention in spec §11.4 (B1),
  // which is where this note, P3's WGSL copy and `lngOffset()` in
  // src/core/reference.ts all point.
  //
  // `/ 4.0`. NOT `* PI / 180.0`. The two differ by a factor of about 29, and
  // the wrong one still renders a plausible-looking panorama.
  float lng = u_povLongitude / 4.0;

  // Latitude, by contrast, IS converted and used. The legacy non-linear cameras
  // ignored it completely (defect F5: the uniform was declared and never read,
  // and the inner ortho camera was built with latitude 0 and never updated).
  // P3's Task 8 turns that into a deliberate, separately tested behaviour
  // change, in the WGSL and in the reference at the same time. Both shaders
  // carry the `- lat` term; neither carries it alone.
  float lat = u_povLatitude * PI / 180.0;

  vec2 uv;
  // An if-chain rather than a switch. ES 3.00 does support switch, but the case
  // labels must be constant integral expressions and these constants arrive as
  // preprocessor #defines, which is a portability hazard across drivers. Four
  // branches on a uniform value, once per pixel: the cost is nil.
  if (u_projKind == CAMERA_PROJECTION_LINEAR) {
    uv = project_linear(surface);
  } else if (u_projKind == CAMERA_PROJECTION_CYLINDRICAL) {
    uv = project_cylindrical(surface, u_zoom, lng, lat);
  } else if (u_projKind == CAMERA_PROJECTION_PLANET) {
    uv = project_planet(surface, u_zoom, lng, lat);
  } else if (u_projKind == CAMERA_PROJECTION_PANNINI) {
    uv = project_pannini(surface, u_zoom, lng, lat);
  } else {
    // Unreachable: u_projKind comes from cameraProjectionCode() and the values
    // are generated from the same JSON the #defines are. The fallback exists
    // because a black panorama is better than a chromatic one, and it is the
    // same fallback the WGSL uses.
    uv = vec2(0.0, 0.0);
  }

  // The source's own projection. Only equirectangular exists today; a second
  // kind goes here, and the value is already uploaded so no CPU change is
  // needed to add one.
  if (u_texProjKind != TEXTURE_PROJECTION_EQUIRECTANGULAR) {
    uv = vec2(0.0, 0.0);
  }

  outColor = texture(u_tex, uv);
}
```

`src/renderer/webgl2/shaders/index.ts`：

```ts
/**
 * Assembles the GLSL program sources.
 *
 * `#version` must be the very first thing in a shader source, before even a
 * comment, so the generated constants and the body are joined after it rather
 * than prepended to it. A source that starts with a comment and then `#version`
 * is a compile error whose message does not mention ordering.
 *
 * The constants come from the same generator as the WGSL ones
 * (scripts/gen-shader-constants.mjs reads src/core/projection-kinds.json), so
 * the numbers cannot drift even though the shader bodies are hand-transcribed.
 * GLSL gets them as `#define NAME value`, WGSL as `const NAME: u32 = valueu`,
 * which is why the JS side uploads an `int` here and a `u32` there.
 */

import { GLSL_CONSTANTS } from '../../shaders/generated'
import panoramaBody from './panorama.glsl?raw'

const VERTEX_SOURCE = `#version 300 es
${GLSL_CONSTANTS}
precision highp float;

out vec2 v_ndc;

void main () {
  // gl_VertexID is available in ES 3.00, so the fullscreen triangle needs no
  // vertex buffer, no attributes and no index buffer -- the same three corners
  // the WGSL vertex stage emits, in the same order. Nothing is bound to any
  // attribute, and there is no attribute to bind.
  vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  v_ndc = corners[gl_VertexID];
  gl_Position = vec4(v_ndc, 1.0, 1.0);
}`

const FRAGMENT_SOURCE = `#version 300 es
${GLSL_CONSTANTS}
${panoramaBody}`

export const PANORAMA_GLSL_VERTEX = VERTEX_SOURCE
export const PANORAMA_GLSL_FRAGMENT = FRAGMENT_SOURCE
```

- [x] **Step 2: （已随 tsup → vite 裁撤——读一遍本注即可，无代码要写）**

> **（2026-09-20 勘误，P1 终末复审补遗 S1）** 本步原为「在 `tsup.config.ts` 里加 esbuild 的 `?raw` resolve 插件」（原注的理由：esbuild 会把 `./panorama.glsl?raw` 当真实文件名去解析，造出 `npm run test:unit` 全绿而 `npm run build` 失败的失败顺序）。P1 已把库打包器裁决换为 **vite lib mode**（`build` = `vite build`，仓库无 tsup / tsup.config.ts），本步整体作废：`?raw` 是 Vite 的原生约定，vitest、demo 与 `vite build` 全部直接支持，**构建侧零配置**——不存在要写的插件，也不存在要建的 `tsup.config.ts`（更不要把 tsup 装回来）。防配置回归的构建侧验证保留在 Step 5。
>
> 仍然成立的那条告诫：**不要退回到把着色器内联进 TS**——那会牺牲着色器文件的语法高亮，而这是长期维护里最值钱的东西。

- [x] **Step 3: 写结构与一致性测试**

`test/unit/webgl2-shaders.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { PANORAMA_GLSL_VERTEX, PANORAMA_GLSL_FRAGMENT } from '../../src/renderer/webgl2/shaders'
import { PANORAMA_WGSL } from '../../src/renderer/webgpu/shaders'

/** The body of a `vec2 name (...)` function, or `fn name(` for the WGSL. */
function glslBody (name: string): string {
  const start = PANORAMA_GLSL_FRAGMENT.indexOf(`vec2 ${name} (`)
  expect(start, `${name} not found in the GLSL`).toBeGreaterThan(-1)
  return PANORAMA_GLSL_FRAGMENT.slice(start, PANORAMA_GLSL_FRAGMENT.indexOf('\n}', start))
}

function wgslBody (name: string): string {
  const match = PANORAMA_WGSL.match(new RegExp(`fn ${name}\\([\\s\\S]*?\\n\\}`))
  expect(match, `${name} not found in the WGSL`).not.toBeNull()
  return match![0]
}

/** Comments out, whitespace collapsed: the two languages' only shared vocabulary. */
function skeleton (source: string): string {
  return source
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join(' ')
}

describe('WebGL2 shader source', () => {
  it('starts with #version 300 es as the very first line', () => {
    // Anything before the directive -- a comment, a blank line, a generated
    // constant -- is a compile error whose message does not mention ordering.
    expect(PANORAMA_GLSL_VERTEX.startsWith('#version 300 es\n')).toBe(true)
    expect(PANORAMA_GLSL_FRAGMENT.startsWith('#version 300 es\n')).toBe(true)
  })

  it('declares a float precision in both stages', () => {
    // ES 3.00 requires an explicit float precision in the fragment stage.
    // Omitting it fails at link time with a message about the vertex shader.
    expect(PANORAMA_GLSL_FRAGMENT).toMatch(/precision\s+highp\s+float/)
    expect(PANORAMA_GLSL_VERTEX).toMatch(/precision\s+highp\s+float/)
  })

  it('declares exactly the uniforms the backend uploads', () => {
    // Six values and one sampler. A missing declaration is not an error at the
    // GL level: getUniformLocation returns null and the gl.uniform* call is
    // silently ignored, so the value stays at zero and the picture is wrong in
    // a way that looks like a projection bug. The backend throws on a null
    // location for that reason, and this test is what keeps the list the two of
    // them share honest.
    const declared = [...PANORAMA_GLSL_FRAGMENT.matchAll(/^uniform\s+\S+\s+(\w+)\s*;/gm)]
      .map(m => m[1])
      .sort()

    expect(declared).toEqual([
      'u_invClip', 'u_povLatitude', 'u_povLongitude',
      'u_projKind', 'u_tex', 'u_texProjKind', 'u_zoom'
    ])
  })

  it('uses the generated projection constants, not numeric literals', () => {
    // The legacy code maintained the same four numbers by hand in two files and
    // they agreed only by luck. A literal here is that defect coming back.
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_LINEAR')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_CYLINDRICAL')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_PLANET')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('CAMERA_PROJECTION_PANNINI')
    expect(PANORAMA_GLSL_FRAGMENT).toContain('TEXTURE_PROJECTION_EQUIRECTANGULAR')
    expect(PANORAMA_GLSL_FRAGMENT).not.toMatch(/projKind\s*==\s*\d/)
  })

  it('does not use WGSL syntax', () => {
    for (const pattern of [/@fragment/, /@vertex/, /@builtin/, /vec4f/, /mat4x4/, /\bfn\s+\w+\s*\(/]) {
      expect(PANORAMA_GLSL_FRAGMENT).not.toMatch(pattern)
      expect(PANORAMA_GLSL_VERTEX).not.toMatch(pattern)
    }
  })

  it('never adds 0.5 to the longitude', () => {
    // The single most tempting "fix" in this file. The legacy shader has no
    // +0.5, and adding one rotates the panorama half a turn -- which looks like
    // a texture-orientation problem and sends you looking in the wrong place.
    const body = skeleton(glslBody('to_uv'))
    expect(body).not.toMatch(/\+\s*0\.5/)
  })

  it('wraps u with mod and flips v, exactly as the WGSL does', () => {
    // mod(), not fract(): same function for a divisor of 1.0, and the one GLSL
    // has. The flip is the entire compensation for not setting
    // UNPACK_FLIP_Y_WEBGL on upload; dropping it renders the panorama upside
    // down and gate C would not catch it, because both shaders would still
    // agree about everything except the picture.
    const body = skeleton(glslBody('to_uv'))
    expect(body).toContain('mod(theta / TWO_PI, 1.0)')
    expect(body).toContain('1.0 - phi / PI')
  })

  it('applies the latitude term in all three non-linear projections', () => {
    // Defect F5. The legacy shader declared u_CamPOVLatitude and never read it,
    // and P3's Task 8 makes that a deliberate behaviour change. Copying the old
    // omission into the second backend would make the two backends disagree
    // only at non-zero latitude -- the hardest possible place to notice.
    for (const fn of ['project_cylindrical', 'project_planet', 'project_pannini']) {
      expect(skeleton(glslBody(fn)), `${fn} ignores latitude`).toMatch(/-\s*lat\b/)
    }
  })

  it('subtracts povLongitude / 4, not a converted angle', () => {
    // v0.2.2 subtracted degrees from radians, and the acceptance criterion is
    // "renders what v0.2.2 rendered". A degree conversion here is a real bug fix
    // and therefore not this phase's business: it changes panning sensitivity,
    // which is a user-visible decision that must not ride along with a port.
    const body = skeleton(PANORAMA_GLSL_FRAGMENT)
    expect(body).toContain('u_povLongitude / 4.0')
    expect(body).not.toMatch(/povLongitude \* PI \/ 180/)
  })

  it('uses no two-argument atan, in either source', () => {
    // atan(a, b) agrees with the fixups for linear and cylindrical and does NOT
    // agree for pannini, where the fixups run after theta is doubled. Both files
    // keep the fixups for that reason; a two-argument atan in either one is a
    // sign that someone "simplified" a projection.
    expect(PANORAMA_GLSL_FRAGMENT).not.toMatch(/atan\s*\([^)]*,/)
    expect(PANORAMA_WGSL).not.toMatch(/atan2\s*\(/)
  })

  it('transcribes the same four projection formulas as the WGSL', () => {
    // A structural check, not a numeric one: same call sites, same literal
    // vocabulary. It will not catch a wrong sign -- that is what gate C is for
    // -- but it catches the case where one file was edited and the other was
    // not edited at all, which is the actual failure mode of hand transcription.
    for (const [glslName, wgslName] of [
      ['project_linear', 'project_linear'],
      ['project_cylindrical', 'project_cylindrical'],
      ['project_planet', 'project_planet'],
      ['project_pannini', 'project_pannini']
    ] as const) {
      const glsl = skeleton(glslBody(glslName))
      const wgsl = skeleton(wgslBody(wgslName))

      const literals = (s: string) => (s.match(/\b\d+\.\d+\b/g) ?? []).sort()
      expect(literals(glsl), `${glslName} literals differ`).toEqual(literals(wgsl))
      expect(
        (glsl.match(/atan\(/g) ?? []).length,
        `${glslName} has a different number of atan call sites`
      ).toBe((wgsl.match(/atan\(/g) ?? []).length)
    }
  })
})
```

- [x] **Step 4: 跑测试**

Run: `npm run test:unit -- webgl2-shaders`
Expected: 11 个测试 PASS

- [x] **Step 5: 证明构建也认这份着色器**

`?raw` 的接线是否成立，单元测试证明不了 —— vitest 走 Vite，它当然认；`vite build`（lib mode）走的是同一个 Vite，但这一步把「着色器源码真的进了产物」钉成断言，防的是 lib mode 资源处理的配置回归：

```bash
npm run build
grep -c "#version 300 es" dist/index.js
```

Expected: 构建成功，`grep` 输出 ≥ 1（着色器源码真的进了产物，而不是被解析成外部资源引用）。

- [x] **Step 6: Commit**

```bash
git add src/renderer/webgl2/shaders/ test/unit/webgl2-shaders.test.ts
git commit -m "feat(renderer): GLSL ES 3.00 transcription of the panorama shader

Transcribed by hand from the post-Task-8 WGSL: the two languages are far
enough apart that a translator would be its own project, and a subtly wrong
translator is worse than two files a human can read side by side. Gate C is
what keeps them from drifting.

The ?raw suffix is Vite's native convention, so vitest, the demo and
vite build (lib mode) all read the file with no build-side plugin; the
dist grep pins that the shader source really lands in the bundle."
```

---

### Task 2: 上下文与程序

**Files:**
- Create: `src/renderer/webgl2/context.ts`
- Test: `test/unit/webgl2-errors.test.ts`

**背景**：WebGL 的错误模型和 WebGPU 相反 —— **同步、不抛、只设一个标志位**。`getShaderParameter(COMPILE_STATUS)` 返回 `false`，你必须主动去问。旧代码在这里 `log` 了一行然后 `return null`（缺陷 F7）。

- [x] **Step 1: 写失败测试**

`test/unit/webgl2-errors.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { compileShader, linkProgram, describeShaderError } from '../../src/renderer/webgl2/context'

// Both get*Parameter mocks ignore their pname, so a COMPILE_STATUS ->
// LINK_STATUS swap inside the implementation would still pass at unit level.
// That class of mistake is Task 3's real-GPU integration to catch; these
// tests pin the error protocol, not the enum choice.
function fakeGl (ok: boolean, log = '') {
  return {
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => ok),
    getShaderInfoLog: vi.fn(() => log),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => ok),
    getProgramInfoLog: vi.fn(() => log),
    deleteProgram: vi.fn()
  } as unknown as WebGL2RenderingContext
}

describe('compileShader', () => {
  it('returns the shader when compilation succeeds', () => {
    expect(compileShader(fakeGl(true), 0x8b31, 'void main(){}', 'vertex')).toBeTruthy()
  })

  it('throws with the driver log when compilation fails', () => {
    // The legacy createProgram logged and returned null. The caller then stored
    // null as the program and called useProgram(null) every frame: the viewer
    // constructed "successfully" and drew nothing, forever. A shader that will
    // not compile is not a viewer.
    expect(() => compileShader(fakeGl(false, 'ERROR: 0:12: syntax error'), 0x8b31, 'x', 'vertex'))
      .toThrow(/vertex.*0:12.*syntax error/s)
  })

  it('names which stage failed, because the driver log often does not', () => {
    // getShaderInfoLog for a vertex shader sometimes reports line numbers with
    // no indication of which source file they belong to.
    expect(() => compileShader(fakeGl(false, 'bad'), 0x8b31, 'x', 'vertex')).toThrow(/vertex/)
    expect(() => compileShader(fakeGl(false, 'bad'), 0x8b30, 'x', 'fragment')).toThrow(/fragment/)
  })

  it('deletes the shader it failed to compile', () => {
    // A failed compile still allocates a shader object. Leaking it per attempt
    // adds up across source swaps.
    const gl = fakeGl(false, 'bad')
    try { compileShader(gl, 0x8b31, 'x', 'vertex') } catch { /* expected */ }
    expect(gl.deleteShader).toHaveBeenCalled()
  })

  it('throws when the driver cannot allocate a shader object', () => {
    // createShader is allowed to return null, and handing that null onward
    // would only set the error flag nobody reads -- the exact failure mode
    // this file exists to close.
    const gl = { ...fakeGl(true), createShader: vi.fn(() => null) } as unknown as WebGL2RenderingContext
    expect(() => compileShader(gl, 0x8b31, 'void main(){}', 'vertex'))
      .toThrow('could not allocate a vertex shader object')
  })
})

describe('linkProgram', () => {
  it('returns the program when linking succeeds', () => {
    const gl = fakeGl(true)
    expect(linkProgram(gl, gl.createShader(0)!, gl.createShader(0)!)).toBeTruthy()
  })

  it('throws with the program log when linking fails', () => {
    expect(() => linkProgram(fakeGl(false, 'varying mismatch'), 0x8b31 as never, 0x8b30 as never))
      .toThrow(/link.*varying mismatch/s)
  })

  it('deletes both shaders after a successful link', () => {
    // deleteShader on an attached shader only flags it for deletion; the spec
    // frees it once nothing attaches it. The flags are what lets Task 3's
    // dispose -> deleteProgram actually release the pair, instead of leaking
    // two objects per backend teardown and rebuild.
    const gl = fakeGl(true)
    const vs = gl.createShader(0)!
    const fs = gl.createShader(0)!
    linkProgram(gl, vs, fs)
    expect(gl.deleteShader).toHaveBeenCalledWith(vs)
    expect(gl.deleteShader).toHaveBeenCalledWith(fs)
  })

  it('deletes both shaders and throws when the driver cannot allocate a program', () => {
    // The two shaders already exist by the time the program fails to
    // allocate, so cleaning them up is this function's job: the caller only
    // ever sees the throw. lib.dom types createProgram as never returning
    // null -- the spec disagrees, which is what the guard under test is for.
    const gl = { ...fakeGl(true), createProgram: vi.fn(() => null) } as unknown as WebGL2RenderingContext
    const vs = gl.createShader(0)!
    const fs = gl.createShader(0)!
    expect(() => linkProgram(gl, vs, fs)).toThrow('could not allocate a program object')
    expect(gl.deleteShader).toHaveBeenCalledWith(vs)
    expect(gl.deleteShader).toHaveBeenCalledWith(fs)
  })
})

describe('the (no log) fallback', () => {
  it('names the silence when either info log returns null', () => {
    // getShaderInfoLog and getProgramInfoLog may return null, and
    // stringifying that would print "null" where the diagnostic belongs.
    // Both throws name the silence with the same literal, so one mock
    // covering both logs pins both paths.
    const gl = {
      ...fakeGl(false),
      getShaderInfoLog: vi.fn(() => null),
      getProgramInfoLog: vi.fn(() => null)
    } as unknown as WebGL2RenderingContext
    expect(() => compileShader(gl, 0x8b31, 'x', 'vertex')).toThrow('(no log)')
    expect(() => linkProgram(gl, 0x8b31 as never, 0x8b30 as never)).toThrow('(no log)')
  })
})

describe('describeShaderError', () => {
  it('annotates a line number with the offending source line', () => {
    // The driver reports "0:12"; without the source line, finding it means
    // counting lines by hand in a generated string.
    const source = '#version 300 es\nline a\nline b\nline c\n'
    // Line 3 of the source (1-indexed) is "line b".
    const described = describeShaderError('ERROR: 0:3: something', source)
    expect(described).toContain('line b')
  })

  it('passes the log through unchanged when no line number is present', () => {
    expect(describeShaderError('no line info here', 'x')).toBe('no line info here')
  })

  it('does not throw on a line number past the end of the source', () => {
    // Generated constants are prepended, so drivers sometimes report a line
    // number from the pre-substitution source.
    expect(() => describeShaderError('ERROR: 0:9999: boom', 'short')).not.toThrow()
  })
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- webgl2-errors`
Expected: FAIL —— 无法解析 `../../src/renderer/webgl2/context`

- [x] **Step 3: 实现**

`src/renderer/webgl2/context.ts`：

```ts
/**
 * WebGL2 context acquisition and program compilation.
 *
 * WebGL's error model is the opposite of WebGPU's: synchronous, non-throwing,
 * and mostly silent. `compileShader` reports failure only through
 * `getShaderParameter(COMPILE_STATUS)`, and every other call sets an error flag
 * that nobody reads. There is no error scope to pop.
 *
 * So every failure point has to be asked about explicitly. This file is where
 * that happens, and it throws -- the legacy `createProgram` logged and returned
 * null, and the viewer that received it reported success and drew nothing for
 * its entire lifetime.
 */

/** Which stage a shader belongs to, used for error messages. */
export type ShaderStage = 'vertex' | 'fragment'

/**
 * Annotates a driver error log with the offending source line.
 *
 * Drivers report positions as `ERROR: 0:12: message`, where 12 is a line number
 * into the string that was handed to `shaderSource`. Because the generated
 * constants are prepended to the shader body, that number is usually not the
 * line the author sees in the file -- so the source has to be echoed back.
 */
export function describeShaderError (log: string, source: string): string {
  const lines = source.split('\n')
  return log.replace(/ERROR:\s*\d+:(\d+)/g, (match, lineNumber: string) => {
    const index = Number(lineNumber) - 1
    // Out-of-range is possible: some drivers count against the pre-substitution
    // source. Echoing nothing is better than throwing inside an error path.
    const line = lines[index]
    return line === undefined ? match : `${match}\n    > ${line.trim()}`
  })
}

/**
 * Compiles one shader stage.
 *
 * @throws If compilation fails, with the driver log and the offending lines.
 *   The shader object is deleted before throwing.
 */
export function compileShader (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  stage: ShaderStage
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error(`could not allocate a ${stage} shader object`)

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // The log alone is often not enough to locate the line, because the
    // generated constants shift every number. describeShaderError adds the
    // actual source text back in.
    const log = describeShaderError(gl.getShaderInfoLog(shader) ?? '(no log)', source)
    gl.deleteShader(shader)
    throw new Error(`${stage} shader failed to compile:\n${log}`)
  }

  return shader
}

/**
 * Links a vertex and fragment shader into a program.
 *
 * Both shaders are deleted, attached or not, once linking is done: after a
 * successful link the program holds everything it needs. They are also deleted
 * on failure, so a caller retrying with a fixed source does not accumulate
 * shader objects.
 *
 * @throws If linking fails.
 */
export function linkProgram (
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    throw new Error('could not allocate a program object')
  }

  try {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program failed to link:\n${gl.getProgramInfoLog(program) ?? '(no log)'}`)
    }
    return program
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  } finally {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
  }
}

/**
 * Creates a WebGL2 context configured the way this backend needs it.
 *
 * @returns `null` when the browser cannot provide one. Callers treat that as
 *   "no backend", not as an error -- it is the expected result on a device with
 *   no WebGL2 at all.
 */
export function acquireContext (canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    // The legacy context enabled depth testing and requested a depth buffer
    // that was never cleared (defect F4). Neither backend needs one now: there
    // is one triangle and nothing to occlude.
    depth: false,
    stencil: false,
    // Stated, not a silent default. The buffer keeps the source's own alpha
    // channel: opaque sources (every JPEG, every video) composite identically
    // either way, a transparent-PNG panorama would blend over the page here
    // where WebGPU's 'opaque' alphaMode would not, and a real channel is
    // closer to what a WebGPU read-back returns.
    alpha: true,
    // The shader writes source RGBA verbatim, so the buffer is straight alpha
    // and has to be handed to the compositor that way. The consumers are the
    // live canvas compositing over the page and P5's readCanvas -> toDataURL
    // read-back; gate C sees neither, its WebGL2 half builds its own bare
    // context.
    premultipliedAlpha: false,
    /*
     * TRUE, and it is not a default worth taking. Without it the drawing buffer
     * is cleared when the browser composites the frame, so anything that reads
     * the canvas in a later task sees black. That is every user-story test (they
     * read after awaiting a media event), any consumer that screenshots the
     * canvas, and the context-loss test in Task 3.
     *
     * It costs a copy of the buffer per frame, which is why the WebGPU backend
     * does not pay it -- the WebGPU canvas keeps its last presented frame. This
     * backend is the fallback; correctness under read-back is worth more here
     * than the copy.
     */
    preserveDrawingBuffer: true,
    antialias: false
  })
}
```

- [x] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- webgl2-errors`
Expected: 13 个测试 PASS

- [x] **Step 5: Commit**

```bash
git add src/renderer/webgl2/context.ts test/unit/webgl2-errors.test.ts
git commit -m "feat(renderer): WebGL2 context and compilation that fails loudly

WebGL reports compilation failure only through a parameter nobody reads.
The legacy code checked it, logged, and returned null -- so the viewer
stored null as its program and drew nothing for its whole lifetime.

preserveDrawingBuffer is on: without it, every read-back of this canvas in a
later task sees a cleared buffer."
```

---

### Task 3: `WebGL2Backend`

**Files:**
- Create: `src/renderer/webgl2/backend.ts`
- Modify: `src/viewer/backend-factory.ts`
- Test: `test/integration/webgl2-smoke.test.ts`

- [x] **Step 1: 实现**

`src/renderer/webgl2/backend.ts`：

```ts
/**
 * The WebGL2 backend, and pano.gl's fallback path.
 *
 * Deliberately not feature-equal with the WebGPU backend: it exists so that
 * browsers without WebGPU can still show a panorama. It does not get its own
 * capabilities, and the Backend interface makes no concession to it.
 *
 * The structural difference from WebGPU is the uniform upload. WebGPU packs
 * everything into one 96-byte block; here each value goes to its own named
 * uniform. The two layouts happen to coincide for this struct, which is a
 * coincidence and not a reason -- see the plan's "关键设计决定".
 *
 * The structural difference that does NOT exist is depth. Both matrices are
 * built by core/matrix.ts with the backend's own depth convention, and both
 * conventions put the far plane at ndc z = +1, so the fragment shader is
 * identical in both.
 */

import { mat4 } from 'gl-matrix'
import { cameraProjectionCode, textureProjectionCode } from '../../core/constants'
import { buildCameraTransform } from '../../core/matrix'
import type { CameraState, Projection } from '../../core/types'
import type { Backend, Capabilities, DeviceLost, RenderableSource } from '../backend'
import { describeCapabilities } from '../capabilities'
import { acquireContext, compileShader, linkProgram } from './context'
import { PANORAMA_GLSL_FRAGMENT, PANORAMA_GLSL_VERTEX } from './shaders'

/**
 * The `reason` token for a lost WebGL2 context.
 *
 * WebGL does not name its own loss reasons, so this is a project-level token
 * rather than a browser one. P3's `DeviceLost` documents it.
 */
const CONTEXT_LOST = 'context-lost'

const CONTEXT_LOST_MESSAGE =
  'the WebGL2 context was lost. The browser may restore it; this backend ' +
  'rebuilds its program and drops its texture if it does, and redraws on the ' +
  'next frame the viewer asks for.'

/** The uniforms the shader declares. One entry per `uniform` in panorama.glsl. */
const UNIFORM_NAMES = [
  'u_invClip', 'u_projKind', 'u_texProjKind',
  'u_povLatitude', 'u_povLongitude', 'u_zoom', 'u_tex'
] as const

type UniformName = (typeof UNIFORM_NAMES)[number]

/** Compiles and links the panorama program. Also the context-restore path. */
function buildProgram (gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, PANORAMA_GLSL_VERTEX, 'vertex')
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, PANORAMA_GLSL_FRAGMENT, 'fragment')
  return linkProgram(gl, vertex, fragment)
}

/**
 * Locates every uniform the shader declares.
 *
 * @throws If one is missing, naming it. A null location means the uniform was
 *   optimized out or misspelled; the `gl.uniform*` call is then silently
 *   ignored, the value stays at its default, and the picture is wrong in a way
 *   that reads as a projection bug. Failing here, at construction, is the whole
 *   point -- the legacy path found out by rendering a wrong image.
 */
function locateUniforms (
  gl: WebGL2RenderingContext,
  program: WebGLProgram
): Record<UniformName, WebGLUniformLocation | null> {
  const locations = {} as Record<UniformName, WebGLUniformLocation | null>

  for (const name of UNIFORM_NAMES) {
    const location = gl.getUniformLocation(program, name)
    // `u_tex` is the one exemption: its value is the constant 0, which is also
    // the default for every sampler uniform, so a driver that folded it away
    // has done nothing wrong.
    if (location === null && name !== 'u_tex') {
      throw new Error(`uniform ${name} not found in the linked program`)
    }
    locations[name] = location
  }

  return locations
}

/**
 * The capabilities this backend reports.
 *
 * Routed through `describeCapabilities` rather than assembled here. The
 * clamping rule for `maxTextureDimension` lives there, is unit tested there,
 * and a second copy of it here is exactly the kind of duplication that drifts
 * silently.
 */
function capabilityFor (gl: WebGL2RenderingContext): Capabilities {
  const selected = describeCapabilities({
    hasWebGPU: false,
    hasWebGL2: true,
    adapter: null,
    maxTextureDimension: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    // No WebGL2 equivalent of importExternalTexture.
    externalTextures: false
  })

  if (selected.backend === 'none') {
    // Unreachable: `hasWebGL2` above is a literal `true`. The throw exists
    // because the return type is a union and the narrowing has to happen
    // somewhere. Do not replace it with an assertion -- an assertion is a claim
    // that the compiler has already checked.
    throw new Error('describeCapabilities reported no backend for a live WebGL2 context')
  }

  return selected
}

export class WebGL2Backend implements Backend {
  readonly kind = 'webgl2' as const

  /**
   * Public, not `#private`: this satisfies `Backend.capabilities`, and the
   * viewer reads it to decide whether a source needs downscaling before it ever
   * calls `setSource`. A private field would fail `implements Backend` at
   * typecheck, which is the point of declaring the interface in the first place.
   */
  readonly capabilities: Capabilities

  readonly #canvas: HTMLCanvasElement
  readonly #gl: WebGL2RenderingContext
  readonly #clip = mat4.create()
  readonly #invClip = mat4.create()

  // Not readonly: a lost-and-restored context invalidates the program and every
  // uniform location with it, and both are rebuilt in #onContextRestored().
  #program: WebGLProgram
  #uniforms: Record<UniformName, WebGLUniformLocation | null>

  #texture: WebGLTexture | undefined
  #textureVersion = -1
  #observer: ((lost: DeviceLost) => void) | undefined
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  #lost = false
  #disposed = false

  private constructor (init: {
    canvas: HTMLCanvasElement
    gl: WebGL2RenderingContext
    capabilities: Capabilities
    program: WebGLProgram
    uniforms: Record<UniformName, WebGLUniformLocation | null>
  }) {
    this.#canvas = init.canvas
    this.#gl = init.gl
    this.capabilities = init.capabilities
    this.#program = init.program
    this.#uniforms = init.uniforms

    // Arrow-function properties, not prototype methods: removeEventListener
    // matches on identity, and a bound copy is a different function.
    this.#canvas.addEventListener('webglcontextlost', this.#onContextLost)
    this.#canvas.addEventListener('webglcontextrestored', this.#onContextRestored)
  }

  /**
   * Creates a backend, or returns `null` when WebGL2 is unavailable.
   *
   * @throws If WebGL2 is available but the shader will not compile or link, or
   *   a uniform is missing. Those are bugs in this package, not a property of
   *   the device, and reporting them as "no backend" would hide them behind a
   *   fallback that also does not work.
   */
  static create (canvas: HTMLCanvasElement): WebGL2Backend | null {
    const gl = acquireContext(canvas)
    if (!gl) return null

    const program = buildProgram(gl)
    const uniforms = locateUniforms(gl, program)

    return new WebGL2Backend({
      canvas,
      gl,
      capabilities: capabilityFor(gl),
      program,
      uniforms
    })
  }

  #onContextLost = (event: Event): void => {
    // The default action for this event is to make the context permanently
    // unrestorable. preventDefault() must be called synchronously here -- there
    // is no later chance, and without it webglcontextrestored never fires and
    // the backend is dead for reasons nothing reports.
    event.preventDefault()
    this.#lost = true
    // Nobody may be listening. §6.5's rule is that the app can decide what to
    // show and how to report it, so reporting nothing here is not a failure --
    // it is an app that did not ask.
    this.#observer?.({ reason: CONTEXT_LOST, message: CONTEXT_LOST_MESSAGE })
  }

  #onContextRestored = (): void => {
    try {
      // Every GL object died with the context: the program, the uniform
      // locations and the texture. The restored context is a fresh one wearing
      // the same JavaScript object, so all of them are rebuilt here.
      this.#program = buildProgram(this.#gl)
      this.#uniforms = locateUniforms(this.#gl, this.#program)
      this.#texture = undefined
      this.#textureVersion = -1
      this.#lost = false
    } catch (error) {
      // Recompiling the same source in a context that just came back is not
      // expected to fail. If it does, the honest report is that this backend is
      // unusable, and the app's response is to build a new viewer (spec §6.4:
      // detection and clean release, not automatic recovery).
      this.#lost = true
      this.#observer?.({
        reason: CONTEXT_LOST,
        message: `${CONTEXT_LOST_MESSAGE} Rebuilding the program failed: ${String(error)}`
      })
    }
  }

  setCamera (state: CameraState, projection: Projection): void {
    const gl = this.#gl

    // 'minus-one-to-one' -- WebGL2's ndc z is [-1, 1]. The WebGPU backend passes
    // 'zero-to-one'. This one argument is the entire depth-convention difference
    // between the two backends.
    buildCameraTransform(state, projection, 'minus-one-to-one', this.#clip)
    mat4.invert(this.#invClip, this.#clip)

    gl.useProgram(this.#program)
    gl.uniformMatrix4fv(this.#uniforms.u_invClip, false, this.#invClip)
    // `cameraProjectionCode` takes the KIND, not the projection: it is the one
    // place a kind becomes a number, and it agrees with the #defines this shader
    // was compiled with because both come from projection-kinds.json.
    gl.uniform1i(this.#uniforms.u_projKind, cameraProjectionCode(projection.kind))
    gl.uniform1f(this.#uniforms.u_povLatitude, state.povLatitude)
    gl.uniform1f(this.#uniforms.u_povLongitude, state.povLongitude)
    // The three non-linear projections scale their input by zoom; the linear
    // one has no zoom term at all. 1 is what the WGSL packer writes for a linear
    // camera, so the two backends agree on a value neither of them reads.
    gl.uniform1f(this.#uniforms.u_zoom, projection.kind === 'linear' ? 1 : projection.zoom)
  }

  setSource (source: RenderableSource | null): void {
    // During the loss window there is nothing to upload into. The spec allows
    // createTexture() to return null on a lost context (this Chromium instead
    // hands back a live object, which only turns the upload into a silent
    // no-op), and the pixels would not survive the restore regardless:
    // #onContextRestored drops the texture and the next setSource re-uploads.
    // Returning before any GL call is what keeps a spec-conforming browser's
    // null from reading as an allocation failure, thrown on every frame of
    // the window.
    if (this.#lost) return

    const gl = this.#gl

    if (!source) {
      this.#texture = undefined
      this.#textureVersion = -1
      return
    }

    gl.useProgram(this.#program)
    // The upload description is inside `state`; `source.projection` does not
    // exist and reading it is the mistake this comment is here to prevent.
    gl.uniform1i(this.#uniforms.u_texProjKind, textureProjectionCode(source.state.projection))

    // WebGL2 has no external textures, so every source goes through a copy. The
    // version check is still worth having: a still image uploads once, and a
    // video uploads once per presented frame rather than once per rAF.
    //
    // `source.element` is used here and NOT retained past this call, which is
    // the interface's contract. That is also why there is no "redraw after a
    // context restore" path: the pixels are gone by the time the context comes
    // back. See #onContextRestored.
    const needsUpload = this.#texture === undefined || this.#textureVersion !== source.version
    if (!needsUpload) return

    if (!this.#texture) this.#texture = gl.createTexture() ?? undefined
    if (!this.#texture) throw new Error('could not allocate a texture object')

    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    // False, because the flip lives in the shader (`to_uv` flips v). Doing it
    // here instead would make the two backends' shaders differ by a flip while
    // their pixels agreed -- which is the one kind of drift gate C cannot see.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.element)
    // No power-of-two requirement in WebGL2, so REPEAT + linear is available
    // at any size. The legacy path could not have asked for REPEAT because
    // WebGL1 restricts NPOT textures to NEAREST + CLAMP_TO_EDGE. The wrap
    // modes must match WebGPU PER SOURCE KIND, not blanket: the WebGPU still
    // sampler is repeat on BOTH axes (src/renderer/webgpu/shaders/sampler.ts)
    // because the cross-seam/pole LINEAR blend lives in the sampler and
    // clamp-to-edge cannot express it (gate A measured the seam blend at up
    // to 124 LSB), while WebGPU video is edge-clamped by
    // textureSampleBaseClampToEdge whatever the sampler says -- an API limit
    // of its entry point, which a clamp-to-edge wrap mirrors exactly.
    const wrap = source.kind === 'video' ? gl.CLAMP_TO_EDGE : gl.REPEAT
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.#textureVersion = source.version
  }

  render (): void {
    const gl = this.#gl
    // Drawing into a lost context is a silent no-op that can log per call. The
    // render loop keeps running until the viewer is told otherwise.
    if (this.#lost) return

    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (!this.#texture) return

    gl.useProgram(this.#program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.uniform1i(this.#uniforms.u_tex, 0)
    // Three vertices, no attributes bound and no index buffer. gl_VertexID does
    // the work, exactly as the WGSL vertex stage does it.
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  resize (cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    if (this.#canvas.width !== width) this.#canvas.width = width
    if (this.#canvas.height !== height) this.#canvas.height = height
  }

  /**
   * Registers the device-loss observer.
   *
   * One observer, not a list: `Backend` documents that registering twice
   * replaces the previous one, and that the returned function unregisters only
   * if this call is still the current one. A stale unsubscribe is a no-op rather
   * than a surprise removal -- which is what a `Set` of listeners would give and
   * what the interface deliberately does not.
   */
  onDeviceLost (fn: (lost: DeviceLost) => void): () => void {
    this.#observer = fn
    return () => {
      if (this.#observer === fn) this.#observer = undefined
    }
  }

  dispose (): void {
    if (this.#disposed) return
    this.#disposed = true

    // Before loseContext(), not after: loseContext() fires webglcontextlost on
    // this canvas, and a listener still attached would report a device loss for
    // a backend the caller just released on purpose.
    this.#canvas.removeEventListener('webglcontextlost', this.#onContextLost)
    this.#canvas.removeEventListener('webglcontextrestored', this.#onContextRestored)
    this.#observer = undefined

    if (this.#texture) this.#gl.deleteTexture(this.#texture)
    this.#gl.deleteProgram(this.#program)
    // Ask the driver to release the context now rather than at GC time. The
    // legacy cleanGL() never did this (defect L5), so a page that created and
    // destroyed viewers accumulated contexts until the browser's limit (often
    // 16) was hit and new viewers silently failed to get one.
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
```

- [x] **Step 2: 接进 `backend-factory.ts`**

把 P5 里那段「WebGL2 还没实现」的 `throw` 换掉：

```ts
export async function createBackend (canvas: HTMLCanvasElement): Promise<Backend> {
  const webgpu = await WebGPUBackend.create(canvas)
  if (webgpu) return webgpu

  // WebGPU first, always: it is the primary path and the one every feature is
  // developed against. WebGL2 is reached only when `acquireDevice()` came back
  // empty -- which is the case for a browser without `navigator.gpu` and for
  // one whose adapter request returned null (spec §6.5, §9.5).
  const webgl2 = WebGL2Backend.create(canvas)
  if (webgl2) return webgl2

  throw new Error(
    'no usable rendering backend: neither WebGPU nor WebGL2 is available in this browser'
  )
}
```

> **`probe()` 也要改（2026-09-23 复审 FIX 2，取代本文原来那句「`probe()` 不用改」）。** 原来的 `probe()` 只问 `getContext('webgl2') !== null`，把 `maxTextureDimension` 留在 0 —— `describeCapabilities` 会把它钳到 2048 的下限，而构造出来的 `WebGL2Backend` 上报的是真实钳位后的 `MAX_TEXTURE_SIZE`（通常 16384）。于是在一台没有适配器的机器上，「问」和「构造」对同一个问题给出两个答案。现在 `probe()` 在**没有适配器且 WebGL2 可用**这个分支上多问一句 `gl.getParameter(gl.MAX_TEXTURE_SIZE)`；有适配器的机器一个字节都不变。配套改动：`test/unit/probe.test.ts` 的 stub 相应携带 `getParameter`（这是本任务额外触碰的文件）。**注意：probe 与构造后端的一致性目前没有钉死测试**，钉它的断言在 Task 5 重写 US5 时补。
- [x] **Step 3: 冒烟测试**

`test/integration/webgl2-smoke.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { WebGL2Backend } from '../../src/renderer/webgl2/backend'
import { compileShader } from '../../src/renderer/webgl2/context'
import type { DeviceLost, RenderableSource } from '../../src/renderer/backend'
import type { CameraState } from '../../src/core/types'

/*
 * The WebGL2 backend's own smoke tests -- not the gates, which are about the
 * shaders agreeing, and not the user stories, which are about what a user sees.
 * These are about the backend as an object: does it get a context, does it
 * refuse to construct when the shader will not compile, does it release the
 * context it took, and does it survive a loss.
 *
 * Everything is imported directly. Browser mode runs this file inside the page,
 * so there is no bridge, no page-side export, and no `window.__panoTest`: the
 * backend under test and the test are in one module system.
 *
 * This file runs in the `integration` project, which has a real WebGPU adapter.
 * That is fine and deliberate -- WebGL2 works there too, and running the
 * backend's own tests next to the WebGPU ones keeps the fallback from being
 * tested only in the environment where the primary path is absent.
 */

/** The pose every case uses. Its values are irrelevant; its presence is not. */
const ORIGIN: CameraState = { povLatitude: 0, povLongitude: 0 }

/** A 2x2 canvas in two horizontal color bands, as an image element: pixels known without a fixture file. */
async function twoToneSource (): Promise<RenderableSource> {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const ctx = canvas.getContext('2d')!
  // Horizontal bands, not a quadrant checkerboard: each column of a
  // 2-pixel-wide equirectangular texture spans 180 degrees of longitude, so a
  // 75-degree view from any longitude sees one column only and a quadrant
  // board renders solid. The row boundary sits on the equator -- where a
  // latitude-zero camera looks -- so both colors land in every frame it draws.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 2, 2)
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 2, 1)

  // A real <img>, not a bitmap: RenderableSource.element is typed
  // HTMLImageElement | HTMLVideoElement, and a backend uploads it through
  // texImage2D. Casting a bitmap in would typecheck only by lying about the
  // type, and the lie would be discovered by whichever backend later reads a
  // property the bitmap does not have.
  const image = new Image()
  image.src = canvas.toDataURL('image/png')
  await image.decode()

  return {
    state: { projection: 'equirectangular', width: 2, height: 2 },
    kind: 'image',
    element: image,
    version: 1
  }
}

/** Reads the framebuffer through the canvas's own context. */
function readGl (canvas: HTMLCanvasElement): number[] {
  const gl = canvas.getContext('webgl2')!
  const pixels = new Uint8Array(canvas.width * canvas.height * 4)
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return Array.from(pixels)
}

/** How much of the buffer is not black, 0..1. */
function nonBlackFraction (pixels: readonly number[]): number {
  let lit = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i]! > 0 || pixels[i + 1]! > 0 || pixels[i + 2]! > 0) lit++
  }
  return lit / (pixels.length / 4)
}

describe('WebGL2Backend', () => {
  it('renders a non-empty frame', async () => {
    const canvas = document.createElement('canvas')
    const backend = WebGL2Backend.create(canvas)
    expect(backend, 'WebGL2Backend.create returned null in a browser that has WebGL2').not.toBeNull()

    backend!.resize(64, 64, 1)
    // Radians, not degrees: `Projection.fov` is documented in radians (P2's
    // legacyFovFrom; see src/viewer/camera-controller.ts), and the plan's
    // literal `fov: 75` handed the matrix 75 radians -- a deterministic but
    // nonsensical camera whose vertical span was +-11 degrees and vertically
    // mirrored, too narrow for the both-colors assertion below to ever fire.
    backend!.setCamera(ORIGIN, { kind: 'linear', fov: (75 * Math.PI) / 180, aspect: 1 })
    backend!.setSource(await twoToneSource())
    backend!.render()

    const pixels = readGl(canvas)
    const capabilities = backend!.capabilities
    backend!.dispose()

    // Not `toBe(gl.MAX_TEXTURE_SIZE)`: the reported value goes through
    // describeCapabilities, which clamps it into [2048, 16384] because a
    // software adapter can report 0 and make every source look oversized.
    expect(capabilities.maxTextureDimension).toBeGreaterThanOrEqual(2048)
    expect(capabilities.externalTextures).toBe(false)
    expect(nonBlackFraction(pixels)).toBeGreaterThan(0.5)

    // Both colors have to appear, not merely any non-black pixel: a
    // constant-UV fallback painting one texel over the whole frame would score
    // 1.0 on the fraction too. White carries green; red does not.
    let sawWhite = false
    let sawRed = false
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 1]! > 200) sawWhite = true
      if (pixels[i]! > 200 && pixels[i + 1]! < 64) sawRed = true
    }
    expect(sawWhite).toBe(true)
    expect(sawRed).toBe(true)
  })

  it('throws rather than yielding a dead backend when the shader will not compile', () => {
    // The legacy path returned null here and the viewer reported success. A
    // viewer that cannot render is not a viewer, so the failure has to be loud
    // and it has to happen where the shader is compiled.
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')!
    expect(() => {
      compileShader(gl, gl.FRAGMENT_SHADER, 'void main(){ this is not glsl }', 'fragment')
    }).toThrow(/failed to compile/i)
  })

  it('repeated create/dispose does not exhaust the context limit', () => {
    // Browsers cap live WebGL contexts (commonly at 16). WEBGL_lose_context is
    // what releases one immediately; without it, the 17th viewer silently fails
    // and the only symptom is a viewer that draws nothing.
    const failures: number[] = []
    for (let i = 0; i < 20; i++) {
      const canvas = document.createElement('canvas')
      const backend = WebGL2Backend.create(canvas)
      if (backend === null) { failures.push(i); continue }
      backend.dispose()
    }
    expect(failures).toEqual([])
  })

  it('a lost context is reported, and a restored one draws again', async () => {
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const backend = WebGL2Backend.create(canvas)
    expect(backend).not.toBeNull()

    const lost: DeviceLost[] = []
    const unsubscribe = backend!.onDeviceLost(l => lost.push(l))

    backend!.resize(32, 32, 1)
    backend!.setCamera(ORIGIN, { kind: 'linear', fov: (75 * Math.PI) / 180, aspect: 1 })
    backend!.setSource(await twoToneSource())
    backend!.render()
    const before = nonBlackFraction(readGl(canvas))

    // A synthetic loss, dispatched by hand so preventDefault() and the report
    // can be asked about directly. It has to come after `before`: render() is a
    // deliberate no-op while the backend is lost, so a draw after this point
    // would read black regardless of the restore path.
    const synthetic = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(synthetic)
    // Asserted here, not after the restore: the handler runs synchronously
    // under dispatchEvent, and a deleted preventDefault would otherwise die by
    // the restore await timing out rather than by these assertions naming it.
    expect(synthetic.defaultPrevented).toBe(true)
    expect(lost[0]?.reason).toBe('context-lost')

    const restored = new Promise<void>(resolve => {
      canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true })
    })

    const gl = canvas.getContext('webgl2')!
    // Taken while the context is alive and kept: a lost context returns null
    // from getExtension(), so restoreContext() later has to go through the
    // object taken before the loss.
    const lose = gl.getExtension('WEBGL_lose_context')!
    // Waiting for the loss event itself, not for a timer: a timer only proves
    // that time passed. The once listener is registered after the synthetic
    // dispatch, so only the real loss can settle it.
    const realLoss = new Promise<void>(resolve => {
      canvas.addEventListener('webglcontextlost', () => resolve(), { once: true })
    })
    lose.loseContext()
    await realLoss
    // The synthetic dispatch, then the real loss: two reports, not one.
    const lostCount = lost.length

    // setSource inside the loss window must be a silent no-op, not an error.
    // The null first, as the viewer clearing its source mid-loss: that is what
    // makes the second call reach the allocation line, which it otherwise
    // never would (the first upload left a texture behind, and only
    // #onContextRestored drops it).
    //
    // Honest about what this can pin: the WebGL spec allows createTexture()
    // to return null on a lost context, and the backend's guard is what keeps
    // that from being an allocation error thrown on every frame of the window.
    // THIS Chromium returns a live object instead (measured: both with the
    // loss preventDefaulted and without), so here the unguarded path is a
    // silent no-op chain and this assertion passes either way -- it pins the
    // contract for spec-conforming browsers, not a difference observable on
    // this one. The upload belongs to the frame after the restore, where
    // #onContextRestored has dropped the texture and the next setSource
    // re-uploads whatever source the viewer hands over.
    backend!.setSource(null)
    const duringLoss = await twoToneSource()
    expect(() => backend!.setSource(duringLoss)).not.toThrow()

    lose.restoreContext()
    await restored

    // A second source object, because the first one's element was released --
    // which is the documented setSource contract, and the reason a restore
    // cannot redraw on its own. See the non-goals.
    backend!.setCamera(ORIGIN, { kind: 'linear', fov: (75 * Math.PI) / 180, aspect: 1 })
    backend!.setSource(await twoToneSource())
    backend!.render()
    const after = nonBlackFraction(readGl(canvas))

    unsubscribe()
    backend!.dispose()
    canvas.remove()

    // The synthetic dispatch, then the real loss: two reports, not one.
    expect(lostCount).toBe(2)
    expect(before).toBeGreaterThan(0.5)
    expect(after).toBeGreaterThan(0.5)
  })
})
```

> **`WebGL2Backend.create` 是同步的，`WebGPUBackend.create` 是 `async` 的。** 不是笔误：WebGPU 的 `requestAdapter()` / `requestDevice()` 是异步 API，WebGL2 的 `getContext('webgl2')` 不是。两个 `Backend` 实现都不因此在接口上多一个 `await` —— `createBackend()` 是 `async` 的，它在里面 `await` 那个异步的、直接调那个同步的。测试写起来是 `const backend = WebGL2Backend.create(canvas)`，不要加 `await`（加了也不会错，但会让人以为它是异步的）。

- [x] **Step 4: 跑测试**

Run: `npx vitest run --project integration webgl2-smoke`
Expected: 4 个测试 PASS

- [x] **Step 5: Commit**

```bash
git add src/renderer/webgl2/ test/integration/webgl2-smoke.test.ts src/viewer/backend-factory.ts
git commit -m "feat(renderer): WebGL2 backend as the fallback path

Named uniforms rather than a shared UBO: the offset rules are not the same
rule set, and a UBO would buy nothing at one draw call per frame while
turning a missing uniform into silently wrong pixels. getUniformLocation
either finds the name or this backend refuses to construct.

Handles webglcontextlost: preventDefault so a restore is possible, report
the loss through onDeviceLost, rebuild the program and drop the texture on
restore. Releases the context on dispose, which the legacy cleanGL never
did."
```

---

### Task 4: 门禁 C —— 跨后端一致性

**Files:**
- Create: `test/integration/support/cross-backend.ts`
- Test: `test/integration/gate-c-cross-backend.test.ts`

**门禁 C 的问题**：两份手写的着色器，四个投影，**它们会不会悄悄漂开？**

**怎么比：两个离屏渲染器，同一张源图，同一批相机状态。** 不走两个真实的 `Backend`（那个在 Task 5 的用户故事里验），因为门禁 C 要证的是**两份着色器源码**一致，而经画布走一遍会引入 present 与读回的时序，还会让两边的输入路径不同（WebGPU 的 canvas 纹理没有 `readPixels` 等价物）。
- [x] **Step 1: 门禁 C 的工具**

`test/integration/support/cross-backend.ts`。**一个文件装三样东西**：共用的源图、GLSL 离屏渲染、CPU 裁判。浏览器模式让它们可以放在一起 —— 都在页面里跑，`import` 一次就够了，不需要分成「页面侧出口」和「测试侧工具」两半。

```ts
/*
 * Gate C's tooling: the source all three paths sample, the GLSL half, and the
 * CPU arbiter.
 *
 * Gate C compares TWO HAND-TRANSCRIBED SHADERS, so the thing under test is the
 * shader source, not the backend object. Both halves therefore render offscreen
 * from the same decoded source with the same request: going through two real
 * `Backend`s would add the present/readback timing and give the two halves
 * different input paths (a WebGPU swapchain texture has no readPixels
 * equivalent), and then the comparison would be measuring the harnesses.
 *
 * The WebGPU half is P3's `renderOffscreen`, not a copy of it. The claim is
 * about the SHIPPED shader, so that side has to go through the shipped path.
 */

import { renderOffscreen, maxChannelDiff } from './gpu'
import type { RenderRequest, RenderResult } from './gpu'
import { mat4 } from 'gl-matrix'
import { buildCameraTransform } from '../../../src/core/matrix'
import { cameraProjectionCode, textureProjectionCode } from '../../../src/core/constants'
import { compileShader, linkProgram } from '../../../src/renderer/webgl2/context'
import { PANORAMA_GLSL_FRAGMENT, PANORAMA_GLSL_VERTEX } from '../../../src/renderer/webgl2/shaders'
import { ndcToSurface, project } from '../../../src/core/reference'
import type { CameraState, Projection } from '../../../src/core/types'

/**
 * Gate C renders at 128x128. The number is convention, not a constraint:
 * WebGPU's copyTextureToBuffer wants bytesPerRow to be a multiple of 256 and
 * gpu.ts's readTexture pads it when a width does not divide evenly (its own
 * comment says so), so other sizes work. 128 * 4 = 512 divides evenly, which
 * keeps the readback unpadded.
 */
export const GATE_C_SIZE = 128

/**
 * The source every path in gate C samples.
 *
 * One definition for all three: the WebGPU renderer, the WebGL2 renderer and the
 * CPU reference all take these exact pixels. Two sources with "the same" pattern
 * is how a comparison ends up measuring the difference between two generators.
 *
 * An ImageBitmap because that is what P3's RenderRequest carries -- and because
 * it is a valid TexImageSource, so the GLSL half uploads it with the same
 * `texImage2D` a viewer's <img> goes through.
 *
 * Periodic in u and v on purpose. A ramp running 0..255 across the width has a
 * discontinuity at the seam, and a one-texel filtering difference there shows up
 * as a huge difference that has nothing to do with the projections. Periodic and
 * smooth means a sub-texel UV difference produces a proportionally small colour
 * difference, while the 8-cycle term keeps the image non-constant so a rotation
 * or a scale error cannot hide inside a flat region.
 */
export async function gateSource (): Promise<{ bitmap: ImageBitmap, size: number }> {
  const canvas = document.createElement('canvas')
  canvas.width = GATE_C_SIZE
  canvas.height = GATE_C_SIZE
  const ctx = canvas.getContext('2d')!

  const image = ctx.createImageData(GATE_C_SIZE, GATE_C_SIZE)

  for (let y = 0; y < GATE_C_SIZE; y++) {
    for (let x = 0; x < GATE_C_SIZE; x++) {
      const u = (x + 0.5) / GATE_C_SIZE
      const v = (y + 0.5) / GATE_C_SIZE
      const i = (y * GATE_C_SIZE + x) * 4
      image.data[i] = Math.round(128 + 127 * Math.cos(2 * Math.PI * u))
      image.data[i + 1] = Math.round(128 + 127 * Math.cos(2 * Math.PI * v))
      image.data[i + 2] = Math.round(
        128 + 127 * Math.sin(2 * Math.PI * 8 * u) * Math.sin(2 * Math.PI * 8 * v)
      )
      image.data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  // imageOrientation: 'none' pins the orientation by the call rather than
  // leaving it to the 'from-image' default, whose meaning varies by source
  // type. A canvas carries no EXIF to apply -- measured in this suite's
  // Chromium, the default and 'none' produce byte-identical bitmaps -- so
  // this is determinism, not a flip workaround. The v flip lives in the
  // shader, and the GLSL half uploads with UNPACK_FLIP_Y_WEBGL = false.
  return { bitmap: await createImageBitmap(canvas, { imageOrientation: 'none' }), size: GATE_C_SIZE }
}

/**
 * Renders one frame through the GLSL shader and reads the pixels back.
 *
 * Same product path as the WebGPU half: the matrix comes from
 * buildCameraTransform with this backend's depth convention, the shader is the
 * shipped one, the source is a real decoded image. Only the swapchain is
 * skipped.
 */
export async function renderOffscreenGLSL (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection, source } = request

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('renderOffscreenGLSL: no WebGL2 context')

  const program = linkProgram(
    gl,
    compileShader(gl, gl.VERTEX_SHADER, PANORAMA_GLSL_VERTEX, 'vertex'),
    compileShader(gl, gl.FRAGMENT_SHADER, PANORAMA_GLSL_FRAGMENT, 'fragment')
  )
  gl.useProgram(program)

  // Computed from the request, NOT read from a Backend: this harness has to be
  // able to disagree with the backend, or it cannot catch the backend being
  // wrong. See the note below.
  const clip = mat4.create()
  const invClip = mat4.create()
  // 'minus-one-to-one', where the WebGPU half passes 'zero-to-one'. This one
  // argument is the whole depth-convention difference between the backends; if
  // both halves were given the same one here, gate C would fail and the failure
  // would have nothing to do with the projection formulas.
  buildCameraTransform(camera, projection, 'minus-one-to-one', clip)
  mat4.invert(invClip, clip)

  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_invClip'), false, invClip)
  gl.uniform1i(gl.getUniformLocation(program, 'u_projKind'), cameraProjectionCode(projection.kind))
  gl.uniform1i(gl.getUniformLocation(program, 'u_texProjKind'), textureProjectionCode('equirectangular'))
  gl.uniform1f(gl.getUniformLocation(program, 'u_povLatitude'), camera.povLatitude)
  gl.uniform1f(gl.getUniformLocation(program, 'u_povLongitude'), camera.povLongitude)
  gl.uniform1f(gl.getUniformLocation(program, 'u_zoom'), projection.kind === 'linear' ? 1 : projection.zoom)
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0)

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // False: the v flip lives in the shader. Doing it here too would cancel it.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  // REPEAT on both axes, exactly as both shipped image paths wrap: the WebGPU
  // still sampler (webgpu/shaders/sampler.ts) and this backend's own image
  // branch (webgl2/backend.ts). CLAMP_TO_EDGE here would make the two halves
  // sample different rows wherever v leaves [0, 1] -- which the non-linear
  // projections' `- lat` term makes happen at any non-zero latitude -- and the
  // comparison would fail for a reason with nothing to do with the formulas.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.drawArrays(gl.TRIANGLES, 0, 3)

  const bottomUp = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp)

  // readPixels is bottom-up; the WebGPU half and the CPU reference are both
  // top-down. Flipping here, once, is what makes the three comparable -- a
  // mismatch would look like a completely wrong projection.
  const topDown = new Uint8Array(bottomUp.length)
  const stride = width * 4
  for (let y = 0; y < height; y++) {
    topDown.set(bottomUp.subarray((height - 1 - y) * stride, (height - y) * stride), y * stride)
  }

  gl.deleteTexture(texture)
  gl.deleteProgram(program)

  // Release the context now rather than at GC time: one is created per call
  // and the suite runs ~21 of them, past Chrome's ~16-active-context LRU
  // threshold -- exactly the accumulation defect L5's dispose fix exists to
  // prevent (see WebGL2Backend.dispose). The WebGPU half already disposes
  // its backend per call.
  gl.getExtension('WEBGL_lose_context')?.loseContext()

  return { width, height, rgba: topDown }
}

/** Bilinear sample model matching the GPU's: LINEAR with REPEAT on both axes. */
function sample (
  data: Uint8ClampedArray,
  size: number,
  u: number,
  v: number
): [number, number, number] {
  // x - floor(x), which is what a REPEAT sampler does to a coordinate before
  // it interpolates. Clamp-to-edge here would disagree with both GPU halves
  // wherever a projection's v leaves [0, 1] -- at any non-zero latitude the
  // non-linear `- lat` term pushes phi past PI, and the GPUs wrap while a
  // clamping model would pin the edge row.
  const wrap = (x: number): number => {
    const w = x % 1
    return w < 0 ? w + 1 : w
  }
  const x = wrap(u) * size - 0.5
  const y = wrap(v) * size - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0

  const texel = (ix: number, iy: number, channel: number): number => {
    // Modular, not clamped: REPEAT blends the last source column into the
    // first at the seam, which is exactly the boundary behaviour both shipped
    // image paths have (webgpu/shaders/sampler.ts, webgl2/backend.ts).
    const cx = ((ix % size) + size) % size
    const cy = ((iy % size) + size) % size
    return data[(cy * size + cx) * 4 + channel]!
  }

  const mix = (channel: number): number => {
    const top = texel(x0, y0, channel) * (1 - fx) + texel(x0 + 1, y0, channel) * fx
    const bottom = texel(x0, y0 + 1, channel) * (1 - fx) + texel(x0 + 1, y0 + 1, channel) * fx
    return top * (1 - fy) + bottom * fy
  }

  return [mix(0), mix(1), mix(2)]
}

/**
 * Renders one frame on the CPU, in float64.
 *
 * The arbiter. When the two backends disagree, running all three and finding the
 * odd one out is what turns "they differ" into "this one is wrong".
 *
 * It inverts ndc to a surface point itself (ndcToSurface) instead of inverting
 * the float32 camera matrix the shaders use. An arbiter that shares the shaders'
 * precision and their matrix is not an independent opinion -- it would agree
 * with a wrong matrix by construction.
 *
 * Row 0 is the top row, matching both GPU harnesses, and the source is the same
 * pixels: all three paths must differ only in how they compute the projection.
 */
export async function referenceImage (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection, source } = request

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = GATE_C_SIZE
  sourceCanvas.height = GATE_C_SIZE
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source, 0, 0)
  const sourceData = ctx.getImageData(0, 0, GATE_C_SIZE, GATE_C_SIZE).data

  // Only the linear projection is scale-invariant, and for it the extent is
  // unread. The other three carry theirs in the projection itself -- which is
  // what let the geometry subsystem disappear.
  const extent = projection.kind === 'linear' ? ([2, 2] as const) : projection.extent
  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Pixel centres, and ndc y is inverted because ndc +1 is the top row.
      const ndcX = ((x + 0.5) / width) * 2 - 1
      const ndcY = 1 - ((y + 0.5) / height) * 2

      const [sx, sy, sz] = ndcToSurface(ndcX, ndcY, extent)
      // project() returns the UNFLIPPED equirect v (phi / PI -- see toUV in
      // src/core/reference.ts), while both shaders' to_uv sample 1 - phi / PI.
      // The flip is compensated here, once, so the arbiter reads the same
      // texture rows both GPUs read; sampling v raw would mirror the image
      // vertically and disagree on the wrap-antisymmetric channel.
      const { u, v } = project(sx, sy, sz, camera, projection)
      const [r, g, b] = sample(sourceData, GATE_C_SIZE, u, 1 - v)

      const i = (y * width + x) * 4
      rgba[i] = Math.round(r)
      rgba[i + 1] = Math.round(g)
      rgba[i + 2] = Math.round(b)
      rgba[i + 3] = 255
    }
  }

  return { width, height, rgba }
}

/** The worst per-channel difference between two rendered images. */
export interface GateCDiff {
  readonly max: number
  readonly x: number
  readonly y: number
  /** The four channels of each image at (x, y), so a failure is diagnosable. */
  readonly a: readonly number[]
  readonly b: readonly number[]
}

/**
 * Where the worst difference is, and both colours there.
 *
 * The worst VALUE comes from maxChannelDiff, so that "worst channel difference"
 * means one thing across the whole suite; this only locates it, which
 * maxChannelDiff does not report.
 */
function locate (a: ArrayLike<number>, b: ArrayLike<number>, width: number): Omit<GateCDiff, 'max'> {
  let best = 0
  let at = 0
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs(a[i]! - b[i]!)
    if (diff > best) { best = diff; at = i }
  }
  const pixel = Math.floor(at / 4)
  return {
    x: pixel % width,
    y: Math.floor(pixel / width),
    a: Array.from({ length: 4 }, (_, c) => a[pixel * 4 + c]!),
    b: Array.from({ length: 4 }, (_, c) => b[pixel * 4 + c]!)
  }
}

/** The full diagnosis for one pair of images. */
function diagnose (a: ArrayLike<number>, b: ArrayLike<number>, width: number): GateCDiff {
  return { max: maxChannelDiff(a, b), ...locate(a, b, width) }
}

/** The request all three paths are given. Identical, including the source pixels. */
export async function gateRequest (camera: CameraState, projection: Projection): Promise<RenderRequest> {
  // One source per call, handed to all three paths. Two sources with "the same"
  // pattern is how a comparison ends up measuring the difference between two
  // generators.
  const { bitmap, size } = await gateSource()
  return {
    width: GATE_C_SIZE,
    height: GATE_C_SIZE,
    camera,
    projection,
    source: bitmap,
    sourceWidth: size,
    sourceHeight: size
  }
}

/**
 * Renders one camera state through both shaders and returns the worst channel
 * difference between them.
 */
export async function renderBothBackends (
  camera: CameraState,
  projection: Projection
): Promise<GateCDiff> {
  const request = await gateRequest(camera, projection)
  const webgpu = await renderOffscreen(request)
  const webgl2 = await renderOffscreenGLSL(request)
  request.source.close()
  return diagnose(webgpu.rgba, webgl2.rgba, GATE_C_SIZE)
}

/**
 * The same two renders, measured against the CPU reference instead.
 *
 * The third opinion that makes a disagreement actionable: when the two backends
 * differ, running this says which of them is wrong. It is also the only thing
 * that can catch a mistake present in BOTH transcriptions -- the one failure
 * mode the A/B comparison is blind to by construction.
 */
export async function compareWithReference (
  camera: CameraState,
  projection: Projection
): Promise<{ webgpu: number, webgl2: number }> {
  const request = await gateRequest(camera, projection)
  const reference = await referenceImage(request)
  const webgpu = await renderOffscreen(request)
  const webgl2 = await renderOffscreenGLSL(request)
  request.source.close()

  return {
    webgpu: maxChannelDiff(reference.rgba, webgpu.rgba),
    webgl2: maxChannelDiff(reference.rgba, webgl2.rgba)
  }
}
```

> **`renderOffscreenGLSL` 自己 `getUniformLocation`，不经 `UNIFORM_NAMES`。** 这是有意的：门禁 C 要证的是两份**着色器源码**一致，而这个 harness 的作用是「按名字把值喂进去」。它如果复用 Task 2 的定位逻辑，那么那边少写一个 uniform 时门禁 C 会跟着一起错。少写一个会被 Task 1 的声明清单测试拦下 —— 两道防线各管各的。

> **`request.source.close()` 在每个用例末尾。** `ImageBitmap` 持有的显存不会被 GC 及时回收，20 个用例各漏一张 128×128 的位图不致命，但门禁 C 是要长期增长的（每加一个相机状态就多一张），所以关掉它是纪律而不是优化。

- [x] **Step 2: 写测试**

`test/integration/gate-c-cross-backend.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { renderBothBackends, compareWithReference } from './support/cross-backend'
import type { CameraState, Projection } from '../../src/core/types'

/*
 * Gate C: do the two hand-transcribed shaders agree?
 *
 * The WGSL and GLSL sources are separate files with the same four formulas
 * written twice. Nothing in the type system or the build connects them. This is
 * the only thing that does.
 *
 * The comparison is WebGPU vs WebGL2, not either against the P0 baseline:
 *   - Against the baseline, a shared mistake in both transcriptions would pass.
 *   - Against each other, only a mistake in ONE of them fails, which is exactly
 *     the failure mode of hand transcription.
 *
 * The CPU reference in src/core/reference.ts is the arbiter when they disagree:
 * run all three, and the odd one out is the wrong one.
 *
 * `it` rather than `it.each` for the state matrix, because a parameterised test
 * name is built from a string and these names are built from the projection kind
 * and the state index -- the same information, typed, and readable in the
 * failure output.
 */

type Kind = Projection['kind']

/** One camera state. `zoom` belongs to the projection, not to the state. */
interface State {
  readonly povLatitude: number
  readonly povLongitude: number
  readonly fov: number
  readonly zoom: number
}

const state = (s: State): CameraState => ({ povLatitude: s.povLatitude, povLongitude: s.povLongitude })

/**
 * The surface size each projection is evaluated on.
 *
 * These are the legacy quad sizes, and they are part of the projection rather
 * than of any geometry -- which is what let the geometry subsystem disappear.
 * The numbers come from the v0.2.2 quad vertex coordinates: 1x1 for
 * cylindrical, 4x4 for planet and pannini.
 */
const extentFor = (kind: Kind): readonly [number, number] =>
  kind === 'cylindrical' ? [1, 1] : [4, 4]

const projectionFor = (kind: Kind, s: State): Projection =>
  kind === 'linear'
    ? { kind, fov: s.fov, aspect: 1 }
    : { kind, zoom: s.zoom, extent: extentFor(kind) }

const CAMERAS: readonly Kind[] = ['linear', 'cylindrical', 'planet', 'pannini']

// fov is in RADIANS (Projection.fov; see src/viewer/camera-controller.ts). The
// plan originally wrote 75/60/90 here as degrees, which built a mirrored ~22
// degree camera; the values below are the intended angles converted.
const STATES: readonly State[] = [
  { povLatitude: 0, povLongitude: 0, fov: (75 * Math.PI) / 180, zoom: 1 },
  { povLatitude: 30, povLongitude: 45, fov: (75 * Math.PI) / 180, zoom: 1 },
  { povLatitude: -60, povLongitude: 180, fov: (60 * Math.PI) / 180, zoom: 1 },
  { povLatitude: 10, povLongitude: 300, fov: (90 * Math.PI) / 180, zoom: 0.5 }
]

describe('gate C: WebGPU vs WebGL2', () => {
  for (const kind of CAMERAS) {
    for (const [index, s] of STATES.entries()) {
      it(`${kind} / state ${index}`, async () => {
        const diff = await renderBothBackends(state(s), projectionFor(kind, s))

        // The message carries the worst pixel and both colours, so a failure
        // here is a diagnosis rather than a number.
        expect(
          diff.max,
          `worst channel ${diff.max} at (${diff.x}, ${diff.y}): ` +
            `webgpu ${JSON.stringify(diff.a)} vs webgl2 ${JSON.stringify(diff.b)}`
        ).toBeLessThanOrEqual(2)
      })
    }
  }

  it('the CPU reference agrees with both, so a disagreement has an arbiter', async () => {
    // If this test ever fails while the others pass, the two backends are
    // consistently wrong together -- which is the failure mode gate C cannot see
    // on its own.
    //
    // The CPU path is float64 with its own bilinear fetch and the shaders are
    // float32 with the hardware's; hardware bilinear weights are quantized to a
    // handful of sub-texel bits, which is most of the headroom here.
    // Cylindrical, not linear, and not by taste: the reference's ndcToSurface
    // inverts the FIXED quad view, while a linear camera's pose is baked into
    // buildViewMatrix -- which this arbiter deliberately does not use (see
    // project()'s docs in src/core/reference.ts). A non-zero-pose linear
    // camera is beyond what the arbiter can model by construction. The
    // non-linear projections carry their pose as explicit formula terms, so
    // cylindrical at state 1 keeps the third opinion honest exactly where the
    // formulas can disagree: at a non-zero pose.
    const s = STATES[1]!
    const r = await compareWithReference(state(s), projectionFor('cylindrical', s))

    expect(r.webgpu).toBeLessThanOrEqual(3)
    expect(r.webgl2).toBeLessThanOrEqual(3)
  })

  it('the poles are the documented exception', async () => {
    // Near latitude +/-90 the equirectangular mapping compresses the entire
    // longitude range into a few pixels, so a tiny difference in the computation
    // of atan lands many texels apart. The tolerance is relaxed there on
    // purpose; this test pins that it is still bounded rather than unbounded.
    for (const kind of CAMERAS) {
      const s: State = { povLatitude: 89.5, povLongitude: 0, fov: (75 * Math.PI) / 180, zoom: 1 }
      const diff = await renderBothBackends(state(s), projectionFor(kind, s))

      // Not equal, but not garbage: a broken implementation gives a uniform
      // difference across the whole frame, not a bounded one.
      expect(diff.max, `${kind} at the pole`).toBeLessThan(64)
    }
  })
})
```

> **这个文件跑在 `integration` project 里，那里有真适配器** —— `require-webgpu.ts` 守着。它**不在** `no-webgpu` 的白名单里（P1 的 `include` 只盖 `fallback/**` 与四个用户故事），因为「两份着色器一致」这件事在只有一个后端可用时无法提问。

- [x] **Step 3: 跑门禁 C**

Run: `npx vitest run --project integration gate-c`
Expected: 18 条全 PASS（16 条状态 + 裁判 + 极点）

**失败分流的顺序很重要**，别跳步：

| 现象 | 先做什么 |
|---|---|
| 单一相机、全部状态都差 | 该相机的公式转写错了。**拿 `src/core/reference.ts` 当裁判** —— 跑三份，谁不一样谁错 |
| 全部相机、只有某一状态差 | 差的是矩阵构造（`buildCameraTransform` 的 `depth` 参数），不是公式 |
| 差值是整幅均匀的常数 | UV 的偏置或缩放错了。**先看 `to_uv` 有没有被人加上 `+0.5`** —— 那是半圈，不是一点点 |
| 图像整体上下颠倒 | `to_uv` 的 v 翻转没了，或者 WebGL2 上传时打开了 `UNPACK_FLIP_Y_WEBGL`（两份源码都改了才换来的那个 flip） |
| 只在极点附近差 | 这是**已知且已放宽**的。**先确认差值有界（< 64），再确认不是整幅差** |
| 只有非线性相机差，且差值随 `povLongitude` 变大 | 经度项的单位。**`/ 4.0`，不是 `* PI / 180`** |

**不要为了让门禁 C 变绿而放宽容差。** 如果 ±2 不够，先搞清楚为什么 —— 放宽到 ±8 只是把一个真实的转写错误变成一条永远绿不了又没人管的测试。

- [x] **Step 4: Commit**

```bash
git add test/integration/gate-c-cross-backend.test.ts test/integration/support/cross-backend.ts
git commit -m "test(renderer): gate C -- the two hand-written shaders must agree

Comparing the backends against each other rather than each against the
baseline, because a mistake made in both transcriptions would pass a
baseline comparison. The CPU reference is the arbiter when they disagree.

Both halves of the harness render offscreen from the same source and return
top-down RGBA8, so the comparison measures the projection formulas and not
the presentation path."
```

---

### Task 5: 用户故事在 WebGL2 下重跑

**Files:**
- Modify: `vitest.config.ts`（`no-webgpu` project 的 `include`，与它的 provider 补 `deviceScaleFactor`）
- Modify: `test/integration/support/spies.ts`（`countDraws` 与 `captureRenderInputs` 覆盖两个后端）
- Modify: `test/integration/fallback/user-story-no-webgpu.test.ts`（翻成正面断言）
- Modify: `test/integration/user-story-photo.test.ts`（probe 断言的期望值从固定标签改为按浏览器实际状态推导）

**这是后端替换的验收方式** —— 同一批用户故事，换个后端。

**做法：把一个 project 的 `include` 扩到四个用户故事。不写第二个测试文件。**

P1 已经把两个 project 建好了，`no-webgpu` 的注释里写着它将来要长成什么样。P6 就是把那句话兑现：

```ts
// vitest.config.ts

// -- 第一个 project，只改 exclude：把 fallback/ 排除掉保持不变。
{
  test: {
    name: 'integration',
    setupFiles: ['./test/integration/support/require-webgpu.ts'],
    include: ['test/integration/**/*.test.ts'],
    exclude: ['test/integration/fallback/**'],
    // ...provider 与 instances 原样保留...
  }
},

// -- 第二个 project，扩 include。
{
  test: {
    name: 'no-webgpu',
    setupFiles: ['./test/integration/support/require-no-webgpu.ts'],
    /*
     * Widened from `fallback/**` to also cover the four user stories, which is
     * the whole point of this project: the same test text, run again with the
     * WebGPU path gone, so "the fallback works" is a claim backed by the user
     * stories themselves rather than by a second copy of them.
     *
     * A whitelist, not `test/integration/**`. The gates and the backend smoke
     * tests all assert a real adapter and would fail here for a reason that has
     * nothing to do with their subject; a blacklist would have to name each of
     * them and would silently start including the next one somebody adds.
     *
     * The four are named rather than matched with `user-story-.*` because
     * `fallback/user-story-no-webgpu.test.ts` is also a user story and it means
     * something different here -- it is the file about this project's own
     * environment. It is picked up by the `fallback/**` line above, once.
     */
    include: [
      'test/integration/fallback/**/*.test.ts',
      'test/integration/user-story-(photo|video|camera-switch|media-failure).test.ts'
    ],
    // provider 原本只剩 --disable-gpu 一行；Task 5 给它补了 DPR 对齐，这是
    // include 之外该 project 唯一的功能性改动（整改轮另修了上方 --disable-gpu
    // 注释里一句过时的预言，见质量审 F3）：
    provider: playwright({
      launchOptions: { channel: 'chromium', args: ['--disable-gpu'] },
      // DPR parity with the integration project: a user story
      // (user-story-photo, "renders sharply on a high-DPI display")
      // hard-asserts devicePixelRatio === 2 precisely so it cannot
      // silently pass at DPR 1, which is what this project would hand
      // it without this line -- Playwright's default is 1. The only
      // intended difference between the two projects is the GPU; the
      // pixel density must not be a hidden variable that re-runs the
      // same text against a differently-shaped canvas.
      contextOptions: { deviceScaleFactor: 2 }
    }),
    headless: true,
    instances: [{ browser: 'chromium' }]
  }
}
```

> **四个文件因此跑两次，同一段代码。** 这是这个做法相对「把测试体抽成 helper、再写一个 spec 文件」的全部价值：不是**劝阻**重复，而是让重复不可能发生。唯一的例外是 photo 的 probe 断言：期望值从固定标签改为按浏览器实际状态推导——推导不是分叉，两个 project 跑的是同一段代码，各自算出各自的真值。

- [x] **Step 1: 让 `countDraws` 与 `captureRenderInputs` 覆盖两个后端**

`test/integration/support/spies.ts` 的两个入口现在都只包 `WebGPUBackend.prototype`。开工核实时发现（实现方 preflight STOP，协调者已在源里复核）：四个用户故事到达后端走的是 **`captureRenderInputs`**（photo 3 处 / video 3 处 / media-failure 1 处），不是 `countDraws`（它只有 dispose-order / viewer-events / viewer-render-input 用，那三个不进 `no-webgpu`）。所以两个都要扩，缺一个都会让 `no-webgpu` 里的绘制断言要么**空过**（`frames === 0` 对着没人调用的方法成立），要么**误红**（`sourceCalls() - before > 0` 恒假）。camera-switch 完全不用 spy；`captureTeardown` 包的是 ResizeObserver/EventEmitter 原型，本来就与后端无关。

```ts
import { vi } from 'vitest'
import { WebGPUBackend } from '../../../src/renderer/webgpu/backend'
import { WebGL2Backend } from '../../../src/renderer/webgl2/backend'

/**
 * Counts every frame drawn by whichever backend the viewer selected.
 *
 * Both prototypes as prophylaxis, not as coverage: no current caller of this
 * helper runs in the fallback project (its users -- dispose-order,
 * viewer-events, viewer-render-input -- are all outside that project's
 * include). Wrapping just the WebGPU one would let the first draw-counting
 * test that DOES run there arrive silently vacuous -- `toBe(0)` passing
 * against a method nobody calls -- which is worse than a red test, because
 * it survives review.
 *
 * The spies call through, and the reader sums the two accounts -- the same
 * shape `captureRenderInputs` gives `sourceCalls`. Calling through is the
 * point: a helper that stubs `render` hands a guaranteed-blank canvas to any
 * test that counts draws and then reads pixels.
 *
 * Returns a reader rather than a count: the callers snapshot it before and after
 * an action, and two reads of one number is what lets them.
 */
export function countDraws (): () => number {
  const spies = [
    vi.spyOn(WebGPUBackend.prototype, 'render'),
    vi.spyOn(WebGL2Backend.prototype, 'render')
  ]
  for (const spy of spies) spy.mockClear()
  return () => spies.reduce((total, spy) => total + spy.mock.calls.length, 0)
}
```

> **两个 spy 都是纯 spy（call-through），读数是两本账之和——与 `captureRenderInputs` 的 `sourceCalls` 同式。** 保持调用放行是刻意的：一个 stub 掉 `render` 的 helper 会把保证全黑的画布递给任何「数完帧再读像素」的测试；本轮整改把首落地时的 stub 改回了调用放行（质量审 F2：stub 并非双后端目标所需，对只读计数的调用方，两种写法可观察行为完全一致）。
>
> **`afterEach(() => { vi.restoreAllMocks() })` 是必须的**，P5 的 US2 与 US4 已经写了。恢复之后 `render` 回到真实现，下一个测试才画得出东西 —— 少了它，一个文件里后面的每个测试都会拿到被掏空的 `render`。

`captureRenderInputs` 以同样的方式扩到两个原型（整改后两个 helper 都是纯 spy）：用户故事在它之后做像素断言，一个被掏空的 `setSource` 会让那些断言变成「对着没人渲染过的帧」。

```ts
/**
 * Records what the viewer hands the backend on each frame.
 *
 * `countDraws` above answers "did the loop run"; this answers "with what",
 * which is a different question and one no pixel comparison can reach. A
 * viewer that called `setSource(null)` for ever, or pinned the camera to the
 * origin, would still draw the right NUMBER of frames -- so a suite built only
 * on `countDraws` stays green through both, as the quality review measured.
 *
 * Both spies call through. These tests assert on the arguments, not on a
 * stubbed-out backend: replacing `setSource` with a recorder would leave the
 * real backend never told about the source, and every pixel assertion made
 * afterwards would be about a frame nobody rendered.
 *
 * BOTH prototypes, for the same reason `countDraws` wraps both: the same
 * user-story file runs in two projects and only one backend exists in each.
 * At most one of the two accounts is ever non-empty -- "the last call" is the
 * last call of whichever one is, and `sourceCalls` is their sum for the same
 * reason the draw counter is one number.
 */
export function captureRenderInputs (): {
  readonly lastSource: () => RenderableSource | null | undefined
  readonly lastCamera: () => { state: CameraState, projection: Projection } | undefined
  readonly sourceCalls: () => number
} {
  const sources = [
    vi.spyOn(WebGPUBackend.prototype, 'setSource'),
    vi.spyOn(WebGL2Backend.prototype, 'setSource')
  ]
  const cameras = [
    vi.spyOn(WebGPUBackend.prototype, 'setCamera'),
    vi.spyOn(WebGL2Backend.prototype, 'setCamera')
  ]
  for (const spy of [...sources, ...cameras]) spy.mockClear()

  return {
    // `undefined` means "never called", `null` means "called with no source".
    // Collapsing the two would make the not-yet-loaded case indistinguishable
    // from a backend the viewer never spoke to at all.
    lastSource: () => {
      for (const spy of sources) {
        if (spy.mock.calls.length > 0) return spy.mock.calls.at(-1)?.[0]
      }
      return undefined
    },
    lastCamera: () => {
      for (const spy of cameras) {
        const call = spy.mock.calls.at(-1)
        if (call !== undefined) return { state: call[0], projection: call[1] }
      }
      return undefined
    },
    sourceCalls: () => sources.reduce((total, spy) => total + spy.mock.calls.length, 0)
  }
}
```

- [x] **Step 2: 把 US5 翻成正面断言**

`test/integration/fallback/user-story-no-webgpu.test.ts` 现在断言 `probe()` 是 `'none'`、`create()` 抛异常 —— 那是 P6 还没落地时的诚实结果。**现在它要翻过来**，这正是那个文件存在的意义（P5 的交接表里点名了这件事）。落地版相对本计划初稿有三处修正：`create()` 必须带 `src`（`ImageViewerOptions.src` 是必填，缺了在 `assertSrc` 就抛）；两处对 probe 结果的字段读取前要先收窄掉 `SelectedCapabilities` 的 `'none'` 分支（否则过不了 typecheck）；外加协调者裁定的 probe-vs-constructed `maxTextureDimension` 相等断言（钉住 Task 3 的 probe 修正）：

```ts
import { describe, expect, it, vi } from 'vitest'
import { FramelessImageViewer } from '../../../src/index'
import { canvasOf, makeContainer } from '../support/dom'
import { countNonBlack, nextFrames, readCanvas } from '../support/canvas'

/*
 * US5: running where WebGPU is unavailable.
 *
 * No mask, no addInitScript, no control group. This file runs in the
 * `no-webgpu` project, which launches Chromium with --disable-gpu, and
 * `require-no-webgpu.ts` asserts in a beforeAll that the adapter really is
 * absent AND that WebGL2 is still there -- so if the flag ever stops taking
 * effect this file fails loudly instead of quietly re-testing the WebGPU path.
 *
 * The environment is the mask. That is why there is no third control test here:
 * a project does not have the failure mode a shim does, because there is no
 * shim to fail. (P5's version of this file asserted the honest pre-P6 outcome,
 * that create() threw. P6 flips it -- see the completion criteria.)
 */
describe('US5: running where WebGPU is unavailable', () => {
  it('probe() reports webgl2 instead of throwing', async () => {
    // probe() must never throw: its whole reason for existing is to be callable
    // before anything is constructed, so that a caller can decide what to do
    // about a machine with no usable backend.
    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('webgl2')
    // `SelectedCapabilities` has a 'none' arm that carries nothing else, so the
    // reads below need the union narrowed. The throw is for the compiler: the
    // line above has already made it unreachable.
    if (caps.backend === 'none') throw new Error('probe() reported no backend')
    // The WebGPU-only capability is dropped along with the label. A backend
    // reporting webgl2 with externalTextures: true sends callers down a path
    // this backend cannot serve.
    expect(caps.externalTextures).toBe(false)
  })

  it('the viewer renders the panorama instead of throwing', async () => {
    // The end-to-end form of the same claim: not "the label says webgl2", but
    // "a 360 photo appears". Before P6 this threw.
    const container = makeContainer()
    // `src` is required at construction (the frozen surface has no src-less
    // viewer), and re-assigning the same URL once the listeners are on is what
    // keeps the load observable: the construction-time load may land before a
    // listener could attach, and the swap through the public setter is a real
    // load either way.
    const viewer = await FramelessImageViewer.create({ container, src: '/fixtures/panorama.png' })
    const losses: unknown[] = []
    viewer.on('device-lost', e => losses.push(e))
    const loaded: string[] = []
    viewer.on('media-load', () => loaded.push('load'))
    viewer.src = '/fixtures/panorama.png'

    await vi.waitFor(() => expect(loaded).toContain('load'), { timeout: 5000 })
    await nextFrames(2)
    const image = await readCanvas(canvasOf(container))
    const backend = viewer.capabilities.backend
    // Pins Task 3's probe fix end to end: probe() (which reads MAX_TEXTURE_SIZE
    // when there is no adapter) and a constructed viewer must report the SAME
    // clamped maxTextureDimension, not just the same backend label. A probe
    // that under-reports would make apps pre-downscale sources the viewer can
    // actually take.
    const probed = await FramelessImageViewer.probe()
    const constructed = viewer.capabilities.maxTextureDimension
    viewer.dispose()

    expect(backend).toBe('webgl2')
    // Same narrowing as test 1: 'none' is the arm with no maxTextureDimension,
    // and probe() answering it here is itself the failure.
    if (probed.backend === 'none') throw new Error('probe() reported no backend')
    expect(constructed).toBe(probed.maxTextureDimension)
    expect(countNonBlack(image)).toBeGreaterThan(0.2 * image.width * image.height)
    // A downgrade is not a device loss, and reporting it as one would make every
    // consumer's error path fire on a page that is working perfectly.
    expect(losses).toHaveLength(0)
  })
})
```

- [x] **Step 3: photo 的 probe 断言改为按环境推导**

include 扩容后（Step 1 的 config 块），同一份 photo 文本要在两个 project 里跑，而它有一条断言钉死了 `probe() === 'webgpu'` —— 那是 `integration` 一方的真值，在 `--disable-gpu` 下就是谎言（US5 的第一条测试断言的恰恰是 `'webgl2'`）。这条测试自称「US5 的另一半」，它的真值本来就随环境而变，所以期望值改为从浏览器实际状态推导，且推导放在 probe 调用**之前**：地面真值先行，被测物其次。这是四个文件里唯一的环境钉死字面量（开工时逐文件扫过：'webgpu'/'adapter'/`navigator.gpu`/`externalTextures`/`devicePixelRatio` 全查）。落地文本：

```ts
  it('an application can ask about the backend before it creates anything', async () => {
    /*
     * The other half of US5, and the one environment-pinned literal this file
     * carries: the same text runs in two projects, and a FIXED backend label
     * would be true in one and a lie in the other. The expectation is derived
     * from the browser's actual state instead -- independently of probe(),
     * which is the thing under test -- so the assertion stays "probe() reports
     * the truth of whichever environment it runs in", in both projects. A
     * probe that misreported in either direction is the legacy silent
     * downgrade back again: "ask first, then decide" was the whole reason
     * probe exists, and an answer that cannot be trusted in the good case is
     * worse than none.
     */
    const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe(adapter !== null ? 'webgpu' : 'webgl2')
  })
```

- [x] **Step 4: 跑全部**

Run: `npm test`
Expected: 全 PASS。**四个用户故事要在两个 project 里各出现一次** —— 只出现一次是 `include` 没生效，不是测试通过：

```bash
npx vitest list --project no-webgpu 2>/dev/null | grep -c "user-story-"
npx vitest list --project integration 2>/dev/null | grep -c "user-story-"
```

Expected: 两条都大于 0。

**如果 `no-webgpu` 里红的是绘制计数**：`countDraws` / `captureRenderInputs` 没覆盖到 `WebGL2Backend`（Step 1）。**如果红的是画面**：`preserveDrawingBuffer` 没开，于是 `readCanvas` 的 `toDataURL` 拿到的是清屏后的黑 —— 见「明确的非目标」里那一条。

- [x] **Step 5: Commit**

```bash
git add vitest.config.ts test/integration/support/spies.ts \
  test/integration/fallback/user-story-no-webgpu.test.ts \
  test/integration/user-story-photo.test.ts \
  docs/superpowers/plans/2026-09-19-p6-webgl2-backend.md
git commit -m "task-p6-webgl2-backend: test(viewer): run every user story against the WebGL2 backend

Widening the no-webgpu project's include, not writing a second spec file. The
user-story tests are the same text run twice, so there is no second copy to
drift -- a stronger guarantee than extracting shared helpers gives. The project
is a whitelist: the gates all assert a real adapter and would fail there for a
reason unrelated to their subject.

The user stories reach the backend through captureRenderInputs, not
countDraws -- the plan's Task 5 premised the wrong spy. Both are widened to
wrap BOTH prototypes: countDraws with one shared counter (its assertions only
ever read counts), captureRenderInputs with call-through spies on two
accounts, at most one of which is non-empty in any project.

The no-webgpu provider also gains the integration project's
deviceScaleFactor: 2 -- photo's high-DPI story hard-asserts DPR 2 so it cannot
silently pass at 1, and the only difference between the projects is meant to
be the GPU.

One photo assertion moves from a fixed label to a derived one: its probe test
pinned backend === 'webgpu', which is the integration project's truth and a
lie under --disable-gpu. The expectation now comes from the browser's actual
adapter state, measured independently of probe(), so the same text asserts
\"probe() tells the truth\" in both projects instead of in one.

US5 flips to the post-P6 truth: probe() reports webgl2 and create() renders,
with probe's and the constructed viewer's clamped maxTextureDimension pinned
equal.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 降级路径（spec §9.7）

**Files:**
- Create: `test/integration/backend-downgrade.test.ts`
- Create: `test/integration/fallback/backend-unavailable.test.ts`

spec §9.7 的「后端降级」一行要求：**屏蔽 `navigator.gpu`，断言走 WebGL2**。三种环境都要有：

| 环境 | 怎么造 | 期望 | 在哪个 project |
|---|---|---|---|
| 没有 WebGPU，有 WebGL2 | 测试体内 `delete Navigator.prototype.gpu` | 选 WebGL2 并正常渲染 | `integration`（那里有真 WebGPU，所以屏蔽是一次真的改变） |
| 有 WebGPU，拿不到适配器 | **`--disable-gpu`（P1 的 `no-webgpu` project）** | 同上 —— **这是 spec §9.7 里最容易漏的一条**：`navigator.gpu` 存在不等于有 GPU | `no-webgpu`，就是 Task 5 的 US5 |
| 两者都没有 | 在 `no-webgpu` 里再让 `getContext('webgl2')` 返回 `null` | `create()` 抛异常，且消息说清是哪个后端不可用 | `no-webgpu` 的 `fallback/` |

**中间那条不需要新文件** —— Task 5 的 `fallback/user-story-no-webgpu.test.ts` 就是它，而且是**真环境**（启动参数），不是掩码。这正是浏览器模式相对 Playwright 的简化：三种环境里有一种是项目自带的，另两种各是一次进程内的赋值，没有 `addInitScript`、没有「掩码装上了没有」的跨进程时序问题。

> **`--disable-features=WebGPU` 是无效的**（实测：适配器照样出现），要造这条环境只能用 `--disable-gpu`。而 `--disable-gpu` 会同时**保住 WebGL2**（走 SwiftShader），正好是这里要的那个形状。**不要**再加 `--disable-software-rasterizer`：那会把 WebGL2 一起干掉，于是测的是「两个都没有」，而不是「一个都没有」。

- [x] **Step 1: 环境一 —— 没有 `navigator.gpu`**

`test/integration/backend-downgrade.test.ts`（`integration` project）：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FramelessImageViewer } from '../../src/index'
import { canvasOf, makeContainer } from './support/dom'
import { countNonBlack, nextFrames, readCanvas } from './support/canvas'

/*
 * spec section 9.7: "block navigator.gpu and assert that it goes to WebGL2".
 *
 * This file runs in the `integration` project, where a real WebGPU adapter
 * exists -- so removing it here is a real change of state rather than a
 * no-op that would pass either way. That is the whole reason this environment
 * gets its own file and its own project, instead of being folded into the
 * fallback one.
 *
 * The mask is a plain assignment in the test body, not an init script. There is
 * no process boundary in browser mode, so there is no ordering question: the
 * probe reads `navigator.gpu` when it is called, and it is called after this.
 *
 * The downgrade is a programmable state (section 6.5), not a log line, so what
 * is asserted is the reported state -- `probe()` before construction and
 * `viewer.capabilities` after it -- plus the fact that the fallback renders. An
 * application that wants to tell the user "your browser is using the slower
 * renderer" reads it from exactly these two places.
 *
 * There is deliberately no `downgraded` event. The public event surface is
 * frozen (P5, src/index.ts) and a downgrade is a state, not an occurrence: it
 * is true from before the viewer exists, so there is no moment at which it could
 * fire. `device-lost` is the event for a backend that died, which is a different
 * thing and is tested in webgl2-smoke.
 */

const HAD_GPU = 'gpu' in Navigator.prototype

afterEach(() => {
  // Restored explicitly, not left to the next test file's fresh page: tests in
  // one file share a page, so a mask that outlives its test would make every
  // later test in this file run in the wrong environment -- and green.
  if (HAD_GPU) {
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => undefined
    })
  }
})

describe('WebGPU absent, WebGL2 present', () => {
  it('the premise holds: this project really had an adapter to take away', async () => {
    // Without this, a project that had silently stopped providing WebGPU would
    // make everything below pass while measuring nothing.
    expect(HAD_GPU).toBe(true)
    const adapter = await navigator.gpu.requestAdapter()
    expect(adapter, 'the integration project has no adapter, so this file has nothing to remove').not.toBeNull()

    delete (Navigator.prototype as { gpu?: unknown }).gpu
    expect('gpu' in navigator).toBe(false)
  })

  it('probe() reports webgl2 before anything is constructed', async () => {
    // `delete` on the prototype, not an own property set to undefined: the probe
    // tests `'gpu' in navigator`, which stays true for a shadowing property, and
    // the next line would then call requestAdapter() on undefined.
    delete (Navigator.prototype as { gpu?: unknown }).gpu

    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('webgl2')
    // The 'none' arm carries no externalTextures, so the read below needs the
    // union narrowed; the throw is for the compiler, the line above already
    // made it unreachable.
    if (caps.backend === 'none') throw new Error('probe() reported no backend')
    expect(caps.externalTextures).toBe(false)
  })

  it('the viewer renders the panorama instead of throwing', async () => {
    delete (Navigator.prototype as { gpu?: unknown }).gpu

    const container = makeContainer()
    // `src` is required at construction (the frozen surface has no src-less
    // viewer), and re-assigning the same URL once the listeners are on is what
    // keeps the load observable: the construction-time load may land before a
    // listener could attach, and the swap through the public setter is a real
    // load either way.
    const viewer = await FramelessImageViewer.create({ container, src: '/fixtures/panorama.png' })
    const losses: unknown[] = []
    viewer.on('device-lost', e => losses.push(e))
    const loaded: string[] = []
    viewer.on('media-load', () => loaded.push('load'))
    viewer.src = '/fixtures/panorama.png'

    await vi.waitFor(() => expect(loaded).toContain('load'), { timeout: 5000 })
    await nextFrames(2)
    const image = await readCanvas(canvasOf(container))
    const result = { backend: viewer.capabilities.backend, losses: losses.length }
    viewer.dispose()

    expect(result.backend).toBe('webgl2')
    expect(countNonBlack(image)).toBeGreaterThan(0.2 * image.width * image.height)
    expect(result.losses).toBe(0)
  })
})
```

> **`afterEach` 里重新 `defineProperty` 而不是 `delete`。** `Navigator.prototype.gpu` 在 Chromium 上是一个继承来的访问器，`delete` 掉之后没有「原来的值」可以放回去 —— 只有测试开头记下的 `HAD_GPU` 这一个事实。把它定义成一个返回 `undefined` 的 getter 让 `'gpu' in navigator` 重新为真，这对 `integration` project 里**后面的其他文件**没有影响（每个文件一个新页面），但能让这个文件里后面的测试拿到一致的状态。

- [x] **Step 2: 环境三 —— 两个后端都没有**

`test/integration/fallback/backend-unavailable.test.ts`（`no-webgpu` project）：

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FramelessImageViewer } from '../../../src/index'
import { makeContainer } from '../support/dom'

/*
 * Neither backend. This is the one environment that has no real-world
 * equivalent worth reproducing with a launch flag -- a browser that has WebGL2
 * but no WebGPU and refuses to give a context -- so it is masked.
 *
 * It builds on the no-webgpu project rather than replacing it: that project
 * already guarantees the adapter is absent (require-no-webgpu.ts asserts it), so
 * this file only has to take WebGL2 away. Masking both here would mean the
 * project's own guard could stop working and nothing would notice.
 *
 * `getContext` is patched on the prototype and only for 'webgl2'. Blanking every
 * context type would also break the 2D canvas that P1's readCanvas uses, and the
 * test would then fail while constructing its own tools.
 */

const original = HTMLCanvasElement.prototype.getContext

beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    if (type === 'webgl2') return null
    return (original as (...args: unknown[]) => unknown).call(this, type, ...rest)
  } as typeof HTMLCanvasElement.prototype.getContext
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = original
})

describe('neither backend available', () => {
  it('create() rejects, naming the situation', async () => {
    // Constructing a viewer that can never draw is what the legacy createProgram
    // did: it logged, returned null, and the viewer reported success. A viewer
    // that cannot render is not a viewer.
    const container = makeContainer()
    const canvases = (): number => document.querySelectorAll('canvas').length
    const before = canvases()

    const attempt = async (): Promise<string> => {
      try {
        // `src` is required and validated BEFORE the backend is chosen, so it
        // must be a real URL here: without it the throw would be 'src must be
        // a string' and the assertion below would never see the backend's own
        // message.
        await FramelessImageViewer.create({ container, src: '/fixtures/panorama.png' })
        return ''
      } catch (error) {
        return String(error)
      }
    }

    const first = await attempt()
    // A second attempt, to show the failure is a property of the environment and
    // not of state the first one left behind.
    const second = await attempt()

    expect(first).toMatch(/no usable rendering backend/i)
    expect(second).toMatch(/no usable rendering backend/i)
    // And it did not leave a canvas in the DOM. No viewer-count hook is asserted
    // here: P5 exposes none, and the viewer phase owns that surface -- inventing
    // one from P6 would put a second owner on it.
    expect(canvases()).toBe(before)
  })

  it('probe() reports none rather than throwing', async () => {
    // probe() must be usable to decide what to do BEFORE constructing anything,
    // which means it cannot be the thing that throws.
    const caps = await FramelessImageViewer.probe()
    expect(caps.backend).toBe('none')
  })
})
```

- [x] **Step 3: 跑**

Run: `npx vitest run --project integration backend-downgrade && npx vitest run --project no-webgpu fallback`
Expected: 8 个测试 PASS（3 + 5）。第二条命令的 `fallback` 过滤器按路径选中 `fallback/` 下全部三个文件：backend-unavailable 2 + US5 搭车 2 + smoke 搭车 1（原稿「3 + 2」漏算了 US5，而 US5 之外 smoke 同样住在 `fallback/` 下、同样被过滤器选中，如实数字是 5）

**如果「the premise holds」就红**：这个 project 本来就没有适配器，说明 `require-webgpu.ts` 或 `channel: 'chromium'` 没生效 —— 那比这条测试红严重得多。**如果 `create()` 没有抛**：查 `getContext` 的补丁是不是被后加载的别的库换掉了（本文件的 `beforeEach` 每次重装，所以只有同一个测试体内才可能）。

- [x] **Step 4: Commit**

```bash
git add test/integration/backend-downgrade.test.ts test/integration/fallback/backend-unavailable.test.ts
git commit -m "test(viewer): the two degraded environments a project cannot provide

Spec 9.7's downgrade row. One of the three environments is the no-webgpu
project itself (--disable-gpu), which is a real environment rather than a shim
and is covered by user-story-no-webgpu; the other two are a mask apiece, in the
project where each is a real change of state.

The no-adapter case -- navigator.gpu exists and requestAdapter() returns null --
is the one easiest to miss, and it is exactly what --disable-gpu produces."
```

---

## 完成标准

- [ ] 门禁 C 的 18 条全绿，容差未被放宽
- [ ] P5 的四个用户故事文件**除 photo 的后端标签断言外一字不改**（该断言的期望值改为从浏览器实际状态推导，推导不是分叉：两个 project 跑同一段代码，各自算出各自的真值），在两个 project 下各跑一遍且都绿
- [ ] `fallback/user-story-no-webgpu.test.ts` 已从「`probe()` 是 `none`、`create()` 抛」翻成「`probe()` 是 `webgl2`、`create()` 成功并画出画面」
- [ ] 三种降级环境各有一条测试，且**每一种在自己的 project 里都是真的状态改变**（环境一里有真适配器可以拿掉，环境二靠启动参数，环境三在环境二之上）
- [ ] `capabilities.backend === 'webgl2'` 且 `externalTextures === false`，且这个值来自 `describeCapabilities`
- [ ] `countDraws` 与 `captureRenderInputs` 覆盖两个后端，`no-webgpu` project 下的绘制计数不空过
- [ ] 着色器编译失败会抛异常，不返回死后端
- [ ] 连续创建/销毁 20 个后端不耗尽上下文额度
- [ ] `webglcontextlost` 被 `preventDefault()` 并上报 `{ reason: 'context-lost' }`；`webglcontextrestored` 后能重新画出画面
- [ ] `npm run build` 成功，且 `dist/index.js` 里能找到 `#version 300 es`（`?raw` 通道两端都通）
- [ ] `npm run typecheck` 干净（两条 program）
- [ ] **`src/index.ts` 的导出面与 P5 一致**（后端替换不改变公开 API）
- [ ] **`demo/` 一个字节都没改**

## 明确的非目标

- **不为 WebGL2 做性能优化。** 它是降级路径。`preserveDrawingBuffer: true` 是这条定位下的一次明确取舍：代价是每帧一次缓冲拷贝，换来的是任何在稍后任务里读画布的人（包括每一个用户故事测试）看到的不是黑屏。**这条不是可选的** —— P5 的 `readCanvas` 走 `canvas.toDataURL`，没有它，WebGL2 下的每一条像素断言读到的都是清屏后的黑，而那看起来像「后端画错了」。
- **不加 WebGL2 独有的能力探测维度。**
- **不把两份着色器合并成一个生成器。** 转写 + 门禁 C 是当前的取舍；如果哪天两份漂得太频繁，再考虑生成器，那时它才是有依据的。
- **不做上下文丢失后的自动重画。** spec §6.4 把本期限定为「检测 + 干净释放」，而 `setSource` 的契约（不得在本次任务之后保留 `source.element`）意味着恢复时已无像素可重新上传。所以恢复后的行为是：程序与 uniform 重建、纹理丢弃，**下一次交互或下一帧视频时重新画出**；静止图像会停在黑屏，直到应用做点什么。要真正的自动恢复，需要一个「请重画」的通道，那是接口的增量改动，不属于本计划。

## 关于 golden image：P6 不需要它

P3 的「不上榜的部分」把 golden image 与跨后端交叉验证一起推给了 P6。**跨后端比较是门禁 C，P6 做了。golden image 不需要再建一套**，理由：

- **P0 的基线就是 golden image，而且已经在跑。** `test/fixtures/baseline/` 是从 v0.2.2 抓下来的 PNG，P3 的 `gate-a-pixels.test.ts` 拿新渲染器逐像素对拍并跑在同一条流水线上。再建一套 golden 只会多一份要重新生成的图片、多一个要争论的容差，而验的是同一件事：新渲染器与出厂版本一致。
- **golden image 表达不了 P6 真正要加的那条信息。** 一张图只能回答「和某个已知的正确结果比，像不像」；门禁 C 要回答的是「两份手写源码是否一致」，那是两个后端之间的关系，没有第三个对象可以当 golden。
- **基线的权威性是有前提的**：门禁 A 必须先绿，门禁 C 的容差才有意义 —— 两个后端一起错、且错得与 v0.2.2 一样，是门禁 C 看不见的失败模式，而门禁 A 看得见。**所以执行顺序是 A 绿了再跑 C**，这一点写进 Task 4 的失败分流表。

## 关于 CI：WebGPU 路径在 CI 上真的跑起来需要什么

门禁 C 与后端冒烟测试都必须在**真有 WebGPU 适配器**的浏览器里跑 —— `integration` project 的 `require-webgpu.ts` 会把「没有适配器」变成一条 `beforeAll` 失败，而不是让整批测试空跑。

**在 CI 上这取决于 `vitest.config.ts` 里的两件事，而它们属于 P1**（本计划一个字都不改，只是把验收要求写在这里）：

1. `channel: 'chromium'` —— Playwright 默认的 `chrome-headless-shell` 没有 GPU 栈，WebGL 走 SwiftShader 而 WebGPU 拿不到适配器。少了这一行，**整条 WebGPU 侧会空跑而 CI 全绿**（spec §9.5）。
2. **如果 CI 的 runner 上 Chromium 仍拿不到适配器**，需要的启动参数是 `--enable-unsafe-webgpu` **加** `--use-webgpu-adapter=swiftshader`，两个一起才有效（实测；单独任意一个仍然返回 null）。它们挂在 **provider 工厂**的 `launchOptions.args` 上，不在 `instances[].launch` 里 —— 后者会被 Vitest 静默忽略。**环境变量也不行**：没有任何一个环境变量能让 Chromium 拿到适配器。

**验收要求写在这里，免得它变成一个「CI 绿了但其实没跑」的静默通过**：`test/integration/smoke.test.ts` 里那条「the browser has a real WebGPU adapter」必须真的 PASS。它红了就说明门禁 C 这一批测试没有意义，而不是说明 GPU 有问题。
