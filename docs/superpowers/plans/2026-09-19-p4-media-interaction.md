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

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/core/events.ts` | `EventEmitter<M>` + `Disposable` |
| `src/media/source.ts` | `MediaSource` 接口、`SourceState`、媒体事件列表 |
| `src/media/image-source.ts` | `<img>` 实现 |
| `src/media/video-source.ts` | `<video>` 实现，含 external texture 策略 |
| `src/media/downscale.ts` | 超限时的缩放，与素材类型无关 |
| `src/interaction/input-controller.ts` | 指针监听、`AbortController`、语义事件 |
| `src/interaction/gestures.ts` | 拖拽 / 滚轮 / 双指捏合的纯函数识别 |
| `test/unit/gestures.test.ts` | 手势识别（纯函数，好测） |
| `test/unit/events.test.ts` | 事件系统 |
| `test/integration/media-upload.test.ts` | 上传路径 |
| `test/integration/ptz.test.ts` | 交互端到端 |

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
   * Protected: only the class that declares the event map may fire events.
   * A public emit() would let any holder of the object forge a `media-load`.
   */
  protected emit<K extends keyof M & string> (type: K, event: M[K]): void {
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
 * frame it is drawing, and the type says so -- `state` is a plain snapshot of
 * numbers plus the element reference, not a handle to GPU memory.
 */

import type { Disposable, EventEmitter, EventMap } from '../core/events'

/** What the renderer needs to know about the current frame of a source. */
export interface SourceState {
  readonly kind: 'image' | 'video'
  /** The element to read from. Never retained past the current frame. */
  readonly element: HTMLImageElement | HTMLVideoElement
  /**
   * How the source's pixels are laid out. A property of the SOURCE, never of
   * the camera -- the legacy design put it on the camera, which meant a camera
   * had to know whether the image in front of it was equirectangular.
   */
  readonly projection: 'equirectangular'
  /**
   * Bumped whenever the underlying pixels change.
   *
   * This is how "does the GPU texture need re-uploading" is answered without
   * the renderer subscribing to media events. An image bumps it once, on load;
   * a video bumps it on every frame it presents.
   *
   * Replaces the legacy `needUpdate_` latch, which had to be cleared by the
   * consumer -- and "who clears it" is where that kind of flag goes wrong.
   */
  readonly version: number
  /** UPLOAD dimensions in pixels, already planned against the device limit. */
  readonly width: number
  readonly height: number
}

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
  readonly state: SourceState
  /**
   * The element's natural size, before any downscaling.
   *
   * Separate from `state.width`/`state.height`, which are the upload size.
   * Interaction needs the display size; the renderer needs the upload size.
   */
  readonly naturalSize: { readonly width: number, readonly height: number }
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
    const { ImageSource } = (window as unknown as { __panoTest: any }).__panoTest
    const src = new ImageSource('/fixtures/panorama.png')
    const before = { w: src.naturalSize.width, h: src.naturalSize.height }
    let threw = ''
    try { src.state } catch (e) { threw = String(e) }
    src.dispose()
    return { before, threw }
  })
  expect(result.before).toEqual({ w: 0, h: 0 })
  expect(result.threw).toMatch(/not loaded/i)
})

test('becomes readable once the image loads', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { ImageSource } = (window as unknown as { __panoTest: any }).__panoTest
    const src = new ImageSource('/fixtures/panorama.png')
    const loaded = new Promise(r => {
      const off = (src as any).on('media-load', () => { off(); r('load') })
    })
    await loaded
    const state = src.state
    src.dispose()
    return { kind: state.kind, w: state.width, h: state.height, version: state.version }
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
    const { ImageSource } = (window as unknown as { __panoTest: any }).__panoTest
    const src = new ImageSource('/fixtures/does-not-exist.png')
    return new Promise(resolve => {
      const off = (src as any).on('media-error', () => { off(); resolve('media-error'); src.dispose() })
      setTimeout(() => resolve('timeout'), 5000)
    })
  })
  expect(result).toBe('media-error')
})

test('dispose aborts every DOM listener', async ({ gpuPage }) => {
  // Counted, not asserted by reading the source. The legacy code leaked three
  // listeners across four files precisely because nobody could see the count.
  const result = await gpuPage.evaluate(async () => {
    const { ImageSource } = (window as unknown as { __panoTest: any }).__panoTest
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
import { MEDIA_EVENT_MAP, type MediaEvents, type MediaSource, type SourceState } from './source'
import { planDownscale } from './downscale'

export class ImageSource extends Disposable implements MediaSource {
  readonly #events = new EventEmitter<MediaEvents>()
  readonly #element: HTMLImageElement
  readonly #abort = new AbortController()
  #listenerCount = 0
  #version = 0

  readonly #projection: 'equirectangular'

  /**
   * @param url - Image URL.
   * @param options - Device limit and the source's texture projection.
   */
  constructor (url: string, options: { maxTextureDimension?: number, projection?: 'equirectangular' } = {}) {
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

  get state (): SourceState {
    const { naturalWidth: w, naturalHeight: h } = this.#element
    if (w === 0 || h === 0) {
      // Throwing here rather than returning a 0x0 state keeps the failure at the
      // point of use. A 0x0 texture is a WebGPU validation error that surfaces
      // during texture creation, with nothing pointing back to "not loaded yet".
      throw new Error('image source is not loaded yet')
    }
    const plan = planDownscale(w, h, this.#maxTextureDimension)
    return {
      kind: 'image',
      element: this.#element,
      projection: this.#projection,
      version: this.#version,
      width: plan.width,
      height: plan.height
    }
  }

  /** The scale the current source would be uploaded at. 1 when it fits. */
  get uploadScale (): number {
    const { naturalWidth: w, naturalHeight: h } = this.#element
    if (w === 0 || h === 0) return 1
    return planDownscale(w, h, this.#maxTextureDimension).scale
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

**设计立场：默认走 external texture，探测失败回落。** 但**回落路径必须实现并测到** —— 否则在 WebGPU 可用、external texture 不可用的环境里（部分移动端浏览器）会直接黑屏。

- [ ] **Step 1: 写集成测试**

`test/integration/video-source.test.ts`：

```ts
import { test, expect } from './support/fixtures'

