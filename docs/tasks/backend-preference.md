---
plan: docs/superpowers/plans/2026-09-28-backend-preference.md
scope: [src/**, test/**, demo/**, README.md]
verify: npm run typecheck && npm run lint && npm test
layer: app
state: reported
createdAt: 2026-09-28T15:14:36.774Z
---
# 任务：后端选择选项：backend 选项 + lab 开关



## 完成报告

实现、审查、整改全记录如下；裁决项两条（D1 横幅标题、视频播放态披露口径）待协调者裁决。

### 做了什么

按 plan 7 个 Task 全部完成（SDD 执行：每 Task 实现 + spec 审 + quality 审 + 终末全分支 review APPROVED）：

1. **库面**：`BackendPreference` 类型（`'auto' | 'webgpu' | 'webgl2'`）+ `assertBackend` 校验（`src/core/options.ts`）；`createBackend` 三分支（auto 保持逐字节原路径 / webgpu 不可用即拒 / webgl2 不可用即拒，拒绝消息点名所求后端，`src/viewer/backend-factory.ts`）；`ImageViewerOptions`/`VideoViewerOptions` 增 `backend?`，两 viewer 线程化到 create（`image-viewer.ts:90` / `video-viewer.ts:77`）；`index.ts` 类型导出；README 补文档句。
2. **lab demo**：状态面板 `[auto | WebGPU | WebGL2]` 分段开关 + 徽章（显示事实 backend，随活 viewer 全量重渲染）；`?backend=` URL 书签（记偏好非能力）；切换 = dispose+recreate（pose 携带），成功才回写 URL，boot 失败先摘参再出横幅；`pendingBackend` 队列闭合重建窗口的竞态（末次点击胜）。
3. **测试**：单测（校验四臂 + 工厂四臂）；真 GPU 集成（image/video 强制 webgl2 选中 + webgpu 钉选 + 跨后端像素等价 ≤4/255）；no-webgpu 孪生（强制 webgpu 具名拒绝 ×2 入口 + 缺省回落 WebGL2 控制组）。

### 自测结果

- verify 全绿（交卷时 task-finish 闸 6 当面复跑）：typecheck 三 program 0 错；lint 0 违规；**316 单测 + 188 集成过 / 1 例既有 skip**；单测分支覆盖 **98.73%**（阈值 90%）。
- 突变检验：video 线程化去参突变被 2 条命名测试双向击杀（真 GPU readback 侧 + no-webgpu 拒绝侧），还原三重证明后复绿。
- 目检（gate 1 前，c6d3c17+06cb381 上）：五项全绿——boot 控制/徽章分置、WebGL2/WebGPU 双向切换（徽章+hint+URL+pose 保持）、`?backend=vulkan` 静默回退、竞态探针收敛无死键、auto 段回归。

### 偏离 plan 的点

1. **实现期两处超出 plan 步骤的修复**（目检先发现、quality 审确认，均过三轮复审）：c6d3c17 修徽章/hint 只喂 boot probe 不随切换更新（plan Step 5 的 render-once 形状无法满足 spec §7.5）；06cb381 修 setBackend 在飞竞态死键（`pendingBackend` 队列，plan 未排）。spec 复审裁定为"spec 主导的有意偏离获批"。
2. **D1（裁决项）**：'Backend switch failed' 横幅标题偏离 spec §4.1 字面（"沿用 'Viewer creation failed'"）——审者建议保留（点名故障源、语义一致），交裁决。
3. **D2（裁决项）**：video→video 后端切换的播放态口径——spec 只承诺 pose 携带；实际新元素 paused at t=0（无 autoplay，Play 键是唯一播放路径）。已按严读法在 main.ts 头注释披露，未实现 seek-on-load 携带（超线）。
4. **A3 注释两轮返工**：gate A 引证失实（GAP1，裁决前提本身有误）+ "the only pixel check" 面上为假（GAP2）——两轮修正落 5b2e951 + 43fa113；教训已记（引证类注释核到源文件）。
5. **门禁整改提交**（plan 之外的审查轮产物）：gate 1 = 08fab89（ADV-1/ADV-2）+ 176ef6d（RT-3 裸 `?` + RT-1 披露）+ bfb2ecf（RT-1 措辞严读）；gate 2 = 5b225c9（video 强制路径两半测试）+ 938b56a（Task 5 M2 头注释收窄）。

### 遗留风险（均已裁决留档，台账有全文）

- **RT-2**：重建窗口（dispose→create 落地之间）source 点击被瞬态吞没，再点即中——守卫系 1f6f1bd 原有；修法需第二条队列并搅动三轮复审的 pendingBackend 状态机。轻量替代（null 窗口禁用 media bar）备档。
- **gate1-M1/M2**：`LabContext.setBackend` 无消费者（plan 指定交付物）；dispose+recreate 四行 ×2 重复（样本量 2 不抽象）。
- **无网格**：no-WebGPU 机器强制 webgl2 无直接测试（spec §5 未列；与已测真 GPU 强制 webgl2 同一代码分支，环境不改其行为）。
- demo 无自动化测试（项目政策）；终审 M1（切换失败后 active 段短暂点名未装后端，横幅后面可见）+ M2（demo 联合拼写两处）留档。
- 附带：会话中 gstack 有可用升级（1.60.2.0 → 1.91.2.0），按纪律本轮未动，留用户决定。

## 自审记录

两关结论见下小节；全部发现的裁决理由与修法备档在 `.vibe/review-findings-ledger.md`（gitignored，供审查追溯）。

### CR 结论

**手段**：gstack /review 流水线审 `1f6f1bd..f3f7369` 全 21 提交——checklist 两遍（critical + informational）主审、4 specialist（security / performance / testing / maintainability）分派、Claude adversarial 对抗路（Codex not_installed，由 Claude subagent 承担）、>200 行触发 Red Team。SDD 执行期的逐 task 两段复审与终末全分支 review（final-review-2 APPROVED）在此前完成，其中 Task 6 的 C1+I2/I3 已于实现期整改（c6d3c17 + 06cb381）。

**各级发现数（gate 内合计 0C/8I）**：主审 critical pass **0**；security / performance specialist **零发现**（textContent/setAttribute 无 innerHTML 面、两信任边界 allowlist；publish 全仓 5 调用点皆生命周期事件、forced 单 await、零新依赖）；testing **1I**＝Task 5 M1 原样重发现（video 强制路径无测试以强制值执行，突变检验证实）；maintainability **2I**；adversarial **2I**（boot strip 的 replaceState 无守卫——抛出会吞掉横幅即唯一恢复载体；"costs nothing" 注释命题对 webgl2 为假）；red-team **3I**（video→video 重建丢播放态 / 重建窗口吞 source 点击 / 裸 `?` URL）。

**整改（3 提交，全部 typecheck+lint 亲跑绿）**：`08fab89` 修 ADV-1+ADV-2（adv-claude 复核**双条全闭合**：catch→横幅全程无抛点、命题收窄为真）；`176ef6d` 修 RT-3 裸 `?` + RT-1 头注释披露；`bfb2ecf` 按 adv-claude 复核把 RT-1 措辞改为严格读法（"restarts" 会被读成"重新播起来"，实际新元素 paused at t=0）。Red Team 截断尾部经书面确认无增量。库核三方互证守住：null-box 串行化、drain 先读后清、dispose 同步退订、auto 路径逐字节未动。

**轮数**：主审 1 轮（零发现）；specialist / adversarial / red-team 各 1 轮派发；整改后复核 1 轮闭环。INFORMATIONAL 修 4 / 记录 4，CRITICAL 始终为 0。

**无法清零项（4 条，逐条理由，台账有全文）**：
1. `video-viewer.ts:77` 强制路径无强制值测试（testing specialist 独立复核重发现）——非不修，**排期第 2 关**：effective-testing 整改轮落真值测试。
2. `context.ts:27` `LabContext.setBackend` 无消费者——plan Task 6 Step 1 指定交付物 + spec 复核在位，删除＝偏离已批形状；修法备档（联合收口时删字段或 hoist ctx 加 getBackend）。
3. `main.ts` dispose+recreate 四行重复 ×2——样本量 2 不抽象（Task 1 M1 同族先例），await/catch 不对称有意（fire-and-forget vs 传播）；第三处出现时提取 `recreate(source, failTitle)`。
4. RT-2 重建窗口吞 source 点击——与 I2/I3 的死键分清：瞬态吞没、再点即中、守卫系 1f6f1bd 原有；修法需第二条队列并引入与 `pendingBackend` 的排序交互，倍增已过三轮复审的状态机。轻量替代（null 窗口期禁用 media bar）记档备用。

SDD 期其余 Minor（终审 M1/M2、Task 1–7 各条）已在台账留档不重列；'Backend switch failed' 横幅标题为 spec §4.1 字面偏离，完成报告记 D 项交裁决。

### 测试质量结论

**手段**：effective-testing 审查清单全维度（维度 0 覆盖率前置 → 有效性 / 断言强度 / 负面路径 / 可维护性 → 反模式 A–F 强制扫描），对象＝本分支四个测试文件增量 + `support/viewer.ts` 工厂增量。单测分支覆盖 98.73%（阈值 90%）。

**发现（1 CRITICAL / 0 WARNING）**：C1＝video 入口强制路径零强制值执行（Task 5 M1，gate 1 testing specialist 独立复核重发现；反模式 D 形态——同一选项经两条公开入口平行存在、从未双向验证）。审查中判定**非缺陷**的三处：`not.toThrow` 属纯验证器契约本体，且与消息断言的拒绝孪生配对（杀 no-op 与过抛两类突变）；"forcing 'webgpu' pins" 不杀线程化突变系职责所限（钉选择语义；杀突变由 webgl2 强制 + 拒绝孪生承担）；`countNonBlack > 0` 弱于 litFraction 惯例（Task 4 M3 已裁足够）。

**整改（2 提交）**：`5b225c9` 落两半测试——真 GPU 项目 `videoViewer({backend:'webgl2'})` 断言 readback（选 'webgl2' 而非 'webgpu' 正是为了杀突变：本机 auto≡强制 webgpu，后者杀不了）；no-webgpu 项目 `FramelessVideoViewer.create({backend:'webgpu'})` 断言具名拒绝（丢参则回落 WebGL2 而 create 会 RESOLVE，反向击杀）。`938b56a` 顺手修 Task 5 M2 头注释精度（其触发条件"文件因其它原因被改动"本轮成立）。**突变检验双向闭环**：临时去掉 `valid.backend` → 恰好这两条命名测试各自失败（击杀信号＝命名失败测试，非退出码）；还原三重证明（行在 / diff 空 / 状态净）后 typecheck+lint+两文件全绿。修复后复审 0C/0W。

**覆盖陈述**（改动触及路径 × 测试网）：
- **有网**：类型与校验（constructor-validation：三成员+缺省+错成员+video 委托）；工厂分支（backend-factory 单测四臂，node 环境走真拒绝路径非 mock——`acquireDevice` 无 navigator.gpu 返 null、stub canvas 走 `WebGL2Backend.create` 真 null 分支）；两 viewer 线程化 image 双向（integration webgl2 等价 + no-webgpu 拒绝）、video 双向（本轮新增，突变证实）；auto/缺省逐字节等价（单测 'auto' 与缺省同消息 + integration auto 半边 + fallback 回落）；跨后端像素等价（≤4/255/通道）；lab demo 按项目政策无自动化测试，目检五项绿（见完成报告）。
- **无网及理由**：no-WebGPU 机器强制 webgl2——spec §5 测试计划未列，且与已测真 GPU 强制 webgl2 同一代码分支（`WebGL2Backend.create` 不查 WebGPU 可用性，环境不改其行为，落点在 no-webgpu 环境不可见）；`index.ts` 纯类型导出无运行时面；SDD 期已裁 Minor（M3 弱断言/M4 readonly 外观/M5 可选加强）维持留档不修。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
