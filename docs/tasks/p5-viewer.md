---
plan: docs/superpowers/plans/2026-09-19-p5-viewer.md
scope: [src/viewer/**, src/index.ts, test/integration/**, demo/**]
verify: npm run typecheck && npm run test:unit && npm run test:integration
layer: app
deps: [p4-media-interaction]
state: open
createdAt: 2026-09-19T07:56:06.197Z
---
# 任务：P5 — viewer

开工先读 plan 头部，尤其是前置依赖那几条。本卡是公开 API 那一层，五个 User Story 各一个集成测试文件。测试入口的钩子按 P3 定下的全局接口 PanoTestApi 用 declare global 拓宽——不要改 P3 的 test-entry.ts 去加字段，也不要写 declare module '../test-entry'（那会声明出一个模块作用域的同名接口，全局那个一个字段都不会多）。动手前先 ls public/fixtures/ 确认 P4 的两个素材在。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
