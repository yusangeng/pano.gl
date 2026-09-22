# P4 — media + interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

> **（2026-09-20 登记，P1 终末全分支审查 MINOR 6；协调侧预补）**：`CLAUDE.md` 的 Commands 表与 Testing 节仍含 Playwright 时代的桥接写法（`npm run test:integration # playwright test`、`npx playwright test ...`、`playwright.config.ts`、`window.__panoTest` / `demo/test-entry-hooks`）。这些段落先于 P1 的 vitest 浏览器模式拍板、**已作废**：集成测试跑 vitest 浏览器模式、测试文件直接 import 被测代码、**没有桥**。本期的命令与测试约定以本 plan 与任务卡为准，不以 CLAUDE.md 为准。CLAUDE.md 头部告示覆盖的是「还没造」，不覆盖「已废弃且现在要做相反的事」；该文件的重写归 P7 Task 4。

**Goal:** 素材源与交互两块，各自独立可测。图片和视频走同一条读取路径；所有 DOM 监听由 `AbortController` 收口。

**Architecture:** `media/` 把 `<img>`/`<video>` 包成 `MediaSource`，对外只暴露一个带版本号的快照；`interaction/` 把指针输入识别成语义事件，自己不碰相机。

**Tech Stack:** Pointer Events · `AbortController` · `OffscreenCanvas` · vitest 浏览器模式

---

## 前置说明：三条不在计划里但必须知道的结论

**1. `EventEmitter` / `Disposable` 是 foundation 层，却写在本计划里。**
它们第一个消费者是 media，但依赖方向上是纯底层（不依赖 `core/` 以外任何东西）。**上榜时 layer 填 `foundation`，deps 为空** —— 不要让它们去等 P4 的其它卡。

**2. 旧代码的「2 的幂」约束在 WebGPU 下消失了。**
`Renderer.updateTextureObject` 用 `gl.RGB` + `LINEAR` + 无 mipmap + **无 `CLAMP_TO_EDGE`**，所以源必须 2 的幂且与画布区域等大（这正是 demo 只提供 2048/4096/8192 的原因）。**WebGPU 没有任何 2 的幂要求** —— `rgba8unorm` 配 `linear` 过滤与 `clamp-to-edge` 对任意尺寸都成立。

**所以：不要移植 `frameSize` 那套「源超标就过中间画布」的逻辑。** 新设计只在**超过 `maxTextureDimension2D`** 时才缩放，与 2 的幂无关。这一条会删掉一整类代码和 demo 的素材限制。

**由此得到本层的两条硬约束，后面每一步都受它约束：**

1. **`src/media/` 里不存在任何叫 `frameSize` 的选项、参数或字段**，也不要再造一个同义词（`size`、`targetSize` 之类）。「源太大该怎么办」的答案由**后端**给出 —— 后端是唯一知道 `Capabilities.maxTextureDimension` 的地方，素材层只负责把它算成上传尺寸（`planDownscale`）。
2. **`SourceState` 由 `core` 定义，本层只组合它，不重新定义。** `core` 是两个后端都认可的那一层，且按设计不碰 DOM；媒体元素、帧计数器这类 DOM 侧的东西属于本层自己的类型。另起一个同形状的 `SourceState` 会是一个**结构上的近似副本**，它能编译通过，直到有人改了其中一份 —— 而且 P3 的 `Backend.setSource` 收的是 core 的 `SourceState`，P6 的 `WebGL2Backend implements Backend` 会因此对不上。

**3. 本层的集成测试需要两个素材，而这两个素材不属于任何一个阶段。**
`public/fixtures/panorama.png`（一张等距柱面全景，**四个象限颜色两两可区分**）与 `public/fixtures/clip.mp4`（一段两秒的视频，**每一帧同样四象限可分、且有肉眼可辨的运动**）。服务它们不需要任何配置：browser mode 本来就是由 Vite 供页面的，而 Vite 的 `publicDir` 默认值就是 `<root>/public`，所以 `/fixtures/panorama.png` 直接 fetch 得到。但 `public/fixtures/` 下的**文件**没有任何一张计划负责产出。**由本计划产出，落在 Task 2 的 Step 7** —— P4 的 `image-source.test.ts` / `video-source.test.ts`、P5 的全部 User Story、P6 的后端对比都要用它们。

**素材规格（不是随便找两个文件就行）：**
- 图片要能被 `countNonBlack` 判为「非黑」，也就是画面大部分不是暗的；再要**上下可区分**，否则「画面是不是倒的」这件事从像素上根本看不出来 —— 而上下颠倒正是旧版最难发现的那个 bug。
- 还要**左右可区分**。只有一条竖直分界的图，水平平移前后像素完全相同，「平移改变了画面」这条断言会对着一个冻住的画布通过 —— 它错得和「上下同色」一样安静。四个象限同时满足这两条，这也是生成器不用两半的原因。
- 视频要能被 `chromium` 的默认解码器解出来（H.264 的 MP4 最稳），时长足够跑完「播放 → 暂停 → 断言不再画」这一串，且**帧与帧之间要有差异** —— 一段静止的片子会让「播放中画面在变」永远失败，而且失败得像是渲染坏了。
- 仓库里已有的 `demo/` 素材是旧版的 2048/4096 宽图，**尺寸与本层的缩放逻辑无关**（见第 2 条）；但它们是为 2 的幂挑的，上下关系没有保证，**不要直接拿来充数**。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `src/core/events.ts` | `EventEmitter<M>` + `Disposable` |
| `src/media/source.ts` | `MediaSource` 接口、`MediaFrame`（组合 core 的 `SourceState`）、媒体事件列表 |
| `src/media/image-source.ts` | `<img>` 实现 |
| `src/media/video-source.ts` | `<video>` 实现；**不含**上传路径选择，那要读 device，是后端的 |
| `src/media/downscale.ts` | 超限时的缩放，与素材类型无关 |
| `scripts/gen-fixtures.mjs` | 生成下面两个素材的脚本；产物提交，脚本只在改素材时跑 |
| `public/fixtures/panorama.png` | 集成测试读的全景图，四象限四色 |
| `public/fixtures/clip.mp4` | 集成测试读的两秒视频，每 0.25s 换一帧画面 |
| `src/interaction/input-controller.ts` | 指针监听、`AbortController`、语义事件 |
| `src/interaction/gestures.ts` | 拖拽 / 滚轮 / 双指捏合的纯函数识别 |
| `test/unit/gestures.test.ts` | 手势识别（纯函数，好测） |
| `test/unit/events.test.ts` | 事件系统 |
| `test/integration/image-source.test.ts` / `video-source.test.ts` | 源的生命周期、事件、监听器计数 |
| `test/integration/video-orientation.test.ts` | 两条上传路径的朝向一致性 |
| `test/integration/support/upload-paths.ts` | 上一条的探针：自建 device，直接驱动两个浏览器 API（浏览器模式，直接 import） |
| `test/integration/ptz.test.ts` | 交互端到端 |

---

## 集成测试怎么拿到被测对象

