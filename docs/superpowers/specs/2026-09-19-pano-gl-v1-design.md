# pano.gl v1 重构设计

**日期**：2026-09-19
**版本**：设计冻结版
**目标版本**：v1.0.0（破坏性变更，已确认可接受）

---

## 0. 文档定位

### 本文是什么

pano.gl 从 v0.2.2 重写为 v1.0.0 的**完整设计**。涵盖架构分层、状态模型、两个渲染后端、媒体与交互、生命周期、依赖选型、测试策略、迁移路线。

### 本文不是什么

- **不是实施计划**。计划见 `docs/superpowers/plans/`，一个阶段一份。
- **不重复探路论证**。无头 CI 渲染可行性、数值确定性、视频路径的实测证据见 `docs/superpowers/notes/stage-0-feasibility.md`。本文只在需要时引用其结论。

### 证据标注约定

本文的每个技术论断都标了来源。三种标注：

| 标注 | 含义 |
|---|---|
| **【实测】** | 探路阶段跑出来的，有数字 |
| **【核码】** | 读现有源码确认的，有文件行号 |
| **【待验证】** | 设计提案，**必须在实施阶段过门禁**（见 §10.3） |

**【待验证】不是免责声明，是任务清单。** 它们全部被 §10.3 的三道门禁网住。

---

## 1. 背景与目标

### 1.1 现状

pano.gl v0.2.2 是一个 2017 年前后写的 WebGL1 全景查看器：把等距柱状（360°）图片或视频渲染进一个容器元素，支持四种相机模型（perspective / cylindrical / planet / pannini）和内置的平移-缩放交互。

核心特征：**全部投影数学发生在片元着色器里**，CPU 侧只产出一个变换矩阵和少量标量 uniform。这是理解整个项目最重要的一条 —— 改任何跟相机或着色器相关的东西之前必须先理解它。

### 1.2 四个目标（用户原话）

1. 语言升级到 TS 最新版本，或者 Rust + WASM
2. 底层依赖的若干自研库（作者初学时期所写）换成更主流的方式
3. 渲染后端从 WebGL1 换成 WebGPU
4. 优化代码本身 —— 包括代码设计与修 bug

### 1.3 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 语言 | **TypeScript**，不上 Rust + WASM | 见 §1.3.1 |
| 后端 | **WebGPU 优先 + WebGL2 降级** | 用户拍板；WebGPU 覆盖率仍不足，降级是刚需 |
| 功能范围 | 重写为可扩展平台，非最小改动 | 用户拍板 |
| 实施路线 | 分阶段演进 | 用户拍板；见 §10 |
| API 兼容 | 可接受大版本破坏性变更 | 用户确认「有使用者」 |
| 依赖校验 | 不用 zod，类型交给 TS，只写取值范围断言 | 用户拍板 |

#### 1.3.1 为什么是 TypeScript 而不是 Rust + WASM

本项目的计算量**不在 CPU 侧**。投影数学全部在片元着色器里跑，CPU 每帧只产出「一个矩阵 + 若干标量」。把这一层搬到 Rust/WASM：

- **收益接近零** —— 没有可搬的热点
- **成本很高** —— WASM ↔ JS 边界有序列化开销，构建链复杂化，调试体验显著变差（浏览器里要看两套源码映射）
- **反而挡住主路径** —— 真正需要打磨的是 GPU 侧（着色器、管线、绑定组），而那部分 Rust 帮不上忙

Rust + WASM 适合的是「CPU 侧有重计算」的场景。这个项目不是。

### 1.4 约束

- **本项目是公开发布的**，别人会 clone 并构建。工具链必须是主流 npm 生态，不能依赖任何人的本地环境。
- 编码规范：standardjs 风格（无分号、2 空格、单引号）；注释**全英文**；标准化注释（TSDoc）+ 局部注释两部分。
- 测试：单元测试 `test/unit/{sourceFileName}.test.ts`，集成测试 `test/integration/{userStoryName}.test.ts`，分支覆盖率 ≥90%。

---

## 2. 架构分层

### 2.1 分层图

```
core/          纯逻辑：相机状态 + 投影参数 + 矩阵
               ← 不知道深度约定，不碰 DOM / GPU
renderer/      Backend 接口 + webgpu/ + webgl2/
               ← 吃 CameraState，注入自己的 depthRange
media/         ImageSource / VideoSource
interaction/   PointerEvent 手势 → 语义事件
viewer/        组装 FramelessImageViewer / FramelessVideoViewer
```

**依赖方向严格单向向下。** `core/` 不 import 任何其他层；`renderer/` 可以 import `core/`；只有 `viewer/` 知道全部。

### 2.2 分层要解决的三个具体问题

| 旧设计的问题 | 新设计如何解决 |
|---|---|
| 深度约定（GL `[-1,1]` vs WebGPU `[0,1]`）散落在矩阵里 | 提到 `renderer/` 边界，由后端注入（§3.3） |
| 相机契约要求实现 `geoVertexes`（顶点集） | 删除该成员 —— 几何子系统整体消失（§4.5） |
| `Viewer` 通过 mixin **是** RenderFlow / Delegate / Eventable，成员挤在一个命名空间 | 改为**组合**：`Viewer` **持有**各层（§5.4） |

### 2.3 对外 API

```ts
export class FramelessImageViewer extends EventEmitter<ImageEvents> {
  constructor (options: ImageViewerOptions)
  dispose (): void

  src: string
  cameraOptions: CameraOptions
  PTZ: boolean

  readonly capabilities: Capabilities
  static probe (): Promise<Capabilities>
}

export class FramelessVideoViewer extends EventEmitter<VideoEvents> { /* 同构 */ }
```

---

## 3. 状态模型

### 3.1 相机状态与投影参数

```ts
/** Camera pose. Units are degrees for angles, matching the legacy public API. */
export interface CameraState {
  povLatitude: number      // clamped to [-90, 90]
  povLongitude: number     // wrapped into [0, 360)
}

/**
 * A projection is fully described by its kind plus the handful of scalars its
 * fragment-shader formula reads. `extent` is the one that used to be hidden in
 * the geometry -- see 4.5.
 */
export type Projection =
  | { kind: 'linear';      fov: number; aspect: number }
  | { kind: 'cylindrical'; zoom: number; extent: readonly [number, number] }
  | { kind: 'planet';      zoom: number; extent: readonly [number, number] }
  | { kind: 'pannini';     zoom: number; extent: readonly [number, number] }

/** Texture projection is a property of the SOURCE, never of the camera. */
export type TextureProjection = 'equirectangular'   // 'fisheye' unimplemented
```

> **为什么 `extent` 在这里。** 非线性相机的投影公式（`theta = z * TWO_PI`）**不是齐次的**，四边形铺多大是投影参数的一部分。旧设计把它写死在四边形顶点坐标里（cylindrical 为 1×1，planet/pannini 为 4×4），见 §4.5。

### 3.2 相机与贴图的投影类型是两件事

**【核码】** 旧设计已经把它们分开了，这是对的，新设计保持：

```js
// Renderer.js:120-125 —— 相机 uniform 走一条路径
const status = camera.status()          // 含 u_CamProjType
// Renderer.js:127-130 —— 贴图投影走另一条
gl.uniform1i(u_TexProjType, texture.projection)
```

相机不知道贴图是等距柱状还是鱼眼。`Camera.status()`（`Camera.js:51-63`）里只有 `CamProjType`。

### 3.3 深度约定收在 `renderer/` 边界

**【核码】** 旧代码把 GL 的 `[-1,1]` 约定隐式烧进 `setPerspective` / `setOrtho`，WebGPU 的 `[0,1]` 与它不兼容。

```ts
// core/ -- depth-agnostic: it produces a projection, not a clip-space mapping
export function buildProjection (p: Projection, out: mat4): mat4

// renderer/ -- the backend owns its depth convention, explicitly
export type DepthRange = 'minus-one-to-one' | 'zero-to-one'

export function buildClipMatrix (
  p: Projection,
  depth: DepthRange,
  out: mat4
): mat4
```

实现直接用 `gl-matrix` 的两套显式 API —— **深度约定成为函数名的一部分，不再是隐式假设**：

| 约定 | 透视 | 正交 |
|---|---|---|
| GL `[-1,1]` | `mat4.perspective` | `mat4.ortho` |
| **WebGPU `[0,1]`** | **`mat4.perspectiveZO`** | **`mat4.orthoZO`** |

### 3.4 常量单一真源

