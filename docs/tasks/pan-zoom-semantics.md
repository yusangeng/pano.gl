---
plan: docs/superpowers/plans/2026-09-23-pan-zoom-semantics.md
scope: [src/core/reference.ts, src/renderer/webgpu/shaders/panorama.wgsl, src/renderer/webgl2/shaders/panorama.glsl, src/viewer/camera-controller.ts, src/viewer/viewer.ts, test/**, CLAUDE.md]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: foundation
deps: [p6-webgl2-backend]
state: reported
createdAt: 2026-09-23T09:00:57.224Z
---
# 任务：pan 手感与 zoom 语义修正：lng 诚实换算 / zoom 方向 / linear fov zoom

开工先通读 plan「背景」节：C2 方向链三步推论、/4 考古、负分母陷阱、门 A 已测定零改动，全在里面。纪律：①红网先行——Task 1 全部用例在带缺陷树上跑出具名红并记录后才动 src，测试与修复同一提交；②lng 公式 wgsl/glsl/reference 三处同一提交改齐（门 C 红线），三处注释互指一致；③gen:shaders 管线不碰，src/renderer/shaders/generated.ts 不得进本卡 diff；④不动 src/interaction/ 与 src/index.ts，US5 与 no-webgpu project 零 diff；⑤完成报告受检节标题下先放一行正文再接 ### 子节，否则 task-finish 闸 1 会误报未填（superloop 已知缺陷）。无本地环境依赖，无需 bootstrap。

## 完成报告

三行为变更（C1 经度诚实换算 / C2 zoom 方向 / C3 linear fov zoom）已全部落地并收口：修复与红网同一提交（eb56504），评审整改以纯注释提交补齐（d25549c），门 A 零改动验证、verify 六连与三体变异抽查（Task 3）由本报告登记在案。

### 做了什么

- **Task 1+2（eb56504，测试与修复同一提交）**：红网先行——unit `camera-controller` 翻转四条新增两条、unit `reference` pins 六条按 `lng = povLongitude * PI / 180` 重算、US2 两条翻转、photo 新增 quarter-shift 红 网（`a 90° pose turns the picture by exactly a quarter of its width`）与 360° 往返绿钉；修复同提交落齐——C1 三处同步（`panorama.wgsl` / `panorama.glsl` / `reference.ts`，注释互指 pan-zoom-semantics spec）、C2 `zoom()` 统一为 `param / max(1 + delta, EPSILON)` 两路 clamp、C3 linear 以 fov 落地（`MIN_FOV`/`MAX_FOV` = [15°, 110°]）；`viewer.ts` TSDoc 与 CLAUDE.md 仲裁节同步改述。具名红记录见 plan Task 1 Step 5（已在带缺陷树上逐条跑出）。
- **d25549c（评审整改，纯注释提交）**：glsl 幅度量级 29 → 45/PI ≈ 14.3；`gestures.ts` `wheel()` TSDoc 方向改正（滚下才是 ceiling no-op）；photo 测试两处注释精确化。无行为行改动。
- **Task 3（本步，验证+登记，零行为改动）**：门 A 亲跑全绿并在 `comparableStates` 注释块登记 lng≠0 有意分歧；基线族零 diff 核验；verify 六连当面跑全绿；三体变异抽查具名击杀、还原 sha 双向核对；卡面登记 + plan 勾选。
- **3742d6d（第 2 关测试质量整改，纯测试增补）**：quarter-shift 网加 1:1 读回内容守卫（`countNonBlack(home) > 0`，堵「两条空白读回使 worst=0 空洞地绿」）；clamp 测试加 planet 臂钉统一 clamp [0.01, 1] 两端点（堵「恢复 per-kind 旧 clamp 不红任何测试」——复审机械验证：恢复 planet 旧域 [0.1, 2] 会使两条断言双红）。两处编辑出自实现 agent（pz-impl-task1），其限额中断后验证与提交由协调者完成（photo 12/12 双 project、camera-controller 35/35、typecheck、lint 全绿），复审确认 RESOLVED。

### 红网证据与自测结果

**verify 六连（2026-09-23，当面跑）**：

| 命令 | 结果 |
|---|---|
| `gen:shaders -- --check` | up to date（生成管线未触碰） |
| `typecheck` | 三个 program 全绿（root / integration / scripts） |
| `lint` | 绿 |
| `test:coverage` | 22 文件 / 301 用例绿；statements 99.4%（504/507）、branches 98.7%（228/231）、functions 98.95%（95/96）、lines 99.78%（466/467），四门槛（≥90%）全过 |
| `test:integration` | 28 文件 / 170 用例绿（integration + no-webgpu 双 project）；门 B+C 复跑具名 22/22 绿；no-webgpu 单独复跑 38/38 绿 |
| `build` | dist/index.js 127.61 kB / dist/index.cjs 127.84 kB 构建成功 |

**变异抽查（沙箱 = `git archive HEAD`（d25549c）解 /tmp + 软链 node_modules；锚点 `grep -c` 恰好 1；落刀前后 touched/sentinel 文件 sha 与 `git show HEAD:<path>` 双向核对相符；沙箱已清理）**：

| 变异体 | 具名击杀（报告 status=failed） | 负对照（预测不红者实测不红） |
|---|---|---|
| M1：lng 加回 `/4`（仅 wgsl 一处） | **门 C** 10/18 红——cylindrical/planet/pannini 各 state 1-3 共 9 条 cross-backend 像素比对 + arbiter 条全红；photo `a 90° pose turns the picture by exactly a quarter of its width` 红（12 条中唯一红） | photo `a full 360° turn … returns to the picture it started from` 绿（公式盲绿钉）；unit reference 25/25 绿（pins 测 CPU 侧） |
| M2：`/ scale` → `* scale`（两处） | unit camera-controller 6/35 红，含具名两条 `'zoom moves by the delta, in the direction the delta asks for'`（0.6×1.5=0.9 ≠ 0.6/1.5）与 `'zoom clamps to the projection range'`（方向对调）；另 4 条连带红（linear fov / linear clamp / no-op / write-through） | — |
| M2（续） | US2 video 3/8 红：wheel zoom-in / public zoom() / linear fov 三条 | — |
| M3：linear 早退加回 | unit `'zoom reaches the linear projection as fov'` 红（另 `linear zoom clamps to [15°, 110°]…` 连带红）；US2 `'a wheel zoom reaches the linear projection as fov'` 红（8 条中唯一红，隔离干净） | — |

sha 轨迹：M1 wgsl 656a97fa→3c06bc15→656a97fa（sentinel glsl cdae5445 恒定）；M2 controller 93e945dd→483b9eb7→93e945dd（sentinel viewer.ts a8b415e8 恒定）；M3 controller 93e945dd→4cfb8f2b→93e945dd（sentinel reference.ts 20082978 恒定）。

**门 A 收窄清单（Step 1 实测）**：

- 门 A 两条具名用例全绿：`compares every camera the baseline holds` + `has a non-empty comparable set covering all four projections`（后者防集合意外清空）。
- `LNG_INERT=false` 成立（cylindrical `origin` 与 `tilt` 两张基线 PNG 字节不同：1522/1557 字节——/4 偏移在捕获像素里是活的）。
- 非线性可比集 = `origin`（lat=0,lng=0，唯一 lng=0 处新旧公式等价）各 1 态；`tilt`(30,45) / `south`(-60,180) / `zoomed`(10,300) 全部排除（lat≠0 且 lng≠0）；perspective 可比集 = 全部 4 态（线性路径 lng 在矩阵里，P2 已逐元 pin）。可比集不因 C1 变化，与背景节测定一致。
- `comparableStates` 注释块已登记：lng≠0 的非线性态自 C1（2026-09-23，spec §5.2）起永久漂移，由既有过滤器排除，属登记在案的有意分歧，不是待修的红。
- 基线族零 diff：`git diff 4243e01 -- test/fixtures/baseline/ test/support/baseline.ts test/support/baseline-node.ts test/integration/support/baseline-browser.ts test/unit/baseline.ts` = 0 行；US5/no-webgpu 边界（`src/index.ts`、`src/interaction/**`、`src/renderer/shaders/generated.ts`、`demo/`）= 0 行。

### 偏离 plan 的点（8 项 + 提交形状，按协调者裁定登记）

1. Concern A：plan 的 `toBe(0.4)` 示例差一个 ulp——落地为表达式形式 `toBe(0.6 / 1.5)`（与实现除出的结果逐位相同）；plan 已同步。
2. Concern B：photo 360° 往返的红预测结构性错误（姿态 wrap 至恰好 0，两公式同读 0）——改判为守 wrap/累积的绿钉；新 quarter-shift 测试才是 C1 的行为级红 网（旧树实测 worst=171 红 / 新树 worst=0 绿）。
3. plan 文件清单漏了两个仍带旧 /4.0 shader-source pin 的文件：`test/unit/shaders.test.ts` 与 `test/unit/webgl2-shaders.test.ts`，已翻成诚实换算 pin（首轮 coverage 2F|299P 抓出）。
4. GLSL 在 `project_cylindrical` 上方 ~:127 还有第三处 /4.0 提及（派工单只枚举了 :217 与头部 :27）——eb56504 已一并更新。
5. plan 背景节有两行相邻同预测（~:44 bullet 与节标题）——eb56504 已成对修正。
6. plan 的 zoom 调用普查写 14 处；实际 16 处调用 + 1 处注释——逐点映射已闭合，仅计数出入；已在 plan 标注。
7. 质量评审 IMPORTANT：`test/integration/support/gestures.ts` `wheel()` TSDoc 方向被 C2 写反（滚下才是 ceiling no-op，不是滚上）——flip 清单第 4 处漏网，d25549c 已修。
8. 质量评审 IMPORTANT：`panorama.glsl:221` 原文 "differ by a factor of about 29"；正确量级 45/PI ≈ 14.3——d25549c 已修。

另登记：本卡以**两个提交**落地（eb56504 修复+红网；d25549c 质量评审后纯注释整改，评审循环 1 轮）；评审人另记两条非阻塞语法瑕疵（"the quarter-turn test's below" 缺名词；"1 / (1 - step)" 的量级读法），接受为注释打磨不再改。

### 遗留风险

- CLAUDE.md Commands 节注释漂移：写着 `npm run test:integration # playwright test`，实际 package.json 跑的是 vitest browser projects——先前已存在、与 C1–C3 无关，明确推迟到 p7-cleanup 文档轮（届时重写 CLAUDE.md）。
- 上述两条非阻塞语法瑕疵：已记录、接受，不再动注释。
- **spec §5.4 已知过时（终审 Finding 1，IMPORTANT，以登记处置）**：本卡 spec（`docs/superpowers/specs/2026-09-23-pan-zoom-semantics.md:136`，§5.4）仍把 360° 往返定为「C1 的行为级红网」——本分支已证伪：`wrapLongitude` 把 360 回卷成精确 0，`lngOffset(0)` 新旧公式同值，M1 沙箱里往返保持绿、只有 quarter-shift 网 red。plan 与完成报告偏离 #2 已记录改判（往返=伴随绿钉，真红网=quarter-shift）。spec 属分支前用户裁决文档、在 scope 白名单之外，修订与否由用户定夺；维护者若按 §5.4 复核 C1 会写出一张回归下不可能红的网并误信其绿。
- **v1-design §11.4 B1 的「差约 29 倍」参照系含混（终审 Finding 2，MINOR，随行登记）**：净 /4 偏移对诚实换算是 45/π ≈ 14.3（本分支注释口径，wgsl/glsl/reference.ts/CLAUDE.md 四处一致）；/2.0 中间步对换算是 90/π ≈ 28.6 ≈ 29（v1-design 原文口径）。两数各自算术上都对，但调和说明目前只存在于 d25549c 提交消息里，读者从任一文档看不到。留待 p7-cleanup 文档轮加一个词的括注即可，不阻塞任何事。

## 自审记录

评审与测试质量两节按协调者通报与 Task 3 实测登记如下。

### CR 结论

按协调者通报：spec 评审（pz-spec-task2）对 eb56504 判 **COMPLIANT**；质量评审（pz-quality-task2）报两处 IMPORTANT（均注释级：gestures.ts wheel TSDoc 方向、glsl 量级 29→14.3）加两条非阻塞语法瑕疵——IMPORTANT 项以 d25549c 整改后 **APPROVED**，共 1 轮整改循环。Task 3 收口步（本步）零行为改动，不在评审射程内。

### 测试质量结论

第 2 关按收工纪律以 effective-testing 审查清单评估本分支改动的测试（fresh 评审 agent，2026-09-24，评估范围 4243e01..a07164a + 卡面登记提交 6598271）：**0 CRITICAL、2 WARNING、3 NOTE**（NOTE 均为查验后接受项，无需整改）；两条 WARNING 以 3742d6d 一轮整改后复审确认 **RESOLVED**，共 1 轮整改循环。此前实测证据延续有效：红网先行（Task 1 具名红记录在 plan Step 5，修复同提交落地）；三体变异抽查全部具名击杀，M1 负对照（reference pins 25/25、photo 360° 往返）实测不红；门 A 可比集断言在位（防「集合静默清空导致零比对假绿」）。

**覆盖陈述**（评审员实测，两处 gap 已由 3742d6d 闭合）：本分支触及的路径全部有测试网。`camera-controller.ts`（zoom() 重写）与 `reference.ts`（lngOffset 诚实换算）在 6598271 实测全指标 100%（camera-controller 58/58 语句、24/24 分支、14/14 函数；reference 53/53、24/24、10/10），且覆盖有断言背书而非仅到达：除法钳两方向、linear fov 路径、两个同值守卫、clamp 两端各有精确值/脏标志断言，zoom 族负面/边界占比约 70%（非有限值、零 delta、epsilon delta、ceiling 钉住、负分母、写穿不污染）。两处 shader lng 行双重有网——两个 shader 测试文件的双向字符串 pin（正向新拼写 + 负向 /4 正则）＋门 C 四相机×四态矩阵（双 project 绿）＋quarter-shift 像素 pin＋评审员从 WGSL 文本独立手算复现的六个 float64 reference pin（v 约定差异经 cross-backend 采样处一次 `1 - v` 补偿调和，非分歧）。`viewer.ts` 仅注释改动，Viewer.zoom 经 US2 public-zoom() 测试端到端有网（后端边界精确 `toEqual({zoom: 0.5})` ＋ pre-zoom 负对照）；gestures 支撑文件仅 TSDoc 改动，所述滚轮方向由 US2 两条 wheel 测试以像素断言背书。无网例外及理由：`viewer.ts`/`backend-factory.ts` 在 unit 覆盖闸外，属已登记的 DOM-bound 豁免；全仓仅剩 3 条未覆盖分支（events.ts:136、uniforms.ts:77、webgpu/backend.ts:427）均在本分支射程之外。评审指出的两处网缺口已由 3742d6d 闭合：①planet 此前无任何 zoom() 实例化（统一 clamp 只钉在一种非线性 kind 上，门 C 直接构造 Projection 绕过 controller 兜不住）→ 已加 planet 臂钉住 [0.01, 1] 两端点；②quarter-shift 测试的 1:1 读回路径此前无内容断言（两条空白读回会空洞地绿，worst=0 恰过 ≤2）→ 已加 `countNonBlack(home) > 0` 守卫（复审验证两种空白场景均红）。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
