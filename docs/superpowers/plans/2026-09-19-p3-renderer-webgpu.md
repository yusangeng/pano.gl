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
| `src/renderer/shaders/generated.ts` | **P2 产出**，两个后端共用的投影常量 |
| `src/renderer/webgpu/shaders/panorama.wgsl` | 顶点 + 两个片元入口 |
| `src/renderer/webgpu/shaders/index.ts` | 把 `WGSL_CONSTANTS` 与源码拼成最终字符串 |
| `src/renderer/webgpu/shaders/sampler.ts` | 采样器（过滤模式是像素对齐的一部分） |
| `test/integration/support/gpu.ts` | 集成测试共用的 GPU 工具 |
| `test/integration/uniform-layout.test.ts` | 布局往返测试 |
| `test/integration/gate-a-pixels.test.ts` | **门禁 A** |
| `test/integration/gate-b-projection.test.ts` | **门禁 B** |
| `index.html`（仓库根） | **集成测试的落地页**：`page.goto('/')` 打开的就是它，只有它加载 `demo/test-entry.ts` |
| `demo/test-entry.ts` | `window.__panoTest` 出口，只在测试构建里加载 |
| `demo/test-entry-hooks/renderer.ts` | 本期的 hook：`renderOffscreen` / `WebGPUBackend` / `acquireDevice` |
| `demo/test-entry-hooks/echo.ts` | 本期第二个 hook：uniform 布局探针 |

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

/**
 * A source as a backend sees it.
 *
 * `SourceState` alone is not enough to draw one: it describes the upload -- how
 * the pixels are laid out and how big they are -- and says nothing about where
 * they come from. A backend needs both, so this pairs them. `state` is
 * `SourceState` from `core/types` rather than a re-declared shape, because
 * `core` is the layer both backends already agree on.
 *
 * **This is the definition and `MediaFrame` is an alias to it**, not the other
 * way round. `src/media/source.ts` (P4) writes `export type MediaFrame =
 * RenderableSource`, so there is exactly one declaration of these four members
 * and no conversion anywhere in the path from a loaded `<img>` to a bind group.
 * The renderer layer cannot import from the media layer -- the dependency runs
 * the other way -- so the declaration has to live here, on the consuming side.
 */
export interface RenderableSource {
  /** The upload description: layout and size. */
  readonly state: SourceState
  readonly kind: 'image' | 'video'
  /** Where the pixels come from. Never retained past the current task. */
  readonly element: HTMLImageElement | HTMLVideoElement
  /**
   * Bumped whenever the underlying pixels change.
   *
   * This is how "does the GPU texture need re-uploading" gets answered without
   * the backend subscribing to media events. An image bumps it once, on load; a
   * video bumps it on every frame it presents. It replaces the legacy
   * `needUpdate_` latch, which the *consumer* had to clear -- and "who clears
   * it" is where that kind of flag goes wrong.
   */
  readonly version: number
}

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
   * Called once per frame by the render loop, not once per source: a video's
   * pixels change every frame and the only value that says so is `version`.
   *
   * Implementations must not retain `source.element` beyond the current task --
   * a video frame is invalidated when the task that produced it ends, and a
   * retained reference is a use-after-free rather than a stale frame. Retaining
   * the rest of the object is fine.
   */
  setSource (source: RenderableSource | null): void

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

  /**
   * Registers a device-loss observer and returns an unsubscribe function.
   *
   * Without this the backend has no channel to report that it died, and the
   * viewer's `device-lost` event can never fire -- a lost device would show up
   * as a canvas that silently stops updating, which is exactly the v0.2.2
   * behaviour the design set out to fix (it handled neither WebGL context loss
   * nor anything else).
   *
   * Registering twice replaces the previous observer; the returned function
   * unregisters only if this call is still the current one, so calling a stale
   * unsubscribe after a re-register is a no-op rather than a surprise removal.
   */
  onDeviceLost (fn: (lost: DeviceLost) => void): () => void

  dispose (): void
}

/**
 * Why a device went away.
 *
 * `reason` is the API's own token -- WebGPU's `GPUDeviceLostReason` string
 * (`'destroyed'`, `'unknown'`) or WebGL2's `'context-lost'`, which WebGL does
 * not otherwise name. `message` is whatever detail the backend could extract;
 * WebGL2 has none, so it supplies a fixed explanatory string rather than an
 * empty one, so that a consumer logging it always gets something actionable.
 *
 * This is also the payload of the viewer's public `device-lost` event, so the
 * internal and external shapes cannot drift.
 */