**【核码】** 旧设计的投影常量**重复在四处，构成两对独立的 JS↔GLSL 副本**：

| 对 | JS 侧 | GLSL 侧 |
|---|---|---|
| 相机 | `src/core/camera/projectionType.js` | `fshader.glsl:8-11` |
| 贴图 | `Texture.js:14-15` | `fshader.glsl:12-13` |

两对目前**靠运气保持一致**（数值恰好相同），没有任何机制保证。相关的三个次生缺陷：

- `PROJECTION_FISHEYE` 只在**被注释掉的分支**里赋值 → 不可达的死常量
- GLSL 的 `tex_proj_fisheye()` **活着**、返回 `vec2(0.0, 0.0)`；JS 侧同名字段**抛异常** → 两侧行为互相矛盾
- `PROJECTION_TYPE_pannini` 命名风格与同组其他三个不一致

**新设计**：TS 常量做唯一真源，构建时生成两边，并加一条 L1 测试断言生成产物与源一致。于是「改一边忘了另一边」从**静默渲染错误**变成**测试失败**。

```ts
// core/constants.ts -- the single source of truth
export const CameraProjection = { Linear: 1, Cylindrical: 2, Planet: 3, Pannini: 4 } as const
export const TextureProjection = { Equirectangular: 1 } as const   // Fisheye: 2, unimplemented
```

生成产物：WGSL 的 `const X: u32 = 1;`（WGSL 无预处理器）、GLSL 的 `#define X 1`。

### 3.5 素材状态

```ts
export interface SourceState {
  kind: 'image' | 'video'
  /** The element to read from. Never retained past the current frame. */
  element: HTMLImageElement | HTMLVideoElement
  /** Equirectangular (or, later, fisheye). Named `TextureProjection` everywhere. */
  projection: TextureProjection
  /**
   * Bumped whenever the underlying pixels may have changed. This is how the
   * renderer answers "does the GPU texture need re-uploading" without
   * subscribing to media events.
   */
  version: number
  /** UPLOAD size in pixels -- already planned against maxTextureDimension2D. */
  width: number
  height: number
}
```

> **没有 `frameSize`。** 旧的 `frameSize` 选项兼了两个职责：超限时走中间画布、以及满足 WebGL1 的 2 的幂要求。前者并进 `width`/`height`（由 `planDownscale` 算好），后者**在 WebGPU 下根本不存在**（§5.1）。
>
> **`version` 取代了旧 `Texture` 里那个 `needUpdate_` 闩锁标志** —— 闩锁要被消费者清掉，谁清谁不清是 bug 温床；一个只增不减的计数器没有这个问题。

### 3.6 公开构造选项

旧签名是 `new FramelessImageViewer({ el, src, projection, frameSize, camera })`。**保留 `el` / `src` / `camera`，改两处：**

| 旧 | 新 | 为什么 |
|---|---|---|
| `projection: 'equiprectangular' \| 'fisheye'` | `projection: 'equirectangular' \| 'fisheye'` | **旧值是拼错的**（`equip-` → `equir-`）。这是公开 API 里的错字，趁大版本改掉 |
| `frameSize?: [w, h]` | **删** | 职责已并入 §3.5；WebGPU 无 2 的幂要求 |

`'fisheye'` 仍然接受但**构造即抛**（旧代码是渲染时才抛）—— 见 §6.3。

---

## 4. 渲染后端

### 4.1 Backend 接口

```ts
export interface Backend {
  readonly kind: 'webgpu' | 'webgl2'
  readonly capabilities: Capabilities

  setCamera (state: CameraState, projection: Projection): void
  setSource (source: RenderableSource | null): void
  render (): void
  resize (width: number, height: number, dpr: number): void
  dispose (): void

  /**
   * Registers a device-loss observer. Returns an unsubscribe function.
   *
   * Without this the backend has no way to tell anyone it died, and the viewer's
   * `device-lost` event (5.5) can never fire -- a lost device would present as a
   * frozen canvas with no error. Both backends implement it: WebGPU from
   * `GPUDevice.lost`, WebGL2 from `webglcontextlost`.
   */
  onDeviceLost (fn: (lost: DeviceLost) => void): () => void
}

/**
 * A source as a backend sees it: the upload description plus where the pixels
 * come from. `SourceState` alone is only the first half -- no backend can draw
 * from it.
 *
 * Structurally the same as `MediaFrame` (§5.1); declared here rather than
 * imported so the renderer layer does not depend on the media layer. `MediaFrame`
 * satisfies it without knowing it exists, so the viewer passes one straight
 * through and there is no adapter to drift.
 */
export interface RenderableSource {
  readonly state: SourceState
  readonly kind: 'image' | 'video'
  /** Never retained past the current task -- a video frame dies with its task. */
  readonly element: HTMLImageElement | HTMLVideoElement
  readonly version: number
}

/** Why a device went away. `reason` is the API's own token; `message` is detail. */
export interface DeviceLost {
  readonly reason: string
  readonly message: string
}
```

Backend **吃 `CameraState` 和 `Projection`**（`core/` 的类型），**注入自己的 `depthRange`**。

### 4.2 Uniform 布局

**【实测】** WGSL 的 uniform 地址空间允许**4 字节对齐的连续标量**，不是 std140 的每成员 16 字节。两个后端（Metal / SwiftShader）实测一致。搞错这条**不会编译失败，会静默读到垃圾**。

| offset | 字段 | 类型 | 字节 |
|---|---|---|---|
| 0 | `invClip` | `mat4x4<f32>` | 64 |
| 64 | `projKind` | `u32` | 4 |
| 68 | `texProjKind` | `u32` | 4 |
| 72 | `povLatitude` | `f32` | 4 |
| 76 | `povLongitude` | `f32` | 4 |
| 80 | `zoom` | `f32` | 4 |
| 84 | `_pad0` | `f32` | 4 |
| 88 | `_pad1` | `f32` | 4 |
| 92 | `_pad2` | `f32` | 4 |

**总计 96 字节，16 字节对齐**（`96 % 16 == 0`）。三个 `_pad` 是**对齐填充，不是死 uniform**。

**【实测】** `gl-matrix` 的列主序可直接映射到 `mat4x4<f32>`：`u.invClip[col][row]` ⟷ `elements[col*4+row]`，**不需要转置**。

> **为什么是 `invClip` 而不是 `clip`。** 顶点着色器不再变换几何（全屏三角形直接从顶点索引吐 NDC），所以 `clip` 没有任何读者。片元着色器反过来需要**把屏幕坐标还原成投影公式要的那个点** —— 见 §4.5。`invClip` 就是那个还原，对四个投影是同一个，这是全屏三角形能成立的关键。

> **WebGPU 没有反射**（没有 `getUniformLocation` 的等价物）。所以 JS 侧的偏移必须由一条**往返布局测试**保护 —— 往每个字段写哨兵值、渲染、回读断言。探路时写的那版就是模板。

### 4.3 Bind group 划分

```
group 0:  { camera: CameraUniforms, source: SourceUniforms }   ← 每帧更新
group 1:  { samp: sampler, tex: texture_2d<f32> }              ← 静态图路径
          { samp: sampler, tex: texture_external }             ← 视频路径
```

**2 个 group**。**【实测】** 预算 4（`maxBindGroups: 4`），有余量。两个 pipeline layout 只在 group 1 有差异，group 0 完全复用。

### 4.4 视频路径的硬约束

**【实测】** `GPUExternalTexture`（`importExternalTexture`）在**当前微任务结束时失效**，且 **bind group 持有它不能续命**：

> **视频路径必须每帧重建 bind group** —— import → 建 bind group → 编码 → 提交，全部在同一段同步代码里完成，不能跨帧缓存。

并且它**没有 `flipY` 选项**（只有 `copyExternalImageToTexture` 有）。**. 【核码】** 旧代码用 `UNPACK_FLIP_Y_WEBGL` 处理朝向 —— 迁移后没有对应物。

| | `importExternalTexture` | `copyExternalImageToTexture` |
|---|---|---|
| 拷贝 | **零拷贝** | 每帧一次 GPU 拷贝 |
| bind group | 每帧重建 | 可稳定复用 |
| `flipY` | ❌ | ✅ |
| 支持源 | video / VideoFrame | image / ImageBitmap / canvas / video |

**决策**：视频走 `importExternalTexture`（零拷贝是这个路径存在的全部意义），静态图走 `copyExternalImageToTexture`（只传一次，稳定 bind group）。

