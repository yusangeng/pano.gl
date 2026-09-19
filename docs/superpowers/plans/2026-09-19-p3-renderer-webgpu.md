# P3 — renderer + WebGPU Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 一个能画画的 WebGPU 后端。四个投影全部对上 P0 的基线像素（门禁 A）与基线 uniform 流（门禁 B）。

**Architecture:** `renderer/` 定义 `Backend` 接口，`renderer/webgpu/` 实现它。几何是一个 3 顶点的全屏三角形 —— 顶点着色器只吐 NDC，画面里的一切由片元着色器算。投影公式与 CPU 参考实现（`src/core/reference.ts`）逐行同构。

**Tech Stack:** WebGPU / WGSL · gl-matrix · Playwright

---

## 本计划对 spec 的一处细化

spec §4.2 / §4.5 写的是「uniform 里放 `clip` 矩阵 + `geoWidth`/`geoHeight`，片元着色器里做仿射重映射 `(uv - 0.5) * extent`」。**写计划时推演下来，改成放 `invClip` 更好**，理由：

| | 仿射重映射（spec 原文） | **逆矩阵（本计划）** |
|---|---|---|
| 线性相机的朝向从哪来 | 得在着色器里从角度重建 —— 还要复刻 `lookAt` 那个 `-sin(θ)` 的手性 | 矩阵里，**由 CPU 侧的同一个函数产出** |
| 几何路径条数 | 两条（线性走角度重建，非线性走仿射） | **一条** |
| 门禁 A 要验什么 | 「两种路径都没写错」 | 「四个投影的公式都没写错」—— 几何本身只有一条路，结构上不可能分叉 |
| `geoWidth`/`geoHeight` | 着色器里要读 | **着色器里不读**，只在建矩阵时用 → 不再是死 uniform |
| uniform 布局 | 96 B | 96 B（`clip` 换成 `invClip`，`geo*` 换成填充） |

核心推演：legacy 的 `v_Pos` 是**世界坐标**，摄像机朝向是靠投影矩阵决定「立方体的哪一面落在屏幕上」白送的。要在一个全屏三角形上复现这件事，就得反过来 —— **把 NDC 逆映射回那个世界坐标**：

```wgsl
let h = camera.invClip * vec4f(ndc, 1.0, 1.0);
let p = h.xyz / h.w;          // 线性：远平面上的点，方向即视线
                              // 非线性：四边形上的点 (1, y, z)
```

**一个矩阵、一次乘法、一次透视除法，同时服务四个投影。** 而且两个后端的 far 平面都落在 ndc z = +1（GL 的 z∈[-1,1] 与 WebGPU 的 z∈[0,1] 都满足），所以着色器**不需要知道深度约定**。

**这条细化会回写进 spec。** 如果执行者认为不成立，停下上报，不要自行决定用哪版。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/renderer/backend.ts` | `Backend` 接口 + `Capabilities` |
| `src/renderer/capabilities.ts` | 能力探测，不依赖任何具体后端 |
| `src/renderer/uniforms.ts` | uniform 布局的**唯一真源**：字段、偏移、打包函数 |
| `src/renderer/webgpu/device.ts` | 适配器/设备获取、error scope、`device.lost` |
| `src/renderer/webgpu/backend.ts` | `Backend` 的 WebGPU 实现 |
| `src/renderer/webgpu/shaders/panorama.wgsl` | 顶点 + 片元着色器源码 |
| `src/renderer/webgpu/shaders/index.ts` | 把 `WGSL_CONSTANTS` 与源码拼成最终字符串 |
| `test/integration/support/gpu.ts` | 集成测试共用的 GPU 工具 |
| `test/integration/uniform-layout.test.ts` | 布局往返测试 |
| `test/integration/gate-a-pixels.test.ts` | **门禁 A** |
| `test/integration/gate-b-projection.test.ts` | **门禁 B** |

---

### Task 1: Backend 接口与能力探测

**Files:**
- Create: `src/renderer/backend.ts`
- Create: `src/renderer/capabilities.ts`
- Test: `test/unit/capabilities.test.ts`

- [ ] **Step 1: 写接口**

`src/renderer/backend.ts`：

```ts
/**
 * What the viewer needs from a rendering backend.
 *
 * The interface is deliberately state-in / pixels-out: no matrices are passed
 * as matrices, no depth convention is named, no GPU type appears. A backend is
 * a function from "what should be on screen" to "pixels", and everything that
 * differs between WebGL2 and WebGPU stays behind this line.
 */

import type { CameraState, Projection, SourceState } from '../core/types'

/** What this device can actually do, as opposed to what the API spec allows. */
export interface Capabilities {
  readonly backend: 'webgpu' | 'webgl2'
  /** Adapter description, when the backend can supply one. */
  readonly adapter?: Readonly<Record<string, string>>
  /** `maxTextureDimension2D`, the limit that decides whether a source must be downscaled. */
  readonly maxTextureDimension: number
  /** True when the source can be sampled without a copy. Video only, WebGPU only. */
  readonly externalTextures: boolean
}

/**
 * A rendering backend.
 *
 * Lifecycle: construct, then `resize` before the first `render`, then any number
 * of `setCamera`/`setSource`/`render` calls, then `dispose` exactly once.
 * `dispose` is idempotent.
 */
export interface Backend {
  readonly kind: 'webgpu' | 'webgl2'
  readonly capabilities: Capabilities

  /** Sets the camera pose and projection. Takes effect on the next `render`. */
  setCamera (state: CameraState, projection: Projection): void

  /**
   * Sets the source to sample, or `null` to draw nothing.
   *
   * Implementations must not retain the object beyond the next `setSource` or
   * `dispose`: video sources are invalidated at the end of the current
   * microtask and a retained reference is a use-after-free.
   */
  setSource (source: SourceState | null): void

  /** Draws one frame. */
  render (): void

  /**
   * Resizes the drawing surface.
   *
   * @param cssWidth - Layout width in CSS pixels.
   * @param cssHeight - Layout height in CSS pixels.
   * @param dpr - Device pixel ratio. The backing store is `cssWidth * dpr` wide.
   */
  resize (cssWidth: number, cssHeight: number, dpr: number): void

  dispose (): void
}
```

- [ ] **Step 2: 写失败测试**

`test/unit/capabilities.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { describeCapabilities, type ProbeInput } from '../../src/renderer/capabilities'

const base: ProbeInput = {
  hasWebGPU: true,
  hasWebGL2: true,
  adapter: { vendor: 'apple', architecture: 'metal-3' },
  maxTextureDimension: 16384,
  externalTextures: true
}

