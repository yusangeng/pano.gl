---
plan: docs/superpowers/plans/2026-09-28-planet-exact-hit-nan.md
scope: [src/renderer/webgpu/shaders/panorama.wgsl, src/renderer/webgl2/shaders/panorama.glsl, src/core/reference.ts, test/unit/reference.test.ts, test/unit/webgl2-shaders.test.ts, docs/superpowers/specs/*.md]
verify: npm run build && npm test
layer: domain
state: reported
createdAt: 2026-09-28T15:49:02.168Z
---
# 任务：planet 分支点规范值：三处同规消除 atan(0/0)=NaN



## 完成报告

**做了什么**

- 三处同规落地分支点规范值守卫（2026-09-28 planet-review-followups spec §2.1–2.2）：`src/core/reference.ts` 的 `projectPlanet`、`src/renderer/webgpu/shaders/panorama.wgsl` 与 `src/renderer/webgl2/shaders/panorama.glsl` 的 `project_planet`——`p = q = 0` 时 `theta = 1.5 * PI`，phi 按零因子侧取 `PI`（分母为零因子的 Möbius 极点站点）或 `0`（分子为零因子的 lat 0 中心与倾斜中心站点）；`theta -= lng` 移到守卫之后，规范 theta 与普通片元一样接受经度旋转。三处语句形式逐字一致（两 shader 间由 token-for-token 奇偶校验测试钉住）。
- 测试翻转与加固：`reference.test.ts` 新增 canonical 值钉测（中心 0.75/0、lng=90 → 0.5 钉住语句顺序、四个 B 类站点 float64 伪影钉测含 −0 载荷注释）；faithful-NaN 钉测删除 planet 行、planet 离开 `isDegenerate`；f32 证人转录守卫并把精确站点钉从 NaN 翻到 0.75 / 按站点 v，新增 lat 0 中心 f32 块；`webgl2-shaders.test.ts` 新增守卫结构钉（五个存在性钉 + 质量审增补的有序钉：守卫加尾段整体单串比较，杀死两类变异幸存者——phi 臂互换 / `theta -= lng` 上提，即双 shader 同改时奇偶校验对称性无法拦截的编辑类）。
- 旧 spec 勘误：planet-drag-semantics spec §2.3 追加 2026-09-28 二次勘误——精确分支点处「极限值连续」不成立，phi 极限按站点分侧；引用 followups spec §2.1–2.2 的规范值裁决。

**自测结果**

- `npm run typecheck`（三程序）通过；`npm run lint` 通过。
- `npm run build` 通过（dist ESM + CJS + .d.ts）。
- `npm test` 通过：unit 22 文件 311/311；integration + no-webgpu 31 文件 183 通过 / 1 跳过（环境条件跳过，本分支未改任何集成测试文件）。门 A/B/C 全绿、零基线变化——门画布全偶尺寸，守卫在门下永不触发，与 plan 预期一致。

**偏离 plan 的点**（均已当轮裁决）

1. Task 1 伪影表首行 `[1, -90, 0, 1]` 落地为 `−0`：极点站点经 zz=−0 使 theta 保持 −0（toBe 即 Object.is，区分符号零）——plan 撰写期测量笔误，测试内已入 4 行 −0 注释。
2. Task 2 质量审 F1 增补有序钉（plan Step 1 原文只有五个存在性钉）：变异测试发现 M3b（phi 臂互换）/ M4（`theta -= lng` 上提）两类幸存者各通过全部 311 单测，有序钉是唯一拦截网（复验：各恰被一个命名断言杀死）。
3. Task 2 质量审 F2 改写 f32 证人的省略清单注释（4 行换 3 行，纯注释）。
4. Task 3 勘误引用内 `r → 1, phi → π` 半角逗号修正为全角 `r → 1，phi → π`（一字，8af1773）：plan 撰写期笔误，修正后引用与被引原文精确 grep 匹配。
5. Task 1 质量审三处注释修正（26f67ea，纯注释 +12/−3）。

**遗留风险**

- 无功能性遗留。记录性事实：规范值是对 v0.2.2 忠实 NaN 立场的用户裁决偏离（代码注释、测试注释与两份 spec 三处声明）；f32 证人的精确命中行为是 JS 舍入真值，后端 f32 超越函数可能差一 ulp（证人注释已声明该边界，文档类而非逐位承诺）；门画布偶尺寸使守卫在门下永不触发，守卫正确性由单测网（结构钉 + 有序钉 + f32 证人 + float64 钉测）承载。

## 自审记录

按契约第 1、2 关填写；CR 与测试质量结论均已闭环（各见下节）。

### CR 结论

- **手段**：gstack review 三专科（testing / maintainability / adversarial）+ 红队独立复算（含盲区排查与组件级数值复验；codex 未安装，adversarial 关以 informational 记录，source: claude）。
- **发现**：CRITICAL 1 —— T1：守卫拓宽为 `q === 0` 单条件可活过全部 311 个单测与所有门（多 conjunct 精确零守卫缺 per-conjunct 不触发钉）；INFORMATIONAL 5 —— M1/M2/A1/A2/A3，均为注释/文档准确性缺陷（firing-set 表述、离差计数、残留机制表述）。红队独立复算六条全部确认，零新增发现。
- **整改**：fc76606 补两枚离站点钉（axisPos.v `toBeCloseTo(…,12)`、axisNeg.u `toBe`——(π/2)/2π 逐位精确；变异复验 1 failed / 31 passed）；54f4446 修 reference.ts 头部/守卫注释与测试注释的陈旧表述；红队指出 54f4446 有两处未随改——两 shader 的 "always the lat = 0 centre" 低枚举 gloss（lat-30 倾斜中心亦逐位消零触发，实测 u=0.75/v=0）与 canonical 测试伪影表注释的 "num and den stay nonzero"（组件级为假：numRe 为 −0、denIm 为 ±0，保 q 非零的是 numIm 与 denRe，p 恰为 ±0）——06defd4 补齐，组件断言先经 esbuild 转译的 projectPlanet 数值复验再落笔。
- **轮数**：1 轮 review → 整改 → 红队复核；六条全清零。
- **记录在案（超出本卡 scope，留协调者裁决）**：① CLAUDE.md「one adjudicated exception: lngOffset」段落已过时——现为三处 adjudicated 偏离（lngOffset、latOffset/F5、planet 分支点规范值）；② plan 文件（docs/superpowers/plans/2026-09-28-planet-exact-hit-nan.md:78,130）仍带修正前措辞，plans 不在 scope 白名单，按历史文档保留。

### 测试质量结论

- **手段**：effective-testing 评估（独立评估者会话）审本分支改动的测试（reference.test.ts planet-tilt describe 全部新增块、webgl2-shaders.test.ts planet 结构钉），两轮：初评 → 整改 → 复评清零。评估者独立执行变异复核，非复述本方声明：q===0 拓宽变异带钉后恰 1 failed / 310 passed，且拔掉 v 侧钉后失败翻到 u 侧（两钉各杀一侧）；phi 臂互换变异唯一死于有序钉。
- **发现**：CRITICAL 0 / WARNING 0 / INFORMATIONAL 3 —— INFO 1 五枚存在性钉被有序钉整体包含（诊断价值未注明）；INFO 2 reference.ts:258 float64 `phi = PI` 字面量行为不可钉（该假路径是 reference.ts 唯一未覆盖分支）；INFO 3 伪影注释 "0 or 1/2 a turn" 可误读为距离主张（自 0.75 的圆距实为 1/4 与 3/4 转；正确为位置主张）。INFO 3 后无任何后续发现。
- **整改**：INFO 1 / INFO 3 注释改写清零（1da82bb，纯注释；INFO 3 改为位置主张——每伪影 u 恰为 0 或 0.5，即 0.25/0.75 单侧极限间半周转跳变的中点位置）。INFO 2 记为按设计接受，理由三条并经复评逐条核实：① float64 下守卫仅在分子整零的精确倾斜中心命中处触发，假路径按构造不可达（覆盖率佐证：该行即全文件唯一未覆盖分支）；② phi 判别式的两份 shader 拷贝由存在性钉 + 有序钉可执行钉住（臂互换变异已执行验证）；③ 判别式活性行为由 f32 证人块见证（极点站 phi=π、中心站 phi=0），即使三处同换亦有具名测试失败。剩余风险：reference.ts 的该字面量单独无行为网——评估者初评即评为 INFO/"not required" to harden，复评裁定接受成立。整改后单测 311/311（评估者在 worktree 独立重跑确认）。
- **覆盖陈述**（评估者 verbatim）：
  > "Every path this branch touched has an executable unit net: the float64 guard's firing set (A-class centre, bit-exact u/v plus the lng=90 ordering variant), its non-firing set (both conjuncts off-site, and the four B-class one-ulp artifacts pinned per-site against the spec's measured table), the f32 floored arithmetic at all five branch points plus the floor's firing (u, v, d2 per site, in the witness), and the shaders' guard structure, arm order, and position (presence pins + ordered single-string pin + token-for-token parity, with the WGSL held through parity and the GLSL pinned directly -- one-file-only edits of either kind fail). Coverage after the change is 98.32% branch overall (gate: 90%); reference.ts sits at 100% statements / 96.87% branch with exactly one uncovered branch -- line 258's false path, the float64-dead phi = PI arm, unobservable at every f64-reachable input by construction, recorded as accepted-by-design, and pinned in its shader counterparts. The integration gates deliberately cannot exercise the guard (all-even canvases never rasterise a measure-zero texel, per spec 2.3, so baselines are unchanged by design), which is precisely why the unit-level witness and structural pins are the complete net here -- and they are."

## 审查意见

（协调者填：逐条编号；通过则写 approve）