**朝向统一在着色器的 UV 计算里处理，两条路径都不用 `flipY`。** 一个约定、两条路径共用。否则会出现「换个数据源画面上下颠倒」这类只在单条路径复现的 bug。

> 每帧重建 bind group 并不比现状差：旧 `Texture` 的 `frameSize` 模式每帧要走一次 canvas 往返 + `drawImage`（CPU 侧拷贝），比一次描述符分配贵得多。

### 4.5 几何：全屏三角形

**【核码】** 旧设计的几何按相机分族：

| 相机族 | 几何 | 距离 |
|---|---|---|
| Linear | `Cube(100)` 的 6 个面（12 三角形） | 100 |
| Cylindrical / Planet | `Polygon` 四边形 | 1 |

**新设计：一个全屏三角形，3 个顶点，无顶点缓冲、无顶点属性。**

#### 为什么成立

顶点着色器整个就是透传：

```glsl
attribute vec4 a_Pos;
varying vec4 v_Pos;
uniform mat4 u_CamTransMatrix;
void main() { v_Pos = a_Pos; gl_Position = u_CamTransMatrix * a_Pos; }
```

**素材从来没有绑在几何上** —— 没有 UV 属性、没有 `samplerCube`、没有逐面绑定。是**一张二维等距柱状图**，用「算出来的 UV」去采（`fshader.glsl:131`：`texture2D(u_Sampler, tex_proj())`）。

所以立方体的作用**不是展示面，是给每个像素造一个方向**。摄像机在中心 → 每条视线恰好命中立方体一次 → 光栅化插值出命中点 P → P 的方向就是视线方向。

**而立方体算出的那点坐标，下一秒就被除掉了** —— 所有线性投影公式都是**零次齐次**的：

```glsl
theta = atan(z / x);                  // atan(kz/kx) == atan(z/x)
phi   = atan(y / sqrt(x*x + z*z));    // atan(ky / k·sqrt(..)) == atan(y/sqrt(..))
```

着色器**连 `normalize()` 都没调用过**。半径 100 纯属随便填（常量名还是拼错的 `SPHERE_READIUS`）。

**每像素需要的只是一个能标识像素的坐标** —— 而硬件白送：WGSL 的 `@builtin(position)`。

#### 最强论证

**一个 12 三角形的立方体铺满 360° 全景，画面还是对的。** 如果几何有任何分辨率意义，这是荒谬的 —— 球面不失真需要几千个三角形。它能工作，正因为**投影是逐片元的**，三角形的唯一职责是「覆盖屏幕」，而**覆盖与相机朝向无关**。

既然 12 个够，1 个当然也够。

#### 非线性相机：一个必须说清的区别

**【核码】** 非线性相机的公式**不是齐次的**：

```glsl
// 圆柱：z 直接乘 TWO_PI，没有比值 —— 尺度信息被真的用到
theta = z * TWO_PI - lng / 2.0;
phi   = atan(y) + HALF_PI;          // atan(y)，y 的大小有意义
```

所以四边形**铺多大是投影参数的一部分**：

| 相机 | 常量 | z 范围 | theta 范围 |
|---|---|---|---|
| cylindrical | `CAMERA_WITH/HEGHT = 1` | `[-0.5, 0.5]` | `[-π, π]` ✓ 正好一圈 |
| planet / pannini | `= 4` | `[-2, 2]` | `[-4π, 4π]` |

**【核码】** 三条证据表明四边形的几何**本来就没参与运算**：

1. **`u_CamGeoWidth` / `u_CamGeoHeight` 是死 uniform** —— `fshader.glsl:17-18` 声明，**全着色器零次引用**。而三个非线性相机每帧都在算它们、上传它们。
2. **`x` 在 `cam_proj_cylindrical` / `cam_proj_planet` 里一次都没读** —— 四边形躺在 `x = 1` 平面上，所以 `x ≡ 1` 是常数，顶点坐标里那一列纯粹是为了「让它是个合法的 3D 四边形」。
3. `cam_proj_pannini` 看着用了 `x`（`atan(z * 0.5 / x)`），但 `x ≡ 1`，等于没参与。

**结论：那四个顶点的唯一职责是给每个像素产出一对 `(y, z)`。**

**新设计**：不做仿射重映射 —— **把相机矩阵求逆，让逆矩阵自己去还原那个坐标**。

```wgsl
// The legacy rasteriser picked which part of the surface landed on screen and
// interpolated the position for each pixel. Here that is inverted: given a
// screen position, `invClip` recovers the point the rasteriser would have
// produced.
let h = camera.invClip * vec4f(ndc, 1.0, 1.0);
let p = h.xyz / h.w;   // 线性：远平面上的点，方向即视线
                       // 非线性：四边形上的点 (1, y, z)
```

**为什么不是 spec 早先写的 `(uv - 0.5) * extent`**：那条路要分两支 —— 非线性走仿射，线性得在着色器里**从角度重建朝向**（还要复刻 `lookAt` 那个 `-sin(θ)` 的手性）。而逆矩阵这一条**四个投影共用**，因为：

- 线性相机的 `clip = proj × view`，逆回去得到远平面上一点，`normalize` 后就是视线。线性投影是零次齐次的（`atan2(z,x)` 与 `atan(y/√(x²+z²))` 都只看比值），**点的距离不含信息** —— 这正是立方体可以被删掉的原因。
- 非线性相机的 `clip` 是一个把 `(1, y, z)` 映到屏幕的仿射矩阵，逆回去**正好**是那个四边形上的点。

**一个矩阵、一次乘法、一次透视除法，替掉整个几何子系统**：`Cube` / `Polygon` / `Sphere` / `Geometry` / `Vertex` / `mesh` / `flatten` / `clone` / `geoVertexes` / 顶点缓冲 / `camera.id` 重建判断 / 每次换相机漏掉的 buffer。全部删除。

> **两个后端的 far 平面都落在 ndc z = +1**（GL 的 z∈[-1,1] 与 WebGPU 的 z∈[0,1] 都满足），所以着色器取 `z = 1` 对两个后端都对 —— **着色器不需要知道深度约定**。
>
> **`extent` 因此不进 uniform**：它只在 CPU 侧建矩阵时用。这和 F6 的结论一致 —— 该参数终于有了真实的读者。

> **【待验证】** 逆矩阵必须精确复现旧的坐标范围。错一个常数画面就歪。**门禁 B**（§10.3）。

### 4.6 深度缓冲：删掉，而不是修

**【核码】**

```
src/utils/gl.js:18-19     gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL)
src/core/Renderer.js:144  gl.clear(gl.COLOR_BUFFER_BIT)    ← 只清颜色
src/core/Renderer.js:163  gl.clear(gl.COLOR_BUFFER_BIT)    ← 同上
```

深度测试开着、`LEQUAL`、**深度缓冲从不清理**。于是这一帧的片元能不能画出来，取决于它跟**上一帧**深度值的比较。静止画面下是空操作（深度相等，通过），所以它一直「看起来是对的」。

但几何距离会变 —— 换相机族时从 100 变到 1（或反过来）。**正确性当前就依赖这个。**

**新设计：一个三角形，不开深度测试，不要深度附件。** F4 不是被修好，是**变得无法表达** —— 比修好更彻底。

代价：将来要做叠加层或真 3D 内容，深度得请回来。YAGNI，记一笔。

### 4.7 渲染循环

**【核码】** 旧设计每帧无条件重绘，只靠 `MAX_FRAME_RATE = 60` 限速。一张静止的 360 照片白白唤醒 GPU 60 次/秒 —— 笔记本和手机上是实打实的耗电。

新设计保留 rAF 循环，但**脏检查必须在 `getCurrentTexture()` 之前**：

```ts
// Acquiring the swapchain texture without submitting is a validation error, so
// the early-out has to precede the acquire, not follow it.
if (!cameraDirty && !sourceDirty) return
```

静止图片空闲时 GPU 工作量为 0；视频路径永远脏，永远画。

### 4.8 尺寸与 DPR

**【核码】** 旧设计用 `window.addEventListener('resize')`，`dispose` 里调的是 **`window.removeEventLstener(...)`** —— 拼错，监听器从来不摘。

**【核码】** 旧代码**完全没有处理 devicePixelRatio**：`canvas.width` 直接等于 CSS 像素。**在任何 Retina/高分屏上这个查看器一直是糊的。** 这是用户可见的 bug，不是细节。