describe('describeCapabilities', () => {
  it('prefers webgpu when everything is available', () => {
    expect(describeCapabilities(base).backend).toBe('webgpu')
  })

  it('falls back to webgl2 when the page has no navigator.gpu', () => {
    const caps = describeCapabilities({ ...base, hasWebGPU: false })
    expect(caps.backend).toBe('webgl2')
    // The fallback must drop the WebGPU-only capability too, not just the label.
    // A backend label of webgl2 with externalTextures: true would have callers
    // take a code path the backend cannot serve.
    expect(caps.externalTextures).toBe(false)
  })

  it('falls back to webgl2 when an adapter cannot be obtained', () => {
    // navigator.gpu exists but requestAdapter() returned null -- exactly what
    // Playwright's default headless binary does. This is the silent-downgrade
    // case, and it must be visible in the reported capabilities.
    const caps = describeCapabilities({ ...base, adapter: null })
    expect(caps.backend).toBe('webgl2')
    expect(caps.adapter).toBeUndefined()
  })

  it('reports no backend when neither is available', () => {
    const caps = describeCapabilities({ ...base, hasWebGPU: false, hasWebGL2: false })
    expect(caps.backend).toBe('none')
  })

  it('prefers the webgpu adapter description when webgpu wins', () => {
    expect(describeCapabilities(base).adapter).toEqual({ vendor: 'apple', architecture: 'metal-3' })
  })

  it('clamps a nonsensical max texture dimension up to a usable floor', () => {
    // Some software adapters report 0 or a tiny value. Passing that through
    // would make every source look oversized and route everything through the
    // downscale path for no reason.
    expect(describeCapabilities({ ...base, maxTextureDimension: 0 }).maxTextureDimension)
      .toBeGreaterThanOrEqual(2048)
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npm run test:unit -- capabilities`
Expected: FAIL —— 无法解析 `../../src/renderer/capabilities`

- [ ] **Step 4: 实现**

`src/renderer/capabilities.ts`：

```ts
/**
 * Backend selection, as a pure function.
 *
 * Kept free of actual GPU calls so the decision table can be unit tested. The
 * impure part -- asking the browser for an adapter -- lives in the backends.
 *
 * Falling back is a programmable state, not a log line. An application that
 * wants to tell the user "your browser is using the slower renderer" needs to
 * read that from somewhere, and this is that somewhere.
 */

import type { Capabilities } from './backend'

/** Raw probe results, gathered however the caller can. */
export interface ProbeInput {
  readonly hasWebGPU: boolean
  readonly hasWebGL2: boolean
  /** `null` when `navigator.gpu` exists but `requestAdapter()` returned null. */
  readonly adapter: Readonly<Record<string, string>> | null
  readonly maxTextureDimension: number
  readonly externalTextures: boolean
}

export type SelectedCapabilities = Capabilities | { readonly backend: 'none' }

/**
 * The smallest `maxTextureDimension2D` we will believe. A software adapter that
 * reports 0 would otherwise make every source look oversized.
 */
const MIN_TRUSTWORTHY_TEXTURE_DIMENSION = 2048

/**
 * Decides which backend to use and what to report about it.
 *
 * WebGPU wins whenever it is genuinely available. The adapter check is not
 * redundant with the `navigator.gpu` check: Playwright's default headless
 * binary exposes `navigator.gpu` and returns `null` from `requestAdapter()`,
 * so a page can look WebGPU-capable while having no GPU at all.
 */
export function describeCapabilities (input: ProbeInput): SelectedCapabilities {
  if (input.hasWebGPU && input.adapter !== null) {
    return {
      backend: 'webgpu',
      adapter: input.adapter,
      maxTextureDimension: Math.max(MIN_TRUSTWORTHY_TEXTURE_DIMENSION, input.maxTextureDimension),
      externalTextures: input.externalTextures
    }
  }

  if (input.hasWebGL2) {
    return {
      backend: 'webgl2',
      // WebGL2 has no external-texture equivalent, and the capability must say
      // so rather than leaving a WebGPU-only flag set on a WebGL2 backend.
      externalTextures: false,
      // WebGL2's floor is the spec minimum. Using the same field for both
      // backends keeps callers from branching on `backend` to find the limit.
      maxTextureDimension: Math.max(2048, Math.min(16384, input.maxTextureDimension))
    }
  }

  return { backend: 'none' }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run test:unit -- capabilities`
Expected: 6 个测试 PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/backend.ts src/renderer/capabilities.ts test/unit/capabilities.test.ts
git commit -m "feat(renderer): backend interface and a testable capability decision table"
```

---

### Task 2: uniform 布局的唯一真源

**Files:**
- Create: `src/renderer/uniforms.ts`
- Test: `test/unit/uniforms.test.ts`

**背景**：WebGPU **没有 uniform 反射**（没有 `getUniformLocation` 的等价物）。JS 侧写错一个偏移，**不会报错，会静默读到垃圾**。所以布局必须由一份可测的描述驱动。

- [ ] **Step 1: 写失败测试**

`test/unit/uniforms.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { CAMERA_UNIFORM_LAYOUT, CAMERA_UNIFORM_SIZE, packCameraUniforms } from '../../src/renderer/uniforms'
import { mat4 } from 'gl-matrix'

describe('camera uniform layout', () => {
  it('is a multiple of 16 bytes', () => {
    // A uniform buffer binding whose size is not 16-byte aligned is a
    // validation error on some implementations and a silent misread on others.
    expect(CAMERA_UNIFORM_SIZE % 16).toBe(0)
  })

  it('places every field at a 4-byte-aligned offset', () => {
    for (const field of CAMERA_UNIFORM_LAYOUT) {
      expect(field.offset % 4, `${field.name} at ${field.offset}`).toBe(0)
    }
  })

  it('has no overlapping fields', () => {
    const sorted = [...CAMERA_UNIFORM_LAYOUT].sort((a, b) => a.offset - b.offset)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      expect(cur.offset, `${cur.name} overlaps ${prev.name}`).toBeGreaterThanOrEqual(prev.offset + prev.byteLength)
    }
  })

  it('covers the whole buffer with no unexplained gap beyond alignment padding', () => {
    const sorted = [...CAMERA_UNIFORM_LAYOUT].sort((a, b) => a.offset - b.offset)
    let end = 0
    for (const f of sorted) {
      if (f.name.startsWith('_pad')) continue
      // Padding between fields may exist for alignment, but the gap must be
      // small. A large gap means a field was moved and the size was not.
      expect(f.offset - end, `gap before ${f.name}`).toBeLessThanOrEqual(12)
      end = f.offset + f.byteLength
    }
    expect(CAMERA_UNIFORM_SIZE - end).toBeLessThanOrEqual(12)
  })

  it('accounts for every byte the struct needs', () => {
    const expected = 64 /* invClip */ + 4 * 8 /* eight scalars */ 
    expect(CAMERA_UNIFORM_SIZE).toBe(expected)
    expect(CAMERA_UNIFORM_SIZE).toBe(96)
  })
})

describe('packCameraUniforms', () => {
  const invClip = mat4.create()

  it('writes the matrix column-major, matching WGSL mat4x4 indexing', () => {
    // WGSL's `m[col][row]` is gl-matrix's `elements[col * 4 + row]`. Getting
    // this wrong transposes the picture, and there is no error.
    mat4.identity(invClip)
    invClip[12] = 7
    invClip[13] = 8
    invClip[14] = 9

    const buf = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(buf, {
      invClip,
      projKind: 1, texProjKind: 1,
      povLatitude: 0, povLongitude: 0, zoom: 1
    })

    const f32 = new Float32Array(buf)
    // elements[12], [13], [14] are m[3][0], m[3][1], m[3][2] -- the translation
    // column. They must land at float indices 12, 13, 14.
    expect(f32[12]).toBeCloseTo(7, 6)
    expect(f32[13]).toBeCloseTo(8, 6)
    expect(f32[14]).toBeCloseTo(9, 6)
  })

  it('writes the projection kinds as unsigned integers, not floats', () => {
    const buf = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(buf, {
      invClip, projKind: 3, texProjKind: 1,
      povLatitude: 0, povLongitude: 0, zoom: 1
    })
    const u32 = new Uint32Array(buf)
    const projField = CAMERA_UNIFORM_LAYOUT.find(f => f.name === 'projKind')!
    expect(u32[projField.offset / 4]).toBe(3)
  })

  it('writes the scalars at their declared offsets', () => {
    const buf = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(buf, {
      invClip, projKind: 1, texProjKind: 1,
      povLatitude: -12.5, povLongitude: 200, zoom: 2.5
    })
    const f32 = new Float32Array(buf)
    const at = (name: string) =>
      f32[CAMERA_UNIFORM_LAYOUT.find(f => f.name === name)!.offset / 4]!
    expect(at('povLatitude')).toBeCloseTo(-12.5, 5)
    expect(at('povLongitude')).toBeCloseTo(200, 5)
    expect(at('zoom')).toBeCloseTo(2.5, 5)
  })

  it('rejects a buffer of the wrong size', () => {
    // A short buffer would make the writes silently land outside the typed
    // array view and vanish, producing a frame drawn from zeros.
    expect(() =>
      packCameraUniforms(new ArrayBuffer(CAMERA_UNIFORM_SIZE - 4), {
        invClip, projKind: 1, texProjKind: 1,
        povLatitude: 0, povLongitude: 0, zoom: 1
      })
    ).toThrow(/96/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- uniforms`
Expected: FAIL —— 无法解析 `../../src/renderer/uniforms`

- [ ] **Step 3: 实现**

`src/renderer/uniforms.ts`：

```ts
/**
 * The camera uniform block, described once.
 *
 * WebGPU has no uniform reflection -- there is no `getUniformLocation` to ask
 * where a field landed. The JavaScript side must know the offsets, and if it is
 * wrong nothing complains: the shader reads whatever bytes happen to be there.
 *
 * So the layout is data, and `test/integration/uniform-layout.test.ts` does a
 * round trip through the GPU to confirm the data is right. A unit test can only
 * check that the offsets are self-consistent; only the round trip can check
 * that they match WGSL's idea of the struct.
 *
 * Layout rules that matter here (verified on Metal and SwiftShader):
 *   - WGSL's uniform address space allows consecutive 4-byte scalars. It is NOT
 *     std140 -- members do not each get a 16-byte slot. Using std140 rules would
 *     waste 3x the space and, worse, put the scalars at the wrong offsets.
 *   - The whole block must be a multiple of 16 bytes.
 */

import type { mat4 } from 'gl-matrix'

/** One field of the uniform block. */
export interface UniformField {
  readonly name: string
  /** Byte offset from the start of the block. */
  readonly offset: number
  /** Size in bytes. */
  readonly byteLength: number
}

/**
 * The camera uniform block.
 *
 * `invClip` is the inverse of the camera's clip matrix. The vertex shader does
 * not use it -- it emits clip-space coordinates directly from the vertex index.
 * The fragment shader uses it to turn a screen position back into the surface
 * position the projection formulas expect. See the P3 design note.
 */
export const CAMERA_UNIFORM_LAYOUT: readonly UniformField[] = [
  { name: 'invClip', offset: 0, byteLength: 64 },
  { name: 'projKind', offset: 64, byteLength: 4 },
  { name: 'texProjKind', offset: 68, byteLength: 4 },
  { name: 'povLatitude', offset: 72, byteLength: 4 },
  { name: 'povLongitude', offset: 76, byteLength: 4 },
  { name: 'zoom', offset: 80, byteLength: 4 },
  // Alignment padding, not dead uniforms. The legacy struct uploaded
  // u_CamGeoWidth and u_CamGeoHeight every frame and the shader read neither;
  // those are gone. These exist only to round the block up to 16 bytes.
  { name: '_pad0', offset: 84, byteLength: 4 },
  { name: '_pad1', offset: 88, byteLength: 4 },
  { name: '_pad2', offset: 92, byteLength: 4 }
] as const

/** Total block size in bytes. Must be a multiple of 16. */
export const CAMERA_UNIFORM_SIZE = 96

/** The values `packCameraUniforms` writes. */
export interface CameraUniformValues {
  readonly invClip: mat4
  readonly projKind: number
  readonly texProjKind: number
  readonly povLatitude: number
  readonly povLongitude: number
  readonly zoom: number
}

/** Byte offset of a named field. Throws if the name is not in the layout. */
function offsetOf (name: keyof CameraUniformValues | '_pad0'): number {
  const field = CAMERA_UNIFORM_LAYOUT.find(f => f.name === name)
  if (!field) throw new Error(`no uniform field named ${name}`)
  return field.offset
}

/**
 * Packs the camera values into a GPU-ready buffer.
 *
 * The matrix is copied straight through in gl-matrix's column-major order,
 * which is the same order WGSL's `mat4x4<f32>` uses: `m[col][row]` corresponds
 * to `elements[col * 4 + row]`. No transpose.
 *
 * @param target - Buffer to fill. Must be exactly `CAMERA_UNIFORM_SIZE` bytes.
 * @throws If `target` is the wrong size -- a short buffer would make the writes
 *   land outside the typed-array view and silently vanish.
 */
export function packCameraUniforms (target: ArrayBuffer, values: CameraUniformValues): void {
  if (target.byteLength !== CAMERA_UNIFORM_SIZE) {
    throw new RangeError(
      `camera uniform buffer must be ${CAMERA_UNIFORM_SIZE} bytes, got ${target.byteLength}`
    )
  }

  const f32 = new Float32Array(target)
  const u32 = new Uint32Array(target)

  f32.set(values.invClip as unknown as ArrayLike<number>, offsetOf('invClip') / 4)
  u32[offsetOf('projKind') / 4] = values.projKind
  u32[offsetOf('texProjKind') / 4] = values.texProjKind
  f32[offsetOf('povLatitude') / 4] = values.povLatitude
  f32[offsetOf('povLongitude') / 4] = values.povLongitude
  f32[offsetOf('zoom') / 4] = values.zoom

  for (const pad of ['_pad0', '_pad1', '_pad2'] as const) {
    f32[offsetOf(pad) / 4] = 0
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- uniforms`
Expected: 9 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/uniforms.ts test/unit/uniforms.test.ts
git commit -m "feat(renderer): camera uniform block as testable layout data

WebGPU has no uniform reflection, so a wrong offset reads garbage rather
than failing. The layout is data here, checked for self-consistency by
unit tests and round-tripped through the GPU in P3's integration tests."
```

---

### Task 3: WGSL 着色器

**Files:**
- Create: `src/renderer/webgpu/shaders/panorama.wgsl`
- Create: `src/renderer/webgpu/shaders/index.ts`
- Test: `test/unit/shaders.test.ts`

- [ ] **Step 1: 写 WGSL**

`src/renderer/webgpu/shaders/panorama.wgsl`：

```wgsl
// pano.gl panorama shader.
//
// One triangle, no vertex buffer, no vertex attributes. The vertex stage emits
// clip-space coordinates from the vertex index alone; everything else happens
// per fragment.
//
// The legacy renderer rasterised a cube (radius 100) for the linear camera and
// a quad (at x = 1) for the three non-linear ones, then fed the interpolated
// vertex position to the projection formula. That worked, but the surface was
// doing nothing except producing a coordinate -- the linear projection is
// scale-invariant and the shader never called normalize() on anything.
//
// Here the surface is reconstructed by inverting the camera matrix instead:
// given a screen position, `invClip` recovers the point the legacy rasteriser
// would have interpolated. For the linear camera that point is on the far plane
// and only its direction matters. For the non-linear cameras it is the quad
// point (1, y, z), which is exactly what their formulas read.
//
// Both conventions put the far plane at ndc z = +1, so this shader does not
// need to know which backend is running it.

struct Camera {
  invClip: mat4x4<f32>,
  projKind: u32,
  texProjKind: u32,
  povLatitude: f32,
  povLongitude: f32,
  zoom: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

const PI: f32 = 3.141592653589793;
const HALF_PI: f32 = 1.5707963267948966;
const TWO_PI: f32 = 6.283185307179586;

struct VertexOut {
  @builtin(position) clip: vec4f,
  // Passed through rather than derived from @builtin(position) in the fragment
  // stage: the builtin is in framebuffer pixels, which would need the viewport
  // size, which would mean another uniform and a resolution-dependent bug class.
  @location(0) ndc: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOut {
  // A single oversized triangle covering the clip volume. Two triangles would
  // work too; one is fewer vertices and has no shared edge to crack.
  var corners = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0)
  );
  var out: VertexOut;
  out.clip = vec4f(corners[index], 1.0, 1.0);
  out.ndc = corners[index];
  return out;
}

// GLSL's mod, which returns a value with the sign of the divisor. WGSL's `%`
// truncates toward zero instead, so the two disagree for negative operands and
// using `%` would put a seam in the panorama at some longitudes.
fn glsl_mod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// U or V -> equirectangular coordinate in [0, 1].
fn to_uv(theta: f32, phi: f32) -> vec2f {
  return vec2f(glsl_mod(theta / TWO_PI + 0.5, 1.0), clamp(phi / PI, 0.0, 1.0));
}

// The linear (perspective) projection. Scale-invariant: every term is a ratio,
// so the magnitude of `p` carries no information. This is why the cube could be
// replaced by a triangle.
fn project_linear(p: vec3f) -> vec2f {
  let theta = atan2(p.z, p.x);
  let phi = atan(p.y / sqrt(p.x * p.x + p.z * p.z)) + HALF_PI;
  return to_uv(theta, phi);
}

// The three non-linear projections below read the MAGNITUDE of their inputs, so
// the size of the surface being projected is part of the projection. In the
// legacy code that size lived in quad vertex coordinates; it now lives in the
// camera matrix, and `invClip` delivers the right point without the shader
// needing to know the extent.

fn project_cylindrical(p: vec3f, zoom: f32, lng: f32) -> vec2f {
  // p.x is intentionally unread: on the legacy quad it was pinned at 1.
  let theta = p.z * zoom * TWO_PI - lng * 0.5;
  let phi = atan(p.y * zoom) + HALF_PI;
  return to_uv(theta, phi);
}

fn project_planet(p: vec3f, zoom: f32, lng: f32) -> vec2f {
  let z = p.z * zoom;
  let y = p.y * zoom;
  let m = 1.0 + z * z + y * y;
  let q = 2.0 * z / m;
  let r = 2.0 * y / m;
  let s = (m - 2.0) / m;
  let theta = glsl_mod(atan2(q, r), TWO_PI) - lng * 0.5;
  let phi = atan(s / sqrt(q * q + r * r)) + HALF_PI;
  return to_uv(theta, phi);
}

fn project_pannini(p: vec3f, zoom: f32, lng: f32) -> vec2f {
  let theta = 2.0 * atan2(p.z * 0.5 * zoom, p.x) - lng * 0.5;
  let phi = atan(p.y * zoom / sqrt(p.x * p.x + p.z * p.z)) + HALF_PI;
  return to_uv(theta, phi);
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  // Recover the surface point the legacy rasteriser would have interpolated.
  // z = 1.0 is the far plane, which both depth conventions agree on.
  let homogeneous = camera.invClip * vec4f(in.ndc, 1.0, 1.0);
  let p = homogeneous.xyz / homogeneous.w;

  let lng = camera.povLongitude * PI / 180.0;
  var uv: vec2f;
  switch camera.projKind {
    case 1u: { uv = project_linear(p); }
    case 2u: { uv = project_cylindrical(p, camera.zoom, lng); }
    case 3u: { uv = project_planet(p, camera.zoom, lng); }
    case 4u: { uv = project_pannini(p, camera.zoom, lng); }
    default: { uv = vec2f(0.0, 0.0); }
  }

  // The source's own projection. Only equirectangular exists today; a second
  // kind goes here, and the value is already uploaded so no CPU change is
  // needed to add one.
  if camera.texProjKind != 1u {
    uv = vec2f(0.0, 0.0);
  }

  return textureSample(tex, samp, uv);
}
```

> **`povLatitude` 在这个版本里没有参与运算。** 这不是遗漏 —— 旧实现的非线性相机同样完全忽略纬度（缺陷 F5）。**Task 6 会处理它**，那里会把它变成一个显式的行为变更并用测试钉住。**不要在这一步"顺手修掉"**，那会让门禁 B 的基线比对失败，且分不清是哪个变更导致的。

> **`switch` 的 `default` 分支返回 `vec2f(0, 0)`**：WGSL 要求 `switch` 穷尽。这是唯一允许的"静默降级"位置，因为 `projKind` 只可能来自 `CameraProjection` 常量。

- [ ] **Step 2: 写拼接模块**

`src/renderer/webgpu/shaders/index.ts`：

```ts
/**
 * Assembles the final WGSL source.
 *
 * The projection kind constants are generated from `src/core/projection-kinds.json`
 * and prepended here rather than written into the shader file, so the numbers in
 * the shader and the numbers in TypeScript cannot drift. In the legacy code they
 * were two independent hand-maintained copies.
 *
 * WGSL has no preprocessor, which is why the generated form is `const`
 * declarations rather than `#define`.
 */

import { WGSL_CONSTANTS } from './generated'
import panoramaSource from './panorama.wgsl?raw'

export const PANORAMA_WGSL = `${WGSL_CONSTANTS}\n${panoramaSource}`
```

> **`?raw` 是 Vite 的语法。** 它在 vitest 和 demo 里可用，但 **tsup 不认**。让 tsup 也认它的办法是在 `tsup.config.ts` 里加 esbuild 的 raw loader：
>
> ```ts
> esbuildOptions (options) {
>   options.loader = { ...options.loader, '.wgsl': 'text' }
> }
> ```
> 并把 import 改成 `import panoramaSource from './panorama.wgsl'`。
>
> **两条路径都要验证**：`npm run test:unit`（vitest）与 `npm run build`（tsup）。**如果哪一边不认，说出来，不要改成把着色器内联进 TS** —— 那会牺牲着色器文件的语法高亮，而这是长期维护里最值钱的东西。

- [ ] **Step 3: 加一条着色器可编译性测试**

着色器编译只能在浏览器里验，但**源码级的不变量**可以在单元测试里查：

`test/unit/shaders.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { PANORAMA_WGSL } from '../../src/renderer/webgpu/shaders'
import { CAMERA_UNIFORM_LAYOUT, CAMERA_UNIFORM_SIZE } from '../../src/renderer/uniforms'

describe('panorama WGSL', () => {
  it('declares every field of the uniform layout, in the same order', () => {
    // Writes into the struct are positional, so a field that exists in the TS
    // layout but not in the shader shifts everything after it. Nothing reports
    // this: the shader just reads the wrong bytes.
    const structBody = PANORAMA_WGSL.match(/struct Camera \{([\s\S]*?)\}/)?.[1]
    expect(structBody, 'no Camera struct in the shader').toBeDefined()

    const declared = structBody!
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('//'))
      .map(l => l.split(':')[0]!.trim())

    const expected = CAMERA_UNIFORM_LAYOUT.map(f => f.name)
    expect(declared).toEqual(expected)
  })

  it('declares the struct fields with byte sizes that sum to the block size', () => {
    const structBody = PANORAMA_WGSL.match(/struct Camera \{([\s\S]*?)\}/)![1]
    const sizes: Record<string, number> = { 'mat4x4<f32>': 64, 'u32': 4, 'f32': 4, 'i32': 4 }
    let total = 0
    for (const line of structBody.split('\n')) {
      const m = line.match(/^\s*(\w+)\s*:\s*([\w<>]+)\s*,/)
      if (!m) continue
      const size = sizes[m[2]!]
      expect(size, `unknown WGSL type ${m[2]}`).toBeDefined()
      total += size!
    }
    expect(total).toBe(CAMERA_UNIFORM_SIZE)
  })

  it('does not use the modulo operator, which GLSL and WGSL define differently', () => {
    // `glsl_mod` exists precisely to avoid `%`. A stray `%` reintroduces the
    // negative-operand disagreement between the two shader sources.
    const body = PANORAMA_WGSL.replace(/\/\/[^\n]*/g, '')
    expect(body).not.toMatch(/[^/%]\s*%\s*[^%]/)
  })

  it('has no preprocessor directives', () => {
    // WGSL has no preprocessor. A `#define` that slipped in from a GLSL-ism
    // would be a parse error, but it is worth failing the unit test rather than
    // waiting for a browser.
    expect(PANORAMA_WGSL).not.toMatch(/^\s*#/m)
  })
})
```

- [ ] **Step 4: 跑测试**

Run: `npm run test:unit -- shaders && npm run build`
Expected: 单元测试 PASS，且 tsup 构建成功（证明 `.wgsl` loader 配好了）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/webgpu/shaders/ test/unit/shaders.test.ts tsup.config.ts
git commit -m "feat(renderer): WGSL panorama shader over a single fullscreen triangle

The vertex stage emits clip space from the vertex index alone. The fragment
stage recovers the surface point by inverting the camera matrix, which is
what lets one code path serve all four projections -- the legacy renderer
needed a cube for the linear camera and a quad for the other three."
```

---

### Task 4: WebGPU 设备与资源生命周期

**Files:**
- Create: `src/renderer/webgpu/device.ts`
- Test: `test/unit/device-scopes.test.ts`

- [ ] **Step 1: 写失败测试**

`test/unit/device-scopes.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { withValidationScope } from '../../src/renderer/webgpu/device'

/** Minimal stand-in for a GPUDevice's error-scope pair. */
function fakeDevice (result: GPUError | null) {
  return {
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn().mockResolvedValue(result)
  } as unknown as GPUDevice
}

describe('withValidationScope', () => {
  it('returns the callback result when no validation error occurs', async () => {
    const device = fakeDevice(null)
    const result = await withValidationScope(device, 'pipeline', () => 42)
    expect(result).toBe(42)
    expect(device.pushErrorScope).toHaveBeenCalledWith('validation')
  })

  it('throws when the scope reports an error', async () => {
    // The whole point. WebGPU validation errors are asynchronous and do not
    // throw: createRenderPipeline returns an invalid pipeline and rendering
    // silently produces nothing. Without this wrapper the library reproduces
    // the legacy renderer's "constructed successfully, draws nothing forever"
    // failure with a different API.
    const device = fakeDevice({ message: 'shader compilation failed' } as GPUError)
    await expect(
      withValidationScope(device, 'pipeline creation', () => 42)
    ).rejects.toThrow(/pipeline creation.*shader compilation failed/s)
  })

  it('names the operation in the error so the failure is locatable', async () => {
    const device = fakeDevice({ message: 'boom' } as GPUError)
    await expect(withValidationScope(device, 'texture upload', () => 1))
      .rejects.toThrow(/texture upload/)
  })

  it('pops the scope even when the callback throws', async () => {
    // A scope left on the stack shifts every later scope's result by one, so
    // the next unrelated operation reports someone else's error.
    const device = fakeDevice(null)
    await expect(
      withValidationScope(device, 'x', () => { throw new Error('callback blew up') })
    ).rejects.toThrow('callback blew up')
    expect(device.popErrorScope).toHaveBeenCalledTimes(1)
  })

  it('supports async callbacks', async () => {
    const device = fakeDevice(null)
    const result = await withValidationScope(device, 'upload', async () => 'done')
    expect(result).toBe('done')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- device-scopes`
Expected: FAIL —— 无法解析 `../../src/renderer/webgpu/device`

- [ ] **Step 3: 实现**

`src/renderer/webgpu/device.ts`：

```ts
/**
 * Adapter and device acquisition, and the error handling WebGPU requires.
 *
 * Two things here have no WebGL1 analogue and are easy to get wrong:
 *
 * 1. Validation errors are asynchronous and do not throw. `createRenderPipeline`
 *    returns an invalid pipeline rather than raising, and drawing with it
 *    produces no pixels and no error. Every resource-creating call must be
 *    wrapped in a scope, or failures become invisible.
 *
 * 2. `device.lost` is a promise that resolves when the GPU process dies, the
 *    driver resets, or the tab is suspended. Unhandled, the canvas goes black
 *    permanently with no explanation.
 */

import { channels } from '../../diagnostics'

/** A device together with the promises it must be watched with. */
export interface AcquiredDevice {
  readonly adapter: GPUAdapter
  readonly device: GPUDevice
  /** Resolves with the reason string when the device is lost. */
  readonly lost: Promise<{ reason: string, message: string }>
}

/**
 * Runs `fn` inside a WebGPU validation error scope and throws if the scope
 * reports an error.
 *
 * @param device - The device to scope.
 * @param operation - Human-readable name for what is being attempted. Appears
 *   in the thrown error so the failing step is identifiable from a CI log.
 * @throws If the scope captures a validation error, or if `fn` itself throws.
 */
export async function withValidationScope<T> (
  device: GPUDevice,
  operation: string,
  fn: () => T | Promise<T>
): Promise<T> {
  device.pushErrorScope('validation')
  try {
    const result = await fn()
    const error = await device.popErrorScope()
    if (error) {
      throw new Error(`WebGPU validation error during ${operation}: ${error.message}`)
    }
    return result
  } catch (e) {
    // The scope must come off the stack even when the callback threw.
    // A leaked scope shifts every later pop by one, so the next unrelated
    // operation reports this one's error -- or, worse, reports nothing.
    await device.popErrorScope().catch(() => null)
    throw e
  }
}

/**
 * Requests an adapter and device.
 *
 * @returns `null` when the page has no WebGPU, or when the browser exposes the
 *   API but has no adapter to give -- which is exactly what Playwright's
 *   default headless binary does. Callers must treat `null` as "use WebGL2",
 *   not as an error.
 */
export async function acquireDevice (): Promise<AcquiredDevice | null> {
  if (!('gpu' in navigator) || !navigator.gpu) return null

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) {
    channels.gpu('requestAdapter() returned null; falling back to WebGL2')
    return null
  }

  const device = await adapter.requestDevice()

  // Attach the handler before anything can be created, so an immediate loss is
  // not missed. WebGPU intentionally does not auto-recover: without this the
  // page simply stops updating.
  const lost = device.lost.then(info => {
    channels.gpu('device lost: %s (%s)', info.reason, info.message)
    return { reason: info.reason, message: info.message }
  })

  channels.gpu('device acquired: %o', adapter.info)
  return { adapter, device, lost }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- device-scopes`
Expected: 5 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/webgpu/device.ts test/unit/device-scopes.test.ts
git commit -m "feat(renderer): WebGPU device acquisition with error scopes

WebGPU validation errors are asynchronous and never throw, so an invalid
pipeline renders nothing with no error anywhere -- the legacy 'constructed
fine, draws nothing' failure with a different API."
```

---

### Task 5: WebGPU 后端实现

**Files:**
- Create: `src/renderer/webgpu/backend.ts`
- Create: `test/integration/support/gpu.ts`
- Test: `test/integration/backend-smoke.test.ts`

- [ ] **Step 1: 写集成测试工具**

`test/integration/support/gpu.ts`：

```ts
/*
 * Helpers for rendering into an offscreen target and reading it back.
 *
 * Offscreen rather than the canvas because reading back from a canvas requires
 * a configured swapchain and a presented frame, which introduces timing the
 * tests do not need. Everything under test is a function from uniforms to
 * pixels; a texture target exercises exactly that.
 */

import type { Page } from '@playwright/test'

/** What one offscreen render produced. */
export interface RenderResult {
  readonly width: number
  readonly height: number
  /** RGBA8, top-down, row-major. */
  readonly rgba: number[]
}

/**
 * Runs a render inside the page and returns the pixels.
 *
 * `body` is evaluated in the browser with the packed camera uniforms and source
 * pixels available. It must return an object with a `rgba` array.
 */
export async function renderOffscreen (
  page: Page,
  input: {
    width: number
    height: number
    uniforms: number[]
    sourcePixels: number[]
    sourceSize: number
  }
): Promise<RenderResult> {
  return page.evaluate(async (i) => {
    const { createOffscreenRenderer } = (window as unknown as {
      __panoTest: { createOffscreenRenderer: (o: unknown) => Promise<(u: number[], p: number[], s: number) => Promise<number[]>> }
    }).__panoTest
    const render = await createOffscreenRenderer({ width: i.width, height: i.height })
    const rgba = await render(i.uniforms, i.sourcePixels, i.sourceSize)
    return { width: i.width, height: i.height, rgba }
  }, input)
}

/** Largest per-channel difference between two RGBA8 buffers. */
export function maxChannelDiff (a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`size mismatch: ${a.length} vs ${b.length}`)
  }
  let worst = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i]! - b[i]!)
    if (d > worst) worst = d
  }
  return worst
}
```

- [ ] **Step 2: 写后端实现**

`src/renderer/webgpu/backend.ts` —— 骨架与关键决策，完整实现由执行者补齐：

```ts
/**
 * The WebGPU backend.
 *
 * Structure worth knowing before editing:
 *
 * - The pipeline does not depend on the camera or the source, only on whether
 *   the source is an external texture. Two pipelines exist for that reason and
 *   both share the same shader module.
 * - A render pass is opened only after `getCurrentTexture()`, and the early-out
 *   for an unchanged frame happens before that call. Acquiring the swapchain
 *   texture and not submitting is a validation error.
 * - External textures die at the end of the microtask in which they are
 *   imported, and a bind group holding one does not keep it alive. The video
 *   path therefore rebuilds its bind group every frame.
 */

