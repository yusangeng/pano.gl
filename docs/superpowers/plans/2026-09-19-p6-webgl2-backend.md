# P6 — WebGL2 backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 第二个后端。四个投影在 WebGL2 下与 WebGPU 逐像素一致（门禁 C），P5 的全部用户故事在 WebGL2 下同样通过。

**Architecture:** 同一个 `Backend` 接口的第二个实现。**着色器是转写的，不是生成的** —— 四个投影公式在两份源码里各写一遍，门禁 C 是它们不漂移的唯一保证。

**Tech Stack:** WebGL2 / GLSL ES 3.00 · Playwright

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
| `?raw` 着色器导入通道 | P3 Task 3 的说明 + 本计划 Task 1 | vitest 与 demo 走 Vite 的 `?raw`；**tsup 走 esbuild，没有 `?raw` 这个约定**。缺 loader 会让 `npm run test:unit` 全绿而 `npm run build` 失败 |
| `gpuPage` fixture | P1 | 门禁 C 与后端冒烟测试都在真 WebGPU 页面里跑 |
| `extent` 由调用方给 | P2 | `Projection` 的非线性分支带 `extent`（圆柱 1×1，planet/pannini 4×4）。它不在几何里，也不由后端推导 |
| `demo/test-entry-hooks/` 的 hook 约定 | P3 Task 3 | 页面侧出口是**一期一个 hook 文件**，用 `declare global` 自己加宽 `PanoTestApi`，由 `import.meta.glob` 合并。**P6 因此不编辑 `demo/test-entry.ts`** |
| `renderOffscreen` / `maxChannelDiff` | P3 Task 7，`test/integration/support/gpu.ts` | 门禁 C 的 WebGPU 半边与差值计算都用它们。**门禁 C 的主张是关于出厂着色器的，所以 WebGPU 侧必须走出厂路径**，而不是一个为了对上这个测试而写的 harness |
| `RenderRequest` / `RenderResult` | P3 Task 3，`demo/test-entry-hooks/renderer.ts` | `renderOffscreenGLSL` 用**同一个**请求/响应类型。两个 harness 输入不同，比的就是 harness 而不是着色器 |
| P5 把它的 hook 加进 `PanoTestApi` | P5「测试入口需要导出什么」节，落在 `demo/test-entry-hooks/viewer.ts` | Task 5/6 的页面调用写的是 `window.__panoTest.createImageViewer(...)` / `waitFor` / `readCanvas` / `countNonBlack` / `probe`。**P6 不写 `as unknown as`**（P3 明令禁止），所以这些成员必须已经在 `PanoTestApi` 上 |

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
| `demo/test-entry-hooks/webgl2.ts` | 页面侧出口：4 条冒烟 hook（Task 3）+ 2 条门禁 C hook（Task 4） |
| `demo/test-entry-hooks/cross-backend.ts` | 页面侧出口：门禁 C 的 CPU 裁判 |
| `test/integration/support/cross-backend.ts` | 门禁 C 的 Playwright 侧工具 |
| `test/integration/support/backend.ts` | 「没有 WebGPU / 没有适配器 / 什么都没有」三种页面 fixture |
| `test/integration/webgl2-smoke.test.ts` | 后端自身的冒烟 + 上下文丢失/恢复（Task 3） |
| `test/integration/gate-c-cross-backend.test.ts` | **门禁 C**（Task 4） |
| `test/integration/backend-downgrade.test.ts` | spec §9.7 的降级场景（Task 6） |

> `support/backend.ts` **用的是 P5 文件表里已经预留的那个名字**（P5 的表格写着「后端环境掩码：让测试能关掉 WebGPU」，但 P5 的 Task 2–6 没有任何一条创建或使用它）。本计划把它建出来，不再另起一个名字 —— 两个文件做同一件事，是这份计划最容易制造的重复。

**Modify：**

| 文件 | 改动 | 归属 |
|---|---|---|
| `tsup.config.ts` | esbuild 的 `?raw` 插件（Task 1） | P1 创建，P3 已经在改同一个对象 |
| `src/viewer/backend-factory.ts` | `createBackend` 加 WebGL2 分支（Task 3） | P5 |
| `playwright.config.ts` | 第二个 project `chromium-webgl2`（Task 5） | P1 |
| `test/integration/support/fixtures.ts` | 按 project 注入 `navigator.gpu` 屏蔽 + 按 project 换守卫（Task 5） | P1 |
| `test/integration/user-story-no-webgpu.test.ts` | 删除，由 `backend-downgrade.test.ts` 取代（Task 6） | P5 |

**P5 的四个用户故事文件（photo / video / camera-switch / media-failure）不需要改一个字。** 见 Task 5。

---

### Task 1: GLSL ES 3.00 着色器

**Files:**
- Create: `src/renderer/webgl2/shaders/panorama.glsl`
- Create: `src/renderer/webgl2/shaders/index.ts`
- Modify: `tsup.config.ts`
- Test: `test/unit/webgl2-shaders.test.ts`

- [ ] **Step 1: 转写**

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
// Wrapping happens here rather than in the sampler. The legacy shader did none
// at all: it handed texture2D a raw ratio and the texture object's default
// REPEAT wrap did the work. The WebGPU backend's external-texture entry point
// has no wrap-capable sampler at all (textureSampleBaseClampToEdge clamps), so
// both backends wrap in the shader to stay identical.
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

- [ ] **Step 2: 让 tsup 也认 `?raw`**

`?raw` 是 Vite 的约定（vitest 与 demo 都走 Vite）。**esbuild 没有这个约定** —— 它会把 `./panorama.glsl?raw` 当成一个真实的文件名去找，然后解析失败。所以 `npm run test:unit` 会通过而 `npm run build` 会失败，这是最难受的一种失败顺序。在 `tsup.config.ts` 里加一个 resolve 插件：

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Options } from 'tsup'

/**
 * Vite's `?raw` suffix, for esbuild.
 *
 * The shaders live in real `.glsl` / `.wgsl` files so that editors highlight
 * them, and `?raw` is how the Vite-based builds (vitest, the demo) read one as
 * text. esbuild has no such convention, so without this plugin `tsup` looks for
 * a file named "panorama.glsl?raw" and fails -- while `npm run test:unit` stays
 * green. The query is stripped here and the file is loaded as text.
 *
 * A plain `loader: { '.glsl': 'text' }` does NOT work: the loader is chosen
 * after resolution, and resolution is what the query breaks.
 */
function rawQueryPlugin (): NonNullable<Options['esbuildPlugins']>[number] {
  const namespace = 'raw-query'

  return {
    name: 'raw-query',
    setup (build) {
      build.onResolve({ filter: /\?raw$/ }, args => ({
        path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
        namespace
      }))
      build.onLoad({ filter: /.*/, namespace }, async args => ({
        contents: await readFile(args.path, 'utf8'),
        loader: 'text'
      }))
    }
  }
}

export default defineConfig({
  // ...existing options unchanged...
  esbuildPlugins: [rawQueryPlugin()]
})
```

> 现在 `tsup` 与 `vite` 用**同一个 import 写法**（`from './x.glsl?raw'`）读同一份文件。**不要退回到把着色器内联进 TS**：那会牺牲着色器文件的语法高亮，而这是长期维护里最值钱的东西。

- [ ] **Step 3: 写结构与一致性测试**

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

- [ ] **Step 4: 跑测试**

Run: `npm run test:unit -- webgl2-shaders`
Expected: 11 个测试 PASS

- [ ] **Step 5: 证明构建也认这份着色器**

`?raw` 的接线是否成立，单元测试证明不了 —— vitest 走 Vite，它当然认。这一步是唯一能证明 tsup 也认的地方：

```bash
npm run build
grep -c "#version 300 es" dist/index.js
```

Expected: 构建成功，`grep` 输出 ≥ 1（着色器源码真的进了产物，而不是被解析成外部资源引用）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/webgl2/shaders/ test/unit/webgl2-shaders.test.ts tsup.config.ts
git commit -m "feat(renderer): GLSL ES 3.00 transcription of the panorama shader

Transcribed by hand from the post-Task-8 WGSL: the two languages are far
enough apart that a translator would be its own project, and a subtly wrong
translator is worse than two files a human can read side by side. Gate C is
what keeps them from drifting.

The ?raw suffix is Vite's convention, so tsup gets a resolve plugin; an
esbuild text loader alone would not work, because resolution is what the
query breaks."
```

