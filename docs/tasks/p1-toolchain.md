---
plan: docs/superpowers/plans/2026-09-19-p1-toolchain.md
scope: [package.json, package-lock.json, tsconfig.json, tsconfig.legacy.json, tsconfig.scripts.json, vitest.config.ts, vite.config.ts, eslint.config.js, .gitignore, .travis.yml, .github/workflows/**, README.md, scripts/legacy-build.mjs, src/diagnostics.ts, src/index.ts, test/**, demo/**, webpack/**, legacy/**]
verify: if [ -f vitest.config.ts ]; then npm run typecheck && if [ -f eslint.config.js ]; then npm run lint; fi && npm run test:coverage && npm run test:integration && npm run build; fi
bootstrap: npx playwright install chromium
layer: foundation
deps: [p0-freeze-baseline]
state: open
createdAt: 2026-09-19T08:51:52.237Z
---
# 任务：P1 — 工具链骨架

开工先读 plan 头部。本卡把 v0.2.2 的源码整体迁到 `legacy/`，同时建起新工具链，并把集成测试迁到 **vitest 浏览器模式**（`@vitest/browser` + `@vitest/browser-playwright`，vitest ^5）。

**这是本卡最容易做错的地方：** devDependencies 里是 `playwright`（`@vitest/browser-playwright` 的 peer），**不是 `@playwright/test`**；仓库里不应该出现 `playwright.config.ts`，也不应该有 `page.goto`。测试文件本身就跑在页面里，`import` 就是全部。凡是看到 `demo/test-entry.ts` / `PanoTestApi` / `window.__panoTest` / `demo/test-entry-hooks/`，那都是 P3 切换前的写法，见到就删，不要补建。

verify 写成条件式是**自举悖论**：`vitest.config.ts` 是本卡自己产出的，合并前主分支上还没有它。条件为假时整条跳过，为真时整条跑 —— 所以 `test:integration` 在里面是安全的。

> **lint 段二次条件化（2026-09-20，Task 6 质量审查整改发现）**：`eslint.config.js` 是 Task 9 Step 1 的交付物，而 verify 的外层条件开关（`vitest.config.ts` 存在）在 Task 7 就打开——若 lint 不加自己的守卫，Task 7 落地后、Task 9 落地前的每次交卷检查闸 6 必红（eslint 9 无 flat config 硬错，实测 exit 2）。处理与 `vitest.config.ts` 同款：lint 段套 `if [ -f eslint.config.js ]`，Task 9 落地 config 后条件永真，不再有窗口期。

bootstrap 里的 `npx playwright install chromium` 不能省：默认的 chrome-headless-shell 没有 GPU 栈，`requestAdapter()` 返回 null，所有 WebGPU 测试会静默空跑 —— 两个守卫（`require-webgpu.ts` / `require-no-webgpu.ts`）就是为此而设，Task 8 Step 5 要求验证它们真的会拦人。

`.travis.yml` 在这一卡删除（Task 9 Step 4），所以它必须在 scope 里 —— scope 是改动白名单，**删除也算改动**。

> **scope 修订（2026-09-20，用户裁决 A）**：初版白名单与 plan 对不上，缺三处，已补入上方 scope：
> ①② `tsconfig.scripts.json`（Task 6 建，scripts program）与 `.gitignore`（Task 8 改，补 `.vitest` 与 `dist`）——纯漏列，用户裁决直接授权补正；
> ③ `vite.config.ts`（Task 4 建，库打包配置）——同日 vite 拍板（tsup → vite lib mode）改了 plan，清单没跟着同步，条目 `tsup.config.ts` 已随之替换。此项是执行补正时的复查发现，按同一裁决原则（清单跟定稿图纸对上）延伸处理，已单独向用户报备。
> 均属清单与定稿 plan 的对齐修正，不是执行期扩权。

> **verify/plan 修订（2026-09-20，用户裁决 B）**：「v0.2.x 全程可发版」约束废弃（经查证系 spec 阶段由 AI 写入、用户从未裁决；用户质询后拍板砍掉，发版保险 = git 历史，需要时 checkout 迁移前提交构建）。落地：plan Task 6 瘦身为「scripts 的 typecheck program」——只建 `tsconfig.scripts.json` 并顺手删 Task 2 落地的 `build:legacy` 死脚本行，不再装回 webpack/babel 旧依赖；Task 9 的 CI 两个 job（无 legacy job）；本卡 verify 已去掉 `npm run build:legacy`（即本行所在处）。scope 里的 `scripts/legacy-build.mjs` 条目自此空匹配、无害保留（gate 2 按实际改动路径核对，不会因未触碰的条目报警）。Task 1 的 `git mv` 不受影响——其理由是目录名冲突，独立成立。

> **scope 修订 III（2026-09-20，Task 9 质量审查 I-2）**：`.travis.yml` 删除后 README 首屏残留指向已关停 travis 服务的 Build Status 徽章——它是 Task 9 Step 4「删掉 travis」的残留物，清理属该步本意的收尾而非新功能，`README.md` 补入 scope。授权范围仅限删除该徽章行（standardjs 徽章不动）；是否换挂 GitHub Actions 徽章属仓库门面决策，留给用户合并后自行定夺。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