export interface DeviceLost {
  readonly reason: string
  readonly message: string
}
```

> **接口上的 `onDeviceLost` 是刚补的。** 原设计（spec §4.1）没有它，但 spec §7 又要求
> 「`device.lost` → 发 `device-lost` 事件」—— 中间没有通道，这条要求无法实现。spec 已一并修正。
> `Capabilities` 与 spec §2.3 的 `static probe(): Promise<Capabilities>` 是同一个类型，
> 定义在这里、由 `capabilities.ts` 产出。

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
 *
 * Exported because `WebGPUBackend` assembles its own `Capabilities` from the
 * adapter it acquired and has to apply the same floor. The rule is stated here
 * and must not be re-derived there.
 */
export const MIN_TRUSTWORTHY_TEXTURE_DIMENSION = 2048

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
- Create: `src/renderer/webgpu/shaders/sampler.ts`
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

// group(1) is the source. The two bindings are alternatives, not a pair:
// `fs_main` reads `samp` + `tex`, `fs_main_external` reads `ext`. Each pipeline
// layout declares only the ones its entry point uses -- see the note under the
// fragment stage.
@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var ext: texture_external;

const PI: f32 = 3.141592653589793;
const HALF_PI: f32 = 1.5707963267948966;
const TWO_PI: f32 = 6.283185307179586;

// `CAMERA_PROJECTION_LINEAR/_CYLINDRICAL/_PLANET/_PANNINI` and
// `TEXTURE_PROJECTION_EQUIRECTANGULAR` are prepended above this file by
// `shaders/index.ts`, generated from `src/core/projection-kinds.json`. They are
// the only place these numbers appear -- there is no numeric literal for a
// projection kind anywhere below.

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

// Equirectangular coordinate from an angle pair.
//
// This differs from `toUV` in src/core/reference.ts in exactly two ways, and
// both are deliberate:
//
//   1. `fract` is applied to u. The legacy shader did no wrapping at all -- it
//      handed `texture2D` a raw ratio and the texture object's default REPEAT
//      wrap did the work. Wrapping is done explicitly here instead, because the
//      external-texture entry point below has no wrap-capable sampler
//      (`textureSampleBaseClampToEdge` clamps). Doing it in the shader means
//      both source paths wrap identically.
//
//      `fract` and not `%`: WGSL's `%` truncates toward zero while `fract` is
//      `x - floor(x)`, matching GLSL's `mod`. `%` would put a seam in the
//      panorama wherever theta is negative.
//
//   2. v is flipped. The legacy upload set `UNPACK_FLIP_Y_WEBGL`, so its
//      sampler read a vertically mirrored image compared with the source file.
//      Neither WebGPU source path can express that -- `importExternalTexture`
//      has no flip option at all, and using `copyExternalImageToTexture` with
//      `flipY` for stills would give the two paths opposite orientations, which
//      shows up as "the video is upside down but the photo is not". So one flip
//      lives here, for both paths, exactly as spec §4.4 decided.
//
// There is still NO `+ 0.5`. The legacy shader has none, and adding one rotates
// the panorama 180 degrees.
fn to_uv(theta: f32, phi: f32) -> vec2f {
  return vec2f(fract(theta / TWO_PI), 1.0 - phi / PI);
}

/*
 * The four projections are transcribed statement for statement from
 * cam_proj_* in `legacy/src/shader/fshader.glsl`, and line for line against
 * `src/core/reference.ts`. Two things that look like transcription errors and
 * are not:
 *
 *   - `atan(a / b)` plus explicit quadrant fixups is deliberately NOT
 *     simplified to `atan2`. The two agree for `linear` and `cylindrical` but
 *     not for `pannini`, whose fixups run AFTER theta has been doubled, so
 *     `2 * atan(b/a)` and `atan2` then `* 2` land in different quadrants.
 *   - Nothing wraps `theta`. Wrapping is the sampler's job.
 *
 * Keep all four in the same shape as the reference so the two can be read side
 * by side.
 */

// The linear (perspective) projection. Scale-invariant: every term is a ratio,
// so the magnitude of `s` carries no information. This is why the cube could be
// replaced by a triangle.
fn project_linear(s: vec3f) -> vec2f {
  var theta = atan(s.z / s.x);

  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  let phi = atan(s.y / sqrt(s.x * s.x + s.z * s.z)) + HALF_PI;
  return to_uv(theta, phi);
}

/*
 * The three non-linear projections below read the MAGNITUDE of their inputs, so
 * the size of the surface being projected is part of the projection. In the
 * legacy code that size lived in quad vertex coordinates; it now lives in the
 * camera matrix, and `invClip` delivers the right point without the shader
 * needing to know the extent.
 */

fn project_cylindrical(s: vec3f, zoom: f32, lng: f32) -> vec2f {
  // `s.x` is deliberately unread, exactly as in the legacy shader, where the
  // quad pinned it at 1. See `project_pannini` for the one projection that
  // does read it.
  let y = s.y * zoom;
  let z = s.z * zoom;

  let theta = z * TWO_PI - lng;
  let phi = atan(y) + HALF_PI;
  return to_uv(theta, phi);
}

fn project_planet(s: vec3f, zoom: f32, lng: f32) -> vec2f {
  let y = s.y * zoom;
  // The negation is in the legacy shader and is easy to drop. Without it the
  // planet projection renders mirrored and inside out.
  let z = -(s.z * zoom);

  let m = 1.0 + z * z + y * y;

  let p = (2.0 * z) / m;
  let q = (2.0 * y) / m;
  let r = (m - 2.0) / m;

  var theta = atan(p / q);

  if (q < 0.0) {
    theta = PI + theta;
  } else if (q > 0.0 && p < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  let phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;
  return to_uv(theta, phi);
}

fn project_pannini(s: vec3f, zoom: f32, lng: f32) -> vec2f {
  let y = s.y * zoom;
  let z = s.z * zoom;

  // `z * 0.5 / s.x`, not `z * 0.5 * s.x`. This is the only term in any of the
  // four projections that reads the magnitude of x rather than its ratio, and
  // it is why the reconstruction has to recover x = 1 exactly instead of some
  // far-plane distance. See `buildProjection` in src/core/matrix.ts.
  var theta = 2.0 * atan((z * 0.5) / s.x);

  // These fixups test x and z AFTER theta has been doubled -- see the block
  // comment above.
  if (s.x < 0.0) {
    theta = PI + theta;
  } else if (s.x > 0.0 && s.z < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  let phi = atan(y / sqrt(s.x * s.x + z * z)) + HALF_PI;
  return to_uv(theta, phi);
}

// Where in the source this pixel reads from. Shared by both fragment entry
// points: everything above this point is a function from a screen position to a
// texture coordinate, and nothing about it depends on how the source is bound.
fn panorama_uv(ndc: vec2f) -> vec2f {
  // Recover the surface point the legacy rasteriser would have interpolated.
  //
  // The 1.0 in the z slot: both depth conventions put the far plane at ndc
  // z = +1, and the camera matrix is built so that inverting it there lands on
  // the legacy surface -- the far plane for the linear camera, whose direction
  // is all that matters, and exactly (1, y, z) for the other three, because
  // their ortho projection is built with far = 1.
  let homogeneous = camera.invClip * vec4f(ndc, 1.0, 1.0);
  let surface = homogeneous.xyz / homogeneous.w;

  // `CameraState.povLongitude` is in degrees. The legacy shader declared
  // `float lng = u_CamPOVLongitude / 2.0` and each non-linear projection then
  // subtracted `lng / 2.0`, so what actually came off a radian angle was
  // `povLongitude / 4` -- degrees subtracted from radians. That is a bug in
  // v0.2.2, reproduced here on purpose: the acceptance criterion is "renders
  // what v0.2.2 rendered", and correcting it changes panning sensitivity, which
  // is a separate user-visible decision that v1 does not make. Recorded as a
  // deliberate retention in spec §11.4 (B1), which is where the three copies of
  // this note point. See `lngOffset` in src/core/reference.ts for the full
  // consequence.
  let lng = camera.povLongitude / 4.0;

  // `povLatitude` is read by nothing here. That is not an omission: the legacy
  // non-linear cameras ignored latitude too (defect F5), and reproducing that is
  // this phase's acceptance criterion. Task 8 Step 3 of this plan makes it a
  // deliberate, separately-tested behaviour change -- not a later phase's job.
  // It stays in the struct because removing
  // it would move every uniform offset after it, and that layout belongs to P2.
  var uv: vec2f;
  switch camera.projKind {
    case CAMERA_PROJECTION_LINEAR: { uv = project_linear(surface); }
    case CAMERA_PROJECTION_CYLINDRICAL: { uv = project_cylindrical(surface, camera.zoom, lng); }
    case CAMERA_PROJECTION_PLANET: { uv = project_planet(surface, camera.zoom, lng); }
    case CAMERA_PROJECTION_PANNINI: { uv = project_pannini(surface, camera.zoom, lng); }
    // WGSL requires a `switch` to be exhaustive. This is the one place a silent
    // fallback is allowed, because `projKind` can only come from the generated
    // constants above.
    default: { uv = vec2f(0.0, 0.0); }
  }

  // The source's own projection. Only equirectangular exists today; a second
  // kind goes here, and the value is already uploaded so no CPU change is
  // needed to add one.
  if camera.texProjKind != TEXTURE_PROJECTION_EQUIRECTANGULAR {
    uv = vec2f(0.0, 0.0);
  }

  return uv;
}

// Entry point for a still source, bound as `texture_2d<f32>` after one
// `copyExternalImageToTexture`.
@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return textureSample(tex, samp, panorama_uv(in.ndc));
}

// Entry point for a video source, bound as `texture_external` -- zero copy, and
// a new import every frame.
//
// Two entry points rather than one because `texture_external` is a different
// WGSL type with a different sampling surface: there is no `textureSample`
// overload for it and no sampler, so the only way to read it is
// `textureSampleBaseClampToEdge`. A pipeline picks its entry point, so the
// backend builds one pipeline per source kind from this one module, and a
// texture_2d source never pays for the external path.
@fragment
fn fs_main_external(in: VertexOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(ext, panorama_uv(in.ndc));
}
```

> **`povLatitude` 在 `Camera` 结构里，但这个版本不读它。** 不是遗漏 —— 旧实现的非线性相机同样完全忽略纬度（缺陷 F5）。**Task 6 会处理它**，那里会把它变成一个显式的行为变更并用测试钉住。**不要在这一步"顺手修掉"**，那会让门禁 B 的基线比对失败，且分不清是哪个变更导致的。它现在留在结构体里，是因为删掉它会改动 uniform 偏移，而那属于 P2 的布局决定，不该由这里改。
>
> **`case` 选择器用的是生成的 `const`，不是字面量。** WGSL 规定 `case` 选择器必须是常量表达式，模块级 `const` 满足这一点；但 naga 早期版本对非字面量的选择器有过限制，所以 **Step 5 要在真实浏览器里跑一次编译**（集成测试本来就会做）。**如果 naga 拒绝**，把 `switch` 换成 `if`/`else if` 链 —— 那同样合法而且同样只用常量。**不要退回数字字面量**：那正是这套生成机制要消灭的东西（旧代码里同一个数字手工维护了两份，靠运气保持一致）。
>
> **`ext` 的声明在下面 Step 2 的绑定里**，和 `tex` 同属 `group(1)` 但编号不同 —— 两条管线各自只认其中一个，所以另一条的 bind group 不需要为它提供资源。这是「一个模块、两条管线」成立的关键：**管线布局是按入口点校验的，模块里没被该入口点用到的绑定不参与校验。**

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

// '../../shaders/generated' -- the generated module is shared with the WebGL2
// backend that P6 adds, so it sits at src/renderer/shaders/, not inside this
// directory.
import { WGSL_CONSTANTS } from '../../shaders/generated'
import panoramaSource from './panorama.wgsl?raw'

export const PANORAMA_WGSL = `${WGSL_CONSTANTS}\n${panoramaSource}`
```

- [ ] **Step 3: 写采样器描述符**

着色器不自己 wrap，wrap 由采样器做（见上面 `to_uv` 的注释），所以采样器不是随手一写的东西 —— 它必须和旧版的纹理对象一致：

`src/renderer/webgpu/shaders/sampler.ts`：

```ts
/**
 * The sampler the panorama shader samples through -- still sources only.
 *
 * The filtering is the part that matters for pixel parity: `linear`, and no
 * mipmaps, because that is what the legacy texture object asked for
 * (`gl.LINEAR` min and mag, and `generateMipmap` never called).
 *
 * The address modes are `clamp-to-edge` and that is NOT a behaviour choice --
 * the shader wraps u itself with `fract` (see `to_uv`), and v never leaves
 * [0, 1] for any of the four projections, so nothing ever samples outside the
 * texture. Declaring `repeat` here would suggest the sampler is doing work it
 * is not, and would leave a reader thinking they can stop wrapping in the
 * shader, which the external-texture path cannot do.
 *
 * A function rather than a module-level constant because a GPUSampler belongs
 * to a device, and a module-level one would outlive the device that created it.
 */
export function createPanoramaSampler (device: GPUDevice): GPUSampler {
  return device.createSampler({
    label: 'panorama',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
  })
}
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