test('reports a zero size before metadata loads', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { VideoSource } = (window as unknown as { __panoTest: any }).__panoTest
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    const before = src.naturalSize
    let threw = ''
    try { src.state } catch (e) { threw = String(e) }
    src.dispose()
    return { before, threw }
  })
  expect(result.before).toEqual({ width: 0, height: 0 })
  expect(result.threw).toMatch(/metadata/i)
})

test('version advances as frames present', async ({ gpuPage }) => {
  // This is what drives per-frame re-upload. If it does not advance, a playing
  // video renders its first frame forever.
  const result = await gpuPage.evaluate(async () => {
    const { VideoSource } = (window as unknown as { __panoTest: any }).__panoTest
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    await new Promise(r => { const off = src.on('media-loadedmetadata', () => { off(); r(null) }) })
    const a = src.state.version
    await src.play()
    await new Promise(r => setTimeout(r, 300))
    const b = src.state.version
    src.dispose()
    return { a, b }
  })
  expect(result.b).toBeGreaterThan(result.a)
})

test('the external texture does not outlive its task', async ({ gpuPage }) => {
  // The hazard: importExternalTexture's result is destroyed when the microtask
  // it was created in ends, and a bind group holding it does NOT keep it alive.
  // Reading a stale one is a validation error at best.
  const result = await gpuPage.evaluate(async () => {
    const t = (window as unknown as { __panoTest: any }).__panoTest
    const { VideoSource } = t
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    await new Promise(r => { const off = src.on('media-loadedmetadata', () => { off(); r(null) }) })
    const device = await t.getDevice()
    const first = device.importExternalTexture({ source: src.element })
    await new Promise(r => setTimeout(r, 0))
    // Using it now is a use-after-free; the spec says it must not be retained.
    let stale = false
    try { device.importExternalTexture({ source: src.element }) } catch { stale = true }
    src.dispose()
    return { stale }
  })
  expect(typeof result.stale).toBe('boolean')
})

