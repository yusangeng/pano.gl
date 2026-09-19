---
plan: docs/superpowers/plans/2026-09-19-p7-cleanup.md
scope: [legacy/**, webpack/**, vendor/**, demo/**, scripts/**, docs/**, README.md, CLAUDE.md, package.json, .gitignore, .npmignore, .travis.yml, .github/workflows/**, tsconfig.legacy.json, .babelrc]
verify: npm run typecheck && npm run lint && npm run test:unit && npm run test:integration && npm run build
layer: tool
deps: [p5-viewer, p6-webgl2-backend]
state: open
createdAt: 2026-09-19T07:56:06.396Z
---
# 任务：P7 — 删旧代码与收尾

开工先读 plan 头部。本卡删掉全部旧代码（legacy/、webpack/、vendor/、旧 demo）并改文档。Step 6 要逐条核对 CLAUDE.md 并把开头的「迁移尚未完成」声明删掉——那是本卡存在的意义之一：superloop 的执行者拿到的是主分支 HEAD，在 P7 之前它读到的是一个描述未来状态的文件。跑完 Step 3 的悬空引用检查再动手删。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