- [ ] **Step 4: 加一条着色器可编译性测试**

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

  it('does not use the modulo operator', () => {
    // The shader wraps u with `fract`, which is `x - floor(x)` and matches
    // GLSL's `mod`. WGSL's `%` truncates toward zero instead, so a `%` here
    // would put a seam in the panorama wherever theta is negative -- and it
    // would be a silent divergence from src/core/reference.ts, which uses the
    // floor-based form.
    const body = PANORAMA_WGSL.replace(/\/\/[^\n]*/g, '')
    expect(body).not.toMatch(/[^/%]\s*%\s*[^%]/)
  })

  it('has no preprocessor directives', () => {
    // WGSL has no preprocessor. A `#define` that slipped in from a GLSL-ism
    // would be a parse error, but it is worth failing the unit test rather than
    // waiting for a browser.
    expect(PANORAMA_WGSL).not.toMatch(/^\s*#/m)
  })

  it('declares both fragment entry points and both source bindings', () => {
    // Both are needed: `texture_external` has no `textureSample` overload, so a
    // single entry point cannot serve both source kinds. Losing either one
    // means one source kind silently falls back to the other's pipeline.
    expect(PANORAMA_WGSL).toContain('fn fs_main(')
    expect(PANORAMA_WGSL).toContain('fn fs_main_external(')
    expect(PANORAMA_WGSL).toContain('var tex: texture_2d<f32>')
    expect(PANORAMA_WGSL).toContain('var ext: texture_external')
    expect(PANORAMA_WGSL).toContain('textureSampleBaseClampToEdge')
  })

  it('dispatches on the generated constants rather than numeric literals', () => {
    // This is the assertion that makes the generated-constants arrangement
    // worth anything: if the switch went back to `case 1u:`, the numbers would
    // be hand-maintained in two places again, which is exactly the defect the
    // legacy code had.
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_LINEAR:')
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_CYLINDRICAL:')
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_PLANET:')
    expect(PANORAMA_WGSL).toContain('case CAMERA_PROJECTION_PANNINI:')
    expect(PANORAMA_WGSL).toContain('TEXTURE_PROJECTION_EQUIRECTANGULAR')
    expect(PANORAMA_WGSL).not.toMatch(/case \d+u:/)
  })

  it('does not shift u by half a turn', () => {
    // A `+ 0.5` in `to_uv` rotates the panorama 180 degrees, and it is the
    // single most plausible "cleanup" a reader would make: the legacy shader
    // looks wrong without it, and src/core/reference.ts documents at length why
    // it is not there. This test exists because the mistake is invisible in a
    // unit test and looks like a plausible camera bug in a screenshot.
    const toUv = PANORAMA_WGSL.match(/fn to_uv\([\s\S]*?\n\}/)?.[0]
    expect(toUv, 'no to_uv in the shader').toBeDefined()
    expect(toUv).not.toMatch(/0\.5/)
  })

  it('flips v, absorbing the legacy UNPACK_FLIP_Y_WEBGL upload', () => {
    // The legacy upload flipped the image; WebGPU cannot (no flipY on
    // importExternalTexture), so the flip lives in the shader. Spec §4.4:
    // one convention for both source paths. If this flip is dropped, stills
    // and video both come out upside down -- and gate A's failure table has a
    // row for exactly that symptom.
    const toUv = PANORAMA_WGSL.match(/fn to_uv\([\s\S]*?\n\}/)![0]
    expect(toUv).toContain('1.0 - phi / PI')
  })

  it('subtracts povLongitude / 4, the legacy units bug, and not a degree conversion', () => {
    // v0.2.2 subtracted a degree value from a radian angle. Reproducing that is
    // the acceptance criterion for this phase; "fixing" it here would change
    // panning sensitivity, which v1 deliberately does not do (spec §11.4 B1).
    expect(PANORAMA_WGSL).toContain('camera.povLongitude / 4.0')
    expect(PANORAMA_WGSL).not.toMatch(/povLongitude \* PI \/ 180/)
  })
})
```

- [ ] **Step 5: 跑测试**

Run: `npm run test:unit -- shaders && npm run build`
Expected: 单元测试 PASS，且 tsup 构建成功（证明 `.wgsl` loader 配好了）

- [ ] **Step 6: Commit**

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
 * Offscreen rather than the canvas because reading a canvas back means
 * `copyTextureToBuffer` on the swapchain texture, which is only valid inside the
 * frame that acquired it -- a timing constraint that would make tests flaky for
 * reasons unrelated to what they test. Everything under test is a function from
 * camera plus source to pixels; a texture this helper owns exercises exactly
 * that.
 *
 * The request carries plain data, not packed uniforms, and the page side calls
 * the real `setCamera`/`setSource`/`render`. A helper that handed the shader a
 * pre-built `invClip` would skip the matrix builder, and the matrix builder is
 * half of what these tests exist to check.
 */

import type { Page } from '@playwright/test'
// Type-only, so nothing from `demo/` ends up in the test bundle. The direction
// is deliberate: the page-side implementation owns the wire shape, and a test
// helper that declared its own copy of it would be a second source of truth for
// a contract that has exactly one implementer.
import type { RenderRequest, RenderResult } from '../../../demo/test-entry-hooks/renderer'

/** Runs a render inside the page and returns the pixels. */
export async function renderOffscreen (
  page: Page,
  request: RenderRequest
): Promise<RenderResult> {
  return page.evaluate(async (r) => window.__panoTest.renderOffscreen(r), request)
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

> `window.__panoTest` 的类型来自 `demo/test-entry.ts` 的全局声明（Step 3）。**不要在这里写 `as unknown as` 再手抄一遍签名** —— 抄一遍就是第二真源，而 `PanoTestApi` 存在的全部意义就是让「页面提供了什么」和「测试拿了什么」由同一个声明约束。

- [ ] **Step 2: 写后端实现**

`src/renderer/webgpu/backend.ts` —— 骨架与关键决策，完整实现由执行者补齐：

```ts
/**
 * The WebGPU backend.
 *
 * Structure worth knowing before editing:
 *
 * - The pipeline does not depend on the camera or on which source is bound, only
 *   on the source's KIND. Two pipelines exist for that reason and both come from
 *   the same shader module, one per fragment entry point (see panorama.wgsl).
 * - A render pass is opened only after `getCurrentTexture()`, and the early-out
 *   for an unchanged frame happens before that call. Acquiring the swapchain
 *   texture and not submitting is a validation error.
 * - External textures die at the end of the microtask in which they are
 *   imported, and a bind group holding one does not keep it alive. So the import,
 *   the bind group, the encoder and the submit all happen inside one synchronous
 *   stretch of `render()` -- never split across a `setSource` and a later frame.
 */

import { mat4 } from 'gl-matrix'
import { cameraProjectionCode, textureProjectionCode } from '../../core/constants'
import { buildCameraTransform } from '../../core/matrix'
import type { CameraState, Projection } from '../../core/types'
import type { Backend, Capabilities, DeviceLost, RenderableSource } from '../backend'
import { CAMERA_UNIFORM_SIZE, packCameraUniforms } from '../uniforms'
import { MIN_TRUSTWORTHY_TEXTURE_DIMENSION } from '../capabilities'
import { acquireDevice, withValidationScope, type AcquiredDevice } from './device'
import { PANORAMA_WGSL } from './shaders'
import { createPanoramaSampler } from './shaders/sampler'
import { channels } from '../../diagnostics'

/** RGBA8, the one format both backends can render to and read from. */
const TARGET_FORMAT: GPUTextureFormat = 'rgba8unorm'

export class WebGPUBackend implements Backend {
  readonly kind = 'webgpu' as const

  #canvas: HTMLCanvasElement
  #acquired: AcquiredDevice
  /**
   * Public, not `#private`: this satisfies `Backend.capabilities`, and the
   * viewer reads it to decide whether a source needs downscaling before it ever
   * calls `setSource`. A private field would fail `implements Backend` at
   * typecheck -- which is the point of declaring the interface in the first
   * place.
   */
  readonly capabilities: Capabilities
  #cameraBuffer: GPUBuffer
  #cameraValues: Float32Array
  /** The clip matrix as last uploaded, for detecting an unchanged camera. */
  #clip: mat4 = mat4.create()
  #invClip: mat4 = mat4.create()
  #sampler: GPUSampler
  #cameraLayout: GPUBindGroupLayout
  #sourceLayout: GPUBindGroupLayout
  #externalSourceLayout: GPUBindGroupLayout
  #cameraBindGroup: GPUBindGroup
  #texturePipeline: GPURenderPipeline
  #externalPipeline: GPURenderPipeline
  #context: GPUCanvasContext

  /** Last camera arguments, kept so a source swap can repack the uniforms. */
  #state: CameraState | null = null
  #projection: Projection | null = null

  /** The source as last passed to `setSource`. Metadata only, never the element. */
  #source: RenderableSource | null = null
  /** The version already uploaded to `#sourceTexture`, `-1` for "none yet". */
  #uploadedVersion = -1
  #sourceTexture: GPUTexture | null = null
  /** Rebuilt whenever `#sourceTexture` is reallocated, which invalidates it. */
  #sourceBindGroup: GPUBindGroup | null = null

  /**
   * Whether the next `render()` has anything to do.
   *
   * The render loop calls `setCamera` and `setSource` every frame, so a backend
   * that drew unconditionally would present 60 identical frames a second and
   * burn the battery. This is the replacement for the legacy `dirty` flag on
   * `Camera.status()`, moved to the one place that knows about both inputs.
   *
   * Starts true so the first frame is never skipped.
   */
  #dirty = true