---

### Task 2: 上下文与程序

**Files:**
- Create: `src/renderer/webgl2/context.ts`
- Test: `test/unit/webgl2-errors.test.ts`

**背景**：WebGL 的错误模型和 WebGPU 相反 —— **同步、不抛、只设一个标志位**。`getShaderParameter(COMPILE_STATUS)` 返回 `false`，你必须主动去问。旧代码在这里 `log` 了一行然后 `return null`（缺陷 F7）。

- [ ] **Step 1: 写失败测试**

`test/unit/webgl2-errors.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { compileShader, linkProgram, describeShaderError } from '../../src/renderer/webgl2/context'

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

  it('detaches and deletes both shaders on success', () => {
    // Once linked, the shader objects are no longer needed. Keeping them is a
    // small leak per backend construction, which matters when a viewer is
    // recreated on every camera swap.
    const gl = fakeGl(true)
    const vs = gl.createShader(0)!
    const fs = gl.createShader(0)!
    linkProgram(gl, vs, fs)
    expect(gl.deleteShader).toHaveBeenCalledWith(vs)
    expect(gl.deleteShader).toHaveBeenCalledWith(fs)
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

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- webgl2-errors`
Expected: FAIL —— 无法解析 `../../src/renderer/webgl2/context`

- [ ] **Step 3: 实现**

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
    // The shader outputs exactly what the source contains. Letting the browser
    // post-multiply introduces a difference against the WebGPU backend that
    // gate C would then have to tolerate.
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

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- webgl2-errors`
Expected: 10 个测试 PASS

- [ ] **Step 5: Commit**

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
- Create: `demo/test-entry-hooks/webgl2.ts`
- Test: `test/integration/webgl2-smoke.test.ts`

- [ ] **Step 1: 实现**

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
  // uniform location with it, and both are rebuilt in #restore().
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
    // No power-of-two requirement in WebGL2, so a plain clamp + linear is
    // correct at any size. The legacy path could not use these because WebGL1
    // restricts NPOT textures to NEAREST + CLAMP_TO_EDGE. These are also the
    // modes the WebGPU sampler uses, which is what keeps the two comparable.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
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

- [ ] **Step 2: 接进 `backend-factory.ts`**

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

> **`probe()` 不用改。** 它已经在用 `describeCapabilities`，而 WebGL2 分支的 `maxTextureDimension` 钳位就在那个函数里（P3 Task 1）。`createBackend` 与 `probe` 因此对同一台机器给出同一个 `backend` —— 这正是「降级是可编程状态」的意思：应用可以在构造之前先问，且问到的就是将要发生的。
- [ ] **Step 3: 页面侧出口**

**新的 hook 文件，不改 `demo/test-entry.ts` 的实现。** P3 把测试出口拆成了 `demo/test-entry-hooks/*.ts`，由 `import.meta.glob` 自动合并，就是为了让 P4 与 P6 各加各的而不互相编辑同一个文件：

`demo/test-entry-hooks/webgl2.ts`：

```ts
/*
 * The WebGL2 backend's page-side test surface.
 *
 * A hook file rather than an edit to demo/test-entry.ts: that file merges
 * demo/test-entry-hooks/*.ts through import.meta.glob exactly so that each phase
 * adds its own surface without touching a file another phase owns.
 *
 * Task 4 appends gate C's two hooks to this same file and to the default export
 * below -- it is one file per phase, not one file per hook.
 */

import { WebGL2Backend } from '../../src/renderer/webgl2/backend'
import { compileShader } from '../../src/renderer/webgl2/context'
import type { DeviceLost, RenderableSource } from '../../src/renderer/backend'
import type { CameraState } from '../../src/core/types'

/** The pose every smoke case uses. Its values are irrelevant; its presence is not. */
const ORIGIN: CameraState = { povLatitude: 0, povLongitude: 0 }

/** A 2x2 checkerboard as an image element: pixels known without a fixture file. */
async function checkerSource (): Promise<RenderableSource> {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 2, 2)
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 1, 1)

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

async function webgl2Smoke () {
  const canvas = document.createElement('canvas')
  const backend = WebGL2Backend.create(canvas)
  if (!backend) return { available: false }

  backend.resize(64, 64, 1)
  backend.setCamera(ORIGIN, { kind: 'linear', fov: 75, aspect: 1 })
  backend.setSource(await checkerSource())
  backend.render()

  const pixels = readGl(canvas)
  const capabilities = backend.capabilities
  backend.dispose()

  return {
    available: true,
    maxTextureDimension: capabilities.maxTextureDimension,
    externalTextures: capabilities.externalTextures,
    nonBlackFraction: nonBlackFraction(pixels)
  }
}

/** Proves a compile failure throws at construction instead of yielding a dead backend. */
function webgl2CompileFailure () {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) return { available: false, message: '' }
  try {
    compileShader(gl, gl.FRAGMENT_SHADER, 'void main(){ this is not glsl }', 'fragment')
    return { available: true, message: '' }
  } catch (error) {
    return { available: true, message: String(error) }
  }
}

/** Creates and disposes N backends, counting how many failed to get a context. */
function webgl2CreateDisposeLoop (count: number) {
  let failures = 0
  for (let i = 0; i < count; i++) {
    const canvas = document.createElement('canvas')
    const backend = WebGL2Backend.create(canvas)
    if (!backend) { failures++; continue }
    backend.dispose()
  }
  return { failures }
}

/**
 * Loses and restores a real context, end to end.
 *
 * The loss is driven by WEBGL_lose_context rather than by dispatching a
 * synthetic event, so the driver's own teardown happens. The synthetic dispatch
 * is used only to read `defaultPrevented`, which is the one thing a real loss
 * cannot report back.
 */
async function webgl2ContextRoundTrip () {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const backend = WebGL2Backend.create(canvas)
  if (!backend) return { available: false }

  const lost: DeviceLost[] = []
  const unsubscribe = backend.onDeviceLost(l => lost.push(l))

  const synthetic = new Event('webglcontextlost', { cancelable: true })
  canvas.dispatchEvent(synthetic)

  const restored = new Promise<void>(resolve => {
    canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true })
  })

  backend.resize(32, 32, 1)
  backend.setCamera(ORIGIN, { kind: 'linear', fov: 75, aspect: 1 })
  backend.setSource(await checkerSource())
  backend.render()
  const before = nonBlackFraction(readGl(canvas))

  const gl = canvas.getContext('webgl2')!
  gl.getExtension('WEBGL_lose_context')!.loseContext()
  await new Promise<void>(resolve => { setTimeout(resolve, 0) })
  const lostCount = lost.length

  gl.getExtension('WEBGL_lose_context')!.restoreContext()
  await restored

  // A second source object, because the first one's element was released -- which
  // is the documented contract, and the reason a restore cannot redraw on its own.
  backend.setCamera(ORIGIN, { kind: 'linear', fov: 75, aspect: 1 })
  backend.setSource(await checkerSource())
  backend.render()
  const after = nonBlackFraction(readGl(canvas))

  unsubscribe()
  backend.dispose()
  canvas.remove()

  return {
    available: true,
    prevented: synthetic.defaultPrevented,
    lostCount,
    reason: lost[0]?.reason ?? '',
    before,
    after
  }
}