import { mat4 } from 'gl-matrix'
import { CameraProjection } from '../../core/constants'
import type { CameraState, Projection, SourceState } from '../../core/types'
import type { Backend, Capabilities } from '../backend'
import { CAMERA_UNIFORM_SIZE, packCameraUniforms } from '../uniforms'
import { acquireDevice, withValidationScope, type AcquiredDevice } from './device'
import { PANORAMA_WGSL } from './shaders'
import { channels } from '../../diagnostics'

/** RGBA8, the one format both backends can render to and read from. */
const TARGET_FORMAT: GPUTextureFormat = 'rgba8unorm'

export class WebGPUBackend implements Backend {
  readonly kind = 'webgpu' as const

  #canvas: HTMLCanvasElement
  #acquired: AcquiredDevice
  #capabilities: Capabilities
  #cameraBuffer: GPUBuffer
  #cameraValues: Float32Array
  #invClip: mat4 = mat4.create()
  #pipeline: GPURenderPipeline
  #layout: GPUBindGroupLayout
  #cameraBindGroup: GPUBindGroup
  #context: GPUCanvasContext
  #source: SourceState | null = null
  #disposed = false

  private constructor (init: {
    canvas: HTMLCanvasElement
    acquired: AcquiredDevice
    capabilities: Capabilities
    cameraBuffer: GPUBuffer
    cameraBindGroup: GPUBindGroup
    pipeline: GPURenderPipeline
    layout: GPUBindGroupLayout
    context: GPUCanvasContext
  }) {
    this.#canvas = init.canvas
    this.#acquired = init.acquired
    this.#capabilities = init.capabilities
    this.#cameraBuffer = init.cameraBuffer
    this.#cameraValues = new Float32Array(CAMERA_UNIFORM_SIZE / 4)
    this.#cameraBindGroup = init.cameraBindGroup
    this.#pipeline = init.pipeline
    this.#layout = init.layout
    this.#context = init.context

    void this.#acquired.lost.then(lost => {
      channels.gpu('device lost: %o', lost)
      this.#onDeviceLost?.(lost)
    })
  }

  #onDeviceLost: ((lost: { reason: string, message: string }) => void) | undefined

  /** Registers the device-loss callback. Only one consumer is supported. */
  onDeviceLost (fn: (lost: { reason: string, message: string }) => void): void {
    this.#onDeviceLost = fn
  }

  /**
   * Creates a backend, or returns `null` when the page has no usable WebGPU.
   *
   * Every resource-creating call is scoped. WGSL compile errors in particular
   * are only visible through `getCompilationInfo()`, and a pipeline built from
   * a broken shader is invalid rather than throwing.
   */
  static async create (canvas: HTMLCanvasElement): Promise<WebGPUBackend | null> {
    const acquired = await acquireDevice()
    if (!acquired) return null
    const { adapter, device } = acquired

    const limits = adapter.limits
    const capabilities: Capabilities = {
      backend: 'webgpu',
      adapter: adapter.info as unknown as Record<string, string>,
      maxTextureDimension: limits.maxTextureDimension2D,
      externalTextures: true
    }

    const module = device.createShaderModule({ code: PANORAMA_WGSL })

    // Compilation errors never throw. Ask explicitly.
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter(m => m.type === 'error')
    if (errors.length > 0) {
      const detail = errors
        .map(m => `${m.lineNum}:${m.linePos} ${m.message}`)
        .join('\n')
      throw new Error(`WGSL compilation failed:\n${detail}`)
    }

    const cameraBuffer = await withValidationScope(device, 'camera uniform buffer', () =>
      device.createBuffer({
        size: CAMERA_UNIFORM_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        label: 'camera'
      })
    )
    // ... bind group layouts, pipelines, canvas context configuration.
    // See the comments at the top of the file for the constraints each part
    // must respect; the round-trip test in Task 6 is what proves the result.
    // (implementation continues)
    throw new Error('unimplemented: complete from the structure above')
  }

  setCamera (state: CameraState, projection: Projection): void {
    // ... build the clip matrix, invert it, pack it.
    throw new Error('unimplemented')
  }

  setSource (source: SourceState | null): void {
    this.#source = source
  }

  render (): void {
    // ... early-out, acquire, encode, submit.
    throw new Error('unimplemented')
  }

  resize (cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    if (this.#canvas.width === width && this.#canvas.height === height) return
    this.#canvas.width = width
    this.#canvas.height = height
    // The swapchain is reconfigured from the canvas size on the next acquire,
    // so no explicit reconfiguration is needed here -- but the canvas drawing
    // buffer is resized by this assignment, which is what the next frame sees.
  }

  dispose (): void {
    if (this.#disposed) return
    this.#disposed = true
    // Only destroy what this backend owns. The device is shared with anything
    // else the page created; destroying it here would take their work down too.
    this.#cameraBuffer.destroy()
    this.#acquired.device.destroy()
  }
}
```

> **`create()` 与 `setCamera` / `render` 的完整实现留给执行者**，但**约束已经写死在注释和测试里**：
> - 管线不依赖相机，只依赖「源是不是外部贴图」→ 两条管线，共用同一个 shader module
> - 早退必须在 `getCurrentTexture()` **之前**
> - 视频路径每帧重建 bind group
> - `dispose` **不销毁 device**（页面可能还有别的使用者）—— 但如果后端是 device 的唯一持有者，销毁它是唯一能释放显存的办法。**这一条按「后端独占 device」处理**：`create()` 每调一次就建一个新 device，所以销毁是对的。
>
> 不要为了让骨架跑起来而跳过 error scope。**先跑通 Task 6 的布局往返测试，再写四个投影的接线。**

- [ ] **Step 3: 写冒烟测试**

`test/integration/backend-smoke.test.ts`：

```ts
import { test, expect } from './support/fixtures'

test('a WebGPU backend can be created and dispose cleanly', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { WebGPUBackend } = (window as unknown as {
      __panoTest: { WebGPUBackend: { create (c: HTMLCanvasElement): Promise<unknown> } }
    }).__panoTest
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    document.body.appendChild(canvas)
    const backend = await WebGPUBackend.create(canvas)
    if (!backend) return { created: false }
    ;(backend as { dispose(): void }).dispose()
    ;(backend as { dispose(): void }).dispose()  // idempotent
    return { created: true }
  })
  expect(result.created).toBe(true)
})

