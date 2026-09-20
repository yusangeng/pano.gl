---
plan: docs/superpowers/plans/2026-09-19-p3-renderer-webgpu.md
scope: [src/renderer/**, src/core/reference.ts, test/unit/**, test/integration/**, vitest.config.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: foundation
deps: [p2-core]
state: doing
createdAt: 2026-09-19T08:51:52.509Z
---
# 任务：P3 — renderer + WebGPU

开工先读 plan 头部，以及 File Structure 上方那段「本期不再产出任何桥接层」。

**本卡最重要的一条：没有页面侧出口。** `index.html` / `demo/test-entry.ts` / `demo/test-entry-hooks/*` / `PanoTestApi` / `window.__panoTest` / `demo/tsconfig.json` —— **一个都不建**。集成测试改用 vitest 浏览器模式后，测试文件本身就在页面里，直接 `import src/` 的内部模块即可。上一版把这套桥接建在了这一卡，那一版已经作废。**如果你正在写一个 hook 文件，那是走错路了。**

本卡是门禁 A / 门禁 B / `uniform-layout` 三条集成测试的落点，全部跑在 `integration` project 里（真适配器由 `require-webgpu.ts` 守卫保证）。**容差必须在真 GPU 和 SwiftShader 上都成立**：本地是真 GPU，CI 走 `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`；`CI=1 npm run test:integration` 可以在本地复现 CI 的那一半。某条门禁只在一边绿 = 容差定错了，不是环境问题。

Task 8 Step 3 会给三个非线性投影的 `phi` 加 `- lat`，并同步改 `src/core/reference.ts`。**P6 转写的是这一步之后的最终形态**，转写中间版本会漏掉纬度，门禁 C 在非零纬度上立刻红。

本卡创建 `test/integration/support/baseline-browser.ts`（P6 门禁 C 要复用），并在 `src/core/reference.ts` 上留下本卡的改动 —— 那是 P2 的文件，但改它的理由来自本卡。

verify 用的是 `npm run test:coverage` 而不是 `test:unit`：项目的规则是**分支覆盖 ≥90% 是构建失败而不是目标**，而 `test:unit` 不带覆盖率，会静默放过它。`vitest.config.ts` 因此在本卡 scope 里 —— 如果 `src/renderer/webgpu/backend.ts` / `device.ts` 这类要真 device 的代码把门槛拉下去了，**首选是补单元测试（桩一个 device）**，确实测不到才加 exclude，并在那一条旁边写清为什么测不到。**不要删 `thresholds`。**

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
