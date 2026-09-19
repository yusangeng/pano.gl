---
plan: docs/superpowers/plans/2026-09-19-p2-core.md
scope: [src/core/**, src/renderer/shaders/**, scripts/gen-shader-constants.mjs, test/**]
verify: if [ -f scripts/gen-shader-constants.mjs ]; then npm run gen:shaders -- --check; fi && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: domain
deps: [p0-freeze-baseline, p1-toolchain]
state: open
createdAt: 2026-09-19T08:51:52.366Z
---
# 任务：P2 — core 纯逻辑

开工先读 plan 头部。本卡是纯逻辑层：投影数学、CPU 参考实现、着色器常量的单一真源（`src/core/projection-kinds.json` -> `scripts/gen-shader-constants.mjs` -> `src/renderer/shaders/generated.ts`）。它不碰 GPU。

verify 里 `gen:shaders` 那条写成条件式是**自举悖论**：`scripts/gen-shader-constants.mjs` 是本卡自己产出的。注意 `gen:shaders` 这个 script **名字** P1 的 `package.json` 里已经有了，但**那个脚本文件**没有 —— 所以光看 `npm run` 能不能解析出来判断不了，必须按文件存在与否来守。

**`generated.ts` 永远不要手改**：改 `projection-kinds.json` 再跑 `npm run gen:shaders`。`--check` 就是防漂移闸 —— 改了 JSON 没重新生成、或者手改了 `generated.ts`，都会红。这个不变式从 P3 起每一卡的 verify 里都在。

**不要建 `src/core/index.ts` barrel。** P5 的前置依赖第 3 条点名禁止：barrel 会让「谁依赖谁」变得看不出来，而依赖方向是这套设计最在意的东西。

`test/support/baseline.ts` 是纯函数（浏览器和 node 都能用），`baseline-node.ts` 才是读盘的那一半（`node:fs` / `path`）。P3 会另建 `test/integration/support/baseline-browser.ts` 走 `?url` + `fetch` + `createImageBitmap`，三份分工不要混。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
