---
plan: docs/superpowers/plans/2026-09-28-gate-c-planet-arbiter.md
scope: [test/integration/gate-c-cross-backend.test.ts]
verify: npm run build && npm test
layer: foundation
state: merged
createdAt: 2026-09-28T15:49:10.092Z
---
# 任务：门 C planet 仲裁腿：lat=30 第三方裁判



## 完成报告

**做了什么**：门 C 新增 planet 仲裁腿——`compareWithReference(STATES[1], projectionFor('planet', ...))`（lat 30 / lng 45 / zoom 1 / extent 4×4），与 cylindrical 仲裁腿同形，插在它与极点例外测试之间。probe-then-pin 按规执行：probe 实测 `webgpu=1 webgl2=1`（本机硬件 GPU，2026-09-28），Mmax = 1 → 2×1 = 2 恰为 2 的幂 → 按严格大于规则取 **bound = 4**；容差注释含实测/推导/有界/余量四要素。两个提交：`5a675ac`（腿本体，单文件 +29 行）+ `b162466`（质量审查 MINOR 1 注释修正：除法计数 "two f32 divisions" → "a handful of f32 divisions ... and a second atan"，与 shader 实际链长相符；bound 与其余注释不变）。

**自测结果**：probe 跑 19/19 绿（实测值经 `--reporter=verbose` 读出，见偏离①）；钉值跑 19/19 绿；MINOR 1 修正后该文件再跑 19/19 绿。`npm run typecheck`（三个 tsc 程序）✅，`npm run lint` ✅，`npm run build` ✅，`npm test` 全绿（unit 309/309；integration + no-webgpu 183 通过 / 1 跳过）。SDD 两阶段审查：spec 合规 ✅（含实测值独立复测：审查者以未跟踪探针文件亲测两轮，均 1/1，测后删除并证明树干净）；质量审查 APPROVED（0 CRITICAL / 0 IMPORTANT / 3 MINOR，处置见下）。

**偏离 plan 的点**：
1. vitest browser 模式默认 reporter 不转发页内 console.log，probe 行以 `--reporter=verbose` 读出；plan 的原命令照跑且绿，实测值另经 spec 审查者独立复测确认。
2. derived 注释的除法计数措辞与 plan 模板不同（MINOR 1 整改）——plan 模板的 "two" 是 plan 期的计数疏漏，审查指出 planet 较 cylindrical 多出约六处除法（复除两处、除以 m 三处、atan 内一处）+ 第二个 atan 与 sqrt。
3. plan Task 1 Step 4 允许的探针-钉值合并单提交 + 一个注释修正提交，共两个提交。

**无法整改的审查发现（逐条记录，待协调者裁决）**：
- **MINOR 2**：`test/integration/support/cross-backend.ts:167` 的 "~21" 上下文计数因本腿变为 22——该文件不在本卡 scope 白名单 `[test/integration/gate-c-cross-backend.test.ts]` 内，执行者无权改。内容：一处注释计数陈旧。原因：scope 闸。风险自评：纯注释，无功能影响；建议合并时顺手更正或另立微卡。
- **MINOR 3**：仲裁腿的两条 expect 无诊断消息（与 cylindrical 仲裁腿一致；`compareWithReference` 只返回 maxima，不返回最坏像素位置）。审查者自评为"未来改进项，非本卡改动"。风险自评：无——vitest 失败时打印实际值；改进建议（返回最坏像素位置与后端归属）留作后续。

**遗留风险**：bound 4 为本机硬件 GPU 实测；CI 走 SwiftShader。余量数值按最陡通道重核并更正（2026-09-29，CR 第 1 轮）：门源 blue 通道为 8 周期正弦（通道梯度 ≈ 6378/单位 u，是 1 周期通道的 8 倍），按 GLSL-ES 最坏 atan 精度 2⁻¹¹ rad 传播，theta 项 ≈ 0.5 通道、phi 项 ≈ 1.0 通道、对齐最坏 ≈ 1.5，对 bound 4 余量 **≈ 2.7–8×**。此前记录的 "~60×"（质量审查轮）只按 1 周期通道梯度计算，高估约一个数量级，废弃——未来 flake 排查以本段数字为准，不得引用旧值跳过重测。定性结论不变：真实 SwiftShader 超越函数接近正确舍入而非规范下限，且本腿已在 CI=1（WebGPU 半 SwiftShader）下实测 19/19 绿（2026-09-29 对抗审查轮独立复跑）。残留盲区（对抗轮指出）：macOS 上 CI=1 只把 WebGPU 半换为 SwiftShader，WebGL2 半仍走硬件 ANGLE；Linux CI 双半皆 SwiftShader 的 WebGL2-vs-reference 象限从未被任何机器实测——旁证是同形 cylindrical 仲裁腿（≤3）在真实 CI 长绿。若未来某机器实测超出 bound，应按容差四要求重测重钉（2× + 严格大于 2 的幂规则），不得盲目放宽。

