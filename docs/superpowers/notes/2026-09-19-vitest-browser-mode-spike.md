# Vitest browser mode 可行性验证（替代 Playwright 跑集成测试）

日期：2026-09-19
问题：集成测试能否不用 Playwright，改用 Vitest 的浏览器模式？
结论：**能，而且更适合这个项目。** 下面是实测记录，不是推断。

环境：macOS 24.5.0 / Node v22.23.2 / vitest 5.0.1 / @vitest/browser-playwright 5.0.1 /
playwright 1.56 / 本机装有 Google Chrome。夹具在 `/tmp/vitest-browser-gpu/`。

---

## 1. 结论摘要

Vitest browser mode 能拿到**真实 GPU**，能**回读像素**，能**读二进制 fixture**，能
**配置 deviceScaleFactor**，能**在同一个页面里同时用 WebGPU 和 WebGL2**——门禁 A/B/C
需要的能力它一样不缺。

同时它**删掉了整个 `window.__panoTest` 桥接层**：那套东西存在的唯一理由是 Playwright
测试跑在 Node 里、够不着页面。browser mode 的测试文件**本身就在页面里**，可以直接
`import { FramelessImageViewer } from '../../src'`。`PanoTestApi` 全局接口、
`demo/test-entry.ts`、`demo/test-entry-hooks/*.ts`、`import.meta.glob` 装配、
type-only import 拉增强、以及为此拆的两个 tsconfig program——全部不再需要。

成熟度方面的顾虑也已解除：browser mode 在 **Vitest 4.0 转为稳定**（2025-10），当前
5.0.1；v4 起支持生成 **Playwright trace**，失败时还会自动截图
（`.vitest/attachments/failure-screenshots/`）。

---

## 2. 实测：能力验证

5 个测试全绿（`npx vitest run`，耗时 685ms）：

| 验证项 | 结果 |
|---|---|
| `navigator.gpu` + `requestAdapter()` | 非空，`apple/metal-3` |
| 全屏三角形（无顶点缓冲，位置由 `vertex_index` 推出）+ `copyTextureToBuffer` 回读 | 通过，读出正确的水平渐变 |
| 同页面内 WebGL2 + `readPixels` | 通过，`[0,255,0,255]` |
| 二进制 fixture 经 Vite dev server `?url` + `fetch` 读取 | 通过，10 字节逐字节相等 |
| `contextOptions.deviceScaleFactor: 2` 传到页面 | 通过，`window.devicePixelRatio === 2` |

全屏三角形用的就是本项目的画法（`vertex_index` 推位置、无属性、无缓冲），说明
「一个三角形 + fragment 里做投影」这套在 browser mode 下没有任何额外摩擦。

---

## 3. 实测：五个坑（必须写进 plan）

### 坑 1（最重要）：`instances[].launch` / `instances[].context` 会被静默忽略

Vitest 5 里 launch/context 选项挂在**provider 工厂**上：

```ts
provider: playwright({
  launchOptions: { channel: 'chromium' },
  contextOptions: { deviceScaleFactor: 2 },
})
```

放在 `instances[].launch` / `instances[].context` 上**不报错、不警告**，直接被丢掉，
于是你拿到的是 Playwright 自带的 headless chromium——**一个没有 GPU 的浏览器**。
实测：配 `instances[].launch.channel = 'chromium'` 时 `requestAdapter()` 返回 null；
改成 provider 工厂写法后立刻变成 `apple/metal-3`。

这类「配置被吞掉、然后静默换了个环境」正是最难查的失败模式，写进 plan 时要说清。

依据：`@vitest/browser-playwright/dist/index.js:921-925`，
`resolveLaunchOptions()` 只展开 `providerOptions.launchOptions`。

### 坑 2：Playwright 自带的 headless chromium 没有 GPU

| 启动方式 | adapter |
|---|---|
| 自带 chromium，headless | **null** |
| 自带 chromium，headed | 可用 |
| `channel: 'chromium'`，headless | 可用 |
| `channel: 'chrome'`，headless | 可用 |

所以 `channel: 'chromium'` 是**承重**的——这不是 CI 偏好问题，是没有它就没有 GPU。
（原设计已经这么写了，此处是为它补上实测依据。）

### 坑 3：`getPreferredCanvasFormat()` 在 macOS 上是 `bgra8unorm`

字节序是 **B,G,R,A**。任何按 RGBA 下标取通道的像素比对代码都会读错通道。
实测：把 byte 0 当红色读到恒为 0，改读 byte 2 立刻正确。

这条影响门禁 A/B/C 和 P0 冻结的基线像素 fixture：**基线必须以明确的通道序落盘**，
并且比对前统一。P0 不把这个定死，后面三个门禁会一起继承这个歧义。

### 坑 4：每个 instance 不能有自己的 launch 选项 → 「有 GPU / 无 GPU」必须是两个 project

因为 launch 选项在 provider 层，`instances` 里放两个浏览器拿不到两套启动参数。
需要两个 `test.projects`，各自带自己的 provider 工厂。实测可用：

```
✓ |gpu (chromium)|        [spike] adapter=true  webgl2=true dpr=2
✓ |no-webgpu (chromium)|  [spike] adapter=false webgl2=true dpr=1
```

### 坑 5：`--disable-features=WebGPU` 不起作用，`--disable-gpu` 才是开关

| 启动参数 | `navigator.gpu` | adapter | webgl2 |
|---|---|---|---|
| 无 | 有 | 可用 | 有 |
| `--disable-features=WebGPU` | 有 | **可用** | 有 |
| `--disable-gpu` | 有 | **null** | **有** |
| `--disable-gpu --disable-software-rasterizer` | 有 | null | **无** |

`--disable-gpu` 给出的正是降级路径要测的那个真实条件：`navigator.gpu` 存在、
`requestAdapter()` 返回 null、WebGL2 仍然可用。**这比在应用里加一个「强制走 WebGL2」
的测试钩子强得多**——它测的是真实环境，而不是我们自己的开关。

（注意别加 `--disable-software-rasterizer`，那会把 WebGL2 一起干掉。）

---

## 4. 对 plan 的影响

| plan | 变化 |
|---|---|
| P1 | 删 `playwright.config.ts`；vitest 配置改 `projects`（`unit` 走 node，`integration` 走 browser）；`test:integration` 变成 vitest 的一个 project；**两个 tsconfig program 的拆分可以取消**（没有 `demo/` 桥接层要收了） |
| P3 | `PanoTestApi` / `test-entry.ts` / `test-entry-hooks/*` / `import.meta.glob` 装配 / type-only import 拉增强——**整节删除**；Tsconfig 相关讨论随之简化 |
| P4 / P5 | 集成测试直接 import 被测类，不再经 `window.__panoTest` |
| P6 | 降级测试改用 `--disable-gpu` 的第二个 project，测真实降级而非强制开关 |
| P7 | 清理项里的 playwright 引用换成 vitest browser mode |

**保留的一条纪律**（换了跑法也要留）：用户故事级集成测试**只走 `src/index.ts` 的公开
API**；门禁测试可以 import 内部模块。原来这条是由桥接层的形状隐式保证的，现在要靠
约定 + review 保证，得写进 plan 说清楚。

---

## 5. 还没验的

- 视频解码相关的集成测试（真 `<video>` + 真实编码）。browser mode 用的是真浏览器，
  按说不成问题，但没有实测过。
- 浏览器项目下的覆盖率统计。不过 90% 分支覆盖率本来就是**单元测试**的要求（跑在 node），
  集成测试不带覆盖率门槛，所以不影响。
- 多标签页/多窗口场景。本项目不需要。