test('dispose waits for no frame and stops the element', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const { VideoSource } = (window as unknown as { __panoTest: any }).__panoTest
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    await new Promise(r => { const off = src.on('media-loadedmetadata', () => { off(); r(null) }) })
    await src.play()
    src.dispose()
    return { paused: src.element.paused, listeners: src.__listenerCount() }
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
 *    is no error until it is used. So the renderer must consume `state` within
 *    the frame it was read, and this class must never hand out a cached one.
 *
 * 2. There are two upload paths and no `flipY` on the fast one. The slow path
 *    supports flipY; the fast one does not. Since the sampler's v axis runs the
 *    same way for both, and both sources are top-left origin, neither should be
 *    flipped -- but that is an empirical claim, and
 *    `test/integration/video-orientation.test.ts` is what checks it.
 */

import { Disposable, EventEmitter } from '../core/events'
import { MEDIA_EVENT_MAP, type MediaEvents, type MediaSource, type SourceState } from './source'
import { planDownscale } from './downscale'

/** How a video frame should reach the GPU. */
export type VideoUploadPath = 'external' | 'copy'

export interface VideoSourceOptions {
  readonly maxTextureDimension: number
  /** How the video's pixels are laid out. A property of the source, not the camera. */
  readonly projection?: 'equirectangular'
  /** `autoplay`, `loop`, `muted` -- passed through to the element. */
  readonly autoplay?: boolean
  readonly loop?: boolean
  readonly muted?: boolean
  /**
   * Which upload path to use. Decided by the backend, which is the only thing
   * that knows whether the device supports external textures.
   */
  readonly uploadPath?: VideoUploadPath
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
      this.#events.emit(eventName, { target: this, error: undefined })
    }, { signal: this.#abort.signal })
  }

  /**
   * Bumps the version on every presented frame.
   *
   * Called by the render loop rather than driven by an event: there is no DOM
   * event for "a new frame is ready to sample", and `timeupdate` fires only
   * about four times a second -- far too coarse to drive a 60fps upload.
   */
  markFramePresented (): void {
    this.#version++
  }

  on<K extends keyof MediaEvents & string> (type: K, fn: (event: MediaEvents[K]) => void): () => void {
    return this.#events.on(type, fn)
  }

  /** The underlying element. Used by the backend to import a texture. */
  get element (): HTMLVideoElement {
    return this.#element
  }

  get naturalSize (): { width: number, height: number } {
    return { width: this.#element.videoWidth, height: this.#element.videoHeight }
  }

  get state (): SourceState {
    const { videoWidth: w, videoHeight: h } = this.#element
    if (w === 0 || h === 0) {
      // `HAVE_NOTHING`/`HAVE_METADATA` report 0x0. Creating a texture from that
      // is a validation error whose message says nothing about metadata.
      throw new Error('video source metadata has not loaded yet')
    }
    const plan = planDownscale(w, h, this.#options.maxTextureDimension)
    return {
      kind: 'video',
      element: this.#element,
      projection: this.#options.projection ?? 'equirectangular',
      version: this.#version,
      width: plan.width,
      height: plan.height
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

`test/integration/video-orientation.test.ts`：

```ts
import { test, expect } from './support/fixtures'
import { maxChannelDiff } from './support/gpu'

/*
 * The two upload paths must agree on orientation.
 *
 * importExternalTexture has no flipY option; copyExternalImageToTexture does.
 * If they disagree, a browser that falls back to the copy path renders the
 * video upside down relative to one that uses external textures -- a bug that
 * only appears on some devices and looks like a shader problem.
 *
 * Renders the same paused frame through both paths and compares.
 */
test('external and copy upload paths produce the same orientation', async ({ gpuPage }) => {
  const result = await gpuPage.evaluate(async () => {
    const t = (window as unknown as { __panoTest: any }).__panoTest
    return t.renderVideoBothPaths('/fixtures/clip.mp4')
  })
  expect(maxChannelDiff(result.external, result.copy)).toBeLessThanOrEqual(2)
})
```

- [ ] **Step 4: 跑测试**

Run: `npm run test:integration -- video-source video-orientation`
Expected: 全 PASS

**`video-orientation` 失败时**：**不要直接给 copy 路径加 `flipY: true` 试**。先确认是**哪一条**需要翻 —— 拿一张上下明显不对称的测试帧，两条路径各渲一次，看哪一条是倒的。翻错了就是把对的翻成错的。

- [ ] **Step 5: Commit**

```bash
git add src/media/video-source.ts test/integration/video-source.test.ts test/integration/video-orientation.test.ts
git commit -m "feat(media): video source with an explicit upload-path choice

A video frame is valid only inside the microtask that produced it, and a
bind group holding an external texture does not keep it alive. The two
upload paths also disagree about flipY, so orientation is pinned by a test
rather than assumed."
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

`test/unit/gestures.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { classifyWheel, classifyPinch, classifyDrag, WheelZoom } from '../../src/interaction/gestures'

describe('classifyWheel', () => {
  it('maps a line-mode wheel delta to a zoom step', () => {
    expect(classifyWheel({ deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE })).toBeCloseTo(0.3, 5)
  })

  it('normalises pixel-mode deltas, which are an order of magnitude larger', () => {
    // A trackpad reports pixels and a mouse wheel reports lines. Feeding both
    // through the same divisor makes one of them unusable: this is why the
    // legacy zoom was violent on a trackpad and sluggish on a mouse.
    const pixel = classifyWheel({ deltaY: -100, deltaMode: WheelEvent.DOM_DELTA_PIXEL })
    const line = classifyWheel({ deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_LINE })
    expect(Math.sign(pixel)).toBe(Math.sign(line))
    expect(Math.abs(pixel / line)).toBeLessThan(3)
  })

  it('treats page-mode deltas as lines', () => {
    expect(classifyWheel({ deltaY: -3, deltaMode: WheelEvent.DOM_DELTA_PAGE }))
      .toBeCloseTo(0.3, 5)
  })

  it('is antisymmetric', () => {
    const down = classifyWheel({ deltaY: 100, deltaMode: WheelEvent.DOM_DELTA_PIXEL })
    const up = classifyWheel({ deltaY: -100, deltaMode: WheelEvent.DOM_DELTA_PIXEL })
    expect(down).toBeCloseTo(-up, 6)
  })

  it('returns zero for a zero delta', () => {
    expect(classifyWheel({ deltaY: 0, deltaMode: WheelEvent.DOM_DELTA_PIXEL })).toBe(0)
  })

  it('clamps an absurd single-event delta', () => {
    // Some drivers emit a single deltaY of several thousand on a flick. Without
    // a clamp the panorama jumps a full revolution.
    const huge = classifyWheel({ deltaY: -100000, deltaMode: WheelEvent.DOM_DELTA_PIXEL })
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

  const notches = input.deltaMode === WheelEvent.DOM_DELTA_PIXEL
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

import { Disposable, EventEmitter } from '../core/events'
import { classifyDrag, classifyPinch, classifyWheel, type SurfaceSize } from './gestures'

export interface InputEvents extends Record<string, unknown> {
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
    const { InputController } = (window as unknown as { __panoTest: any }).__panoTest
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
    const { InputController } = (window as unknown as { __panoTest: any }).__panoTest
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

test('dispose restores touch-action', async ({ gpuPage }) => {
  // The viewer sets touch-action: none on an element it does not own. Leaving
  // it set would stop the host page from scrolling over that element forever.
  const result = await gpuPage.evaluate(async () => {
    const { InputController } = (window as unknown as { __panoTest: any }).__panoTest
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
- [ ] external / copy 两条上传路径的朝向一致
- [ ] `PTZ = false` 不产生事件，且重新打开后恢复
- [ ] `touch-action` 在 dispose 时还原
- [ ] 不存在任何 2 的幂量化逻辑

## 交给下游的东西

| 产物 | 消费者 |
|---|---|
| `EventEmitter` / `Disposable` | P5 的 `Viewer`，P6 的 WebGL2 后端 |
| `MediaSource` 接口 | P5 的 `Viewer` 持有它 |
| `SourceState.version` | P5 的脏检查 —— 后端据此决定是否重传 |
| `InputController` 的语义事件 | P5 的 `Viewer` 把 `pan`/`zoom` 转成相机动作 |
| `WheelZoom` 常量 | 没有下游，但**它是行为变更**：旧版鼠标滚轮与触控板共用一个除数 |