## 自审记录

两关结论如下（第 1 关 CR 于 2026-09-29 完成；第 2 关测试质量见下节）。

### CR 结论

**手段**：gstack review 技能（结构化清单 Pass 1 CRITICAL / Pass 2 INFORMATIONAL + scope/plan 完成度审计）+ 独立 Claude 对抗审查 subagent（CODEX_MODE not_installed，Codex 路径跳过）。审查基点 `bbf527b`（= `git merge-base master HEAD`；origin/master 落后本地 master 五个协调提交，不能作基点）。diff 2 文件 44+/1−，DIFF_LINES 45 < 50 → 专家 pass 按规则跳过。对抗审查者另独立复跑：本文件 hardware 19/19 绿 + `CI=1`（WebGPU 半 SwiftShader）19/19 绿，typecheck / lint 干净，树净。

**各级发现数**：CRITICAL **0**；INFORMATIONAL 新增 **0**；对抗审查 **5 条**（1 条整改 + 4 条记录/分流）：

1. 完成报告余量数字 "~60×" 只按 1 周期通道梯度计算，漏掉门源 blue 通道的 8 周期正弦（最陡通道，梯度 ≈ 6378/单位 u）——按 GLSL-ES 最坏 atan 精度 2⁻¹¹ rad 重算为 **≈ 2.7–8×**。**已整改**：遗留风险段重写（本提交），并顺带记录对抗轮的残留盲区（Linux CI 双半 SwiftShader 的 WebGL2 象限未实测，cylindrical 同形先例缓解）。
2. `support/cross-backend.ts:167` "~21" 计数陈旧（实为 22）= 完成报告在档的 **MINOR 2**，scope 白名单外无法整改，逐条记录待协调者裁决。
3. 卡内自审两节为模板占位——即本节与测试质量节，按流水线本就在第 1/2 关填写，非缺陷；本结论的写入即其解决。
4. 实测 1/1 的承载输入（两个 maxima 恰为 1）无法从已提交工件再推导（probe console.log 按钉值形移除）；审计链 = 执行者 probe + spec 审查者两轮独立复测。若真值为 2，钉值将比规则偏紧——flake 方向误差而非漏检。接受，记录在案。
5.（conf 4，附录级）SwiftShader-WebGL2 vs f64 reference 象限在 macOS 上不可测（CI=1 只换 WebGPU 半）——已并入遗留风险段，cylindrical 先例缓解。

对抗轮同时确认的非发现（引用以防复检）：bound 规则算术正确（2×1=2 → 严格大于 → 4）；容差非空洞（双转写同错表现为帧级均匀差 ≈97 通道，远超 bound 4）；与 cylindrical 腿非重复覆盖（kind/extent 均不同）；注释数值断言逐项核实（两处 ÷d2、三处 ÷m、sqrt(p²+q²)、第二个 atan）；NaN 必然传播为失败而非漏过；无泄漏无竞态；提交消息与实测值一致。

**整改**：上述第 1 条（本提交）；SDD 质量审查轮 MINOR 1 此前已改（b162466）。无法整改项：第 2 条（scope 闸）、第 3 条（流水线占位性质）。

**轮数**：**1 轮**（整改后无新发现，闭环；残留均按例外规则逐条记录）。

### 测试质量结论

**手段**：effective-testing 技能审查清单（有效性 / 断言强度 / 负面路径 / 可维护性四维），由独立新鲜上下文子代理执行（read-only + 数值复核，2026-09-29）。

