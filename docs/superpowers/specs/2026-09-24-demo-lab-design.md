# 新 demo：交互实验室（demo-lab）Design Spec

- **日期**：2026-09-24
- **状态**：设计已逐节确认（定位/功能面/布局/双页/免测/代码结构/三节设计全部经用户确认），待执行
- **关联**：消费 `src/index.ts` 冻结公开面（v1.0）；不改动 `src/` 任何文件

---

## 0. 这份 spec 决定什么

v1 能力面（四投影、双后端、视频全景、事件 API、诊断通道）远超旧 demo 的展示范围——旧 demo 只是 README 最小示例（一张 2K 图、零 UI）。本 spec 正向设计一个新 demo 页面「交互实验室」，并保留最小示例页。

**裁决记录**（用户逐项拍板，2026-09-24）：

| 决策点 | 结论 |
|---|---|
| 定位 | **交互实验室**——每个可调参数有控件 + 实时读数，调试台取向；不是 showcase |
| 功能面 | 四簇全上：相机/投影实验台、媒体源切换台、后端/能力状态栏、事件流+诊断面板 |
| 布局 | **A · 右侧停靠**（DevTools dock-right 式）：画布占剩余宽，右栏 ~34% |
| 页面结构 | **双页并存**：`index.html`（实验室主入口）+ `minimal.html`（README 逐字示例平移） |
| 测试口径 | **豁免**（用户原话：lab 是用来验证和体验功能的）；护栏 = typecheck + lint + 库自身测试面 |
| 代码结构 | **面板模块化**：`demo/lab/` 目录，main.ts 管生命周期，四面板各一文件 |

---

## 1. 页面结构与硬约束

### 1.1 双页

| 文件 | 角色 |
|---|---|
| `demo/index.html` | 实验室主入口（`npm run start` 打开 `/` 即是），引 `demo/lab/main.ts` + `demo/lab/lab.css` |
| `demo/minimal.html` | 现 `index.html` 原样改名；`#pano` 容器 + `demo/main.ts` 一字不动 |
| `demo/main.ts` | 不动——README 最小示例逐字副本的身份保留 |

### 1.2 硬约束

- **零新依赖**：裸 TypeScript + 手写 CSS。不引框架、不引 UI kit——依赖轻量是本库身份，demo 引框架自拆台面。
- **只准公开面**：lab 代码只 `import … from '../../src/index'`，禁止伸进 `src/` 内部。demo 同时是「冻结公开面够用」的活证据；哪天 lab 需要内部 import，就是公开面缺口的第一手报警。
- **零配置改动**：`vite.config.ts` 不动（dev server 以 demo/ 为 root，多页免配置；lib 构建不涉及 demo）。
- **每文件力求 <150 行**，超了就拆。
- 界面文案英文；注释英文（TSDoc 标准 + 必要的局部 why 注释，从仓库惯例）。

---

## 2. viewer 生命周期（`demo/lab/main.ts`）

实验室唯一的业务核心；四个面板围着它转。

1. **probe 先行**：`FramelessImageViewer.probe()` 问设备。`{ backend: 'none' }` 是答案不是异常——此时渲染整页「无可用后端」说明态，不建 viewer。probe 结果同时喂给状态栏面板。
2. **创建**：图模式起步（`/image/2048x1024.jpg`），初始投影/参数从 URL 查询参数读（如 `?projection=planet&zoom=0.5`）——实验室状态可存书签。
3. **同类换源**：`viewer.src = url`（`image-viewer.ts:124` / `video-viewer.ts:109`）——同设备同投影换 URL，不重建。2K↔4K↔8K 与视频重选源都走这条路。
4. **图↔视频切换**：跨类必须 dispose 重建。流程：读 `viewer.cameraOptions` → `dispose()` → 建另一类 viewer → 姿态塞回 options。
5. **viewer 引用盒**：面板不各自抓实例。main.ts 持 viewer 引用并广播 `onViewerChange`；面板在盒上订阅，换实例时重新接线（事件订阅、element 绑定全部重挂）。
6. **device-lost**：订阅 `device-lost`，整页红色横幅 +「刷新重试」。v1 无自动恢复，lab 如实展示，不假装能救。
7. **URL 同步**：lab 可调项（projection/fov/zoom/extent/source）`history.replaceState` 写回查询串，书签始终反映当前状态。非法参数静默回退默认值（书签是便利不是接口）。

