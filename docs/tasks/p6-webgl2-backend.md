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

P6 全部六个 Task 完成，终末全分支审查 APPROVED（2026-09-23）。分支 15 提交（6346f27 → e194b26，merge-base f73e2a9），HEAD 树 pristine。

**做了什么**：

1. **Task 1** — GLSL ES 3.00 转写四个投影公式（`src/renderer/webgl2/shaders/panorama.glsl` + `index.ts`），常量走生成器，11 条结构/一致性单元测试。
2. **Task 2** — `src/renderer/webgl2/context.ts`：取上下文、编译/链接失败大声抛（带逐行注释的驱动日志）、`acquireContext` 配置（`preserveDrawingBuffer: true` 等），13 条单元测试。
3. **Task 3** — `WebGL2Backend`（具名 uniform、不共享 UBO 布局；上下文丢失 preventDefault + 上报 + 恢复重建；dispose 释放上下文）+ `backend-factory.ts` WebGL2 分支与 `probe()` 无适配器分支读 `MAX_TEXTURE_SIZE`，4 条冒烟测试。
4. **Task 4** — 门禁 C：`support/cross-backend.ts`（周期源图、GLSL 离屏渲染、float64 CPU 裁判）+ 18 条测试（16 状态矩阵 + 裁判 + 极点），容差 ≤2/≤3/<64 未放宽。
5. **Task 5** — 四个 P5 用户故事文件零分叉重跑于 `no-webgpu` project（include 白名单 + DPR parity），`countDraws`/`captureRenderInputs` 扩双原型纯 spy，US5 翻正面断言 + probe-vs-constructed 相等钉。
6. **Task 6** — 三种降级环境：`backend-downgrade`（真适配器上 delete + import 时捕获原 descriptor 恢复）、no-webgpu project 本身（真启动参数）、`backend-unavailable`（叠加 webgl2 掩码，create() 抛 + 不留 canvas）。

**自测结果**（终审独立复跑与协调者亲跑三方一致）：integration 130/130（21 files，真 WebGPU）、no-webgpu 36/36（7 files，--disable-gpu SwiftShader）、unit 300/300（22 files）、typecheck 双 program 干净、lint 干净、`npm run build` 成功且 dist 中 `#version 300 es` 可 grep（ESM + CJS 两处）。覆盖率门禁（unit project 90% 四维）在 verify 的 `test:coverage` 里当面跑绿。

**偏离 plan 的点**（全部协调者裁定后落进 plan fence 同步，终审 D 节核对无表外偏离）：

- Task 1：`?raw` 环境类型镜像声明；GLSL 双参 atan 断言骨架化；WGSL symmetry 断言追认。
- Task 3：plan 冒烟测试两处 bug 按裁定修复（持有 `WEBGL_lose_context` 引用；首绘与 `before` 读移到合成丢失之前）；`probe()` 无适配器分支行为变更（FIX 2）。
- Task 4：plan 的 STATES fov 度数改弧度（5 处，P2 `Projection.fov` 文档为弧度）；四个 harness bug 修复（GL wrap REPEAT、裁判采样 1−v、REPEAT 双线性模型、裁判用例换 cylindrical@state1——裁判按构造无法建模非零姿态 linear）；整改轮 `WEBGL_lose_context` 释放离屏上下文。
- Task 5：故事经 `captureRenderInputs` 到后端（plan 原文猜错 spy）；no-webgpu provider 补 `deviceScaleFactor: 2`（photo 硬断言 DPR 2）；photo 后端标签改为按浏览器实际状态推导；US5 `create()` 需带 `src`（plan fence 缺）；`SelectedCapabilities` 'none' 收窄。
- Task 6：两处 `create({ container })` fence 缺 `src`（validateImageOptions 先于后端选择）；Step 3 计数勘误 8 = 3 + 5；质量审 CRITICAL-1 整改——afterEach 伪恢复（`defineProperty({get:()=>undefined})` 是降级不是恢复）改为 import 时捕获原 descriptor 恢复，突变证明整改后掩码行重新 load-bearing（M1 红 `expected 'webgpu' to be 'webgl2'`）。
- 交卷闸暴露（task-finish 闸6 首跑，终审之后）：`src/renderer/webgl2/backend.ts` 不在 coverage exclude，`test:coverage` 四维全崩（81.22/84.01/86.36/81.97）——P6 各轮验证跑的都是套件而非 coverage，该缺口自 Task 3 起潜伏。按任务卡纪律（首选补单测，确实测不到才 exclude 并写明理由）处置：该类为 DOM+真 GL 绑定（取上下文/编译 GLSL/发 GL 调用），node project 一条路径不可达，假 GL mock 即作者假设回放；其委托的编译/链接协议在 `context.ts` 已单测（96.87%，留在 coverage 内）；本体由 integration project 盖（smoke 4 条 + gate C + 降级测试，不报覆盖率）。补 exclude（`viewer.ts`/`backend-factory.ts`/两个 viewer 类同构先例，注释附前后实测数据），复跑 99.4/98.68/98.95/99.78 全过。

**风险/遗留**（终审裁 ACCEPT-AS-RECORDED，均可搭 P7 cleanup，不阻塞）：

- NPOT+REPEAT 无直接测试覆盖（INFO 11b）：WebGL2 规范保证，现有 fixture 全 POT，video 故事走 NPOT+CLAMP。未来一张 NPOT still fixture 可廉价关闭。
- 三处 cosmetic 注释措辞（qual-task4 iii/iv 的 gate-c 头注与 GATE_C_SIZE 注释、INFO 8 的 WebGL2 render() 空行为未注）。
- buildProgram 双泄漏路径（INFO 6/7）仅在静态包 bug 时可达，随 canvas GC 释放。