export default {
  webgl2Smoke,
  webgl2CompileFailure,
  webgl2CreateDisposeLoop,
  webgl2ContextRoundTrip
} satisfies Partial<PanoTestApi>
```

**`demo/test-entry.ts` 一个字节都不用改。** 加宽走 `declare global`，写在 hook 文件自己里面（P3 的意图：「a phase that adds a hook cannot forget to register it in a second place」）：

```ts
// Merges into the interface P3 opened.
//
// P3 declares `PanoTestApi` as a *global* interface rather than an exported one
// precisely so that this works: global interfaces merge by name across files,
// with no specifier to resolve and therefore nothing to get wrong. An exported
// interface would instead need `declare module '../test-entry'` here, and a
// relative specifier that silently augments nothing is the failure mode that
// produces `Property 'webgl2Smoke' does not exist on type 'PanoTestApi'` at
// every call site while this file still compiles.
declare global {
  interface PanoTestApi {
    /** Smoke: create a WebGL2 backend, draw the checkerboard, read it back. */
    webgl2Smoke (): Promise<Webgl2SmokeResult>
    /** Smoke: compiling a deliberately broken shader must throw. */
    webgl2CompileFailure (): { available: boolean, message: string }
    /** Smoke: N create/dispose cycles must not exhaust the context limit. */
    webgl2CreateDisposeLoop (count: number): { failures: number }
    /** Smoke: lose and restore a real context. */
    webgl2ContextRoundTrip (): Promise<Webgl2RoundTripResult>
  }
}

/** What webgl2Smoke reports. Exported because the tests assert on its shape. */
export interface Webgl2SmokeResult {
  readonly available: boolean
  readonly maxTextureDimension?: number
  readonly externalTextures?: boolean
  readonly nonBlackFraction?: number
}

export interface Webgl2RoundTripResult {
  readonly available: boolean
  readonly prevented?: boolean
  readonly lostCount?: number
  readonly reason?: string
  readonly before?: number
  readonly after?: number
}
```

> **增补是程序级的，但增补模块本身必须先进入程序。** 用 tsc 5.9 实测过两件事：模块增补一旦生效，对**整个程序**的文件都生效（另一个文件完全不 import 这个 hook，也能看到 `webgl2Smoke`）；反过来，如果没有任何文件把它拉进程序，增补就不存在，报错指向的是**测试文件**（`Property 'webgl2Smoke' does not exist on type 'PanoTestApi'`），看起来像测试写错了，实际是声明没进程序。
>
> 而集成测试的 program（`test/integration/tsconfig.json`，`include` 只有集成测试与 `demo/**`）里，**`demo/test-entry.ts` 进来了、`demo/test-entry-hooks/*` 没有** —— hook 模块只被 `import.meta.glob` 在运行时加载，那是 Vite 的机制、对类型系统不可见。所以**必须由 `test/` 侧主动把 hook 模块拉进来**，否则 `window.__panoTest.<hook>()` 全系列调用都编译不过。
>
> P6 的做法：**每个用到某组 hook 的测试侧文件写一行 `import type {} from '<hook 模块>'`**。type-only import 足以应用增补（已实测），没有绑定所以不触发 unused 检查，且被 `verbatimModuleSyntax` 消除、不产生运行时依赖 —— 它纯粹是把声明拉进程序，放在调用点旁边是为了自我说明。

`available: false` 的三条字段用可选而不是联合类型：测试里那一句 `expect(r.available).toBe(true)` 已经把「可用」这条路钉死了，为它再引入一个判别联合只会让每条断言都多一层收窄。

> **`webgl2Smoke` 返回的 `maxTextureDimension` 是能力上报值，不是 `gl.MAX_TEXTURE_SIZE`。** 两者可能不等：`describeCapabilities` 把它钳在 `[2048, 16384]`。**测试断言的是能力上报值** —— 那是调用方和 `probe()` 看到的东西。

- [ ] **Step 4: 冒烟测试**

`test/integration/webgl2-smoke.test.ts`：

```ts
import { test, expect } from './support/fixtures'
// For its module augmentation of PanoTestApi -- see Task 3 Step 3. The call sits
// inside page.evaluate, but the closure is type-checked here, so the declaration
// has to be in this program.
import type {} from '../../demo/test-entry-hooks/webgl2'

test('creates a WebGL2 backend and renders a non-empty frame', async ({ gpuPage }) => {
  const r = await gpuPage.evaluate(async () => {
    const t = window.__panoTest
    return t.webgl2Smoke()
  })
  expect(r.available).toBe(true)
  // Not `toBe(gl.MAX_TEXTURE_SIZE)`: the reported value goes through
  // describeCapabilities, which clamps it into [2048, 16384] because a software
  // adapter can report 0 and make every source look oversized.
  expect(r.maxTextureDimension).toBeGreaterThanOrEqual(2048)
  expect(r.externalTextures).toBe(false)
  expect(r.nonBlackFraction).toBeGreaterThan(0.5)
})

test('a shader that will not compile throws rather than yielding a dead backend', async ({ gpuPage }) => {
  // The legacy path returned null here and the viewer reported success.
  const r = await gpuPage.evaluate(async () => {
    const t = window.__panoTest
    return t.webgl2CompileFailure()
  })
  expect(r.message).toMatch(/failed to compile/i)
})

test('repeated create/dispose does not exhaust the context limit', async ({ gpuPage }) => {
  // Browsers cap live WebGL contexts (commonly at 16). WEBGL_lose_context is
  // what releases one immediately; without it, the 17th viewer silently fails.
  const r = await gpuPage.evaluate(async () => {
    const t = window.__panoTest
    return t.webgl2CreateDisposeLoop(20)
  })
  expect(r.failures).toBe(0)
})

test('a lost context is reported, and a restored one draws again', async ({ gpuPage }) => {
  const r = await gpuPage.evaluate(async () => {
    const t = window.__panoTest
    return t.webgl2ContextRoundTrip()
  })

  // preventDefault() is what makes restoration possible at all. Without it the
  // browser never fires webglcontextrestored and the canvas is dead with
  // nothing reported.
  expect(r.prevented).toBe(true)
  expect(r.reason).toBe('context-lost')
  // The synthetic dispatch, then the real loss: two reports, not one.
  expect(r.lostCount).toBe(2)
  expect(r.before).toBeGreaterThan(0.5)
  expect(r.after).toBeGreaterThan(0.5)
})
```

- [ ] **Step 5: 跑测试**

Run: `npm run test:integration -- webgl2-smoke`
Expected: 4 个测试 PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/webgl2/backend.ts src/viewer/backend-factory.ts test/integration/webgl2-smoke.test.ts demo/
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
- Modify: `demo/test-entry-hooks/webgl2.ts`（追加门禁 C 的两条）
- Create: `demo/test-entry-hooks/cross-backend.ts`
- Test: `test/integration/gate-c-cross-backend.test.ts`

**门禁 C 的问题**：两份手写的着色器，四个投影，**它们会不会悄悄漂开？**

**怎么比：两个离屏渲染器，同一张源图，同一批相机状态。** 不走两个真实的 `Backend`（那个在 Task 5 的用户故事里验），因为门禁 C 要证的是**两份着色器源码**一致，而经画布走一遍会引入 present 与读回的时序，还会让两边的输入路径不同（WebGPU 的 canvas 纹理没有 `readPixels` 等价物）。
- [ ] **Step 1: 页面侧出口**

**两个渲染器接受同样的参数、返回同样形状的结果** —— 这是门禁 C 能比的前提。落成**两个 hook 文件**，放进 P3 的 `demo/test-entry-hooks/`（`import.meta.glob` 自动合并，`demo/test-entry.ts` 的实现一个字节都不用改）。

先在 Task 3 建好的 `demo/test-entry-hooks/webgl2.ts` 末尾追加下面这两个函数，并把它们并进那个文件已经导出的 default 对象（`export default { webgl2Smoke, ..., gateSourcePng, renderOffscreenGLSL }`）。**同一个文件，不是新文件** —— P3 的设计是一期一个 hook 文件。

```ts
/*
 * The WebGL2 half of gate C, plus the source all three paths share.
 *
 * A hook file rather than an edit to demo/test-entry.ts: that file merges
 * demo/test-entry-hooks/*.ts through import.meta.glob exactly so that each
 * phase can add its own surface without touching a file another phase owns.
 *
 * `renderOffscreenGLSL` is deliberately the same request/result shape as P3's
 * `renderOffscreen` in ./renderer.ts. Gate C compares the two, and two harnesses
 * with different inputs would be comparing the harnesses.
 */

