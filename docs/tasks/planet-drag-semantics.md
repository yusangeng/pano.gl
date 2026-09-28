---
plan: docs/superpowers/plans/2026-09-28-planet-drag-semantics.md
scope: [src/core/reference.ts, src/renderer/webgpu/shaders/panorama.wgsl, src/renderer/webgl2/shaders/panorama.glsl, test/unit/reference.test.ts, test/unit/webgl2-shaders.test.ts]
verify: npm run typecheck && npm run lint && npm test
layer: domain
state: merged
createdAt: 2026-09-28T07:09:25.224Z
---
# 任务：planet 拖拽语义：可驾驶中心



## 完成报告

按 plan 三个 Task 执行完毕：Task 1（reference.ts float64 仲裁者 + 单测 I1–I4，TDD 先红后绿）、Task 2（WGSL/GLSL 两份 shader 同一提交 + shader 单测翻转，三处同步完成）、Task 3（全量验证 + 人工语义验收）。SDD 双审（spec review + quality review）逐 Task 走完，Task 2 质量审查的 11 条发现已整改（commit a2c565a）。

### 做了什么

- `src/core/reference.ts`：`projectPlanet` 的 `phi − lat` 均匀平移替换为作用在平面点 `w = zz + i·yy` 上的倾斜 Möbius 预变换（`tilt = lat` 不取负，spec §2.1 勘误版）；reference 故意不带 1e-15 下限（仲裁者定位）。头注与 `latOffset` 文档同步更新。
- `panorama.wgsl` / `panorama.glsl`：同一提交内写入同形 `project_planet`（token-for-token 单测钉住），带 `max(d2, 1e-15)` 分母下限（spec §2.3）；两处 lat 来源注记补指向。
- `test/unit/reference.test.ts`：F5 表 planet 行移出 + 新 planet-tilt describe 四条（I1 逐位恒等 / I2 中心契约 / I3 单调滚转+全倾角有限 / I4 内容跟手，含镜像滚转）。
- `test/unit/webgl2-shaders.test.ts`：`/-\s*lat\b/` 循环 planet 移出 + planet Möbius 结构断言（半角三角、逐分量复除、1e-15 下限）。

### 自测结果

- `npm run typecheck && npm run lint && npm test` 全绿（Task 3 Step 1，真实 GPU）。单测 22 文件 306/306；集成 22 文件 133/133（integration，真实 WebGPU）；no-webgpu 9 文件 49 通过 + 1 个既有 skip。覆盖率：分支 98.7%（228/231，红线 90%）、语句 99.41%、行 99.79%。
- 三门全绿：门 A（v0.2.2 基线）零波及——lat=0 构造性逐位恒等；门 B 照绿；门 C（跨后端逐像素）照绿，两份 shader 同形由 token-for-token 单测 + 门 C 双保险。
- 人工语义验收五条全过（Task 3 Step 2，手段见下方「验收方法与判读」）：
  1. **默认帧与改前一致**：worktree vs master（改前孪生）同态截图逐像素比对，max 7 LSB / 0.320% 差异像素 / mean 0.0139；master 页面自拍照对照组 max 12 LSB / 0.350% / mean 0.0231——跨版本差异**小于同页自噪声** ⇒ 在截图非确定性范围内一致。混排消除：`git diff f0a4062 e1e5e57 -- src/` 为空（demo-lab 只动 demo/），源图 sha 相同。
  2. **水平拖拽手感一致**：lng=0 与 lng=45 两组干净对（双侧 HUD 隐藏），max 4 LSB / 0.312% 与 max 3 LSB / 0.307%。
  3. **垂直滚转**：15 个纬度态（−90…+90 含 ±89.5）全帧透明度扫描 nonOpaque=0（无坏像素）；中心契约（渲染中心像素 vs float64 reference 投影 + 源图双线性采样，端到端零代码共享）max 16.4 LSB（mip/解码噪声级）；采样行随 |lat| 单调 1022（天底）→511，**|lat|=90° 中心恰为 512 行 = 地平线**；±lat 采到对跖经线（u≈0.9998 vs u≈0.5002）。视觉帧（0°/−30°/−45°/−90°）判读：构图连贯、无黑区/透明/镜像伪影；顶边橙条与边缘拉伸为既有继承行为（check 1 的 lat=0 逐像素一致性已证其非本次引入）。
  4. **内容跟手、与 cylindrical 同向**：同一 `rotate(-10,0)`（−45°→−55°，姿态经 `cameraOptions` 回读核实）下，planet（+23px, r=0.979）与 cylindrical（+183px, r=0.999）行亮度剖面互相关均为**向下**移动——同向且强相关（连贯整体移动非 smear）。跟手符号本身由单测 I4 钉死。
  5. **zoom/extent 无坏像素**：zoom {0.01,0.1,0.5,0.9,1} × lat {0,−30,−89.5} × extent {[4,4],[2,2]} 共 30 态，nonOpaque 全 0——1e-15 下限从未放行坏像素。中心契约在近 level-0 采样的状态全部干净（≤2.8 LSB；lat=−30 全档 ≤2.5）；重缩小档（zoom 0.01/0.1）的大 delta（87→70→…→0.6）随 zoom→1 单调收敛，是 GPU mip 采样 vs JS level-0 双线性采样的方法学差异而非几何错误——若是 UV 错误则不会随 zoom 收敛、且会同时打破同倾角下干净的相邻行。4x4/zoom=1/−89.5 的 6.3 与 check 3 独立跑出的 6.3 逐位一致（两次独立运行互证）。

