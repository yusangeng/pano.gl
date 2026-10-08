---
plan: docs/superpowers/plans/2026-10-07-rotate-applied-delta.md
scope: [src/viewer/**, README.md, test/**, vitest.config.ts]
verify: npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
layer: domain
state: reported
createdAt: 2026-10-07T06:36:50.545Z
---
# 任务：旧四款 rotate 事件统一报 applied delta（ADV-3）



## 完成报告

plan 三步全部完成（emit 语义 → 文档 → 测试），verify 六项全绿，两轮 CR 整改 + 一轮测试质量整改后各级发现清零；遗留风险与例外条款记录项见下。

### 做了什么

按 plan 三步走（emit 改语义 → 文档 → 测试），全部在 `feature/rotate-applied-delta`（base 03c5eb5）：

1. **emit 语义**（`src/viewer/viewer.ts` 旧四款 pan 分支）：rotate 事件的 `lat` 从 REQUESTED 改为 APPLIED——先记 `before`，`camera.rotate()`（含 ±90 clamp）后再发 `pose_after - pose_before`。`lng` 不变（无 clamp，requested 即 applied，保持解包值）。零位移照发（`lat: 0`）：tap 守卫过滤的是"什么都没要"的手势，不是被 clamp 吞掉的动作；事件基数本身是消费者可见的。与 mercator 分支镜像对齐，完成 ADV-3 的全相机统一。
2. **文档**：`ViewerEvents.rotate` 的 TSDoc 全面改写（applied 语义、单拖拽内 telescoping、程序移动不发事件的 desync 警告、零位移仍发、mercator 极点渐近线说明）；`zoom` 的 TSDoc 补明是 REQUESTED；README Events 表的 rotate 行同步。
3. **测试**：新增 `test/integration/rotate-applied-delta.test.ts`（8 腿：北极 clamp、planet 同构守护、深过冲、南极 clamp、多步拖拽 telescoping、起点钉死在极点仍发 lat 0、lng 解包、中段对照）；`support/gestures.ts` 新增 `dragThrough`（合成多步拖拽——vitest 5 browser 无 pointer 原语，安全性由 InputController 先跟踪后 capture 的契约背书，pointerId 999 避开 Chromium 的 id-1 巧合）；`vitest.config.ts` 把本文件加进 no-webgpu 白名单（CI 上 presented-canvas 门会跳过 integration 侧副本，此行保证 applied-delta 契约在 CI 有执行中的测试；断言全是 pose+事件，无像素回读）。

### 自测结果（verify 全绿）

- `npm run gen:shaders` 无漂移；`npm run build` ✓；`npm test` 346 unit + 241 integration/no-webgpu passed、1 skipped（既有 presented-canvas skip）；`npm run typecheck` 三程序 + README options 检查 ✓；`npm run lint` ✓；`npm run test:coverage` 分支 98.45%（255/259，基线持平，阈值 90% 过）。
- 变异证明 ×2（第 1 关期间，均按"具名失败测试"纪律完成 kill + restore 验证）：(a) 把 emit 基线改成每手势一次而非每 move 一次——多步腿红（`rotations[1].lat expected 1 to be +0` 处）被杀；(b) 零位移抑制 mutant——多步腿长度断言与极点钉死腿长度断言双双杀之。

### 偏离 plan 的点

- 多步拖拽腿的测试基建：plan 未预见 vitest 5 browser `userEvent` 无 pointer 原语（读 `@vitest/browser/dist/context.js` 证实），`dragThrough` 以合成 PointerEvent 实现，TSDoc 写明安全论证与"必须断言事件数"的使用纪律。
- 多步腿标题中途缩短：原 69 字符标题使失败时保留的 trace.zip 目标文件名超 macOS 255 字符上限（ENAMETOOLONG），中止整个 run 并吞掉兄弟结果；缩短后单独验证过 boundary 腿的 kill。
- spec-testing 评审员的桩里 `lng toBe(0)` 会在 `-0` 上红（纯竖直拖拽的 lng 恰为 -0，`Object.is(-0,0)===false`）——本文件因此用和值断言（accumulate 初值 0 吸收 -0），见测试文件头注。

### 遗留风险

1. **发版义务**：这是 1.0 后公共面首个非纯增量变更（rotate 事件载荷语义变化）。建议下个 release 走 minor 1.2.0 并在 release commit 里写明"rotate.lat 旧四款从 requested 改 applied"；adversarial 评审认为可能够 major，由维护者裁决。package.json 不在本卡 scope，未动。
2. **mercator 极点钉死**（red-team #1 的公式半，已记录不改）：`Math.sin(±π/2)` 在 float64 恰为 1 → `atanh(1)=∞` → 挂在极点的 mercator 相机拖拽垂直不可动（两个方向都是）。`rotate()` 仍可动（已验证 camera-controller.ts:151-163）。属 camera-controller 公式，超本卡"无 camera-controller 改动"的 plan 约束 → 建议 follow-up 卡：clamp atanh 实参或投影切换时去极点化，配 mercator-at-pole 腿。
3. **相邻既有三件**（均在本卡白名单之外，记录待协调者处置）：`classifyDrag` 无逐事件量级 clamp（一个伪 pointermove 可让 lng 转数百圈）；EventEmitter 跨监听者共享同一 payload 对象；某监听者 throw 会中断余下监听者（src/core、src/interaction）。
4. **vitest.config.ts:248 白名单行**与 camera-aspect-fit 兄弟分支同改一行 alternation，合并时可能文本冲突（两侧都改 `(viewer-events|dispose-order|mercator-drag|...)` 这行）。
5. **README 束大小数字已陈旧**（先于本卡）：diff base 03c5eb5 实测 gzip 37.12 kB、本分支 37.13 kB（本卡注释 +0.01），README 写 36.9。未改——合并后数值取决于含 camera-aspect-fit 的 master，建议合并时重测再改。
6. plan 模板缺陷与 da62fb7 提交信息补正说明见 git 历史（早于本段收工，不影响结果）。

## 自审记录

### CR 结论

手段：gstack `/review`（4 专家：perf / api / maintainability / testing → merge/dedup → red-team + adversarial 双通道；DIFF_LINES 239>200 触发 red-team）。Codex 本机 not_installed，adversarial 由 Claude 承担。**共 2 轮整改**（commit 3f35d13、866b50a）。

第 1 轮（specialists）：perf 0；api 2 INFO；maintain 5 INFO；testing **1 CRITICAL + 1 INFO**。
- CRITICAL（单 move 测试无法区分"每手势记基线"与"每 move 记基线"的 mutant）：新增多步拖拽腿 + `dragThrough`，变异证明杀死（具名失败：`rotations[1].lat` 处 "expected 1 to be +0"）。
- INFO 全改：零位移裁决为 FIRE 而非抑制（两半均钉死：手势起点在极点、拖拽中途饱和；变异证明抑制 mutant 被两条长度断言杀死）；TSDoc/注释/config 理由补全。

第 2 轮（red-team + adversarial）：
- redteam#1（mercator 极点渐近线）：doc 半已修（TSDoc 括注）；公式半记录为遗留风险 #2（超 plan 约束）。
- redteam#2（planet 未钉）：加 planet 腿；linear/panniki 不钉的理由写进腿注（它们与 cylindrical 只差本路径不读的投影公式）。
- adversarial F1（telescoping 过度承诺）：TSDoc 收窄为"单个拖拽内"+"跨程序移动会 desync"警告。
- adversarial F3（zoom 语义未文档化）：zoom TSDoc 补 REQUESTED 说明。
- adversarial F2（semver）：→ 完成报告遗留风险 #1。
- adversarial F4：第 1 轮已闭。

终态：**CRITICAL 0、WARNING 0、INFORMATIONAL 0 未决**（全部 fixed，或按例外条款逐条记录于上：遗留风险 #1/#2/#3 即记录项）。两轮 mutation restore 均验证（checkout 后 status 干净、grep 无残渣、绿跑复现 14/14、16/16）。

### 测试质量结论

手段：effective-testing skill 审查清单（维度 0-4 + 集成专项 + 反模式 A-F 扫描）评估本卡改动的测试。**1 轮整改**（commit 0dca9d8），复评零发现。

- **发现并整改**：返回值字段覆盖——`lng` 此前只在有水平分量的那条腿被断言；竖直腿逐事件值恰为 -0 使 `toBe(0)` 必红，字段被静默丢弃。改为和值断言（`reduce` 初值 0 吸收 -0 成 +0，bit-exact 的"竖直拖拽无经度泄漏"），8 条腿全覆盖，与 mercator-drag 腿 1 的既有习惯一致；文件头注说明为何永不逐事件断言 lng。整改后 16/16 绿（两项目）、lint、integration typecheck 复验。
- **评估后不改（记录理由）**：每腿 setup 重复——各腿在定义自己的参数（kind/extent/pose/拖拽坐标）上本质不同，且内联形态是 mercator-drag.test.ts 的既有习惯；抽工厂对检出力零增益，徒增已过第 1 关文件的扰动。
- **弱断言扫描**：全部为 `toBe` / `toBeCloseTo(·,9)`（精度理由逐腿注明）/ `toHaveLength`，无 toBeDefined/typeof/not.toThrow/toContain。平均断言数/腿 ≈ 2.9。
- **负面路径占比**：8 腿中 6-7 腿为 clamp/过冲/钉死/换行边界（≈75-88%，阈值 30%）。presented-canvas 条件跳过与 no-webgpu 项目配对设计，CI 内路径始终有执行（vitest.config.ts 有专门理由段）。
- **依赖真实性**：零 mock——真实浏览器、真实 Viewer 公共面、真实事件管线；`dragThrough` 的合成 PointerEvent 经真实监听路径派发，安全论证 + "必须断言事件数"纪律写进 TSDoc。缺陷思维实验：第 1 关的两轮变异 kill 证明充当。

**覆盖陈述（必填）**：本卡触及的路径——(a) `viewer.ts` 旧四款 pan 分支（唯一源码行为改动）：8 条集成腿覆盖，integration（真 GPU）与 no-webgpu（WebGL2）两项目各跑一遍=路径等价性验证；mercator 分支本卡未动、由既有 mercator-drag 五测覆盖；linear/panniki 不单独钉（理由见腿注：与本路径仅差不读的投影公式）。(b) `gestures.ts` `dragThrough`：多步腿覆盖（两项目）。(c) `viewer.ts` 在 unit 覆盖率中被排除——不是失职而是既定设计：vitest.config.ts 有实测依据的长注释（node 环境无 DOM，a447fb9 实测四门全跌），其覆盖由集成项目承担（本项目不计覆盖率），故单元分支覆盖率 98.45% 与本卡改动相容且阈值通过。(d) README/vitest.config 为文档与配置，无代码路径；config 变更的效果由 16/16 两项目绿跑证实。

## 审查意见

**结论：approve**（superloop-verify 自动验收路径，2026-10-08；审查后即合。唯一冲突文件的合并处置见 A1 与交接说明）。

按 CONTRACT「审查 SOP」四步全审 `feature/rotate-applied-delta`（12 commits，base 03c5eb5）：

### 1. 结构化 review（gstack /review 全流程）

两专家子代理（rot-testing / rot-adversarial）+ red team 复审（攻击临时裁决 P1–P5 + 四项独立复核）+ 最重发现逐条亲验。**CRITICAL 0**；WARNING 级 6 项 + INFO 杂项 1 组，逐条裁决（编号即裁决号）：

- **A1 [adversarial#1=testing#1；P1] vitest.config.ts 合并冲突**——`git merge-tree --write-tree` 亲验：唯一冲突文件（README.md、src/viewer/viewer.ts 自动合并）。两侧对 base 均为纯新增：master 加 aspect-fit 段落并改写 intro，branch 在同一插入点加 rotate 段落。**并集解**（零语义张力）：保留两段 + master 的 intro + `(viewer-events|dispose-order|mercator-drag|aspect-fit|rotate-applied-delta)`。裁决：合并时机事项、非分支缺陷，不阻断 approve；task-merge 保护④停手后按并集交用户在执行 worktree 解（`-X ours/theirs` 否决——会静默丢一张卡的 CI 白名单条目，正是那段注释存在要防的事故；master 上手造 merge commit 否决——绕门禁）。red-team 独立复核确认唯一冲突性与并集机械性。
- **A2 [adversarial#2；P2] "Both fields are the APPLIED deltas" 的 lng 缝隙**：跨 wrap 缝（288 vs −72）时 pose-diff 与 requested 取值不同；TSDoc 与 README 两表面均有紧邻括注点名该例。文档精度后续卡（aspect-fit A3 先例）。
- **A3 [adversarial#3；P3] "dragging never reaches exactly ±90" 为假（本卡新写的绝对断言被数值证伪）**：red-team 独立复算证实——branch base 从 89.9° 一记 −500px 合并 move 恰落 **exactly 90**（float64 tanh 饱和）；合并后（extentY 0.5）阈值翻倍仍可达（~770px from 89.9，或 2000px from 85）；且该 TSDoc 自己的到达路线清单漏了"拖拽自钉"这条本卡使其可达的路。**裁决：非阻断**（先例 aspect-fit A3；句子操作内容其余为真——渐近线非 clamp、钉死相机拖不动、rotate() 可救；行为半 panMercator 本卡未触碰、master 同状），**但修复不走泛化 backlog，具名落点二选一**：(a) 用户批署 A1 并集解的同一 sitting 顺手一词之改（"reaches exactly"→"crosses"，asin(tanh(·))<π/2 严格成立使其为真；viewer.ts 自动合并不受冲突影响）；或 (b) 合并后 master 侧立即一条 doc commit 并记入发版清单。卡勘误半：遗留风险#2 引用 151-163 实为 panMercator 体（rotate() 在 134-139，实质结论不受影响），路线清单不全。
- **A4 [adversarial#4；P4] telescoping 无条件措辞**：受害场景需消费者自己的代码在单拖拽两 move 之间程序移动；库无自动 pan（亲验：'rotate' emit 点恰两处、公共 rotate() 不发事件）。desync 警告两句之隔。措辞收窄（"absent interleaved programmatic moves"）入文档精度后续卡。
- **A5 [testing#2 + red-team P5/A；非今日 wrong-green，未来回归面] 测试硬化缺口，一腿三杀**：(i) lng 幅值 clamp mutant 存活（无 >72° 转向腿）；(ii) ±180 normalizer mutant 同样存活（−72 在一切合理范围内、竖直腿 −0 和值不变）；(iii) zoom-scaled applied lat mutant 存活（8 腿全 mount zoom 1、viewer.ts 被单元覆盖率设计性排除、既有套件只断言计数/类型/另一分支）。**一腿闭三**：400px 宽拖 300px → lng 恰 −270（0.75 二进制精确）+ pose wrap 恰 90，mount 在 zoom 0.5 跑（classifyDrag 不读 zoom，字面量不变）。记后续卡。
- **A6 [adversarial#5] semver/发版**：rotate.lat 是 1.0 后首个公共面行为反转；adversarial 判 strictly major、卡建议 minor 由维护者裁——**用户拍板项**（与 camera-aspect-fit 的 cylindrical 取景变化并列）。不采纳 adversarial「合并前在库内留档 release 决定」为 blocker：只有用户能做的决定不当合并门槛，卡已记录义务。无 CHANGELOG（从无到有也是决定）。
- **A7 [INFO 杂项]**：(a) lng 逐事件 −0 未文档化（先在行为；测试文件头注有）；(b) linear/pannini 无专属腿（共享 emit 行论证成立，emit 行拆分时风险自担——记入后续卡备注）；(c) README rotate 行较 TSDoc 薄（缺 lat:0 基数规则与程序移动不发事件警告）；(d) **red-team 新发现**：zoom 事件 TSDoc「clamps its zoom parameter」对 linear 失准（linear clamp 的是 FOV 15°–110°，zoom() 方法自己的 TSDoc 三段之下写着）；(e) plan「clean merge either order」对 vitest.config.ts 为假（卡风险#4 已如实记录，plan 未回改）。

red-team 独立复核另证：8 腿全部字面量 node 独立重推 bit-honest（0.5/0.25/0.125 二进制精确；−72 与 wrap 288 恰确，非碰巧）；7 类额外 mutant 被杀（field swap、Math.round、&&→||、双基线、emit-before-rotate、wrapped-pose-diff；"requested−overshoot" 与 applied 代数等价、不构成 mutant）；plan 保真逐项确认（白名单条件指令恰执行——base 03c5eb5 无 `|aspect-fit`，亲验）。

### 2. plan 红线核对（存在性已核，行为性声明标"未实测"）

T1 红→白名单：plan 3 腿 → 实际 8 腿（超 plan 字面，卡内逐腿披露来源：CR 加腿与变异证明需求）；白名单只加自家名字。T2：emit site 对 diff 逐字核（plan 块 + CR 增补注释句）；TSDoc/README 携带全部裁决演化（F1 telescoping 收窄、F3 zoom 补文档、red-team 括注）。T3 验证链："恰好 4 文件" 被 7 文件现实取代——gestures.ts（dragThrough 测试基建）与 plan/卡为披露偏离，接受。12/12 checkbox 属实。**未实测（留保护⑥）**：全链绿、346+241 计数、98.45% 分支覆盖。**已亲验**：'rotate' emit 点恰两处（viewer.ts:172 mercator、:188 旧四款）；公共 rotate() 与 cameraOptions pose 写入不发事件；lat clamp 只在 camera-controller #apply（134-139）；classifyDrag 无 lng clamp；panMercator branch=master 逐字节一致。

### 3. 门禁证据复核

12/12 提交带 `task-rotate-applied-delta:` 前缀；7/7 diff 文件在 scope 白名单内（gestures.ts 为披露的测试基建偏离，接受）；主/分支卡「完成报告」「自审记录」两节同步一致；CR 具名整改提交逐一 `git show` 核实（3f35d13、866b50a、0dca9d8、da62fb7）；自审记录合格（两变异证明均有具名失败测试 + restore 验证记录；例外条款 = 遗留风险 #1/#2/#3 逐条有理由，接受）。**勘误两处（不阻断）**：遗留风险#2 的行号引用错（见 A3）；其路线清单不全。完成报告无计数类声明，无数字失实。

### 4. 后续卡候选（交维护者裁决立项，非本卡义务）

1. **文档精度 pass**（A2/A4/A7c/A7d，含 A3 若走 (b) 落点）：lng 缝措辞、telescoping 限定、README rotate 行补全、zoom TSDoc 的 linear-FOV 精度。
2. **测试硬化一腿**（A5）：>180° lng 腿（−270/pose 90）在 zoom 0.5 mount。
3. **mercator 极点去钉**（A3 行为半）：前提比本卡记录更强——合并后 exactly-90 仍可达（red-team 复算），建议腿含 drag 饱和路线。
4. **发版准备**（A6）：semver 裁决 + CHANGELOG 决定 + README 束大小重测（36.9 已陈旧，实际 gzip ~37.1）。

### 5. 发版提醒（用户拍板）

rotate.lat 语义（旧四款 requested→applied）与 camera-aspect-fit 的 cylindrical 取景变化同属下次 release 必须写明的变更；major/minor 由用户裁决。发版清单应含 A3 的 (b) 落点（若未走 (a)）。