**本层的集成测试不需要任何出口，直接 import 被测类就行。** `demo/test-entry.ts`、`PanoTestApi`、`test-entry-hooks/` 那一整套在 P3 里已经被删掉了 —— 它们存在的唯一理由是「Playwright 测试跑在 Node 里，够不着页面」。

```ts
// test/integration/image-source.test.ts
import { ImageSource } from '../../src/media/image-source'
```

就这么一句。测试文件本身在页面里，`ImageSource` 就是同一个模块系统里的一个类，中间不需要任何一层。

**不要往生产入口 `src/index.ts` 上挂内部符号。** 集成测试 import `src/` 的内部模块是允许的；但用户故事级的测试（P5）只走 `src/index.ts` 的公开 API。这条以前由出口的形状隐式保证，现在靠约定 + review。

---

### Task 1: 事件系统与 `Disposable`

**Files:**
- Create: `src/core/events.ts`
- Test: `test/unit/events.test.ts`

- [x] **Step 1: 写失败测试**

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

- [x] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- events`
Expected: FAIL —— 无法解析 `../../src/core/events`

- [x] **Step 3: 实现**

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

- [x] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- events`
Expected: 11 个测试 PASS

- [x] **Step 5: Commit**

```bash
git add src/core/events.ts test/unit/events.test.ts
git commit -m "feat(core): typed events and an explicit disposal contract

Replaces @eventable and @disposable. on() returns its own unsubscribe
function, so the common leak -- a handler registered as an inline arrow
that nobody can name at teardown -- stops being the path of least
resistance."
```

> **（2026-09-21 登记，Task 1 勘误，落地于 4fdb84a）**两处 plan 代码被本任务自己的测试 / 类型检查否决，逐字照抄不可能，按最小修复落地：
> 1. `Disposable.dispose` 的 plan 函数体（仅 `this.#disposed = true`）过不了本任务自己的「runs dispose exactly once」测试——子类约定是「先做自己的清理、最后 `super.dispose()`」，动态分发会先进入 override，基类里的任何守卫都拦不住第二次公有调用重入 override。已改为：首次 dispose 置位 `#disposed` 后，用 `Object.defineProperty` 在实例上盖一个 no-op 影子方法（自有属性查找先于原型链，第二次公有调用成为真正的 no-op，含 override）；基类顶部保留 `if (this.#disposed) return` 守卫，覆盖「子类在一次 override 里直接连调两次 `super.dispose()`」的原型查找路径。规格审查用 node 镜像实证了 plan 原函数体确实失败，且基类守卫 / 模板方法钩子两种更简单的方案都过不了这条测试。
> 2. `on()` 退订闭包里的 `fn as (event: never) => void` 被 tsc 拒绝（TS2345，strictFunctionTypes 在调用点的逆变检查）。改为 `fn as unknown as (event: M[keyof M & string]) => void`——与 plan 自己在 wildcard 分支用的双重断言同一惯用法，删除仍按同一函数引用进行。
>
> **（2026-09-21 登记，Task 1 质量审查补测，落地于 fdf9348）**变异测试证明「拷贝后再迭代」未被钉住：自删在活 Set 上恰好是安全的（删除当前正在访问的元素不影响后续），真正区分活迭代与快照的是「删除**尚未访问**的监听器」——而原测试只测了自删，plan 原注释还按数组语义把这个机制写错了。补两条测试（later-listener 与 wildcard-later-listener，预期 `['a','b','a']`，活迭代变异体得 `['a','a']` 被抓）、修正原注释、给 `EventMap` 补「必须带索引签名」的 TSDoc（下游三个消费者第一天就会撞）。13/13 通过；events.ts 函数覆盖 100%，唯一未覆盖分支是 `#disposed` 守卫（防御性代码，可观测性为零，全局门槛吸收）。

---

### Task 2: `MediaSource` 接口与统一读取路径

**Files:**
- Create: `src/media/source.ts`
- Create: `src/media/downscale.ts`
- Create: `scripts/gen-fixtures.mjs`
- Create: `public/fixtures/panorama.png`
- Create: `public/fixtures/clip.mp4`
- Test: `test/unit/downscale.test.ts`

- [x] **Step 1: 写失败测试**

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

- [x] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- downscale`
Expected: FAIL —— 无法解析 `../../src/media/downscale`

- [x] **Step 3: 实现 downscale**

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

- [x] **Step 4: 实现接口**

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

- [x] **Step 5: 跑测试确认通过**

Run: `npm run test:unit -- downscale`
Expected: 7 个测试 PASS

- [x] **Step 6: Commit**

```bash
git add src/media/source.ts src/media/downscale.ts test/unit/downscale.test.ts
git commit -m "feat(media): source snapshot interface and an upload-size planner

The legacy frameSize path inherited WebGL1's power-of-two requirement from
a gl.RGB/LINEAR/no-CLAMP_TO_EDGE upload. WebGPU has no such requirement, so
this only scales when the device limit is actually exceeded."
```

- [x] **Step 7: 生成两个 fixture 素材**

前置说明第 3 条说的两个文件，在这里落地 —— 这是第一个需要它们的任务。

**为什么提交产物而不是让大家现场生成。** 生成视频要 ffmpeg，而 ffmpeg 不是 npm 生态里的东西 —— 让每个 clone 的人先装 ffmpeg 才能跑测试，正是这次迁移要摆脱的那类依赖（P0 把 v0.2.2 的 bundle 存进仓库是同一个理由）。脚本留在仓库里，改素材时用它；产物也进仓库。

**为什么素材要有这些性质。** 「上下两半可区分」不是审美要求：旧版最难看出来的一个 bug 就是画面上下颠倒，而一张上下同色的图倒过来和正着长得一模一样，谁都发现不了。同理，「左右也要可区分」是给 PTZ 断言用的 —— 只有一条竖直分界的图，水平平移前后像素完全相同，那条测试会对着一个冻住的画布通过。所以是**四个象限**，不是两半。

- [x] **Step 7a: 写生成器**

`scripts/gen-fixtures.mjs`：

```js
/*
 * Regenerates the two fixtures the integration suites read. Both outputs are
 * committed, so this runs only when the fixtures themselves need to change --
 * cloning the repo and running the suite never requires ffmpeg.
 *
 *   node scripts/gen-fixtures.mjs
 *
 * Requires ffmpeg on PATH. Nothing in package.json depends on it.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'fixtures')
const png = path.join(outDir, 'panorama.png')
const mp4 = path.join(outDir, 'clip.mp4')

const W = 512
const H = 256

/*
 * Four quadrants, not two.
 *
 * Four colours because two different assertions have to hold at once: up and
 * down must differ (the orientation checks) and a horizontal pan must change
 * pixels (the PTZ checks). A single vertical split would make every pan a no-op.
 *
 * ffmpeg routes these hex values through YUV, so what lands in the file is the
 * converted value, not the literal below. They stay distinct and stable, which
 * is all the tests need -- do not assert exact channel values anywhere.
 */
const QUADRANTS = ['0xCC2222', '0x22CC22', '0x2222CC', '0xCCCC22']