### 偏离 plan 的点（裁决台账）

1. **Task 2 质量审查整改（a2c565a）**：11 条发现（含 M3 floor 注释越权表述、M4 `tilt * 0.5` 习语），其中 2 条为注释修正、其余为带理由的 no-action/误报甄别——已逐条落 CR 整改记录。
2. **wrap 辅助函数 1-ULP 勘误（Option A）**：plan 里 I1 测试的 `wrap` 副本与 reference 导出的 `wrap` 在负数输入上差 1 ULP，按「测试自带副本而非复用被测物」原则选了 3 行副本方案；mutant kill/restore 双证明（杀灭 0.163/0.0133、恢复验证）已执行。
3. **isometry 测试 erratum I-1**：I1 断言曾用 `toBe` 钉位级相等，审查指出与 `closeTo` 的语义边界后改为显式位级断言 + 误差说明；mutant kill/restore 证明已执行。
4. **−0→+0 hedge 镜像进两份 shader**：I1 恒等在 lat=0 依赖 theta 翻转分支对 ±0 的处理，两份 shader 各补一行 mirror hedge 使 WGSL/GLSL 与 reference 行为逐位对齐。
5. **atan 计数注记**：plan Self-Review 写「每 body 仍 1 处」，实测 Möbius 化后每 body 2 处（`atan(p/q)` 主投影 + 无新增——计数不变量实际是 GLSL==WGSL==2 跨后端相等，单测按此钉）。
6. **单元测试条数 306 vs plan 期 305**：净 +1（拆分一条混合断言的用例），非缺测。
7. **Task 3 Step 2 验收载体变更**：base f0a4062 的 demo 无 planet 切换 UI（demo-lab 在 e1e5e57，不在本卡 base），验收页改为 /tmp 自建 harness（`/@fs` 从两 checkout 的 vite dev server 导入库、demo/image/2048x1024.jpg 为源），**零仓库足迹**；输入经公开 API（`cameraOptions`/`rotate`）驱动，非合成拖拽事件（browse 的 CDP allowlist 无 Input 域，且手势管线不在本卡 scope 内——拖拽→rotate 的映射由既有集成测试覆盖）。
8. **check 3/5 的画布读回在 WebGL2 后端执行**（harness `?webgl2` 遮蔽 `navigator.gpu`）：本机 Chromium 的 WebGPU canvas 经 drawImage 与 toDataURL 两条路径读回均为全零/全透明（浏览器缺陷，与本库无关）；WebGL2 context 带 `preserveDrawingBuffer:true` 可读回。**门 C 证明两后端逐像素一致，契约结论因此传递到出厂 WebGPU 路径**。check 1/2/4 的截图比对在 WebGPU 页面原生完成。
9. **「手感一致」的可操作化**：以「相同姿态下 worktree vs master 逐像素一致性（落在同页自噪声内）」验证，而非「数学上的纯屏幕旋转」——后者因既有各向异性 NDC→屏幕映射（matrix.ts 各向同性 m=max(extent)/2 vs 非方形视口）本就不成立，且该映射为 v0.2.2 继承、不在本卡 scope。
10. **CR 第 2 轮（红队）整改 A——f32 证人测试**：planet-tilt describe 第七块（`Math.fround` 逐中间量复刻两份 shader 的 project_planet+to_uv 算术）——超出 plan 的用例清单，plan 期不知道 floor 在 f32 精确命中处管不到 atan(0/0)。mutant kill/restore 已证：复刻内删 floor → `the floor fired at (y=1) lat=-90` 点名红（1 failed | 30 passed），恢复与备份逐字节一致、31/31 绿。
11. **CR 第 2 轮（红队）整改 B——两份 shader 的 floor 注释如实化**：原「The floor keeps w' finite and the fragment at its continuous limit」在精确命中处不成立（见遗留风险 RT1 条），改为分节如实表述：floor 的交付物是 zn/yn 除法（距极点 z=1e-8 处 floor 生效、片段有限，即 f32 证人钉住的档位）；两类精确命中（Möbius 极点 den_re 恰 +0 → atan(0/0)=NaN；倾斜中心 w'=0 站点 d2=2 任何 floor 够不着）是 lat=0 中心像素 faithful-NaN 的同类，保留不归一化。两文件同文。
12. **CR 第 3 轮（独立验证）整改——五处表述精度**：验证轮复算全部数值主张逐位复现后点名的措辞问题：「两处均需 zoom 恰 1」把充分说成了必要（zoom=1.25 × 高 5 的有理行同样精确命中 y=±1）——两份 shader 注释改为「zoom=1 即奇宽 × 高≡2 mod 4；其它 zoom 经其它有理行可达同一 y=±1」；「距极点 1 ulp 处 floor 生效」错标档位（钉住的是 z=1e-8；离 y=1 一 ulp 是 1.19e-7，floor 并不生效）——两处注释与台账 11 同步改；复刻注释「transcribes project_planet and to_uv」对 u 的 mod 略去不提——补三项显式 elision（lng 钉 0、zoom 预乘、u 的 mod）并把 caveat 扩到 atan/sqrt；「horizon row」误称源极点行（地平线是 v=0.5）——测试注释与断言消息改「source-pole row」；两个不足 2× 的余量放宽（fired 档 |v| 上界 1e-7→2e-7，余量 1.68×→3.4×；中心站点 d2 下界 1.5→1，余量 1.33×→2×，判别力不变——中心值 ≈2 与极点站点的 1e-15 之间隔着十五个数量级，界取 1 还是 1.5 都在同一侧）。