新设计：容器上挂 `ResizeObserver`，`dispose()` 里 `disconnect()`；`canvas.width = Math.round(clientWidth * devicePixelRatio)`，尺寸变化时重建 swapchain。

### 4.9 着色器分叉

**【实测】** WGSL 与 GLSL ES 3.00 **无法共用源码**：`texture_external` 没有 sampler-less 采样入口，必须用 `textureSampleBaseClampToEdge`，普通 `textureSample` 编译不过；GLSL 没有对应物。

所以是两套着色器 —— 这是**架构上无法消除的分叉**，只能管理它。

**管理手段就是 §9.3 的跨后端像素交叉验证。** 这条测试不是锦上添花，**它是维持两份实现不漂移的唯一机制**。没有它，分叉就是纯粹的负债。

**【核码】** 升到 GLSL ES 3.00 会顺手修掉一个现存违规：`fshader.glsl:32` 的 `float lng = u_CamPOVLongitude / 2.0;` 是**全局作用域的非常量初始化**，在 ESSL 1.00 和 3.00 里**都非法**，只是 ANGLE 容忍了它。重写后必须移进函数体。

---

## 5. 媒体与交互

### 5.1 素材源

```ts
export interface MediaSource {
  readonly state: SourceState
  /** True when the GPU side must re-read this source this frame. */
  needsUpload (): boolean
  dispose (): void
}
```

`ImageSource` 走 `copyExternalImageToTexture`（一次），`VideoSource` 走 `importExternalTexture`（每帧）。

素材源把媒体元素的 DOM 事件重发为 `media-<type>`（`media-load` / `media-error` / `media-play` ……），冒泡到 viewer。

### 5.2 交互

改用 **Pointer Events**（取代分别处理 mouse 与 touch），手势识别通过合成**语义事件**上报：

```ts
pan:  { deltaX: number, deltaY: number }
zoom: { delta: number }
```

`viewer.PTZ = false` 短路处理，但**不解绑监听器**（保持旧行为）。

### 5.3 DOM 监听：`AbortController`

**【核码】** 旧代码的 DOM 监听散落在 `Delegate` / `ZoomPlugin` / `PanPlugin` / `Provider` 四处，靠人手配对 `addEventListener` / `removeEventListener`，**已经漏了三处**（见 §11）。

```ts
const ac = new AbortController()
el.addEventListener('pointerdown', this.#onDown, { signal: ac.signal })
// dispose():
ac.abort()      // one call removes every listener bound to this signal
```

可以**串联**：子组件的 signal 挂在父组件上，父的 `abort()` 整棵树全清。**「漏摘监听器」从「人要记得」变成「结构性不可能」。**

### 5.4 组合取代 mixin

**【核码】** 旧设计：

```js
const ViewerBase = mix(Eventable).with(Delegate, RenderFlow)
export default class Viewer extends ViewerBase { ... }
```

问题不在语法，在**语义**：`mix` 让 `Viewer` **是**一个 `Delegate`、**是**一个 `RenderFlow`。后果：

- 所有成员挤进同一个命名空间（`PTZ` / `frameWidth` / `rotate` / `src` / `cameraOptions` 全在一层）
- 初始化顺序由 mixin 顺序**暗中**决定
- **`dispose()` 靠 `super` 链隐式串联** —— 漏一环就漏一处释放

**§11 里那几处释放泄漏，正是这个模式的产物**：不是「有人忘了写 dispose」，是**释放顺序存在但不可见**。

新设计用组合：

```ts
class Viewer {
  readonly #renderer: Renderer
  readonly #input: InputController
  readonly #camera: CameraController
  readonly #source: MediaSource
}
```

每层有自己的 `dispose()`，`Viewer.dispose()` **显式**逐个调。顺序写在代码里、看得见、测得到。

> TS 原生 mixin（`Constructor<T>` 模式）确实支持，但**这里不需要** —— mixin 是「多重继承的替代品」，而这里根本不需要多重继承，需要的是**委托**。

### 5.5 事件系统

```ts
interface ViewerEvents {
  'media-load': { target: Viewer }
  'media-error': { target: Viewer, error: unknown }
  rotate: { lat: number, lng: number }
  zoom: { delta: number }
  'device-lost': DeviceLost
}

class EventEmitter<M extends Record<string, unknown>> {
  on<K extends keyof M> (type: K, fn: (evt: M[K]) => void): () => void
  off<K extends keyof M> (type: K, fn: (evt: M[K]) => void): void
  protected emit<K extends keyof M> (type: K, evt: M[K]): void
}
```

两个改进：**事件名与载荷都有类型**（`on('roate', ...)` 编译不过）；**`on()` 返回取消订阅函数**（比 `off()` 更不容易漏，与 §5.3 同一个思路 —— 让正确做法比错误做法更容易）。

通配转发（旧的 `trigger('*')`）保留，用类型表达：`on('*', (type, evt) => ...)`。

---

## 6. 生命周期与错误处理

### 6.1 装饰器全部删除

**【核码】** 旧代码的装饰器用量：

```
@undisposed  ×100      @disposable ×4      @eventable ×4
@hasid       ×1        @callback   ×2
```

**一个都不移植。**

| 旧 | 新 |
|---|---|
| `@undisposed` ×100 | 显式 `assertAlive()`，**只在公开边界约 8 处** |
| `@disposable` ×4 | `Disposable` 抽象基类 |
| `@eventable` ×4 | `EventEmitter<EventMap>` 基类（§5.5） |
| `@hasid` ×1 | **删** —— §4.5 删掉顶点缓冲后它自然死亡 |
| `@callback` ×2 | `AbortController` + `closest()`（§5.3） |

#### 为什么 `@undisposed` 防错了对象

它防的是「用户拿着已 dispose 的 viewer 继续调方法」。但**这个库真正的 use-after-dispose 风险不来自用户**，来自**内部异步回调**：

```
FrameDriver 的 rAF 循环 → renderFrame() → this.renderer_.render(...)
```

这条路径**一个 `@undisposed` 成员都不经过**。也就是说 100 个装饰器保护的是**最不可能发生、一旦发生最吵**的那种误用，漏掉的是**最可能发生、完全静默**的那种。

**100 个包装函数买到的是一层错位的保护**，附带 100 个额外栈帧。

新设计不靠装饰器：`dispose()` 幂等 + 撕裂顺序正确（活着的生产者够不到死掉的消费者）+ 公开边界约 8 处显式 guard。

#### 标准装饰器也救不了

TC39 stage 3 语义下：`(value, context)` 取代 `(target, key, descriptor)`；**getter 和 setter 是两次独立的装饰器应用**。能扛，但代价不值得：

- 100 处要逐个确认是 getter 还是 setter
- **类装饰器**能返回新类，但 **TS 推断不出「这个类现在多了个 `dispose()`」** —— 你还是得手写接口声明。**装饰器一点忙没帮上。**

生命周期这种核心契约用**抽象基类**才对：TS 真能类型化、调用方看得见、不需要额外声明文件。

### 6.2 dispose 顺序

```
Viewer
 ├─ InputController           →  DOM 监听（AbortController）
 └─ Renderer
     ├─ FrameDriver           →  rAF 循环            ← 必须先死
     ├─ Backend               →  device / pipeline / texture / buffer
     └─ MediaSource           →  <img>/<video> + DOM 监听
```

**原则：先停生产者，再拆消费者。** 旧代码的顺序是对的（`driver_ → renderer_ → texture_ → camera_`），但漏了五处 —— 见 §11。

### 6.3 构造失败必须抛，不能 log

**【核码】** `gl.js` 的 `createProgram`：

```js
if (!linked) {
  log.error(`Failed compiling shader, error log: ${gl.getProgramInfoLog(program)}.`)
  gl.deleteProgram(program)
  return null          // ← 返回 null，然后呢？
}
```

返回 `null` → `programs_['dummy'] = null` → 之后每帧 `gl.useProgram(null)`。**viewer 构造「成功」了，然后永远什么都不画，只留一条 log。** 而 `log` 是 chivy，默认级别下这条可能根本不打印。

**一个着色器编译不过的 viewer 不是 viewer。构造时就该抛。**

WebGPU 这边有两个东西正好把这条路堵死：

1. **`getCompilationInfo()`** 给出带**行列号**的 WGSL 错误，远强于 GLSL 那个字符串日志
2. **但 WebGPU 的校验错误是异步的、不抛异常的** —— `createRenderPipeline` 失败不 throw，错误进 error scope，你拿到一个无效 pipeline，然后静默什么都不画