test('device loss is observable', async ({ gpuPage }) => {
  // The spec's failure mode: WebGPU does not auto-recover, so a lost device
  // that nothing listens for means a permanently black canvas and no message.
  const fired = await gpuPage.evaluate(async () => {
    const { acquireDevice } = (window as unknown as {
      __panoTest: { acquireDevice: () => Promise<{ device: GPUDevice } | null> }
    }).__panoTest
    const acquired = await acquireDevice()
    if (!acquired) return 'no device'
    const lost = acquired.device.lost.then(() => 'lost')
    acquired.device.destroy()
    return Promise.race([lost, new Promise(r => setTimeout(() => r('timeout'), 5000))])
  })
  expect(fired).toBe('lost')
})
```

> 测试页需要一个 `window.__panoTest` 出口。加 `demo/test-entry.ts` 并让 Vite 在测试模式下加载它 —— 具体做法由执行者定，**但不要为了测试把内部符号挂到生产入口 `src/index.ts` 上**。

- [ ] **Step 4: 跑集成测试**

Run: `npm run test:integration -- backend-smoke`
Expected: 2 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/webgpu/backend.ts test/integration/support/gpu.ts test/integration/backend-smoke.test.ts demo/
git commit -m "feat(renderer): WebGPU backend skeleton with device lifecycle and loss reporting"
```