const quad = (color) => ['-f', 'lavfi', '-i', `color=c=${color}:s=${W / 2}x${H / 2}`]

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/** Renders one frame from four quadrant colours, in TL, TR, BL, BR order. */
const frame = (file, [tl, tr, bl, br]) =>
  ffmpeg([
    ...quad(tl), ...quad(tr), ...quad(bl), ...quad(br),
    '-filter_complex',
    '[0:v][1:v]hstack[top];[2:v][3:v]hstack[bottom];[top][bottom]vstack[out]',
    '-map', '[out]', '-frames:v', '1', file
  ])

/** The palette rotated left by `n`. */
const rotated = (n) => QUADRANTS.map((_colour, i) => QUADRANTS[(i + n) % 4])

/*
 * The clip cycles through four rotations of the palette, not two.
 *
 * The tests sample it at wall-clock intervals rather than at known frame
 * indices, so what has to hold is not "do consecutive frames differ" but "do two
 * samples 500ms apart differ, whatever phase they start at". With a two-image
 * alternation held 8 frames each, a sample taken 15 frames later lands back on
 * the same image for most phases, and the assertion reads zero difference on a
 * perfectly healthy video -- a flake that looks exactly like a broken renderer.
 * Four images push that alias out to a whole 32-frame cycle (~1.07s), and every
 * gap from 8 to 24 frames (267-800ms) then has zero aliasing at every phase.
 */
const CYCLE = QUADRANTS.map((_colour, n) => rotated(n))

mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(tmpdir(), 'pano-fixtures-'))