所以必须显式包：

```ts
device.pushErrorScope('validation')
const pipeline = device.createRenderPipeline(desc)
const err = await device.popErrorScope()
if (err) throw new Error(`pipeline creation failed: ${err.message}`)
```

> **不包 error scope 的话，会精确复现旧代码那个「静默失败」，只是换了个 API。**

### 6.4 设备丢失

**【核码】** 旧代码里 `contextlost` / `contextrestored` / `isContextLost` / `WEBGL_lose_context` —— **一个都没有**。

WebGPU 里 `device.lost` 是个 Promise，会在 **GPU 进程崩溃、驱动复位、标签页被挂起**时兑现。不处理它，画布永久黑掉且没有任何提示。

**设计立场：**

- **检测 + 上报**：`device.lost` → 发 `device-lost` 事件，带 `reason` 和 `message`
- **结构上允许重建**：所有 GPU 资源由单一 `GpuResources` 持有，**从不可变的 CPU 侧描述重建**（着色器源码 → pipeline，几何描述 → buffer）。CPU 侧状态（相机、素材源）原样保留
- **本期只做检测 + 干净释放**（用户可以重新 `new` 一个 viewer）。**自动恢复留作后续纯增量改动** —— 因为 dispose/re-init 这条路本来就得存在，重建只是复用同一条路径

### 6.5 能力探测与静默降级

后端从 WebGPU 掉到 WebGL2 是一个**可编程的状态**，不是日志里一行字：

```ts
const caps = await FramelessImageViewer.probe()
// { backend: 'webgpu' | 'webgl2', adapter: {...}, limits: {...}, features: [...] }
```

应用可以自己决定怎么展示、怎么上报、要不要降级提示。**打印只是它的一种消费方式。**

---

## 7. 依赖

### 7.1 替换表

| 包 | 实际用到什么 | 处置 |
|---|---|---|
| `konph` | **零引用** | 删除 |
| `polygala` | **零引用** | 删除 |
| `shortid` | 2 处 id 生成 | 删 → 原生 `crypto.randomUUID()` |
| `lodash` | `isArray`×4 `isString`×1 `merge`×2 | 删 → `Array.isArray` / `typeof` / 对象展开 |
| `chivy` | 3 处 Logger | 删 → `debug`（见 §7.2） |
| `param-check` | 19 处边界校验 | 删 → 类型 + 少量显式范围断言 |
| `dodele` | `Delegate` + `@callback` | 删 → `AbortController` + `closest()` |
| `litchy` | 装饰器 + mixin + Eventable | 删 → §5.4 / §5.5 |
| `vendor/cuon.js` | **4 个方法** | 删 → `gl-matrix` |

**【核码】** `lodash` 的 `merge` 用在 `CameraFactory` 的 `merge({}, defaultDataMap[type], data)` —— 这是**默认值合并**，选项对象是扁平的 → `{ ...defaults, ...data }` 就够。**浅合并更好**：深合并会静默接受拼错的键名和多余键，显式展开则**编译期报错**。

**【核码】** `vendor/cuon.js` 是《WebGL Programming Guide》的随书辅助文件，762 行。项目实际调用的 Matrix4 方法**数出来是四个**：`setPerspective` / `setOrtho` / `setLookAt` / `multiply`（外加读 `.elements`）。

### 7.2 为什么是 `gl-matrix`

四个函数自己写也就 80 行。但 `gl-matrix` 有一样自己写不出来的东西：**它把深度约定做成了 API 的一部分**（§3.3）。

其余理由：主流活跃、零依赖、**自带 TS 类型**、列主序 `Float32Array` **与 WGSL `mat4x4<f32>` 直接对应**【实测】、tree-shakeable。

### 7.3 日志：`debug`

**【实测】** `debug` 的实际状况（**不是零依赖，也不自带类型**）：

```
latest        : 4.4.3
dependencies  : {"ms":"^2.1.3"}
types field   : (none)          → 需要 @types/debug
```

**决策：用 `debug`。** 2 个运行时依赖（`debug` + `ms`）+ 1 个类型依赖，换命名空间通配/取反、终端着色、Node/浏览器统一 API、社区共识（`DEBUG=pano:*`）。

```ts
// src/diagnostics.ts -- trace channels, declared once so the full set is
// discoverable and a typo'd namespace cannot compile.
import createDebug from 'debug'

export const channels = {
  viewer: createDebug('pano:viewer'),
  renderer: createDebug('pano:renderer'),
  gpu: createDebug('pano:gpu'),
  camera: createDebug('pano:camera'),
  media: createDebug('pano:media'),
  input: createDebug('pano:input')
} as const
```

一个对象而不是六个具名导出：调用点是 `channels.gpu(...)`，读起来就说清了「这是日志」，而 `dGpu(...)` 在一屏代码里长得像业务函数；`as const` 保留字面量键，所以拼错 `channels.gpuu` 编译不过，和具名导出一样安全。

```shell
DEBUG=pano:*              # 全部
DEBUG=pano:gpu            # 只看 GPU 层
DEBUG=pano:*,-pano:media  # 排除视频层（否则每帧刷屏）
```

**「结果走事件、过程走 debug」这条分工是硬约束**：`debug` 解决的是「库开发者想看内部状态」，解决不了「应用需要知道后端降级了」。后者必须是可编程状态（§6.5）。

> **为什么不用 chivy**：不是「它不好用」，是**它默认往 console 写**。一个被 `npm i` 进来的库自带 console 输出，是使用者最常抱怨的那类事；生产环境还有实打实的开销。`debug` 默认全静默，要用的人主动开。

### 7.4 净结果

```
dependencies         gl-matrix, debug (+ ms)        ← 从 8 个降到 3 个

devDependencies      typescript, tsup, vitest, @vitest/coverage-v8,
                     playwright, @types/debug        ← Babel 6 全套 + isparta +
                                                        istanbul + webpack 3 +
                                                        webpack-glsl-loader 全部退出
```

**一个反方向的风险**：`param-check` 提供了 `instanceOf(Camera)` 这类**运行时**品牌校验。删掉它意味着「传错对象」从运行时报错变成**编译期报错** —— 更好，但前提是**类型定义别写成 `any`**。配套要求：`tsconfig` 开 `strict` + `noUncheckedIndexedAccess`，公开 API 不接受 `any`。

---

## 8. 构建与分发

| 产物 | 命令 | 用途 |
|---|---|---|
| `dist/pano-gl.js` + `.min.js` | `tsup` | UMD/ESM 包，GLSL/WGSL 内联 |
| `dist/*.d.ts` | `tsup` | 类型声明 |
| `docs/` | `typedoc` | API 文档 |

**旧设计的一个真实痛点必须解决**：`package.json` 的 `main` 指向 `lib/index.js`，而 `lib/` 是 `babel src -d lib` 的产物 —— 里面留着 `require('../shader/vshader.glsl')`，**任何普通 Node/babel 进程都解析不了**（`.glsl` 只有 webpack 的 `webpack-glsl-loader` 认得）。所以 `pano.gl/lib/...` 的消费者必须自带 glsl loader。

**新设计**：着色器源码在构建时内联为 TS 字符串常量，**发布产物零外部资源依赖**。`main` 指向的产物能被任何打包器直接消费。

---

## 9. 测试策略

### 9.1 探路已钉死的三件事

1. **【实测】同一后端内多次运行逐比特一致**（整个 256×256 float 缓冲哈希相同）→ golden image 容差可以设紧，不必为「渲染噪声」留余量
2. **【实测】跨后端亚像素**：最大偏差 `5.38e-5`；**最大误差在纬度通道的近极点**（`asin` 在 `|arg|→1` 时病态）→ L4 容差 `±1~2 LSB`，**极点区域单独放宽**，不能用一个全局紧容差
3. **【实测】Playwright 默认 headless 是 headless shell，WebGPU 不可用** → 见 §9.5

**【实测】额外收获**：投影哈希在 Chrome 149 与 153 上相同 → **数值行为跨浏览器版本稳定**，golden image 不会因小版本升级而失效。

### 9.2 目录

```
test/unit/{sourceFileName}.test.ts        纯逻辑，vitest，分支覆盖 ≥90%
test/integration/{userStoryName}.test.ts  每个 User Story 一个文件，Playwright
test/fixtures/                            素材与期望值
```

**L3 / L4 不单独建套件，它们是集成测试的「断言机制」。** 一个用户故事是「我旋转视角，画面跟着转」—— 它怎么断言「画面是对的」？就是跨后端比像素。这样目录约定和验证机制统一，不是两套。

