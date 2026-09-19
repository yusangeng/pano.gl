---
plan: docs/superpowers/plans/2026-09-19-p4-media-interaction.md
scope: [src/media/**, src/interaction/**, src/core/events.ts, public/fixtures/**, scripts/gen-fixtures.mjs, test/**]
verify: npm run typecheck && npm run test:unit && npm run test:integration
layer: domain
deps: [p3-renderer-webgpu]
state: open
createdAt: 2026-09-19T07:56:06.092Z
---
# 任务：P4 — media + interaction

开工先读 plan 头部第 1、2 条：src/media/ 里不允许出现 frameSize 或它的任何同义词（上传尺寸由后端按 device limit 决定），SourceState 由 core 定义、本层只组合。Task 2 Step 7 用 scripts/gen-fixtures.mjs 生成两个集成测试素材（需要本机有 ffmpeg，产物提交，消费方不需要装）。生成器已经实测跑过：512x256、64 帧。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