---

### Task 6: uniform 布局往返验证

**Files:**
- Test: `test/integration/uniform-layout.test.ts`

**这是本计划里最容易被跳过、也最不能跳过的一步。** 单元测试只能证明 TS 侧的偏移自洽；**只有往 GPU 里写一遍再读回来，才能证明这些偏移与 WGSL 对 struct 的理解一致**。

- [ ] **Step 1: 写测试**

```ts
import { test, expect } from './support/fixtures'
import { renderOffscreen } from './support/gpu'

/*
 * Writes a sentinel into every field of the camera uniform block, reads the
 * values back from WGSL, and compares.
 *
 * Why this cannot be a unit test: the layout constants are the JavaScript
 * side's opinion of where the fields are. WGSL has its own opinion. Nothing
 * checks that the two agree -- there is no reflection API. A mismatch reads
 * whatever bytes are adjacent, which produces a picture that is wrong in a way
 * that looks like a projection bug.
 *
 * This test is also the guard on the std140 assumption. It was verified on
 * Metal and SwiftShader that WGSL's uniform address space packs consecutive
 * 4-byte scalars without per-member 16-byte slots; if a future browser changes
 * that, this test is where it shows up.
 */
test('every uniform field round-trips through WGSL at its declared offset', async ({ gpuPage }) => {
  // Sentinels chosen so a one-field shift produces a visibly wrong value rather
  // than a plausible one.
  const values = {
    projKind: 1234567,
    texProjKind: 7654321,
    povLatitude: -12.5,
    povLongitude: 234.75,
    zoom: 3.5
  }

  const echoed = await gpuPage.evaluate(async v => {
    const { createEchoRenderer } = (window as unknown as {
      __panoTest: { createEchoRenderer: () => Promise<(v: unknown) => Promise<unknown>> }
    }).__panoTest
    const echo = await createEchoRenderer()
    return echo(v)
  }, values)

  expect(echoed).toEqual(values)
})

test('the inverse clip matrix round-trips without transposition', async ({ gpuPage }) => {
  // gl-matrix is column-major and WGSL's mat4x4 is m[col][row]; they line up,
  // but "they line up" is exactly the kind of claim that deserves a test.
  const echoed = await gpuPage.evaluate(async () => {
    const { createEchoRenderer } = (window as unknown as {
      __panoTest: { createEchoRenderer: () => Promise<(v: unknown) => Promise<unknown>> }
    }).__panoTest
    const echo = await createEchoRenderer()
    return echo({ matrixProbe: true })
  })

  expect(echoed).toEqual({ matrixProbe: true })
})
```

