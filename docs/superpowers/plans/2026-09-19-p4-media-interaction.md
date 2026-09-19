# P4 — media + interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 素材源与交互两块，各自独立可测。图片和视频走同一条读取路径；所有 DOM 监听由 `AbortController` 收口。

**Architecture:** `media/` 把 `<img>`/`<video>` 包成 `MediaSource`，对外只暴露一个带版本号的快照；`interaction/` 把指针输入识别成语义事件，自己不碰相机。

**Tech Stack:** Pointer Events · `AbortController` · `OffscreenCanvas` · Playwright

---

## 前置说明：两条不在计划里但必须知道的结论

**1. `EventEmitter` / `Disposable` 是 foundation 层，却写在本计划里。**
它们第一个消费者是 media，但依赖方向上是纯底层（不依赖 `core/` 以外任何东西）。**上榜时 layer 填 `foundation`，deps 为空** —— 不要让它们去等 P4 的其它卡。

**2. 旧代码的「2 的幂」约束在 WebGPU 下消失了。**
`Renderer.updateTextureObject` 用 `gl.RGB` + `LINEAR` + 无 mipmap + **无 `CLAMP_TO_EDGE`**，所以源必须 2 的幂且与画布区域等大（这正是 demo 只提供 2048/4096/8192 的原因）。**WebGPU 没有任何 2 的幂要求** —— `rgba8unorm` 配 `linear` 过滤与 `clamp-to-edge` 对任意尺寸都成立。

**所以：不要移植 `frameSize` 那套「源超标就过中间画布」的逻辑。** 新设计只在**超过 `maxTextureDimension2D`** 时才缩放，与 2 的幂无关。这一条会删掉一整类代码和 demo 的素材限制。

**由此得到本层的两条硬约束，后面每一步都受它约束：**

1. **`src/media/` 里不存在任何叫 `frameSize` 的选项、参数或字段**，也不要再造一个同义词（`size`、`targetSize` 之类）。「源太大该怎么办」的答案由**后端**给出 —— 后端是唯一知道 `Capabilities.maxTextureDimension` 的地方，素材层只负责把它算成上传尺寸（`planDownscale`）。
2. **`SourceState` 由 `core` 定义，本层只组合它，不重新定义。** `core` 是两个后端都认可的那一层，且按设计不碰 DOM；媒体元素、帧计数器这类 DOM 侧的东西属于本层自己的类型。另起一个同形状的 `SourceState` 会是一个**结构上的近似副本**，它能编译通过，直到有人改了其中一份 —— 而且 P3 的 `Backend.setSource` 收的是 core 的 `SourceState`，P6 的 `WebGL2Backend implements Backend` 会因此对不上。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/core/events.ts` | `EventEmitter<M>` + `Disposable` |
| `src/media/source.ts` | `MediaSource` 接口、`MediaFrame`（组合 core 的 `SourceState`）、媒体事件列表 |
| `src/media/image-source.ts` | `<img>` 实现 |
| `src/media/video-source.ts` | `<video>` 实现；**不含**上传路径选择，那要读 device，是后端的 |
| `src/media/downscale.ts` | 超限时的缩放，与素材类型无关 |
| `src/interaction/input-controller.ts` | 指针监听、`AbortController`、语义事件 |
| `src/interaction/gestures.ts` | 拖拽 / 滚轮 / 双指捏合的纯函数识别 |
| `test/unit/gestures.test.ts` | 手势识别（纯函数，好测） |
| `test/unit/events.test.ts` | 事件系统 |
| `test/integration/image-source.test.ts` / `video-source.test.ts` | 源的生命周期、事件、监听器计数 |
| `test/integration/video-orientation.test.ts` | 两条上传路径的朝向一致性 |
| `test/integration/support/upload-paths.ts` | 上一条的探针：自建 device，直接驱动两个浏览器 API |
| `test/integration/ptz.test.ts` | 交互端到端 |

---

## 测试入口需要导出什么

集成测试跑在真实浏览器里，通过 `window.__panoTest` 拿被测对象。这个出口由 P3 的 `demo/test-entry.ts` 提供，**从 `demo/test-entry-hooks/*.ts` 目录聚合**：每个阶段往目录里丢自己的文件，谁都不用改 `test-entry.ts`（P4 与 P6 都依赖 P3，改同一个文件必然冲突，所以那条路 P3 已经堵死了）。

**所以本计划要做的是新增两个 hook 文件，而不是重新赋值 `window.__panoTest`。** 后者会把 P3 的 `renderOffscreen` 整个覆盖掉：

```ts
// demo/test-entry-hooks/media.ts
import { ImageSource } from '../../src/media/image-source'
import { VideoSource } from '../../src/media/video-source'

declare global {
  // Merges into the interface P3 opened. Global interfaces merge by name, so
  // there is no import and no registration step to forget.
  interface PanoTestApi {
    // Task 3 / Task 4 的源生命周期测试
    ImageSource: typeof ImageSource
    VideoSource: typeof VideoSource
  }
}

export default { ImageSource, VideoSource } satisfies Partial<PanoTestApi>
```

```ts
// demo/test-entry-hooks/input.ts
import { InputController } from '../../src/interaction/input-controller'
import { WheelDeltaMode } from '../../src/interaction/wheel-delta-mode'

declare global {
  interface PanoTestApi {
    InputController: typeof InputController
    // WheelDeltaMode 也要导出：gestures.ts 把 deltaMode 的数字重述了一遍
    // （好让纯函数在 Node 里能测），那串数字要和浏览器对得上，而唯一能拿到
    // 真 WheelEvent 的地方是浏览器里。
    WheelDeltaMode: typeof WheelDeltaMode
  }
}

export default { InputController, WheelDeltaMode } satisfies Partial<PanoTestApi>
```

**不要往生产入口 `src/index.ts` 上挂内部符号。** 测试要什么就从 hook 目录走（P3 也这么要求）。`test/integration/support/upload-paths.ts` 是例外：它自己在页面里建 device，**不经过这个出口**。

**测试里直接写 `window.__panoTest`，不要 `as unknown as` 再抄一遍签名** —— 抄一遍就是第二真源，而全局声明存在的意义就是让「页面提供了什么」和「测试拿了什么」由同一份声明约束。P3 已把两套 tsconfig 都配好收 `demo/`，类型在这里是通的。

---

### Task 1: 事件系统与 `Disposable`

**Files:**
- Create: `src/core/events.ts`
- Test: `test/unit/events.test.ts`

- [ ] **Step 1: 写失败测试**

`test/unit/events.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter, Disposable } from '../../src/core/events'

interface FakeEvents extends Record<string, unknown> {
  ping: { n: number }
  pong: { s: string }
}

class Emitter extends EventEmitter<FakeEvents> {
  firePing (n: number): void { this.emit('ping', { n }) }
}

describe('EventEmitter', () => {
  it('delivers the payload to a listener', () => {
    const e = new Emitter()
    const fn = vi.fn()
    e.on('ping', fn)
    e.firePing(3)
    expect(fn).toHaveBeenCalledWith({ n: 3 })
  })

  it('returns an unsubscribe function that works', () => {
    // The return value is the point: `off(type, fn)` requires the caller to
    // keep the exact function reference, and the usual leak is a listener
    // registered with an inline arrow that nobody can name at teardown time.
    const e = new Emitter()
    const fn = vi.fn()
    const off = e.on('ping', fn)
    off()
    e.firePing(1)
    expect(fn).not.toHaveBeenCalled()
  })

  it('unsubscribing twice is harmless', () => {
    const e = new Emitter()
    const off = e.on('ping', vi.fn())
    off()
    expect(() => off()).not.toThrow()
  })

  it('a listener that unsubscribes during dispatch does not break the others', () => {
    // Iterating the live array would skip the next listener after a removal.
    const e = new Emitter()
    const order: string[] = []
    const offA = e.on('ping', () => { order.push('a'); offA() })
    e.on('ping', () => order.push('b'))
    e.firePing(1)
    e.firePing(2)
    expect(order).toEqual(['a', 'b', 'b'])
  })

  it('off() removes only the given listener', () => {
    const e = new Emitter()
    const a = vi.fn()
    const b = vi.fn()
    e.on('ping', a)
    e.on('ping', b)
    e.off('ping', a)
    e.firePing(1)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('wildcard listeners receive the type alongside the payload', () => {
    // The legacy `trigger('*')` is kept, but typed: the handler is told which
    // event it is looking at, so it does not have to sniff the payload shape.
    const e = new Emitter()
    const seen: Array<[string, unknown]> = []
    e.on('*', (type, evt) => seen.push([type, evt]))
    e.firePing(7)
    expect(seen).toEqual([['ping', { n: 7 }]])
  })

  it('keeps event types separate', () => {
    const e = new Emitter()
    const pong = vi.fn()
    e.on('pong', pong)
    e.firePing(1)
    expect(pong).not.toHaveBeenCalled()
  })

  it('removeAllListeners clears everything including wildcards', () => {
    const e = new Emitter()
    const fn = vi.fn()
    e.on('ping', fn)
    e.on('*', fn)
    e.removeAllListeners()
    e.firePing(1)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('Disposable', () => {
  class Res extends Disposable {
    disposed = 0
    override dispose (): void { this.disposed++; super.dispose() }
  }

  it('runs dispose exactly once', () => {
    // Idempotence is load-bearing: dispose is reachable from the public API and
    // from device-loss handling, and both can fire.
    const r = new Res()
    r.dispose()
    r.dispose()
    expect(r.disposed).toBe(1)
  })

  it('reports its state', () => {
    const r = new Res()
    expect(r.isDisposed).toBe(false)
    r.dispose()
    expect(r.isDisposed).toBe(true)
  })

  it('assertAlive throws after disposal and is a no-op before', () => {
    // ~8 public boundaries call this. It is not a decorator on 100 members:
    // the internal async paths that actually cause use-after-dispose
    // (a rAF callback reaching a dead renderer) never touch a public member.
    const r = new Res()
    expect(() => r.assertAlive()).not.toThrow()
    r.dispose()
    expect(() => r.assertAlive()).toThrow(/disposed/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- events`
Expected: FAIL —— 无法解析 `../../src/core/events`

- [ ] **Step 3: 实现**

`src/core/events.ts`：

```ts
/**
 * Typed events, and a disposal contract that is visible in the type system.
 *
 * Both replace decorator machinery from the legacy codebase. The legacy
 * `@eventable` added untyped on/off/trigger to four classes, and `@disposable`
 * added dispose() to four more without giving the type system any way to know
 * it had been added.
 */