**三种切换三种 API**（实验室的核心演示价值）：投影切换 `setProjection`（保姿态）；同类换源 `src` setter（保姿态保投影）；跨类换源 dispose 重建（手动迁移姿态）。恰好把 v1 生命周期分层演示全。

---

## 3. 四个面板

### 3.1 相机/投影实验台（`panels/camera.ts`）

- 投影切换：四段按钮 linear / cylindrical / planet / pannini → `setProjection`。切完视角不动（姿态保持是 v1 语义，本身就是演示点）。
- 按变体出旋钮（`Projection` 是判别联合，`types.ts:53-57`；**公开面 fov 是弧度**——`camera-options.test.ts:97` 传 `Math.PI/2` 原样往返；滑条按度数展示、应用时换算）：
  - `linear` → **fov 滑条**（15–110°——库的夹持域，pan-zoom-semantics §4 裁定值）；`aspect` 只读显示（容器比例派生，非用户旋钮）；
  - 其余三个 → **zoom 滑条**（0.01–1，对数刻度——库的夹持域，1 最广、0.01 最远）+ **extent 滑条**（0.5–8，方形 `[v,v]`；默认值 cylindrical 1、planet/pannini 4）。planet 改 extent 直观看到「行星」缩放，是实验室最有趣的旋钮之一。
- 实时读数：滑条旁数值（fov 整数度、zoom/extent 两位小数）+ 姿态读数 lat/lng（`rotate` 事件载荷是**增量**（`viewer.ts:161`），只作刷新信号；绝对值回读 `viewer.cameraOptions`，getter 读的是实时状态）。滚轮 zoom 后滑条同样回读刷新。

### 3.2 媒体源切换台（`panels/media.ts`）

- 源四段按钮：2K / 4K / 8K / 视频（`/video/city.mp4`）。图内换源走 `src` setter；图↔视频走重建（§2.4）。
- 加载态芯片：loading / loaded / error（`media-load` / `media-error`），error 展开显示错误信息。8K 源 12.6 MB，加载态本身就是体验对象。
- 视频传输行：播放/暂停（`play()` / `pause()`；play 的 Promise 拒绝不吞——按钮旁内联提示「浏览器拒绝自动播放」类文案）；进度条 + 时间码 `mm:ss / mm:ss`（读写都走 `viewer.element.currentTime`，`video-viewer.ts:152`）；静音钮（`element.muted`）。

### 3.3 后端/能力状态栏（`panels/status.ts`，右栏顶部窄条）

- 后端徽章 WebGPU / WebGL2（色区分）+ adapter 描述行（`capabilities.adapter` 的 key=value 串联）。
- `maxTextureDimension` 带语境：≥8192 显示「8K 直传」，更小显示「8K 会被降采样」；`externalTextures` 芯片（仅 WebGPU 视频路径）；`devicePixelRatio`；`VERSION`。
- device-lost 后整条变红。
- 「为什么回退」不 invent：回退原因查询走诊断（gpu 通道），状态栏给一行提示引导到诊断区。

### 3.4 事件流 + 诊断（`panels/eventlog.ts`，右栏底部 flex 大头、内部滚动）

- 通配订阅 `on('*', (type, event) => …)`（`viewer.ts:180`，两参签名）。行格式 `hh:mm:ss.mmm · type · {紧凑payload}`（rotate 显示 lat/lng 度数、zoom 显示 delta）。
- 洪水控制：环形缓冲 200 行；自动跟随滚动 + 「暂停滚动」钮；按类型过滤芯片（rotate/zoom 可关，默认开）；清空钮。
- 诊断区（日志下方小节）：六通道复选（viewer / renderer / gpu / camera / media / input，`diagnostics.ts:44`）→ 拼命名空间串调 `enableChannels()`（返回的 undo 暂存，取消勾选时调用）。旁注说明：trace 输出到浏览器 console，且经 debug 的 localStorage 存活过刷新。