> `createEchoRenderer` 是一个只做「读 uniform → 写成颜色输出」的最小着色器，**与产品着色器分开**。用它而不是产品着色器，是因为布局验证不该被投影公式的 bug 污染。**把它写在 `test/integration/support/echo.wgsl.ts` 里，不要放进 `src/`。**

- [ ] **Step 2: 跑测试**

Run: `npm run test:integration -- uniform-layout`
Expected: 2 个测试 PASS

**如果失败** —— 大概率是 std140 假设或转置。按顺序排查：
1. 打印 WGSL 侧的原始字节（把 struct 逐字段以 `u32` 输出）
2. 若每个字段都被推到了 16 字节槽上 → 该实现不接受紧凑标量布局，**上报卡点**，因为这会影响所有 backend 的布局设计
3. 若只有矩阵转置 → 检查 `f32.set` 的偏移

- [ ] **Step 3: Commit**

```bash
git add test/integration/uniform-layout.test.ts test/integration/support/echo.wgsl.ts
git commit -m "test(renderer): round-trip every uniform field through WGSL

Unit tests only prove the JavaScript offsets are self-consistent. There is
no reflection API to check them against WGSL, so the only way to know the
two agree is to write sentinels and read them back."
```

---

### Task 7: 门禁 A —— 像素对拍

