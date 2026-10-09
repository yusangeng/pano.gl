---
plan: docs/superpowers/plans/2026-10-07-lat-zoom-reference-pin.md
scope: [test/**]
verify: npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
layer: domain
deps: [camera-aspect-fit]
state: merged
createdAt: 2026-10-07T06:36:50.427Z
---
# 任务：lat≠0×zoom≠1 reference pins（zoom-1 盲区闭环）



## 完成报告

做了什么（纯测试改动，无生产代码）：

- T1（9420aab）：`test/unit/reference.test.ts` 新增 describe「exact output pins at lat 30 x zoom 0.5 (zoom-1-invisible gap)」——四个非线性相机在曲面点 (1, 0.2, 0.3)、pose lat 30 / lng 0、zoom 0.5 的 float64 精确 pin（`toBeCloseTo` 12 位，u/v 双字段逐行）。字面量独立推导：`.vibe` scratch WGSL 转写（非 `src/core/reference.ts`，防 echo-chamber）+ 每行手工复推记录在注释。PINS 而非 TDD：预期首跑即绿，红了即发现。
- T2（a595938）：`test/integration/gate-c-cross-backend.test.ts` 新增仲裁 leg「arbitrates the lat!=0 x zoom!=1 corner for all four non-linear cameras」——lat 30 / lng 45 / zoom 0.5，两后端各自对 CPU reference，公差 planet ≤4、其余 ≤3（四要件协议；pannini 按 measure-first 协议先实测后定）。
- CR 整改（515ba16）：①pannini 公差注释的出处措辞改为 aspect-fit leg + gate B 三形状 leg（gate C 文件内本无方形 pannini 仲裁 leg，原「square legs」说法无机制可循）；②planet 行完整推导写进测试注释（复数形式 w'=(ct·w−i·st)/(−i·st·w+ct) 与分量展开，两种形式 node 双验 16 位一致，few-ulp 恢复路径对 planet 也可执行）；③`NON_LINEAR_KINDS` 常量上提，aspect-fit 与新 leg 共用（新增 kind 不会一条 leg 漏拾）；④fresh probe（2026-10-08）实测 webgpu=1 / webgl2=1（四 kind 全 1）贴进 measured 行。

自测结果（整改后完整 verify 链，2026-10-08）：gen:shaders 幂等（树无变化）；build index.js 136.19 kB / gzip 37.58 kB、index.cjs 136.42 kB / gzip 37.64 kB；unit 24 文件 / 370 passed；integration+no-webgpu 39 文件 / 252 passed + 1 skipped（gate-c 单独复跑 41/41，真实 GPU）；typecheck 三程序 0 错 + README 选项表同步；lint 清洁；coverage branches 98.49%（262/266，门槛 90%）、statements 99.64%、functions 100%、lines 100%。

偏离 plan 的点：

1. T2 复用文件既有 `projectionFor`/`extentFor` helper 而非 plan 块内的内联 EXTENT 表（plan 授权 adapt 既有 helper）。
2. pannini 公差注释按实测重写（plan 的 measure-first 协议触发；实测 1/1 → 维持 ≤3 并记录 measured 对）。
3. commit 消息带 `task-lat-zoom-reference-pin:` 前缀（superloop 纪律，plan 模板未含前缀）。
4. 浏览器模式探针经「不可能断言」取值（browser mode 不转发 console.log，Task-2 先例；探针文件已删、还原已核验）。
5. CR 整改 515ba16 修订了 plan 转写的注释（pannini 出处、planet 推导、NON_LINEAR_KINDS）——plan 原文未回改。
6. T3 diff 审计按「2 个代码文件 + 任务卡」读法；plan 写 exactly two files（卡上勾选框已勾，不回写 plan——事后改 plan 属 force-green 反模式，rotate 卡先例）。

遗留风险（均记录不改，待协调者裁决）：

- F4 单角判别：只钉 lat 30 × zoom 0.5 一点，恰好在该点抵消的共享错误不可见。adv-claude 裁读「手工转写错误没有这种形状」；如需闭环可另立加密格点的后续卡。
- F3 plan 字面出入：plan 写「exactly two files」，现实为 2 测试文件 + 卡；记录于上节第 6 条，不改 plan。
- F5 scratch 转写的 zz<0 符号等价性说明留在 `.vibe` 内部脚本注释，未入测试注释（避免噪声）。
- F6 a595938 的 commit 消息沿用 plan 模板文案，其中 pannini "joins arbitration" 的表述以 515ba16 的修正叙述为准。
- F1 残余：若 pin 字面量与 reference 同源同错（两处一起错），pin 无法发现——仓库级仲裁极限（与 gate A/baseline 同界），已知并接受。
- SDD Minor #1：reference.test.ts:1041 「second opinion」措辞在文件整体语境下可读为 pin 独拦 shaders-only 位点（实为 gate leg 拦）；SDD 终审裁定无需改，保持与 plan 的字节保真。
- 既有 npm audit high 漏洞（dev 依赖链，先于本卡存在，超出 scope [test/**]）。

## 自审记录

两关自审结论如下（第 1 关 CR、第 2 关测试质量）。

### CR 结论

手段：gstack /review（specialists 派出 testing + maintainability；security/performance/api-contract/data-migration/design 经 scope 门判 skip；红队未激活——DIFF_LINES 118 < 200 且无 CRITICAL；对抗审查 Claude（Codex not_installed，已在披露栏注明）），外加 SDD 终末全分支 review（每 Task 双阶段 review 已在全绿中通过）。

发现：CRITICAL 0；INFORMATIONAL 5——spec-maintain ×3（SP1 pannini 方形 leg 出处措辞、SP2 planet 推导链注释缺失、SP3 NON_LINEAR_KINDS 重复内联）+ spec-testing-2 ×1（SP1 同源复报）；adv-claude F1–F6（结论行："merge after recording the planet row's derivation in the test comment"）。SDD 终审 Approved（Critical 0 / Important 0 / Minor 3）。

整改：commit 515ba16 一次清零全部可修项（对应完成报告第 3 条的 ①–④）；复验 reference.test.ts 55/55、gate-c 41/41（真实 GPU）、lint、typecheck 全绿。

记录不修（逐条理由见完成报告·遗留风险）：F3 / F4 / F5 / F6、F1 残余、SDD Minor #1。

轮数：specialists 1 轮 → 整改 1 轮 → 复验 1 轮，清零（CRITICAL 与可修 INFORMATIONAL 均为 0）。Step 5.8 gstack-review-log 已存档（issues_found 0，quality_score 8.0，commit 515ba16），timeline 已记。

### 测试质量结论

手段：effective-testing skill 审查清单（维度 0–4 + 集成专项 + 反模式 A–F 扫描），对象为本卡两个测试增量。

各维结果（卡增量内 CRITICAL 0 / WARNING 0，无需整改轮，清零达成）：

- 维度 0 覆盖率：branches 98.49%（262/266，门槛 90%）、statements 99.64%、functions 100%、lines 100%；被测 `src/core/reference.ts` 维持 100 / 96.96 / 100 / 100。无零覆盖、无低于均值一半的模块。
- 维度 1 有效性：无空壳、无 Mock（集成跑真实 GPU 双后端）；字面量独立推导（scratch WGSL 转写，注释声明来源，反 echo-chamber）；缺陷思维实验有实测证据——SDD 终审与对抗审查各自独立突变验证：reference 侧 lat×zoom 项突变 → pin 以 v 偏差恰 1/12 失败；假想双 shader 同错 → 新 gate leg 为首个且唯一失败测试（max 214 vs 公差 3，16384/16384 像素）。
- 维度 2 断言强度：全部强断言——unit pin 为 12 位 `toBeCloseTo` 精确字面量；gate leg 为四要件协议下的有基线公差断言（measured / derived / bounded / headroom 齐备，明文禁止编造 measured 行）。返回值字段覆盖：`project()` 的 u 与 v、`compareWithReference()` 的 webgpu 与 webgl2，逐行 / 逐 kind 均被断言，含错误路径（突变下全字段变红）。
- 维度 3 负面路径：本卡为纯数学 pin，「负面路径」映射为突变敏感度（错误实现必令测试变红），由上述两组独立突变实验证明；输入域的退化 / 极值面（faithful NaN、range sweep、Mobius pole）由文件既有测试网覆盖，不在本卡增量内。
- 维度 4 可维护性：字面量全部带推导注释（planet 含完整复数形式推导），ROWS 表驱动带 label 无魔数；测试间无共享可变状态；只测公共接口（`project` / `compareWithReference`）。
- 集成专项：真实依赖（真实 GPU、真实 WebGPU/WebGL2 上下文，setup 断言 adapter 非空，无 GPU 即响亮失败）；无验收点碎片化问题——gate 类测试按关注点单 `it` 组织，与文件既有仲裁 leg 体例一致。
- 反模式 A–F：A 无（输入点 (1, 0.2, 0.3) 已验在全部 extent 上可达，非理想世界构造）；B 无（增量内无 toBeDefined/not.toThrow 类弱断言）；C 无（字面量独立源，非实现对影）；D 无——float64 unit 路径与 f32 像素路径的双路径等价性正是本卡设计目的（三错误位点三角定位）；E 无（无伪集成）；F 无（见集成专项）。

覆盖陈述：

- 有测试网的路径：① reference float64 路径在 lat 30 × zoom 0.5、四非线性 kind 的 u/v 精确 pin（unit，12 位）；② 同一角的像素路径、两后端各自对 reference（integration，真实 GPU，四要件公差）；③ 公差升级协议成文（probe 超限时的处置有文可依）。
- 没有测试网及原因：① linear 不在 pin 内——`project` 的 linear 分支不读 povLatitude 也不读 zoom，zoom-1-invisible 错误类在该路径不存在，钉之无的放矢；② 只钉单一角 (30°, 0.5)——风险 #4 原文即「增一条 lat≠0×zoom≠1 的 reference pin」，一点即令「lat 项 × zoom 乘子」共享错误类无处藏身（该类错误在此点必现 O(1) 偏差），更密格点属增量扩展（F4 已记录为候选后续卡）；③ 其余 lat/zoom 组合的 backend-vs-backend 一致性由既有 mercator sweep 覆盖，但 vs reference 的仲裁仅此一角——仲裁面扩展按需另立卡，不在本卡范围。

## 审查意见

（superloop-verify 验收，2026-10-08。审查 SOP 四步：结构化 review → plan 红线核对 → 门禁证据复核 → 最重发现亲验。）

**结构化 review**：对 `master...feature` 最终 diff 直接全审（含 515ba16 整改提交——该提交晚于全部子代理复审，其最终形态由协调侧亲自审读）。测试专用 diff，SQL/竞态/信任边界类不适用；实际风险面（错字面量钉死错行为、伪造 measured、公差过松）逐一过：字面量与 plan 逐字节一致；measured 行有 515ba16 commit body 内贴存的 fresh probe 四行实测（webgpu=1/webgl2=1 × 4 kind，2026-10-08）可查；公差 planet 4/其余 3 与文件既有 zoom-1 腿同协议且留 3× 余量。**CRITICAL 0**。

**plan 红线核对**：T1/T2 代码块与分支逐字面对照——8 个字面量逐位一致，偏离均为 plan 明文授权项（helper 复用、measure-first、probe 取值法）；T3 全链绿（执行侧 ×1、task-finish 闸6 ×1，本次验收期又 ×1）；diff 中 plan 文件的 18 行改动经逐行核验为**纯 9 处 checkbox 勾选**（SDD 设计内动作，闸2 自动放行），无正文改写——完成报告「plan 原文未回改」的说法成立。

**门禁证据复核**：scope [test/**] 命中（闸2 过）；6/6 commit 带 `task-lat-zoom-reference-pin:` 前缀；自审两节有循环收敛过程且各级清零。例外条款逐条裁决：**F3 接受**（如实记录、不回写 plan 是正确的反 force-green 姿态）；**F4 接受为已记录风险**（协调侧突变演练见下——单点对 lat×zoom 错误类已是充分捕手；残余为纯理论性）；**F5/F6 接受**（内部脚本注释 / 历史提交消息叙述，无代码影响）；**F1 残余接受**（协调侧独立重推将暴露面收窄到「shader+reference+字面量三方同错」，仓库级仲裁极限已台账化）；**SDD Minor #1 接受**（措辞级，SDD 已裁定）。覆盖陈述在卡且具体。

**最重发现亲验**（不盲信子代理与 worker）：
1. 8 个 pin 字面量由协调侧从 **WGSL 着色器原文**（panorama.wgsl，独立于 reference.ts 与测试注释）自行转写重算——**16 位全一致**；
2. 突变演练：worktree 内将 `reference.ts:148` 圆柱纬度项改为 `- lat * zoom`（本卡目标错误类），55 个单元测试中**恰好 1 个失败**——新 cylindrical pin，v 偏差 0.08333… = 预测值 1/12，zoom-1 的既有纬度测试全部照绿（盲区现场演示）；还原后 porcelain 空、diff 0 行、55/55 复绿，还原已证；
3. gate leg 仲裁在本机真实 GPU 三次全绿（41/41），measured 行有 commit body 贴存证据。

**结论：approve**。风险 #4 的闭环（lat≠0×zoom≠1 reference pin）交付完整：unit pin 拦 reference 侧、gate leg 拦 shader 双侧同错，两半都有协调侧独立复核。遗留项均为已裁决记录，无打回事由。

**勘误（2026-10-09，合并中止记录）**：首次 task-merge 在保护③（主分支预检 verify）中止——2026-10-08 晚全量套件 3 个集成失败（backend-preference ×2、user-story-camera-switch US3，均为空帧形状 `expected 0 > 0/2`），套件耗时 56-75s（正常约 13s）。排查：失败文件单跑 7/7、两文件合跑 17/17 全绿；主分支自上次绿检（rotate-applied-delta 合并后⑥）以来仅 docs 提交；2026-10-09 上午负载回落后全量 `npm test` 39 文件 / 251 passed + 1 skipped（13.72s，恢复正常速度）。裁定：**环境抖动**（整机高负载下浏览器模式渲染掉帧），非主分支缺陷、非分支缺陷。主分支无需代码改动已复绿，按环境路径重跑 task-merge；全程未在任务分支上新增提交。
