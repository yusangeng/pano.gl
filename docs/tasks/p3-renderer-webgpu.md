---
plan: docs/superpowers/plans/2026-09-19-p3-renderer-webgpu.md
scope: [src/renderer/**, src/core/reference.ts, demo/**, test/integration/**, index.html]
verify: npm run typecheck && npm run test:unit && npm run test:integration
layer: foundation
deps: [p2-core]
state: open
createdAt: 2026-09-19T07:55:59.904Z
---
# 任务：P3 — renderer + WebGPU

开工先读 plan 头部。本卡是全屏三角形 + invClip 重构的 WebGPU 后端（顶点着色器只写 clip space，片元着色器反解出球面点），以及 demo/test-entry.ts 这个集成测试入口。集成测试全部 page.goto('/')，靠的就是仓库根新增的 index.html。demo/ 在 tsconfig 的 include 之外，改完记得确认 typecheck 覆盖到了。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
