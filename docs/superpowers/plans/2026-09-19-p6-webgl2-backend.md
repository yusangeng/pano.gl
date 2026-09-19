# P6 — WebGL2 backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 第二个后端。四个投影在 WebGL2 下与 WebGPU 逐像素一致（门禁 C），P5 的全部用户故事测试在 WebGL2 下同样通过。

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

## 关键设计决定：不共享 uniform 布局

**WebGL2 用具名 uniform（`getUniformLocation`），不复用 `CAMERA_UNIFORM_LAYOUT`。**

P3 的交接表原本写着「GLSL 侧必须用同一份布局」，**那条是错的，这里更正**：

| | WebGPU | WebGL2 |
|---|---|---|
| 传参方式 | 一个 96 字节的 uniform block | 8 个具名 uniform |
| 布局 | 紧凑标量（实测） | **不适用** |
| 若强行用 UBO | —— | std140：**每个标量独占 16 字节**，`mat4` 之后每项 16 字节，总 192 字节 |

**用 UBO 复现「同一份布局」是不可能的** —— std140 的规则就是每成员 16 字节对齐，那不是 WebGPU 的规则。硬凑只会得到两个都不对的布局。

而 UBO 在这里**一点好处都没有**：一帧一次 draw call，一个 uniform block。所以：

- WebGL2 走 `gl.uniformMatrix4fv` / `gl.uniform1f` / `gl.uniform1ui`，各写各的
- **共享的是四个投影公式的语义，不是它们的存储方式**
- 门禁 C 比对**渲染结果**，不是 uniform 流

> **副作用（好的）：** 「两个后端的偏移不一致」这一整类 bug 从结构上消失了。

---

## 深度约定在哪一层

**WebGL2 的 ndc z ∈ [-1, 1]，WebGPU 的 ∈ [0, 1]。** 差别只在 CPU 侧建矩阵时：

- WebGL2：`mat4.perspective` / `mat4.ortho`（GL 约定）
- WebGPU：`mat4.perspectiveZO` / `mat4.orthoZO`（ZO 约定）

这由 P2 的 `buildProjection(projection, depth, out)` 的 `depth` 参数处理，**两个后端各传各的**。

**片元着色器不需要知道** —— 两个约定下 far 平面都在 ndc z = +1，所以片元里那句 `invClip * vec4(ndc, 1.0, 1.0)` 两边都成立。**这是 P3 那个设计留给 P6 的礼物，不要在这里改掉。**

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/renderer/webgl2/shaders/panorama.glsl` | GLSL ES 3.00 的顶点 + 片元（转写自 WGSL） |
| `src/renderer/webgl2/shaders/index.ts` | 拼接生成的常量 + 源码，加 `#version` 头 |
| `src/renderer/webgl2/context.ts` | 取上下文、编译、链接、错误检查 |
| `src/renderer/webgl2/backend.ts` | `Backend` 的 WebGL2 实现 |
| `test/integration/gate-c-cross-backend.test.ts` | **门禁 C** |
| `test/integration/webgl2-user-stories.spec.ts` | P5 的五组用户故事在 WebGL2 下重跑 |

---

### Task 1: GLSL ES 3.00 着色器

**Files:**
- Create: `src/renderer/webgl2/shaders/panorama.glsl`
- Create: `src/renderer/webgl2/shaders/index.ts`
- Test: `test/unit/webgl2-shaders.test.ts`

- [ ] **Step 1: 转写**

`src/renderer/webgl2/shaders/panorama.glsl`：