/** Maps event names to their payload types. */
export type EventMap = Record<string, unknown>

/** A wildcard listener is told the type as well as the payload. */
export type WildcardListener<M extends EventMap> = <K extends keyof M & string>(
  type: K,
  event: M[K]
) => void

/**
 * A minimal typed event emitter.
 *
 * Two deliberate differences from the legacy Eventable:
 *
 * - `on()` returns its own unsubscribe function. The common listener leak is a
 *   handler registered as an inline arrow, which cannot be named at teardown
 *   time; returning the remover makes the correct thing easier than the wrong
 *   thing.
 * - Dispatch iterates a copy, so a listener that unsubscribes during dispatch
 *   does not cause the following listener to be skipped.
 */
export class EventEmitter<M extends EventMap> {
  #listeners = new Map<keyof M & string, Set<(event: never) => void>>()
  #wildcards = new Set<WildcardListener<M>>()

  /**
   * Subscribes to an event, or to `'*'` for every event.
   *
   * @returns A function that removes this subscription. Safe to call twice.
   */
  on<K extends keyof M & string> (type: K, fn: (event: M[K]) => void): () => void
  on (type: '*', fn: WildcardListener<M>): () => void
  on (type: string, fn: (...args: never[]) => void): () => void {
    if (type === '*') {
      const wildcard = fn as unknown as WildcardListener<M>
      this.#wildcards.add(wildcard)
      return () => { this.#wildcards.delete(wildcard) }
    }

    let set = this.#listeners.get(type)
    if (!set) {
      set = new Set()
      this.#listeners.set(type, set)
    }
    set.add(fn as (event: never) => void)
    return () => { this.off(type as keyof M & string, fn as (event: never) => void) }
  }

  /** Removes one subscription. Unknown type/function pairs are ignored. */
  off<K extends keyof M & string> (type: K, fn: (event: M[K]) => void): void {
    const set = this.#listeners.get(type)
    if (!set) return
    set.delete(fn as (event: never) => void)
    if (set.size === 0) this.#listeners.delete(type)
  }

  /** Removes every subscription, including wildcards. */
  removeAllListeners (): void {
    this.#listeners.clear()
    this.#wildcards.clear()
  }

  /**
   * Dispatches an event.
   *
   * Public, and deliberately so. The classes that fire events here (a source, a
   * viewer) *hold* an emitter rather than extending one, so a `protected`
   * modifier would make their own emitter unreachable -- TypeScript checks
   * protected access against the class doing the accessing, and a composing
   * class is not a subclass.
   *
   * What actually keeps events unforgeable is ownership, not the modifier: the
   * emitter instance is a private field of its owner, and `on()` hands out only
   * the unsubscribe function. Nothing outside the owner ever holds the emitter,
   * so nothing outside the owner can call this.
   */
  emit<K extends keyof M & string> (type: K, event: M[K]): void {
    // Copy before iterating. A listener that unsubscribes would otherwise
    // mutate the Set mid-iteration and skip its neighbour.
    const set = this.#listeners.get(type)
    if (set) {
      for (const fn of [...set]) (fn as (event: M[K]) => void)(event)
    }
    for (const fn of [...this.#wildcards]) fn(type, event)
  }
}

/**
 * Base class for anything with a lifetime.
 *
 * Subclasses override `dispose`, do their own teardown, and call `super.dispose()`
 * last. The base is idempotent, so a double dispose -- reachable from both the
 * public API and from device-loss handling -- runs teardown once.
 */
export abstract class Disposable {
  #disposed = false

  /** True once `dispose()` has run. */
  get isDisposed (): boolean { return this.#disposed }

  /**
   * Throws if this object has been disposed.
   *
   * Called at public boundaries -- roughly eight places, not a hundred. The
   * legacy `@undisposed` guarded every member, but the use-after-dispose that
   * actually happens is internal: a rAF callback reaching a dead renderer, a
   * media event reaching a dead texture. Those paths never touch a public
   * member, so guarding every public member bought a layer of protection in the
   * wrong place at the cost of a hundred wrapped functions.
   */
  assertAlive (): void {
    if (this.#disposed) {
      throw new Error(`${this.constructor.name} has been disposed`)
    }
  }

  /** Releases resources. Idempotent. */
  dispose (): void {
    this.#disposed = true
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- events`
Expected: 11 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts test/unit/events.test.ts
git commit -m "feat(core): typed events and an explicit disposal contract

Replaces @eventable and @disposable. on() returns its own unsubscribe
function, so the common leak -- a handler registered as an inline arrow
that nobody can name at teardown -- stops being the path of least
resistance."
```

---

### Task 2: `MediaSource` 接口与统一读取路径

**Files:**
- Create: `src/media/source.ts`
- Create: `src/media/downscale.ts`
- Test: `test/unit/downscale.test.ts`

- [ ] **Step 1: 写失败测试**

`test/unit/downscale.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { planDownscale } from '../../src/media/downscale'

describe('planDownscale', () => {
  it('passes a source that fits straight through', () => {
    expect(planDownscale(1920, 1080, 8192)).toEqual({ scale: 1, width: 1920, height: 1080 })
  })

  it('scales down a source that exceeds the limit', () => {
    const plan = planDownscale(16384, 8192, 8192)
    expect(plan.width).toBeLessThanOrEqual(8192)
    expect(plan.height).toBeLessThanOrEqual(8192)
    expect(plan.scale).toBeLessThan(1)
  })

  it('preserves aspect ratio', () => {
    const plan = planDownscale(16384, 8192, 8192)
    expect(plan.width / plan.height).toBeCloseTo(2, 2)
  })

  it('does NOT quantise to powers of two', () => {
    // The legacy path required power-of-two sources because it used gl.RGB with
    // LINEAR filtering, no mipmaps and no CLAMP_TO_EDGE. WebGPU has no such
    // requirement, so rounding to 4096 here would throw away real resolution
    // for a constraint that no longer exists.
    const plan = planDownscale(10000, 5000, 8192)
    expect(plan.width).toBe(8192)
    expect(plan.height).toBe(4096)
  })

  it('never rounds a dimension down to zero', () => {
    // A 1-pixel-tall panorama is absurd but must not become a zero-sized
    // texture, which is a WebGPU validation error rather than a blank frame.
    const plan = planDownscale(16384, 1, 8192)
    expect(plan.height).toBeGreaterThanOrEqual(1)
    expect(plan.width).toBeGreaterThanOrEqual(1)
  })

  it('scales a source that is over on one axis only', () => {
    const plan = planDownscale(9000, 100, 8192)
    expect(plan.width).toBe(8192)
    expect(plan.height).toBeGreaterThanOrEqual(1)
  })

  it('rejects a zero-sized source rather than guessing', () => {
    // Video elements report 0x0 before metadata loads. Passing that through as
    // "fits, no scaling needed" produces a texture creation failure later,
    // far from the cause.
    expect(() => planDownscale(0, 0, 8192)).toThrow(/zero/i)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- downscale`
Expected: FAIL —— 无法解析 `../../src/media/downscale`

- [ ] **Step 3: 实现 downscale**

`src/media/downscale.ts`：

```ts
/**
 * Deciding when a media element is too large to upload as-is.
 *
 * The legacy equivalent was the `frameSize` option, which routed an oversized
 * source through an intermediate 2D canvas. It also carried a power-of-two
 * requirement inherited from WebGL1 -- the old upload path used gl.RGB with
 * LINEAR filtering, no mipmaps and no CLAMP_TO_EDGE, which requires the source
 * to be power-of-two and to match the canvas region exactly.
 *
 * WebGPU has no such requirement: rgba8unorm with linear filtering and
 * clamp-to-edge address mode is valid at any size. So there is no power-of-two
 * quantisation here, and an image that fits is uploaded untouched.
 */

/** How a source of the given size should be prepared for upload. */
export interface DownscalePlan {
  /** Multiplier to apply. 1 means upload as-is. */
  readonly scale: number
  readonly width: number
  readonly height: number
}

/**
 * Computes the upload size for a source.
 *
 * @param width - Source width in pixels.
 * @param height - Source height in pixels.
 * @param max - The device's `maxTextureDimension2D`.
 * @throws If either dimension is zero. Media elements report 0x0 before their
 *   metadata loads; treating that as "fits" defers the failure to texture
 *   creation, far from the actual cause.
 */
export function planDownscale (width: number, height: number, max: number): DownscalePlan {
  if (width <= 0 || height <= 0) {
    throw new RangeError(`source has a zero dimension: ${width}x${height}`)
  }

  if (width <= max && height <= max) {
    return { scale: 1, width, height }
  }

  const scale = Math.min(max / width, max / height)
  return {
    scale,
    // Round rather than floor toward powers of two: the limit is the only
    // constraint, and quantising would discard resolution for no reason.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}
```

- [ ] **Step 4: 实现接口**

`src/media/source.ts`：

```ts
/**
 * A media element wrapped so the renderer can consume it without knowing what
 * kind of element it is.
 *
 * The snapshot design matters for one specific reason: a video frame is only
 * valid inside the microtask that produced it. WebGPU's `importExternalTexture`
 * is destroyed at the end of the current task and a bind group holding one does
 * NOT keep it alive. So the renderer must never store the source beyond the
 * frame it is drawing, and the type says so -- a frame is a plain snapshot of
 * numbers plus the element reference, not a handle to GPU memory.
 */

import type { Disposable, EventMap } from '../core/events'
import type { SourceState } from '../core/types'
import type { RenderableSource } from '../renderer/backend'

/**
 * One frame of a source: core's upload description plus what only a media
 * element can tell you.
 *
 * **This type is `RenderableSource` from `src/renderer/backend.ts`.** It is
 * declared here as an alias, not as a second interface with the same four
 * members, and every source implementation's `frame` getter satisfies it
 * directly. That is what lets `Viewer` hand a frame to `backend.setSource`
 * with no conversion step.
 *
 * An earlier draft declared the four members again. A structurally identical
 * copy compiles -- and then drifts the first time either side gains a field.
 * The drift is invisible until someone swaps a source into a backend, because
 * before that the two types are never compared; a `type` alias makes the
 * comparison happen at the declaration instead.
 *
 * Why the fields are where they are: `state` is `SourceState` from `core/types`,
 * and `core` is DOM-free by construction, so the element and the frame counter
 * cannot live there. What `core` describes is the part every backend needs --
 * how the pixels are laid out and how big the upload is -- and the rest is the
 * DOM layer's.
 */
export type MediaFrame = RenderableSource

/** Events a source re-emits from its underlying element. */
export interface MediaEvents extends EventMap {
  'media-load': { target: unknown }
  'media-error': { target: unknown, error: unknown }
  'media-play': { target: unknown }
  'media-pause': { target: unknown }
  'media-ended': { target: unknown }
  'media-seeking': { target: unknown }
  'media-seeked': { target: unknown }
  'media-progress': { target: unknown }
}

/**
 * A source of pixels.
 *
 * Implementations own their DOM listeners and must remove all of them in
 * `dispose`. The `AbortController` pattern is the intended mechanism.
 */
export interface MediaSource extends Disposable {
  /** The current frame. Valid only for the duration of the current task. */
  readonly frame: MediaFrame
  /**
   * The element's natural size, before any downscaling.
   *
   * Separate from `frame.state.width`/`frame.state.height`, which are the
   * upload size. Interaction needs the display size; the renderer needs the
   * upload size.
   */
  readonly naturalSize: { readonly width: number, readonly height: number }
  /**
   * Subscribes to the events this source re-emits from its element.
   *
   * On the interface rather than only on the implementations: the viewer
   * forwards these to its own consumers, and it holds a `MediaSource`, so a
   * subscription it cannot see through the interface would push it towards a
   * cast or towards knowing the concrete class.
   */
  on<K extends keyof MediaEvents & string> (type: K, fn: (event: MediaEvents[K]) => void): () => void
  /**
   * Tells the source that a frame was just drawn from it.
   *
   * A video's pixels change with no event fine-grained enough to drive an
   * upload: `timeupdate` fires about four times a second, far too coarse for
   * 60fps. So the render loop ticks this after drawing and the version advances.
   *
   * On the interface, not only on `VideoSource`, so the render loop can tick
   * whatever source it holds without asking which kind it is. An image source
   * ignores it: its pixels change exactly once, on `load`, and that is where its
   * version bump lives.
   */
  markFramePresented (): void
}

/**
 * The DOM event names a source re-emits, mapped to the name it re-emits them
 * as. Shared so both implementations stay in step -- the legacy ImageProvider
 * and VideoProvider each carried their own list and they had already drifted.
 */
export const MEDIA_EVENT_MAP: ReadonlyArray<readonly [string, keyof MediaEvents & string]> = [
  ['load', 'media-load'],
  ['error', 'media-error'],
  ['play', 'media-play'],
  ['pause', 'media-pause'],
  ['ended', 'media-ended'],
  ['seeking', 'media-seeking'],
  ['seeked', 'media-seeked'],
  ['progress', 'media-progress']
] as const
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run test:unit -- downscale`
Expected: 7 个测试 PASS

- [ ] **Step 6: Commit**

```bash
git add src/media/source.ts src/media/downscale.ts test/unit/downscale.test.ts
git commit -m "feat(media): source snapshot interface and an upload-size planner

The legacy frameSize path inherited WebGL1's power-of-two requirement from
a gl.RGB/LINEAR/no-CLAMP_TO_EDGE upload. WebGPU has no such requirement, so
this only scales when the device limit is actually exceeded."
```

---

### Task 3: `ImageSource`

**Files:**
- Create: `src/media/image-source.ts`
- Test: `test/integration/image-source.test.ts`

- [ ] **Step 1: 写集成测试**

`test/integration/image-source.test.ts`：

```ts
import { test, expect } from './support/fixtures'

/*
 * Runs in a real browser because everything here is a DOM concern: when `load`
 * fires, what `naturalWidth` is before it, whether listeners actually come off.
 */

test('reports a zero size before the image loads, and throws if asked to upload', async ({ gpuPage }) => {
  // The failure this pins: a source that has not loaded looks like a 0x0 image,
  // and a 0x0 texture is a WebGPU validation error thrown far from the cause.
  const result = await gpuPage.evaluate(async () => {
    const { ImageSource } = window.__panoTest
    const src = new ImageSource('/fixtures/panorama.png')
    const before = { w: src.naturalSize.width, h: src.naturalSize.height }
    let threw = ''
    try { src.frame } catch (e) { threw = String(e) }
    src.dispose()
    return { before, threw }
  })
  expect(result.before).toEqual({ w: 0, h: 0 })
  expect(result.threw).toMatch(/not loaded/i)
})

test('becomes readable once the image loads', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { ImageSource } = window.__panoTest
    const src = new ImageSource('/fixtures/panorama.png')
    const loaded = new Promise(r => {
      const off = src.on('media-load', () => { off(); r('load') })
    })
    await loaded
    const frame = src.frame
    src.dispose()
    return {
      kind: frame.kind,
      w: frame.state.width,
      h: frame.state.height,
      version: frame.version
    }
  })
  expect(result.kind).toBe('image')
  expect(result.w).toBeGreaterThan(0)
  expect(result.h).toBeGreaterThan(0)
  expect(result.version).toBeGreaterThan(0)
})

test('re-emits the element error as media-error rather than throwing', async ({ gpuPage }) => {
  // A 404 must reach the application as an event. The legacy provider attached
  // an error listener that only logged, so an application had no way to show
  // "this image failed to load".
  const result = await gpuPage.evaluate(async () => {
    const { ImageSource } = window.__panoTest
    const src = new ImageSource('/fixtures/does-not-exist.png')
    return new Promise(resolve => {
      const off = src.on('media-error', () => { off(); resolve('media-error'); src.dispose() })
      setTimeout(() => resolve('timeout'), 5000)
    })
  })
  expect(result).toBe('media-error')
})

test('dispose aborts every DOM listener', async ({ gpuPage }) => {
  // Counted, not asserted by reading the source. The legacy code leaked three
  // listeners across four files precisely because nobody could see the count.
  const result = await gpuPage.evaluate(async () => {
    const { ImageSource } = window.__panoTest
    const src = new ImageSource('/fixtures/panorama.png')
    const before = (src as any).__listenerCount()
    src.dispose()
    return { before, after: (src as any).__listenerCount() }
  })
  expect(result.before).toBeGreaterThan(0)
  expect(result.after).toBe(0)
})
```

> `__listenerCount()` 是 `ImageSource` 自己的计数器，不是读 DOM。**加一个私有计数是有意的**：让「有没有漏摘」变成一条可断言的事实。`AbortController` 清掉监听器，计数器由 `signal.aborted` 的监听递减。

- [ ] **Step 2: 实现**

`src/media/image-source.ts`：

```ts
/**
 * An image source.
 *
 * Uploads exactly once. `version` starts at 0 and becomes 1 when the image
 * loads, so the renderer's "does this need uploading" question is answered by a
 * number that changes once, rather than by a latched flag that has to be
 * cleared by the consumer.
 */

import { Disposable, EventEmitter } from '../core/events'
import type { TextureProjection } from '../core/constants'
import { MEDIA_EVENT_MAP, type MediaEvents, type MediaSource, type MediaFrame } from './source'
import { planDownscale } from './downscale'

export class ImageSource extends Disposable implements MediaSource {
  readonly #events = new EventEmitter<MediaEvents>()
  readonly #element: HTMLImageElement
  readonly #abort = new AbortController()
  #listenerCount = 0
  #version = 0

  // TextureProjection from core/constants, not a re-typed 'equirectangular'
  // literal: the string is uploaded as `u_TexProjType` through
  // `textureProjectionCode`, so a second spelling of it here is a second thing
  // to keep in sync.
  readonly #projection: TextureProjection

  /**
   * @param url - Image URL.
   * @param options - Device limit and the source's texture projection.
   */
  constructor (url: string, options: { maxTextureDimension?: number, projection?: TextureProjection } = {}) {
    super()
    this.#element = new Image()
    // Required for reading the image into a WebGPU texture without tainting.
    this.#element.crossOrigin = 'anonymous'
    // 8192 is the WebGPU spec's guaranteed minimum for maxTextureDimension2D,
    // so it is always safe to assume. The viewer passes the real limit.
    this.#maxTextureDimension = options.maxTextureDimension ?? 8192
    this.#projection = options.projection ?? 'equirectangular'

    for (const [domName, eventName] of MEDIA_EVENT_MAP) {
      this.#listen(domName, eventName)
    }

    this.#element.src = url
  }

  readonly #maxTextureDimension: number

  #listen (domName: string, eventName: keyof MediaEvents & string): void {
    this.#listenerCount++
    this.#element.addEventListener(domName, (evt) => {
      // Every media event bumps the version. The renderer does not care which
      // one fired; it cares whether the pixels might have changed.
      if (eventName === 'media-load') this.#version++
      this.#events.emit(eventName, {
        target: this,
        error: eventName === 'media-error' ? new Error(`failed to load ${this.#element.src}`) : undefined
      })
    }, { signal: this.#abort.signal })
  }

  /** Subscribes to this source's re-emitted media events. */
  on<K extends keyof MediaEvents & string> (type: K, fn: (event: MediaEvents[K]) => void): () => void {
    return this.#events.on(type, fn)
  }

  get naturalSize (): { width: number, height: number } {
    return { width: this.#element.naturalWidth, height: this.#element.naturalHeight }
  }

  get frame (): MediaFrame {
    const { naturalWidth: w, naturalHeight: h } = this.#element
    if (w === 0 || h === 0) {
      // Throwing here rather than returning a 0x0 state keeps the failure at the
      // point of use. A 0x0 texture is a WebGPU validation error that surfaces
      // during texture creation, with nothing pointing back to "not loaded yet".
      throw new Error('image source is not loaded yet')
    }
    const plan = planDownscale(w, h, this.#maxTextureDimension)
    return {
      // The backend consumes this field and nothing else -- it is core's
      // SourceState, so `Backend.setSource` takes it without a conversion.
      state: { projection: this.#projection, width: plan.width, height: plan.height },
      kind: 'image',
      element: this.#element,
      version: this.#version
    }
  }

  /** The scale the current source would be uploaded at. 1 when it fits. */
  get uploadScale (): number {
    const { naturalWidth: w, naturalHeight: h } = this.#element
    if (w === 0 || h === 0) return 1
    return planDownscale(w, h, this.#maxTextureDimension).scale
  }

  /**
   * Nothing to do: an image's pixels change exactly once, on `load`, and that is
   * where `#version` is bumped. It exists because `MediaSource` declares it, so
   * the render loop can tick any source without knowing which kind it holds.
   */
  markFramePresented (): void {
    // Intentionally empty. See the TSDoc above.
  }

  override dispose (): void {
    if (this.isDisposed) return
    // One call removes every listener registered with this signal. The legacy
    // providers paired addEventListener/removeEventListener by hand across four
    // files, and three pairs had already come apart.
    this.#abort.abort()
    this.#listenerCount = 0
    this.#events.removeAllListeners()
    // Release the decoded image. Without this, a viewer that swapped sources
    // keeps the previous image's decoded bitmap alive.
    this.#element.src = ''
    super.dispose()
  }
}
```

- [ ] **Step 3: 跑测试**

Run: `npm run test:integration -- image-source`
Expected: 4 个测试 PASS

- [ ] **Step 4: Commit**

```bash
git add src/media/image-source.ts test/integration/image-source.test.ts
git commit -m "feat(media): image source with abortable listeners and a load-state guard"
```

---

### Task 4: `VideoSource` 与 external texture 策略

**Files:**
- Create: `src/media/video-source.ts`
- Test: `test/integration/video-source.test.ts`

**背景 —— 两条上传路径的取舍：**

| | `importExternalTexture` | `copyExternalImageToTexture` |
|---|---|---|
| 拷贝 | 无 | 一次 |
| 生命周期 | **当前微任务结束即失效** | 稳定 |
| bind group 能续命吗 | **不能** | 能 |
| `flipY` | **不支持** | 支持 |
| WGSL 采样 | `textureSampleBaseClampToEdge` | `textureSample` |
| 可用性 | 需要 `chromium` / 完整浏览器 | 到处都有 |

**这条选择落在后端，不落在本层。** P3 的 `WebGPUBackend` 按**源的类型**选路径：视频走 `importExternalTexture`，图片走 `copyExternalImageToTexture`；设备能不能做 external texture，由 `Capabilities.externalTextures` 报告给应用。所以：

1. **`VideoSourceOptions` 上没有 `uploadPath`。** 本层做不了这个决定（它没有 device），加一个选项就是给一个只有一个投票人的问题再塞一张票 —— 而且投错了**不会报错**：两条路径都出画，只是画面在某些设备上倒过来。
2. **两条路径的朝向必须一致，这是那个「一次 shader 翻转同时修好两条路径」的前提。** P3 把 flip 放在 shader 的 `to_uv` 里，两条路径共用 —— 这个做法只有在**两个浏览器 API 的行序本来就一致**时才成立（`importExternalTexture` 根本没有 `flipY` 可选，所以一旦不一致，没有任何一个 shader 翻转能同时修好两条）。这是一个经验断言，Step 3 的探针就是它的证据。
3. **外加上限：external texture 导入失败时视频不能静默冻住。** P3 的 `render()` 目前对视频无条件 import，没有回落分支 —— 见本计划末尾「留给 P3 的一处依赖」。

- [ ] **Step 1: 写集成测试**

`test/integration/video-source.test.ts`：

```ts
import { test, expect } from './support/fixtures'

test('reports a zero size before metadata loads', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { VideoSource } = window.__panoTest
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    const before = src.naturalSize
    let threw = ''
    try { src.frame } catch (e) { threw = String(e) }
    src.dispose()
    return { before, threw }
  })
  expect(result.before).toEqual({ width: 0, height: 0 })
  expect(result.threw).toMatch(/metadata/i)
})

test('version advances when the render loop ticks the source', async ({ gpuPage }) => {
  // This is what drives per-frame re-upload. If it does not advance, a playing
  // video renders its first frame forever.
  //
  // The tick comes from the render loop and not from a DOM event, because no
  // event is fine-grained enough -- so that is what the test does. The end-to-end
  // half (a playing video whose drawn pixels actually change) is P5's video user
  // story; this pins the source's side of the contract.
  const result = await gpuPage.evaluate(async () => {
    const { VideoSource } = window.__panoTest
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    await new Promise(r => { const off = src.on('media-load', () => { off(); r(null) }) })
    await src.play()
    const a = src.frame.version
    for (let i = 0; i < 3; i++) src.markFramePresented()
    const b = src.frame.version
    src.dispose()
    return { a, b }
  })
  expect(result.b).toBeGreaterThan(result.a)
})

test('hands out a fresh frame instead of a cached one', async ({ gpuPage }) => {
  // The hazard: importExternalTexture's result is destroyed when the task that
  // made it ends, and a bind group holding it does NOT keep it alive, so a
  // source that memoised its frame would hand the renderer a value describing a
  // task that is already over.
  //
  // Asserted here as the source-side property that makes the GPU behaviour safe
  // -- no caching. The GPU half (a stale external texture is a validation error)
  // is a backend concern and is pinned by P3's tests.
  const result = await gpuPage.evaluate(async () => {
    const { VideoSource } = window.__panoTest
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    await new Promise(r => { const off = src.on('media-load', () => { off(); r(null) }) })
    const a = src.frame
    const b = src.frame
    src.markFramePresented()
    const c = src.frame
    src.dispose()
    return { cached: a === b, advanced: c.version > a.version, sameElement: a.element === b.element }
  })
  expect(result.cached).toBe(false)
  expect(result.advanced).toBe(true)
  expect(result.sameElement).toBe(true)
})

test('dispose stops the element and removes every listener', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { VideoSource } = window.__panoTest
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    await new Promise(r => { const off = src.on('media-load', () => { off(); r(null) }) })
    await src.play()
    src.dispose()
    return { paused: src.element.paused, listeners: (src as any).__listenerCount() }
  })
  expect(result.paused).toBe(true)
  expect(result.listeners).toBe(0)
})
```

- [ ] **Step 2: 实现**

`src/media/video-source.ts`：

```ts
/**
 * A video source.
 *
 * Two things make this the hardest file in the media layer:
 *
 * 1. A video frame is only valid inside the microtask that produced it.
 *    `importExternalTexture` returns a texture the browser destroys as soon as
 *    the task ends. A bind group holding it does not extend its life, and there
 *    is no error until it is used. So the renderer must consume `frame` within
 *    the task it was read in, and this class must never hand out a cached one.
 *
 * 2. There are two upload paths and no `flipY` on the fast one. The slow path
 *    supports flipY; the fast one does not. Since the sampler's v axis runs the
 *    same way for both, and both sources are top-left origin, neither should be
 *    flipped -- but that is an empirical claim, and
 *    `test/integration/video-orientation.test.ts` is what checks it.
 *
 * Neither point produces an option on this class. **Which upload path is used
 * is the backend's decision**, not the source's: the backend is the only thing
 * that has a device, and therefore the only thing that can tell whether
 * `Capabilities.externalTextures` holds. An `uploadPath` option here would be a
 * second vote on a question with one voter -- and the wrong vote would be
 * silent, because both paths render.
 */

import { Disposable, EventEmitter } from '../core/events'
import type { TextureProjection } from '../core/constants'
import { MEDIA_EVENT_MAP, type MediaEvents, type MediaSource, type MediaFrame } from './source'
import { planDownscale } from './downscale'

export interface VideoSourceOptions {
  readonly maxTextureDimension: number
  /** How the video's pixels are laid out. A property of the source, not the camera. */
  readonly projection?: TextureProjection
  /** `autoplay`, `loop`, `muted` -- passed through to the element. */
  readonly autoplay?: boolean
  readonly loop?: boolean
  readonly muted?: boolean
}

export class VideoSource extends Disposable implements MediaSource {
  readonly #events = new EventEmitter<MediaEvents>()
  readonly #element: HTMLVideoElement
  readonly #abort = new AbortController()
  readonly #options: VideoSourceOptions
  #listenerCount = 0
  #version = 0