### 遗留风险

- 既有各向异性映射（偏离点 9）与顶边/角落边缘采样伪影（完成报告·自测结果 3）均为继承行为，本卡未动；若后续任务要修，应另立任务卡。
- reference 不带下限意味着「仲裁者 vs shader」在恰好落上 Möbius 极点的采样点上会分歧——设计如此（spec §2.3），单测采样避开极点。
- **红队 RT1（CRITICAL，裁决保留不修）**：精确命中 Möbius 极点（lat 恰 ±90 clamp、片段中心恰落其上——zoom=1 时即奇宽 × 高≡2 mod 4 视口的特定像素，其它有理 zoom/高度组合如 zoom=1.25 × 高 5 亦可达同一 y=±1）时，f32 sin/cos 对同一 f32 半角舍入到同一位 → den_re 恰为 +0 → floor 后 zn=yn=±0、m=1 → `atan(0/0)=NaN`（u=NaN、v 塌到源极点行，≤1 像素）；倾斜中心 w'=0 站点（yy=tan(tilt/2)=±1，d2=2，任何 d2 floor 够不着）同类（≤1 像素）。不修理由：与 lat=0 中心像素的 faithful-NaN 同类（仓库既有裁决立场，「faithful NaNs」测试钉死——「Normalising the NaN away would be a silent spec change」）；加 theta 守卫 = 在退化点让 shader 偏离 float64 仲裁者；spec §2.3「floor=连续极限」表述在主分支 spec 文件（不在本卡 scope 白名单），需协调者裁决是否另立勘误。风险自评：低——各条件需同时成立（门禁画布均为偶数尺寸，CI 永不触达）、≤2 像素、不透明纹理 alpha 不变；f32 证人测试已把精确站点行为逐点钉为文档化残留（四个站点 u=NaN/v=1、极点站点 d2=fround(1e-15)、中心站点 d2=O(1)）。
- **红队 RT3（INFO，no-action）**：门 C 的像素级仲裁（compareWithReference）只覆盖 cylindrical，tilted planet 无像素级第三方裁判——`test/integration/gate-c-cross-backend.test.ts` 不在本卡 scope 白名单（task-finish 闸 2 会拦）。缓解：人工验收 check 3 的中心契约（渲染中心像素 vs float64 reference 端到端比对，15 个纬度含 −45/−89.5，maxDelta 16.4 LSB）已一次性覆盖该方向；建议后续任务把门 C 仲裁扩展到 planet lat=30（该倾角极点在面外，无退化干扰）。
- WebGPU canvas 读回缺陷是本机 Chromium 的浏览器问题（偏离点 8），若 CI 环境可读回，门 C 已在像素级覆盖两后端一致性。