**发现**：CRITICAL **0** / WARNING **0** / INFO **1**。INFO 为评审简报语境更正（非测试缺陷）：门 A 基线**含** planet（4 态，`test/fixtures/baseline/planet/`），但 `comparableStates`（gate-a-pixels.test.ts:66-76）把非线性相机过滤到 lat=0/lng=0 → planet 仅在原点比较，倾斜与 lng 项在原点是恒等——门 A 对**倾斜** planet 结构性失明，反而更强地支撑本腿的必要性。任务卡 / plan / 测试注释均无此错误表述，无需整改。

**关键复核**（引用以防复检）：① 有效性——倾斜项错误（如 `numIm = ct*yy + st`、`denRe = ct - st*yy`）在 lat 0 不可见（st=0/ct=1 时 Möbius 预变换坍缩为恒等）但在 lat 30 显著位移；漏 `theta -= lng` 即 δu=0.125 → 帧级 ≈100 通道差（独立复算与 CR 对抗轮的 ~97 一致），远超 bound 4。本腿是该故障类的**唯一**检测器（门 A 原点过滤、门 B 仅灵敏度断言、pairwise 腿构造性失明）。② 断言强度——`r.webgpu`/`r.webgl2` 两字段均有精确数值上界；`expect(NaN).toBeLessThanOrEqual(4)` 失败语义成立（NaN 比较为 false，且 `maxChannelDiff` 传播 NaN）；当前 Uint8 读回下 NaN 实际不可入，属纵深防御。可检测最小 UV 位移 ≈ 4/6384 ≈ 6.3e-4，真实转写错误位移 ≥1e-2，检测余量约 1.5 个数量级。③ 负面路径——极点由同文件例外测试覆盖（lat 89.5，<64）；本腿位姿算术上避开分支点（zz=0 需 ndcX=0 → x=63.5，偶画布非中心；denRe=0 需 yy≈−3.73，超 extent 4 的 [−2,2]）；无效输入路径对像素门 N/A（属 core 层单测）。④ 可维护性——容差四要素齐备，bound 规则算术复核正确（2×1=2 → 严格大于 → 4），cylindrical ≤3 交叉引用准确。

**整改**：无需整改（0 CRITICAL / 0 WARNING；INFO 仅涉评审简报，工件无错）。

**轮数**：**1 轮**闭环。

**覆盖陈述**：
- **有网**：planet 倾斜位姿（lat 30 / lng 45 / zoom 1 / extent 4×4）逐后端对 f64 仲裁者的像素比较——全测试套件中唯一的倾斜 planet 第三方意见。活路径：非恒等 Möbius 预变换（st≈0.259, ct≈0.966）、真实 lng 减法（θ−π/4）、4×4 extent 的 ndcToSurface 分支、zoom 缩放、两个 atan fixup 分支。
- **无网（显式记录 + 理由）**：pannini/linear 仲裁腿——spec §0/§3 明确范围外（linear 另有结构性不适：reference 的 ndcToSurface 反演固定 quad 视图，pose 烘焙进 viewMatrix）；planet 其余位姿（STATES 0/2/3）——spec 只钉一腿，state 0 与门 A 原点比较重叠；helper 最坏像素诊断（= 在档 MINOR 3）；cross-backend.ts "~21" 计数（= 在档 MINOR 2，scope 闸）；高纬度仲裁比较——极点区是文档化 pairwise 例外（<64），高纬公式行为由 reference.test.ts 的 f32 证人在单测层钉住。
- **结构性抓不到（记录）**：reference 与两份 shader 三方共错——仲裁者本身是遗留 shader 的逐行转写（故意含 quirk），补偿控制 = reference.test.ts（22 个 it 块）独立钉 planet 精确值（z 取反、fixup、lng）、zoom、退化中心与 planet-tilt describe；亚容差漂移（UV 位移 <6.3e-4，如 1-ulp 常数扰动——非现实手抄错误类）；未采样位姿的缺陷（单点位采样，单测位姿钉缓解）；双 NaN 一致通过（本位姿避开的分支点类，单测层钉住）；Linux 双 SwiftShader 的 WebGL2-vs-reference 象限（遗留风险段在档，cylindrical ≤3 同形先例缓解）。

## 审查意见

**结论：approve**（2026-09-29，superloop-verify 自动验收，四步全审）。