### 3.5 共享

- `format.ts`：纯格式化（时间码、角度、payload 紧凑化），无 DOM 依赖；
- `context.ts`：面板与外壳之间的插座——`LabContext` 类型 + `ViewerBox`（viewer 引用盒）+ 各投影变体的默认值构造（外壳与相机面板共用，DRY）；
- `dom.ts`：极小的元素工厂 `h()`，面板免写模板字符串。

---

## 4. 外观

- 深色主题（DevTools 观感，全景内容在深底上更突出）。
- 布局实现：外层 flex 行，画布 `flex:1`，右栏 `clamp(300px, 34%, 420px)`；右栏内部纵向：状态栏（窄条）→ 相机/投影 → 媒体 → 事件日志（`flex:1` 吃剩余高度、内部滚动）。
- 读数与日志等宽字体 + tabular numbers（数值跳动不移位）；标签系统 UI 字体。
- 桌面优先，不承诺移动端适配（面板最窄 300px，再窄横向滚——实验室是桌面工具）。

---

## 5. 错误路径汇总

| 场景 | 呈现 |
|---|---|
| probe 返回 `backend:'none'` | 整页「无可用后端」说明态，不建 viewer |
| `create()` 拒绝 | 整页错误态 + 错误信息 |
| `media-error` | 媒体面板 error 芯片 + 展开信息 + 日志行 |
| `device-lost` | 红色横幅 + 状态栏变红 +「刷新重试」 |
| `play()` 被浏览器拒绝 | 播放钮旁内联提示（不吞 Promise） |
| URL 参数非法 | 静默回退默认值 |
| 8K 超设备纹理上限 | 非错误——库自动降采样，状态栏提前解释 |

---

## 6. 文件清单

**新增/改动**：

- `demo/index.html`（新实验室入口）
- `demo/minimal.html`（现 index.html 原样改名）
- `demo/lab/main.ts`、`demo/lab/lab.css`、`demo/lab/format.ts`、`demo/lab/context.ts`、`demo/lab/dom.ts`
- `demo/lab/panels/camera.ts`、`demo/lab/panels/media.ts`、`demo/lab/panels/status.ts`、`demo/lab/panels/eventlog.ts`
- README 演示节一小段更新（双页说明：lab 主入口 + minimal 最小示例）

**零改动**：`vite.config.ts`、`src/` 全部、`demo/main.ts`、`demo/image/`、`demo/video/`、`demo/shots/`。

---

## 7. 验收口径

**免测声明**：demo 不写任何测试（用户裁决，2026-09-24：「我写这个 lab，是用来验证和体验功能的」）。护栏 = `npm run typecheck`（demo 在根 tsconfig 程序内）+ `npm run lint`（`demo/**/*.ts`）+ `npm test`（库测试面必须仍绿）。

**机器验收（卡片 verify）**：`npm run typecheck && npm run lint && npm test`。

**人工验收清单**（交付标准，逐条过）：

1. `npm run start` 打开 `/` 即实验室，默认 2K 图渲染，右栏四组齐全；
2. 四投影切换：视角不动，旋钮按变体切换（linear→fov；其余→zoom+extent），planet 改 extent 行星缩放可见；
3. 拖拽画布时 lat/lng 读数实时刷新；
4. 2K/4K/8K 切换不闪重建（src setter 路径），8K 加载态可见；
5. 图↔视频切换姿态保留；视频 play/pause/seek/静音可用，play 拒绝有内联提示；
6. 事件日志实时滚动，rotate/zoom 过滤芯片、暂停滚动、清空可用；
7. 六诊断通道勾选后浏览器 console 出 trace，取消勾选停止；
8. `?projection=planet&zoom=0.5` 书签往返（刷新后状态还原；改参数后地址栏跟随）；
9. `minimal.html` 逐字等于 README 示例（改名零内容改动）；
10. 无可用后端环境（如 `--disable-gpu` 强制回退失败时）整页说明态而非白屏。
