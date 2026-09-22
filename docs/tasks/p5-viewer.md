---
plan: docs/superpowers/plans/2026-09-19-p5-viewer.md
scope: [src/viewer/**, src/index.ts, test/**, vitest.config.ts, demo/**]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: app
deps: [p4-media-interaction]
state: open
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

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险。**卡级总结仍在 Task 6 收工时写**；
下面这一节是 Task 4 的分节报告。）

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

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
