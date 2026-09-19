---
plan: docs/superpowers/plans/2026-09-19-p0-freeze-baseline.md
scope: [tools/baseline/**, test/fixtures/baseline/**, .gitignore, docs/superpowers/specs/**]
verify: if [ -f tools/baseline/verify-fixtures.mjs ]; then node tools/baseline/verify-fixtures.mjs; fi
layer: foundation
state: open
createdAt: 2026-09-19T07:55:59.591Z
---
# 任务：P0 — 冻结基线

开工先读 plan 头部。本卡把 v0.2.2 的 debug bundle 与它的一组渲染结果冻结进 test/fixtures/baseline/，P2 起的 CPU 参考实现和 P6 的门禁都拿它当对照。verify 写成条件式是自举悖论：verify-fixtures.mjs 是本卡自己产出的，主分支上还没有它。tools/baseline/ 有自己的 package.json 和 node_modules（.gitignore 已忽略），worktree 建成后需要 cd tools/baseline && npm i。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
