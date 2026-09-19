# Stage-0 探路报告：headless CI 渲染可行性

**日期**：2026-09-19
**目的**：在写重构设计之前，先确定「分层测试」方案里 L3（golden image）和 L4（双后端像素交叉验证）到底能不能在无头 CI 里跑起来。如果不能，测试分层的设计必须重做。
**结论**：**可以跑，而且比预期好** —— 无头 Chromium 用的是真实 GPU（Apple M2 / Metal），不是软件光栅化。但有两个必须先知道的陷阱，见 §4。

---

## 1. 结论摘要

| 能力 | 结论 | 证据 |
|---|---|---|
| 无头跑 WebGL1 | ✅ | 渲染回读 `[64,128,191,255]` |
| 无头跑 WebGL2 | ✅ | 同上，默认帧缓冲亦通过 |
| 无头跑 WebGPU | ✅ | 真实 Metal 适配器，离屏渲染回读精确 |
| WebGPU 画布/交换链路径 | ✅ | `configure()` + `getCurrentTexture()` 出图 |
| 视频零拷贝路径 `importExternalTexture` | ✅ | 三条来源全部出图（见 §3.3） |
| 真实视频**解码** | ✅ | VP8 webm 解码后采样正确；H.264 亦报告 `probably` |
| 同后端多次运行**逐比特可复现** | ✅ | 256×256 float 缓冲哈希完全一致 |
| 跨后端（Metal vs SwiftShader）**逐比特一致** | ❌ | 哈希不同，最大偏差 `5.4e-5`（亚像素） |
| 无 GPU 环境的降级路径（SwiftShader） | ✅ | 全部能力可用，含视频 |
| Playwright 默认 headless（headless shell） | ⚠️ **降级** | WebGL1/2 走 **SwiftShader**；**WebGPU 不可用** |

---

## 2. 环境与方法

- **机器**：macOS 15.5 (Sequoia), arm64, Apple M2
- **浏览器**：Chrome for Testing **149.0.7827.55**（首个探针）与 **153.0.8010.12**（Playwright 1.63.0 配套）
- **Node**：v22.23.2
- **驱动方式**：两套。先是零依赖直连 Chromium 二进制（当时 npm registry 不可达），网通后用 **Playwright 1.63.0** 重做 —— 因为 Playwright 才是项目的集成测试会用的工具，「工具怎么启动浏览器」本身就是被验证的对象之一。

### 测试方法

不用 CDP，也不用 `--dump-dom`（后者与异步 GPU 调用之间有竞态）。探测页跑完所有检查后把结果交出（Playwright 驱动读 `window.__spikeReport`；零依赖驱动走 POST 回传）。全程无时序假设。

**关键设计：每个后端都真的渲染并回读像素，而不是只检测 API 是否存在。** 一个能创建但画不出东西的 context 对 golden image 回归毫无价值，只查 API 存在性会给出假阳性 —— §4 陷阱一正是这种假阳性的实例。

探针代码：`.vibe/spike/`
- `index.html` —— 探测页（WebGL1/2、WebGPU、投影 parity、视频三路径）
- `run-playwright.mjs` —— Playwright 驱动（**主要**，验证 CI 真实形态）
- `run.mjs` / `analyze.mjs` —— 零依赖驱动 + 确定性分析
- `shell-renderer.mjs` / `args-probe.mjs` —— headless shell 差异定位

---

## 3. 逐项发现

### 3.1 后端能力矩阵

| 配置 | WebGL1 | WebGL2 | WebGPU | 适配器 |
|---|---|---|---|---|
| `--headless=new`（默认） | PASS | PASS | PASS | **apple / metal-3** |
| `+ --use-webgpu-adapter=swiftshader` | PASS | PASS | PASS | google / swiftshader |
| `chrome-headless-shell` 二进制 | **FAIL** | **FAIL** | **FAIL** | — |
| `+ --enable-dawn-features=allow_unsafe_apis` | PASS | PASS | PASS | apple / metal-3 |

**默认无头就是真 GPU。** 这是最重要的单条发现：golden image 回归可以建立在真实光栅化上，而不是软件渲染的近似。