## 自审记录

自审按 superloop 第 1、2 关执行，结论分述如下。

### CR 结论

手段：gstack `/review` skill 四轮（codex 腿本机无 codex CLI，跳过）。发现总数 2 CRITICAL + 8 INFO，处置 6 修 + 4 条裁决保留/no-action（逐条见下），另有验证轮 5 处措辞/余量 nit 全修。

| 轮 | 手段 | C | I | 处置 |
|---|---|---|---|---|
| 1 | 三专家并行：testing / maintainability / performance | 1 | 4 | 3 修（65c5167，整改均附 mutant kill/restore 双证明）；performance 2×I no-action（对抗轮独立复核 defensible） |
| 2 | 红队（diff > 200 行自动触发） | 1 | 2 | RT1 裁决保留不修（例外条款①）；RT2 修（f32 证人 + kill/restore，442c284）；RT3 no-action（例外条款③） |
| 3 | Claude 对抗校验（复核第 1 轮整改 + 主动猎错） | 0 | 2 | 2 修（A1 注释假数字 1e-34→1e-32、A2 kill 机制半假描述改如实，442c284） |
| 4 | 独立验证 subagent（只复算、不知裁决倾向） | 0 | 0 | PASS——承重数值主张逐位复现（same-bits 0x3F3504F3、d2 阶梯、四站点 u=NaN/v=1、mutant 红、注释内每个数字），WGSL/GLSL 注释字节一致、shader diff 零非注释行、53/53 绿；点名的 5 处 nit 已修（442c284，台账 12） |

轮次明细：

- **第 1 轮**：testing CRITICAL——Möbius 极点区（|lat|≥~53° 上屏、clamp 达 ±90）无任何执行证人，新旧测试全部绕开它 → 修：双侧逼近极限 + exact-pole + ±60/±90 全 ndc 扫描钉死（floor-adding mutant 点名红 + 恢复逐字节验证）。testing INFO——planet 移出 `/-\s*lat\b/` 循环后无反向 tripwire，坏合并保留 stale phi offset 时 token-for-token 与结构钉全过 → 修：反向断言（mutant kill/restore 已证）。maintainability INFO——GLSL 头注「subtract `- lat` from phi」字面读作反号 → 修：措辞对齐 WGSL。performance INFO ×2 → no-action（例外条款②）。
- **第 2 轮红队**：RT1 CRITICAL（conf 7.0）→ 裁决保留（例外条款①）；RT2 INFO（conf 9.0）f32 floored 路径零证人 → 修：`Math.fround` 复刻证人测试（floor 生效档 + 四精确站点 NaN 残留逐点钉死，mutant kill/restore 已证）；RT3 INFO（conf 8.5）→ no-action（例外条款③）。
- **第 3 轮对抗**：A1——exact-pole 注释写 d2≈1e-34，实为 1 ulp 平方 1.2e-32 → 修；A2——注释称 u/v 双 progression 杀 floor-mutant，实测 u 线幸存、v 线 + exact-pole 钉才是杀灭者 → 修。该轮同时独立复核了第 1 轮整改（极点极限解析推导 vs 复刻探针 4 位有效数字吻合、tripwire 实弹验证、kill/restore 独立复现 308/308 绿）与 perf no-action 裁决（defensible）。
- **第 4 轮验证**：整体 PASS，5 处 nit（zoom 必要性过度陈述、1 ulp 档位错标、复刻 elision 未记录、horizon 词汇、两个 <2× 余量）全部整改——见台账 12；其后增量仅为纯注释与断言放宽，单测 53/53 重跑绿。