try {
  const stills = CYCLE.map((quadrants, i) => {
    const file = i === 0 ? png : path.join(tmp, `frame-${i}.png`)
    frame(file, quadrants)
    return file
  })

  // Two passes over the cycle, so the clip loops without a seam and no sampling
  // interval shorter than a full cycle can land on the same image twice.
  const segments = []
  for (let i = 0; i < CYCLE.length * 2; i++) segments.push(stills[i % CYCLE.length])

  const inputs = segments.flatMap((file) => [
    // 0.25s at 30fps is 8 whole frames, which is the hold this design assumes.
    '-loop', '1', '-t', '0.25', '-r', '30', '-i', file
  ])
  const labels = segments.map((_file, i) => `[${i}:v]`).join('')

  ffmpeg([
    ...inputs,
    '-filter_complex', `${labels}concat=n=${segments.length}:v=1[out]`,
    '-map', '[out]',
    // yuv420p is the only chroma layout every browser decodes without argument.
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    // Without faststart the moov atom sits at the end of the file and the
    // browser has to fetch the whole thing before it reports a duration.
    '-movflags', '+faststart',
    mp4
  ])
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

for (const file of [png, mp4]) {
  const { size } = statSync(file)
  if (size === 0) throw new Error(`ffmpeg produced an empty ${file}`)
  console.log(`${path.relative(root, file)}  ${size} bytes`)
}
```

- [x] **Step 7b: 生成**

Run: `node scripts/gen-fixtures.mjs`
Expected: 两行输出，各几 KB（实测 `panorama.png` 1839 字节、`clip.mp4` 约 4.9KB —— 纯色图压缩率极高，**大小不是断言，别写进测试**）

Run: `ffprobe -v error -select_streams v -show_entries stream=width,height,nb_frames,codec_name -of csv=p=0 public/fixtures/clip.mp4`
Expected: `h264,512,256,64`（字段顺序随 ffprobe 版本可能不同；关键是 `512`、`256`、**`64`** —— 64 帧 = 8 段 × 8 帧 = 2.13 秒，正好让片子循环得起来）

Run: `ls -l public/fixtures/`
Expected: **只有两个文件**。四张静帧里只有第一张落在 `public/`，另外三张写在临时目录里、跑完就删 —— 它们不是测试素材，只是生成过程的中间产物，不该进仓库。

> **视频那条断言若红在「解不出来」上，先怀疑路径而不是编码器。** 立项时已用 Playwright 会装的那个 Chromium（`chromium-1243`，`channel: 'chromium'` 指的就是它）实测过 `canPlayType('video/mp4; codecs="avc1.42E01E"')` 返回 `probably`，且加载本脚本产出的同参数文件后 `videoWidth=256`、`readyState=4`（`HAVE_ENOUGH_DATA`）。**注意版本**：更老的缓存副本 `chromium-1169` 对同一文件回 `h264=NO` —— 若本机命中了那个副本，先 `npx playwright install chromium` 再查代码。

- [x] **Step 7c: Commit**

```bash
git add scripts/gen-fixtures.mjs public/fixtures/
git commit -m "test(fixtures): generate the panorama and clip the media suites read

Two files, three invocations, no hand-editing: committing the outputs means
a clone can run the suite without ffmpeg installed. The four-colour layout
is what makes an upside-down source and a frozen pan both detectable."
```

> **为什么素材在 P4 而不在 P1。** P1 建的是测试设施（vitest 的两个 project、WebGPU 守卫），而这两个文件的**规格来自它们的消费者** —— 四个象限是为了满足 P4 的朝向与上传路径断言、P5 的 PTZ 断言、P6 的后端对比。把文件放在第一个需要它们的阶段，规格和产物就在同一份文档里，不会各自漂移。P1 只需要保证页面起得来就能把它服务出来 —— 那是 Vite 的 `publicDir` 默认值 `<root>/public`。

> **不能拿仓库里已有的 demo 素材充数。** 那些是旧版为 2 的幂尺寸挑的，上下关系没有任何保证 —— 而这里要断言的恰恰是上下关系。

> **（2026-09-21 登记，Task 2 勘误，落地于 fdeff73 / 17f54c4）**三处 plan 代码被仓库自己的检查器否决，逐字照抄不可能，按最小修复落地：
> 1. `source.ts` 删掉了 plan 的 `import type { SourceState }`：`MediaFrame` 成为 `RenderableSource` 的别名后，`SourceState` 只出现在 TSDoc 散文里，typescript-eslint 的 no-unused-vars 拒绝（往 /tmp 副本里加回该行即复现报错；tsc 两种写法都过）。`Disposable` / `EventMap` / `RenderableSource` 三行 import 保持 plan 原样。
> 2. `gen-fixtures.mjs` 按 `tsconfig.scripts.json` 的 checkJs 严格检查（noImplicitAny / noUncheckedIndexedAccess；plan 的裸 JS 报 9 处错）改为 JSDoc 注解风格：`@param` / `@returns`、QUADRANTS 注为四元组、`rotated()` 重写为四条显式分支、segments 改为 `[...stills, ...stills]`。行为零差异 —— 重跑生成器后 `cmp` 证明产物逐字节相同（1839 / 4886 字节）。
> 3. 两笔提交在未推送时用 reset 重写了一次，使每一步的提交内容与修正后的内容对齐；最终 SHA 为 fdeff73 / 17f54c4。
>
> **（2026-09-21 登记，Task 2 质量审查补测，落地于 f52856e）**变异测试证明 plan 自带的 7 条测试有四类行为未被钉住（代码本身正确，问题是测试因错误理由通过）：
> - **高度约束轴**（IMPORTANT）：超标用例全是横版图，删掉 `Math.min` 的 height 侧或 fits 检查的 height 条件后 7/7 照过 —— 竖版源会拿到超标尺寸。补 `5000x10000 → 4096x8192`，两侧同时钉住。
> - **1px 钳位从未实际生效**（IMPORTANT）：原测试的 `(16384,1)` 乘积恰为 0.5，`Math.round` 半数进一到 1，断言被 round 而不是钳位救活。补 `(20000,1)` / `(1,20000)`（无钳位时 `round(0.4096) = 0`）。
> - **守卫的 `||` 与 RangeError 类未钉**（MINOR）：只测了 `(0,0)`；原位加固为零测例（单侧零 + `toThrow(RangeError)`）。
> - **round 对 floor / ceil**（MINOR）：没有测例乘积小数部分落在 (0.5, 1)；补 `10000x5001 → 4097`（杀 floor）并把 T6 改为 `toBe(91)`（杀 ceil）。两条 round 测试各杀一个方向，分工正好。
> - 三处注释修正：downscale.ts 头部的「与画布区域等大」子句经 v0.2.2 tag 逐行核对为**假**（帧路径是 drawImage 缩放，整个 tag 无 texSubImage2D），删除；`@throws` 改为 "not positive"（守卫是 `<= 0`）；source.ts 的 microtask→task（task 级的外部纹理生存期）。
> - 等价变异体不测：fits 边界 `<=`→`<` 对整数输入逐位等价（x/x===1）；绑定轴 floor 仅在 1-ulp 浮点事故点可区分（如 w=8474）。钉它们会是坏测试。
> - 遗留 INFORMATIONAL（未修，记录在案）：'rounds rather than floors' 测试注释里的 "w * (max / w) === max" 不是普遍浮点恒等式（11808 探针中 1400 例失败）；它引导的结论（只钉非绑定轴）正确。

---

### Task 3: `ImageSource`

**Files:**
- Create: `src/media/image-source.ts`
- Test: `test/integration/image-source.test.ts`

- [x] **Step 1: 写集成测试**

`test/integration/image-source.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { ImageSource } from '../../src/media/image-source'

/*
 * Runs in a real browser because everything here is a DOM concern: when `load`
 * fires, what `naturalWidth` is before it, whether listeners actually come off.
 *
 * No `page.evaluate` and no `window.__panoTest`: in vitest's browser mode this
 * file is already in the page. The only thing that used to justify the round
 * trip was that Playwright drove from Node.
 */

describe('ImageSource', () => {
  it('reports a zero size before the image loads, and throws if asked to upload', () => {
    // The failure this pins: a source that has not loaded looks like a 0x0
    // image, and a 0x0 texture is a WebGPU validation error thrown far from the
    // cause.
    const src = new ImageSource('/fixtures/panorama.png')
    expect(src.naturalSize).toEqual({ width: 0, height: 0 })
    expect(() => src.frame).toThrow(/not loaded/i)
    src.dispose()
  })

  it('becomes readable once the image loads', async () => {
    const src = new ImageSource('/fixtures/panorama.png')
    await new Promise<void>(resolve => {
      const off = src.on('media-load', () => { off(); resolve() })
    })

    const frame = src.frame
    expect(frame.kind).toBe('image')
    expect(frame.state.width).toBeGreaterThan(0)
    expect(frame.state.height).toBeGreaterThan(0)
    expect(frame.version).toBeGreaterThan(0)
    src.dispose()
  })

  it('re-emits the element error as media-error rather than throwing', async () => {
    // A 404 must reach the application as an event. The legacy provider attached
    // an error listener that only logged, so an application had no way to show
    // "this image failed to load".
    const src = new ImageSource('/fixtures/does-not-exist.png')
    const outcome = await Promise.race([
      new Promise<string>(resolve => {
        const off = src.on('media-error', () => { off(); resolve('media-error') })
      }),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 5000))
    ])
    src.dispose()
    expect(outcome).toBe('media-error')
  })

  it('dispose aborts every DOM listener', () => {
    // Counted, not asserted by reading the source. The legacy code leaked three
    // listeners across four files precisely because nobody could see the count.
    const src = new ImageSource('/fixtures/panorama.png')
    expect(src.listenerCount).toBeGreaterThan(0)
    src.dispose()
    expect(src.listenerCount).toBe(0)
  })
})
```
> `listenerCount` 是 `ImageSource` 自己的计数器，读它不碰 DOM，也不需要任何强转。**把它做成公开只读属性是有意的**：让「有没有漏摘监听」变成一条可断言的事实，而不是靠读源码相信。计数在 `dispose` 里随 `abort()` 归零 —— 一个 `AbortSignal` 管住全部监听器，所以归零只有一处。
>
> **不要把它换成包装 `addEventListener`/`removeEventListener` 的全局计数。** `AbortController` 摘监听器时不调 `removeEventListener`，那样的计数会把一个已经清干净的源报成满的。

- [x] **Step 2: 实现**

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
      // Only `load` bumps the version, because only `load` means the pixels
      // changed -- an image's pixels change exactly once. Bumping on every event
      // would make `error` look like new content, and the render loop's whole
      // dirty check is "has this version moved".
      if (eventName === 'media-load') this.#version++
      this.#events.emit(eventName, {
        target: this,
        error: eventName === 'media-error' ? new Error(`failed to load ${this.#element.src}`) : undefined
      })
    }, { signal: this.#abort.signal })
  }

  /**
   * How many DOM listeners this source currently holds.
   *
   * Public and read-only on purpose: "did dispose actually remove everything" is
   * otherwise unobservable, and the legacy codebase leaked listeners in four
   * files for exactly that reason. Every listener here goes through one
   * `AbortSignal`, so `dispose` aborts the controller and the count goes to zero
   * in one place -- see `dispose`.
   */
  get listenerCount (): number {
    return this.#listenerCount
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

- [x] **Step 3: 跑测试**

Run: `npm run test:integration -- image-source`
Expected: 4 个测试 PASS

- [x] **Step 4: Commit**

```bash
git add src/media/image-source.ts test/integration/image-source.test.ts
git commit -m "feat(media): image source with abortable listeners and a load-state guard"
```

> **（2026-09-21 登记，Task 3 勘误与质量审查，落地于 83a8fde / b67c1f1 / 43105a6）**
> 1. **覆盖率兜底（83a8fde，走卡内预写路径）**：`image-source.ts` 入库后 `test:coverage` 红（Stmts 89.84 / Branches 86.66 / Funcs 85.91 / Lines 90.52）——该类每条路径都要真实 `<img>` 与浏览器事件，node 项目执行不到，浏览器项目不报覆盖率。按任务卡「确实测不到才加 exclude 并写明理由」：`vitest.config.ts` 追加该文件至 coverage exclude，附 8 行英文理由（mock DOM 只会把作者假设回放成「测试」）；thresholds 未动，全仓回到基线 99.13 / 97.94 / 100 / 99.69。实现代码零偏离：plan 的 image-source.ts 与测试经 /tmp 转写 `cmp` 逐字节核对相同（136 + 61 行）。
> 2. **质量审查补测（b67c1f1）**：变异测试（14 个变异体，6 杀 8 活）证明 plan 自带 4 条测试有六类行为未被观测（代码正确，测试因错误理由通过）：dispose 的 `abort()`（僵尸监听仍向新订阅者派发）、`maxTextureDimension` 选项与 `uploadScale` getter（零覆盖，回归即超限上传撞设备校验——正是 downscale 要防的）、media-error 载荷（`error`/`target` 是公开 API）、`markFramePresented` 的 no-op 与 `version === 1` 精确值（回归即每渲染帧重传纹理）、dispose 的 `src=''` 释放（回归即已销毁源永远可上传）。补 3 条新测试 + 原测试内 3 处加固断言（7/7）；测试 4 更名「dispose zeroes the listener count」——原名声称了断言没测的事。复审重放：六个存活非等价变异体（M3/M5/M7/M8a/M9/M10）全灭、各命中设计断言、零误杀。
> 3. **注释修正（b67c1f1 / 43105a6）**：`u_TexProjType` 这个 uniform 不存在（真实链路 `textureProjectionCode` → 相机 uniform 的 `texProjKind` 字段，uniforms.ts:46 / panorama.wgsl:25；stale 名承自 constants.ts:57，属 P3 遗留不在本 diff）；「Uploads exactly once.」→「Uploaded exactly once.」（类不上传任何东西，上传的是后端，且只传一次，因为 version 只动一次）；`listenerCount` TSDoc 两轮修正：计数随 abort 手工归零，认证的是「dispose 跑了」而非「监听器已摘」，其独有可观测物是监听器簿记——「did dispose run」由继承的 `isDisposed` 公开回答。
> 4. **等价变异体裁定（登记不测）**：M1c（无条件 bump：img 只发 `load`，分歧态经 `frame`（0×0 抛出）公开不可读）；M6（删 `crossOrigin`：击杀需第二源 + ACAO 头，同源 fixture 下不可分，跨源污染会在 gate 层暴露）；8192 **默认值**不补钉（需 >8192px 素材，与选项路径已钉的精度不成比例——控制器裁定）；M8b（scale↔width 互换）被 M8a 的 `toBe(0.5)` 击杀吸收。

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

- [x] **Step 1: 写集成测试**

`test/integration/video-source.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { VideoSource } from '../../src/media/video-source'

/*
 * Direct, like the image tests: this file is in the page, so a video source is
 * just a class. Nothing here needed a GPU either -- what it needed was a real
 * `<video>`, and running in a browser supplies that for free.
 */

/** Waits for one named event, or gives up. Every test below needs this. */
function once (src: VideoSource, name: 'media-load' | 'media-pause' | 'media-play' | 'media-seeked' | 'media-ended'): Promise<void> {
  return new Promise(resolve => {
    const off = src.on(name, () => { off(); resolve() })
  })
}

/** A loaded, ready-to-play source. */
async function loaded (): Promise<VideoSource> {
  const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
  await once(src, 'media-load')
  return src
}

describe('VideoSource', () => {
  it('reports a zero size before metadata loads', () => {
    const src = new VideoSource('/fixtures/clip.mp4', { maxTextureDimension: 8192 })
    expect(src.naturalSize).toEqual({ width: 0, height: 0 })
    expect(() => src.frame).toThrow(/metadata/i)
    src.dispose()
  })

  it('advances the version when the render loop ticks the source', async () => {
    // This is what drives per-frame re-upload. If it does not advance, a playing
    // video renders its first frame forever.
    //
    // The tick comes from the render loop and not from a DOM event, because no
    // event is fine-grained enough -- so that is what the test does. The
    // end-to-end half (a playing video whose drawn pixels actually change) is
    // P5's video user story; this pins the source's side of the contract.
    //
    // `play()` first, and that is not incidental: the tick only advances a video
    // that is actually producing frames. See the paused test below for the other
    // half of that guard.
    const src = await loaded()
    await src.play()

    const a = src.frame.version
    for (let i = 0; i < 3; i++) src.markFramePresented()
    const b = src.frame.version

    src.dispose()
    expect(b).toBeGreaterThan(a)
  })

  it('does not advance a paused video, so the loop can stop', async () => {
    // The other half of the guard, and the one that decides whether a viewer of
    // a paused video burns a full-screen fragment shader at the display's
    // refresh rate for as long as it is alive.
    //
    // The loop draws when the version moves and calls `markFramePresented` from
    // inside a draw, so "advance on every drawn frame" is self-sustaining: draw
    // -> bump -> draw. Nothing in v1 caps that (the legacy MAX_FRAME_RATE = 60
    // is gone), so the video's own state has to be what bounds it.
    const src = await loaded()
    await src.play()
    const paused = once(src, 'media-pause')
    src.pause()
    await paused

    // Read before dispose: dispose pauses the element too, so reading it
    // afterwards would assert teardown instead of the precondition.
    expect(src.element.paused).toBe(true)

    const a = src.frame.version
    for (let i = 0; i < 3; i++) src.markFramePresented()
    const b = src.frame.version

    src.dispose()
    expect(b).toBe(a)
  })

  it('resumes a stopped loop from the play event', async () => {
    // Why `media-play` bumps at all. Once a paused video stops advancing, the
    // loop stops drawing -- and `markFramePresented` is only reachable from
    // inside a draw. So without a bump from the event, a resumed video would
    // need a frame to get a frame: a deadlock whose symptom is "the video never
    // comes back".
    const src = await loaded()
    await src.play()
    const paused = once(src, 'media-pause')
    src.pause()
    await paused
    const stopped = src.frame.version

    // The listener goes on BEFORE play(): `play()` resolves after the event has
    // fired, so a listener attached afterwards would wait for a second play that
    // never comes, and the test would hang instead of failing.
    const played = once(src, 'media-play')
    await src.play()
    await played
    const resumed = src.frame.version

    src.dispose()
    expect(resumed).toBeGreaterThan(stopped)
  })

  it('reaches the screen on a seek while paused', async () => {
    // Same deadlock, different trigger: `media-seeked` is the only event that
    // reports "the displayed frame is now a different one" for a video that is
    // not playing.
    const src = await loaded()
    expect(src.element.paused).toBe(true)
    const before = src.frame.version

    // Halfway rather than a fixed second: the fixture only has to be a few
    // seconds long, and a seek past the end reports the end instead of a new
    // frame.
    const target = src.element.duration / 2
    expect(target).toBeGreaterThan(0)
    const seeked = once(src, 'media-seeked')
    src.element.currentTime = target
    await seeked

    const after = src.frame.version
    src.dispose()
    expect(after).toBeGreaterThan(before)
  })

  it('draws the last frame of a video', async () => {
    // Why `media-ended` bumps too. Once the video ends, `ended` and `paused` are
    // both true, so `markFramePresented` will never advance the version again --
    // and the decoded final frame may not have been drawn yet, because the loop's
    // next tick is what would have drawn it. Without this bump the video visibly
    // stops one frame early, which reads as "the video is fine, it just ends
    // there".
    //
    // The seek to just before the end is what keeps the test fast; it is
    // deliberate that the version is read AFTER the seek has settled, so what the
    // assertion measures is the ending and not the seek.
    const src = await loaded()
    const seeked = once(src, 'media-seeked')
    src.element.currentTime = Math.max(0, src.element.duration - 0.3)
    await seeked
    const before = src.frame.version

    const ended = once(src, 'media-ended')
    await src.play()
    await ended
    const after = src.frame.version

    src.dispose()
    expect(after).toBeGreaterThan(before)
  })

  it('hands out a fresh frame instead of a cached one', async () => {
    // The hazard: importExternalTexture's result is destroyed when the task that
    // made it ends, and a bind group holding it does NOT keep it alive, so a
    // source that memoised its frame would hand the renderer a value describing a
    // task that is already over.
    //
    // Asserted here as the source-side property that makes the GPU behaviour safe
    // -- no caching. The GPU half (a stale external texture is a validation
    // error) is a backend concern and is pinned by P3's tests.
    const src = await loaded()

    // Identical calls on an unchanged video must still produce two objects: the
    // next draw is what advances the version, so a video that is playing is what
    // this test needs. Playing also keeps `markFramePresented` from short-
    // circuiting on a paused element.
    await src.play()
    const a = src.frame
    const b = src.frame
    src.markFramePresented()
    const c = src.frame
    src.dispose()

    expect(a).not.toBe(b)
    expect(c.version).toBeGreaterThan(a.version)
    expect(a.element).toBe(b.element)
  })

  it('stops the element and removes every listener on dispose', async () => {
    const src = await loaded()
    await src.play()
    src.dispose()
    expect(src.element.paused).toBe(true)
    expect(src.listenerCount).toBe(0)
  })
})
```
- [x] **Step 2: 实现**

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
      // The version advances on the events that change what should be on screen,
      // and NOT on every event. Getting this set wrong is a deadlock rather than
      // a glitch: the render loop only draws when a source's version moved, and
      // `markFramePresented` -- the other thing that moves it -- is only called
      // from inside a draw. A video that changed without bumping here would need
      // a frame to get a frame.
      //
      //   media-load    the first frame exists at all
      //   media-play    un-pauses a stopped loop; see `markFramePresented`
      //   media-seeked  a seek while paused has no other way to reach the screen
      //   media-ended   the last frame, drawn after `paused` has become true
      //
      // Deliberately NOT media-pause or media-progress: pausing changes nothing
      // (the current frame is already drawn), and `timeupdate` fires about four
      // times a second, which is far too coarse to be the thing that drives a
      // video at 60fps.
      if (
        eventName === 'media-load' ||
        eventName === 'media-play' ||
        eventName === 'media-seeked' ||
        eventName === 'media-ended'
      ) {
        this.#version++
      }
      this.#events.emit(eventName, {
        target: this,
        // A failed video load must reach the application as a value it can show,
        // not as a log line. Same reasoning as ImageSource.
        error: eventName === 'media-error' ? new Error(`failed to load ${this.#element.src}`) : undefined
      })
    }, { signal: this.#abort.signal })
  }

  /**
   * Advances the version while the video is actually producing frames.
   *
   * Called by the render loop after each draw, rather than driven by an event:
   * there is no DOM event for "a new frame is ready to sample", and `timeupdate`
   * fires only about four times a second. While the video plays, this is what
   * makes the next frame draw at all.
   *
   * The guard is what keeps a paused video from doing work forever. Without it
   * the version advances on every drawn frame, "drawn" is defined as "the version
   * moved", and the loop therefore redraws a full-screen fragment shader for a
   * video nobody is watching -- at the display's refresh rate, for as long as the
   * viewer is alive. The legacy codebase bounded that with a `MAX_FRAME_RATE = 60`
   * cap on draw calls; v1 has no such cap (a cap is a fixed-rate loop pretending
   * to be a reactive one), so the bound has to come from the video's own state.
   *
   * `ended` and not only `paused`: they are separate properties, `ended` stays
   * true after the last frame, and reading `paused` alone would leave a finished
   * video re-uploading at the refresh rate.
   *
   * The cost of reading the element here is one property read per drawn frame,
   * and the alternative -- a timer, or a `requestVideoFrameCallback` -- would
   * either poll or add a callback whose lifetime has to be managed alongside the
   * `AbortSignal`.
   */
  markFramePresented (): void {
    if (this.#element.paused || this.#element.ended) return
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
    this.assertAlive()
    this.#element.pause()
  }

  /**
   * How many DOM listeners this source currently holds.
   *
   * Same reasoning as `ImageSource.listenerCount`: "did dispose remove
   * everything" is otherwise unobservable. This class is the more interesting
   * case of the two, because it binds ten listeners -- the eight DOM event names
   * in the shared `MEDIA_EVENT_MAP`, plus `loadedmetadata` (which is what makes
   * the natural size meaningful and has no image equivalent) and `timeupdate` --
   * and drops every one of them by aborting a single signal.
   */
  get listenerCount (): number {
    return this.#listenerCount
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

- [x] **Step 3: 补一条朝向一致性测试**

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
 * An ordinary module, and it runs in the page like everything else here: no
 * driver, no serialization boundary. The one thing this still needs is its own
 * device, because it must build pipelines the backend would never build.
 */

/** One upload path's output: RGBA8, top-down, row-major. */
export interface PathRender {
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
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
 * @param url - Video URL, same-origin so the external texture is not tainted.
 * @param size - Square render size. 64 keeps the readback's bytesPerRow at the
 *   256-byte alignment `copyTextureToBuffer` demands.
 */
export async function renderVideoBothPaths (
  url: string,
  size = 64
): Promise<{ external: PathRender, copy: PathRender }> {
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

  const readTarget = async (): Promise<Uint8Array> => {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToBuffer({ texture: target }, { buffer: readback, bytesPerRow }, [size, size])
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    // Copied out before `unmap`: the mapped range is only valid until then.
    const rgba = new Uint8Array(readback.getMappedRange().slice(0))
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

  // A uniform frame is useless as a probe -- the test would pass on a black
  // screen -- and so is one whose top half and bottom half happen to match:
  // "is this upside down" is a question about the top against the bottom, so
  // the frame has to have a top and a bottom to tell apart. Hence the mean of
  // each half rather than "are there two colours in here".
  const halfMean = (from: number, to: number): number => {
    let sum = 0
    let count = 0
    for (let y = from; y < to; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        sum += external[i]! + external[i + 1]! + external[i + 2]!
        count += 3
      }
    }
    return sum / count
  }
  const half = Math.floor(size / 2)
  const top = halfMean(0, half)
  const bottom = halfMean(half, size)
  if (Math.abs(top - bottom) < 8) {
    throw new Error(
      `the fixture frame has no top/bottom contrast (top ${top}, bottom ${bottom}); ` +
      'orientation cannot be judged from it'
    )
  }

  return {
    external: { width: size, height: size, rgba: external },
    copy: { width: size, height: size, rgba: copy }
  }
}
```

> **这里的两个 readback 都是 RGBA，不需要换通道序。** 渲染目标是显式建的 `rgba8unorm` 纹理，
> 不是 canvas，所以 `getPreferredCanvasFormat()` 的 BGRA 不适用。P3 的 `bgraToRgba` **不要**
> 用在这里 —— 那会把已经正确的通道序换错一次，而且换完两边同时错、测试照过。

`test/integration/video-orientation.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { renderVideoBothPaths } from './support/upload-paths'

/*
 * The largest per-channel difference between two readbacks.
 *
 * Defined here rather than in a shared helper: it is six lines, it has exactly
 * one caller, and the tolerance below only means anything next to the reason for
 * it. A shared module holding this one function would be a file whose only
 * content is a subtraction.
 */
function maxChannelDiff (a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('readbacks differ in size')
  let max = 0
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!))
  return max
}

/*
 * The two upload paths must agree on orientation.
 *
 * importExternalTexture has no flipY option; copyExternalImageToTexture does.
 * If they disagree, a browser that falls back to the copy path renders the
 * video upside down relative to one that uses external textures -- a bug that
 * only appears on some devices and looks like a shader problem.
 */
describe('video upload paths', () => {
  it('produce the same orientation', async () => {
    const { external, copy } = await renderVideoBothPaths('/fixtures/clip.mp4')
    // Not zero: the two paths do different colour-space conversions, so a couple
    // of levels of difference is expected. What must not happen is a whole frame
    // being mirrored, which moves every pixel that matters.
    expect(maxChannelDiff(external.rgba, copy.rgba)).toBeLessThanOrEqual(2)
  })
})
```
- [x] **Step 4: 跑测试**

Run: `npm run test:integration -- video-source video-orientation`
Expected: video-source 8 条 + video-orientation 1 条，全 PASS

**`video-orientation` 失败时**：**不要直接给 copy 路径加 `flipY: true` 试**。先确认是**哪一条**需要翻 —— 把读回按行切成上下两半，看哪一条是倒的（探针里的 `split` 检查保证测试帧上下两半的均值差 ≥ 8，否则这条判断无从做起）。翻错了就是把对的翻成错的。若最终必须翻，改动落在**后端**（`WebGPUBackend` 的 copy 路径），不在本层。

- [x] **Step 5: Commit**

```bash
git add src/media/video-source.ts test/integration/video-source.test.ts test/integration/video-orientation.test.ts test/integration/support/upload-paths.ts
git commit -m "feat(media): video source that never caches a frame

A video frame is valid only inside the task that produced it, and a bind
group holding an external texture does not keep it alive. The two upload
paths also disagree about flipY, so orientation is pinned by a probe that
drives both browser APIs directly rather than assumed."
```

> **（2026-09-22 登记，Task 4 勘误与质量审查，落地于 ed7203b / 9672634 / 8fa3f41 / e15a30d）**
> 1. **覆盖率兜底（9672634）**：`video-source.ts` 与 image-source 同理入 coverage exclude（每条路径都要真实 `<video>` 与解码器，node 项目执行不到；浏览器项目不报覆盖率）。thresholds 未动，全仓基线 99.13 / 97.94 / 100 / 99.69 无漂移。实现与 8 条测试的其余部分与 plan 逐字相同（经 /tmp 转写 `cmp` 核对）。
> 2. **Step 3 探针两处实测否决 plan 原文（8fa3f41）**：
>    - **拷贝几何**：`copyExternalImageToTexture` **不缩放** —— copySize 小于源时只拷左上角区域。plan 的 `[size, size]` 拷贝在 512×256 素材上等于左上象限内的 64×64 纯色裁剪，渲染恒定跟踪单象限调色板（实现者测得的「恒定色、t=0.2 变色、min=max」全部由此而来，一度被误诊为平台缺陷）。改为按源自然尺寸建 copied texture 并拷贝（`size = [videoWidth, videoHeight]`，copySize 同），归一化 UV 采样把整帧缩进 64×64 目标。实测 maxChannelDiff(external, copy) = 1 ≤ 容差 2。另测得：Dawn 要求拷贝目的地同时带 `COPY_DST | RENDER_ATTACHMENT`，违规是**静默**零初始化纹理，诊断须 `pushErrorScope('validation')`。
>    - **seek 加固**：`loadeddata` 后仍暂停的 Chromium 视频没有 GPU 后备帧 —— `importExternalTexture` 即便 readyState 4 也抛 "doesn't have back resource"。探针在 `video.pause()` 后补 `video.currentTime = Math.min(0.5, video.duration / 2)` + await `seeked`（仍暂停、仍单帧），强制解码建立 GPU 帧；`Math.min` 取中点是为极短素材兜底。
>    - 由此，plan 尾部「留给 P3 的一处依赖」中「Step 3 的探针已经证明这条回落与 external 路径的行序一致」一句：原探针因拷贝几何 bug 什么也没证明；**修复后该断言现在为真**（maxChannelDiff = 1）。
> 3. **质量审查（e15a30d）**：变异测试 22 个变异体（源码 17 + 探针 5），源码无存活变异体指向缺陷、探针 MO1（copy 路径 flipY 翻转）被测试以 diff 173 击杀。六类测试缺口补强（各精确击杀一个目标变异体）：media-load bump（M4）、last-frame 基线读取时序（M7 —— 原测试在 play bump 落定前读基线，删掉 media-ended bump 照样通过）、maxTextureDimension 接线（M12，256 上限 → 256×128 精确态）、dispose 拆除三断言（M14 src 释放 / M15 僵尸监听器经 timeupdate / M16 监听器计数前置为 10）、media-error 载荷（M17，404 镜像 image 侧测试）。测试数 8 → 12。四处注释按实测勘误：HAVE_METADATA 已知尺寸（C1）；Chromium 播完时 paused 亦真，`ended` 项是规范防御（C2）；loadeddata 保证「有帧」不保证「GPU 帧」（C3）；`load()` 算法自身中断抓取（C4）。等价/良性裁定不测：M1（Chromium 实测播完 paused=true，单删 `ended` 项不可区分）、M8/M9（过冲 bump 良性）、M13（dispose 里的 pause() 被 load() 算法吸收）、MO2–MO5（测试削弱/元变异，按设计接受）、MO4（共享 VERTEX 翻转保路径一致；朝向 ground truth 归 gate A）。最终 13/13（12+1）通过。
> 4. **中断记录**：质量复审于 2026-09-22 00:20 撞 5 小时 API 限额中断（M4/M7/M12 已完成在案；树干净、无变异体残留，经控制器亲验），03:19 限额重置后续做完成 M14–M17 与终验。

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
import { describe, it, expect } from 'vitest'
import { InputController } from '../../src/interaction/input-controller'
import { WheelDeltaMode } from '../../src/interaction/gestures'

/**
 * A positioned element to drive. Each test makes its own, and the page is torn
 * down between test files, so nothing has to be cleaned up by hand.
 */
function host (style: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
  const el = document.createElement('div')
  Object.assign(el.style, { width: '400px', height: '300px', position: 'fixed', top: '0px' }, style)
  document.body.appendChild(el)
  return el
}

/** One complete press-drag-release, in page coordinates. */
function drag (el: HTMLElement, from: [number, number], to: [number, number]): void {
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: from[0], clientY: from[1], bubbles: true }))
  el.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: to[0], clientY: to[1], bubbles: true }))
  el.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: to[0], clientY: to[1], bubbles: true }))
}

describe('InputController', () => {
  it('pans the camera and emits pan events', () => {
    const el = host()
    const input = new InputController(el)
    const pans: Array<{ deltaX: number, deltaY: number }> = []
    input.on('pan', e => pans.push(e))

    drag(el, [100, 100], [150, 130])
    input.dispose()
    expect(pans).toEqual([{ deltaX: 50, deltaY: 30 }])
  })

  it('with PTZ = false stops the events without unbinding', () => {
    // Toggling must not rebind listeners; rebinding on every toggle is itself a
    // leak source. So the assertion is both "no events" and "re-enabling works".
    const el = host()
    const input = new InputController(el)
    let count = 0
    input.on('pan', () => count++)

    drag(el, [0, 0], [10, 0])
    const afterEnabled = count

    input.PTZ = false
    drag(el, [0, 0], [20, 0])
    const afterDisabled = count

    input.PTZ = true
    drag(el, [0, 0], [30, 0])
    const afterReenabled = count

    input.dispose()
    expect(afterEnabled).toBe(1)
    expect(afterDisabled).toBe(1)
    expect(afterReenabled).toBe(2)
  })

  it('carries wheel constants that still match the real WheelEvent', () => {
    // gestures.ts restates deltaMode's numbers instead of reading the global, so
    // that it stays testable in Node. This is the other half of that trade: the
    // restated values are checked against the browser's.
    expect(WheelDeltaMode.PIXEL).toBe(WheelEvent.DOM_DELTA_PIXEL)
    expect(WheelDeltaMode.LINE).toBe(WheelEvent.DOM_DELTA_LINE)
    expect(WheelDeltaMode.PAGE).toBe(WheelEvent.DOM_DELTA_PAGE)
  })

  it('restores touch-action on dispose', () => {
    // The viewer sets touch-action: none on an element it does not own. Leaving
    // it set would stop the host page from scrolling over that element forever.
    const el = host({ touchAction: 'pan-y' })
    const input = new InputController(el)
    expect(el.style.touchAction).toBe('none')
    input.dispose()
    expect(el.style.touchAction).toBe('pan-y')
  })
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
- [ ] `dispose()` 后每个源的 DOM 监听数归零，且这个数字是**公开可读的**
- [ ] `src/media/` 下不存在 `frameSize` 及其任何同义词
- [ ] 本层不重新定义 `SourceState`，只组合 core 的那一个
- [ ] 源不缓存帧（同一任务内两次读 `frame` 得到两个对象）
- [ ] external / copy 两条上传路径的朝向一致
- [ ] **暂停的视频不再推进版本号** —— 播放中会前进，暂停后不动，`play()` / seek 之后又能继续动（否则渲染循环要么永远重画，要么永远醒不过来）
- [ ] `PTZ = false` 不产生事件，且重新打开后恢复
- [ ] `touch-action` 在 dispose 时还原
- [ ] 不存在任何 2 的幂量化逻辑
- [ ] 本阶段的集成测试**直接 import `src/media/` 与 `src/interaction/` 的类**，仓库里没有重新长出 `demo/test-entry.ts`、`test-entry-hooks/` 或 `window.__panoTest`
- [ ] `public/fixtures/panorama.png` 与 `public/fixtures/clip.mp4` 已由 `scripts/gen-fixtures.mjs` 生成并提交，且 `ffprobe` 复核为 `512x256`、`64` 帧（P5 的全部 User Story、P6 的后端对比都读它们）

## 交给下游的东西

| 产物 | 消费者 |
|---|---|
| `EventEmitter` / `Disposable` | P5 的 `Viewer`，P6 的 WebGL2 后端 |
| `MediaSource` 接口（`frame` / `naturalSize` / `on` / `markFramePresented`） | P5 的 `Viewer` 持有它 |
| `MediaFrame` | **就是 P3 的 `RenderableSource`**（本计划写成 `type` 别名），P5 原样交给 `Backend.setSource`，全程无转换 |
| `MediaFrame.version` | P5 的脏检查；P3 据此决定是否重传 |
| `MediaFrame.state`（即 core 的 `SourceState`） | P3 的上传尺寸与 `projection` uniform |
| `MediaSource.markFramePresented()` | P5 的渲染循环每画一帧调一次 —— **播放中**视频的版本号靠它前进；暂停的源不会动 |
| **视频源自己会在 `load` / `play` / `seeked` / `ended` 上推进版本号** | P5 的渲染循环**不需要**为「视频暂停后循环停了怎么再启动」做任何事 —— 重新播放和 seek 都会自己把版本号推一下，循环因此醒来。**不要在 Viewer 里加定时重绘或者忽略脏标记**，那会把这条契约弄坏 |
| `listenerCount`（两个源各一个） | P5 的监听器泄漏断言；P6 的后端替换不该动它 |
| `InputController` 的语义事件 | P5 的 `Viewer` 把 `pan`/`zoom` 转成相机动作 |
| `WheelZoom` 常量 | 没有下游，但**它是行为变更**：旧版鼠标滚轮与触控板共用一个除数 |
| `public/fixtures/` 的两个素材 | P5 的全部 User Story、P6 的后端对比都从 `/fixtures/...` 取它们。**P4 之后不再有人产出它们**，所以这一条是下游能不能跑起来的硬前提 |
| `renderVideoBothPaths` 里「两个 readback 都是 RGBA」的结论 | **P6 的补充证据**：P3 只说了「canvas 的 readback 在 macOS 上是 BGRA」，没说什么情况下不是。这里是另一半 —— 显式建的 `rgba8unorm` 纹理走 `copyTextureToBuffer` 出来就是 RGBA，跟 canvas 的 `getPreferredCanvasFormat()` 无关。判据是**读的是不是 canvas**，不是读的是哪个后端 |

> **给 P5 的一条纪律**：P4 的集成测试直接 import `src/media/` 与 `src/interaction/` 的类，那是因为
> P4 交付的**就是这两个类**。P5 交付的是 `FramelessImageViewer` / `FramelessVideoViewer`，
> 所以 P5 的用户故事测试必须 import `src/index.ts` —— 用户故事测的是「拿走这个包的人能不能用」，
> 绕到内部模块去断言等于把出口的形状从测试里删掉了。以前这条由 `window.__panoTest` 只有一个出口
> 隐式保证，现在没有东西机械地拦着，只能靠 review（P3 的交接里已经写过同一句，这里是它在 P5 的落地）。

## 留给 P3 的一处依赖（本计划改不动）

**视频的 external texture 导入失败时没有回落分支。** P3 的 `WebGPUBackend.render()` 对 `source.kind === 'video'` 无条件走 `importExternalTexture`；如果某个设备上这一步抛错，异常会一路走到 `RenderLoop` 的 `onError`，结果是一块不再更新的画布 —— 正是本计划 Task 4 想避免的那种「静默冻住」。可用的回落是 `copyExternalImageToTexture` 到一张 rgba8unorm 纹理，也就是图片那条路径；**Step 3 的探针已经证明这条回落与 external 路径的行序一致**，所以补它不会再引入第二个朝向 bug。

这属于 `src/renderer/webgpu/backend.ts`，本计划无权修改，**由 P3 补上**：`render()` 里对视频先试 import，失败则退到 copy 路径，并把 `Capabilities.externalTextures` 置为 `false` 让应用看得见。