## 自审记录

按 superloop 六关流水线，第 1、2 关（代码审查、测试质量）通过 SDD 双审体系执行：每 Task 派 fresh 实现者 → 协调者对提交对象机械验证 → fresh spec 审 → fresh 质量审（opus，允许突变）→ 整改循环到 APPROVED；六任务全齐后终末全分支审查（fresh，opus，19 文件一次审）APPROVED。

### CR 结论

**手段**：每 Task 两段式审（spec 符合性审 + 代码质量审，均为 fresh agent、质量审用 opus、明确授权突变验证）；协调者对每条发现先在源里核实再裁决（对提交对象 `git show`，不读飞行中的工作树）；终末全分支审查覆盖 `f73e2a9...e194b26` 全部 15 提交（A 亲跑套件、B 完成标准 13 项带证据、C INFO 台账逐条裁决、D 偏离全表核对、E fence 结构、F 提交卫生、G 突变证明）。

**各级发现数与整改**：

- Task 1 / Task 2：spec PASS + 质量 APPROVED，一轮，0 发现。
- Task 3：质量审 5 MINOR（丢失窗 setSource 守卫、probe 行为变更、断言时序、事件等待、注释引用），全 FIX 落地，round 2 APPROVED（审者独立复现「杀不死突变」并自建探针佐证）。
- Task 4：质量审 3 MINOR（两条注释与实测不符、离屏上下文未释放——正是缺陷 L5 模式），全 FIX 落地（ec954a9），round 2 全文件 plan↔landed diff 为空。
- Task 5：质量审 3 MINOR（countDraws JSDoc 虚假理由、stub 化退化、vitest 注释过时预言）+ 4 INFO，MINOR 全 FIX（stub 改回纯 call-through），round 2 APPROVED。
- Task 6：质量审 1 CRITICAL（afterEach 伪恢复毒化页面使套件突变不死）+ 2 MINOR（注释与机制相悖、掩码理由虚构）+ 3 INFO。CRITICAL 整改（e194b26）：模块顶层捕获原 descriptor + afterEach 恢复原 descriptor；协调者与审者各自独立跑突变（两个来源，非一个来源看两遍）：M1 删 render 测试自身掩码行 → 红 `expected 'webgpu' to be 'webgl2'`（修复前该突变绿）；M1b 崩溃消失改死于干净断言；M3 落在划定的最低线内（三测试各自带掩码自给自足，恢复是纵深防御）。round 2 APPROVED。
- 终末审查：0 新发现；全部 INFO 项裁 ACCEPT-AS-RECORDED；deviation ledger 无表外偏离；突变（删 GLSL v-flip）→ gate C 18/18 红，字节恢复（sha256 一致）→ 复绿。

**轮数**：Task 1/2 一轮；Task 3/4/5/6 各两轮（round 1 CHANGES REQUESTED → 整改 → round 2 APPROVED）；终审一轮 APPROVED。CRITICAL 清零、其余各级发现清零或裁定在案。

### 测试质量结论

**评估手段**：质量审与终审均以突变验证测试杀伤力——测试只有在实现有 bug 时会红才算有效：门禁 C 删任一侧 `project_cylindrical` 的 `- lat` → 恰 5 红/13 绿且裁判点名错的一侧；删 GLSL `to_uv` 的 v-flip → 18/18 红；Task 6 三突变如上；Task 5 质量审突变 A–D 证明 photo 推导断言、probe 相等钉、captureRenderInputs 扩容各自 load-bearing（countDraws 扩容当前无调用者，JSDoc 如实记为 prophylaxis）。

**整改**：countDraws stub 化退化为纯 call-through（stub 会把保证全黑的画布递给「数完帧再读像素」的测试）；Task 6 伪恢复整改（上详）；US5 相等断言钉死 probe 与构造后端一致（防 probe 低报导致应用过度预降采样）。

**覆盖陈述**（改动触及的路径，哪些有测试网、哪些没有、为什么）：

- 有网：四个投影公式（gate C 16 状态 + 极点 + 裁判，双后端逐像素 + float64 第三方意见）；编译/链接错误协议（unit 13 条，含 (no log) 与 null 分配）；后端生命周期（smoke：渲染双颜色、编译失败抛、20 连创建销毁、丢失→上报→恢复→重画）；三种降级环境（premise 测试先证明环境真的有/没有可拿掉的东西）；用户故事双 project 同文本重跑（130 + 36）；probe 一致性（unit stub + US5 端到端相等钉）。
- 没有网（显式记录 + 理由）：NPOT+REPEAT 直接覆盖（WebGL2 规范保证、fixture 全 POT、video 走 CLAMP——见完成报告风险节）；buildProgram fragment 编译抛时的 vertex shader 泄漏与 create() 抛时的 context 槽泄漏（静态源，仅包 bug 可达，随 canvas GC）；render() after-dispose（viewer.dispose() 先停循环后释放后端，生产顺序下不可达）；WebGL2 render() 空源清屏 vs WebGPU 保留末帧的不对称（公共 API 可达窗口内两者复合出同一「无画面」，契约只要求 draw nothing——终审 C 项已溯源）。
- 分支覆盖率：unit project ≥90% 四维门禁为构建失败级（verify 用 `test:coverage` 当面跑），exclusions 逐文件附实测数据与理由（vitest.config.ts 注释）。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
