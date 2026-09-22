---
plan: docs/superpowers/plans/2026-09-19-p5-viewer.md
scope: [src/viewer/**, src/index.ts, test/**, vitest.config.ts, demo/**]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: app
deps: [p4-media-interaction]
state: doing
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

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
