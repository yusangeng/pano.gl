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

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
