---
plan: docs/superpowers/plans/2026-09-19-p1-toolchain.md
scope: [package.json, package-lock.json, tsconfig.json, tsconfig.legacy.json, tsup.config.ts, vitest.config.ts, eslint.config.js, .travis.yml, .github/workflows/**, scripts/legacy-build.mjs, src/diagnostics.ts, src/index.ts, test/**, demo/**, webpack/**, legacy/**]
verify: if [ -f vitest.config.ts ]; then npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build && npm run build:legacy; fi
bootstrap: npx playwright install chromium
layer: foundation
deps: [p0-freeze-baseline]
state: open
createdAt: 2026-09-19T08:51:52.237Z
---
# 任务：P1 — 工具链骨架

开工先读 plan 头部。本卡把 v0.2.2 的源码整体迁到 `legacy/`，同时建起新工具链，并把集成测试迁到 **vitest 浏览器模式**（`@vitest/browser` + `@vitest/browser-playwright`，vitest ^5）。

**这是本卡最容易做错的地方：** devDependencies 里是 `playwright`（`@vitest/browser-playwright` 的 peer），**不是 `@playwright/test`**；仓库里不应该出现 `playwright.config.ts`，也不应该有 `page.goto`。测试文件本身就跑在页面里，`import` 就是全部。凡是看到 `demo/test-entry.ts` / `PanoTestApi` / `window.__panoTest` / `demo/test-entry-hooks/`，那都是 P3 切换前的写法，见到就删，不要补建。

verify 写成条件式是**自举悖论**：`vitest.config.ts` 是本卡自己产出的，合并前主分支上还没有它。条件为假时整条跳过，为真时整条跑 —— 所以 `test:integration` 和 `build:legacy` 都在里面是安全的。

bootstrap 里的 `npx playwright install chromium` 不能省：默认的 chrome-headless-shell 没有 GPU 栈，`requestAdapter()` 返回 null，所有 WebGPU 测试会静默空跑 —— 两个守卫（`require-webgpu.ts` / `require-no-webgpu.ts`）就是为此而设，Task 8 Step 5 要求验证它们真的会拦人。

`.travis.yml` 在这一卡删除（Task 9 Step 4），所以它必须在 scope 里 —— scope 是改动白名单，**删除也算改动**。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