  #disposed = false

  private constructor (init: {
    canvas: HTMLCanvasElement
    acquired: AcquiredDevice
    capabilities: Capabilities
    cameraBuffer: GPUBuffer
    sampler: GPUSampler
    cameraLayout: GPUBindGroupLayout
    sourceLayout: GPUBindGroupLayout
    externalSourceLayout: GPUBindGroupLayout
    cameraBindGroup: GPUBindGroup
    texturePipeline: GPURenderPipeline
    externalPipeline: GPURenderPipeline
    context: GPUCanvasContext
  }) {
    this.#canvas = init.canvas
    this.#acquired = init.acquired
    this.capabilities = init.capabilities
    this.#cameraBuffer = init.cameraBuffer
    this.#cameraValues = new Float32Array(CAMERA_UNIFORM_SIZE / 4)
    this.#sampler = init.sampler
    this.#cameraLayout = init.cameraLayout
    this.#sourceLayout = init.sourceLayout
    this.#externalSourceLayout = init.externalSourceLayout
    this.#cameraBindGroup = init.cameraBindGroup
    this.#texturePipeline = init.texturePipeline
    this.#externalPipeline = init.externalPipeline
    this.#context = init.context

    void this.#acquired.lost.then(lost => {
      channels.gpu('device lost: %o', lost)
      this.#deviceLostObserver?.(lost)
    })
  }

  #deviceLostObserver: ((lost: DeviceLost) => void) | undefined

  /**
   * The device this backend draws on.
   *
   * Exposed because a render target must belong to the same device as the
   * pipeline that renders into it, and a backend that keeps its device private
   * leaves no way for anyone to render offscreen. `create()` acquires a fresh
   * device per backend, so knowing this one buys no access to anything else on
   * the page. A renderer publishing its device is ordinary -- it is the same
   * relationship three.js has between `WebGPURenderer` and `renderer.backend`.
   */
  get device (): GPUDevice {
    return this.#acquired.device
  }

  /**
   * Registers the device-loss observer.
   *
   * The subscription is created inside this method rather than in the
   * constructor, so that the returned unsubscribe function can be a precise
   * one: it clears the observer only if it is still the one this call installed.
   */
  onDeviceLost (fn: (lost: DeviceLost) => void): () => void {
    this.#deviceLostObserver = fn
    return () => {
      if (this.#deviceLostObserver === fn) this.#deviceLostObserver = undefined
    }
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
      // The floor is applied here, not only inside `describeCapabilities`: this
      // object is built by hand and is the one callers actually read, so an
      // adapter reporting 0 would otherwise make every source look oversized.
      maxTextureDimension: Math.max(MIN_TRUSTWORTHY_TEXTURE_DIMENSION, limits.maxTextureDimension2D),
      externalTextures: true
    }

    const module = device.createShaderModule({ code: PANORAMA_WGSL, label: 'panorama' })

    // Compilation errors never throw. Ask explicitly: a pipeline built from a
    // broken module is invalid rather than an exception, and every subsequent
    // draw is a no-op with a console message nobody reads.
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter(m => m.type === 'error')
    if (errors.length > 0) {
      const detail = errors
        .map(m => `${m.lineNum}:${m.linePos} ${m.message}`)
        .join('\n')
      throw new Error(`WGSL compilation failed:\n${detail}`)
    }

    const cameraBuffer = device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'camera'
    })

    const cameraLayout = device.createBindGroupLayout({
      label: 'camera',
      entries: [
        {
          binding: 0,
          // FRAGMENT only: the vertex stage emits clip space from the vertex
          // index and reads no buffer at all. Declaring VERTEX here would work
          // and would be a lie about what the shader does.
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    })

    // Two source layouts because `texture_2d<f32>` and `texture_external` are
    // different binding types. They are in the same group with different binding
    // numbers so a single module can declare both -- each pipeline layout names
    // only the one its entry point uses, and a binding the entry point does not
    // reference is not validated against it.
    const sourceLayout = device.createBindGroupLayout({
      label: 'source',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
      ]
    })
    const externalSourceLayout = device.createBindGroupLayout({
      label: 'source-external',
      entries: [
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} }
      ]
    })

    const texturePipeline = await withValidationScope(device, 'texture pipeline', () =>
      device.createRenderPipeline({
        label: 'panorama-texture',
        layout: device.createPipelineLayout({
          bindGroupLayouts: [cameraLayout, sourceLayout]
        }),
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [{ format: TARGET_FORMAT }]
        },
        primitive: { topology: 'triangle-list' },
        // No depth or stencil attachment anywhere in this backend. The legacy
        // renderer enabled depth testing and never cleared the buffer, so its
        // output depended on the previous frame's depth values (defect F4).
        // There is exactly one triangle and nothing to occlude.
        depthStencil: undefined,
        multisample: { count: 1 }
      })
    )

    const externalPipeline = await withValidationScope(device, 'external pipeline', () =>
      device.createRenderPipeline({
        label: 'panorama-external',
        layout: device.createPipelineLayout({
          bindGroupLayouts: [cameraLayout, externalSourceLayout]
        }),
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main_external',
          targets: [{ format: TARGET_FORMAT }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: undefined,
        multisample: { count: 1 }
      })
    )

    const sampler = createPanoramaSampler(device)

    const cameraBindGroup = withValidationScope(device, 'camera bind group', () =>
      device.createBindGroup({
        label: 'camera',
        layout: cameraLayout,
        entries: [{ binding: 0, resource: { buffer: cameraBuffer } }]
      })
    )

    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('canvas.getContext("webgpu") returned null')
    context.configure({
      device,
      format: TARGET_FORMAT,
      alphaMode: 'opaque'
    })

    return new WebGPUBackend({
      canvas,
      acquired,
      capabilities,
      cameraBuffer,
      sampler,
      cameraLayout,
      sourceLayout,
      externalSourceLayout,
      cameraBindGroup,
      texturePipeline,
      externalPipeline,
      context
    })
  }

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

  /**
   * Packs and uploads the uniform block from the last camera and source.
   *
   * One writer rather than one per setter, because `texProjKind` comes from the
   * source and everything else from the camera: two writers would each have to
   * know about the other's fields, and the one that ran last would win.
   */
  #writeCameraUniforms (): void {
    const state = this.#state
    const projection = this.#projection
    if (!state || !projection) return

    packCameraUniforms(this.#cameraValues.buffer, {
      invClip: this.#invClip,
      projKind: cameraProjectionCode(projection.kind),
      texProjKind: textureProjectionCode(this.#source?.state.projection ?? 'equirectangular'),
      povLatitude: state.povLatitude,
      povLongitude: state.povLongitude,
      zoom: projection.kind === 'linear' ? 1 : projection.zoom
    })

    this.#acquired.device.queue.writeBuffer(this.#cameraBuffer, 0, this.#cameraValues)
    this.#dirty = true
  }

  /**
   * Accepts the frame and decides whether the GPU side needs new pixels.
   *
   * Nothing is imported or copied here. An external texture is only valid inside
   * the task that imported it, so the import has to happen in `render()`, in the
   * same synchronous stretch as the submit. Doing it here and drawing later
   * would be a use-after-free that happens to work on some drivers.
   */
  setSource (source: RenderableSource | null): void {
    const previous = this.#source
    this.#source = source

    if (source === null) {
      // Nothing to draw. Destroy rather than keep: a texture held for a source
      // that is gone is GPU memory the viewer has no other way to reclaim.
      this.#sourceTexture?.destroy()
      this.#sourceTexture = null
      this.#sourceBindGroup = null
      this.#uploadedVersion = -1
      this.#dirty = true
      return
    }

    if (source.version !== this.#uploadedVersion || previous?.element !== source.element) {
      this.#dirty = true
    }

    // The source's projection is a uniform, so a different source can mean
    // different uniforms with the camera untouched. Without this, swapping an
    // equirectangular still for a fisheye one would render with the old value
    // until the camera happened to move.
    if (previous?.state.projection !== source.state.projection) {
      this.#writeCameraUniforms()
    }
  }

  /**
   * Draws one frame.
   *
   * With no argument the frame goes to the canvas, which is what the render loop
   * does and what every production call site relies on. A caller may instead
   * name its own target, which is how a frame is rendered offscreen for
   * readback -- the integration tests need raw texture bytes, and the only way
   * to get them is `copyTextureToBuffer` on a texture this device created.
   *
   * Not on the `Backend` interface: a `GPUTextureView` is a WebGPU type and the
   * WebGL2 backend has no equivalent. An extra *optional* parameter still
   * satisfies `Backend.render`, so this is a widening, not a divergence.
   */
  render (target?: GPUTextureView): void {
    if (this.#disposed) return
    // The loop calls this every frame. Drawing an unchanged frame 60 times a
    // second would work and would drain the battery for nothing.
    if (!this.#dirty) return

    const source = this.#source
    // A source whose metadata has not loaded yet has a zero upload size. That is
    // not an error; there is simply nothing to draw, and no texture may be
    // created with a zero dimension.
    if (source === null || source.state.width === 0 || source.state.height === 0) {
      this.#dirty = false
      return
    }

    const device = this.#acquired.device
    const queue = device.queue

    // Pushed before any of the work and popped after the submit. An error scope
    // only sees what happens between push and pop, so wrapping the calls in a
    // helper that pushes and pops around them would be the same thing -- the
    // reason this is spelled out is that the scope must still be open while the
    // command encoder is alive, and that is easy to get wrong when the work is
    // split across branches.
    device.pushErrorScope('validation')

    let bindGroup: GPUBindGroup
    let pipeline: GPURenderPipeline

    if (source.kind === 'video') {
      // Import, bind, encode, submit -- one synchronous stretch. An external
      // texture is destroyed at the end of this microtask and the bind group
      // does not keep it alive.
      const external = device.importExternalTexture({
        source: source.element as HTMLVideoElement,
        label: 'source'
      })
      bindGroup = device.createBindGroup({
        label: 'source-external',
        layout: this.#externalSourceLayout,
        entries: [{ binding: 2, resource: external }]
      })
      pipeline = this.#externalPipeline
      // A video presents a new frame every rAF, so the next frame is always
      // worth drawing. `version` is bumped by `markFramePresented`, which the
      // render loop calls after this returns, so at this point it still
      // describes the frame just drawn -- gating on it would draw every other
      // frame.
      this.#dirty = true
    } else {
      if (this.#sourceTexture === null || source.version !== this.#uploadedVersion) {
        if (
          this.#sourceTexture === null ||
          this.#sourceTexture.width !== source.state.width ||
          this.#sourceTexture.height !== source.state.height
        ) {
          this.#sourceTexture?.destroy()
          this.#sourceTexture = device.createTexture({
            label: 'source',
            size: { width: source.state.width, height: source.state.height },
            format: TARGET_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
          })
          // The bind group holds the old texture, so a reallocation invalidates
          // it. Dropping the reference is enough; it is garbage collected.
          this.#sourceBindGroup = null
        }

        // `flipY: false` is deliberate. See `to_uv` in panorama.wgsl: the shader
        // absorbs the flip for BOTH source paths, because a flip here could not
        // apply to the video path at all and the two would end up with opposite
        // orientations.
        queue.copyExternalImageToTexture(
          { source: source.element },
          { texture: this.#sourceTexture, flipY: false },
          { width: source.state.width, height: source.state.height }
        )
        this.#uploadedVersion = source.version
      }

      this.#sourceBindGroup ??= device.createBindGroup({
        label: 'source',
        layout: this.#sourceLayout,
        entries: [
          { binding: 0, resource: this.#sampler },
          { binding: 1, resource: this.#sourceTexture!.createView() }
        ]
      })
      bindGroup = this.#sourceBindGroup
      pipeline = this.#texturePipeline
      this.#dirty = false
    }

    // Only now, and only in the canvas case. Acquiring the swapchain texture and
    // not submitting it is a validation error, so every early-out above has to
    // happen before this line.
    const view = target ?? this.#context.getCurrentTexture().createView()
    const encoder = device.createCommandEncoder({ label: 'panorama' })
    const pass = encoder.beginRenderPass({
      label: 'panorama',
      colorAttachments: [
        {
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.#cameraBindGroup)
    pass.setBindGroup(1, bindGroup)
    // Three vertices, no buffer: `vs_main` computes the corner positions from
    // `vertex_index` alone.
    pass.draw(3)
    pass.end()
    queue.submit([encoder.finish()])

    // Popped, not awaited. Validation errors are asynchronous and never throw, so
    // a frame that is wrong is indistinguishable from one that is fine until
    // someone reads the console -- and the loop cannot await. The pop has to
    // happen regardless of the branch taken, so it is not inside the `if`.
    void device.popErrorScope().then(error => {
      if (error !== null) channels.gpu('render validation error: %s', error.message)
    })
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

    // Everything here is owned by this instance and by nothing else: `create()`
    // acquires a fresh adapter and device on every call, so there is no second
    // consumer of this device to take down. That is what makes destroying it
    // correct rather than rude -- and it is the only way to release the memory,
    // since a GPUDevice has no other teardown.
    this.#sourceTexture?.destroy()
    this.#cameraBuffer.destroy()
    this.#acquired.device.destroy()

    // Deliberately not calling the device-lost observer. `device.destroy()` does
    // resolve `device.lost` with reason 'destroyed', but this disposal is not a
    // loss -- reporting it would make the viewer's `device-lost` event fire on
    // every clean teardown.
    this.#deviceLostObserver = undefined
  }
}
```

**这段代码里有四处是踩过才知道的，改的时候不要动：**

> - **两条管线共用同一个 shader module，靠的是 entry point 不同**（`fs_main` / `fs_main_external`），不是靠两份源码。`texture_external` 没有 `textureSample` 重载，所以一个入口点服务不了两种源；但两条管线的 layout 可以只声明各自入口点用到的绑定 —— **管线布局是按入口点校验的，模块里没被该入口点引用的绑定不参与校验**。这就是「一个模块、两条管线」成立的全部理由。
> - **早退必须在 `getCurrentTexture()` 之前**。取了 swapchain 纹理却不提交是 validation error，而 validation error 是**异步的、不抛的** —— 所以它不会让测试变红，只会让某一帧悄悄不出图。
> - **视频路径每帧重建 bind group**，且 import / bind / encode / submit 必须在同一段同步代码里。`GPUExternalTexture` 在当前微任务结束时失效（spec §4.4 实测），bind group 持有它**不能**续命。
> - **`dispose` 销毁 device 是对的**，因为 `create()` 每调一次就建一个新 device，后端是它的唯一持有者；不销毁它就没有别的办法释放显存。
> - **`render(target?)` 的 `target` 与 `get device()` 是一对，缺一不可。** 渲染目标必须和管线属于同一个 device，所以测试自己建不了目标纹理 —— 它得先拿到后端的 device。这两个成员**只在具体类上，不在 `Backend` 接口上**：`GPUTextureView` 是 WebGPU 类型，WebGL2 后端没有对应物，挂到共享接口上会逼着 P6 实现一个它用不上的东西。
>
> 不要为了让骨架跑起来而跳过 error scope。**先跑通 Task 6 的布局往返测试，再写四个投影的接线。**

- [ ] **Step 3: 写测试出口**

`demo/test-entry.ts` —— 页面侧的测试出口。它**不是**生产入口：`src/index.ts` 一个内部符号都不挂（P1 与 P4 都要求过同一件事）。

```ts
/*
 * The page-side surface the integration tests drive.
 *
 * In `demo/` rather than `src/` because it is not part of the library: it hands
 * out internals on a global, and shipping that would make every internal name
 * part of the public contract forever.
 *
 * The object is assembled from `./test-entry-hooks/*.ts` rather than written out
 * here. Each phase that needs a new hook drops in its own file and touches
 * nothing else -- which matters because P4 and P6 both depend on this phase and
 * would otherwise both be editing this file.
 */

import type { RenderRequest, RenderResult } from './test-entry-hooks/renderer'

declare global {
  /**
   * Everything the page exposes for tests.
   *
   * Global rather than module-scoped, and that is the whole point: each hook
   * file widens it with a `declare global` block of its own, and global
   * interfaces merge across files with no specifier to get wrong. An exported
   * `interface` would instead force every later phase to write
   * `declare module '../test-entry'` -- a relative path that has to resolve
   * correctly from an arbitrary file in a subdirectory, and which silently
   * does nothing when it does not.
   */
  interface PanoTestApi {
    renderOffscreen (request: RenderRequest): Promise<RenderResult>
  }

  interface Window { __panoTest: PanoTestApi }
}

// `eager` because the tests call into these synchronously after load; a lazy
// glob would hand back promise-returning importers. `import.meta.glob` is a Vite
// feature and this file is only ever built by Vite.
const hookModules = import.meta.glob<{ default: Partial<PanoTestApi> }>(
  './test-entry-hooks/*.ts',
  { eager: true }
)

const api: PanoTestApi = Object.assign(
  {},
  ...Object.values(hookModules).map(m => m.default)
) as PanoTestApi

window.__panoTest = api
```

```ts
// demo/test-entry-hooks/renderer.ts

import { WebGPUBackend } from '../../src/renderer/webgpu/backend'
import { acquireDevice } from '../../src/renderer/webgpu/device'
import type { CameraState, Projection } from '../../src/core/types'

// No import of `PanoTestApi`: it is a global interface (see `test-entry.ts`), so
// it is already in scope here.

/** Everything one offscreen render needs. All of it structured-cloneable. */
export interface RenderRequest {
  readonly width: number
  readonly height: number
  readonly camera: CameraState
  readonly projection: Projection
  /**
   * The source as base64 PNG, not raw pixels.
   *
   * Two reasons. It is a third the size over the CDP wire, and a data URL lets
   * this build a real `HTMLImageElement`, so the frame goes through the same
   * `copyExternalImageToTexture` call a viewer makes instead of a shortcut only
   * tests take.
   */
  readonly sourcePng: string
}

/** What one offscreen render produced. */
export interface RenderResult {
  readonly width: number
  readonly height: number
  /** RGBA8, top-down, row-major. */
  readonly rgba: number[]
}

/**
 * Renders one frame offscreen and reads the pixels back.
 *
 * The whole product path runs: `setCamera` builds the matrix through
 * `buildCameraTransform`, the shader module is the shipped one, and the source
 * is a real image element. The only thing this skips is the swapchain.
 */
async function renderOffscreen (request: RenderRequest): Promise<RenderResult> {
  const { width, height, camera, projection, sourcePng } = request

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const backend = await WebGPUBackend.create(canvas)
  if (!backend) throw new Error('no WebGPU device available')

  const image = new Image()
  image.src = `data:image/png;base64,${sourcePng}`
  await image.decode()

  const device = backend.device
  const target = device.createTexture({
    label: 'readback',
    size: { width, height },
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
  })

  try {
    backend.setCamera(camera, projection)
    backend.setSource({
      state: {
        projection: 'equirectangular',
        width: image.naturalWidth,
        height: image.naturalHeight
      },
      kind: 'image',
      element: image,
      version: 1
    })

    backend.render(target.createView())
    return await readTexture(device, target, width, height)
  } finally {
    target.destroy()
    backend.dispose()
  }
}

/**
 * Copies a texture back to the CPU, top-down, RGBA8.
 *
 * `copyTextureToBuffer` requires `bytesPerRow` to be a multiple of 256, and four
 * bytes per pixel only clears that when the width is a multiple of 64. The 128px
 * fixtures happen to clear it; handling the padding anyway means the next test
 * that renders at some other size does not fail for a reason that reads like a
 * driver bug.
 */
async function readTexture (
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number
): Promise<number[]> {
  const bytesPerRow = Math.ceil((width * 4) / 256) * 256
  const buffer = device.createBuffer({
    label: 'readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  const encoder = device.createCommandEncoder({ label: 'readback' })
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height })
  device.queue.submit([encoder.finish()])

  await buffer.mapAsync(GPUMapMode.READ)
  const src = new Uint8Array(buffer.getMappedRange())
  // Copied out before `unmap`: the mapped range is only valid until then, and
  // the copy is what makes the de-padding safe.
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const from = y * bytesPerRow
    out.set(src.subarray(from, from + width * 4), y * width * 4)
  }
  buffer.unmap()
  buffer.destroy()
  // A plain array, not a typed one. `page.evaluate` serialises with structured
  // clone, and a `Uint8Array` crosses as an object keyed by index -- which is
  // not what `maxChannelDiff` walks.
  return Array.from(out)
}

// The widening lives next to the code that provides it. `declare global` in a
// module is a global augmentation, so this merges into the `PanoTestApi` that
// `test-entry.ts` opened; nothing imports anything to make it work, and a phase
// that adds a hook cannot forget to register it in a second place.
declare global {
  interface PanoTestApi {
    // Re-exported straight from `src/`, unwrapped. These two are the only
    // `src/` internals this hook hands out -- a test that needs a backend or a
    // raw device has no smaller surface to go through -- and the entry point
    // only loads in test builds.
    WebGPUBackend: typeof WebGPUBackend
    acquireDevice: typeof acquireDevice
  }
}

export default { renderOffscreen, WebGPUBackend, acquireDevice } satisfies Partial<PanoTestApi>
```

**这一步还要建仓库根的 `index.html` —— 集成测试的落地页。**

`page.goto('/')` 是**所有**集成测试的第一行（P1 的 `gpuPage` fixture、P5 的五个 User Story、P6 的门禁 C 都这么写），而 `/` 得是一个真的加载了 `demo/test-entry.ts` 的页面，`window.__panoTest` 才会在。

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>pano.gl test entry</title>
  <!--
    The page every integration test navigates to. It is the ONLY page that loads
    the test entry, and that is how "test-only" is enforced: not by a build flag
    but by which page imports what. demo/index.html (the demo, P1 Task 10) and
    this file never import each other, so window.__panoTest exists here and
    cannot exist there.

    No vite.config.ts is needed for this. Vite's root is the repo root (that is
    where `npx vite` runs) and its publicDir default is <root>/public, which is
    where P1 Task 11 puts the fixtures -- so '/fixtures/panorama.png' resolves
    with no configuration at all.
  -->
</head>
<body>
  <div id="host"></div>
  <script type="module" src="/demo/test-entry.ts"></script>
</body>
</html>
```

> `demo/test-entry.ts` 的完整性由本步负责（不留占位）。还有两件事也要在**本步**做好：
> 1. **两套 tsconfig 都要把 `demo/` 收进 program** —— Vite 侧的 `demo/tsconfig.json` 和 Playwright 侧的 `test/integration/tsconfig.json`。否则全局 `Window.__panoTest` 声明只在一半程序里可见，测试侧就得写 `as unknown as`，而那正是本步要消灭的东西。
> 2. `index.html` 里那句 `<script type="module" src="/demo/test-entry.ts">` 用的是**根绝对路径**，不是 `./`。它保证页面从哪个 URL 打开都能解析到同一个模块 —— 测试只走 `/`，但有人手工打开 `/index.html` 时不该得到两个不同的模块实例。

- [ ] **Step 4: 写冒烟测试**

`test/integration/backend-smoke.test.ts`：

```ts
import { test, expect } from './support/fixtures'

test('a WebGPU backend can be created and dispose cleanly', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { WebGPUBackend } = window.__panoTest
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    document.body.appendChild(canvas)
    // `create` returns null when the page has no usable WebGPU, which the
    // fixture already skips on -- so a null here is a real failure.
    const backend = await WebGPUBackend.create(canvas)
    if (!backend) return { created: false }
    backend.dispose()
    backend.dispose()  // idempotent
    return { created: true }
  })
  expect(result.created).toBe(true)
})

test('device loss is observable', async ({ gpuPage }) => {
  // The spec's failure mode: WebGPU does not auto-recover, so a lost device
  // that nothing listens for means a permanently black canvas and no message.
  const fired = await gpuPage.evaluate(async () => {
    const { acquireDevice } = window.__panoTest
    const acquired = await acquireDevice()
    if (!acquired) return 'no device'
    const lost = acquired.device.lost.then(() => 'lost')
    acquired.device.destroy()
    return Promise.race([lost, new Promise(r => setTimeout(() => r('timeout'), 5000))])
  })
  expect(fired).toBe('lost')
})
```

> `WebGPUBackend` 与 `acquireDevice` 的导出与 `PanoTestApi` 扩写都写在 `demo/test-entry-hooks/renderer.ts` 里（见 Step 3 末尾）：**扩展声明和提供实现的是同一个文件**。两者都从 `src/` 直接再导出，不要包一层。**这是本计划里唯一允许从 `demo/` 导出 `src/` 内部符号的地方**（连同后面的 `probeSurface`）—— 出口只有这一个，且只在测试构建里加载。

- [ ] **Step 5: 跑集成测试**

Run: `npm run test:integration -- backend-smoke`
Expected: 2 个测试 PASS

- [ ] **Step 6: Commit**

```bash
git add src/renderer/webgpu/backend.ts test/integration/support/gpu.ts \
  test/integration/backend-smoke.test.ts demo/ index.html tsconfig.json
git commit -m "feat(renderer): WebGPU backend skeleton, offscreen test entry, device loss reporting"
```

---

### Task 6: uniform 布局往返验证

**Files:**
- Create: `demo/test-entry-hooks/echo.ts`
- Test: `test/integration/uniform-layout.test.ts`

**这是本计划里最容易被跳过、也最不能跳过的一步。** 单元测试只能证明 TS 侧的偏移自洽；**只有往 GPU 里写一遍再读回来，才能证明这些偏移与 WGSL 对 struct 的理解一致**。

- [ ] **Step 1: 写探针**

`demo/test-entry-hooks/echo.ts` —— 又一个 hook 文件。放进 `test-entry-hooks/` 而不是 `test/integration/support/`，因为它**跑在页面里**（要 `navigator.gpu`），而 `test/` 那侧跑在 Node 里；`test/` 只负责驱动它。

```ts
/*
 * Uniform-layout probe.
 *
 * Writes values into the camera uniform block, has the GPU read every 4-byte
 * slot back out, and returns them. This is the only way to check the JavaScript
 * layout against WGSL's: WebGPU has no uniform reflection, so a field landing at
 * the wrong offset is not an error -- it is a wrong picture.
 *
 * The shader is *generated* from `CAMERA_UNIFORM_LAYOUT` rather than written by
 * hand. WGSL cannot index a struct's members -- each one has to be named -- so a
 * hand-written shader would be a second copy of the layout, which is precisely
 * the pair that has to agree.
 *
 * A compute shader over a storage buffer, not a fragment shader writing colour.
 * Same uniform binding and the same validation, but it round-trips raw bits: an
 * f32/u32 mix-up comes back as a bit pattern instead of surviving a float-to-unorm
 * conversion that happens to look plausible.
 */

import {
  CAMERA_UNIFORM_LAYOUT,
  CAMERA_UNIFORM_SIZE,
  packCameraUniforms
} from '../../src/renderer/uniforms'
import type { CameraUniformValues } from '../../src/renderer/uniforms'
import { acquireDevice } from '../../src/renderer/webgpu/device'

/** Fields WGSL declares as `u32`. Everything else in the block is `f32`. */
const U32_FIELDS = new Set(['projKind', 'texProjKind'])

/** Floats in the 4x4 matrix that heads the block. */
const MATRIX_FLOATS = 16

/** Slots (4-byte words) in the block. `out` is indexed by these. */
const SLOT_COUNT = CAMERA_UNIFORM_SIZE / 4

/**
 * Builds the WGSL: the struct, and one `out[n] = ...` per 4-byte slot.
 *
 * Index `n` in `out` is byte offset `n * 4` in the block, so the readback is the
 * block's bytes and nothing has to agree about field order beyond the layout
 * itself.
 *
 * The matrix is indexed `invClip[col][row]`. That is where the column-major
 * question gets settled -- gl-matrix's `elements[col * 4 + row]` is the same
 * order, and if that were wrong, this is the thing that would notice.
 */
function buildEchoShader (): string {
  const slots: string[] = []

  for (const field of CAMERA_UNIFORM_LAYOUT) {
    for (let i = 0; i < field.byteLength / 4; i++) {
      const flat = field.offset / 4 + i
      const access = flat < MATRIX_FLOATS
        ? `camera.invClip[${Math.floor(flat / 4)}][${flat % 4}]`
        : U32_FIELDS.has(field.name)
          ? `camera.${field.name}`
          : `bitcast<u32>(camera.${field.name})`
      slots.push(`  out[${flat}] = ${access};`)
    }
  }

  const members = CAMERA_UNIFORM_LAYOUT.map(f => {
    const type = f.byteLength === 64
      ? 'mat4x4<f32>'
      : U32_FIELDS.has(f.name) ? 'u32' : 'f32'
    return `  ${f.name}: ${type},`
  })

  return `
struct Camera {
${members.join('\n')}
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;

@compute @workgroup_size(1)
fn main () {
${slots.join('\n')}
}
`
}

/** Fills in whatever the caller left out, so `packCameraUniforms` gets a whole block. */
function withDefaults (values: Partial<CameraUniformValues>): CameraUniformValues {
  return {
    // A plain array is accepted: the probe is reading the block back, not using
    // the matrix, so it need not be a usable transform.
    invClip: Float32Array.from(values.invClip ?? new Array(MATRIX_FLOATS).fill(0)),
    projKind: values.projKind ?? 0,
    texProjKind: values.texProjKind ?? 0,
    povLatitude: values.povLatitude ?? 0,
    povLongitude: values.povLongitude ?? 0,
    zoom: values.zoom ?? 0
  } as CameraUniformValues
}

/**
 * Builds a probe bound to a fresh device.
 *
 * Returns null when the page has no usable WebGPU, which the `gpuPage` fixture
 * already skips on -- so a null reaching a test is a real failure, not a skip.
 */
export async function createEchoRenderer (): Promise<
  (values: Partial<CameraUniformValues>) => Promise<Record<string, unknown>>
> {
  const acquired = await acquireDevice()
  if (!acquired) throw new Error('no WebGPU device available')
  const { device } = acquired

  const uniformBuffer = device.createBuffer({
    label: 'echo-uniforms',
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  })
  const outBuffer = device.createBuffer({
    label: 'echo-out',
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  })
  const readBuffer = device.createBuffer({
    label: 'echo-read',
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  // Only the uniform binding is declared in the layout: the storage buffer is
  // `read_write`, which needs an explicit `buffer` entry anyway, and keeping
  // both here means the pipeline is built once and reused by every call.
  const module = device.createShaderModule({ label: 'echo', code: buildEchoShader() })
  const pipeline = device.createComputePipeline({
    label: 'echo',
    layout: 'auto',
    compute: { module, entryPoint: 'main' }
  })
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: outBuffer } }
    ]
  })

  return async function echo (values) {
    const bytes = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(bytes, withDefaults(values))
    device.queue.writeBuffer(uniformBuffer, 0, bytes)

    const encoder = device.createCommandEncoder({ label: 'echo' })
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(1)
    pass.end()
    encoder.copyBufferToBuffer(outBuffer, 0, readBuffer, 0, CAMERA_UNIFORM_SIZE)
    device.queue.submit([encoder.finish()])

    await readBuffer.mapAsync(GPUMapMode.READ)
    // Copied out before `unmap`: the mapped range is only valid until then.
    const bits = new Uint32Array(readBuffer.getMappedRange().slice(0))
    readBuffer.unmap()
    // Both views are over the same bytes, so this is a reinterpretation and not
    // a conversion -- which is the point: a value that crossed as the wrong type
    // has to come back wrong.
    const floats = new Float32Array(bits.buffer)

    const echoed: Record<string, unknown> = {}
    for (const field of CAMERA_UNIFORM_LAYOUT) {
      // Only what was asked for. A caller checking five scalars should not have
      // to ignore the three padding words in the assertion.
      if (!(field.name in values)) continue
      const start = field.offset / 4
      const count = field.byteLength / 4
      echoed[field.name] = count === 1
        ? (U32_FIELDS.has(field.name) ? bits[start] : floats[start])
        : Array.from(floats.subarray(start, start + count))
    }
    return echoed
  }
}

declare global {
  interface PanoTestApi {
    createEchoRenderer: typeof createEchoRenderer
  }
}

export default { createEchoRenderer } satisfies Partial<PanoTestApi>
```

> `packCameraUniforms` 的入参类型是 `CameraUniformValues`，`invClip` 要 `mat4`。探针传的是 `Float32Array.from(...)`，**不是真的可用矩阵也不影响** —— 它只负责把 16 个数写进去再读回来，不参与任何变换。这一点在测试里表现为第二个用例可以拿 `[1..16]` 这种显然不是变换矩阵的数组当输入。

- [ ] **Step 2: 写测试**

```ts
import { test, expect } from './support/fixtures'

/*
 * Writes sentinels into the camera uniform block, reads every slot back from
 * WGSL, and compares.
 *
 * Why this cannot be a unit test: the layout constants are the JavaScript side's
 * opinion of where the fields are. WGSL has its own opinion. Nothing checks that
 * the two agree -- there is no reflection API. A mismatch reads whatever bytes
 * are adjacent, which produces a picture that is wrong in a way that looks like
 * a projection bug.
 *
 * This test is also the guard on the std140 assumption. It was verified on Metal
 * and SwiftShader that WGSL's uniform address space packs consecutive 4-byte
 * scalars without per-member 16-byte slots; if a future browser changes that,
 * this test is where it shows up.
 */
test('every uniform field round-trips through WGSL at its declared offset', async ({ gpuPage }) => {
  // Sentinels chosen so a one-field shift produces a visibly wrong value rather
  // than a plausible one. All five are exact in f32 and none is a round number
  // that could coincide with a neighbour's default.
  const values = {
    projKind: 1234567,
    texProjKind: 7654321,
    povLatitude: -12.5,
    povLongitude: 234.75,
    zoom: 3.5
  }

  const echoed = await gpuPage.evaluate(async v => {
    const echo = await window.__panoTest.createEchoRenderer()
    return echo(v)
  }, values)

  expect(echoed).toEqual(values)
})

test('the inverse clip matrix round-trips without transposition', async ({ gpuPage }) => {
  // gl-matrix is column-major and WGSL's mat4x4 is m[col][row]; they line up,
  // but "they line up" is exactly the kind of claim that deserves a test.
  //
  // Sixteen distinct values, in the order the array is written. A transposed
  // round trip returns the same sixteen numbers in a different order, so the
  // values have to be distinct for the comparison to mean anything -- an
  // identity or constant matrix would pass while transposed.
  const invClip = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

  const echoed = await gpuPage.evaluate(async m => {
    const echo = await window.__panoTest.createEchoRenderer()
    return echo({ invClip: m })
  }, invClip)

  expect(echoed.invClip).toEqual(invClip)
})
```

- [ ] **Step 3: 跑测试**

Run: `npm run test:integration -- uniform-layout`
Expected: 2 个测试 PASS

**如果失败** —— 大概率是紧凑标量布局或转置。按顺序排查：
1. 让探针把全部 24 个槽都返回（临时去掉 `if (!(field.name in values)) continue`），看原始位模式：字段错位会表现为「值出现在隔壁槽里」，而不是「值是垃圾」
2. 若每个字段都被推到了独立的 16 字节槽上（`projKind` 在 `out[16]`（byte 64）而 `povLatitude` 跑到 `out[20]`（byte 80）而不是 `out[18]`（byte 72））→ 该实现不接受紧凑标量布局，**上报卡点**，因为这会影响所有 backend 的布局设计
3. 若只有矩阵转置 → 检查 `f32.set` 的偏移与 `buildEchoShader` 里 `invClip[col][row]` 的展开

- [ ] **Step 4: Commit**

```bash
git add demo/test-entry-hooks/echo.ts test/integration/uniform-layout.test.ts
git commit -m "test(renderer): round-trip every uniform field through WGSL

Unit tests only prove the JavaScript offsets are self-consistent. There is
no reflection API to check them against WGSL, so the only way to know the
two agree is to write sentinels and read them back. The probe's shader is
generated from the layout for the same reason: a hand-written one would be
a second copy of the thing under test."
```

---

### Task 7: 门禁 A —— 像素对拍

**Files:**
- Test: `test/integration/gate-a-pixels.test.ts`

**门禁 A 的问题**：全屏三角形替掉立方体与四边形之后，四个投影是否都还画得对？

**门禁 A 要回答的不是「四条路径是否全都逐状态一致」，而是「全屏三角形有没有毁掉任何一条」。** 这两句话的差别是本任务的全部难点，先读完再动手。

**可比状态的集合是从 fixture 推出来的，不是写死的。** 两处旧实现的缺陷让「哪些状态可比」成为一个只有 fixture 能回答的问题：

> - **纬度（F5）**：旧的非线性相机完全忽略纬度 —— 着色器声明了 `u_CamPOVLatitude` 却一次都没读，内部那个供矩阵用的 ortho 相机构造时传 `povLatitude: 0` 之后只读不写。Task 8 **故意**让新实现读它。所以对非线性相机，`lat ≠ 0` 的状态在新旧之间**必须不同**，不可比。
> - **经度（F10）**：`float lng = u_CamPOVLongitude / 2.0;` 是文件作用域的非恒定初始化，在 GLSL ES 1.0 里非法。有的驱动把它编译成 0 —— 那样旧的非线性相机**根本不会转**。而且就算它生效了，旧的那行还有单位错（把「度」当「弧度」减），新实现不可能也不应该复现。所以「经度是否影响画面」**只能实测**。
>
> 判据现成：`cylindrical` 的 `origin`（lat 0, lng 0, zoom 0）与 `tilt`（lat 30, lng 45, zoom 0）之间，**这个投影能看见的唯一输入差异是经度** —— 它的 `phi` 不读纬度，两个状态 zoom 都是 0，而纬度本来就被忽略。两张 PNG 相同 ⇒ `lng` 被编译成 0 ⇒ 经度对画面无影响，`lat === 0` 的状态全都可比；不同 ⇒ 经度确实在起作用，只有 `lng === 0` 的状态可比。

- [ ] **Step 1: 写测试**

```ts
import { test, expect } from './support/fixtures'
import { renderOffscreen, maxChannelDiff } from './support/gpu'
import {
  LEGACY_EXTENT,
  fixtureRoot,
  legacyFovFrom,
  loadCapture,
  readCaptureDoc
} from '../support/baseline'
import type { Projection } from '../../src/core/types'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'

/*
 * Gate A: does one fullscreen triangle serve all four projections?
 *
 * Compares against the PNGs P0 captured from v0.2.2. The baseline is regenerated
 * only by tools/baseline/capture.mjs, so a failure here means the new renderer
 * disagrees with the shipped one -- not that the baseline drifted.
 *
 * Every input comes from the fixture: the state list from the files that exist,
 * the camera parameters from the recorded uniform stream, the source image from
 * the PNG the capture used, the fov from the captured matrix. Nothing is
 * restated here, because a second copy of "what was captured" is a second source
 * of truth for it and the two drift.
 *
 * Tolerance is +-2 LSB per channel. Measured cross-backend deviation is about
 * 5e-5 in float terms, well under one 8-bit step; the headroom covers the
 * difference between v0.2.2's shader and this one, which is not the same code.
 */

/** The source the captures were made with. Committed by P0 for exactly this. */
const sourcePng = readFileSync(path.join(fixtureRoot, 'source.png')).toString('base64')

/** Which states exist is whatever the capture wrote. */
function statesOf (camera: string): string[] {
  return readdirSync(path.join(fixtureRoot, camera))
    .filter(f => f.endsWith('.png'))
    .map(f => f.replace(/\.png$/, ''))
}

/*
 * Whether the legacy `lng` initializer took effect, measured rather than assumed.
 *
 * See the note above the step: `cylindrical` at `origin` and `tilt` differ only
 * in longitude as far as this projection can tell, so identical pixels mean the
 * driver compiled that invalid file-scope initializer to zero.
 */
function longitudeIsInert (): boolean {
  const a = PNG.sync.read(readFileSync(path.join(fixtureRoot, 'cylindrical', 'origin.png')))
  const b = PNG.sync.read(readFileSync(path.join(fixtureRoot, 'cylindrical', 'tilt.png')))
  return Buffer.compare(a.data, b.data) === 0
}

const LNG_INERT = longitudeIsInert()

/**
 * The states a camera can be compared on.
 *
 * `perspective` gets all of them: the linear path puts longitude in the matrix,
 * which P2 already pins element by element, so neither defect applies.
 *
 * The non-linear cameras get only the states where both defects are neutral.
 * Latitude is always neutral-or-divergent, never comparable, so it filters to
 * zero. Longitude is neutral only if the measurement above says it never
 * reached a pixel, or if this state does not use it.
 */
function comparableStates (camera: string): string[] {
  const all = statesOf(camera)
  if (camera === 'perspective') return all

  return all.filter(stateId => {
    const { state } = readCaptureDoc(camera, stateId)
    return state.lat === 0 && (LNG_INERT || state.lng === 0)
  })
}

test.describe('gate A: fullscreen triangle vs the v0.2.2 baseline', () => {
  for (const camera of readdirSync(fixtureRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)) {
    for (const stateId of comparableStates(camera)) {
      test(`${camera} / ${stateId}`, async ({ gpuPage }) => {
        const { png, state, captured } = loadCapture(camera, stateId)

        // The legacy fov is read out of the matrix it built rather than guessed:
        // this gate is about whether the rest of the pipeline agrees, and a
        // wrong fov would produce a confident failure that says nothing useful.
        const projection: Projection =
          camera === 'perspective'
            ? { kind: 'linear', fov: legacyFovFrom(captured.u_CamTransMatrix), aspect: 1 }
            : { kind: camera, zoom: 1, extent: LEGACY_EXTENT[camera] }

        const result = await renderOffscreen(gpuPage, {
          width: png.width,
          height: png.height,
          camera: { povLatitude: state.lat, povLongitude: state.lng },
          projection,
          sourcePng
        })

        expect(maxChannelDiff(result.rgba, Array.from(png.data))).toBeLessThanOrEqual(2)
      })
    }
  }
})

/*
 * The gate above is only as strong as the set it runs on, so assert the set
 * itself. Without this, a bug that emptied `comparableStates` would report a
 * clean run over zero tests -- and a gate that silently checks nothing is worse
 * than no gate, because it is believed.
 */
test('the comparable set is not empty, and covers all four projections', () => {
  const byCamera = readdirSync(fixtureRoot, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => [e.name, comparableStates(e.name)] as const)

  expect(byCamera.map(([c]) => c).sort()).toEqual(
    ['cylindrical', 'pannini', 'perspective', 'planet']
  )
  for (const [camera, states] of byCamera) {
    expect(states.length, `${camera} has no comparable state`).toBeGreaterThan(0)
  }
  // The linear path must be compared on everything the capture holds.
  expect(comparableStates('perspective')).toHaveLength(statesOf('perspective').length)
})
```

- [ ] **Step 2: 跑门禁 A**

Run: `npm run test:integration -- gate-a`
Expected: 全 PASS，且条数是 `4 + 3×|lat=0 的非线性状态数|`（`lng` 惰性时通常为 4 + 3×1 = 7，加上那条集合断言共 8）。

**如果条数比预期少** —— 看 Step 1 那条集合断言的输出。少的原因是 `comparableStates` 过滤掉了状态，不是测试变快了。

**失败分流：**

| 现象 | 先查 |
|---|---|
| 全黑或全白 | `invClip` 没填、或 bind group 没绑 |
| 上下颠倒 | `to_uv` 的 v 方向，或 `invClip` 的 y 符号 |
| 左右镜像 | `lookAt` 的 `-sin(θ)` 手性 |
| 只差几个投影 | 那一个的公式转写错了 —— 拿 `src/core/reference.ts` 逐项对 |
| 只有 perspective 差 | 远平面取点不对（线性是唯一对距离不敏感的路径） |
| 全都差一点点、图案对得上 | 素材对不上 —— `source.png` 必须是 P0 捕获时那一张 |
| **非线性只有 origin 在跑** | 正常。那是 F5/F10 决定的，不是漏测 |

**如果 `perspective` 也失败** —— 那是 P2 的问题（矩阵对拍应该先红），别在这里纠缠。
**如果非线性全失败** —— 那是门禁 B 的问题，先跑 Task 8。

- [ ] **Step 3: Commit**

```bash
git add test/integration/gate-a-pixels.test.ts test/support/baseline.ts
git commit -m "test(renderer): gate A -- pixels vs the v0.2.2 baseline, comparable set derived from it

The non-linear cameras cannot be compared at non-zero latitude (F5: the
legacy ones ignored latitude, v1 deliberately does not) or, if the legacy
file-scope lng initializer compiled, at non-zero longitude either (F10, and
the legacy line also mixes degrees into radians). Both defects are why the
comparable set is measured off the fixture instead of written down."
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
          const t = window.__panoTest
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
        const t = window.__panoTest
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