**Files:**
- Test: `test/integration/gate-a-pixels.test.ts`

**门禁 A 的问题**：全屏三角形替掉立方体与四边形之后，四个投影是否都还画得对？

- [ ] **Step 1: 写测试**

```ts
import { test, expect } from './support/fixtures'
import { renderOffscreen, maxChannelDiff } from './support/gpu'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

/*
 * Gate A: does one fullscreen triangle serve all four projections?
 *
 * Compares against the PNGs P0 captured from v0.2.2. The baseline is regenerated
 * only by tools/baseline/capture.mjs, so a failure here means the new renderer
 * disagrees with the shipped one -- not that the baseline drifted.
 *
 * Tolerance is ±2 LSB per channel. Measured cross-backend deviation is about
 * 5e-5 in float terms, well under one 8-bit step; the headroom covers the
 * difference between v0.2.2's shader and this one, which is not the same code.
 */

const fixtureRoot = path.resolve(__dirname, '../fixtures/baseline')

/** The states where the legacy non-linear cameras and this implementation agree
 *  by construction. See gate B for the latitude caveat. */
const STATES = ['origin', 'tilt', 'south', 'zoomed'] as const
const CAMERAS = ['perspective', 'cylindrical', 'planet', 'pannini'] as const

test.describe('gate A: fullscreen triangle vs the v0.2.2 baseline', () => {
  for (const camera of CAMERAS) {
    for (const state of STATES) {
      test(`${camera} / ${state}`, async ({ gpuPage }) => {
        const png = PNG.sync.read(readFileSync(path.join(fixtureRoot, camera, `${state}.png`)))
        const expected = Array.from(png.data)

        const result = await renderOffscreen(gpuPage, {
          width: png.width,
          height: png.height,
          uniforms: [], // filled by the page from the fixture's camera state
          sourcePixels: [],
          sourceSize: png.width
        })

        expect(maxChannelDiff(result.rgba, expected)).toBeLessThanOrEqual(2)
      })
    }
  }
})
```

> **上面的 `uniforms: []` 是待补的接线，不是可以留着的占位。** 执行者要把 fixture 里的相机状态与 `buildCameraTransform` 的结果喂进去。**接线没接完之前不要让这个测试通过** —— 一个跑在空 uniform 上却"通过"的门禁，比没有门禁更糟。

- [ ] **Step 2: 跑门禁 A**

Run: `npm run test:integration -- gate-a`
Expected: 16 条全 PASS

**失败分流：**

| 现象 | 先查 |
|---|---|
| 全黑或全白 | `invClip` 没填、或 bind group 没绑 |
| 上下颠倒 | `to_uv` 的 v 方向，或 `invClip` 的 y 符号 |
| 左右镜像 | `lookAt` 的 `-sin(θ)` 手性 |
| 只差几个投影 | 那一个的公式转写错了 —— 拿 `src/core/reference.ts` 逐项对 |
| 只有 perspective 差 | 远平面取点不对（线性是唯一对距离不敏感的路径） |

