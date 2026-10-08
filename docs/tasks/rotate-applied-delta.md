---
plan: docs/superpowers/plans/2026-10-07-rotate-applied-delta.md
scope: [src/viewer/**, README.md, test/**, vitest.config.ts]
verify: npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
layer: domain
state: open
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

（协调者填：逐条编号；通过则写 approve）