Metal 适配器暴露的 device features（请求全部后）包括：`shader-f16`、`float32-filterable`、`float32-blendable`、`subgroups`、`timestamp-query`、`depth-clip-control`、`texture-compression-astc`、`rg11b10ufloat-renderable`、`texture-formats-tier1/tier2` 等。

默认 limits：`maxTextureDimension2D=16384`，`maxBindGroups=4`，`maxBufferSize≈4GB`。

> **注意**：当前 pano.gl 支持 8192 宽的贴图。`16384` 的下限意味着即使是低端设备也够用，但 `maxBindGroups=4` 是个需要留意的约束 —— 设计中 bind group 的数量预算是 4。

### 3.2 WGSL 特性探测

| 特性 | Metal | SwiftShader | 结论 |
|---|---|---|---|
| `var<immediate>` | ❌ | ✅ | **不可依赖**，见下 |
| `enable f16;` | ✅ | ❌ | 可用但需运行时探测 |

**Immediates 的结论是「不要用」**，而且有明确证据：

- 单独 `--enable-features=WGSLImmediateAddressSpace` → **无效**
- 必须 `--enable-dawn-features=allow_unsafe_apis` → 才生效

也就是说它依赖 Dawn 的 unsafe-apis 开关。**生产环境不能依赖一个要求用户改浏览器启动参数的 WGSL 特性。** 设计上按「不支持」处理。

（SwiftShader 反而支持 immediates，说明它取决于后端实现而非 Chrome 版本。这进一步说明不能靠版本号判断。）

> 探针本身踩过一个坑，值得记下：第一次探测 `f16` 报告不支持，是因为 `requestDevice()` 没有带 `requiredFeatures`。**用没申请特性的 device 去探测特性支持，得到的必然是假阴性** —— 错误信息是 "not allowed in the current environment" 而不是 "unsupported by this adapter"。修正后 `f16=true`。

### 3.3 视频路径（本项目最吃紧的能力）

`importExternalTexture` 只验证「方法存在」是不够的 —— 它可能导入成功却画不出东西。所以三条来源都做了**端到端渲染 + 回读**：

| 来源 | 方法 | 结果 |
|---|---|---|
| `VideoFrame`（来自 canvas） | 绕过解码器，隔离 GPUExternalTexture 路径 | ✅ `[64,128,191,255]` 精确 |
| `<video>` + `captureStream()` | 真实 HTMLVideoElement 路径 | ✅ `[63,128,191,255]` |
| `<video>` + `MediaRecorder` 产出的 webm 文件 | **真实解码路径** | ✅ 解码成功，`[72,130,191,255]`（VP8 有损，容差内） |

编解码器支持：`canPlayH264: "probably"`、`canPlayVp8: "probably"`、`canPlayVp9: "probably"`。

**「H.264 可用」这条很重要**：Chrome for Testing 携带专有编解码器，意味着集成测试可以用真实的 MP4/H.264 全景视频，而不必退化成只有 VP8/WebM 的测试。

WGSL 上有一个必须注意的约束：`texture_external` **没有** sampler-less 采样入口，必须用 `textureSampleBaseClampToEdge`，普通 `textureSample` 编译不过。

### 3.4 数值确定性（决定 L3/L4 容差）

把 pano.gl 的核心运算 —— 逐片元的等距柱状投影 —— 渲染进 `rgba32float` 目标，与 float64 的 CPU 参考实现逐点比对：

| 后端 | 缓冲哈希（多次运行） | 相对 CPU 参考的最大偏差 |
|---|---|---|
| Metal | `12e0177d`（2 次运行一致） | U `2.69e-6` / V `1.71e-5` / lon `1.69e-5` / **lat `5.38e-5`** |
| SwiftShader | `fdd8aed1`（2 次运行一致） | U `3.85e-8` / V `5.96e-8` / lon `1.27e-7` / **lat `6.94e-8`** |

三条推论：

1. **同一后端内，多次运行逐比特一致**（整个 256×256 float 缓冲哈希相同）。→ **golden image 可以放心用**，不需要为「渲染噪声」预留容差。
2. **跨后端不逐比特一致**（哈希不同）—— 符合预期，三角函数实现不同。
3. **但偏差量级是可接受的**：Metal 的 `asin` 用了快速近似，误差比 SwiftShader 大约 **3 个数量级**，但绝对值仍是 `5e-5`。**换算到 4096 宽的全景纹理上约 0.4 像素 —— 亚像素。**