**如果四条路径里只有非线性失败** —— 那是门禁 B 的问题，先跑 Task 8，别在这里纠缠。

- [ ] **Step 3: Commit**

```bash
git add test/integration/gate-a-pixels.test.ts package.json package-lock.json
git commit -m "test(renderer): gate A -- all four projections match the v0.2.2 baseline pixels"
```

---

### Task 8: 门禁 B —— 非线性投影与纬度

**Files:**
- Test: `test/integration/gate-b-projection.test.ts`
- Modify: `src/renderer/webgpu/shaders/panorama.wgsl`
- Modify: `src/core/reference.ts`

门禁 B 有两个部分：**已定义行为的精确复现**，以及**一处显式的行为变更**。

- [ ] **Step 1: 写已定义行为的测试**

```ts
import { test, expect } from './support/fixtures'

/*
 * Gate B, part 1: does the inverse-matrix surface reconstruction reproduce the
 * legacy quad's coordinate range exactly?
 *
 * The legacy non-linear cameras rasterised a quad at x = 1 spanning y and z,
 * sized 1x1 for cylindrical and 4x4 for planet and pannini, and fed the
 * interpolated position straight into the projection formula. The new renderer
 * gets the same point from `invClip`. If the matrix encodes the wrong extent,
 * the picture scales -- which looks almost right, and is the failure mode this
 * gate exists to catch.
 *
 * The assertion is on the recovered surface point, not on pixels: pixels would
 * confound an extent error with a formula error.
 */
test.describe('gate B: surface reconstruction', () => {
  const CASES = [
    { camera: 'cylindrical', extent: [1, 1] as const },
    { camera: 'planet', extent: [4, 4] as const },
    { camera: 'pannini', extent: [4, 4] as const }
  ]

  for (const { camera, extent } of CASES) {
    test(`${camera} recovers a surface spanning ${extent[0]} x ${extent[1]} at x = 1`, async ({ gpuPage }) => {
      const probes = await gpuPage.evaluate(
        ([c, e]) => {
          const t = (window as unknown as { __panoTest: any }).__panoTest
          return t.probeSurface(c, e)
        },
        [camera, extent] as const
      )

      // Corners of the recovered surface must sit on the extent box.
      expect(Math.abs(probes.maxY)).toBeCloseTo(extent[1] / 2, 3)
      expect(Math.abs(probes.maxZ)).toBeCloseTo(extent[0] / 2, 3)
      // x is pinned: on the legacy quad it was the constant 1.
      expect(probes.minX).toBeCloseTo(1, 3)
      expect(probes.maxX).toBeCloseTo(1, 3)
    })
  }
})
```

- [ ] **Step 2: 跑并修正 extent 的接线**

Run: `npm run test:integration -- gate-b`
Expected: 3 条 PASS

**失败时**：`extent` 到矩阵的映射在 `src/core/matrix.ts` 里。检查非线性分支构造的那个矩阵 —— 它把 `(1, y, z)` 映射到 NDC，其中 `ndcX = z / (W/2)`、`ndcY = y / (H/2)`、`ndcZ = 1`、`w = 1`。逆矩阵必须还原它。

- [ ] **Step 3: 处理纬度（缺陷 F5）**

**这一步是一次刻意的行为变更**，不是修 bug 那么简单 —— 先读清楚背景：

旧实现的非线性相机**完全忽略纬度**。三条独立证据：`u_CamPOVLatitude` 声明了但全着色器零次读取；三个公式里只有 `lng`；内部那个 `ortho_` 相机被构造后就只读不写，且构造时传的是 `povLatitude: 0`。

**新实现让它生效。** 在三个非线性公式里加一项：

```wgsl
fn project_cylindrical(p: vec3f, zoom: f32, lng: f32, lat: f32) -> vec2f {
  let theta = p.z * zoom * TWO_PI - lng * 0.5;
  let phi = atan(p.y * zoom) + HALF_PI - lat;
  return to_uv(theta, phi);
}
```

同样地 `project_planet` 和 `project_pannini` 的 `phi` 也要 `- lat`。`fs_main` 里传 `camera.povLatitude * PI / 180.0`。

**`src/core/reference.ts` 必须同步改** —— 它是着色器的可执行规格，两侧不同步就等于没有参考实现。

- [ ] **Step 4: 写行为变更的测试**

```ts
/*
 * The one place the new renderer intentionally disagrees with v0.2.2.
 *
 * The legacy non-linear cameras ignored povLatitude entirely: the shader
 * declared u_CamPOVLatitude and never read it, and the inner ortho camera that
 * supplied the matrix was constructed with latitude 0 and never updated. The
 * baseline fixtures for those cameras therefore have identical pixels at every
 * latitude, which is why gate A only compares states where this change is a
 * no-op.
 *
 * This test pins the new behaviour so the fix cannot silently regress.
 */
test.describe('latitude now affects the non-linear cameras', () => {
  for (const camera of ['cylindrical', 'planet', 'pannini'] as const) {
    test(`${camera} responds to povLatitude`, async ({ gpuPage }) => {
      const diff = await gpuPage.evaluate(async c => {
        const t = (window as unknown as { __panoTest: any }).__panoTest
        const a = await t.renderWith({ camera: c, povLatitude: 0 })
        const b = await t.renderWith({ camera: c, povLatitude: 45 })
        return t.maxDiff(a, b)
      }, camera)
      expect(diff).toBeGreaterThan(2)
    })
  }

  test('and the baseline confirms it used to be ignored', async () => {
    // Reads the P0 fixtures rather than re-deriving from source, so this is a
    // record of observed behaviour, not of intent.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const root = path.resolve(__dirname, '../fixtures/baseline')
    const read = (s: string) =>
      JSON.parse(readFileSync(path.join(root, 'cylindrical', `${s}.uniforms.json`), 'utf8'))
    const pick = (doc: any) => {
      const u = doc.frames.at(-1).find((x: any) => x.name === 'u_CamPOVLatitude')
      return u?.value
    }
    expect(pick(read('origin'))).toBe(pick(read('tilt')))
  })
})
```

- [ ] **Step 5: 跑全部**

Run: `npm run test:integration`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/webgpu/shaders/panorama.wgsl src/core/reference.ts test/integration/gate-b-projection.test.ts
git commit -m "test(renderer): gate B -- surface extent, plus povLatitude for the non-linear cameras

The legacy non-linear cameras ignored latitude completely: the uniform was
declared and never read, and the inner ortho camera that supplied the
matrix was built with latitude 0 and never updated. This is a deliberate
behaviour change, so gate A only compares states where it is a no-op, and
a dedicated test pins the new behaviour."
```

---

## 完成标准

- [ ] `npm run test:integration -- gate-a` 16 条全绿
- [ ] `npm run test:integration -- gate-b` 全绿
- [ ] `npm run test:integration -- uniform-layout` 全绿
- [ ] `npm run test:unit` 全绿，覆盖率门槛通过
- [ ] 后端创建失败**抛异常**，不返回半死的对象（用一条集成测试证明）
- [ ] `device.lost` 能被观测到
- [ ] `swapchain` 的早退发生在 `getCurrentTexture()` 之前

## 不上榜的部分

以下属于 P3，但**不在本计划的批次里**：golden image 与跨后端交叉验证（属于 P6，因为跨后端要有第二个后端才有意义）。本阶段的金标准是 P0 的基线。

## 交给下游的东西

| 产物 | 消费者 |
|---|---|
| `Backend` 接口 | P4 的 media 层、P6 的 WebGL2 后端 |
| `PANORAMA_WGSL` 的四个公式 | P6 的 `panorama.glsl` —— 逐行对照转写 |
| ~~`CAMERA_UNIFORM_LAYOUT`~~ | **不给 P6** —— WebGL2 走具名 uniform，不共享布局。见 P6 的说明 |
| `src/core/reference.ts` | P6 门禁 C 的裁判 |
