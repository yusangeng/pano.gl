---
plan: docs/superpowers/plans/2026-09-19-p7-cleanup.md
scope: [legacy/**, webpack/**, vendor/**, demo/**, test/**, scripts/**, docs/**, README.md, CLAUDE.md, package.json, package-lock.json, .gitignore, .npmignore, .github/workflows/**, tsconfig.legacy.json, .babelrc, vitest.config.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build && npm publish --dry-run
layer: tool
deps: [p6-webgl2-backend]
state: open
createdAt: 2026-09-19T08:51:53.032Z
---
# 任务：P7 — 删旧代码与收尾

开工先读 plan 头部。本卡删掉全部旧代码（`legacy/`、`webpack/`、`vendor/`、旧 demo 的三个残留文件）并改文档。**跑完 Step 3 的悬空引用检查再动手删。**

**本卡是本轮唯一会读到「描述未来状态的文件」的任务**，所以两条顺序要求：
- Step 6 要逐条核对 `CLAUDE.md`，并把开头那段「v1 迁移尚未完成」的声明删掉 —— 那是本卡存在的意义之一。superloop 的执行者拿到的是主分支 HEAD，在 P7 之前它读到的是一个描述未来状态的文件。
- Task 2 的悬空引用检查里有一条 `git grep "__panoTest\|PanoTestApi\|test-entry"`，在 `docs/` 之外必须为空。浏览器模式带来的那份简化，这一期不能把它改回去。

**表里没有 `demo/test-entry.ts`，也没有 `demo/test-entry-hooks/`** —— 它们从来不曾存在。看到 `test/integration/` 里残留 `import type {} from ../../demo/test-entry-hooks/...` 这种 type-only import，**删掉它，不要去建那个目录**。

`.travis.yml` 既不在 scope 里也不删：P1 的 Task 9 Step 4 已经删过了，这一期只确认。

verify 里 `npm publish --dry-run` 红了 = 打包配置有问题（`files` 字段、`.npmignore`、`dist` 结构），不是环境问题。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
