---
plan: docs/superpowers/plans/2026-09-19-p0-freeze-baseline.md
scope: [tools/baseline/**, test/fixtures/baseline/**, .gitignore, docs/superpowers/specs/**]
verify: if [ -f tools/baseline/verify-fixtures.mjs ]; then (cd tools/baseline && node verify-fixtures.mjs); fi
bootstrap: (cd tools/baseline && npm install && npx playwright install chromium)
layer: foundation
state: open
createdAt: 2026-09-19T08:51:52.107Z
---
# 任务：P0 — 冻结基线

开工先读 plan 头部。本卡把 v0.2.2 的 debug bundle 与它的一组渲染结果冻结进 `test/fixtures/baseline/`，P2 起的 CPU 参考实现和 P6 的门禁 C 都拿它当对照。

verify 写成条件式是**自举悖论**：`verify-fixtures.mjs` 是本卡自己产出的，合并前主分支上还没有它。条件式让「还没产出」等于「跳过」而不是永远红。**不要把条件式当冗余删掉。**

`tools/baseline/` 有自己的 `package.json`，**`package-lock.json` 是要提交的**（plan 的 `git add` 里就有它），只有 `node_modules` 进 `.gitignore`。worktree 建成后需要 `cd tools/baseline && npm i`，并 `npx playwright install chromium`。

**这里的 playwright 是合法的，不要改成 vitest。** 它驱动的是 v0.2.2 那个 webpack 产物的 debug bundle，是一次性取证工具，不是本包的测试套件 —— 本包的测试从 P1 起全部跑在 vitest 浏览器模式里。

`tools/baseline/fixtures.test.mjs` 用 `node --test` 跑，不走 vitest，也不需要 P1 的工具链。

## 完成报告

**做了什么**：plan 的 6 个 Task 全部完成——`tools/baseline/` 取证工具（`probe.html` 逐 drawArrays 录 uniform 流 + readPixels、`capture.mjs` 走 4 相机 × 4 状态矩阵、`states.mjs` 单一状态矩阵、`fixtures.test.mjs` 10 个断言、`verify-fixtures.mjs` 闸 6 入口），`test/fixtures/baseline/` 冻结产物（16 组 PNG + uniform 流 JSON、`source.png`、`index.json` 逐条 sha256/字节数、v0.2.2 debug `bundle.js`），README 记录取证方式与可复现性，spec §10.2/§11/§12 的 P0 行与全部【实测】标注同步更新。

**自测结果**：
- 卡 verify（`node verify-fixtures.mjs`）10/10 绿，含新增的清单对账与失败分支负面测试；
- 完整重捕获跑了两遍：16 PNG + 16 uniform 流逐字节相同，`index.json` 仅 `capturedAt` 变化——基线可按需重推导；
- `source.png` 逐像素解码核验 = 文档所记图案（16384 像素全对），防「拿别的图重渲染再比对」；
- 破坏实验：翻转任一 PNG 单字节 → 清单对账测试立刻红，还原后复绿。

**偏离 plan 的点**（均为等价或加强）：
1. 探针 API 依实测修正：构造参数是 `{el, src, camera}`（plan 原文 `container`/`cameraOptions` 不存在于 v0.2.2）；`rotate(lat,lng)` 实为**增量**旋转且首参是经度。
2. plan 写「等两帧」，实测改为「等三帧全收、取末帧」——第二、三帧是稳态证据，且等录制数而非数 rAF tick，杜绝差一帧静默成功。
3. `index.json` 每条加了 `pngSha256`/`pngBytes`/`uniformNames`/`frameCount`（plan 只要求清单）；对应新增对账测试，哈希列是**被执行的约束**不是装饰。
4. fixtures 测试 8 个（plan 设想 6 个）：多出「manifest 与磁盘对账」「verify 失败分支」两个，且第 4 个（旋转到达 GPU）按相机族分别断言载体 uniform，重写为 plan 未展开的形式。
5. plan Task 6 Step 3 的文件名笔误 `...-redesign.md`，实际提交为 `...-design.md`。

**实测确立的四项根因**（供 P2+ 直接消费，均在 spec §11 与 README 留档）：`u_CamPOVLatitude` 是死 uniform（纬度原理上到不了 GPU，V3 结案）；非线性相机 pose 只走 `u_CamPOVLongitude`（`u_CamTransMatrix` 跨状态逐字节恒定）；`% 25` 经度守卫逐值吻合（45→20、180→5、300→0）；缩放夹取是单向的（cyl/planet 放大整个丢弃，`cylindrical/zoomed`、`planet/zoomed` 与 `origin` 逐字节相同）。另：L1 的 dispose 拼写错误使 rAF 循环永不停止——探针按 canvas 身份过滤绘制正是为此。

**遗留风险**：
1. 基线的逐字节可复现限于**同机同 Chromium 构建**；异机 GPU 圆整差异是真实风险，README 已写明处置原则（差异出现先怀疑浏览器构建，动基线须显式决策）。
2. `tools/baseline/` 是第二个依赖树（playwright）。根包发布时应在 `files`/`.npmignore` 排除之——属 P1 打包范畴，本卡不动根包配置。
3. `bundle.js`（1.5MB，v0.2.2 产物）占了交付字节的大头。它是「冻结 v0.2.2 渲染行为」的物证与重捕获前提，保留；若 P7 清理时判定可由重捕获产物替代，届时裁决。

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

**手段**：effective-testing 清单（维度 0–4 + 反模式 A–F）审查 `fixtures.test.mjs` + `verify-fixtures.mjs`，缺陷思维实验驱动（逐类破坏基线数据，看套件是否变红）。

**发现 → 整改**（循环 2 轮收敛，终态 CRITICAL 0 / WARNING 0）：
1. 【CRITICAL 级】`index.json` 的 `pngSha256`/`pngBytes`/`uniformNames`/`frameCount` 从不与磁盘对账——手改 PNG + 陈旧清单可过闸。整改：新增「manifest 与磁盘对账」测试（哈希、字节数、帧数、uniforms.json 内 camera/state 身份、拒绝 `'?'` 占位名、磁盘名字集 == 清单名字集），并做了变异验证（翻 1 字节必红）。
2. 【CRITICAL 级】`verify-fixtures.mjs` 失败分支从未执行过，且从 node:test 上下文内运行时继承 `NODE_TEST_CONTEXT` 使嵌套 runner 什么也不跑就退出 0——闸 6 信任的出口码在该场景静默变空。整改：wrapper 剥离该标记；新增负面测试（临时目录副本 + 空 manifests → 断言退出码 1 且 stderr 给出重捕获指引；env 护栏防副本自我递归）。
3. 【WARNING 级】同相机两个 state 的 uniforms.json 互换不可测、probe 名字恢复链路（`'?'` 回退）无断言 → 并入上述对账测试。
4. 【WARNING 级】6 个测试重复读 `index.json` → 提升为模块级单次读取。

**覆盖陈述**（改动触及的路径，哪些有测试网 / 哪些没有 / 为什么）：
- **有网**：`verify-fixtures.mjs` 两个分支（成功=每次 verify；失败=负面测试，含 env 剥离回归）；`states.mjs` 的 STATES/CAMERAS/CANVAS_SIZE（完整性测试遍历矩阵，间接消费 `captureId`）；`test/fixtures/baseline/**` 全部数据（每个 PNG 逐哈希、每份 uniforms.json 结构与身份、矩阵完备性、死 uniform、简并态合成）。
- **没有网**：`probe.html`、`capture.mjs` 的代码路径。原因：二者只能在带 GPU 的真浏览器里跑，单测里 mock WebGL 等于测 mock 而不是测本基线要钉死的栅格化行为。它们的**输出**即被测物（上述数据网），它们的失败路径（画布尺寸不符 / 无帧 / 超时）在两次真实完整捕获中实际执行过，失败会落成 index.json 的 error 桩，而测试 1+2 对 error 桩是响亮失败。
- vitest/90% 分支覆盖等要求自 P1 起适用——本卡在 v1 工具链之前，用 node:test 是 plan 明文约定。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
