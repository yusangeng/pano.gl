---
plan: docs/superpowers/plans/2026-09-19-p4-media-interaction.md
scope: [src/core/events.ts, src/media/**, src/interaction/**, scripts/gen-fixtures.mjs, public/fixtures/**, test/**, vitest.config.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: domain
deps: [p3-renderer-webgpu]
state: doing
createdAt: 2026-09-19T08:51:52.642Z
---
# 任务：P4 — media + interaction

开工先读 plan 头部第 1、2 条：`src/media/` 里**不允许出现 `frameSize` 或它的任何同义词**（上传尺寸由后端按 device limit 决定），`SourceState` 由 core 定义、本层只组合，不重新定义。

**`src/core/events.ts` 是 foundation 层的，先做它** —— `EventEmitter` / `Disposable` 不依赖本卡其余任何东西，后面的 media 与 interaction 都建在它上面。

同样**没有桥**：本卡的集成测试直接 `import src/media/` 与 `src/interaction/` 的类，**不要重新长出 `demo/test-entry.ts` / `test-entry-hooks/` / `window.__panoTest`**。完成标准里有一条就是在查这个，写完自己 `git grep` 一遍。

Task 2 Step 7 用 `scripts/gen-fixtures.mjs` 生成两个集成测试素材（`public/fixtures/panorama.png` 与 `clip.mp4`）。**需要本机有 ffmpeg，产物要提交**（消费方不需要装 ffmpeg）：P5 的五个 User Story 和 P6 的后端对比都读它们，缺了 P5 那一卡做不下去。提交前用 `ffprobe` 复核 512x256 / 64 帧。

verify 用的是 `npm run test:coverage` 而不是 `test:unit`：**分支覆盖 ≥90% 是构建失败而不是目标**，`test:unit` 不带覆盖率会静默放过它。`vitest.config.ts` 在本卡 scope 里就是这个用途 —— `image-source.ts` / `video-source.ts` 这类围着 DOM 与解码器转的代码如果拉低了门槛，**首选补测试**，确实测不到才加 exclude 并写明理由。**不要删 `thresholds`。**

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
