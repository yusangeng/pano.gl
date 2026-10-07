---
plan: docs/superpowers/plans/2026-10-07-lat-zoom-reference-pin.md
scope: [test/**]
verify: npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
layer: domain
deps: [camera-aspect-fit]
state: open
createdAt: 2026-10-07T06:36:50.427Z
---
# 任务：lat≠0×zoom≠1 reference pins（zoom-1 盲区闭环）



## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
