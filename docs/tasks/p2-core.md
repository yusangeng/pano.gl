---
plan: docs/superpowers/plans/2026-09-19-p2-core.md
scope: [src/core/**, src/renderer/shaders/**, scripts/gen-shader-constants.mjs, test/**, package.json, tsconfig.json]
verify: if [ -f scripts/gen-shader-constants.mjs ]; then npm run gen:shaders -- --check; fi && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: domain
deps: [p0-freeze-baseline, p1-toolchain]
state: reported
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

**做了什么**：

4 个 Task 全部走完 SDD 闭环（实现 → spec 合规审 → 质量审含变异测试 → 整改 → 复审 → 勾选），终末全分支 review 基线 032b973（a4ae108..032b973 共 16 提交，全部 `task-p2-core:` 前缀）：

- **Task 1 投影常量唯一真源**：`projection-kinds.json` → `constants.ts`（字符串判别式，`cameraProjectionCode`/`textureProjectionCode` 唯一数值桥）→ `scripts/gen-shader-constants.mjs` → `src/renderer/shaders/generated.ts`（提交产物，`--check` 防漂移且入测试）；lint 行回补 `scripts` 并并入 demo glob（Step 9a）。
- **Task 2 类型与校验**：`types.ts`（CameraState / Projection 判别联合 / SourceState / DepthRange）+ `validate.ts`（clampLatitude / wrapLongitude / assertPositive / assertFinite）。
- **Task 3 矩阵构建与 P0 对拍**：`matrix.ts` 深度约定参数化（`perspective` vs `perspectiveZO`、`ortho` vs `orthoZO`，具名防误选）；`test/support/baseline.ts`（纯函数）+ `baseline-node.ts`（Node 读盘半）拆分；16 条 v0.2.2 uniform 流对拍 + 1 条「只差两个深度项」钉死，17/17 全绿。
- **Task 4 CPU 参考实现**：`reference.ts` 逐句转写 `legacy/shader/fshader.glsl`（含 v0.2.2 的 bug）；`reference.test.ts` 21 条（性质 + 7 行精确钉值 + 退化集守卫），16 个针对性变异全灭。

**自测结果**（交卷前当面跑的 verify 链，exit 0）：

- `gen:shaders -- --check`：up to date
- `typecheck`：三程序全过（root + test/integration + tsconfig.scripts.json）
- `lint`：exit 0
- `test:coverage`：unit 80/80 @ 8 文件；Statements 98/98、Branches 46/46、Functions 20/20、Lines 98/98 全 100%（门槛 90% 分支）
- `test:integration`：3/3 @ 2 文件（P1 浏览器模式两工程）
- `build`：exit 0
- `matrix-baseline` 17/17（终末 review 亦独立 verbose 复核过）
- 另：`src/core` 零越层 import（renderer/media/interaction/viewer）、零 `window`/`document`/`navigator` 引用（grep 当面验证，均无匹配）

**偏离 plan 的点**（全部经审查裁定，详见对应提交）：

**Task 1**：
- D1 GLSL 产物形状：plan 嵌入代码产出 `#define NAME=VALUE`，宏体是 token `=1`，任何比较处都是语法错——改 legacy 兼容的 `#define NAME VALUE`（45b1152）
- D2 生成器输入零校验：手滑改键名会静默错位、迟至 P3 编译期才炸——补标识符 / 非负安全整数校验，报错点名文件+键+规则（49b0065）
- D3 单源守卫只扫手挑单文件而注释声称覆盖 src/——扫全量 .ts + JSON，加 JSON camera 键 ↔ PROJECTION_KINDS 钉死测试（49b0065）

**Task 2**：
- D4 wrapLongitude 补 360 整数倍边界 sweep + Infinity 断言（质量审 Minor 整改，70375e7）

**Task 3**：
- D5 删除 plan 代码块中未使用的 LEGACY_WORLD_RADIUS / HALF_PI（eslint no-unused-vars）
- D6 `mat4.fromValues` 17 参 TS2554 → `mat4.set`（且不新分配）
- D7 LEGACY_QUAD_VIEW 类型改 16 元素显式元组（readonly number[] 展开 TS2556）
- D8 `legacyFovFrom`：plan 的 `2·atan(1/m[5])` 只在纬度 0 成立（m[5]=f·cos(lat)）——改为行 1 范数（元素 1/5/9），四态对拍全过。**此推导是 P3 门禁 A 的承重件**
- D9 对拍精度 7 → 6：gl-matrix Float32Array 往返噪声实测 5.96e-8，精度 7 确定性失败

**Task 4**：
- D10 pannini 齐次性：plan 的反齐次断言对 pannini 数学上不成立（两项皆比值，k>0 全向量缩放相消）——改 x=1 钉死、缩放 (y,z)，恰是 extent 经 ndcToSurface 进入的自由度
- D11 退化 NaN：忠实公式在 planet (1,0,0)（奇×奇视口中心可达）产出 atan(0/0)=NaN——加 `isDegenerate` 谓词供 sweep 跳格 + 把 NaN 钉为期望输出（归一化 = 被禁止的修复）
- D12 ndcToSurface 直测补钉（Step 5 要求；m=max(extent)/2，角点 / 内部 / 非对称 extent）
- D13 质量审补强（变异驱动，非偏离）：首轮 11/16 变异存活 → 7 行精确钉值（期望字面量三路独立推导互相咬合：实现者 scratch 转写、审查员转写、协调者手算抽验，偏差 ≤4.4e-16）+ 退化集守卫；复审残留 R4（cylindrical zoom 维度空转）→ zoom 0.5 钉值（0.5 在旧 [0.1,1] 钳制内可达；2 不可达，planet/pannini 钳制 [0.1,2] 故用 2）

**风险与移交下游**：

1. **P3 门禁 B 需对 planet 表面中心 NaN 定显式策略**（跳过 or 要求 NaN）——`reference.ts` 是判据本身
2. `test/support/baseline.ts` 的 `legacyFovFrom` 行 1 范数推导是门禁 A 承重件（见 D8）
3. 旧 GLSL 文件域 `lng` 初始化器在 GLSL ES 1.0 非法——个别驱动可能编成 0（非线性相机不转），**capture 是仲裁**
4. P4/P5 的 fov/zoom/aspect/extent 变异点必须走 assertPositive / assertFinite（core 读路径故意不校验）
5. wrapLongitude 对已 in-range 值扰动 ≤5.7e-14——下游 diff 相机状态勿用严格相等
6. Task 1 两个已接受 Minor 残留：texture 侧锁步不对称（camera 键有 PROJECTION_KINDS 钉死测试，texture 键靠单值现实）；JSON 未知节不校验
7. coverage 文本报告器 per-file 表渲染为空是报告器怪癖——per-file 数值已用 `--coverage.reporter=json` 核实（src/core 各文件全 100%），非放水
8. npm audit 2 条（brace-expansion HIGH / esbuild LOW，均 dev-only）——修复需动 package-lock.json，超出本卡白名单，交卷时报请用户裁决

## 自审记录

### CR 结论

手段：SDD 两阶段审查 × 4 任务（spec 合规审在前、质量审在后且强制变异测试：改实现 → 跑测试 → 还原，存活即发现，除非设计上不可观测），整改循环后终末全分支 review（opus）。

- Task 1：质量审 2 项（GLSL define 形状、生成器输入零校验）+ 守卫覆盖面 → 2 轮整改（45b1152 / 49b0065）复审通过；2 个 Minor 经裁定接受残留（见风险 6）
- Task 2：质量审 4 Minor → 1 轮整改（70375e7）复审通过
- Task 3：质量审 I-1（QUAD_VIEW 索引 2 符号盲区，变异存活）+ I-2（orthoZO 交换存活 + 测试标题与体不符）+ MI 残余（宽度驱动 sizing）→ 2 轮整改（f1ed95b / 8fcb18d）复审通过，变异全灭
- Task 4：spec 审 4 项偏离全部裁定有据；质量审 Critical（整套性质断言无精确钉值，11/16 变异存活）→ 整改（398e92f）复审 APPROVED + 残余 R4 回炉（5072a6b）——16/16 变异全灭
- 终末全分支 review（opus，master...HEAD 全量 16 提交）：**READY TO SUBMIT，Critical / Important / Minor 全零**。审查独立完成：四投影公式逐句 GLSL 转写审计（含文件域 lng、planet 取负、pannini 先加倍后修正、保留 tex_proj_equiprectangular 拼写）、注释中旧实现事实主张逐条核验（extents / Math.max(W/2,H/2) / near-far / v_Pos=a_Pos / zoom 钳制区间）、钉值字面量解析重推、跨任务端到端咬合（JSON → 生成器 → generated.ts → matrix/reference）、scope 白名单 20 文件全核对、plan diff 零非勾选变更确认、无调试残留
- CRITICAL / INFORMATIONAL 计数：0 / 0

### 测试质量结论

按 effective-testing 清单评估，变异测试作为断言强度的硬证据：

- **有效性**：16 个针对性变异全部被击杀（每轮整改后重注亲手验证）；曾存活的 11 个（Task 4 首轮）与 3 个（Task 3）均已在整改轮补强后死亡。判读纪律：存活 = 发现，除非可证明设计上不可观测（`+2π` 修正分支被 wrap01 折掉，u 上 2π 位移不可见——「忠实死分支」记录在案而非补测）
- **断言强度**：关键纯函数（project 系列）以精确钉值为主（`toBeCloseTo(x, 12)`，字面量三路独立推导互相咬合），性质断言（范围 / 齐次性 / 有限性）为辅；matrix 以 17 条对拍钉死 v0.2.2 行为，另有一条把「非线性只差两个深度项」的豁免收窄到恰好两个元素
- **负面路径**：validate 全负面分支（NaN / ±Inf / 极值 / 360 整数倍边界）；reference 的退化集（planet y=0∧z=0、linear/pannini x=0∧z=0）与负角 wrap 均有专测；生成器对非法 JSON 键值报错点名
- **覆盖陈述**：改动触及路径 = src/core 全部 5 文件 + 生成器 + 测试支撑，unit 80 条全覆盖（四维 100%）。无测试网路径：`src/index.ts`（P1 stub，coverage 配置排除）、`types.ts`（纯类型，无运行时分支）——理由：无可覆盖分支
- 整改轮数：Task 1 × 2、Task 2 × 1、Task 3 × 2、Task 4 × 2（另加 R4 回炉 1 轮）

## 审查意见

**结论：approve，合并。**（2026-09-21，superloop-verify 第 5 关）

**手段**：协调者直审——卡面红线静态核查 ＋ 核心文件逐个亲读（reference / matrix / constants / generated / JSON / types / validate / 生成器）＋ **verify 全链在分支树上亲跑**（不采信自报）＋ 防漂移闸双向变异亲测 ＋ 钉值第四路独立推导 ＋ P0 对拍单独复跑。

**亲验记录**：

- **verify 全链 EXIT=0**：`gen:shaders -- --check`（up to date）→ typecheck 三条腿 → lint → coverage（80/80，四维全 100%：98/98、46/46、20/20、98/98）→ test:integration 3/3 → build 绿。与自报逐项一致。
- **reference.ts 逐句对读 legacy/shader/fshader.glsl**：四投影公式、象限修正（linear 的 x<0 / planet 的 Q>0∧P<0）、planet 的 z 取负、pannini 的先加倍后修正、`theta/TWO_PI` 无 +0.5——全部忠实转写。**度减弧度 bug 原样保留未修**（`lngOffset = povLongitude/4`，含 8π≈25.13 度/圈与 `% 25` wrap 吻合的注释推导）；`u_CamPOVLatitude` 死 uniform 同样保留不读。atan 不化简为 atan2 的理由成立（pannini 加倍次序致象限差异）。
- **单一真源链亲验**：JSON → constants.ts（零数值字面量，`cameraProjectionCode` 唯一数值桥）→ generated.ts（WGSL/GLSL 值与 JSON 及 legacy `#define` 一致；GLSL 为 D1 修正后的空格分隔 `#define NAME VALUE`）。
- **防漂移闸双向变异亲测**：手改 generated.ts → `--check` 报 stale 且 **exit 1**；改 JSON 不重生成 → 同样 exit 1；还原后 exit 0。（首轮管道吃掉退出码，已用无管道重测钉死。）
- **钉值第四路独立推导**：从 GLSL 文本另起 scratch 转写，linear(-1,0.3,0.7) 双分量逐位一致；planet、cylindrical 的 u 在正确取模 wrap 下一致——我 scratch 的朴素 +1 wrap 所产生的差值恰好反证钉值编码的是真 REPEAT-wrap 语义，v 分量逐位一致。三路推导声明属实。
- **P0 对拍单独复跑**：matrix-baseline 17/17（含「非线性只差两个深度项」收窄到恰好两元素的那条）。
- **红线静态核查**：src/core 零越层 import（renderer/media/interaction/viewer 均无）、零 `window/document/navigator/setTimeout/rAF` 引用、**无 index.ts barrel**、TS 侧无投影 kind 数值字面量比较、`test/fixtures/baseline/` 与 `tools/` 未触碰。
- **门禁证据**：20 个改动文件全在 scope 白名单（package.json/tsconfig.json 属两次已裁决的清单对齐修订，实际 diff 各仅一处/两处，与修订声明严格吻合）；19/19 commit 前缀合规；分支侧 plan 37/37 全勾且 diff 仅勾选变更；执行期 master 侧仅一笔协调侧 scope 修订·二（a4ae108，卡面透明登记 + 用户裁决选项 a，与 P1 同型认定）。

**留档（非阻断）**：

1. **npm audit 2 条**（brace-expansion HIGH / esbuild LOW，均 dev-only）：修复需动 package-lock.json，在 P2 白名单外——执行者不越权修是正确的。交用户裁决：建议单独 chore（`npm audit fix`）或并入 P3 卡，不阻断本卡。
2. 下游移交风险 8 条（P3 门禁 B 的 planet NaN 策略、D8 legacyFovFrom 承重声明、GLSL 文件域 lng 初始化器的驱动差异等）均在卡面登记，属正常移交。
3. Task 1 两个已裁定 Minor 残留（texture 侧锁步不对称、JSON 未知节不校验）维持执行者自审裁定，理由成立。