import { mat4 } from 'gl-matrix'
import { buildCameraTransform } from '../../src/core/matrix'
import { cameraProjectionCode, textureProjectionCode } from '../../src/core/constants'
import { compileShader, linkProgram } from '../../src/renderer/webgl2/context'
import { PANORAMA_GLSL_FRAGMENT, PANORAMA_GLSL_VERTEX } from '../../src/renderer/webgl2/shaders'
import type { RenderRequest, RenderResult } from './renderer'

// ...these join the imports already at the top of webgl2.ts from Task 3...

/**
 * Gate C renders at 128x128 and that number is not free: WebGPU's
 * copyTextureToBuffer requires bytesPerRow to be a multiple of 256, and
 * 128 * 4 = 512. Change the size and the WebGPU half fails with a validation
 * error that says nothing about the projection formulas.
 */
const GATE_SIZE = 128

/**
 * The source every path in gate C samples, as a PNG data URL.
 *
 * One definition for all three: the WebGPU renderer, the WebGL2 renderer and the
 * CPU reference all take these exact bytes. Two sources with "the same" pattern
 * is how a comparison ends up measuring the difference between two generators.
 *
 * A data URL rather than raw pixels because that is what P3's renderOffscreen
 * takes, and it builds a real HTMLImageElement from it -- so the frame reaches
 * copyExternalImageToTexture the same way a viewer's does.
 *
 * Periodic in u and v on purpose. A ramp running 0..255 across the width has a
 * discontinuity at the seam, and a one-texel filtering difference there shows up
 * as a huge difference that has nothing to do with the projections. Periodic and
 * smooth means a sub-texel UV difference produces a proportionally small colour
 * difference, while the 8-cycle term keeps the image non-constant so a rotation
 * or a scale error cannot hide inside a flat region.
 */
function gateSourcePng (): string {
  const canvas = document.createElement('canvas')
  canvas.width = GATE_SIZE
  canvas.height = GATE_SIZE
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(GATE_SIZE, GATE_SIZE)

  for (let y = 0; y < GATE_SIZE; y++) {
    for (let x = 0; x < GATE_SIZE; x++) {
      const u = (x + 0.5) / GATE_SIZE
      const v = (y + 0.5) / GATE_SIZE
      const i = (y * GATE_SIZE + x) * 4
      image.data[i] = Math.round(128 + 127 * Math.cos(2 * Math.PI * u))
      image.data[i + 1] = Math.round(128 + 127 * Math.cos(2 * Math.PI * v))
      image.data[i + 2] = Math.round(
        128 + 127 * Math.sin(2 * Math.PI * 8 * u) * Math.sin(2 * Math.PI * 8 * v)
      )
      image.data[i + 3] = 255
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

/**
 * Renders one frame through the GLSL shader and reads the pixels back.
 *
 * Same product path as the WebGPU half: the matrix comes from
 * buildCameraTransform with this backend's depth convention, the shader is the
 * shipped one, the source is a real image element. Only the swapchain is
 * skipped.
 */
async function renderOffscreenGLSL (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection, sourcePng } = request

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

  // 'minus-one-to-one', where the WebGPU half passes 'zero-to-one'. This one
  // argument is the whole depth-convention difference between the backends; if
  // both halves were given the same one here, gate C would fail and the failure
  // would have nothing to do with the projection formulas.
  const clip = mat4.create()
  const invClip = mat4.create()
  buildCameraTransform(camera, projection, 'minus-one-to-one', clip)
  mat4.invert(invClip, clip)

  gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_invClip'), false, invClip)
  gl.uniform1i(gl.getUniformLocation(program, 'u_projKind'), cameraProjectionCode(projection.kind))
  gl.uniform1i(gl.getUniformLocation(program, 'u_texProjKind'), textureProjectionCode('equirectangular'))
  gl.uniform1f(gl.getUniformLocation(program, 'u_povLatitude'), camera.povLatitude)
  gl.uniform1f(gl.getUniformLocation(program, 'u_povLongitude'), camera.povLongitude)
  gl.uniform1f(gl.getUniformLocation(program, 'u_zoom'), projection.kind === 'linear' ? 1 : projection.zoom)
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0)

  const image = new Image()
  image.src = sourcePng
  await image.decode()

  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // False: the v flip lives in the shader. Doing it here too would cancel it.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
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

  return { width, height, rgba: Array.from(topDown) }
}

// (tasks 3's four hooks stay in this same default export)
export default {
  gateSourcePng,
  renderOffscreenGLSL
} satisfies Partial<PanoTestApi>
```

`demo/test-entry-hooks/cross-backend.ts` —— CPU 裁判，float64，**不碰任何矩阵**：

```ts
/*
 * The CPU reference, rendered as an image.
 *
 * The arbiter for gate C. When the two backends disagree, running all three and
 * finding the odd one out is what turns "they differ" into "this one is wrong".
 *
 * It inverts ndc to a surface point itself (ndcToSurface) instead of inverting
 * the float32 camera matrix the shaders use. An arbiter that shares the
 * shaders' precision and their matrix is not an independent opinion -- it would
 * agree with a wrong matrix by construction.
 *
 * float64 throughout, and its own bilinear fetch. The GPU's bilinear weights are
 * quantized to a handful of sub-texel bits, which is what the tolerance in the
 * test accounts for; the sampling model has to be the same (LINEAR +
 * CLAMP_TO_EDGE) or the comparison measures the sampler.
 */

import { ndcToSurface, project } from '../../src/core/reference'
import type { RenderRequest, RenderResult } from './renderer'

async function decode (png: string): Promise<{ data: Uint8ClampedArray, size: number }> {
  const image = new Image()
  image.src = png
  await image.decode()

  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image, 0, 0)
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, size: canvas.width }
}

function sample (data: Uint8ClampedArray, size: number, u: number, v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, u)) * size - 0.5
  const y = Math.min(1, Math.max(0, v)) * size - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0

  const texel = (ix: number, iy: number, channel: number): number => {
    const cx = Math.min(size - 1, Math.max(0, ix))
    const cy = Math.min(size - 1, Math.max(0, iy))
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
 * Renders one frame on the CPU.
 *
 * Row 0 is the top row, matching both GPU harnesses, and the source is the same
 * PNG: all three paths must differ only in how they compute the projection.
 */
async function referenceImage (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection, sourcePng } = request
  const source = await decode(sourcePng)

  // Only the linear projection is scale-invariant, and for it the extent is
  // unread. The other three carry theirs in the projection itself -- which is
  // what let the geometry subsystem disappear.
  const extent = projection.kind === 'linear' ? ([2, 2] as const) : projection.extent
  const rgba: number[] = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Pixel centres, and ndc y is inverted because ndc +1 is the top row.
      const ndcX = ((x + 0.5) / width) * 2 - 1
      const ndcY = 1 - ((y + 0.5) / height) * 2

      const [sx, sy, sz] = ndcToSurface(ndcX, ndcY, extent)
      const { u, v } = project(sx, sy, sz, camera, projection)
      const [r, g, b] = sample(source.data, source.size, u, v)

      rgba.push(Math.round(r), Math.round(g), Math.round(b), 255)
    }
  }

  return { width, height, rgba }
}

