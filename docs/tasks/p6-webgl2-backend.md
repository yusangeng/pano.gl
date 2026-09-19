---
plan: docs/superpowers/plans/2026-09-19-p6-webgl2-backend.md
scope: [src/renderer/**, src/viewer/backend-factory.ts, demo/test-entry-hooks/**, test/integration/**, playwright.config.ts, tsup.config.ts]
verify: npm run typecheck && npm run test:unit && npm run test:integration
layer: foundation
deps: [p5-viewer]
state: open
createdAt: 2026-09-19T07:56:06.297Z
---
# 任务：P6 — WebGL2 backend

开工先读 plan 头部。本卡补上 WebGL2 降级后端，并做门禁 C：两个后端与 CPU 参考在同一份请求上逐像素交叉验证。难点是 NDC 深度区间不同（GL 是 [-1,1]，WebGPU 是 [0,1]），plan 里对此有专门说明。依赖 P5 而不是 P3：本卡要改 src/viewer/backend-factory.ts（P5 建的），并且断言 P5 的 user-story 文件不被改动。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