> 最大误差出现在 **lat 通道**，即极点附近 —— 这正是 `asin` 在 `|arg|→1` 时病态的地方。设计的容差策略必须按「极点附近放宽」来定，不能用一个全局的紧容差。

### 3.5 用 Playwright 复验（项目实际会用的工具）

前面的探测是用 Node 内置模块直连 Chromium 二进制做的 —— 那是断网环境下的权宜之计。**网通后已用 Playwright 1.63.0 重做**，因为这才是项目集成测试真正会用的工具，而「工具怎么启动浏览器」本身就是设计的一部分。

复验结果：

| 项 | 结果 |
|---|---|
| 真 GPU 下 WebGL1 / WebGL2 / WebGPU | 全部 PASS，适配器 apple / metal-3 |
| 投影哈希（Chrome 153 vs 之前 Chrome 149） | 均为 `12e0177d` —— **跨浏览器版本一致** |
| 视频解码 | OK |
| 默认 `headless: true` 的真实二进制 | `chrome-headless-shell`（见 §4 陷阱一） |

一个额外收获：投影哈希在 Chrome 149 与 153 上相同，说明**数值行为跨版本稳定**，golden image 不会因为浏览器小版本升级而失效。这比预期更好。

浏览器版本：Playwright 1.63.0 配套 **Chrome for Testing 153.0.8010.12**（revision 1243）。

---

## 4. 两个必须避开的陷阱

### 陷阱一：Playwright 默认 headless 用 headless shell，而它没有 WebGPU

这一条已经用 **Playwright 1.63.0 实测复现**（见 §3.5），不是读文档得出的。

```js
chromium.launch({ headless: true })                      // → chrome-headless-shell
chromium.launch({ channel: 'chromium', headless: true }) // → 完整 Chrome for Testing
```

两者的实测差异：

| | 默认 `headless: true` | `channel: 'chromium'` |
|---|---|---|
| 实际二进制 | `chromium_headless_shell-1243/chrome-headless-shell` | `chromium-1243/…/Google Chrome for Testing` |
| 启动参数 | `--headless` | `--headless` |
| WebGL1 / WebGL2 | ✅ 但走 **SwiftShader** | ✅ 真 GPU（ANGLE Metal / Apple M2） |
| WebGPU | ❌ `navigator.gpu` 存在，`requestAdapter()` 返回 **null** | ✅ Metal 适配器 |
| 视频解码 | — | ✅ |

**危害不在于「全黑报错」，而在于「看起来是对的」**：headless shell 下 WebGL 路径完全正常、像素也正确，只是走软件渲染且拿不到 WebGPU。如果测试只断言「画出了东西」，这个降级会被静默吞掉 —— 主后端 WebGPU 从未被测过，而 CI 一路绿灯。

> **`executablePath()` 会骗人。** 两种模式下 `browserType.executablePath()` 返回的都是完整浏览器的路径，只有 `DEBUG=pw:browser` 打出的真实命令行才暴露了实际启动的是 headless shell。我最初就是靠 `executablePath()` 差点得出**相反**的结论。设计文档里记录这条，是为了避免后来者重蹈覆辙。

**CI 侧的应对**：显式 `channel: 'chromium'`，并且**在测试启动时断言 `requestAdapter() !== null`**，把「静默降级」变成「显式失败」。§3.1 探针里的这个检查就是最小可用的守卫。

### 陷阱二：不要让任何工具默认加 `--disable-gpu`

Playwright / Puppeteer 在某些平台上会注入 `--disable-gpu`。一旦注入，§3.1 的一切全部失效。CI 配置里应当显式断言 GPU 可用（探针里的 `requestAdapter() !== null` 就是最小检查），而不是假设。

---

## 5. 对设计的影响

这一节是探路的产出，直接约束设计文档：