```glsl
// pano.gl panorama shader, WebGL2 backend.
//
// A line-by-line transcription of webgpu/shaders/panorama.wgsl. It is
// transcribed by hand rather than generated: the two languages differ enough
// that a translator would be a project of its own, and a translator that got
// the projections subtly wrong would be worse than two files a human can read
// side by side.
//
// The cost of hand transcription is that the two can drift. Gate C is what
// prevents it: every camera state is rendered through both backends and the
// pixels are compared. If you change a formula here, change it in the WGSL too,
// and check src/core/reference.ts -- the CPU reference is the arbiter when the
// two backends disagree.
//
// WHAT IS *NOT* SHARED: the uniform layout. WebGPU packs the camera into one
// 96-byte block with tight scalar packing; WebGL2 uses named uniforms. Forcing
// a common UBO would mean std140, where every scalar takes a 16-byte slot, and
// neither side would end up with the layout it wants. The semantics are shared;
// the storage is not.

// The vertex stage emits clip space from gl_VertexID alone -- no vertex buffer,
// no attributes, no geometry. Same single oversized triangle as the WebGPU
// shader.
//
// The fragment stage inverts the camera matrix to recover the surface point the
// legacy rasteriser would have interpolated. Both depth conventions put the far
// plane at ndc z = +1, so this file does not need to know which convention built
// the matrix.

precision highp float;
precision highp int;

in vec2 v_ndc;

uniform mat4 u_invClip;
uniform uint u_projKind;
uniform uint u_texProjKind;
uniform float u_povLatitude;
uniform float u_povLongitude;
uniform float u_zoom;

uniform sampler2D u_tex;

out vec4 outColor;

const float PI = 3.141592653589793;
const float HALF_PI = 1.5707963267948966;
const float TWO_PI = 6.283185307179586;

// Note: GLSL's mod() already has the sign-of-divisor behaviour that WGSL's %
// lacks, so there is no glsl_mod helper here. That asymmetry is a real trap:
// if you copy a formula back to the WGSL, replace mod() with glsl_mod().

vec2 to_uv (float theta, float phi) {
  return vec2(mod(theta / TWO_PI + 0.5, 1.0), clamp(phi / PI, 0.0, 1.0));
}

// The linear projection. Scale-invariant -- every term is a ratio, which is why
// the cube could be replaced by a triangle.
vec2 project_linear (vec3 p) {
  float theta = atan(p.z, p.x);            // GLSL is atan(y, x); WGSL is atan2(y, x)
  float phi = atan(p.y / sqrt(p.x * p.x + p.z * p.z)) + HALF_PI;
  return to_uv(theta, phi);
}

// The three non-linear projections read the MAGNITUDE of their input, so the
// size of the surface is part of the projection. That size lives in the camera
// matrix, not in vertex coordinates.

vec2 project_cylindrical (vec3 p, float zoom, float lng, float lat) {
  float theta = p.z * zoom * TWO_PI - lng * 0.5;
  float phi = atan(p.y * zoom) + HALF_PI - lat;
  return to_uv(theta, phi);
}

vec2 project_planet (vec3 p, float zoom, float lng, float lat) {
  float z = p.z * zoom;
  float y = p.y * zoom;
  float m = 1.0 + z * z + y * y;
  float q = 2.0 * z / m;
  float r = 2.0 * y / m;
  float s = (m - 2.0) / m;
  float theta = mod(atan(q, r), TWO_PI) - lng * 0.5;
  float phi = atan(s / sqrt(q * q + r * r)) + HALF_PI - lat;
  return to_uv(theta, phi);
}

vec2 project_pannini (vec3 p, float zoom, float lng, float lat) {
  float theta = 2.0 * atan(p.z * 0.5 * zoom, p.x) - lng * 0.5;
  float phi = atan(p.y * zoom / sqrt(p.x * p.x + p.z * p.z)) + HALF_PI - lat;
  return to_uv(theta, phi);
}

void main () {
  // z = 1.0 is the far plane under both depth conventions. Do not change this
  // to 0.0 for WebGL2: the matrix is built with the GL convention, where the
  // far plane is at +1 just as it is under the ZO convention.
  vec4 homogeneous = u_invClip * vec4(v_ndc, 1.0, 1.0);
  vec3 p = homogeneous.xyz / homogeneous.w;

  float lng = u_povLongitude * PI / 180.0;
  float lat = u_povLatitude * PI / 180.0;

  vec2 uv;
  // An if-chain rather than a switch: ES 3.00 supports switch, but uint case
  // labels are a portability hazard across drivers and this is four branches
  // evaluated once per pixel with a uniform condition, so the cost is nil.
  if (u_projKind == 1u) {
    uv = project_linear(p);
  } else if (u_projKind == 2u) {
    uv = project_cylindrical(p, u_zoom, lng, lat);
  } else if (u_projKind == 3u) {
    uv = project_planet(p, u_zoom, lng, lat);
  } else if (u_projKind == 4u) {
    uv = project_pannini(p, u_zoom, lng, lat);
  } else {
    uv = vec2(0.0, 0.0);
  }

  if (u_texProjKind != 1u) {
    uv = vec2(0.0, 0.0);
  }

  outColor = texture(u_tex, uv);
}
```

