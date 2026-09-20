---
plan: docs/superpowers/plans/2026-09-19-p2-core.md
scope: [src/core/**, src/renderer/shaders/**, scripts/gen-shader-constants.mjs, test/**, package.json, tsconfig.json]
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

> **scope 修订（2026-09-20，协调侧补正）**：P1 质量审查发现 eslint 9 对未匹配的显式 pattern 硬错——P1 期间 `scripts/` 目录尚不存在，lint 行被临时改为 `eslint src test`，回补步骤（plan Task 1 Step 9a：lint 行加回 `scripts` 参数）落在 P2。`package.json` 因此补进 scope，属清单与 plan 步骤的对齐修正，不是执行期扩权。

> **scope 修订（2026-09-20，协调侧补正·二，用户裁决选项 a）**：plan Task 1 Step 4 明文要求根 `tsconfig.json` 开 `"resolveJsonModule": true`（`constants.ts` 要 import `projection-kinds.json`）；且 plan 自带的测试代码读盘/起子进程（`constants.test.ts` 的 `node:child_process`、`baseline-node.ts` / `matrix-baseline.test.ts` 的 `node:fs` + `__dirname`）在当前 `types: ["@webgpu/types"]` 下编译不过——探针实证同时报 TS2307（`node:fs` 模块解析失败）与 TS2304（`__dirname` 未声明），需 `types` 数组补 `"node"`。`tsconfig.json` 因此进 scope，属清单与 plan 的对齐修正，不是执行期扩权；改动限上述两处。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
