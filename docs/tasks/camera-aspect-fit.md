---
plan: docs/superpowers/plans/2026-10-07-camera-aspect-fit.md
scope: [src/core/**, src/renderer/**, src/interaction/**, src/viewer/**, demo/shots/**, README.md, CLAUDE.md, test/**, vitest.config.ts]
verify: npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
layer: domain
state: reported
createdAt: 2026-10-07T06:36:45.420Z
---
# 任务：非线性相机容器宽高比自适应（aspect fit）



## 完成报告

按 plan（docs/superpowers/plans/2026-10-07-camera-aspect-fit.md）12 个 Task 全部完成，54/54 checkbox 已勾；链上 16 个提交（T1–T12、各审查 fix、终末 finalfix 499f3c8），本报告提交为收尾。

**做了什么**

- `src/core/extent.ts` 新增 `resolveExtent(projection, aspect)`：容器适配纵向 extent 的唯一推导源（cylindrical 速率 2π，其余 1）；`fit: 'extent'` 字面取 tuple（I6：平方 tuple 与旧 `max/2` 逐位一致——gate A 基线因此未重拍）。
- `Projection` 四个非线性成员加 `fit?`（runtime-lenient）；正交盒改逐轴矩形，aspect 级联 `viewer #drawFrame → Backend.setCamera(state, projection, aspect) → buildCameraTransform → buildProjection → resolveExtent`。两 shader、常量管线、uniform 布局、linear 链路零触碰（零触碰审计为空）。
- `ndcToSurface` 逐轴半 extent；reference.ts 模块头记第四条裁决偏离（2026-10-07，与 lngOffset 同类：继承性框架缺陷经用户裁决修正，旧行为经 `fit:'extent'`+平方 tuple 逐位可达）。
- I2 屏幕中心等距性质测试（绕过 resolveExtent、手写速率常数，独立第二意见）；mercator 拖拽米数按 resolved extent_y；gate B 三容器形状对 float64 reference；gate C 矩形视口三方言一致 + pannini 加入仲裁腿（四要求协议落注释）；用户故事 `aspect-fit.test.ts` 双项目跑（integration 真 GPU + no-webgpu 白名单）。
- README 相机表/框架说明/经验法则、CLAUDE.md 三条偏离改四条；五张 gallery 截图按容器适配默认框架重拍（800×450、每张 0 page errors）。

**自测结果**

- 全链绿（T12 记录，task-finish 闸6 当面重跑）：gen:shaders 幂等（树干净）、build OK、npm test（unit 24 文件/366 测试；integration+no-webgpu 37 文件/235 过 +1 跳过）、typecheck 三程序 0 错误、lint 干净、覆盖率 **98.49% branch**（语句 99.64%、函数/行 100%；门槛 90%）。
- 零触碰审计为空：`generated.ts` / `panorama.wgsl` / `panorama.glsl` / `projection-kinds.json` / `src/index.ts` 无 diff。
- spec §8 锚点表 17 行全覆盖；超出锚点的 9 个 diff 文件均在 plan 任务清单内（零 scope creep）；I1–I6 六不变量各有 pin（映射记录在 T12）。
- 终末 finalfix（499f3c8，纯注释/文档，`git show` 逐处核验）后复验：unit reference.test.ts 51 过、typecheck 0 错、lint 干净、README options 校验同步。

**偏离 plan 的点**（均经现场裁决或审查闭环，按类）

实现/文本类：
- T5：fround 精度 clamp 写法、mock 参数顺序、plan Step-2 红预测 3≠2（以实测为准）；F3 viewer.ts:76 分类补注。
- T6：impl D1–D4（gateRequest 线程化等）；spec-t6 通报性意见 + 简报 −64/−32 笔误。
- T7：kill-claim 被 mutation drill 证伪 → 测试注释诚实修正（plan 文本未回改）；diagnose 读 shape.width；TSDoc 措辞。
- T8：measured-values 注释落位、`.soft` 探针移除；spec-t8 仅格式换行。
- T9：swap 腿超出 plan 字面（裁决采纳旧台账 rec，与 cfb6e46 配对，kill scope 有 drill 记录）；NonLinearProjection 类型收敛；sampleWorst 抽取；v-flip 未触发（plan 预留的首跑两种结果之一）；临时量测日志已移除。
- T10：句号改分号衔接（编辑判断）；表格 `fit` 标注默认值 `('container')`。
- T11：nohup+PID+lsof 替代 `kill %1`（shell 语义）；commit 消息按卡规则加 task 前缀（plan 原文缺前缀）；mercator.png 905,247B 超出 plan 的 700–900KB 带约 5KB（已披露）；视觉抽检走 vision-model 合成图而非 /browse（路线已记录）；`.vibe/shoot-gallery.mjs` 不提交（gitignored，与 plan 机械 diff 一致）。
- T12：plan 写 "No commit (verification only)"，但闸5 要求 checkbox 全勾且 task-finish 需 push 分支 → 勾选以 chore 提交（df5c90f）。
- posed-square pannini 探针未采纳：与 sibling 卡 lat-zoom-reference-pin 的仲裁腿撞车，留待该卡落地。

审查整改提交：T8fix `dca40a0`、T9fix `dbb00cf`、T10fix `bf28c5d`、finalfix `499f3c8`（终审 2 Minor + efftest 3 项，纯注释/文档）。

**风险 / 待协调者裁决的记录项**

1. `compareWithReference` 不返回最差样本位置（efftest Minor 1 = 终审 deferred rec (b)）：纯诊断增强、无 wrong-green——仲裁腿失败时同形 A/B 腿的 GateCDiff 诊断已给最差像素位置；改返回型触及全部仲裁调用方。终审裁决 defer，按契约记录待裁决。风险自评：低（诊断便利性缺失，不涉正确性）。
2. 其余 deferred recs：(a) Shape 类型/GATE_C_SHAPE 抽取（等第三个矩形消费者）、(d) gate C 三路渲染 helper（纯去重）、(e) CLAUDE.md 列表化重构（触发条件：第五条偏离）、(f) spies.ts lastCamera aspect 扩展（hand-off 已被像素钉住，YAGNI）；(c) gate B it-per-cell 终审裁决 reject-as-adjudicated（T7 已选自定位标签）。
3. spec-t11 探针观察（非失败）：demo 截图边缘 motif 轻度"宽而不高"（与被修缺陷反向）、一处未归因条纹带；像素准确性归 gate 管辖（绿）。
4. T11 质量审查折叠为控制器核验（binary-only diff 无文本可审）+ spec-t11 合规审查 + 独立视觉抽检。
5. sibling 依赖：lat-zoom-reference-pin 的 pin 落在本卡合并后的 reference.test.ts / gate-c 状态之上（其 plan 已声明 deps）。

## 自审记录

本节记录第 1、2 关结论；无法清零项逐条给出内容/原因/风险自评（见完成报告"风险"节），交协调者复审裁决。

### CR 结论

手段：SDD 每 Task 派新鲜 subagent 双阶段审查（先 spec 合规、后代码质量，fix 后复审）+ 终末全分支审查（独立 reviewer，六维度：单一权威链、仲裁独立性、数值诚实、wrong-green 抗性、spec §8 锚点覆盖、接缝/残留）+ effective-testing kill-power 评估（见下节）；控制器对每个 fix commit 逐个 `git show` 核验后方才关单。

各级发现与整改（Critical 全程为 0）：
- T1–T4：spec+质量双审一轮通过，无 Important 发现。
- T5 质量：3 Minor + TSDoc @param → 当轮折叠。
- T6 质量：1 Important + 3 Minor → 折叠；rec 1 转为 T9 的 resize twin 测试落地。
- T7：spec 阶段 kill-claim 被 drill 证伪 → 诚实修正后复审通过；质量 Minors 1/3/4 折叠、Minor 2（it-per-cell）defer。
- T8 质量：1 Important + 2 Minor → fix `dca40a0`，复审通过。
- T9 质量：2 Important + 4 Minor → fix `dbb00cf`，复审通过。
- T10 质量：3 Minor → fix `bf28c5d`，复审通过。
- T11：spec 合规通过；质量审查折叠为控制器核验（binary-only diff）+ 独立视觉抽检（cylindrical 地平线带约半高无拖影、mercator 极区行在帧内可读）。
- 终末 final-review：**SHIP**。2 Minor（README "pre-1.0" 版本跨距失实——方框行为实际延续至 v1.1.0；reference.test 两处裸 tuple 传入契约已改为 resolved extent 的 ndcToSurface、巧合有效但未标注）→ `499f3c8` 修复并核验。数值断言被独立复算：拖拽字面量/extent/正交尺度/texel delta 全对（~46 实测 47.1，属"~"级诚实，结论不变）。
- 六项 deferred recs 终审裁决：(a)(b)(d)(e)(f) defer、(c) reject-as-adjudicated——逐条记录于完成报告风险节。

轮数：每 Task 1–2 轮；终末 1 轮 + 1 个 fix 提交。Important 全部整改闭环；Minor 除记录项外全部整改。

### 测试质量结论

effective-testing 评估（独立 reviewer，mutation-drill 语义）：**kill-power CLEAN**——所有声称的 kill 均有具名失败测试背书。发现 2 Minor + 2 Rec（全为注释/诊断打磨级）→ 3 项整改进 `499f3c8`（故事注释两处过头声明改诚实、镜像 kill-scope 记录上墙、WebGL2 覆盖盲区在 cross-backend.ts 可见化），1 项（worst-sample 诊断 = deferred rec (b)）按终审裁决 defer 并记录。

覆盖陈述（改动触及路径的测试网）：

> Every path this card touched has a test net: resolveExtent is pinned per kind, per fit mode, and on its throws by independently derived literals (extent.test.ts) plus the equidistance property that bypasses it by design; the aspect plumbing is covered at each hop — controller store/dirty/swap semantics in unit, viewer→backend→matrix end-to-end by the story's resize and camera-swap legs (stale-aspect drill ~215 vs 24) and by gate B's three container shapes against the float64 reference at tolerance 2; ndcToSurface's per-axis scaling by both orderings of asymmetric extents; mercator drag metres by unit literals and by re-derived end-to-end poses at extent_y 0.5 including a mid-life-resize leg that kills a cached-extent mutant; gate A keeps the v0.2.2 pixels through the fit:'extent' pin with matrix-baseline parity at unit level; and the story runs in both the WebGPU and no-webgpu projects — the latter being the only pixel-level net for WebGL2Backend.setCamera's aspect forwarding, which the gate C webgl2 legs bypass by building the matrix themselves. Both browser projects run at deviceScaleFactor 2, so the story executes at dpr 2 with the readback-grid cancellation it documents. Deliberately without dedicated legs, each justified: linear-at-rectangular is that record's own contract (out of card scope, maintained by the pre-existing setAspect rewrite); a manual non-square fit:'extent' tuple at pixel level composes the same rectangular-box path gate B/C already exercise at 16:9 and 9:16, with the tuple-literal mode matrix-pinned in both orderings; video shares the Viewer core the photo story covers; and mount-time aspect delivery shares the ResizeObserver path the reshape legs exercise. No untested path remains that the gates do not already carry.

覆盖率：branch **98.49%**（门槛 90%，构建强制）；语句 99.64%、函数/行 100%。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