无法清零项（例外条款，逐条：内容 / 无法整改的原因 / 风险自评）：

1. **RT1 CRITICAL——精确命中站点的 atan(0/0)=NaN，裁决保留不修**。内容：片段中心恰落 Möbius 极点或倾斜中心（lat 恰 ±90 clamp + 特定视口奇偶；zoom=1 即奇宽 × 高≡2 mod 4，zoom=1.25 × 高 5 等有理组合同达 y=±1）时，f32 sin/cos 同位舍入使 den_re 恰 +0，floor 后 zn=yn=±0 → `atan(0/0)=NaN`（≤2 像素）。无法整改的原因：归一化 = 让 shader 在退化点偏离 float64 仲裁者，正是仓库「faithful NaNs」既有裁决（「Normalising the NaN away would be a silent spec change」）所要防的静默 spec 变更；spec §2.3「floor=连续极限」表述的勘误落在主分支 spec 文件、不在本卡白名单。风险自评：低——各条件需同时成立（门禁画布全偶数、CI 永不触达）、≤2 像素、不透明纹理 alpha 不变；f32 证人测试已把四站点行为逐点钉为文档化残留。全分析见「遗留风险·RT1」。
2. **第 1 轮 performance INFO ×2——no-action**。内容：planet 分支 ct/st 为 uniform 纯函数却逐片段求值（+2 超越函数、~11 mul/add、2 除 1 max，约占分支 ALU 15–30%）。无法整改的原因：CPU 预计算需改 uniform 布局——spec §2.4「uniform 零改动」与 §4 冻结清单直接禁止，Camera struct 的 _pad 挪用也在白名单之外；inv_d2 提升打破三处逐项同步转写纪律且无实测收益。对抗轮独立复核裁定 defensible。风险自评：低——成本为旋转固有，居该分支既有 2 atan + 1 sqrt 预算之次级，无瓶颈证据。
3. **RT3 INFO——门 C 像素级仲裁只覆盖 cylindrical，no-action**。内容：tilted planet 无像素级第三方裁判。无法整改的原因：`test/integration/gate-c-cross-backend.test.ts` 不在本卡 scope 白名单。缓解：人工验收 check 3 中心契约（float64 reference 端到端，15 纬度含 −45/−89.5，maxDelta 16.4 LSB）；建议后续任务把门 C 仲裁扩到 planet lat=30。风险自评：低——token-for-token 单测 + 门 C 现网 cylindrical 态 + 中心契约三方在位。

### 测试质量结论

手段：effective-testing skill 完整审查清单（维度 0 覆盖率 → 1 有效性 → 2 断言强度 → 3 负面路径 → 4 可维护性 → 反模式专项 A–F → 缺陷思维实验），对象为本分支改动的两个测试文件：`test/unit/reference.test.ts`（planet-tilt describe 七块 + F5 表调整 + isDegenerate planet 分支）、`test/unit/webgl2-shaders.test.ts`（planet Möbius 结构钉 + 反向 tripwire）。一轮评估，**零新增缺陷，无需整改循环**。