1. **L3（golden image）成立**，且容差可以设得很紧 —— 因为同一后端内是逐比特可复现的。golden 图可在任一后端生成。
2. **L4（双后端交叉验证）成立**，容差按**像素**而非比特定：跨后端最大偏差约 `5e-5`（亚像素），建议 8-bit 输出上用 **±1~2 LSB**，并对极点区域单独放宽。
3. **CI 后端选型要拆成两个维度**，不能只问「SwiftShader 还是真 GPU」——因为 **headless shell 给得了 SwiftShader 的 WebGL，却给不了 SwiftShader 的 WebGPU**，而 WebGPU 是主后端。
   - **推荐**：日常 CI 用 **`channel: 'chromium'` + SwiftShader**（`--use-webgpu-adapter=swiftshader --use-angle=swiftshader`）。数值上贴近 CPU 真值（`~1e-7` vs Metal 的 `~5e-5`）、不依赖 runner 有 GPU、跨机器可控；真实 GPU 另跑一轮作为端到端冒烟。
   - **无论选哪个，启动时必须断言 `requestAdapter() !== null`**，否则 headless shell 的静默降级会让整套 WebGPU 测试变成空跑而 CI 依然全绿。
4. **视频集成测试可以测真实解码**，不必退化成 captureStream。
5. **Immediates 从设计中排除**，uniform 走固定 struct + uniform buffer。「相机随便加 uniform」的旧能力本就不该保留（见设计文档）。
6. **bind group 预算 = 4**。这正好够：`{相机 uniform}` / `{采样器}` / `{贴图}` / `{外部贴图}`。分层上要注意别超。
7. **`textureSampleBaseClampToEdge` 是视频路径的强制写法**，WebGL2 降级路径没有对应物 —— 两个后端的着色器**不能共用同一份源码**，这是双后端方案里第一处必须分叉的地方。

---

## 6. 残余风险与未验证项

| 项 | 状态 |
|---|---|
| 极端片元着色器下 Metal 的误差 | 只测了一条公式。pano.gl 的 pannini/planet/cylindrical 投影含更多三角函数，误差可能更大。**建议实现阶段用同样方法对每种投影各测一次**。 |
| 非 Apple GPU（Intel / AMD / 高通） | 未验证。`5.38e-5` 是 Apple M2 的数字，其他厂商的快速近似可能更差。 |
| Linux CI（无 GPU runner） | 未验证，本机是 macOS。SwiftShader 路径在 macOS 上工作，Linux 上大概率同样可行，但**这是一条推断，不是证据**。 |
| H.264 实际解码 | 只测了 `canPlayType` 返回 `probably` 和 VP8 的实际解码。真实 MP4 播放未跑。 |
| `.glsl` 在 Node 侧的加载 | 未涉及。设计文档中要解决（CLAUDE.md 已记录该障碍）。 |

---

## 7. 复现方式

```shell
cd .vibe/spike
npm install
npx playwright install chromium

# 主要路径：Playwright，真 GPU vs 默认 headless 对比
node run-playwright.mjs

# 定位「实际启动的是哪个二进制」
DEBUG=pw:browser node args-probe.mjs 2>&1 | grep -oE '<launching> .*'

# headless shell 拿到的渲染器
node shell-renderer.mjs

# 零依赖驱动 + 确定性/跨后端分析
node run.mjs --name=metal --chrome="$CHROME" --timeout=90000
node run.mjs --name=swiftshader --chrome="$CHROME" --timeout=150000 -- \
  --use-angle=swiftshader --use-webgpu-adapter=swiftshader --enable-unsafe-webgpu
node analyze.mjs
```

---

## 8. 一句话总结

**测试分层的设计不用改，而且可以比原计划更严格。** L3 的容差因为同后端逐比特可复现而可以设紧；L4 的容差有实测数字（亚像素，`±1~2 LSB`）而不是拍脑袋。

真正的风险不在「无头能不能渲染」—— 它能，而且用的是真 GPU。风险在 **CI 的默认配置会静默降级**：Playwright 默认 headless 起的是 headless shell，WebGL 一切正常、像素也对，唯独 **WebGPU 不可用**。整套 WebGPU 测试会变成空跑而 CI 依然全绿。这个坑的危险之处不是报错，是**看起来没问题**。