export default { referenceImage } satisfies Partial<PanoTestApi>
```

同样用 `declare global` 加宽（理由见 Task 3 Step 3），仍然不改 `demo/test-entry.ts`：

```ts
declare global {
  interface PanoTestApi {
    /** Gate C: the GLSL half. Same request and result shape as renderOffscreen. */
    renderOffscreenGLSL (request: RenderRequest): Promise<RenderResult>
    /** Gate C: the CPU arbiter. Same source, same shape. */
    referenceImage (request: RenderRequest): Promise<RenderResult>
    /** Gate C: the source all three paths sample, as a PNG data URL. */
    gateSourcePng (): string
  }
}
```

**测试里的取用方式是 `window.__panoTest.renderOffscreenGLSL(...)`，不是 `(window as unknown as { __panoTest: any })`。** P3 在 `demo/test-entry-hooks/renderer.ts` 上写着「不要在这里写 `as unknown as` 再手抄一遍签名 —— 抄一遍就是第二真源，而 `PanoTestApi` 存在的全部意义就是让『页面提供了什么』和『测试拿了什么』由同一个声明约束」。P6 全文照此办理。

> **`renderOffscreenGLSL` 自己 `getUniformLocation`，不经 `UNIFORM_NAMES`。** 这是有意的：门禁 C 要证的是两份**着色器源码**一致，而这个 harness 的作用是「按名字把值喂进去」。它如果复用 Task 3 的定位逻辑，那么 Task 3 少写一个 uniform 时门禁 C 会跟着一起错。少写一个会被 Task 1 的声明清单测试拦下 —— 两道防线各管各的。

- [ ] **Step 2: Playwright 侧工具**

`test/integration/support/cross-backend.ts`。**WebGPU 那一半直接用 P3 的 `renderOffscreen`**（`./gpu.ts`），不另写一个 —— 门禁 C 的主张是关于**出厂的那份着色器**的，所以 WebGPU 侧走的必须是出厂路径，而不是一个为了跟这个测试对上而写的 harness。差值也复用 P3 的 `maxChannelDiff`：「最坏通道差」在这套测试里只有一个定义，两个 gate 各实现一遍，就会在都绿的情况下慢慢分叉：

```ts
import type { Page } from '@playwright/test'
import { renderOffscreen, maxChannelDiff } from './gpu'
import type { RenderRequest } from '../../../demo/test-entry-hooks/renderer'
// Both are here for their module augmentation of PanoTestApi, not for a binding:
// this program's include names demo/test-entry.ts (which declares the Window
// member) but not the hook modules, and import.meta.glob is invisible to the type
// system -- so these two lines are what put `gateSourcePng`,
// `renderOffscreenGLSL` and `referenceImage` on `window.__panoTest`.
import type {} from '../../../demo/test-entry-hooks/webgl2'
import type {} from '../../../demo/test-entry-hooks/cross-backend'
import type { CameraState, Projection } from '../../../src/core/types'

/**
 * Gate C renders at 128x128. Not free: see gateSourcePng in the page hook --
 * WebGPU's bytesPerRow rule is why, and a mismatch between the two constants is
 * a confusing failure rather than an obvious one.
 */
export const GATE_C_SIZE = 128

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
 * The worst VALUE comes from P3's maxChannelDiff, so that "worst channel
 * difference" means one thing across the whole suite; this only locates it,
 * which maxChannelDiff does not report. The location is computed here rather
 * than in the page because 128*128*4 numbers each way is a lot of CDP traffic
 * for one integer and one pixel.
 */
function locate (a: readonly number[], b: readonly number[], width: number): Omit<GateCDiff, 'max'> {
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
    a: a.slice(pixel * 4, pixel * 4 + 4),
    b: b.slice(pixel * 4, pixel * 4 + 4)
  }
}

/** The full diagnosis for one pair of images. */
function diagnose (a: readonly number[], b: readonly number[], width: number): GateCDiff {
  return { max: maxChannelDiff(a, b), ...locate(a, b, width) }
}

/** The request all three paths are given. Identical, including the source bytes. */
async function gateRequest (
  page: Page,
  camera: CameraState,
  projection: Projection
): Promise<RenderRequest> {
  // One source, generated once per call and handed to all three paths. Two
  // sources with "the same" pattern is how a comparison ends up measuring the
  // difference between two generators.
  const sourcePng = await page.evaluate(() => window.__panoTest.gateSourcePng())
  return { width: GATE_C_SIZE, height: GATE_C_SIZE, camera, projection, sourcePng }
}

/**
 * Renders one camera state through both shaders and returns the worst channel
 * difference between them.
 */
export async function renderBothBackends (
  page: Page,
  camera: CameraState,
  projection: Projection
): Promise<GateCDiff> {
  const request = await gateRequest(page, camera, projection)

  // P3's helper for the shipped path, a direct call for the new one.
  const webgpu = await renderOffscreen(page, request)
  const webgl2 = await page.evaluate(
    (r) => window.__panoTest.renderOffscreenGLSL(r),
    request
  )

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
  page: Page,
  camera: CameraState,
  projection: Projection
): Promise<{ webgpu: number, webgl2: number }> {
  const request = await gateRequest(page, camera, projection)

  const reference = await page.evaluate(
    (r) => window.__panoTest.referenceImage(r),
    request
  )
  const webgpu = await renderOffscreen(page, request)
  const webgl2 = await page.evaluate(
    (r) => window.__panoTest.renderOffscreenGLSL(r),
    request
  )

  return {
    webgpu: maxChannelDiff(reference.rgba, webgpu.rgba),
    webgl2: maxChannelDiff(reference.rgba, webgl2.rgba)
  }
}
```

> `GATE_C_SIZE` 在页面里是 `GATE_SIZE` 那个常量。**两处必须相等**：`locate` 用它把下标还原成坐标，不等时坐标是错的而差值是对的 —— 那会让人照着错坐标去查一个正确的渲染。

- [ ] **Step 3: 写测试**

`test/integration/gate-c-cross-backend.test.ts`：

```ts
import { test, expect } from './support/fixtures'
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

const STATES: readonly State[] = [
  { povLatitude: 0, povLongitude: 0, fov: 75, zoom: 1 },
  { povLatitude: 30, povLongitude: 45, fov: 75, zoom: 1 },
  { povLatitude: -60, povLongitude: 180, fov: 60, zoom: 1 },
  { povLatitude: 10, povLongitude: 300, fov: 90, zoom: 0.5 }
]

