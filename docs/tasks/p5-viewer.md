---
plan: docs/superpowers/plans/2026-09-19-p5-viewer.md
scope: [src/viewer/**, src/index.ts, test/**, vitest.config.ts, demo/**]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: app
deps: [p4-media-interaction]
state: reported
createdAt: 2026-09-19T08:51:52.772Z
---
# 任务：P5 — viewer

开工先读 plan 头部，尤其是「前置依赖」五条和「完成标准」。

**没有桥。** Playwright 时代那套 `demo/test-entry.ts` / `demo/test-entry-hooks/*` / `window.__panoTest` / `PanoTestApi` 已经随 P3 的浏览器模式切换一起删掉了。它存在的前提是「测试跑在 Node 里、被测对象在页面里」—— 浏览器模式让这个前提本身消失了：测试文件就在页面里，一个闭包就能跨「做手势」和「读事件」。**不要把它长回来。** 如果你正想加一个 hook 文件，先问一句「这个状态能不能直接读」。

动手前先 `ls public/fixtures/` 确认 P4 的两个素材在。**缺了就说明 P4 那一卡没做完，不要在本计划里补造。**

不要建 `src/core/index.ts` barrel（前置依赖第 3 条）：直接按模块 import。

**本卡冻结公开 API**：`src/index.ts` 的导出面自此不再变，P6 / P7 都不改它。五个 User Story 各一个集成测试文件，异常场景也要有。

verify 用的是 `npm run test:coverage` 而不是 `test:unit`：**分支覆盖 ≥90% 是构建失败而不是目标**，`test:unit` 不带覆盖率会静默放过它。`vitest.config.ts` 在本卡 scope 里就是这个用途 —— `viewer.ts` / `render-loop.ts` 这类围着 DOM 与 rAF 转的代码如果拉低了门槛，**首选补测试（假的 rAF 时钟 + 桩后端）**，确实测不到才加 exclude 并写明理由。**不要删 `thresholds`。**

> **scope 修订（2026-09-20，P1 Task 10 质量审查 I-1/M-2；master 侧协调预补）**：`demo/**` 补入 scope，plan 相应新增 Task 6「demo 接上真 viewer」。P1 Task 10 落地的 demo 占位页写着 "viewer lands in P5"，但本卡原 plan 没有任何 demo 任务——那句承诺没有登记在任何图纸里（审查 M-2：未登记的承诺等于不会发生的承诺）。同时 P1 已把 demo 的第一方 TS 纳进根 tsc program 与 lint glob（审查 I-1），「被检查」与「有真东西可看」到本卡合流。授权范围仅限 `demo/main.ts` 的替换接线；demo 页的功能扩展（投影切换面板、视频位）不在本卡，2017 遗产 JS（`Index.js`、`webpack.config.js`、`libs/`）原样留到 P7。

## 完成报告

**卡级总结（Task 6 收工时写；Task 4/5/6 分节明细见下方各节。）**

**做了什么**：六个 Task 全部完成——Task 1 `CameraController`、Task 2 `RenderLoop`、
Task 3 `Viewer` 组装与 dispose 顺序、Task 4 两个公开类与冻结的 `src/index.ts`、
Task 5 五个用户故事的集成测试层（31 条用例 + 支撑层）、Task 6 demo 接上真 viewer。
分支 23 文件 +4886/−21；公开面与 plan 冻结块 byte 级一致（SHA 核对）。

**自测结果**：verify 六连全绿（gen:shaders --check / typecheck 三程序 / lint /
coverage 99.57·98.61·100·100 四门槛 / integration 106 用例 / build）。变异测试 Task 4
18 体 16 杀 + 2 预期存活（阴性对照）、Task 5 应测 12 体 12 杀。opus 全分支终审在最终
尖端独立复跑全套并四项独立抽查，结论 **merge-ready-with-registrations**。

**偏离 plan 的点**：Task 4 七条、Task 5 十条、Task 6 零条，逐条登记在各分节，
全部经双关审查核实（要么 plan 原文佐证、要么实测佐证）。

**风险**：相机冻结缺陷（非线性投影 pan/zoom 不达画布——P2+P3 遗留、不在本卡 scope；
终审判定不阻塞合并，但修复卡必须排在 P6 开工前，测试网三件套与 R1c 条件见自审记录）；
demo media-error 红字首屏不可见（plan 缺陷，候选 `host.prepend`，勘误 E34）；三条移交
观察（canvas 格式警告 / 回读不可用 / 上传警告不可复现，勘误 E35，P6 输入）。

### Task 4 · 两个公开类与 `src/index.ts`

**做了什么**

- `src/viewer/options.ts`（plan 的 `Files:` 块漏列，按 E22 归本 Task）：`ImageProjection = TextureProjection` 别名（不复制成员，注释写明这是 fisheye 落地时唯一要放宽的一行）、`ImageViewerOptions` / `VideoViewerOptions`、`RemovedOptions`、`assertContainer` / `assertSrc` / `assertProjection` / `assertNoRemoved`、`validateImageOptions` / `validateVideoOptions`（填 `muted ?? true`）。`assertProjection` 认三种情况：`'equiprectangular'` 拼写纠正、`'fisheye'` 构造即抛、其余走 `unknown projection:` 尾。
- `src/viewer/image-viewer.ts` / `video-viewer.ts`：`create` 校验 → 探设备 → 建源，失败时按 **源 → 后端 → canvas** 回收后重抛（与 `Viewer.dispose` 同序）；两侧 `probe()` 均委托 `backend-factory.probe`；`src` setter 复用 `assertSrc`，走基类的换源路径；视频侧另有 `play` / `pause` / `element`。**未改 `src/viewer/viewer.ts`。**
- `src/index.ts` 冻结公开面：两个类、两个 options 类型、从各归属模块再导出的 `CameraOptions` / `Capabilities` / `SelectedCapabilities` / `CameraState` / `Projection` / `ProjectionKind` / `TextureProjection` / `ImageProjection`，加 `enableChannels` 与 `VERSION`。**无 `CameraProjection`**（有意，理由见 plan）。
- 单元测试：`test/unit/constructor-validation.test.ts`（15 条，plan 写 12 条，见偏离 2）、`test/unit/probe.test.ts`（4 条，**plan 外新增，见偏离 7**）。

**自测结果**

- `npm test`：**276 unit + 72 integration 全绿**。`npm run typecheck` 三程序 0 错；`npm run lint` 0 错；`npm run test:coverage` **99.57 / 98.61 / 100 / 100**，四条门槛全过（`thresholds` 未动）。
- **变异测试：18 个变异体，16 击杀（全部具名）/ 0 broken / 2 预期存活**。每条 run 都完整（总数 276），击杀判据一律是 JSON 报告里具名的 `status === "failed"`，不看退出码。
  - 两个预期存活是**阴性对照**（两个公开类的 `create()` 忽略 device texture limit）：它们证明这套装置会报「存活」而不是无条件打印击杀，同时**量出**本 Task 的盲区（见风险 1）。
  - 其中 M3b（把 `if (value === 'fisheye')` 改成 `'fisheye '`，**所有 token 原样留着**）被 `constants.test.ts` 的行为断言击杀 —— 这正是把 `toThrow(/fisheye/)` 收紧成 `toThrow(/not implemented/)` 的原因：前者会被 `unknown projection: fisheye` 这条回退文案满足。
- **fisheye 守卫阳性对照**（裁决 O33 要求的三条原始输出，加一条自查）：N1 新树全绿；**N2** 往非豁免文件 `src/core/matrix.ts` 塞一处纯提及注释 → **只有** `projection kinds has no fisheye entry, because fisheye is not implemented` 具名转红（证明扫描没被关掉）；**N3a** 往 `kinds.texture` 加 `"fisheye": 5` → 该用例具名转红（另带新的 texture 桥锁与生成器 `--check`）；**N3b** 往 `kinds.camera` 加 → 该用例**仍**具名转红（同时带 camera 锁与 `--check`，正是勘误预告的混淆变体，故判据取**用例名**而非「红了」）；**N4** 删掉 `kinds.texture` 的键 → 四条具名转红（见偏离 4）。四条全部逐字节还原，还原后再与 `git show HEAD:<path>` 的 blob sha256 对照相符。
  - N4 第一次跑出来是「9 passed, 0 failed」——**那是控制脚本自己坏了**：`replace` 的匹配串写错，一个字都没改，而「什么都没改的控制」跑出来全绿，长得和「守卫没看见」一模一样。差点据此报出一条**假发现的缺陷**。脚本已加断：变换后与原文相同即判 `BROKEN: the edit changed nothing`，与变异装置里那条「find 必须命中恰好一次」是同一条纪律。上面 N4 的结果是修好之后重跑的。

**偏离 plan 的点**

1. **`exactOptionalPropertyTypes` 让 plan 的四个对象字面量编译不过（TS2379）**。plan 把 `projection: valid.projection` 直接传给 `projection?: TextureProjection`，`autoplay` / `loop` 同理 —— 显式 `undefined` 被拒。改法是两个模块私有 helper（`imageSourceOptions` / `videoSourceOptions`），在 `undefined` 时**省略键**而不是传 `undefined`。**「两个分支对消费侧语义相同」这条行为主张的依据（grep 实测，不是推断）**：两个消费点都用 `??` 兜底 —— `src/media/image-source.ts:40`（`this.#projection = options.projection ?? 'equirectangular'`）与 `src/media/video-source.ts:172`（`projection: this.#options.projection ?? 'equirectangular'`）；且两个文件里**没有**任何 `in options` / `Object.keys` / `hasOwnProperty` / `!== undefined`（grep 命中 0 处），即没有**存在性敏感**的读取，`??` 对「省略键」与「显式 `undefined`」给出同一个值。真正干净的修法是放宽 `src/media/**` 的 optional 属性类型，那不在本卡 scope。
2. **`constructor-validation.test.ts` 是 15 条，不是 plan 的 12 条**。多出的三条覆盖 plan 留空的分支：未知投影（`unknown projection: mercator`）、已删的 `el`、`container` 为 `null`（须报容器错而不是空指针）。
3. **`coverage.exclude` 增 `src/viewer/image-viewer.ts` 与 `src/viewer/video-viewer.ts`，且**不**排除 `options.ts`**。按 brief §4.1 实测而非照抄：不排除时 statements 468/524（89.31%）、branches 214/229（93.44%）、functions 95/108（87.96%）—— 四条门槛倒三条，原因是这两个文件在 `environment: 'node'` 下**一行都跑不了**（`document` 不存在）。`options.ts` 实测 25/25 statements、23/23 branches、6/6 functions，排除它等于把它自己的测试划掉，故不排除。数字与理由都写在 `vitest.config.ts` 就地。
4. **`test/unit/constants.test.ts` 按裁决 O33 改（A 案）**：范围不动（全 `src/**/*.ts` + JSON），判据改成具名豁免 `FISHEYE_REJECTION_SITES = ['src/viewer/options.ts']`，补偿断言 `Object.keys(kinds.texture)` 与字面量 `toEqual(['equirectangular'])` 按裁决补上。两处**我在裁决字面之外加的**，请你复核：① 裁决说「豁免靠行为证据挣（plan 测试 7）」，我把这条证据做成了**本文件内的可执行断言**（`grants the fisheye exemption only where the rejection is real`，动态 import 该文件要求它真的抛出 `/not implemented/`）—— 只靠注释指向测试 7 的话，删掉拒绝分支、留下豁免，扫描仍然是绿的，那正是 O33 自己说的「文字层的真相没有可执行的看门人」；② 除字面量外保留了**过桥**断言（`textureProjectionCode(key) === kinds.texture[key]`），它管的是字面量看不见的那件事：两侧数值不再相等。两处的理由都写在断言旁边。**plan 测试 7 一字未动。** 另：新注释里「texture 的键被删掉由 `are up to date with the JSON source` 兜住」是一句**关于另一条测试行为的主张**，按 O24 已**实测**（控制 N4）：从 `projection-kinds.json` 删掉该键，**四条用例具名转红** —— `leaves no texture key stranded on the JSON side of the bridge`、`are up to date with the JSON source`、`uploads the numeric values the legacy shader hard-coded`、`declares the same numbers as the TypeScript constants` —— 主张成立，注释里已把实测到的用例名写进去；随后逐字节还原并核对 `git show HEAD:<path>` 的 blob sha256。
5. **P2 的 plan 与落地的守卫不一致（`034069a`）**。P2 plan `plans/2026-09-19-p2-core.md:84–91` 是**扫一个文件 + `/'fisheye'|Fisheye|FISHEYE/`**；落地是**全 `src/**/*.ts` + JSON + `/fisheye/i`**。那次放宽是**有理由、有意识**的质量改进（提交信息自称 "widen single-source guard tests"，理由是「注释声称覆盖 src/、实际只扫一个文件」——**这个判断是对的**），代价是 P2 的 plan 没回改，于是**同一条放宽与它自己的 plan 不一致，且没有任何检查能发现这件事**。它在四个 phase 后由本 Task 第一次走进射程而显出代价。所以本条**不是**「前人犯错」，是「一条正确的放宽，在四个 phase 后第一次遇到射程内的目标」。登记归协调者（E29），本清单只作偏离记录。
6. **§8 的「第四处差异」问题：没有发现第四处行为差异**。plan `:2033` 说的三处是 `validateVideoOptions` / `VideoSource`（含 `#source` 的具体类型）、四个 source options、`play` / `pause` / `element`；逐行比下来的其余差异是**编译缺陷**（上面第 1 条）与由此引入的 helper，不是行为差异。
7. **`test/unit/probe.test.ts` 是 plan 外新增**。plan 的 Task 4 `Files:` 块只有四项（`:1644–1648`：`src/viewer/image-viewer.ts` / `src/viewer/video-viewer.ts` / `src/index.ts` / `test/unit/constructor-validation.test.ts`），而 **`probe.test.ts` 这个文件名在 plan 全文 grep 0 命中**。它由 E24(a) 点名要求（`probe()` 在 Task 3 的树上无调用者、无测试），**与偏离 2、3 同型：`Files:` 块不是清单**（同 E22）。
   - 覆盖到的是**两条真实环境分支**：node 下无 `document` → 两个类各自返回 `{ backend: 'none' }`（不抛）；`vi.stubGlobal` 造出能答 `getContext('webgl2')` 的 canvas → 两个类各自返回 `{ backend: 'webgl2', externalTextures: false, maxTextureDimension: 2048 }`。**两个类分开断**，因为一个 `probe` 被接空、或接了兄弟类的一份拷贝，都过得去其中一条。
   - **E24(a) 点名的第二半（`backend-factory.ts:65-67` 的 `createBackend` throw 分支）本 Task 未覆盖**，按 E27 / T5-5 归 Task 5——见遗留风险 2，此处只作交叉引用，不重复主张。
   - **本条的编号追加在末尾，没有按类插到 2、3 旁边**：卡内 `见偏离 4`（自测结果节）、`同偏离 1`（遗留风险 4）是硬引用，插队会打断它们。

**遗留风险**

1. **E26：覆盖率门槛对 `src/viewer/` 与公开面零可见**。这两个文件被 exclude，所以它们在 `test:coverage` 里不参与 —— **本 Task 在公开面上的证据是变异测试与集成测试，不是覆盖率**。C1/C2 两个阴性对照把盲区量到了具体位置：两个公开类 `create()` 里传给 `ImageSource` / `VideoSource` 的 `maxTextureDimension`、以及 `src` setter 的全路径，在本 Task 的网里**打不红**，归 Task 5 的用户故事测试。
2. `backend-factory.ts` 的 `navigator.gpu.requestAdapter()` 两个分支（`:32-36`）本 Task 仍未触达：node 项目里 `navigator` 存在但没有 `gpu` 成员，所以单元测试只能走到「无 DOM」与「有 DOM 无 GPU（WebGL2）」两条；真正的 adapter 分支由 integration（真实 adapter）与 no-webgpu（`--disable-gpu`）两个浏览器 project 触达。`createBackend` 的 throw（`:65-67`）按 E27 / T5-5 归 Task 5。
3. **plan 缺陷，已上报未自行补**：`test/integration/dispose-order.test.ts:27-28` 与 `test/integration/support/spies.ts:7` 的注释把 `src/index.ts` 写成「只导出 `VERSION`」，Task 4 之后这句已陈旧。四个集成测试文件按 brief §3.3 **未改**（也未把 import 重指向 `src/index.ts`）。
4. `src/media/**` 的 optional 属性不接受显式 `undefined`（同偏离 1），干净修法在那里；本卡内以 helper 规避，未留行为债。

**质量审查整改（第二关，2026-09-23）**：四条 —— 2 IMPORTANT 已修、1 MINOR 按计划顺延、1 QUESTION 裁定不改。

1. **IMPORTANT（已修，`b3851eb`）**：`viewer.ts` 的 `#resize` 只守高度。「宽为零、高仍在」的布局（折叠侧栏 / 竖向分割条拖死）使 `width / height` 为 0，`setAspect` 抛 `greater than 0` —— `create()` 侧拒绝一个调用者从没写过的 `aspect` 选项，构造之后则在每个布局过程里从 ResizeObserver 回调内未捕获地重抛。改为双轴 `width > 0 && height > 0`。
2. **IMPORTANT（已修，`534c7ba`，代码本对、只补红测）**：`cameraOptions` 的 partial-pose 合并无具名红测 —— 删掉合并行的变异体全套件存活（套件内唯一的 pose 赋值作用在未移动的 viewer 上，`{0,0}` 合并与否无差别）。
3. **MINOR（顺延 Task 5，非本卡缺口）**：公开类上的输入接线（input wiring）—— US1/US2 覆盖。
4. **QUESTION（裁定不改，记为决定而非缺陷）**：`render-loop.ts` 在 draw 之前消费相机脏标记，设备存活而 draw 抛出时，支撑本次绘制的变更已随消费丢失。可接受：现实的抛出者就是设备丢失，而那条路径本来就会 dispose 掉 viewer。

**测试落点与审查建议不同，登记**：审查建议落 `test/unit/camera-options.test.ts`，该文件不存在；且 `vitest.config.ts` 已有实测在案的裁定 —— `viewer.ts` 在 node 项目一行都跑不了，node 桩 DOM 的单元装置「回放的是本文件自己的假设而不是测试」，Viewer 行为归 integration 项目。故三条新测试落 `test/integration/camera-options.test.ts`（`cameraOptions` 本就在此被行使，`mount()` 现成）：① 零宽容器构造不抛、不写 aspect；② 生存期塌缩到零宽无页面 error 事件、确实到达 `#resize`（canvas 被后端钳到 1px）、aspect 原值存活；③ partial-pose 合并两角精确断言（纬度变 5、未点名的经度 20 存活）。变异复测在 HEAD 干净副本（`git archive` + 软链 node_modules，工作树不动）：仅还原守卫 → ①②具名转红；仅删合并行 → ③具名转红；两轮其余用例全绿，还原后与 `git show HEAD:` 逐字节相同。验证：typecheck / lint 0 错，coverage 99.57 / 98.61 / 100 / 100 四门槛全过，integration 15 文件 75 用例全绿。

### Task 5 · 五个用户故事的集成测试层（US1–US5）

**只写测试，未改 `src/**` 一行。** 三个提交：`850c382`（测试层）、`10db411`（E32 注释修正 + 一处既有测试的去 flake）、`89b665d`（resize 重绘断言加强）。

**做了什么**

- 五个用户故事文件，31 条用例（integration 侧由 15 文件 / 75 用例升至 **20 文件 / 106 用例**）：
  - `test/integration/user-story-photo.test.ts`（8）：渲染与 media-load、拖拽转动（事件 + 位姿 + 像素）、零位移静默、PTZ=false 静止、容器变尺寸、高分屏锐度、probe 好象限、完整旅程（mount→rotate→换源→位姿与 source 双存活→dispose 带 teardown 计数）。
  - `test/integration/user-story-video.test.ts`（8）：播放且帧前进（时钟与像素同窗等待）、暂停停绘、换源拆旧元素且位姿存活、autoplay 的 muted 默认、滚轮缩到非线性投影、公开 `zoom()` 到达后端（T5-1）、linear 下 zoom 无操作、dispose 后 `play()` 拒绝。
  - `test/integration/user-story-camera-switch.test.ts`（6）、`test/integration/user-story-media-failure.test.ts`（7）：照 plan 的故事面，失败侧直接以 404 src 构造（见偏离 6）。
  - `test/integration/fallback/user-story-no-webgpu.test.ts`（2，E33）：`probe()` 在 `--disable-gpu` 下如实报 `webgl2`；`create()` 以 `/no usable rendering backend/i` 拒绝。
- 支撑层：`support/viewer.ts`（`imageViewer` / `videoViewer` 工厂 + `PROJECTIONS`）、`support/gestures.ts`（元素相对 drag / wheel）、`support/spies.ts` 新增 `captureTeardown()`（`disconnects` / `emitterTeardowns` 两个读数）。
- E32：`dispose-order.test.ts` 与 `spies.ts` 头部两处陈旧注释改正，**只改注释，未重定向任何 import**。
- `image-source.test.ts` 首条用例改用 `?uncached=${Math.random()}` 唯一 URL（见偏离 9）。

**自测结果**

- `npm run typecheck`（三程序）0 错；`npm run lint` 0 错；`npm run test:coverage` **99.57 / 98.61 / 100 / 100**，四门槛全过（`thresholds` 未动）；`npm run test:integration` **20 文件 106 用例全绿**（连续三轮）。
- **变异测试：本卡应测 12 条，12 击杀，0 存活**（明细见下方覆盖陈述）。装置沿用血换来的规矩：`git archive HEAD` 解到 `/tmp` 干净副本 + 软链 `node_modules`，锚点必须恰好命中一次否则拒绝落刀，落刀后证明写进去了，三 project 完整跑，判据一律是 JSON 报告里具名 `status === 'failed'`，退出码不作数。干净对照 382 passed / 0 failed / 40 文件。
  - **装置自身坏过一次，如实记**：x1（插入型变异，`new` 以 `old` 为前缀）触到 landed 自检里两条断言互相矛盾（一条允许 `new.startswith(old)`、另一条不允许），`set -e` 在跑测试前就退了。修正自检语义后重跑 x1，三用例具名转红。与 Task 4 的 N4 同型：控制脚本先于结论受审。
  - **m22 的第一次测量是「存活」，结论改判经过是实测的**：像素侧量到「无重绘的 resize 之后 canvas 仍然点亮」（探针在 m22 下：跨保纵横比 resize 0 次 draw、`lit > 0.2` 为 true）——本平台的 WebGPU canvas 在尺寸变化后会**保留最后一次呈现的帧**，所以缺 `invalidate()` 在像素上不可见。但 0 次 draw 恰好是可断言的：基线下 `invalidate()` 脏标记必触发一次重绘。resize 用例据此加强为 `captureRenderInputs().sourceCalls()` 差分（快照取在第一次 resize 的 draw 结算之后，差分即第二次 resize 的重绘），加强后 m22 具名转红（`89b665d`）。

**偏离 plan 的点**

1. **「画没画」一律走 `captureRenderInputs()`，不用 `countDraws()`**（brief §4.1）：resize 重绘、暂停停绘两处都断 `sourceCalls()` 差分。
2. **E33 / US5 首断言为 `backend === 'webgl2'`**：`--disable-gpu` 下 probe 的实测真值。P5 时点 probe 报机器能力、create 报库能供给什么，两者在本卡不一致（WebGL2 后端 P6 才有），文件头注释写明这个接缝与 P6 合流时删首断言即删记录的约定。
3. **工厂带默认 src（`?? FIXTURE`）而非 plan 的条件展开**：`src` 是必填项，plan 的 `...(src === undefined ? {} : { src })` 编不过（TS2379 同族）。连带后果：构造即加载可能赶在用例挂监听之前，所以计数一律 `>=` 基线而非精确值——`ImageSource` 用从未入 DOM 的 `new Image()`，没有可轮询的加载完成信号，这个竞态在工厂侧无解。
4. **US2 围绕 `viewer.element` 重写，plan 的 `videoOf(container)` 找不到东西**：v1 从不把 `<video>` 插进容器。且构造期 `autoplay` 在游离元素上不起作用（实测：media-load 到、media-play 3 秒内不到；显式 `play()` 可用），播放一律显式起。
5. **滚轮缩放的像素断言删除**：它在**未变异的树上就是红的**——`WebGPUBackend.setCamera` 的 `mat4.equals` 早退跳过了只装 zoom 的 uniform 写入（见遗留风险 1）。缺陷按 brief §6 只登记不修，断言旁边注释写明「修好那天放回来」。
6. **US4 的黑画布前提被默认 src 打破**：工厂默认图先渲染成功，换 404 后 canvas 留的是上一帧好图。改为直接以 404 src 构造，canvas 从未有过帧。
7. **resize 数字按 DPR 断言、结构改为两次 resize**：project 跑在 `deviceScaleFactor 2`，裸 300 会错一倍；且单次变纵横比的 resize 会让 `setAspect` 自己弄脏，隔离不出 `invalidate()`——第二次保持 1:1 才隔离得出。
8. **plan 清单之外新增四条**：零位移静默、probe 好象限、公开 `zoom()`（T5-1 要求）、带 teardown 计数的完整旅程；及 `captureTeardown()` 支撑。
9. **`image-source.test.ts` 首条用例加唯一查询串**：规范允许已完整解码的图在 `src =` 赋值内同步完成，并行跑里暖缓存把 `naturalSize` 同步读成 512x256，是一条绿套件 flake（实测过一次）。
10. **E32 仅注释**：两处头部陈旧注释改正；import 一律未动。

**遗留风险**

1. **源缺陷（未修，按 brief §6 登记；严重度经纯净沙箱复审 + 本人 /tmp 干净副本复测修正）**：非线性投影上**没有任何相机变更到达过画布——平移与缩放全死，不只 zoom**。机制：`src/core/matrix.ts:172–186` 对非线性类型以常量 `LEGACY_QUAD_VIEW` 作 view、`buildProjection` 只读 extent（zoom 按设计不进矩阵，`:128`），故 clip 矩阵与姿态、zoom **均**无关；于是 `src/renderer/webgpu/backend.ts:353` 的 `mat4.equals(clip, this.#clip)` 早退对**每一次**相机变更都成立，`:363` 的 `#writeCameraUniforms()`——唯一携带 `povLatitude` / `povLongitude` / `zoom` 的写入点（`:382–384`）——从不执行；着色器从 uniform 读姿态（`panorama.wgsl:245,252`）。能重新写 uniform 的只有：投影类型或 extent 变化（clip 真变了）、源纹理投影变化（`setSource`，`backend.ts:423`）。**本卡初版所写的「直到某个动矩阵的事件顺带冲刷」是假的——平移同样不冲刷。** 实测：cylindrical 上 `rotate(10,0)`、`rotate(0,90)`、大幅横拖，像素 diff 全 0（复审沙箱与本人在 /tmp 干净副本的探针 `[0,0,0]` 两轮一致）；zoom 路 cylindrical 1→0.7，`setCamera` 观测到带 0.7 的 draw 照跑，30+ 帧后 canvas 不变。US2 滚轮用例的像素断言（偏离 5）修好那天应放回。
2. **游离 `<video>` 上的 autoplay 惰性**：构造期 `autoplay` 不起播（上述实测）。本轮以显式 `play()` 绕开；若 P6 认为该选项应生效，需要源侧或 viewer 侧显式起播，届时 US2 头部注释与「muted 默认」用例的说明同步改。
3. **平台行为登记**：本机 WebGPU canvas 跨无重绘的尺寸变化保留上一帧（m22 探针实测）。若将来平台改为清缓冲，resize 用例的像素半边会重新变得可达——目前它只是「画布仍有帧」的弱断言，击杀靠 draw 差分。
4. **m16 的击杀者是 Task 4 整改轮的 `camera-options.test.ts` 两条**，非本轮新增（裁决预告过「可能已杀」，如实记归属；本轮重测确认）。
5. Task 4 遗留风险 2 的后半（`createBackend` throw 分支无网）本轮闭合：bf2 被 US5 第二条具名击杀；bf1a/bf1b 由 US5 第一条与 US1 probe 用例参与击杀（与既有 capabilities/probe 单测分摊）。

**覆盖陈述**（验收 = 变异体具名转红；装置与判据见自测结果）

| 验收条 | 变异体 | 判定 | 击杀用例（具名） |
|---|---|---|---|
| T5-1 | m25 | 击杀 | `user-story-video` · the public zoom() method reaches the projection the backend receives |
| T5-2 | m16（重测） | 击杀 | `camera-options`（Task 4）· a surface with no width constructs without throwing / does not throw from the resize path |
| T5-2 | m22 | 击杀 | `user-story-photo` · the image fills a container that changes size（`89b665d` 加强后） |
| T5-3 | m28 | 击杀 | `user-story-photo` · dragging rotates the camera and changes the image |
| T5-3 | m29 | 击杀 | `user-story-photo` · a press and release without movement reports nothing |
| T5-3 | m30 | 击杀 | `user-story-video` · a wheel zoom-out reaches the camera state of a non-linear projection / zoom is a no-op for the linear camera |
| T5-4 | m11 | 击杀 | `user-story-photo` · survives a whole session（disconnects === 1） |
| T5-4 | m12 | 击杀 | `user-story-photo` · survives a whole session（emitterTeardowns === 3） |
| T5-5 | bf1a | 击杀 | US5 probe 用例 + 既有 capabilities/probe 单测 |
| T5-5 | bf1b | 击杀 | `user-story-photo` · an application can ask about the backend before it creates anything + 既有 capabilities 单测 |
| T5-5 | bf2 | 击杀 | `user-story-no-webgpu` · create() fails with a message naming the backend situation |
| T5-7 / X1 | x1 | 击杀 | `user-story-photo` · survives a whole session + `user-story-video` · a source swap tears down the old element + 既有 `viewer-events` swapping 用例 |
| T5-6 | m9b | **未做（裁决许可）** | 只在「第二次 `backend.dispose()` 会抛」的构造下才可观测，m9 的加强版而 m9 已杀；优先级最低，按裁决记入本陈述 |
| — | M21 | **纯契约转发，本轮未列入范围** | PTZ setter 去 `assertAlive`；裁决原文照录 |

**质量门记录（2026-09-23，approve-with-findings）**：0 CRITICAL / 0 IMPORTANT / 0 MINOR / 4 NOTE（报告 `.vibe/p5/evidence/p5-task5-quality.md`；五条击杀重跑全部复现，`83d3986` 专核通过）。协调者裁决：两修两记，一个提交整改。

1. **NOTE 1（已修，本提交）**：`user-story-photo.test.ts` 首条用例的 `vi.waitFor` 补 `{ timeout: 5000 }`，与本层其余 wait 惯例对齐；就这一行。
2. **NOTE 4（已修，本提交）**：`user-story-video.test.ts` 播放用例注释里「timeline 可领先三分之一秒」是全层最后一个未复核的量级主张（O24：未验证的注释主张按缺陷处理）。实测一轮只会在「安静跑 lag≈0」与「单样本轶事数」之间二选一，都不干净，故按裁决改写：去掉量级数字，保留已验证的部分（该等待替换掉的 flake 本身——时钟已动而单次读仍见上一帧——与不依赖数字的「双条件等待更稳」理由）。改写后注释里无未测数字。
3. **NOTE 2（裁决：接受 plan 形状）**：失败路径不 dispose 只影响同文件后续失败用例的诊断信息，浏览器模式按文件隔离；跨五个文件加 try/finally 是结构性搅动，不为 NOTE 级收益做。
4. **NOTE 3（挂 P6）**：换源用例 source-survived 半边的可选加固手段是断言 `sourceCalls()` 差分（x1 类缺陷现已有网）。

### Task 6 · demo 接上真 viewer

**做了什么**

- `demo/main.ts` 整文件替换（+31/−13），提交 `72442ba`。与 plan Task 6 的代码块
  **byte 级一致**（两侧各 1497 字节，SHA-256 相同）；commit message 用 plan 自带的
  `task-p5-viewer: feat(demo): mount the real viewer on the demo page`。零偏离。
- 静态面：typecheck / lint 0 错（终审在 `72442ba` 独立复跑确认）。

**双关审查记录**

- **Spec 审（零发现）**：byte SHA 核对、注毒守卫（往 demo 塞标记确认是替换而非追加）、
  headless 实测 catch 路径、文件面核对。报告 `.vibe/p5/evidence/p5-task6-spec.md`。
- **质量审（approve-with-findings，1 IMPORTANT + 2 NOTE）**：必查项 media-error 时序竞态
  判定「demo 形态不存在」——结构性证明（`create()` 最后一个 await 之后零任务边界，DOM img
  error 是任务）+ 执行佐证（404 变体挂载先于触发、坏 data-URI 5/5）+ 阳性对照（插入
  120ms 任务让渡后事件确实丢失——**竞态对「让渡过任务的消费者」是真的**，demo 形态永不
  触发）。报告 `.vibe/p5/evidence/p5-task6-quality.md`。

**协调者裁决（三条发现全部登记，不改本卡代码）**

1. **F1 → 勘误 E34**：media-error 红字 `appendChild` 在 100%×100% canvas 之后，实测
   `pTop 733 > 视口 719`，首屏不可见——素材失败呈现仍是黑屏（catch 路径不受影响）。
   plan 缺陷（demo 与 plan byte 级一致），候选修法 `host.prepend(note)`，归后续卡。
2. **F2 → 勘误 E34**：plan 的「可能在 create() 返回前解码完」机制句与现形态不符。
3. **F3 → 采纳改写**：三条移交观察定稿——(a) favicon 404 如实；(b)
   `CopyExternalImageToTexture` 警告在本机不可复现，每载必现的是 canvas 格式警告
   （`backend.ts:31`/`:317` 硬编码 `rgba8unorm` vs 本机偏好 `bgra8unorm`，修法方向
   `getPreferredCanvasFormat()`，P6 renderer 侧）；(c) headed Chrome 页内 WebGPU canvas
   回读（drawImage/toDataURL 双路 alpha-0）完全不可用，`support/canvas.ts` 的
   vitest-browser 结论不外推真实浏览器——P6 测试基建约束。

**遗留风险**

1. `backend.ts` 上传时序 warning（实现者移交，两台审查机器均不可复现）——登记，P6 分诊。
2. E16 顺延确认：`.gitignore` 缺 `test-results/`，但 `.gitignore` 不在本卡 scope 白名单，
   顺延下一张卡；实测树干净，无实际影响。

## 自审记录

### CR 结论

本卡按 SDD 执行：六个 Task 全部走「实现 → spec 符合性审 → 质量审」双关，最后全分支终审
（opus，用户指定）。

- **手段**：每 Task 派全新实现者子代理 + 两道独立审查（spec 符合性 → 质量）；变异测试作为
  击杀判据贯穿 Task 4/5（具名失败用例 = 击杀，退出码不算数，`git archive` 沙箱 + sha 还原
  核对）；终审 `p5-final-review`（opus）在 `72442ba` 独立复跑全套（382/382/40 文件、
  typecheck/lint/coverage 全绿，此前没有任何审查在这个尖端跑过全套）+ 四项独立抽查
  （矩阵 pose 无关性 node 探针、公开面 byte SHA、分层 grep、v0.2.2 取证）。
- **发现与整改**：Task 4 质量 2 IMPORTANT（零宽守卫不对称、pose 合并无红测）已修 + 复审
  confirm；Task 5 质量 4 NOTE（两修两记）；Task 6 质量 1 IMPORTANT + 2 NOTE 全部登记勘误
  （plan 缺陷，代码与 plan byte 级一致，无整改必要）。spec 侧：Task 4 一条文档缺口（偏离 7
  补登记）；Task 4 审者一条假缺陷经协调者执行复核 REFUTED；Task 5/6 零发现。
- **轮数**：每 Task 双关各 1–2 轮循环，无 CRITICAL 存量。
- **终审结论**：**merge-ready-with-registrations**（0 CRITICAL / 2 IMPORTANT 均已登记 /
  5 NOTE），报告 `.vibe/p5/evidence/p5-final-review.md`，plan 完成标准十一条逐条判定达成
  （第一条带 US2 断言移除的登记星号）。附带条件 R1c：相机冻结缺陷的修复卡必须**排在 P6
  开工前**（有序，不是挂起），其测试网 = 恢复 zoom 像素断言 + pan 像素断言（两半）+ 按
  v1 自身语义的纬度断言；US5 的两条 P6 断言与 `no-webgpu` project 不动。

### 测试质量结论

effective-testing 评估在每 Task 质量关执行（Task 1–3 的结论沉淀进
`.vibe/p5/p5-coordinator-observations.md`；Task 4–6 报告在 `.vibe/p5/evidence/`）。
整改全部闭环：Task 4 补 partial-pose 合并红测 + 零宽双轴守卫（变异复测具名转红）；
Task 5 按 NOTE 1/4 修正；反模式扫描（弱断言 / 验收点碎片化 / countDraws 回潮）历轮零命中。

**覆盖陈述**：`test:coverage` 99.57 / 98.61 / 100 / 100，四门槛全过（thresholds 未动）。
有测试网的路径：五个 User Story 的完整用户旅程含异常场景（integration 31 条）、构造校验 /
probe / 常量桥锁（unit）、dispose 顺序与重入。**未网路径及理由**：

1. `src/viewer/image-viewer.ts` / `video-viewer.ts` 在 `coverage.exclude`（node 环境一行
   跑不了——实测排除前四门槛倒三条）；其证据面由变异测试 + 集成测试承担，盲区曾用两个
   阴性对照（C1/C2）量到具体位置，后由 US 集成测试实际覆盖。
2. T5-6/m9b（「第二次 dispose 会抛」构造下的加强变异体）：只在特定构造下可观测，m9 已杀，
   按裁决记入。
3. M21（PTZ setter 的 `assertAlive` 纯契约转发）：裁决出范围。
4. 相机冻结缺陷（非线性投影 pan/zoom 不达画布）：**源缺陷不在本卡 scope**（P2+P3 文件，
   终审以 diff 归属核实），US2 滚轮像素断言红-on-pristine 已按纪律移除并在原处写明恢复
   条件；终审判定「green 套件不断言任何假话」（US1 拖拽是 linear、US3 切换触发冲刷路径）。

## 审查意见

**approve**（2026-09-23，协调者第 5 关验收）。

四步全审通过：结构化 review（分支健康、43/43 提交前缀、文件面与 scope 相符、plan 差异
仅为 checkbox 勾选、分支卡与主卡两节同步）；plan 红线逐条核对（无桥回潮——全树仅两条
P4 前置注释提及 `PanoTestApi`，零代码引用；无 `src/core/index.ts` barrel；P4 fixtures
在位；`thresholds` 未动且新增 exclude 均有实测理由并就地注明；五个 User Story 集成测试
文件齐全；fisheye 守卫三件套——具名豁免 + 行为断言 `/not implemented/` + 过桥断言——
均在）；门禁证据复核；最重发现亲验（下述第 3 条）。公开面冻结与 demo 整文件替换两处
「byte 级一致」主张均以 SHA-256 独立核对相符（1244B / 1497B 两块均同哈希）。

逐条发现（均不阻塞合并）：

1. **随卷修正（陈旧自报数字）**：卡面「分支 23 文件 +4886/−21」与实测不符——分支尖端
   实为 33 文件 +5021/−67（全量）/ 31 文件 +4768/−20（除 docs）；「+4886/−21」恰为
   `72442ba`（终审后再补三笔 docs 提交前的尖端）的全量 diffstat，「23 文件」不匹配任何
   分支快照。与 p4 卡第 2 条发现同类，按先例随卷修正，不计缺陷。
2. **登记（P7 类目 +1）**：`test/integration/support/echo.ts:186-192` 注释提及
   `PanoTestApi`，是 P4 只登记了 `image-source.test.ts:8` 之外的**第二处**前置遗留
   悬空引用（p5 零行 diff，`git diff` 核实）。P7 清理类目应含此两处。
3. **R1c 上升为协调者行动项（最重要的一条）**：相机冻结缺陷的因果链已由协调者对照
   真实代码逐环亲验属实——`matrix.ts:177-182` 非线性类型以常量 `LEGACY_QUAD_VIEW`
   作 view 且 zoom 按设计不进矩阵（`:128`），故 clip 与姿态、zoom 均无关；
   `backend.ts:353` 的 `mat4.equals` 早退对非线性投影的**每一次**相机变更成立；
   `:363` `#writeCameraUniforms()` 是 `povLatitude`/`povLongitude`/`zoom` 的唯一写入
   点（`:382-384` 打包、`writeBuffer` 上传），从不执行；仅投影类型/extent 变化
   （clip 真变）或 `setSource` 纹理投影变化（`:421-423`）会冲刷；shader 从 uniform
   读姿态（`panorama.wgsl:245,252`）。三个文件本卡零 diff，归属 P2+P3 属实。
   **修复卡必须排在 p6-webgl2-backend 开工之前创建并置为有序前置**——p5 合并即解锁
   p6，而 p6 的 WebGL2 后端会复制同一份 setCamera 早退逻辑，先修冻结可让 p6 只抄对的。
   本轮验收后协调者立即向用户当面提出此项，不等下一轮。

结论：六个 Task 证据链完整（变异测试具名击杀判据 + 阴性对照 + 沙箱还原核对），偏离全部
双关核实，质量门整改闭环，终审 merge-ready-with-registrations 的三项登记均已按上面对应
处置。**approve，即行合并。**

4. **合并后 verify 红，已自动回退（2026-09-22T19:01:10.497Z）**：合并前主分支 verify 已证绿，红归因于本次合并；主分支已 reset 回 9bc4ed8（未 push，本地回退安全）。分支 feature/p5-viewer 原样保留——按下方失败输出整改后重跑 task-finish 重新交卷。

失败输出尾部：
```

 ❯ |no-webgpu (chromium)| test/integration/fallback/smoke.test.ts (0 test)
 ❯ |no-webgpu (chromium)| test/integration/fallback/user-story-no-webgpu.test.ts (0 test)

 Test Files  2 failed | 18 passed (20)
      Tests  103 passed (103)
   Start at  03:01:05
   Duration  5.14s (worker 69%, tests 28%, import 3%)

03:01:07 [vite] (client) ✨ new dependencies optimized: debug, gl-matrix
03:01:07 [vite] (client) ✨ optimized dependencies changed. reloading

[vitest] Vite unexpectedly reloaded a test. This may cause tests to fail, lead to flaky behaviour or duplicated test runs.
For a stable experience, add the newly optimized dependencies to your config's `optimizeDeps.include` field manually.


⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  |no-webgpu (chromium)| test/integration/fallback/smoke.test.ts [ test/integration/fallback/smoke.test.ts ]
 FAIL  |no-webgpu (chromium)| test/integration/fallback/user-story-no-webgpu.test.ts [ test/integration/fallback/user-story-no-webgpu.test.ts ]
Error: Failed to import test file /Users/yusangeng/workspace/pano.gl/test/integration/support/require-no-webgpu.ts
Caused by: Error: Vitest failed to find the runner. One of the following is possible:
- "vitest" is imported directly without running "vitest" command
- "vitest" is imported inside "globalSetup" (to fix this, use "setupFiles" instead, because "globalSetup" runs in a different context)
- "vitest" is imported inside Vite / Vitest config file
- Otherwise, it might be a Vitest bug. Please report it to https://github.com/vitest-dev/vitest/issues

 ❯ test/integration/support/require-no-webgpu.ts:9:1

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯
```

**勘误（协调者，2026-09-23）**：上条第 4 项经分流裁定为**环境/工具问题，非分支缺陷**——失败尾部的 vite 消息即直接诱因（运行中 `new dependencies optimized: debug, gl-matrix` → reload → runner 丢失）；同一棵树在分支 worktree 连续三轮 106 用例全绿、opus 终审独立复跑全套绿，主检出是合并后**首次**加载 viewer 引入的 `gl-matrix`，冷 optimizeDeps 缓存触发竞态。主检出侧已热（实测 `node_modules/.vite/.../deps/_metadata.json` 已列 `debug, gl-matrix`，由失败那轮完成优化）。**无需执行者整改**（上条「重跑 task-finish」的指示作废），主卡翻回 `reported`，即行重跑 task-merge。若同签名再红则停手报用户。