### 9.3 三层验证，各抓一类错

| 机制 | 抓什么 | **抓不到什么** |
|---|---|---|
| L1 单元测试 | 纯逻辑、边界、异常入参 | GPU 行为 |
| **CPU 参考实现（float64）** | **两个后端一致地错** | 性能、驱动差异 |
| L4 双后端交叉 | 两份着色器实现漂移 | **一致地错** |
| L3 golden image | 无意的视觉回归 | — |

**第二行是重点。** 交叉验证听起来很硬，但有明确盲区：**如果两份着色器基于同一个错误理解写完，交叉验证会一致通过。** 探路时已写过一版 CPU 参考实现（float64，逐点比对），**它必须成为常驻测试**。

> 四个投影 × 两个后端 = 8 组 GPU 结果，全部对同一个 CPU 参考实现比 —— 这是唯一能同时抓住「漂移」和「一致地错」的结构。

### 9.4 迁移期的一次性资产：跟旧实现对拍

**旧实现是易腐资源。**

在删掉 v0.2.2 之前，让新旧两份实现吃同一批输入、渲染同样的相机参数、逐像素比 —— 每个投影各来一轮。结果是「我有没有把投影改坏」这个问题从**争论**变成**一个数字**。

**这件事只有现在能做。** 旧代码一删，这个能力永久消失。所以它排在实施路线的**第一步**（§10 的 P0）。

P0 要捕获**两样**：

- **像素** —— 四个投影 × 多组 `(povLatitude, povLongitude, zoom)` 的帧缓冲
- **uniform 流** —— 每一帧实际发给 GPU 的矩阵与标量

第二样才是 P2 能直接用的东西 —— 像素要整条管线跑通才能比，而 **uniform 流让 `core/` 这一层在还没有渲染器的时候就能被验证**。

> **实践细节**：把 `npm run build` 产出的 bundle **一起提交**。基线不能依赖「2027 年还能装上 Babel 6」。

### 9.5 CI 配置：把静默降级写成代码

**【实测】** Playwright 默认 headless 起的是 `chrome-headless-shell`：WebGL 一切正常、像素也对，**只有 WebGPU 拿不到适配器**（`requestAdapter()` 返回 `null`）。整套 WebGPU 测试变成空跑，CI 依然全绿。

**危害不在于「全黑报错」，而在于「看起来是对的」。**

```ts
// Playwright's default headless launch is chrome-headless-shell, which has no
// WebGPU at all. Without this guard the entire WebGPU suite silently no-ops and
// CI stays green -- the failure mode is "looks fine", not "reports an error".
test.beforeAll(async ({ page }) => {
  const adapter = await page.evaluate(() => navigator.gpu?.requestAdapter() ?? null)
  expect(adapter, 'no WebGPU adapter: check channel:chromium / --disable-gpu').not.toBeNull()
})
```

启动配置按**两个维度**选，不是「真 GPU 还是软渲染」一个问题：

| 用途 | 配置 | 理由 |
|---|---|---|
| **日常 CI** | `channel: 'chromium'` + SwiftShader | **【实测】** 数值最贴近 CPU 真值（`~1e-7` vs Metal 的 `~5e-5`）、不要求 runner 有 GPU、跨机器可控 |
| **端到端冒烟** | 真 GPU | 验证真实驱动路径 |

**【实测】`executablePath()` 会骗人** —— 两种模式下它返回的都是完整浏览器的路径，只有 `DEBUG=pw:browser` 打出的真实命令行才暴露实际启动的是哪个二进制。**这条要写进测试文件的注释里**，否则后来者一定会踩。

同时：**不要让任何工具默认加 `--disable-gpu`**。CI 配置里应当显式断言 GPU 可用，而不是假设。

### 9.6 覆盖率那条要求有个洞

CLAUDE.md 要求分支覆盖 ≥90%。但：

- **TS 代码**：vitest coverage 能测，`≥90%` 可达
- **着色器代码**：**coverage 工具完全看不见** —— 而它恰恰是这个项目最核心、最容易错的代码

**不能假装 90% 覆盖了整个项目。** 着色器的正确性靠 §9.3 那张表（CPU 参考 + L4 交叉）保证，而不是靠覆盖率数字。这两句话都得写进测试文档。

### 9.7 容易漏但可测的场景

| 场景 | 怎么测 |
|---|---|
| 设备丢失 | `device.destroy()` —— **【实测】真能触发 `device.lost`** |
| DPR / 高分屏 | Playwright 的 `deviceScaleFactor` |
| 手势 | `page.mouse` / `dispatchEvent` 合成 pointer 序列 |
| 视频真实解码 | **【实测】** H.264 `probably`、VP8 实际解码成功 → **不必退化成 captureStream** |
| 后端降级 | 屏蔽 `navigator.gpu`，断言走 WebGL2 **且降级可被观测** —— v1 不为此加事件：`probe()` 返回带 `backend` 判别的 `SelectedCapabilities`，构造后的 `viewer.capabilities.backend` 也读得到。事件是「事后通知」，而这里要的是「事前可问」，后者才是旧 `createProgram` 那个坑的解法 |

---

## 10. 迁移路线

### 10.1 为什么是这个顺序

两个约束决定一切：

1. **旧实现是易腐资源**（§9.4）—— 对拍能力只在旧代码还在时存在
2. **三层「待验证」的门禁**都需要一个**已经存在的基准**才能判定

所以 **P0 不是「准备工作」，P0 是整条路线的地基。** 它先于任何重构。

### 10.2 分期

| 期 | 内容 | 验收标准 | 旧代码 |
|---|---|---|---|
| **P0** | **冻结基线** | **已完成**：四个投影 × 4 组相机状态的**像素**与 **uniform 流**已捕获并提交，清单见 `test/fixtures/baseline/index.json`（逐条含 PNG 字节数与 sha256），捕获器与判据见 `tools/baseline/`，读数与推论见 `test/fixtures/baseline/README.md` | **依赖** |
| P1 | 工具链骨架 | `npm run build` 出包；`npm test` 真在跑测试；CI 断言 WebGPU 可用 | 不动 |
| P2 | `core/` 纯逻辑 | 分支覆盖 ≥90%；常量生成器测试通过；**CPU 参考实现复现 P0 的 uniform 流** | 不动 |
| P3 | `renderer/` + WebGPU | **门禁 A、B 通过**；golden image 命中 | 参考资料 |
| P4 | `media/` + `interaction/` | 图片 / 视频用户故事的集成测试全绿 | 参考资料 |
| P5 | `viewer/` 组装 + 公开 API | 完整集成套件绿；**公开 API 冻结** | 参考资料 |
| P6 | **WebGL2 后端** | **门禁 C 通过**；8 组组合全部对上 CPU 参考 | 参考资料 |
| P7 | 删旧代码 + 收尾 | 依赖 = 3；无死代码；文档更新 | **删除** |

### 10.3 三道门禁

| 门禁 | 位置 | 验什么 | 失败意味着 |
|---|---|---|---|
| **A** | P3 | 全屏三角形替掉立方体/四边形后，**四个投影各自**与 P0 基线比像素。**可比状态是从基线派生的子集，不是"全部"**：F5 把三个非线性相机限制在 `lat == 0`（v1 刻意让纬度生效，纬度非零处本来就该不一致），F12 把 zoom 可比性限制在 `pannini`（其余相机的放大被 v0.2.2 丢掉），F10 实测生效故非零经度仍可比。逐条推导见 `test/fixtures/baseline/README.md` 末节 | 某个投影的片元着色器其实依赖几何细分（§4.5 被推翻） |
| **B** | P3 | 非线性相机的**逆矩阵还原**精确复现旧坐标范围（cylindrical 1×1、planet/pannini 4×4） | 旧的分段行为里有没看懂的东西 |
| **C** | P6 | WGSL vs GLSL 跨后端一致，±1~2 LSB，极点放宽 | 两份实现的数值路径差异超预期 |

**失败预案：**

- **A 失败** → 退回按投影分族的几何。后端接口本来就允许（`projection` 决定几何）。**损失只是「没省掉几何子系统」，架构不动。**
- **B 失败** → 拿 P0 的 uniform 流逐帧对，定位到具体哪个 uniform 对不上。
- **C 失败** → 先用 CPU 参考做仲裁，确认是**容差定太紧**还是**某一边实现错了**。这两个原因的处置完全不同，不要混。