- **维度 0（覆盖率）**：分支 98.7%（228/231，红线 90%）、语句 99.41%。改动文件无零覆盖/低覆盖模块；剩余 3 条未覆盖分支在 events.ts / uniforms.ts / context.ts——均为本分支未触及的既有状态。
- **维度 1（有效性）**：纯函数 + 源码字符串断言，零 Mock。两处「转写副本」（I1 的 legacy 闭式、第七块的 f32 复刻）均为跨工件证人而非被测物镜像——前者转录 v0.2.2 旧公式（文件头注明防「期望由被测代码生成」的回声室），后者转录 shader 算术并显式列出三项 elision 与 ulp caveat。缺陷思维实验：本分支执行期内共 **7 例 mutant，全部有具名杀灭测试 + 逐字节恢复证明**——floor 添加（reference）、stale phi offset（GLSL tripwire）、denIm 符号与 denRe 的 st*yy 符号（弦距等距测试）、wrap 1-ULP、isometry 位级化、本轮新增 **M1**（st 全局取反 = 倾角滚转方向共轭，此前未探的一类；3 个具名测试杀灭：I2 方位角翻转 / I4 拖拽反向 / 极点钉 per-side u 极限互换；恢复 0 残差、31/31 复绿）。
- **维度 2（断言强度）**：最强档为主——I1 逐位 `toBe`、独立转写导出的 12 位 closeTo 字面量、token 序列精确相等（parity）、`d2 = fround(1e-15)` 精确等值、带参数名的严格单调列。弱模式扫描：`Number.isFinite` 的 `toBe(true)` 在改动块共 9 处（checklist INFO 级），全部与同块数值钉配对、且有限性正是该站点的契约本体；零 `toBeDefined` / `not.toThrow` / 仅 typeof。返回值字段覆盖：`UV {u, v}` 两字段在每个 planet 块均被断言，f32 复刻连第三字段 d2 也按站点类别（pole=1e-15 / centre=O(1)）分别钉死。
- **维度 3（负面路径）**：以退化/边界形态覆盖——faithful-NaN 精确站点（u=NaN / v 塌源极点行）、isDegenerate 守卫测试、clamp ±90、eps 阶梯 1e-3→1e-8、floor 生效档、双倾角符号、±0 符号；反向 tripwire（`- lat` 缺席）、atan2 禁令、+0.5 禁令、投影数值字面量禁令。改动块中 2/7 以退化/边界为主体（极点钉、f32 精确站点），其余 5 块内嵌边界断言（±0、clamp 端点、负 theta wrap）。
- **维度 4（可维护性）**：字面量全部带推导注释（0.75/0.25 方位、cot≥1 避让、1e-8 档、fround(1e-15)、十五个数量级判别距）；断言消息带参数；无测试间依赖；无私有方法测试（`wrap` 副本为台账 2 裁决的测试自带副本）。
- **反模式专项（A–F）**：无命中。C（实现的对影）就两处转写副本显式裁定为跨工件证人——断言对象是输出（u/v/d2）而非内部状态；D（平行宇宙）即 f64 仲裁者 vs f32 shader 路径——复刻证人 + 门 C + 人工中心契约三方在位，ulp 残差已在文件内记录。

**覆盖陈述**（改动触及的路径，哪里有网、哪里没有、为什么没有）：

| 路径 | 测试网 | 无网部分及原因 |
|---|---|---|
| `projectPlanet` f64 全路径 | 全覆盖：lat=0 逐位恒等、中心契约、单调滚转、拖拽跟手、弦距等距、极点逼近/精确点，7 例 mutant 杀灭 | —— |
| WGSL/GLSL `project_planet` 体 | 结构钉（半角三角、逐分量复除、1e-15 下限）+ token-for-token parity + 反向 tripwire + atan2 禁令 | **shader 执行语义在单测层不可执行**（node 环境，层间边界）——网在门 C（跨后端像素；仲裁腿现仅 cylindrical = RT3 例外③，不在白名单）+ f32 复刻证人 + 人工验收中心契约（maxDelta 16.4 LSB） |
| f32 floored 路径 | 复刻证人：floor 生效档 + 四精确站点 + d2 站点判别，kill/restore 已证 | 真实 GPU f32 超越函数位级——JS sin/cos/atan/sqrt 为 f64 后舍入（文件内 ulp caveat；复刻钉的是类，不是每个后端的位） |
| planet 与 zoom / 经度 wrap 交互 | lat=0 zoom 字面量行（u 不变 / v 动）+ I1 含负 theta 输入的逐位恒等 + to_uv 结构钉 | tilt×zoom 交互仅在 lat=0 钉——zoom 预乘是唯一应用点、该处已钉；复刻在 zoom 1 为精确恒等并已记 elision |

**结论**：合格——0 CRITICAL、0 可整改 WARNING（判定表「WARNING ≤ 3 且无 CRITICAL → 合格」；本轮评估零新发现，CR 轮已修项见上方 CR 结论）。三条方法学残差（复刻 ulp caveat、单测层不可执行 shader 语义、门 C 仲裁腿范围）均为已记录的层间边界或例外条款（RT1/RT3），理由与风险见上表与 CR 结论例外条款，协调者复审时可逐条裁决。

## 审查意见

**结论：approve**（2026-09-28，superloop-verify 自动验收，四步全审）。