test.describe('gate C: WebGPU vs WebGL2', () => {
  for (const kind of CAMERAS) {
    for (const [index, s] of STATES.entries()) {
      test(`${kind} / state ${index}`, async ({ gpuPage }) => {
        const diff = await renderBothBackends(gpuPage, state(s), projectionFor(kind, s))

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

  test('the CPU reference agrees with both, so a disagreement has an arbiter', async ({ gpuPage }) => {
    // If this test ever fails while the others pass, the two backends are
    // consistently wrong together -- which is the failure mode gate C cannot see
    // on its own.
    const s = STATES[1]!
    const r = await compareWithReference(gpuPage, state(s), projectionFor('linear', s))

    // The CPU path is float64 with its own bilinear fetch and the shaders are
    // float32 with the hardware's; hardware bilinear weights are quantized to a
    // handful of sub-texel bits, which is most of the headroom here.
    expect(r.webgpu).toBeLessThanOrEqual(3)
    expect(r.webgl2).toBeLessThanOrEqual(3)
  })

  test('the poles are the documented exception', async ({ gpuPage }) => {
    // Near latitude +/-90 the equirectangular mapping compresses the entire
    // longitude range into a few pixels, so a tiny difference in the computation
    // of atan lands many texels apart. The tolerance is relaxed there on
    // purpose; this test pins that it is still bounded rather than unbounded.
    for (const kind of CAMERAS) {
      const s: State = { povLatitude: 89.5, povLongitude: 0, fov: 75, zoom: 1 }
      const diff = await renderBothBackends(gpuPage, state(s), projectionFor(kind, s))

      // Not equal, but not garbage: a broken implementation gives a uniform
      // difference across the whole frame, not a bounded one.
      expect(diff.max, `${kind} at the pole`).toBeLessThan(64)
    }
  })
})
```

- [ ] **Step 4: 跑门禁 C**

Run: `npm run test:integration -- gate-c`
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

- [ ] **Step 5: Commit**

```bash
git add test/integration/gate-c-cross-backend.test.ts test/integration/support/cross-backend.ts demo/
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
- Modify: `playwright.config.ts`
- Modify: `test/integration/support/fixtures.ts`

**这是后端替换的验收方式** —— 同一批用户故事，换个后端。

**做法：加一个 Playwright project，不写第二个测试文件。**

```ts
// playwright.config.ts -- P1 的 projects 数组加一项
projects: [
  { name: 'chromium-gpu', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
  {
    /*
     * The same browser as the project above, with WebGPU hidden. Same
     * `channel: 'chromium'` on purpose: this project exists to answer "does
     * WebGL2 render the same thing?", and running it on a different binary
     * would make every difference ambiguous between the two backends and the
     * two browsers.
     *
     * The four files are named rather than matched with `user-story-.*`, so that
     * the fifth -- user-story-no-webgpu, which is about the WebGPU selection
     * itself and asserts that construction THROWS -- is left out by
     * construction. A wildcard plus a testIgnore would say the same thing in two
     * places, and Task 6 deletes that fifth file: the wildcard would then be
     * matching four files with a stale exclusion attached to nothing.
     */
    name: 'chromium-webgl2',
    testMatch: /user-story-(photo|video|camera-switch|media-failure)\.test\.ts/,
    use: { ...devices['Desktop Chrome'], channel: 'chromium' }
  }
]
```

```ts
// test/integration/support/fixtures.ts -- gpuPage 按 project 分流
import { test as base, expect } from '@playwright/test'

/** The project that re-runs every user story against the WebGL2 backend. */
export const WEBGL2_PROJECT = 'chromium-webgl2'

export const test = base.extend<{ gpuPage: import('@playwright/test').Page }>({
  gpuPage: async ({ page }, use, testInfo) => {
    const webgl2Only = testInfo.project.name === WEBGL2_PROJECT

    if (webgl2Only) {
      /*
       * Hiding WebGPU the way a browser without it hides it: the property is
       * removed from Navigator.prototype rather than shadowed by an own
       * property set to undefined. The difference is load-bearing -- the probe
       * in src/viewer/backend-factory.ts tests `'gpu' in navigator`, which stays
       * true for a shadowing property, and the next line would then call
       * requestAdapter() on undefined.
       */
      await page.addInitScript(() => {
        delete (Navigator.prototype as { gpu?: unknown }).gpu
      })
    }

    await page.goto('/')

    const report = await page.evaluate(async () => {
      const hasWebGL2 = document.createElement('canvas').getContext('webgl2') !== null

      if (!('gpu' in navigator) || !navigator.gpu) {
        return {
          ok: hasWebGL2,
          reason: hasWebGL2 ? '' : 'no WebGL2 either, so this page has no backend at all'
        }
      }

      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        return {
          ok: false,
          reason:
            'requestAdapter() returned null. If this ran under chrome-headless-shell ' +
            '(Playwright default) that is expected -- set channel: "chromium". ' +
            'Check with: DEBUG=pw:browser npx playwright test'
        }
      }
      return { ok: true }
    })

    expect(
      report.ok,
      `WebGPU unavailable: ${'reason' in report ? report.reason : 'unknown'}`
    ).toBe(true)

    if (webgl2Only) {
      /*
       * The environment check above is not enough on its own: a page can have
       * the shim installed and still be running WebGPU, if the init script
       * missed (an iframe, a worker, a navigation that outran it). Ask the
       * library which backend it actually selected -- the answer is exactly the
       * property this project exists to test, so a false negative here is a
       * wasted run rather than a wrong result.
       */
      const backend = await page.evaluate(async () => {
        const t = window.__panoTest
        return (await t.probe()).backend
      })
      expect(backend, 'the WebGL2 project is not running WebGL2').toBe('webgl2')
    }

    await use(page)
  }
})

export { expect }
```

**P5 的四个用户故事文件一个字都不用改。** 这是这个做法相对「再写一个 spec 文件、把测试体抽成 helper」的全部价值：不是**劝阻**重复，而是让重复不可能发生 —— 同一段测试文本，跑两次。

**`testMatch` 是白名单，这很关键。** `test/integration/` 下还有 `smoke.test.ts`（P1 的 WebGPU 守卫）、`gate-a-pixels` / `gate-b-projection`（P3）、`uniform-layout`（P3）、`webgl2-smoke` / `gate-c-cross-backend`（本计划）、`backend-downgrade`（Task 6）—— **它们全都不该在 `chromium-webgl2` 下跑**：`smoke.test.ts` 与门禁 C 都断言有真 WebGPU 适配器，在那个 project 里必然红，而红的原因与它们的断言无关。白名单让这件事在配置里一眼可见，而不是靠逐个 `testIgnore` 去堵。

> **为什么不用 `forceBackend` 之类的夹具开关。** 那种开关是**产品代码里的测试钩子**，而它测的也不是真实的选择逻辑：一个「强制走 WebGL2」的分支会绕过 `createBackend` 的判断，而那一段判断（spec §6.5「降级是可编程状态」）恰恰是要验的东西。屏蔽 `navigator.gpu` 走的是真实路径：probe 看不见 WebGPU，于是选了 WebGL2。

- [ ] **Step 1: 改 config 与 fixture**

按上面的代码改 `playwright.config.ts` 与 `test/integration/support/fixtures.ts`。

- [ ] **Step 2: 跑全部**

Run: `npm run test:unit && npm run test:integration`
Expected: 全 PASS。**两条 project 都要有输出** —— 只跑了一条是配置没生效，不是测试通过：

```bash
npx playwright test --list | grep -c "chromium-webgl2"
```

Expected: 大于 0。

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts test/integration/support/fixtures.ts
git commit -m "test(renderer): run every user story against the WebGL2 backend

A second Playwright project, not a second spec file. The user-story tests
are the same text run twice, so there is no second copy to drift -- which is
a stronger guarantee than extracting shared helpers would give. The WebGL2
project hides navigator.gpu the way a browser without it does, and asserts
that the library actually selected WebGL2 before running anything."
```

---

### Task 6: 降级路径（spec §9.7）

**Files:**
- Create: `test/integration/support/backend.ts`
- Create: `test/integration/backend-downgrade.test.ts`
- Delete: `test/integration/user-story-no-webgpu.test.ts`

spec §9.7 的「后端降级」一行要求：**屏蔽 `navigator.gpu`，断言走 WebGL2**。三种环境都要有：

| 环境 | 怎么造 | 期望 |
|---|---|---|
| 没有 WebGPU，有 WebGL2 | `delete Navigator.prototype.gpu` | 选 WebGL2 并正常渲染 |
| 有 WebGPU，拿不到适配器 | 让 `requestAdapter()` 返回 `null` | 同上 —— **这是 spec §9.7 里最容易漏的一条**：`navigator.gpu` 存在不等于有 GPU，Playwright 默认 headless 就是这样 |
| 两者都没有 | 再让 `getContext('webgl2')` 返回 `null` | `createImageViewer` 抛异常，且消息说清是哪个后端不可用 |

- [ ] **Step 1: 三种环境的 fixture**

`test/integration/support/backend.ts`（P5 表里预留的名字）：

```ts
import { test as base, expect } from './fixtures'
import type { Page } from '@playwright/test'

/**
 * Pages where a specific part of the graphics stack is missing.
 *
 * All three install their shim with addInitScript, before any navigation,
 * because the probe runs as soon as the page's bundle loads. A shim installed
 * afterwards is a shim the code under test has already looked past -- and it
 * would make these tests pass for the wrong reason.
 *
 * Each fixture asserts its own premise afterwards. A fixture that silently
 * failed to remove WebGPU would turn the WebGL2 assertions into WebGPU
 * assertions that happen to pass.
 */

/** WebGPU hidden the way a browser without it hides it. */
export const webgl2OnlyTest = base.extend<{ webgl2Page: Page }>({
  webgl2Page: async ({ page }, use) => {
    await page.addInitScript(() => {
      delete (Navigator.prototype as { gpu?: unknown }).gpu
    })
    await page.goto('/')

    const state = await page.evaluate(() => ({
      hasGpu: 'gpu' in navigator,
      hasWebGL2: document.createElement('canvas').getContext('webgl2') !== null
    }))
    expect(state.hasGpu, 'navigator.gpu survived the shim').toBe(false)
    expect(state.hasWebGL2, 'this browser has no WebGL2 either').toBe(true)

    await use(page)
  }
})

/** `navigator.gpu` exists and `requestAdapter()` returns null. */
export const noAdapterTest = base.extend<{ noAdapterPage: Page }>({
  noAdapterPage: async ({ page }, use) => {
    await page.addInitScript(() => {
      const gpu = navigator.gpu
      if (!gpu) return
      Object.defineProperty(gpu, 'requestAdapter', {
        configurable: true,
        value: async () => null
      })
    })
    await page.goto('/')

    const state = await page.evaluate(async () => ({
      hasGpu: 'gpu' in navigator,
      adapter: navigator.gpu ? await navigator.gpu.requestAdapter() : 'no gpu object',
      hasWebGL2: document.createElement('canvas').getContext('webgl2') !== null
    }))
    expect(state.hasGpu, 'this environment has no navigator.gpu at all').toBe(true)
    expect(state.adapter, 'the adapter shim did not take').toBeNull()
    expect(state.hasWebGL2, 'this browser has no WebGL2 either').toBe(true)

    await use(page)
  }
})

/** Neither backend is available. */
export const noBackendTest = base.extend<{ noBackendPage: Page }>({
  noBackendPage: async ({ page }, use) => {
    await page.addInitScript(() => {
      delete (Navigator.prototype as { gpu?: unknown }).gpu

      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        // Only webgl2 is refused. Blanking every context type would also break
        // the 2D canvas the test itself uses to read pixels back.
        if (type === 'webgl2') return null
        return (original as (...args: unknown[]) => unknown).call(this, type, ...rest)
      } as typeof HTMLCanvasElement.prototype.getContext
    })
    await page.goto('/')

    const state = await page.evaluate(() => ({
      hasGpu: 'gpu' in navigator,
      hasWebGL2: document.createElement('canvas').getContext('webgl2') !== null
    }))
    expect(state.hasGpu).toBe(false)
    expect(state.hasWebGL2, 'the getContext shim did not take').toBe(false)

    await use(page)
  }
})

export { expect }
```

- [ ] **Step 2: 写测试**

`test/integration/backend-downgrade.test.ts`：

```ts
import { webgl2OnlyTest as test, noAdapterTest, noBackendTest, expect } from './support/backend'
// Module augmentations of PanoTestApi: `probe` / `createImageViewer` come from
// P5's viewer hook, and the backend hooks from P6's. See Task 3 Step 3 for why
// a type-only import of the hook module is what puts them on `window.__panoTest`.
import type {} from '../../demo/test-entry-hooks/viewer'
import type {} from '../../demo/test-entry-hooks/webgl2'

/*
 * spec section 9.7: "block navigator.gpu and assert that it goes to WebGL2".
 *
 * The downgrade is a programmable state (section 6.5), not a log line, so what
 * is asserted here is the reported state -- `probe()` before construction and
 * `viewer.capabilities` after it -- plus the fact that the fallback actually
 * renders. An application that wants to tell the user "your browser is using
 * the slower renderer" reads it from exactly these two places.
 *
 * There is deliberately no `downgraded` event. The public event surface is
 * frozen (P5, src/index.ts) and a downgrade is a state, not an occurrence: it is
 * true from before the viewer exists, so there is no moment at which it could
 * fire. `device-lost` is the event for a backend that died, and that is a
 * different thing -- it is tested as such below, in webgl2-smoke.
 */

test.describe('WebGPU absent, WebGL2 present', () => {
  test('probe() reports webgl2 before anything is constructed', async ({ webgl2Page }) => {
    const caps = await webgl2Page.evaluate(async () => {
      const t = window.__panoTest
      return t.probe()
    })
    expect(caps.backend).toBe('webgl2')
    // The WebGPU-only capability must be dropped along with the label. A
    // backend reporting webgl2 with externalTextures: true sends callers down a
    // path this backend cannot serve.
    expect(caps.externalTextures).toBe(false)
    expect(caps.adapter).toBeUndefined()
  })

  test('the viewer renders the panorama instead of throwing', async ({ webgl2Page }) => {
    // The end-to-end form of the same claim: not "the label says webgl2", but
    // "a 360 photo appears". Before P6 this threw.
    const r = await webgl2Page.evaluate(async () => {
      const t = window.__panoTest
      const viewer = await t.createImageViewer({ src: '/fixtures/panorama.png' })
      const loaded = await t.waitFor(viewer, 'media-load', 5000)
      const backend = viewer.capabilities.backend
      const losses: unknown[] = []
      viewer.on('device-lost', e => losses.push(e))
      const pixels = await t.readCanvas(viewer)
      viewer.dispose()
      return { loaded, backend, losses: losses.length, nonBlack: t.countNonBlack(pixels) }
    })
    expect(r.loaded).toBe(true)
    expect(r.backend).toBe('webgl2')
    expect(r.nonBlack).toBeGreaterThan(0.5)
    // A downgrade is not a device loss, and reporting it as one would make
    // every consumer's error path fire on a page that is working perfectly.
    expect(r.losses).toBe(0)
  })
})

noAdapterTest.describe('WebGPU present, no adapter', () => {
  noAdapterTest('falls back to WebGL2 rather than failing', async ({ noAdapterPage }) => {
    // Playwright's default headless binary is exactly this environment: a
    // navigator.gpu that returns null for every adapter request (spec 9.5).
    // Without this test the silent-downgrade hazard has no coverage at all.
    const r = await noAdapterPage.evaluate(async () => {
      const t = window.__panoTest
      const caps = await t.probe()
      const viewer = await t.createImageViewer({ src: '/fixtures/panorama.png' })
      await t.waitFor(viewer, 'media-load', 5000)
      const backend = viewer.capabilities.backend
      const pixels = await t.readCanvas(viewer)
      viewer.dispose()
      return { probe: caps.backend, backend, nonBlack: t.countNonBlack(pixels) }
    })
    expect(r.probe).toBe('webgl2')
    expect(r.backend).toBe('webgl2')
    expect(r.nonBlack).toBeGreaterThan(0.5)
  })
})

noBackendTest.describe('neither backend', () => {
  noBackendTest('createImageViewer rejects, naming the situation', async ({ noBackendPage }) => {
    // Constructing a viewer that can never draw is what the legacy
    // createProgram did: it logged, returned null, and the viewer reported
    // success. A viewer that cannot render is not a viewer.
    const r = await noBackendPage.evaluate(async () => {
      const t = window.__panoTest
      const canvases = () => document.querySelectorAll('canvas').length
      const before = canvases()

      const attempt = async () => {
        try {
          await t.createImageViewer({ src: '/fixtures/panorama.png' })
          return ''
        } catch (error) {
          return String(error)
        }
      }

      const first = await attempt()
      // A second attempt, to show the failure is a property of the environment
      // and not of state the first one left behind.
      const second = await attempt()

      return { first, second, before, after: canvases() }
    })

    expect(r.first).toMatch(/no usable rendering backend/i)
    expect(r.second).toMatch(/no usable rendering backend/i)
    // And it did not leave a canvas in the DOM. No viewer-count hook is
    // asserted here: P5 exposes none, and the viewer phase owns that surface --
    // inventing one from P6 would put a second owner on it. The canvas count is
    // the part of "did anything leak" that is observable without a new hook.
    expect(r.after).toBe(r.before)
  })

  noBackendTest('probe() reports none rather than throwing', async ({ noBackendPage }) => {
    // probe() must be usable to decide what to do BEFORE constructing anything,
    // which means it cannot be the thing that throws.
    const caps = await noBackendPage.evaluate(async () => {
      const t = window.__panoTest
      return t.probe()
    })
    expect(caps.backend).toBe('none')
  })
})
```

- [ ] **Step 3: 删掉 P5 的 US5 文件**

`test/integration/user-story-no-webgpu.test.ts` **整体删掉**，它的两条测试都已经被上面这一组更强地覆盖了，而它的前提是错的。它的第一条测试的注释写着：

```ts
    // Runs in the default headless shell, where navigator.gpu exists but
    // requestAdapter() returns null. Until P6 lands the WebGL2 backend, this is
    // the honest outcome: a clear failure, not a black rectangle.
```

**那句话对 Playwright 的默认启动成立，对本项目的配置不成立。** `playwright.config.ts` 设了 `channel: 'chromium'`（P1），正是为了让 WebGPU 可用 —— 所以 `create()` 会成功，`expect(message).toMatch(/no usable rendering backend/i)` 永远不可能满足。同理它的第二条（`probe()` 返回三个值之一）在 `channel: 'chromium'` 下只会是 `webgpu`，而那与「没有 WebGPU 的环境」无关。

它想覆盖的三种环境，现在在 `backend-downgrade.test.ts` 里，一种一个 fixture，**而且每个 fixture 先断言自己的前提**（删掉 `navigator.gpu` 失败了就直接报「the shim did not take」，而不是悄悄退化成一条在 WebGPU 上也能过的测试）。`probe()` 不抛异常这一点也在那里被更强地测了：`backend === 'none'`，而不是「三个值之一」。

> **这不是 P6 引入的回归，是 P5 的一处前提错误。** P5 的 Task 6 Step 6 跑 `npm run test:integration` 并写着「Expected: 全 PASS」，而这条文件在 `channel: 'chromium'` 下不可能过 —— 也就是说 P5 收尾时它要么是红的，要么被跳过而没人记下。P6 把它删掉、补上正确的版本，这就是它的收尾。**执行 P6 时如果发现这个文件已经被标成 `test.fixme` / `test.skip`，那正是这件事的痕迹，直接删掉即可。**

- [ ] **Step 4: 跑**

Run: `npm run test:integration -- backend-downgrade`
Expected: 5 个测试 PASS

**如果第一条就红**：检查 `delete Navigator.prototype.gpu` 是否真的生效（fixture 里的断言会直接告诉你）。**如果「没有适配器」那条红**：`Object.defineProperty` 定义了自有属性，但如果 `navigator.gpu` 是 getter 返回的新对象，每次读到的都是同一个对象才对；不是同一个就改成在 `Navigator.prototype` 上做手脚。

- [ ] **Step 5: Commit**

```bash
git add test/integration/support/backend.ts test/integration/backend-downgrade.test.ts
git rm test/integration/user-story-no-webgpu.test.ts
git commit -m "test(viewer): the three degraded environments, one fixture each

Spec 9.7's downgrade row, plus the case it is easiest to miss: navigator.gpu
exists and requestAdapter() returns null, which is Playwright's default
headless binary and would otherwise be covered by nothing.

P5's user-story-no-webgpu.test.ts is deleted: its premise (the default
headless shell has no adapter) is false under channel: 'chromium', so its
assertion could never hold."
```

---

## 完成标准

- [ ] 门禁 C 的 18 条全绿，容差未被放宽
- [ ] P5 的四个用户故事文件 untouched，在 `chromium-webgl2` project 下全绿（同一份文本跑两次）
- [ ] 三种降级环境各有一条测试，且每种都先断言自己的前提
- [ ] `capabilities.backend === 'webgl2'` 且 `externalTextures === false`，且这个值来自 `describeCapabilities`
- [ ] 着色器编译失败会抛异常，不返回死后端
- [ ] 连续创建/销毁 20 个后端不耗尽上下文额度
- [ ] `webglcontextlost` 被 `preventDefault()` 并上报 `{ reason: 'context-lost' }`；`webglcontextrestored` 后能重新画出画面
- [ ] `npm run build` 成功，且 `dist/index.js` 里能找到 `#version 300 es`（`?raw` 通道两端都通）
- [ ] `npm run typecheck` 干净
- [ ] **`src/index.ts` 的导出面与 P5 一致**（后端替换不改变公开 API）

## 明确的非目标

- **不为 WebGL2 做性能优化。** 它是降级路径。`preserveDrawingBuffer: true` 是这条定位下的一次明确取舍：代价是每帧一次缓冲拷贝，换来的是任何在稍后任务里读画布的人（包括每一个用户故事测试）看到的不是黑屏。
- **不加 WebGL2 独有的能力探测维度。**
- **不把两份着色器合并成一个生成器。** 转写 + 门禁 C 是当前的取舍；如果哪天两份漂得太频繁，再考虑生成器，那时它才是有依据的。
- **不做上下文丢失后的自动重画。** spec §6.4 把本期限定为「检测 + 干净释放」，而 `setSource` 的契约（不得在本次任务之后保留 `source.element`）意味着恢复时已无像素可重新上传。所以恢复后的行为是：程序与 uniform 重建、纹理丢弃，**下一次交互或下一帧视频时重新画出**；静止图像会停在黑屏，直到应用做点什么。要真正的自动恢复，需要一个「请重画」的通道，那是接口的增量改动，不属于本计划。

## 关于 golden image：P6 不需要它

P3 的「不上榜的部分」把 golden image 与跨后端交叉验证一起推给了 P6。**跨后端比较是门禁 C，P6 做了。golden image 不需要再建一套**，理由：

- **P0 的基线就是 golden image，而且已经在跑。** `test/fixtures/baseline/` 是从 v0.2.2 抓下来的 PNG，P3 的 `gate-a-pixels.test.ts` 拿新渲染器逐像素对拍并跑在同一条流水线上。再建一套 golden 只会多一份要重新生成的图片、多一个要争论的容差，而验的是同一件事：新渲染器与出厂版本一致。
- **golden image 表达不了 P6 真正要加的那条信息。** 一张图只能回答「和某个已知的正确结果比，像不像」；门禁 C 要回答的是「两份手写源码是否一致」，那是两个后端之间的关系，没有第三个对象可以当 golden。
- **基线的权威性是有前提的**：门禁 A 必须先绿，门禁 C 的容差才有意义 —— 两个后端一起错、且错得与 v0.2.2 一样，是门禁 C 看不见的失败模式，而门禁 A 看得见。**所以执行顺序是 A 绿了再跑 C**，这一点写进 Task 4 的失败分流表。

## 关于 CI：WebGPU 路径在 CI 上真的跑起来需要什么

门禁 C 与后端冒烟测试都**必须**在真有 WebGPU 适配器的页面里跑（`gpuPage` 会断言这一点）。**在 CI 上这取决于 `playwright.config.ts` 里的两件事，而它属于 P1：**

1. `channel: 'chromium'` —— Playwright 默认的 `chrome-headless-shell` 没有 GPU 栈，WebGL 走 SwiftShader 而 WebGPU 拿不到适配器。少了这一行，**整条 WebGPU 侧会空跑而 CI 全绿**（spec §9.5）。
2. **如果 CI 的 runner 上 Chromium 仍拿不到适配器**，那需要的启动参数只能写在 `use.launchOptions.args` 里。**环境变量不行**：Playwright 不读任何名为 `PLAYWRIGHT_CHROMIUM_ARGS` 的东西（P7 的 CI workflow 传了这个变量，它是无效的），启动参数只有 `launchOptions` 这一条路。

**验收要求写在这里，免得它变成一个「CI 绿了但其实没跑」的静默通过**：`test/integration/smoke.test.ts` 里那条「the CI browser has a real WebGPU adapter」必须真的 PASS。它红了就说明门禁 C 这一批测试没有意义，而不是说明 GPU 有问题。