### 10.4 关键路径与并行

```
硬路径（串行）：  P0 ──→ P2 ──→ P3 ──→ P6

可并行：
  P1  ─┘（与 P0 并行，互不依赖）
                    P3 通过后 ┬─→ P4 ──→ P5
                              └─→ P6
```

**P4/P5 可以和 P6 并行** —— 因为 `media/` `interaction/` `viewer/` **只依赖后端接口，不依赖哪个后端实现**。这条并行度是分层设计的直接红利。

### 10.5 回滚点

**P1–P4 之间没有「可发布」的中间状态** —— 那几期的产物不是能用的 viewer。

真正的安全属性不在回滚点，在**旧版本原封不动地继续发布**：

> **v0.2.x 全程可用、不被触碰。** 新实现走独立分支，P5 之前不发布。所以「回滚」就是「不发布」。

> **勘误（2026-09-20，用户裁决）**：上一段的「v0.2.x 全程可用」半句废弃。经查证，该约束系设计共创时由 AI 写入、用户从未主动要求或逐条确认；用户质询其来源后裁决砍掉。发版的真正保险是 **git 历史**——需要发 0.2.x 修复时 checkout 迁移前提交构建发布（Task 1 已实测本机 Node 22 能跑旧 webpack 构建），不在 master 上维护一条 2017 年构建链（约 12 个 webpack 3 / babel 6 devDependencies + CI job）。落地见 P1 plan 的拍板变更 II。本段仍然成立的部分：「新实现 P5 之前不发布」；§10.6 的「旧版 0.2.x 保留（代码在 `legacy/`，不强制升级）」不受影响——**保留**不等于**持续可构建发版**。

### 10.6 版本

- 新版本 **v1.0.0**
- **公开 API 在 P5 冻结**，之后写迁移指南（旧 → 新对应表）
- 旧版 `0.2.x` 保留，不强制升级

---

## 11. 已知缺陷清单

本设计修掉的全部旧缺陷。**【核码】** 全部经源码确认；标 **【实测】** 的条目另有 P0 基线的实测证据（`test/fixtures/baseline/`，逐条的取证方式见 `test/fixtures/baseline/README.md`）。

### 11.1 正确性

| # | 缺陷 | 位置 | 新设计如何处置 |
|---|---|---|---|
| F1 | 投影常量重复在四处、构成两对独立 JS↔GLSL 副本，靠运气一致 | `projectionType.js` / `Texture.js:14-15` / `fshader.glsl:8-13` | §3.4 单一真源 + 生成 + L1 断言 |
| F2 | `PROJECTION_FISHEYE` 只在被注释掉的分支里赋值 → 死常量 | `Texture.js:57` | 删除；常量表只保留已实现项 |
| F3 | GLSL `tex_proj_fisheye()` 活着返回 `vec2(0,0)`，JS 侧同名分支抛异常 → 两侧矛盾 | `fshader.glsl:121-124` / `Texture.js:60` | 同上，两侧一致 |
| F4 | 深度测试开着、深度缓冲从不清理 → 正确性依赖上一帧深度值 | `utils/gl.js:18-19` / `Renderer.js:144` | §4.6 无深度测试、无深度附件 |
| F5 | **【实测】** **非线性相机 `povLatitude` 无效** —— 死 uniform `u_CamPOVLatitude`，且内部 ortho 相机只读不更新。取证：`test/fixtures/baseline/*/origin.uniforms.json` 中 `u_CamPOVLatitude` **从不出现**（编译器丢弃 → `getUniformLocation` 返回 null → `Renderer.render` 跳过），三个非线性相机的 `u_CamTransMatrix` 四态逐字节相同（位姿只走 `u_CamPOVLongitude`），且 `cam_proj_cylindrical` 的 `phi = atan(y) + HALF_PI` 独立地不读纬度。比「被忽略」更强：纬度**原理上**到不了 GPU | `fshader.glsl:21` | **修，且这是本项目唯一一处刻意的行为变更**：三个非线性公式的 `phi` 加 `- lat`。门禁 A 只比对纬度为零的状态，另立测试钉住新行为；见 §12 |
| F6 | **【实测】** `u_CamGeoWidth` / `u_CamGeoHeight` 是死 uniform，每帧白传（同 F5 的取证：全套 16 条 capture 里都不出现） | `fshader.glsl:17-18` | §4.5 提升为显式投影参数 `extent`，**在 CPU 侧建矩阵时真正被读**；不再进 uniform |
| F7 | `createProgram` 失败 log + `return null` → viewer 构造「成功」但永不渲染 | `utils/gl.js` | §6.3 构造时抛 |
| F8 | 无 `contextlost` 处理 | 全库 | §6.4 |
| F9 | **无 devicePixelRatio 处理 → 高分屏发虚** | `Renderer.adjustSize` | §4.8 |
| F10 | **【实测】** `fshader.glsl:32` 全局非常量初始化（ESSL 1.00/3.00 均非法，ANGLE 容忍）—— 实测**没有被编译成常量零**：`cylindrical/` 的 `origin` 与 `tilt` 两张 PNG 不同，而 `lng` 是 `u_CamPOVLongitude` 的唯一消费者（`theta = z * TWO_PI - lng / 2.0` 及下游两处）。旧版确实会转，§11.4 的 B1 行为因此是可观测的而非纸面的 | `fshader.glsl:32` | 移进函数体 |
| F11 | **【实测】** `povLongitude` setter 用 `long % 25` 作误差累积护栏，与线性相机的 `[0,360)` 回绕不一致 —— 实测 `45 → 20`、`180 → 5`、`300 → 0`，与 `% 25` 逐值吻合 | 三个非线性相机 | 统一为 `[0, 360)` 回绕 |
| F12 | **【实测】** `PanniniCamera` 的 zoom 上界是 `2`，其他相机是 `1`；实测这个夹取还是**单向**的：`CylindricalCamera` / `PlanetCamera` 的 `clamp(value, 0.1, 1)` 把放大整个丢掉（`zoomed` 态 `u_CamZoom` 仍是 1），只有缩小生效。`pannini` 是唯一 `u_CamZoom` 离开 1 的相机，正好构成对照 | `PanniniCamera.js` | **需确认哪个是正确行为**，统一 |

### 11.2 资源泄漏

| # | 缺陷 | 位置 | 新设计如何处置 |
|---|---|---|---|
| L1 | **【实测】** `window.removeEventLstener` 拼错，**两处** → resize 监听永久泄漏。实测比「监听泄漏」更重：`RenderFlow.dispose` 把它当**第一条语句**调用，抛出后 `driver_.dispose()` 永不执行，**rAF 渲染循环也永不停止**——每个构造过的 viewer 永远在画。取证：`tools/baseline/probe.html` 必须按 canvas 身份过滤 `drawArrays`，否则后建的 viewer 会污染先前 capture 的帧记录 | `RenderFlow.dispose` / `Renderer.dispose` | §4.8 `ResizeObserver.disconnect()` |
| L2 | 插件从不释放 —— `ZoomPlugin` / `PanPlugin` 是裸类无 `dispose()` | `Viewer.js:41-42` | §5.3 `AbortController` |
| L3 | 顶点缓冲从不删除 —— `initVertexBuffer` 每次 `createBuffer()`，全库零 `deleteBuffer` | `utils/gl.js` | §4.5 顶点缓冲消失 |
| L4 | `camera_ = null` 但不 `dispose()`；非线性相机内部的 `ortho_` 也从不释放 | `RenderFlow.dispose` | §6.2 显式释放 |
| L5 | `cleanGL()` 直接丢 `gl_`，不走 `WEBGL_lose_context` | `Renderer.cleanGL` | §6.2 |

### 11.3 命名与死代码

| # | 缺陷 | 位置 |
|---|---|---|
| N1 | `CAMERA_WITH`（WIDTH）/ `CAMERA_HEGHT`（HEIGHT）—— **导出的常量名拼错** | `CylindricalCamera.js:15-16` / `PanniniCamera.js:15-16` |
| N2 | `SPHERE_READIUS`（RADIUS） | `LinearProjection.js:30` |
| N3 | `PROJECTION_TYPE_pannini` 命名风格与同组其余三个不一致 | `projectionType.js` |
| N4 | `CylindricalCamera` 与 `PanniniCamera` **都 `export default class PlanetCamera`** | 两个文件 |
| N5 | `Sphere` 死代码留在文件里（报废的实验） | `LinearProjection.js:25-29` |
| N6 | `Camera` / `OrthoCamera` 声明 `@disposable` 却无 `dispose()` | 两个文件 |
| N7 | `konph` / `polygala` 声明为依赖但零引用 | `package.json` |
| N8 | `demo/webpack.config.js` 的 `entry: './index.js'` 与实际文件 `Index.js` 大小写不符，Linux/CI 上失败 | `demo/webpack.config.js` |

