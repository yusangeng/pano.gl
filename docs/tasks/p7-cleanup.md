---
plan: docs/superpowers/plans/2026-09-19-p7-cleanup.md
scope: [legacy/**, webpack/**, vendor/**, demo/**, test/**, scripts/**, docs/**, README.md, CLAUDE.md, package.json, package-lock.json, .gitignore, .npmignore, .github/workflows/**, tsconfig.legacy.json, .babelrc, vitest.config.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build && npm publish --dry-run
layer: tool
deps: [p6-webgl2-backend, pan-zoom-semantics]
state: open
createdAt: 2026-09-19T08:51:53.032Z
---
# 任务：P7 — 删旧代码与收尾

开工先读 plan 头部。本卡删掉全部旧代码（`legacy/`、`webpack/`、`vendor/`、旧 demo 的三个残留文件）并改文档。**跑完 Step 3 的悬空引用检查再动手删。**

**本卡是本轮唯一会读到「描述未来状态的文件」的任务**，所以两条顺序要求：
- Step 6 要逐条核对 `CLAUDE.md`，并把开头那段「v1 迁移尚未完成」的声明删掉 —— 那是本卡存在的意义之一。superloop 的执行者拿到的是主分支 HEAD，在 P7 之前它读到的是一个描述未来状态的文件。
- Task 2 的悬空引用检查里有一条 `git grep "__panoTest\|PanoTestApi\|test-entry"`，在 `docs/` 之外必须为空。浏览器模式带来的那份简化，这一期不能把它改回去。
- deps 里的 `pan-zoom-semantics`（2026-09-23 追加）会改写 `CLAUDE.md`「arbiter」节的 lngOffset 段落与多个交互行为——Step 6 逐条核对 CLAUDE.md 时读到的必须是它合并后的版本，所以本卡排在它后面。

**表里没有 `demo/test-entry.ts`，也没有 `demo/test-entry-hooks/`** —— 它们从来不曾存在。看到 `test/integration/` 里残留 `import type {} from ../../demo/test-entry-hooks/...` 这种 type-only import，**删掉它，不要去建那个目录**。

`.travis.yml` 既不在 scope 里也不删：P1 的 Task 9 Step 4 已经删过了，这一期只确认。

verify 里 `npm publish --dry-run` 红了 = 打包配置有问题（`files` 字段、`.npmignore`、`dist` 结构），不是环境问题。

## 完成报告

### 做了什么

六个 Task 全部完成、双审（spec + quality）全部闭合、终末全分支审查 APPROVED：

1. **Task 1 审计**：删除前全量 grep + 尺寸记录，产物 `docs/superpowers/notes/p7-deletion-audit.md`（Removed/Kept/Removed-assets/Never-existed/Deferred 五表）。发现 plan 所列 `scripts/legacy-build.mjs` 在全部 git 历史上无 Add 记录——从未存在，Task 2 跳过其 `git rm`。
2. **Task 2 删除**：`legacy/`（160K）、`webpack/`、`vendor/`（24K cuon）、`.babelrc`、`tsconfig.legacy.json`、`demo/Index.js`、`demo/webpack.config.js`、`demo/index.css`、`demo/libs/`（580K）、`demo/fonts/`（1.7M）全部移除；`.travis.yml` 确认 P1 已删。基线 fixture `test/fixtures/baseline/bundle.js`（内嵌编译后的 cuon/legacy 代码，gate A 的对拍 oracle）按裁定保留。
3. **Task 3 依赖**：运行时依赖 8 → 3（`gl-matrix` + `debug` + `ms`），version 1.0.0，`files: ["dist"]`，`.npmignore`（fix 轮重写注释——plan-verbatim 措辞四处主张两假一误导，npm 10.9.8 fixture 实证后改写）。
4. **Task 4 文档**：README 重写（36.7 kB gzip 实测入文）、迁移指南 `docs/migration-v0.2-to-v1.0.md`、四张投影截图（Task 4 截取，CR 轮缩至 800×450）。
5. **Task 5 CI**：workflow 改写为 vitest browser mode 双项目（integration 真机 + no-webgpu），SwiftShader flags、verbose reporter、双项目 ran 计数断言。CR 轮加固：计数极性反转（正向匹配 ✓|×，格式漂移读 0 变红）+ skip 预算断言（integration ≤34、no-webgpu ≤1，两条拒绝路径均重放证明会触发）。
6. **Task 6 收尾**：`tsc --noUnusedLocals --noUnusedParameters` 4 findings 全在 src/（统一 C2 处置，见开放项）；knip triage 每 call 有据，**videoOf 删除**（d6808e9，零活引用）；tag v1.0.0 本地打到 12e6ba2 未推（按 ruling 六闸后重打到最终 HEAD）。
7. **CR 两轮 + 测试质量一轮**（详见「自审记录」两节）：第 1 轮 1C+15I → Fix-First 六项（6756490 + 3b8d391）；第 2 轮对抗审 4I + 测试质量 1W+6N → 合并整改批（55a079f）。**R1（CRITICAL）的整改有 CI 直接证据：no-webgpu 项目 38 → 49 ran，事件 API 的 CI 覆盖从零变 5 测试/轮、dispose 顺序机制从零变 6 测试/轮。**

### 自测结果

- CI run 35937013384（55a079f，success）：typecheck / lint / coverage（≥90% 分支，脚本卡）/ build / 产物 node 加载 / **integration ran 99 + skipped 34（预算 34 首跑不误伤；99 = 98 + canary）** / **no-webgpu ran 49 + skipped 1（预算 1）**；canary 在 integration 项目真跑 ✓。
- 此前 run 35935446143（3b8d391）验证 F5 扩容：integration 98+34、no-webgpu 49+1，per-file 分解核对。
- 本地：typecheck 三程序 / lint / unit 301 / no-webgpu 11+1 / integration 12/12（整改批涉及文件）/ photo+video-orientation 13/13 / gen:shaders / publish --dry-run（43 files / 292.1 kB，协调者与终审各自独立重跑 shasum 一致）。
- ci.yml 新计数与预算逻辑对真实 CI log 重放全过；重放曾抓到「脚本回显行」假差异（step log 回显 ci.yml 注释里的字面 `↓ integration (chromium)`；ci.yml 实际读 tee 的 log 不含回显）——以 `.test.ts` 行过滤后对账，教训入台账。

### 偏离 plan 的点

1. `scripts/legacy-build.mjs` 的 `git rm` 跳过——文件从未存在（全历史无 Add 记录），plan 自己警告过 `.travis.yml` 同款陷阱。
2. `.travis.yml` 只确认不删——P1 Task 9 已删。
3. `eslint.config.js:7` 的 stale ignore **未修**——文件不在本卡 scope 白名单，编辑会破交付闸；deferred（audit Deferred 节 + 开放项）。
4. `.npmignore` 注释偏离 plan 字面——plan-verbatim 措辞被 quality 轮 fixture 实证推翻，重写（entries 不变）。
5. 「无死代码：tsc/knip 都干净」验收行**字面未满足**——C2 裁定：src/ 不在白名单，死导出唯一处置是登记开放项而非编辑 src/。属裁定结果，非未登记偏离。
6. Task 5 的 probe 用 paused+seeked 帧而非 playing——「playing」前提被测量推翻（拒收在 seeked-frame import 即触发，run 35924514539），改 probe 反而破坏同帧可比性。
7. tag 时点从「Task 6 Step 5」移到「六闸后」——卡填报在硬要求上优先（闸 1/4 要卡内报告；CR 轮的 append commit 落在任何先打的 tag 之后）。协调者 dispatch 缺陷，记录在案。
8. CR/测试质量整改新增的测试面（no-webgpu include 扩容、双 prototype spy、canary、liveness、ci 计数+预算、presented 2D control、demo/shots 缩图）均为审查轮产物，超出 plan 字面步骤但在 scope 白名单内，各带 CI 实证。

### 遗留风险

- CI 上 integration 项目 34 个 presented-gated 测试在 SwiftShader runner 跳过（结构性缺口）：补偿 = no-webgpu 项目对 viewer-events/dispose-order/四 user story 的 WebGL2 全文执行 + 三门禁真跑 + skip 预算钉住（激增即红）。
- viewer-render-input 一个测试 ungated（断言面只读 spy logs 不触 post-loss DOM；SwiftShader 60–250ms 窗口实测未失手）。
- README prose 度量（36.7 kB gzip、demo/shots 观感图）无自动化 guard——人工维护属常规；像素级正确性由 gate A 基线承担。
- 迁移指南仅中文（目标读者裁定；README 已加 "(written in Chinese)" 标注）。

### 开放项登记（合并后待办 / 待裁决）

**需一句话动作（合并后）**：
1. `CLAUDE.md:38` 层规则句修正——终审 advisory (a)：bless `src/diagnostics.ts` 为 core-equivalent root leaf，措辞改为 "core/ and the root diagnostics.ts leaf"（纯叶子、只 import debug、经 index.ts:22 属公共 API、方向本就正确；规则在 master 上为假 = 本 plan 已纠正过一次的 stale-prohibition 模式）。CLAUDE.md 在本卡白名单内但裁定为 post-merge 动作。

**统一 C2 处置（src/ 不在白名单，登记不编辑）**：
2. tsc `--noUnusedLocals --noUnusedParameters` 4 findings：`reference.ts:157,168` 未用 `x` ×2（**故意**镜像 shader 签名，带 in-code 注释）；`image-source.ts:53` `evt` 未用参数；`backend.ts:79` `#cameraLayout` write-only（:139 赋值从未读，pipeline 用 :234 局部）。
3. `ChannelName`（`src/diagnostics.ts:53`）死导出类型——公共面只 re-export `enableChannels`。

**cosmetic export-only 符号（tag-eve no-go 裁定，6 文件 churn 留后续）**：Task 6 时点 12 项，**现为 10 项**——CR 整改批的 canary（55a079f）让 `probePresentedCanvas` 与 `PresentedCanvasVerdict` 获得消费者。knip 调用：`npx knip --include exports,types`。当前名单（10）：
`decodeFixture`（baseline-browser.ts:81）、`GATE_C_SIZE` / `gateSource` / `renderOffscreenGLSL` / `referenceImage` / `gateRequest`（cross-backend.ts:33/53/93/231/312）、`PathRender`（upload-paths.ts:28）、`CapturedState` / `UniformWrite` / `CapturedUniforms`（test/support/baseline.ts:24/35/41）。

**流程内完成（登记为流程项）**：tag v1.0.0 于 task-finish 六闸后删并重打到最终 HEAD，message 两行（"pano.gl 1.0.0" + "Rewrite: WebGPU-first, WebGL2 fallback. No 0.2.x compatibility — see docs/migration-v0.2-to-v1.0.md."）。

**toolchain（超出本卡 scope 的维护项）**：
4. GitHub Actions 未 pin 到 SHA（`checkout@v4` / `setup-node@v4` 的 Node-20 注解同源）——供应链面，风险中等。
5. `eslint@9.39.5` deprecation warning（在 ^9 范围内）。
6. `eslint.config.js:7/:10` stale ignore 条目（glob 匹配空集，零行为影响；文件不在白名单）。
7. tarball 含 `dist/fixtures` demo 媒体 ~6.7 kB（vite publicDir 拷贝 `public/fixtures` 所致；remedy = `publicDir: false` 或移动媒体，`vite.config.ts` + `public/**` 均不在白名单）。

**裁定项（用户可推翻）**：
8. playing-video follow-up gate NOT required——未观察到 seeked 通过而 playing 拒收的环境；若出现，fail-closed 失败会自己制造证据。
9. smoke#2 macOS-only by design——设备键控 probe（非平台检查）；CI 无 macOS runner（未授权）。
10. ci.yml `tee` 吞 workflow-command（`::error` 注记仍可见，纯展示层）。
11. `demo/image/`（20M）与 `demo/video/`（11M）保留在库、tarball 排除——演示素材，plan 非目标明示。

## 自审记录

### CR 结论

**手段**：gstack review 技能 4-specialist 并行审（testing / maintenance / security / red-team，base d0777ec）→ Step 4.6 合并去重 → Fix-First 整改 → Claude 对抗子代理复审 fix 批（Codex not_installed → Claude-only；五个点名嫌疑逐一验证 + 四 specialist 盲区扫 + 例外条款审计）。

**发现数与轮数**：共 2 轮。
- 第 1 轮：**16 = 1 CRITICAL + 15 INFORMATIONAL**。CRITICAL R1：viewer-events 4 个 runtime 测试 + dispose-order 4 个顺序机制测试 + smoke presented 链在 CI 上零执行（no-webgpu 项目白名单不含这三个文件，CI runner 的 presented-canvas gate 又把 integration 副本整掏空）——event API 的 CI 覆盖恰好为零；核验后修正为「dispose() 契约面有 3 个 ungated 测试真跑，零覆盖的是顺序机制与事件 API」。
- 第 2 轮（对抗审，审 fix 批 6756490+3b8d391）：**4 INFORMATIONAL，0 CRITICAL**。五个点名嫌疑（2D control 在 --disable-gpu 下、双 prototype spy 与 restoreAllMocks 交互、ctx.skip 控制流、ci.yml 行分类、F4 事实准确性）全部验证无损；E1-E10 全部裁定 defensible 无需重开。

**整改**：
- 第 1 轮 Fix-First 六项（commit 6756490 + 3b8d391）：F1 check-coverage.mjs NaN 守卫；F2 presented-canvas 2D 读回工具控制（fail-closed 双层）；F3 upload-paths 冗余实参 + 拒绝时 readyState/currentTime；F4 demo/shots 缩至 800×450（4,547,953→3,194,929 B）+ audit 补行 + README 两句；F5 no-webgpu include += viewer-events + dispose-order（双 prototype 化两处 spy/mock、destroyed-device WebGPU-keyed probe skip、两处 rationale 注释补 CI 现实）——**CI 实证（run 35935446143）：no-webgpu 从 38 ran 增至 49 ran + 1 skip，event API CI 覆盖从零变 5 个测试/轮，顺序机制从零变 6 个/轮**；F6 ci.yml ran 计数排除 skip 行 + 空行守卫（integration 98 ran + 34 skipped 实测）。
- 第 2 轮三项（commit 55a079f）：spies.ts 两条 rationale 前提被本分支自己的 F5 证伪（countDraws 从 prophylaxis 变 CI 上 load-bearing coverage；captureBackends 的「no-WebGPU 项目调用者」前提被 probe-skip 掏空）——对抗审与测试质量评估**独立撞中同一条**，重写；ci.yml ran 计数极性反转（反向排除 ↓ → 正向匹配 ✓|×，reporter 格式漂移时读 0 变红而非把 skip 数成 ran；glyph 用交替不用 bracket——C locale 下多字节 bracket 退化为字节集合）+ skip 预算断言（integration ≤34、no-webgpu ≤1，两条拒绝路径均已在真实 log 上重放证明会触发）；audit 行同句两个基数（3.1M du 口径 vs 3.2M 十进制）统一为精确字节数。

**例外条款**（无法/不整改项，逐条自评，请协调者裁决）：
- E1 ci.yml `tee` 吞 workflow-command：修复需把计数逻辑移出 tee 管道，副作用大于收益（::error 注记仍可见）。风险：低，纯展示层。
- E2 actions 未 pin 到 SHA：toolchain 级开放项，超出本卡 scope（.github/workflows 的 action 引用键已是各 action 的官方标签）。风险：中，供应链面，登记开放项。
- E3 eslint.config.js:7/:10 陈旧 ignore：文件不在 scope 白名单，编辑会破交付闸。风险：零行为影响（glob 匹配空集，lint 绿）。已登记 Deferred + 开放项。
- E4 迁移指南仅中文：产品决策（目标读者是本仓库的中文用户），README 已加 "(written in Chinese)" 标注缓解。风险：低。
- E5 check-coverage.mjs 守卫无单测：脚本 24 行顶层执行形状（Task 5 双审裁定），happy path 每 CI 轮真跑；畸形输入链条 fail-closed（缺文件/坏 JSON/缺字段/null 全在守卫前抛或被拦）。风险：低。
- E6 OperationError 消息不收窄匹配：quality 轮已裁定 Chrome adapter 专属消息 class-match 的权衡，推翻需新证据。风险：低。
- E7 viewer-render-input ungated presented race：断言面只读 spy logs 不触 post-loss DOM（quality 已裁定）；加 gate 会换走该文件唯一的 CI 执行。风险：中低，SwiftShader 时序窗口 60–250ms 实测未失手。
- E8 smoke#2 不进 no-webgpu：project 自检性质（断言 adapter 本身存在，no-webgpu 世界按构造不存在）。风险：零。
- E9 ci grep 不锚定：spec M4 裁定维持；对抗审对唯一真实 log 全量分类验证每个 `project (` 行都是 per-test 行，无误匹配。
- E10 既有开放项照登记（见完成报告开放项清单）。
- 对抗审 adv-4（RECORD-ONLY）：README prose 度量（36.7 kB gzip）无 guard 随 src 漂移、demo/shots 是二次有损压缩且非像素级基线（gate A 才是像素基线）。风险：低——README 数字人工维护属常规；shots 的 README 用途是示意观感非正确性主张。
- 测试质量 tq-3：dispose-order 内联 adapter probe 与 presented-canvas 的早退判定不抽共享 helper——两处形状相似但语义不同（verdict 早退 vs 测试 skip），强抽是搬运不是去重；两处注释已互相点名。风险：低。
- 测试质量 tq-5：check-coverage NaN 守卫无单测（同 E5）。
- canary 已证 2D 控制臂的拒绝路径；offscreen 臂的 throw 无金丝雀——触发需「设备创建成功但离屏渲染为空」，mock 须深入 GPUBuffer 层，得不偿失；与 2D 臂同构同阈值模式。风险：低。

### 测试质量结论

**手段**：effective-testing 审查清单评估本分支测试面改动（独立 agent，d0777ec..HEAD 的 test/ + vitest.config.ts + ci.yml + check-coverage.mjs 增量）。

**发现**：**7 = 0 CRITICAL + 1 WARNING + 6 NOTE**。WARNING tq-1：presented-canvas 探针的 2D 工具控制拒绝路径从未被行使——fail-closed 守卫的拒付若从未被观测，它是主张不是属性；一旦与读回回归叠加，全部 verdict 变 unavailable、全部 gated 测试 skip、构建仍绿。NOTE×6：tq-2 spies 注释前提过时（与对抗审 adv-1 独立撞中）；tq-3 两处手写 adapter probe；tq-4 ci 计数无自动化测试；tq-5 NaN 守卫无单测；tq-6 no-webgpu 白名单包含方向无绊网；tq-7 bounded-redraw 可空转通过。

**整改**（commit 55a079f，与 CR 第 2 轮同批）：tq-1 → 新增 `test/integration/presented-canvas-control.test.ts` 金丝雀（mock readCanvas 全黑，断言 probe rejects；happy path 早已在两个项目每个 gated 文件里跑，refusal 现在也有证明）；tq-1b/tq-6 → ci.yml skip 预算（超预算红构建，新 CI-沉默机制文件以 skip 激增形式显形）；tq-2/adv-1 → spies.ts 两条注释重写；tq-4 → over-count 方向注释（计数只会高估不会漏到假绿）；tq-7 → bounded-redraw 加 `start > 0` liveness 断言（同文件 `stops drawing` 的先例形状）。例外条款：tq-3、tq-5（见 CR 结论节）。

**覆盖陈述**（改动触及的路径 vs 测试网）：
- **有网的**：dispose 顺序机制与事件 API——两个项目各执行一遍（integration 真机 WebGPU 全文 + no-webgpu WebGL2 全文，CI 上后者是唯一执行者，F5 之后）；bounded-redraw 的空转口已用 liveness 断言关闭；双 prototype spy 求和技术在两个项目下由构造保证恰一臂计数、精确断言 `toBe(1)` 使错臂读 0 必红；presented 探针 2D 控制臂的 happy path（每 gated 文件每轮）与拒绝路径（金丝雀）都已执行；ci.yml 计数与预算的拒绝路径已对真实 CI log 重放证明会触发；viewer-events 的 6 项断言（含 payload 同一性与 version latch）在 CI 每轮执行。
- **无网及理由**：ci.yml 计数逻辑无自动化测试——只在 GitHub runner 上执行且 fail-closed（格式漂移读 0 → 红），评估裁定可接受；check-coverage.mjs NaN 守卫无单测——畸形输入链条在守卫前全数抛出，主门禁是 vitest threshold 每 CI 轮真跑（同 CR 结论 E5）；offscreen 控制臂 throw 无金丝雀——触发条件需 mock 至 GPUBuffer 层，与 2D 臂同构（见 CR 结论）；README prose 度量（gzip 字节数）无 guard——人工维护，属常规文档属性。
- **DOM-bound 类（viewer.ts / backend-factory.ts / image-viewer.ts / video-viewer.ts / webgl2/backend.ts）不在 unit 覆盖率内**：node 环境无 DOM/GPU，mock 只会回放作者假设（vitest.config 逐文件记录了测量依据）；其真实执行由 integration + no-webgpu 两项目承担（不报覆盖率），CI 上 no-webgpu 项目是这些类 user-story 旅程与失败路径的执行者。
- **SwiftShader runner 的结构性缺口及其补偿**：integration 项目 34 个 presented-gated 测试在 CI 跳过——补偿是 no-webgpu 项目对 viewer-events/dispose-order/四 user story 的 WebGL2 全文执行 + 三门禁（gate A/B/C）在 CI 真跑（offscreen 渲染健康）；此缺口现由 skip 预算断言钉住（激增即红）。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