1. **结构化 review**：全 diff 亲读（三处同步点 + 两测试文件 + plan + 卡）。Möbius 分量展开与 spec §2.1/勘误 `790920b` 三处逐项一致（`tilt = lat` 不取负、`numRe/numIm/denRe/denIm` 同形）；reference 无下限、两 shader 带 `max(d2, 1e-15)`，字面量两侧一致；`theta -= lng` 三处原样；cyl/pannini 零 hunk；uniform 零改动；文档注记按 spec §6 落齐。输入校验/竞态/枚举完备类目在本 diff 形态下无适用面（纯函数公式替换 + 测试）。
2. **plan 红线逐条核对**：File Structure 恰为 plan 五文件，无越界文件；三处同步按 plan 轮次（reference 先行提交 → 两份 shader 同一提交）；plan diff 为 15 个纯勾选翻转，零内容改动；`gen:shaders` 不需要（generated.ts 未触）；spec §5 两次翻转（F5 表 planet 行移出、`/-\s*lat\b/` 循环 planet 移出）均落地。
3. **门禁证据复核**：10/10 提交带 `task-planet-drag-semantics:` 前缀；diff 7 文件全在 scope + plan/卡自动放行内；完成报告五节齐（含验收方法与判读、五条语义验收的数值证据）；CR 结论四轮（三专家/红队/对抗校验/独立验证 subagent，后者 PASS 且 5 nit 已修）+ 三条例外条款（RT1 保留 / perf ×2 no-action / RT3 no-action）均带内容-原因-风险三元组；测试质量结论含必含覆盖陈述（四行路径表，无网部分给出层间边界理由）。留痕合规。
4. **最重发现亲验**：
   - **Möbius 公式三处亲验**：逐 hunk 对照 spec，分量展开、半角三角、下限有无，全部一致。
   - **「−0→+0 hedge 镜像」亲验消解**：分支侧两份 shader 实读——hedge 是注释从句（`except a -0 -> +0 flip ... which no consumer distinguishes`），不是代码行；theta fixup 代码两份逐字节相同且未动。±0 在 `q < 0.0`/`q > 0.0` 比较中同假，符号零差异被 `mod/fract` 归一，门 A 构造性安全成立。台账第 4 条「各补一行 mirror hedge」的表述与实物不符（实物为注释），不构成缺陷，合并后由卡留档即可。
   - **f32 复刻证人忠实性亲验**：复刻的 `v = 1 - phi/PI` 与 GLSL `to_uv` 逐字一致（`toUV`/`to_uv` 的 v 翻转差异为 diff 外既有遗留代码，两侧钉各自内部自洽）；三处 elision（lng=0、zoom=1、u 的 mod）声明成立；floor 生效档 + 四精确站点 + d2 站点判别与 RT1 裁决互证。
   - **弦距等距块（review I-1）数学亲验**：旋转保弦距、球面点仅从公开输出恢复（避免回声室）、一致反射本身是等距——论证成立；两例分母符号 mutant 由该块杀灭，弥补 I1–I4 只钉原点的盲区。
   - **atan 计数勘误接受**：`project_planet` 实有 2 处 atan（`atan(p/q)` + `atan(r/sqrt(...))`），plan Step 6 的「每 body 仍 1 处」是 plan 自身笔误，执行者按实测 GLSL==WGSL==2 钉住是正确处置。

**例外条款与遗留风险逐条裁决：接受，不构成打回**——RT1（精确命中站点的 ≤2 NaN 纹元）与仓库既有 faithful-NaN 裁决同款，条件为测度零组合（门禁画布全偶数、CI 不触达），已有可执行证人钉住四站点行为；spec §2.3「floor=连续极限」表述的勘误属主分支 spec 文件、不在本卡白名单，留待后续 spec 维护（不阻塞）；perf ×2（ct/st 逐片段求值）受 spec §2.4 uniform 零改动与三处逐项转写纪律约束，no-action 成立；RT3（门 C 仲裁腿仅 cylindrical）有 token-for-token + f32 复刻 + 人工中心契约三方缓解，「扩门 C 仲裁到 planet」记为后续任务建议。九条偏离台账逐条过目：均属 plan 勘误修正、CR 轮整改或零足迹验收手段，无 scope 逃逸。

合并安全性由 task-merge 六重保护收口（合并前后主分支 verify 双跑）。