`src/renderer/webgl2/shaders/index.ts`：

```ts
/**
 * Assembles the GLSL program source.
 *
 * The `#version` directive must be the very first thing in the source, before
 * even a comment, so the generated constants and the shader body are joined
 * after it rather than prepended to it.
 *
 * The constants come from the same generator as the WGSL ones, so the numeric
 * values cannot drift even though the shader bodies are hand-transcribed.
 */

import { GLSL_CONSTANTS } from '../../shaders/generated'
import panoramaBody from './panorama.glsl'

const VERTEX_SOURCE = `#version 300 es
${GLSL_CONSTANTS}
precision highp float;
in vec2 a_unused;
out vec2 v_ndc;
void main () {
  // gl_VertexID is available in ES 3.00, so the fullscreen triangle needs no
  // vertex buffer and no attributes at all. The a_unused attribute is declared
  // only because some drivers optimize away a program with no inputs in ways
  // that confuse the attribute bookkeeping; it is never bound.
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

> **`#version` 必须在第一行** —— 前面不能有注释、空行、BOM。上面用模板字符串拼接时 `#version 300 es` 后面紧跟换行，是对的。**如果打开文件看到源码开头是注释，那是 bug。**

- [ ] **Step 2: 写结构与一致性测试**

`test/unit/webgl2-shaders.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { PANORAMA_GLSL_VERTEX, PANORAMA_GLSL_FRAGMENT } from '../../src/renderer/webgl2/shaders'
import { PANORAMA_WGSL } from '../../src/renderer/webgpu/shaders'

describe('WebGL2 shader source', () => {
  it('starts with #version 300 es as the very first line', () => {
    // Anything before the directive -- a comment, a blank line, a generated
    // constant -- is a compile error whose message does not mention ordering.
    expect(PANORAMA_GLSL_VERTEX.startsWith('#version 300 es\n')).toBe(true)
    expect(PANORAMA_GLSL_FRAGMENT.startsWith('#version 300 es\n')).toBe(true)
  })

  it('declares a float precision in both stages', () => {
    // ES 3.00 requires an explicit precision for float in the fragment stage.
    // Omitting it fails at link time with a message about the vertex shader.
    expect(PANORAMA_GLSL_FRAGMENT).toMatch(/precision\s+highp\s+float/)
    expect(PANORAMA_GLSL_VERTEX).toMatch(/precision\s+highp\s+float/)
  })

  it('declares every uniform the backend uploads', () => {
    // A missing declaration is not an error: getUniformLocation returns null and
    // the gl.uniform* call is silently ignored, so the value stays at zero and
    // the picture is wrong in a way that looks like a projection bug.
    for (const name of [
      'u_invClip', 'u_projKind', 'u_texProjKind',
      'u_povLatitude', 'u_povLongitude', 'u_zoom', 'u_tex'
    ]) {
      expect(PANORAMA_GLSL_FRAGMENT, `missing uniform ${name}`).toContain(name)
    }
  })

  it('does not use WGSL syntax', () => {
    for (const pattern of [/@fragment/, /@vertex/, /@builtin/, /vec4f/, /mat4x4/, /\bfn\s+\w+\s*\(/]) {
      expect(PANORAMA_GLSL_FRAGMENT).not.toMatch(pattern)
      expect(PANORAMA_GLSL_VERTEX).not.toMatch(pattern)
    }
  })

  it('applies the latitude term in all three non-linear projections', () => {
    // F5. The legacy shader declared u_CamPOVLatitude and never read it.
    // Copying that omission into the second backend would make the two backends
    // disagree only at non-zero latitude -- the hardest possible place to
    // notice.
    const body = PANORAMA_GLSL_FRAGMENT
    for (const fn of ['project_cylindrical', 'project_planet', 'project_pannini']) {
      const start = body.indexOf(`vec2 ${fn} (`)
      expect(start, `${fn} not found`).toBeGreaterThan(-1)
      const end = body.indexOf('\n}', start)
      const fnBody = body.slice(start, end)
      expect(fnBody, `${fn} ignores latitude`).toMatch(/-\s*lat\b/)
    }
  })

  it('transcribes the same four projection formulas as the WGSL', () => {
    // A rough structural check: the constants that appear in each formula must
    // appear in both sources. This will not catch a wrong sign, which is what
    // gate C is for -- it catches the case where one file was edited and the
    // other was not edited at all.
    const wgsl = PANORAMA_WGSL
    const glsl = PANORAMA_GLSL_FRAGMENT
    for (const token of ['TWO_PI', 'HALF_PI', '0.5', '2.0']) {
      expect(wgsl).toContain(token)
      expect(glsl).toContain(token)
    }
    // Both must use the two-argument arctangent for the same three call sites.
    expect((wgsl.match(/atan2\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
    expect((glsl.match(/atan\(/g) ?? []).length).toBeGreaterThanOrEqual(5)
  })
})
```

- [ ] **Step 3: 跑测试**

Run: `npm run test:unit -- webgl2-shaders`
Expected: 6 个测试 PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/webgl2/shaders/ test/unit/webgl2-shaders.test.ts
git commit -m "feat(renderer): GLSL ES 3.00 transcription of the panorama shader

Transcribed by hand: the two languages are far enough apart that a
translator would be its own project, and a subtly wrong translator is worse
than two files a human can read side by side. Gate C is what keeps them
from drifting."
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
    // The canvas is composited by the page; letting the browser discard the
    // drawing buffer means a read-back after a frame may see it cleared.
    preserveDrawingBuffer: false,
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
stored null as its program and drew nothing for its whole lifetime."
```

---

### Task 3: `WebGL2Backend`

**Files:**
- Create: `src/renderer/webgl2/backend.ts`
- Modify: `src/viewer/backend-factory.ts`
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
 * everything into one 96-byte block with tight scalar packing; here each value
 * goes to its own named uniform. A shared UBO would mean std140, where every
 * scalar occupies a 16-byte slot -- a different layout, not a shared one.
 *
 * The structural difference that does NOT exist is depth. Both matrices are
 * built by core/matrix.ts with the backend's own depth convention, and both
 * conventions put the far plane at ndc z = +1, so the fragment shader is
 * identical in both.
 */

import { mat4 } from 'gl-matrix'
import { buildCameraTransform } from '../../core/matrix'
import type { CameraState, Projection } from '../../core/types'
import type { Backend, Capabilities } from '../backend'
import type { SourceState } from '../../media/source'
import { acquireContext, compileShader, linkProgram } from './context'
import { PANORAMA_GLSL_FRAGMENT, PANORAMA_GLSL_VERTEX } from './shaders'
import { cameraProjectionCode, textureProjectionCode } from '../../core/constants'

export class WebGL2Backend implements Backend {
  readonly kind = 'webgl2' as const
  readonly capabilities: Capabilities

  readonly #canvas: HTMLCanvasElement
  readonly #gl: WebGL2RenderingContext
  readonly #program: WebGLProgram
  readonly #uniforms: Record<string, WebGLUniformLocation | null>
  readonly #invClip = mat4.create()
  readonly #clip = mat4.create()
  #texture: WebGLTexture | undefined
  #textureVersion = -1
  #disposed = false

  private constructor (canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.#canvas = canvas
    this.#gl = gl
    this.#program = program
    this.capabilities = {
      backend: 'webgl2',
      // WebGL2's guaranteed minimum is well below WebGPU's; ask the driver.
      maxTextureDimension: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      // No WebGL2 equivalent of importExternalTexture.
      externalTextures: false
    }

    this.#uniforms = {}
    for (const name of [
      'u_invClip', 'u_projKind', 'u_texProjKind',
      'u_povLatitude', 'u_povLongitude', 'u_zoom', 'u_tex'
    ]) {
      const location = gl.getUniformLocation(program, name)
      // A null location means the uniform was optimized out or misspelled. The
      // gl.uniform* call is then silently ignored and the value stays zero, so
      // the picture is wrong in a way that reads as a projection bug. Fail here
      // instead, where the message can say which name.
      if (location === null && name !== 'u_tex') {
        throw new Error(`uniform ${name} not found in the linked program`)
      }
      this.#uniforms[name] = location
    }
  }

  /**
   * Creates a backend, or returns `null` when WebGL2 is unavailable.
   *
   * @throws If WebGL2 is available but the shader will not compile or link.
   *   Those are bugs in this package, not a property of the device, and
   *   reporting them as "no backend" would hide them.
   */
  static create (canvas: HTMLCanvasElement): WebGL2Backend | null {
    const gl = acquireContext(canvas)
    if (!gl) return null

    const vertex = compileShader(gl, gl.VERTEX_SHADER, PANORAMA_GLSL_VERTEX, 'vertex')
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, PANORAMA_GLSL_FRAGMENT, 'fragment')
    const program = linkProgram(gl, vertex, fragment)

    return new WebGL2Backend(canvas, gl, program)
  }

  setCamera (state: CameraState, projection: Projection): void {
    const gl = this.#gl
    // depth: 'gl' -- WebGL2's ndc z is [-1, 1]. The WebGPU backend passes 'zo'.
    // This one argument is the entire depth-convention difference between the
    // two backends.
    buildCameraTransform(state, projection, 'gl', this.#clip)
    mat4.invert(this.#invClip, this.#clip)

    gl.useProgram(this.#program)
    gl.uniformMatrix4fv(this.#uniforms.u_invClip!, false, this.#invClip)
    gl.uniform1ui(this.#uniforms.u_projKind!, cameraProjectionCode(projection))
    gl.uniform1f(this.#uniforms.u_povLatitude!, state.povLatitude)
    gl.uniform1f(this.#uniforms.u_povLongitude!, state.povLongitude)
    gl.uniform1f(this.#uniforms.u_zoom!, projection.kind === 'linear' ? 1 : projection.zoom)
  }

  setSource (source: SourceState | null): void {
    const gl = this.#gl

    if (!source) {
      this.#texture = undefined
      this.#textureVersion = -1
      return
    }

    gl.uniform1ui(this.#uniforms.u_texProjKind!, textureProjectionCode(source.projection))

    // WebGL2 has no external textures, so every source goes through a copy. The
    // version check is still worth having: a still image uploads once.
    const needsUpload = this.#texture === undefined || this.#textureVersion !== source.version
    if (!needsUpload) return

    if (!this.#texture) this.#texture = gl.createTexture() ?? undefined
    if (!this.#texture) throw new Error('could not allocate a texture object')

    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.element)
    // No power-of-two requirement in WebGL2 either, so a plain clamp + linear
    // is correct at any size. The legacy path could not use these because
    // WebGL1 restricts NPOT textures to NEAREST + CLAMP_TO_EDGE.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.#textureVersion = source.version
  }

  render (): void {
    const gl = this.#gl
    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (!this.#texture) return

    gl.useProgram(this.#program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.uniform1i(this.#uniforms.u_tex!, 0)
    // Three vertices, no attributes bound, no index buffer. gl_VertexID does
    // the work.
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  resize (cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    if (this.#canvas.width !== width) this.#canvas.width = width
    if (this.#canvas.height !== height) this.#canvas.height = height
  }

  dispose (): void {
    if (this.#disposed) return
    this.#disposed = true
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

```ts
export async function createBackend (canvas: HTMLCanvasElement): Promise<Backend> {
  const webgpu = await WebGPUBackend.create(canvas)
  if (webgpu) return webgpu

  const webgl2 = WebGL2Backend.create(canvas)
  if (webgl2) return webgl2

  throw new Error(
    'no usable rendering backend: neither WebGPU nor WebGL2 is available in this browser'
  )
}
```

- [ ] **Step 3: 冒烟测试**

`test/integration/webgl2-smoke.test.ts`：

```ts
import { test, expect } from './support/fixtures'

test('creates a WebGL2 backend and renders a non-empty frame', async ({ gpuPage }) => {
  const r = await gpuPage.evaluate(async () => {
    const t = (window as unknown as { __panoTest: any }).__panoTest
    return t.webgl2Smoke()
  })
  expect(r.maxTextureDimension).toBeGreaterThanOrEqual(2048)
  expect(r.externalTextures).toBe(false)
  expect(r.nonBlackFraction).toBeGreaterThan(0.5)
})

test('a shader that will not compile throws rather than yielding a dead backend', async ({ gpuPage }) => {
  // The legacy path returned null here and the viewer reported success.
  const message = await gpuPage.evaluate(async () => {
    const t = (window as unknown as { __panoTest: any }).__panoTest
    try { t.createBackendWithSource('void main(){ this is not glsl }'); return '' }
    catch (e) { return String(e) }
  })
  expect(message).toMatch(/failed to compile/i)
})

test('repeated create/dispose does not exhaust the context limit', async ({ gpuPage }) => {
  // Browsers cap live WebGL contexts (commonly at 16). WEBGL_lose_context is
  // what releases one immediately; without it, the 17th viewer silently fails.
  const r = await gpuPage.evaluate(async () => {
    const t = (window as unknown as { __panoTest: any }).__panoTest
    return t.createDisposeLoop(20)
  })
  expect(r.failures).toBe(0)
})
```

- [ ] **Step 4: 跑测试**

Run: `npm run test:integration -- webgl2-smoke`
Expected: 3 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/webgl2/backend.ts src/viewer/backend-factory.ts test/integration/webgl2-smoke.test.ts
git commit -m "feat(renderer): WebGL2 backend as the fallback path

Named uniforms rather than a shared UBO: std140 gives every scalar its own
16-byte slot, so forcing a common layout would leave neither backend with
the layout it wants. Releases the context on dispose, which the legacy
cleanGL never did."
```

---

### Task 4: 门禁 C —— 跨后端一致性

**Files:**
- Test: `test/integration/gate-c-cross-backend.test.ts`

**门禁 C 的问题**：两份手写的着色器，四个投影，**它们会不会悄悄漂开？**

- [ ] **Step 1: 写测试**

```ts
import { test, expect } from './support/fixtures'
import { maxChannelDiff } from './support/gpu'

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

const CAMERAS = ['linear', 'cylindrical', 'planet', 'pannini'] as const
const STATES = [
  { povLatitude: 0, povLongitude: 0, zoom: 1 },
  { povLatitude: 30, povLongitude: 45, zoom: 1 },
  { povLatitude: -60, povLongitude: 180, zoom: 1 },
  { povLatitude: 10, povLongitude: 300, zoom: 0.5 }
] as const

test.describe('gate C: WebGPU vs WebGL2', () => {
  for (const camera of CAMERAS) {
    for (const [index, state] of STATES.entries()) {
      test(`${camera} / state ${index}`, async ({ gpuPage }) => {
        const r = await gpuPage.evaluate(async ([c, s]) => {
          const t = (window as unknown as { __panoTest: any }).__panoTest
          return t.renderBothBackends(c, s)
        }, [camera, state] as const)

        expect(maxChannelDiff(r.webgpu, r.webgl2)).toBeLessThanOrEqual(2)
      })
    }
  }

  test('the CPU reference agrees with both, so a disagreement has an arbiter', async ({ gpuPage }) => {
    // If this test ever fails while the others pass, the two backends are
    // consistently wrong together -- which is the failure mode gate C cannot
    // see on its own.
    const r = await gpuPage.evaluate(async () => {
      const t = (window as unknown as { __panoTest: any }).__panoTest
      return t.renderBothBackendsVsReference('linear', { povLatitude: 30, povLongitude: 45, zoom: 1 })
    })
    // The CPU path is float64 and the shaders are float32; ~1e-5 in float terms
    // is a couple of 8-bit steps in the worst case.
    expect(Math.abs(r.referenceVsWebgpu)).toBeLessThanOrEqual(3)
    expect(Math.abs(r.referenceVsWebgl2)).toBeLessThanOrEqual(3)
  })

  test('the poles are the documented exception', async ({ gpuPage }) => {
    // Near latitude +/-90 the equirectangular mapping compresses the entire
    // longitude range into a few pixels, so a tiny difference in the
    // computation of atan2 lands many texels apart. The tolerance is relaxed
    // there on purpose; this test pins that it is still bounded rather than
    // unbounded.
    const r = await gpuPage.evaluate(async () => {
      const t = (window as unknown as { __panoTest: any }).__panoTest
      return t.renderBothBackends('linear', { povLatitude: 89.5, povLongitude: 0, zoom: 1 })
    })
    const diff = maxChannelDiff(r.webgpu, r.webgl2)
    // Not equal, but not garbage: a broken implementation gives a uniform
    // difference across the whole frame, not a bounded one.
    expect(diff).toBeLessThan(64)
  })
})
```

- [ ] **Step 2: 跑门禁 C**

Run: `npm run test:integration -- gate-c`
Expected: 18 条全 PASS

**失败分流的顺序很重要**，别跳步：

| 现象 | 先做什么 |
|---|---|
| 单一相机、全部状态都差 | 该相机的公式转写错了。**拿 `src/core/reference.ts` 当裁判** —— 跑三份，谁不一样谁错 |
| 全部相机、只有某一状态差 | 差的是矩阵构造（`buildCameraTransform` 的 `depth` 参数），不是公式 |
| 差值是整幅均匀的常数 | UV 的偏置或缩放错了（`to_uv` 里的 `+0.5`） |
| 只在极点附近差 | 这是**已知且已放宽**的。**先确认差值有界（< 64），再确认不是整幅差** |
| 图像整体翻转 | WebGL 的 `UNPACK_FLIP_Y_WEBGL`，或顶点顺序 |

**不要为了让门禁 C 变绿而放宽容差。** 如果 ±2 不够，先搞清楚为什么 —— 放宽到 ±8 只是把一个真实的转写错误变成一条永远绿不了又没人管的测试。

- [ ] **Step 3: Commit**

```bash
git add test/integration/gate-c-cross-backend.test.ts
git commit -m "test(renderer): gate C -- the two hand-written shaders must agree

Comparing the backends against each other rather than each against the
baseline, because a mistake made in both transcriptions would pass a
baseline comparison. The CPU reference is the arbiter when they disagree."
```

---

### Task 5: 用户故事在 WebGL2 下重跑

**Files:**
- Test: `test/integration/webgl2-user-stories.spec.ts`

**这是后端替换的验收方式** —— 同一批用户故事，换个后端。

- [ ] **Step 1: 写测试**

```ts
import { test, expect } from './support/fixtures'

/*
 * Every P5 user story, re-run with the backend forced to WebGL2.
 *
 * This is what "the second backend works" means. Not "the shader compiles", not
 * "a frame is non-empty" -- the same user-facing behaviours, through the same
 * code, on the other implementation.
 *
 * The stories are not rewritten here. `createImageViewer` takes a `forceBackend`
 * option that the test harness sets; production code never sets it.
 */

test.use({ forceBackend: 'webgl2' })

test.describe('US1: view a 360 photo (WebGL2)', () => {
  test('renders and reports load', async ({ gpuPage }) => { /* same body as P5 US1 */ })
  test('dragging changes the image', async ({ gpuPage }) => { /* */ })
  test('PTZ = false leaves it static', async ({ gpuPage }) => { /* */ })
  test('renders sharply on a high-DPI display', async ({ gpuPage }) => { /* */ })
})

test.describe('US2: play a 360 video (WebGL2)', () => {
  test('plays and advances frames', async ({ gpuPage }) => { /* */ })
  test('autoplay is muted by default', async ({ gpuPage }) => { /* */ })
  test('zoom changes the rendering for a non-linear camera', async ({ gpuPage }) => { /* */ })
})

test.describe('US3: switch camera models (WebGL2)', () => {
  for (const kind of ['linear', 'cylindrical', 'planet', 'pannini'] as const) {
    test(`switches to ${kind} and keeps the pose`, async ({ gpuPage }) => { /* */ })
  }
})

test.describe('US4: media fails to load (WebGL2)', () => {
  test('a 404 image emits media-error', async ({ gpuPage }) => { /* */ })
  test('the viewer keeps rendering after a source error', async ({ gpuPage }) => { /* */ })
})

test.describe('US5: backend selection', () => {
  test('capabilities report webgl2 and no external textures', async ({ gpuPage }) => {
    // An application that branches on capabilities must get the truth. A
    // webgl2 backend advertising externalTextures would send callers down a
    // path this backend cannot serve.
    const caps = await gpuPage.evaluate(async () => {
      const t = (window as unknown as { __panoTest: any }).__panoTest
      const v = await t.createImageViewer({ src: '/fixtures/panorama.png', forceBackend: 'webgl2' })
      const c = v.capabilities
      v.dispose()
      return c
    })
    expect(caps.backend).toBe('webgl2')
    expect(caps.externalTextures).toBe(false)
  })
})
```

> **不要把这些测试体复制粘贴一遍就完事。** 能抽成共用 helper 的抽出来（`test/integration/support/stories.ts`），两个 spec 文件都调它。**同一段逻辑抄两遍，第二遍就会漂。**

- [ ] **Step 2: 跑全部**

Run: `npm run test:unit && npm run test:integration`
Expected: 全 PASS（WebGPU 与 WebGL2 两套）

- [ ] **Step 3: Commit**

```bash
git add test/integration/webgl2-user-stories.spec.ts test/integration/support/stories.ts
git commit -m "test(renderer): run every user story against the WebGL2 backend

Backend replacement is verified by behaviour, not by a smoke test. The
story bodies are shared helpers so the two specs cannot drift."
```

---

## 完成标准

- [ ] 门禁 C 的 18 条全绿，容差未被放宽
- [ ] P5 的五个 User Story 在 WebGL2 下全绿（共用 helper，无复制粘贴）
- [ ] `capabilities.backend === 'webgl2'` 且 `externalTextures === false`
- [ ] 着色器编译失败会抛异常，不返回死后端
- [ ] 连续创建/销毁 20 个后端不耗尽上下文额度
- [ ] **`src/index.ts` 的导出面与 P5 一致**（后端替换不改变公开 API）

## 明确的非目标

- **不为 WebGL2 做性能优化。** 它是降级路径。
- **不加 WebGL2 独有的能力探测维度。**
- **不把两份着色器合并成一个生成器。** 转写 + 门禁 C 是当前的取舍；如果哪天两份漂得太频繁，再考虑生成器，那时它才是有依据的。
