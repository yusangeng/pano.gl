---
plan: docs/superpowers/plans/2026-09-19-p2-core.md
scope: [src/core/**, src/renderer/shaders/**, scripts/gen-shader-constants.mjs, test/**]
verify: npm run typecheck && npm run gen:shaders -- --check && npm run test:coverage
layer: domain
deps: [p0-freeze-baseline, p1-toolchain]
state: open
createdAt: 2026-09-19T07:55:59.799Z
---
# 任务：P2 — core 纯逻辑

开工先读 plan 头部。本卡是纯逻辑层：投影数学、CPU 参考实现、着色器常量的单一真源（projection-kinds.json -> gen-shader-constants.mjs -> generated.ts）。它不碰 GPU。verify 里的 gen:shaders --check 是防漂移闸：改了 JSON 没重新生成，或者手改了 generated.ts，都会红。CPU 参考实现的对照数据来自 P0 冻结的基线。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
