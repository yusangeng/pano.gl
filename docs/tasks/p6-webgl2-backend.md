---
plan: docs/superpowers/plans/2026-09-19-p6-webgl2-backend.md
scope: [src/renderer/**, src/viewer/backend-factory.ts, vitest.config.ts, test/**]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: foundation
deps: [p5-viewer, camera-freeze-fix]
state: open
createdAt: 2026-09-19T08:51:52.902Z
---
# 任务：P6 — WebGL2 backend 与门禁 C

开工先读 plan 头部，逐条核对「前置依赖（开工前确认）」那张表 —— 每一条都是别人产出的东西，**缺一条就在这里停下，不要在本计划里绕过去**。

**`demo/` 不在 scope 里，这是故意的。** scope 是改动白名单，闸2 会拿 `git diff --name-only` 逐条核对；`demo/` 不在白名单里，所以「`demo/` 一个字节都没改」这条完成标准是**被机械保证的**，不是靠自觉。同理不要建任何 hook 文件或页面侧出口。

**转写的是 P3 Task 8 Step 3 之后的最终 WGSL**（三个非线性投影的 `phi` 带了 `- lat`），不是 Task 3 的中间版本 —— 转错版本门禁 C 在非零纬度上立刻红。`src/core/reference.ts` 是门禁 C 的裁判，它必须和着色器读到同一个 `povLatitude`。

本卡要改 `vitest.config.ts`（`no-webgpu` project 的 include）与 `test/integration/support/spies.ts`：**`countDraws` 必须同时包住 `WebGPUBackend.prototype.render` 和 `WebGL2Backend.prototype.render`，共用一个闭包计数器** —— 只包一个的话，`no-webgpu` 下 `frames === 0` 会**空过**。

verify 里的 `npm run build` 不是走过场：着色器走 `?raw` 导入，vitest 和 demo 吃 Vite 的 `?raw`，**tsup 走 esbuild 没有这个约定**。缺 loader 会让 `test:unit` 全绿而 `build` 失败。

verify 用的是 `npm run test:coverage` 而不是 `test:unit`：**分支覆盖 ≥90% 是构建失败而不是目标**，`test:unit` 不带覆盖率会静默放过它。`webgl2/context.ts` / `backend.ts` 要真 GL 上下文，如果拉低了门槛，**首选补单元测试**，确实测不到才加 exclude 并写明理由 —— **不要删 `thresholds`**。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