  constructor (url: string, options: VideoSourceOptions) {
    super()
    this.#options = options
    this.#element = document.createElement('video')
    this.#element.crossOrigin = 'anonymous'
    this.#element.playsInline = true
    if (options.autoplay) this.#element.autoplay = true
    if (options.loop) this.#element.loop = true
    // Muted by default: an unmuted autoplay is blocked by every modern browser,
    // so the legacy default of playing with sound produced a video that simply
    // never started.
    this.#element.muted = options.muted ?? true

    for (const [domName, eventName] of MEDIA_EVENT_MAP) {
      this.#listen(domName, eventName)
    }
    // `loadedmetadata` is what makes naturalWidth/naturalHeight meaningful, and
    // it is not in the shared map because images have no equivalent.
    this.#listen('loadedmetadata', 'media-load')
    this.#listen('timeupdate', 'media-progress')

    this.#element.src = url
  }

  #listen (domName: string, eventName: keyof MediaEvents & string): void {
    this.#listenerCount++
    this.#element.addEventListener(domName, () => {
      if (eventName === 'media-load') this.#version++
      this.#events.emit(eventName, {
        target: this,
        // A failed video load must reach the application as a value it can show,
        // not as a log line. Same reasoning as ImageSource.
        error: eventName === 'media-error' ? new Error(`failed to load ${this.#element.src}`) : undefined
      })
    }, { signal: this.#abort.signal })
  }

  /**
   * Bumps the version on every drawn frame.
   *
   * Called by the render loop rather than driven by an event: there is no DOM
   * event for "a new frame is ready to sample", and `timeupdate` fires only
   * about four times a second -- far too coarse to drive a 60fps upload. A
   * paused video therefore re-uploads at the draw rate; the renderer's frame
   * rate cap is what bounds that cost.
   */
  markFramePresented (): void {
    this.#version++
  }

  on<K extends keyof MediaEvents & string> (type: K, fn: (event: MediaEvents[K]) => void): () => void {
    return this.#events.on(type, fn)
  }

  /**
   * The underlying element, for lifecycle inspection -- `paused`, current time,
   * and the like.
   *
   * Not the render path's way in: the renderer reads `frame.element`, so that
   * the element always arrives inside the snapshot that also carries `version`
   * and the upload size. Two ways to reach the element would mean two chances to
   * read it outside the task that made it valid.
   */
  get element (): HTMLVideoElement {
    return this.#element
  }

  get naturalSize (): { width: number, height: number } {
    return { width: this.#element.videoWidth, height: this.#element.videoHeight }
  }

  get frame (): MediaFrame {
    const { videoWidth: w, videoHeight: h } = this.#element
    if (w === 0 || h === 0) {
      // `HAVE_NOTHING`/`HAVE_METADATA` report 0x0. Creating a texture from that
      // is a validation error whose message says nothing about metadata.
      throw new Error('video source metadata has not loaded yet')
    }
    const plan = planDownscale(w, h, this.#options.maxTextureDimension)
    return {
      state: {
        projection: this.#options.projection ?? 'equirectangular',
        width: plan.width,
        height: plan.height
      },
      kind: 'video',
      element: this.#element,
      version: this.#version
    }
  }

  async play (): Promise<void> {
    this.assertAlive()
    await this.#element.play()
  }

  pause (): void {
    this.#element.pause()
  }

  override dispose (): void {
    if (this.isDisposed) return
    this.#abort.abort()
    this.#listenerCount = 0
    this.#events.removeAllListeners()
    // Stop decoding and release the network. Without pause() first, removing
    // the src leaves a video that keeps buffering in the background.
    this.#element.pause()
    this.#element.removeAttribute('src')
    this.#element.load()
    super.dispose()
  }
}
```

- [ ] **Step 3: 补一条朝向一致性测试**

这一条**直接驱动两个浏览器 API，不经过 pano.gl 的后端**。理由是测试要问的问题本来就与我们的代码无关 —— 「`importExternalTexture`（没有 `flipY` 选项）和 `copyExternalImageToTexture`（`flipY: false`）把帧的行序放成一样吗」。后端自己的测试看不见这个差异：**两条路径各自自洽**，各自渲染都对，只是彼此相反；而 P3 的 shader 只翻转一次、两条路径共用，所以一旦相反就是必错其一。

`test/integration/support/upload-paths.ts`：

```ts
/*
 * Renders one video frame through both WebGPU upload paths, offscreen, and
 * returns both readbacks.
 *
 * Deliberately not built on pano.gl's backend. The question is about the two
 * browser APIs, and the backend cannot answer it: each upload path is
 * self-consistent, so a backend test that only ever exercises the path its
 * device happens to support sees nothing wrong. The disagreement only shows up
 * when both paths render the same frame -- which is what P3's single shared
 * flip in `to_uv` assumes cannot happen.
 *
 * Nothing here is re-exported to the library; it is test scaffolding.
 */

import type { Page } from '@playwright/test'

/** One upload path's output: RGBA8, top-down, row-major. */
export interface PathRender {
  readonly width: number
  readonly height: number
  readonly rgba: number[]
}

/*
 * The vertex stage is shared by both paths on purpose. Both readbacks are then
 * produced by the same uv mapping into the same top-down layout, which is what
 * makes the comparison a measurement of the APIs rather than of the probe:
 * clip y=+1 maps to uv.y=0, and readback row 0 is v=0.
 *
 * The vertex stage and the fragment stage go into ONE module per path. WGSL
 * structs are module-scope, so a fragment module that only declares `fs` would
 * not know `VOut` -- plenty of WebGPU samples get away with two modules because
 * their fragment stage takes `@builtin(position)` instead.
 */
const VERTEX = `
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs (@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[i];
  var out: VOut;
  out.pos = vec4f(xy, 0.0, 1.0);
  out.uv = vec2f((xy.x + 1.0) * 0.5, (1.0 - xy.y) * 0.5);
  return out;
}
`

const FRAGMENT_EXTERNAL = `
@group(0) @binding(0) var src: texture_external;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs (in: VOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(src, samp, in.uv);
}
`

const FRAGMENT_COPY = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs (in: VOut) -> @location(0) vec4f {
  return textureSample(src, samp, in.uv);
}
`

/**
 * Uploads one paused frame of `url` through each path and reads both back.
 *
 * @param page - The page, which must have WebGPU enabled.
 * @param url - Video URL, same-origin so the external texture is not tainted.
 * @param size - Square render size. 64 keeps the readback's bytesPerRow at the
 *   256-byte alignment `copyTextureToBuffer` demands.
 */
export async function renderVideoBothPaths (
  page: Page,
  url: string,
  size = 64
): Promise<{ external: PathRender, copy: PathRender }> {
  return page.evaluate(async ({ url, size }) => {
    const adapter = await navigator.gpu.requestAdapter()
    if (adapter === null) throw new Error('no WebGPU adapter')
    const device = await adapter.requestDevice()

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.src = url
    // `loadeddata`, not `loadedmetadata`: metadata describes the size while
    // `loadeddata` is the first event that guarantees there is a frame to
    // sample. A paused frame is also what makes the two paths comparable --
    // there is exactly one frame in play, so a difference is orientation rather
    // than timing.
    await new Promise((resolve, reject) => {
      video.addEventListener('loadeddata', resolve, { once: true })
      video.addEventListener('error', () => reject(new Error(`video failed: ${url}`)), { once: true })
    })
    video.pause()

    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    const target = device.createTexture({
      size: [size, size],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC
    })
    const bytesPerRow = size * 4
    const readback = device.createBuffer({
      size: bytesPerRow * size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    })

    const pipeline = (fragment: string): GPURenderPipeline => {
      const shaderModule = device.createShaderModule({ code: `${VERTEX}\n${fragment}` })
      return device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shaderModule, entryPoint: 'vs' },
        fragment: { module: shaderModule, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
        primitive: { topology: 'triangle-list' }
      })
    }

    const readTarget = async (): Promise<number[]> => {
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [size, size])
      device.queue.submit([encoder.finish()])
      await readback.mapAsync(GPUMapMode.READ)
      const rgba = Array.from(new Uint8Array(readback.getMappedRange()))
      readback.unmap()
      return rgba
    }

    const draw = (pipe: GPURenderPipeline, entries: GPUBindGroupEntry[]): void => {
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: target.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }]
      })
      pass.setPipeline(pipe)
      pass.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }))
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    }

    // Path 1: importExternalTexture. No flipY exists on this path, so whatever
    // row order it produces is the row order everything else has to live with.
    //
    // Import, bind, draw and submit happen in one synchronous stretch with no
    // `await` between them, because the external texture is destroyed when this
    // task ends. The awaits that follow are after the submit, which is safe.
    const externalPipe = pipeline(FRAGMENT_EXTERNAL)
    draw(externalPipe, [
      { binding: 0, resource: device.importExternalTexture({ source: video }) },
      { binding: 1, resource: sampler }
    ])
    const external = await readTarget()

    // Path 2: copyExternalImageToTexture. `flipY: false` is the claim under test:
    // it should agree with the external path, because that is the value P3's
    // backend passes and the value no single shader flip can compensate for if
    // the two APIs disagreed.
    const copied = device.createTexture({
      size: [size, size],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
    })
    device.queue.copyExternalImageToTexture({ source: video, flipY: false }, { texture: copied }, [size, size])
    draw(pipeline(FRAGMENT_COPY), [
      { binding: 0, resource: copied.createView() },
      { binding: 1, resource: sampler }
    ])
    const copy = await readTarget()

    // A uniform frame is useless as a probe: the test would pass on a black
    // screen. The fixture's first frame must have a top and a bottom.
    const distinct = new Set<number>()
    for (let i = 0; i < external.length; i += 4) distinct.add(external[i]! + external[i + 1]! * 256)

    return {
      external: { width: size, height: size, rgba: external },
      copy: { width: size, height: size, rgba: copy },
      distinct
    }
  }, { url, size }).then((r) => {
    if (r.distinct.size < 2) {
      throw new Error('the fixture frame is uniform; orientation cannot be judged from it')
    }
    return { external: r.external, copy: r.copy }
  })
}
```

`test/integration/video-orientation.test.ts`：

```ts
import { test, expect } from './support/fixtures'
import { maxChannelDiff } from './support/gpu'
import { renderVideoBothPaths } from './support/upload-paths'

/*
 * The two upload paths must agree on orientation.
 *
 * importExternalTexture has no flipY option; copyExternalImageToTexture does.
 * If they disagree, a browser that falls back to the copy path renders the
 * video upside down relative to one that uses external textures -- a bug that
 * only appears on some devices and looks like a shader problem.
 */
test('external and copy upload paths produce the same orientation', async ({ gpuPage }) => {
  const result = await renderVideoBothPaths(gpuPage, '/fixtures/clip.mp4')
  expect(maxChannelDiff(result.external.rgba, result.copy.rgba)).toBeLessThanOrEqual(2)
})
```

- [ ] **Step 4: 跑测试**

Run: `npm run test:integration -- video-source video-orientation`
Expected: 全 PASS

**`video-orientation` 失败时**：**不要直接给 copy 路径加 `flipY: true` 试**。先确认是**哪一条**需要翻 —— 把读回按行切成上下两半，看哪一条是倒的（探针里的 `distinct` 检查保证测试帧上下不对称，否则这条判断无从做起）。翻错了就是把对的翻成错的。若最终必须翻，改动落在**后端**（`WebGPUBackend` 的 copy 路径），不在本层。

- [ ] **Step 5: Commit**

```bash
git add src/media/video-source.ts test/integration/video-source.test.ts test/integration/video-orientation.test.ts test/integration/support/upload-paths.ts
git commit -m "feat(media): video source that never caches a frame

A video frame is valid only inside the task that produced it, and a bind
group holding an external texture does not keep it alive. The two upload
paths also disagree about flipY, so orientation is pinned by a probe that
drives both browser APIs directly rather than assumed."
```

---

### Task 5: `InputController`

**Files:**
- Create: `src/interaction/gestures.ts`
- Create: `src/interaction/input-controller.ts`
- Test: `test/unit/gestures.test.ts`
- Test: `test/integration/ptz.test.ts`

- [ ] **Step 1: 写手势识别的单元测试**

手势识别做成**纯函数**，这样它可以在 Node 里测：

> **纯的一个前提是它不碰浏览器全局。** vitest 的 `environment` 是 `node`（P1），所以 `WheelEvent` 在这里不存在 —— 常量取自本模块导出的 `WheelDeltaMode`，而不是 `WheelEvent.DOM_DELTA_*`。真实 `WheelEvent` 是否仍与这些数字一致，由 `InputController` 的集成测试在浏览器里验证。

`test/unit/gestures.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { classifyWheel, classifyPinch, classifyDrag, WheelZoom, WheelDeltaMode } from '../../src/interaction/gestures'

describe('classifyWheel', () => {
  it('maps a line-mode wheel delta to a zoom step', () => {
    expect(classifyWheel({ deltaY: -3, deltaMode: WheelDeltaMode.LINE })).toBeCloseTo(0.3, 5)
  })

  it('normalises pixel-mode deltas, which are an order of magnitude larger', () => {
    // A trackpad reports pixels and a mouse wheel reports lines. Feeding both
    // through the same divisor makes one of them unusable: this is why the
    // legacy zoom was violent on a trackpad and sluggish on a mouse.
    const pixel = classifyWheel({ deltaY: -100, deltaMode: WheelDeltaMode.PIXEL })
    const line = classifyWheel({ deltaY: -3, deltaMode: WheelDeltaMode.LINE })
    expect(Math.sign(pixel)).toBe(Math.sign(line))
    expect(Math.abs(pixel / line)).toBeLessThan(3)
  })

  it('treats page-mode deltas as lines', () => {
    expect(classifyWheel({ deltaY: -3, deltaMode: WheelDeltaMode.PAGE }))
      .toBeCloseTo(0.3, 5)
  })

  it('is antisymmetric', () => {
    const down = classifyWheel({ deltaY: 100, deltaMode: WheelDeltaMode.PIXEL })
    const up = classifyWheel({ deltaY: -100, deltaMode: WheelDeltaMode.PIXEL })
    expect(down).toBeCloseTo(-up, 6)
  })

  it('returns zero for a zero delta', () => {
    expect(classifyWheel({ deltaY: 0, deltaMode: WheelDeltaMode.PIXEL })).toBe(0)
  })

  it('clamps an absurd single-event delta', () => {
    // Some drivers emit a single deltaY of several thousand on a flick. Without
    // a clamp the panorama jumps a full revolution.
    const huge = classifyWheel({ deltaY: -100000, deltaMode: WheelDeltaMode.PIXEL })
    expect(Math.abs(huge)).toBeLessThanOrEqual(WheelZoom.MAX_STEP)
  })
})

describe('classifyPinch', () => {
  it('reports no zoom for an unchanged distance', () => {
    expect(classifyPinch(100, 100)).toBe(0)
  })

  it('zooms in when fingers separate', () => {
    expect(classifyPinch(100, 200)).toBeGreaterThan(0)
  })

  it('zooms out when fingers converge', () => {
    expect(classifyPinch(200, 100)).toBeLessThan(0)
  })

  it('is antisymmetric in log space', () => {
    // Ratio, not difference: a pinch from 100 to 200 px should feel the same as
    // 200 to 400, which a subtractive measure gets wrong.
    expect(classifyPinch(100, 200)).toBeCloseTo(-classifyPinch(200, 100), 6)
  })

  it('ignores the first move of a gesture', () => {
    // previous = 0 means the second finger has just landed. Producing a jump
    // here is the classic "pinch snaps the zoom" bug.
    expect(classifyPinch(0, 150)).toBe(0)
  })
})

describe('classifyDrag', () => {
  it('converts a pixel delta to surface degrees', () => {
    const d = classifyDrag({ deltaX: 100, deltaY: 50 }, { width: 1000, height: 500 })
    expect(d.lng).toBeCloseTo(-36, 5)
    expect(d.lat).toBeCloseTo(-18, 5)
  })

  it('reverses the sign of the drag, because the scene moves with the finger', () => {
    // Dragging right must turn the camera left. Getting this backwards makes
    // the panorama feel like it is fighting the user, and it is a coin flip
    // every time it is reimplemented.
    const d = classifyDrag({ deltaX: 100, deltaY: 0 }, { width: 1000, height: 500 })
    expect(d.lng).toBeLessThan(0)
  })

  it('returns zero for a zero-size surface instead of dividing by zero', () => {
    // Happens for real: a viewer constructed into a display:none container has
    // width 0, and 100/0 is Infinity, which becomes a NaN matrix and a black
    // frame with no error anywhere.
    expect(classifyDrag({ deltaX: 10, deltaY: 10 }, { width: 0, height: 0 }))
      .toEqual({ lat: 0, lng: 0 })
  })

  it('scales with surface size, so the same drag is the same visual angle', () => {
    const small = classifyDrag({ deltaX: 100, deltaY: 0 }, { width: 500, height: 500 })
    const large = classifyDrag({ deltaX: 100, deltaY: 0 }, { width: 1000, height: 500 })
    expect(Math.abs(small.lng)).toBeCloseTo(Math.abs(large.lng) * 2, 5)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- gestures`
Expected: FAIL —— 无法解析 `../../src/interaction/gestures`

- [ ] **Step 3: 实现手势识别**

`src/interaction/gestures.ts`：

```ts
/**
 * Turning raw input deltas into camera movements.
 *
 * Everything here is a pure function so it can be tested without a browser.
 * The legacy plugins mixed recognition with listener management and DOM state,
 * which is why none of their thresholds were testable and several were wrong
 * (a trackpad and a mouse wheel went through the same divisor).
 */

/** Wheel normalisation constants, exported so the tests can assert against them. */
export const WheelZoom = {
  /** One notch of a line-mode wheel. */
  LINES_PER_NOTCH: 3,
  /** Zoom step per notch. */
  STEP_PER_NOTCH: 0.3,
  /**
   * Pixels per notch. Trackpads report pixels and mice report lines; without
   * this conversion the same gesture is an order of magnitude apart between the
   * two devices.
   */
  PIXELS_PER_NOTCH: 100,
  /** Largest zoom change a single event may produce. */
  MAX_STEP: 1
} as const

/**
 * `WheelEvent.deltaMode` values.
 *
 * Restated rather than read off the global, because this module is pure and is
 * tested in Node -- where `WheelEvent` does not exist. The numbers are fixed by
 * the UI Events spec, and `InputController`'s integration test is what checks
 * that the real `WheelEvent` still agrees with them.
 */
export const WheelDeltaMode = {
  PIXEL: 0,
  LINE: 1,
  PAGE: 2
} as const

/** A wheel event's relevant fields. */
export interface WheelInput {
  readonly deltaY: number
  readonly deltaMode: number
}

/**
 * Converts a wheel event to a zoom delta.
 *
 * @returns A signed zoom step, clamped to +/- `WheelZoom.MAX_STEP`. Positive is
 *   zoom in.
 */
export function classifyWheel (input: WheelInput): number {
  if (input.deltaY === 0) return 0

  const notches = input.deltaMode === WheelDeltaMode.PIXEL
    ? input.deltaY / WheelZoom.PIXELS_PER_NOTCH
    : input.deltaY / WheelZoom.LINES_PER_NOTCH
  // Page mode reports whole pages, which is coarse enough to treat as lines.

  const step = -notches * WheelZoom.STEP_PER_NOTCH
  // Some drivers emit a deltaY in the thousands on a single flick. Without a
  // clamp, one event spins the panorama a full revolution.
  return Math.max(-WheelZoom.MAX_STEP, Math.min(WheelZoom.MAX_STEP, step))
}

/**
 * Converts a two-finger distance change to a zoom delta.
 *
 * @param previous - Previous pointer distance. Zero means the gesture just
 *   started, which yields no delta -- producing one is the classic "pinch snaps
 *   the zoom on the first move" bug.
 * @param current - Current pointer distance.
 */
export function classifyPinch (previous: number, current: number): number {
  if (previous <= 0 || current <= 0) return 0
  // A ratio, not a difference: 100->200 px must feel identical to 200->400.
  const ratio = Math.log(current / previous)
  return Math.max(-WheelZoom.MAX_STEP, Math.min(WheelZoom.MAX_STEP, ratio))
}

/** A drag gesture in CSS pixels. */
export interface DragInput {
  readonly deltaX: number
  readonly deltaY: number
}

/** The surface the drag happened on, in CSS pixels. */
export interface SurfaceSize {
  readonly width: number
  readonly height: number
}

/**
 * Converts a drag to a camera rotation in degrees.
 *
 * The sign is inverted throughout: the scene follows the finger, so dragging
 * right turns the camera left. This is a coin flip every time it is
 * reimplemented, hence the test.
 *
 * @returns `{ lat, lng }` in degrees. Both are zero for a zero-sized surface,
 *   which happens for real when the container is `display: none` -- dividing by
 *   zero there produces an infinite angle, then a NaN matrix, then a black
 *   frame with no error reported anywhere.
 */
export function classifyDrag (delta: DragInput, surface: SurfaceSize): { lat: number, lng: number } {
  if (surface.width <= 0 || surface.height <= 0) return { lat: 0, lng: 0 }
  return {
    lng: -(delta.deltaX / surface.width) * 360,
    lat: -(delta.deltaY / surface.height) * 180
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- gestures`
Expected: 15 个测试 PASS

- [ ] **Step 5: 实现 `InputController`**

`src/interaction/input-controller.ts`：

```ts
/**
 * Pointer input for a viewer element.
 *
 * Uses Pointer Events rather than separate mouse and touch paths: one code path
 * covers mouse, touch, and pen, and multi-touch comes through as multiple
 * pointer ids rather than a separate `TouchEvent` API.
 *
 * Every listener is registered with a single AbortController, so disposal is
 * one call. The legacy code spread listeners across Delegate, ZoomPlugin,
 * PanPlugin and both providers, and three pairs had already come apart.
 *
 * Two behaviours worth knowing before editing:
 *
 * - `touch-action: none` is set on the element. Pointer Events cannot deliver
 *   reliable multi-touch while the browser is also panning the page, and there
 *   is no way to express "only for this gesture" -- it is all or nothing. This
 *   is a visible side effect on an element the caller owns, so the previous
 *   value is saved and restored on dispose.
 * - `preventDefault()` is NOT called on every handler. With `touch-action` set,
 *   it is unnecessary, and calling it on pointer events can suppress unrelated
 *   behaviour such as focus and text selection.
 */

import { Disposable, EventEmitter, type EventMap } from '../core/events'
import { classifyDrag, classifyPinch, classifyWheel, type SurfaceSize } from './gestures'

export interface InputEvents extends EventMap {
  pan: { deltaX: number, deltaY: number }
  zoom: { delta: number }
}

export class InputController extends Disposable {
  readonly #events = new EventEmitter<InputEvents>()
  readonly #element: HTMLElement
  readonly #abort = new AbortController()
  readonly #previousTouchAction: string
  /** Active pointers, in the order they went down. */
  readonly #pointers = new Map<number, { x: number, y: number }>()
  #previousPinchDistance = 0
  #ptzEnabled = true

  constructor (element: HTMLElement) {
    super()
    this.#element = element
    this.#previousTouchAction = element.style.touchAction
    element.style.touchAction = 'none'

    const signal = this.#abort.signal
    element.addEventListener('pointerdown', this.#onPointerDown, { signal })
    element.addEventListener('pointermove', this.#onPointerMove, { signal })
    element.addEventListener('pointerup', this.#onPointerUp, { signal })
    element.addEventListener('pointercancel', this.#onPointerUp, { signal })
    element.addEventListener('wheel', this.#onWheel, { signal, passive: false })
  }

  /**
   * Enables or disables pan-tilt-zoom.
   *
   * Disabling short-circuits the handlers but leaves the listeners bound, which
   * is the legacy behaviour: rebinding on every toggle would make the toggle
   * itself a source of leaks.
   */
  get PTZ (): boolean { return this.#ptzEnabled }
  set PTZ (value: boolean) { this.#ptzEnabled = value }

  on<K extends keyof InputEvents & string> (type: K, fn: (event: InputEvents[K]) => void): () => void {
    return this.#events.on(type, fn)
  }

  #onPointerDown = (evt: PointerEvent): void => {
    if (!this.#ptzEnabled) return
    // Capture so the gesture survives the pointer leaving the element, which is
    // the normal case for a drag that reaches the edge of the viewer.
    this.#element.setPointerCapture(evt.pointerId)
    this.#pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
    this.#previousPinchDistance = 0
  }

  #onPointerMove = (evt: PointerEvent): void => {
    if (!this.#ptzEnabled) return
    const previous = this.#pointers.get(evt.pointerId)
    if (!previous) return

    this.#pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })

    if (this.#pointers.size === 1) {
      this.#events.emit('pan', {
        deltaX: evt.clientX - previous.x,
        deltaY: evt.clientY - previous.y
      })
      return
    }

    if (this.#pointers.size === 2) {
      const distance = this.#pinchDistance()
      const delta = classifyPinch(this.#previousPinchDistance, distance)
      this.#previousPinchDistance = distance
      if (delta !== 0) this.#events.emit('zoom', { delta })
    }
  }

  #onPointerUp = (evt: PointerEvent): void => {
    this.#pointers.delete(evt.pointerId)
    this.#previousPinchDistance = 0
    if (this.#element.hasPointerCapture(evt.pointerId)) {
      this.#element.releasePointerCapture(evt.pointerId)
    }
  }

  #onWheel = (evt: WheelEvent): void => {
    if (!this.#ptzEnabled) return
    const delta = classifyWheel(evt)
    if (delta === 0) return
    // preventDefault is called here and only here: without it the page scrolls
    // while the panorama zooms. Note the listener is registered with
    // `passive: false`, which is required for preventDefault to have any effect.
    evt.preventDefault()
    this.#events.emit('zoom', { delta })
  }

  #pinchDistance (): number {
    const [a, b] = [...this.#pointers.values()]
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  /** Converts a drag to a rotation. Exposed so the viewer can apply its own scaling. */
  dragToRotation (deltaX: number, deltaY: number, surface: SurfaceSize): { lat: number, lng: number } {
    return classifyDrag({ deltaX, deltaY }, surface)
  }

  override dispose (): void {
    if (this.isDisposed) return
    this.#abort.abort()
    this.#pointers.clear()
    this.#events.removeAllListeners()
    // Restore what the caller's element looked like before we touched it. A
    // viewer that took over touch-action and did not give it back would leave
    // the host page unable to scroll over that element after disposal.
    this.#element.style.touchAction = this.#previousTouchAction
    super.dispose()
  }
}
```

- [ ] **Step 6: 写交互的集成测试**

`test/integration/ptz.test.ts`：

```ts
import { test, expect } from './support/fixtures'

test('dragging pans the camera and emits pan events', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { InputController } = window.__panoTest
    const el = document.createElement('div')
    Object.assign(el.style, { width: '400px', height: '300px', position: 'fixed', top: '0px' })
    document.body.appendChild(el)
    const input = new InputController(el)
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    input.on('pan', e => pans.push(e))

    el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 150, clientY: 130, bubbles: true }))
    el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 150, clientY: 130, bubbles: true }))
    input.dispose()
    return pans
  })
  expect(result).toEqual([{ deltaX: 50, deltaY: 30 }])
})

test('PTZ = false stops the events without unbinding', async ({ gpuPage }) => {
  // Toggling must not rebind listeners; rebinding on every toggle is itself a
  // leak source. So the assertion is both "no events" and "re-enabling works".
  const result = await gpuPage.evaluate(async () => {
    const { InputController } = window.__panoTest
    const el = document.createElement('div')
    document.body.appendChild(el)
    const input = new InputController(el)
    let count = 0
    input.on('pan', () => count++)

    const send = (x: number) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: 0, clientY: 0, bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: 0, bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: 0, bubbles: true }))
    }

    send(10)
    const afterEnabled = count
    input.PTZ = false
    send(20)
    const afterDisabled = count
    input.PTZ = true
    send(30)
    const afterReenabled = count
    input.dispose()
    return { afterEnabled, afterDisabled, afterReenabled }
  })
  expect(result.afterEnabled).toBe(1)
  expect(result.afterDisabled).toBe(1)
  expect(result.afterReenabled).toBe(2)
})

test('the wheel constants still match the real WheelEvent', async ({ gpuPage }) => {
  // gestures.ts restates deltaMode's numbers instead of reading the global, so
  // that it stays testable in Node. This is the other half of that trade: the
  // restated values are checked against the browser's.
  const result = await gpuPage.evaluate(async () => {
    const { WheelDeltaMode } = window.__panoTest
    return {
      pixel: WheelDeltaMode.PIXEL === WheelEvent.DOM_DELTA_PIXEL,
      line: WheelDeltaMode.LINE === WheelEvent.DOM_DELTA_LINE,
      page: WheelDeltaMode.PAGE === WheelEvent.DOM_DELTA_PAGE
    }
  })
  expect(result).toEqual({ pixel: true, line: true, page: true })
})

test('dispose restores touch-action', async ({ gpuPage }) => {
  // The viewer sets touch-action: none on an element it does not own. Leaving
  // it set would stop the host page from scrolling over that element forever.
  const result = await gpuPage.evaluate(async () => {
    const { InputController } = window.__panoTest
    const el = document.createElement('div')
    el.style.touchAction = 'pan-y'
    document.body.appendChild(el)
    const input = new InputController(el)
    const during = el.style.touchAction
    input.dispose()
    return { during, after: el.style.touchAction }
  })
  expect(result.during).toBe('none')
  expect(result.after).toBe('pan-y')
})
```

- [ ] **Step 7: 跑全部**

Run: `npm run test:unit && npm run test:integration`
Expected: 全 PASS

- [ ] **Step 8: Commit**

```bash
git add src/interaction/ test/unit/gestures.test.ts test/integration/ptz.test.ts
git commit -m "feat(interaction): pointer input with gesture recognition as pure functions

Recognition is separated from listener management so the thresholds are
testable -- the legacy plugins mixed the two, which is why a trackpad and a
mouse wheel went through the same divisor. All listeners share one
AbortController, and the element's touch-action is restored on dispose."
```

---

## 完成标准

- [ ] 图片和视频都不存在「未加载就被上传」的路径（两条集成测试证明会抛）
- [ ] `dispose()` 后每个源的 DOM 监听数归零
- [ ] `src/media/` 下不存在 `frameSize` 及其任何同义词
- [ ] 本层不重新定义 `SourceState`，只组合 core 的那一个
- [ ] 源不缓存帧（同一任务内两次读 `frame` 得到两个对象）
- [ ] external / copy 两条上传路径的朝向一致
- [ ] `PTZ = false` 不产生事件，且重新打开后恢复
- [ ] `touch-action` 在 dispose 时还原
- [ ] 不存在任何 2 的幂量化逻辑

## 交给下游的东西

| 产物 | 消费者 |
|---|---|
| `EventEmitter` / `Disposable` | P5 的 `Viewer`，P6 的 WebGL2 后端 |
| `MediaSource` 接口（`frame` / `naturalSize` / `on` / `markFramePresented`） | P5 的 `Viewer` 持有它 |
| `MediaFrame` | **就是 P3 的 `RenderableSource`**（本计划写成 `type` 别名），P5 原样交给 `Backend.setSource`，全程无转换 |
| `MediaFrame.version` | P5 的脏检查；P3 据此决定是否重传 |
| `MediaFrame.state`（即 core 的 `SourceState`） | P3 的上传尺寸与 `projection` uniform |
| `MediaSource.markFramePresented()` | P5 的渲染循环每画一帧调一次 —— 视频的版本号靠它前进 |
| `InputController` 的语义事件 | P5 的 `Viewer` 把 `pan`/`zoom` 转成相机动作 |
| `WheelZoom` 常量 | 没有下游，但**它是行为变更**：旧版鼠标滚轮与触控板共用一个除数 |

## 留给 P3 的一处依赖（本计划改不动）

**视频的 external texture 导入失败时没有回落分支。** P3 的 `WebGPUBackend.render()` 对 `source.kind === 'video'` 无条件走 `importExternalTexture`；如果某个设备上这一步抛错，异常会一路走到 `RenderLoop` 的 `onError`，结果是一块不再更新的画布 —— 正是本计划 Task 4 想避免的那种「静默冻住」。可用的回落是 `copyExternalImageToTexture` 到一张 rgba8unorm 纹理，也就是图片那条路径；**Step 3 的探针已经证明这条回落与 external 路径的行序一致**，所以补它不会再引入第二个朝向 bug。

这属于 `src/renderer/webgpu/backend.ts`，本计划无权修改，**由 P3 补上**：`render()` 里对视频先试 import，失败则退到 copy 路径，并把 `Capabilities.externalTextures` 置为 `false` 让应用看得见。