### 11.4 刻意保留的旧行为

§11.1 是**修掉的**缺陷。这一节相反：**看出来了、也认为它是错的，但 v1 故意照旧**。留在这里是因为一份不记录保留项的缺陷清单会让人以为漏掉了它。

| # | 行为 | 位置 | v1 的处置 |
|---|---|---|---|
| B1 | 非线性相机的 `lng` 偏移把**角度值当弧度用** | `fshader.glsl`：文件级 `float lng = u_CamPOVLongitude / 2.0`，三个非线性公式各减 `lng / 2.0`，于是从弧度角上减掉的是 `povLongitude / 4` | **照旧**，见下 |

**【核码】** 三层链路的净效果是 `povLongitude / 4`：`CameraState.povLongitude` 是**度**，`theta` 是**弧度**，减掉的是二者的混合量 —— 既不是正确的度转弧度（`* PI / 180`，差约 29 倍），也不是任何一致的量纲。**修正它会直接改变拖拽灵敏度**，那是一个用户可见的行为变更，不是一次内部重构。

**【实测】** 这条链路是活的，所以「照旧」是一个真实的约束而不是纸面推演：`cylindrical/origin` 与 `cylindrical/tilt` 的基线 PNG 不同（F10 的取证），证明 v0.2.2 的非线性相机确实在转，v1 必须转到同一个地方。

**v1 不做这个决定。** 验收标准是「渲染出 v0.2.2 渲染的东西」，照旧是唯一能过门禁 A 的做法。要改就是单独一次有意的变更，需要自己的测试（形状同 §12 的 F5），并且要说明为什么新的灵敏度是对的。P3 的着色器、P6 的 GLSL 与 `src/core/reference.ts` 三处都带这条注释，指向这里。

---

## 12. 待验证事项

**【待验证】** 的全部条目。每一条都必须过 §10.3 的门禁。

| # | 待验证 | 门禁 | 风险 |
|---|---|---|---|
| V1 | 全屏三角形能否服务全部四个投影 | A | 中 —— 失败则退回分族几何，架构不动 |
| V2 | 非线性相机的逆矩阵还原能否精确复现旧坐标范围 | B | 中 —— 失败则需从 uniform 流逐帧定位 |
| V4 | F12（pannini zoom 上界 2 vs 1）哪个是正确行为 | — | 低 —— 需人工判断，非测试可决。**实测已给出事实基础**：`1` 的那一侧不是「上界更保守」而是单向夹取，`CylindricalCamera` / `PlanetCamera` 连放大都做不到（v0.2.2 里就没有那个能力） |
| V5 | 两份着色器的数值路径差异是否在 ±1~2 LSB 内 | C | 中 —— 失败先用 CPU 参考仲裁 |
| V6 | WGSL uniform 布局在非 Apple GPU（Intel/AMD/高通）上是否同样成立 | — | 中 —— **【实测】只测过 Apple M2 与 SwiftShader** |
| V7 | Linux CI（无 GPU runner）上 SwiftShader 路径是否可行 | — | 低 —— **【实测】只验证过 macOS，Linux 上是推断** |

### 12.1 已结案

- **V3（F5 是否属实）—— 属实，已结案。** P0 基线的实测把 F5 钉死，取证见 §11.1 的 F5 行与 `test/fixtures/baseline/README.md`。这一条从待验证清单里移出，作为 §11.1 的**已知**缺陷进入设计。同一批实测顺带把 F6（死 uniform）、F10（初始值生效）、F11（`% 25` 的具体取值）、F12（夹取是单向的）一并从【核码】升到【实测】，F5/F6/F10 三条**均未被证伪**，故 §11 无删行。

  附带一条不在原清单里的观测，供 P2 的 CPU 参考实现对照：**三个非线性相机的 `u_CamTransMatrix` 四态逐字节相同**——它来自构造在 `(0,0)` 且此后不更新的内部 `ortho_` 相机，位姿只经 `u_CamPOVLongitude` 传递。线性相机恰好相反：矩阵逐态变化且完全不收 POV uniform。P2 若按「矩阵携带位姿」实现非线性相机，与基线对不上。

### 探路报告的残余风险（原文引用）

> - 极端片元着色器下 Metal 的误差：只测了一条公式。pannini/planet/cylindrical 含更多三角函数，误差可能更大。**建议实现阶段用同样方法对每种投影各测一次**
> - 非 Apple GPU：未验证
> - Linux CI：未验证，**这是一条推断，不是证据**
> - H.264 实际解码：只测了 `canPlayType` 返回 `probably` 和 VP8 的实际解码，真实 MP4 播放未跑

---

## 13. 附录：探路报告

完整报告：`docs/superpowers/notes/stage-0-feasibility.md`
探针代码：`docs/superpowers/spikes/stage-0/`

核心结论复述：

| 能力 | 结论 |
|---|---|
| 无头跑 WebGL1 / WebGL2 / WebGPU | ✅ 全部可用 |
| 无头默认是否用真 GPU | ✅ **是**（Apple M2 / ANGLE Metal），不是软件渲染 |
| 视频零拷贝 `importExternalTexture` | ✅ 三条来源端到端出图 |
| 真实视频**解码** | ✅ VP8 解码成功；H.264 报告 `probably` |
| 同后端多次运行逐比特可复现 | ✅ |
| 跨后端逐比特一致 | ❌（最大偏差 `5.4e-5`，亚像素） |
| 无 GPU 环境降级（SwiftShader） | ✅ 全部能力可用 |
| Playwright 默认 headless | ⚠️ **静默降级**：WebGL 走 SwiftShader，**WebGPU 不可用** |
| `var<immediate>` | ❌ **排除**（需 `--enable-dawn-features=allow_unsafe_apis`） |

**【实测】** 关键 limits：`maxTextureDimension2D = 16384`、`maxBindGroups = 4`、`maxBufferSize ≈ 4GB`。

**【实测】** Immediates 排除的完整证据：单独 `--enable-features=WGSLImmediateAddressSpace` **无效**，必须 `--enable-dawn-features=allow_unsafe_apis` 才生效 —— **生产环境不能依赖一个要求用户改浏览器启动参数的 WGSL 特性。**

---

## 14. 设计决策速查

| 决策 | 结论 | 章节 |
|---|---|---|
| 语言 | TypeScript，非 Rust+WASM | §1.3.1 |
| 分层 | core / renderer / media / interaction / viewer，依赖单向向下 | §2.1 |
| 深度约定 | 提为 `DepthRange`，后端注入；用 gl-matrix 的 `ZO` 变体 | §3.3 |
| 投影常量 | TS 单一真源 → 生成 WGSL `const` + GLSL `#define` | §3.4 |
| 几何 | 全屏三角形，3 顶点，无缓冲无属性 | §4.5 |
| 深度缓冲 | 删掉（连附件一起） | §4.6 |
| 渲染循环 | 脏检查在 `getCurrentTexture()` **之前** | §4.7 |
| Bind group | 2 个（预算 4） | §4.3 |
| 视频路径 | `importExternalTexture` + 每帧重建 bind group | §4.4 |
| 朝向 | **不用 `flipY`**，统一在着色器 UV 里处理 | §4.4 |
| 着色器 | 两套（WGSL / GLSL ES 3.00），无法共用 | §4.9 |
| 装饰器 | **全删**，零个 | §6.1 |
| mixin | 改**组合** | §5.4 |
| DOM 监听 | `AbortController` | §5.3 |
| 事件 | `EventEmitter<EventMap>`，`on()` 返回取消函数 | §5.5 |
| 构造失败 | **抛**，不 log | §6.3 |
| 设备丢失 | 检测 + 上报 + 干净释放（本期不做自动恢复） | §6.4 |
| 日志 | `debug`（结果走事件，过程走 debug） | §7.3 |
| 矩阵 | `gl-matrix` | §7.2 |
| 依赖数 | **8 → 3** | §7.4 |
| 测试 | 分层 + CPU 参考 + 双后端交叉 | §9 |
| 迁移 | P0 先冻结基线，三道门禁 | §10 |
