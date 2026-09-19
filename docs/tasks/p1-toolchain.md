---
plan: docs/superpowers/plans/2026-09-19-p1-toolchain.md
scope: [package.json, tsconfig.json, tsconfig.legacy.json, tsup.config.ts, vitest.config.ts, playwright.config.ts, eslint.config.js, .travis.yml, .github/workflows/**, scripts/legacy-build.mjs, src/diagnostics.ts, src/index.ts, test/**, demo/**, webpack/**, legacy/**]
verify: if [ -f vitest.config.ts ]; then npm run typecheck && npm run lint && npm run test:unit && npm run build; fi
layer: foundation
state: open
createdAt: 2026-09-19T07:55:59.691Z
---
# 任务：P1 — 工具链骨架

开工先读 plan 头部。本卡把 v0.2.2 的源码整体迁到 legacy/，同时建起新工具链（TS5 strict、vitest、tsup、eslint、playwright + WebGPU 守卫）。verify 写成条件式是自举悖论：vitest.config.ts 是本卡自己产出的。npm i 之后需要 npx playwright install chromium —— 默认的 chrome-headless-shell 没有 GPU 栈，requestAdapter() 返回 null，所有 WebGPU 测试会静默空跑。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