1. **结构化 review**：全 diff 亲读（测试文件 +30 行插入 + plan 勾选 + 卡填充）。插入位置与 plan 一致（cylindrical 仲裁腿之后、极点例外之前）；钉值块为 plan 模板逐字，仅填 M1=1/M2=1/BOUND=4 与 MINOR 1 措辞修正（已按偏离②记录并经 SDD 质量审查裁决）；cylindrical ≤3、pairwise ≤2、极点 <64 三处既有容差零触碰（diff 构造性确认）。容差注释四要素（实测/推导/有界/余量）齐备。
2. **plan 红线逐条核对**：File Structure 恰为白名单单文件 + plan/卡自动放行，无越界文件；7/7 提交带 `task-gate-c-planet-arbiter:` 前缀；probe-then-pin 顺序按 spec §3（数值不预设）；plan diff 为纯勾选翻转零内容改动；偏离三条（verbose reporter 读探针 / 除法计数措辞 / 合并单提交）均属 plan 自身勘误或 plan 明示允许的形态。
3. **门禁证据复核**：完成报告五节齐（含无法整改发现与遗留风险的逐条三元组）；CR 结论含手段/发现数/整改/轮数与对抗轮非发现清单；测试质量结论含四维复核与必含覆盖陈述（有网/无网/结构性抓不到，无网部分均给理由或在档 MINOR 编号）。留痕合规。
4. **最重发现亲验**：
   - **腿输入亲验**：`STATES[1]` 实读 = `{ povLatitude: 30, povLongitude: 45, zoom: 1 }`，`projectionFor('planet')` 经 `extentFor` 得 `{ kind: 'planet', zoom: 1, extent: [4,4] }`——与卡/spec 主张逐字段一致。
   - **仲裁路由亲验**：`compareWithReference` 实读——`referenceImage`（f64 CPU）+ `renderOffscreen`（WebGPU）+ `renderOffscreenGLSL`（WebGL2）各渲一次，逐后端 `maxChannelDiff` 对 reference；projection 全程透传，kind 无关，无需改 support 的主张成立。
   - **bound 规则亲验**：2×Mmax = 2×1 = 2，严格大于 2 的最小 2 的幂 = 4（与 plan 自带算例 Mmax=3→8、Mmax=4→16 同规则同方向）。
   - **余量重算亲验（最重数学主张）**：门源 blue 通道实读为 `127·sin(16πu)·sin(16πv)`——u/v 双向 8 周期成立；theta 项独立复算 2⁻¹¹/(2π) × (127·16π) ≈ **0.50 通道**、phi 项 2⁻¹¹/π × (127·16π) ≈ **0.99 通道**，与卡内「≈0.5 / ≈1.0」逐位吻合；最坏合计 ≈1.5 对 bound 4 余量 ≈2.7×、最好 ≈8×——「≈2.7–8×」成立，旧值 "~60×" 的废弃裁决正确。
   - **MINOR 2 计数亲验**：master 侧 WebGL 上下文 = 16（pairwise 4×4）+ 1（cylindrical 仲裁）+ 4（极点例外循环 4 kinds）= **21**，本腿 +1 = **22**——「~21 变 22」精确成立（旁证 19/19 用例数 = 16+1+1+1）。

**例外条款与偏离逐条裁决：接受，不构成打回**——MINOR 2（cross-backend.ts "~21" 计数陈旧）：断言亲验成立，采纳卡内「合并时顺手更正」选项，由协调侧在合并后以纯注释提交更正（非业务代码，不越执行边界）；MINOR 3（expect 无诊断消息）：与 cylindrical 腿同形，vitest 失败打印实际值，留作后续改进成立；对抗轮 3/4/5（占位性质、实测值审计链、macOS CI=1 象限盲区）：均已在档或由 cylindrical 同形先例缓解；偏离①②③均为工具行为或 plan 勘误，无 scope 逃逸。实测 maxima 1/1 虽低于 spec「预期大于 cylindrical ≤3」的预判，属测量结果而非偏差——bound 4 > 3 的方向性仍成立，且「若真值为 2 则钉值偏紧（flake 方向误差）」的风险定性正确。

合并安全性由 task-merge 六重保护收口（合并前后主分支 verify 双跑）。
