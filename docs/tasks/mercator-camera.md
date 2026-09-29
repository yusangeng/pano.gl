---
plan: docs/superpowers/plans/2026-09-29-mercator-camera.md
scope: [src/core/**, src/renderer/**, src/interaction/**, src/viewer/**, demo/lab/**, demo/shots/**, README.md, test/**, vitest.config.ts]
verify: npm run gen:shaders && npm run build && npm test && npm run typecheck && npm run lint && npm run test:coverage
layer: domain
state: reported
createdAt: 2026-09-29T09:01:03.219Z
---
# 任务：Mercator 相机（第五投影）

## 完成报告

给 pano.gl 增加第五个相机投影 `mercator`——cylindrical 的保角版（全图均匀比例尺、两极推到无穷远），全栈一次到位：常量管线、CPU float64 仲裁、双 shader 公式、拖拽语义、三门测试、demo lab、README 与截图。plan 14 个 task 全部完成，fb3378e..1367d49 共 20 个提交。

### 做了什么

- **T1 常量管线 + CPU 仲裁者**（c62032c + 25add9c）：`projection-kinds.json` 增 `mercator: 5`（唯一事实源）→ `gen:shaders` 生成；`ProjectionKind`/`Projection` 联合加宽，类型系统强制补齐 `CAMERA_CODES` 等全部 `Record<ProjectionKind,...>`；`reference.ts` 增 `projectMercator`（float64，asin(tanh) 形式）+ switch case + 模块头"非转写"豁免注记 + `latOffset` 三用法文档；第五 kind 造成的全部陈旧计数注释刷新（WGSL/GLSL/backend.ts/camera-controller/viewer）。25add9c 为 spec 审出的两处注释修正。
- **T2 reference 不变量单测**（dc42f17）：I1 位级恒等、I2 中心奇偶（与 cylindrical 同点）、I3 开值域 + 诚实 float64 饱和极限、精确极点塌缩（±90→v 0/1）、gd/exp 恒等 pin、EPSG:3857 屏沿 pin。符号翻转变异验证 pin 咬人。
- **T3 WGSL**（a22c14b）：`project_mercator` + dispatch case + 四处注释；dispatch pin 红-绿落地。
- **T4 GLSL 孪生**（a0bc6a4 + 8e44eae）：与 WGSL 逐行同形的公式 + if-链分支；token-for-token 守望 + 结构 pin 红-绿；单边符号变异双红验证。8e44eae 补 GLSL dispatch-arm 删除守望（初版对"删分支"这一变异 unit 盲，spec 审发现后补）。
- **T5–T8 拖拽语义四处落点**：`classifyDragMercator`（一屏高 = 2π·zoom 米，M 度量，e81bb14）→ `dragToMercatorPan`（薄透传，5a02d3b）→ `panMercator`（逆投影纬度项、极点吸收、纯水平位级不变、零 delta 不 dirty，8ceb2e2）→ viewer pan 处理器按 kind 分流、`rotate` 事件仍发度数（applied delta，238a888）+ 手势端到端集成测试 `mercator-drag.test.ts`。ba195c4 rider（qual-t8 驱动：live zoom 读数 / applied delta / lng 符号三个 pin）。
- **T9–T11 测试基建与三门**：camera-switch 的 PROJECTIONS 与 KINDS 同提交加宽（lockstep 测试看守，c347a1c）；gate B 纬度响应循环 + extent 敏感性 + 极点退化屏（合成行着色源，14428fb）；gate C 主矩阵 + 15 态 lat×zoom 扫描（含精确极点）+ 仲裁腿（实测 1/1，pin 3，四要求协议注释，43a233d）。
- **T12–T14 demo lab + README + 截图**：lab 三处加宽（KINDS / extent 三元 / URL 白名单，3f36e32）；README 相机表行 + 五投影节（3+2 画廊）+ rule-of-thumb（fa99bc2）；`demo/shots/mercator.png` 800×450（fe82441）+ 陈旧 bundle 数字刷新 38.1→36.9 kB（6420b4d，本分支实测 36.94）。T14 会话内顺带完成 T12 顺延的四项可视冒烟（URL 直达 mercator、kind 控件切走切回、zoom 滑条 1.00→0.05、垂直拖拽 lat +3.0°），全部通过、零页面错误。
- **终末修复 + Gate-1 整改**（e9b76b4 + edf59db + 1367d49）：全分支 review 发现的四处陈旧计数注释（纯注释零行为）；gstack /review 的 1 CRITICAL + 10 INFORMATIONAL 全数处置（详见自审记录·CR 结论），其中 vitest.config.ts 白名单补漏、投影入口有限性断言、demo 两处 kind 字面量改单一事实源 import。

### 自测结果

- **T14 收尾全量核验**（spec 审独立复跑一致）：固定顺序全绿——`gen:shaders`（幂等，树不变）→ `build`（ESM 133.82 kB / gzip 36.94 kB）→ `npm test`（unit 23 文件 343 通过；integration + no-webgpu 34 文件 219 通过 1 skip〔既有 skip，与本分支无关〕）→ `typecheck`（3 程序 + check-readme-options 绿）→ `lint`（零告警）→ `test:coverage`（分支 98.44% = 253/257，90% 门槛通过；语句 99.63%、函数 100%、行 100%）。
- **Gate-1 整改后复验**（2026-09-30）：no-webgpu 全项目 11 文件 58 通过 + 1 skip（adapter null、WebGL2，mercator-drag 五条全部执行——CRITICAL 的闭环证据）；单测全项目 23 文件 346 通过；typecheck 三程序零错；lint 全绿；分支 diff 零 TODO/FIXME。
- **最终 verify 链**（2026-09-30，交卷前自查）：`gen:shaders`（幂等，工作树零改动）→ `build` ✓ → `npm test` 全绿（integration + no-webgpu 35 文件 225 通过 + 1 设计内 skip；unit 阶段先行通过）→ `typecheck` 0 错 → `lint` 全绿 → `test:coverage` 分支 **98.45%**（函数 100%、行 100%）。

### 偏离 plan 的点（台账）

**裁决保留的实现偏离**：
1. T1：plan 写"types.ts 加宽两个类型"，实际 `ProjectionKind` 联合的声明在 `constants.ts:25`（types.ts 只有 `Projection` 判别联合）——加宽落点随之在 constants.ts，`Projection` 成员照 plan 落 types.ts。裁决保留实况。
2. T2：plan 预测 sign-flip 变异会红三个测试，实测红 I2/lat-term 两个——zoom-edges 上下对称不受该变异影响。按"以实测为准"记录。
3. T3：plan 锚点 "panorama_uv 之前" 在文件中无此参照名（no-referent）；GLSL 侧同款公式的计数注释站点实为第六处而非 plan 列举的第五处，裁决保留全部。同批：dispatch pin 的红绿顺序（constant-pin-not-red）按实况记录。
4. T5：matcher 写法与 DragRotation 引用两处与 plan 文本偏离，裁决保留。
5. T7：describe 工厂落点与 plan 行号不符；zero-delta contract-pin 记为 informational；变异矩阵 M-1 项顺延 T11。
6. T8：viewer 侧 `pose?.` 可选链写法偏离 plan 字面（等价）；B1 注释按裁决扩为 3 行。
7. T9：lockstep 测试枚举口径由"第五"改"第六"（把 linear 计入，JUSTIFIED）。
8. T10/T11：gate B 极点测试由"哪一行"改判为"均匀性 spread"（不 pin 采样器翻转约定）；gate C 仲裁腿实测值 1/1（远低于 pin 3，四要求协议完整）；变异矩阵数据 M1/M2 各 11 杀、M3 双翻恰好被仲裁腿独杀（244/244 ≫ 3）。
9. T11：环境限制——/browse 共享守护 Chromium 无 GPU 无 WebGL2，gate C 集成跑在 vitest 浏览器模式（playwright-core 真 GPU）上，与既有三门同一引擎；console.log 探针路线偏离 plan 的"断言消息报出"（值已回填注释）。
10. T14：截图走 route ② playwright-core 捕获（/browse 守护无 GPU，plan 预声明回退结构的实况版）；`&source=4k`（兄弟张同源 4096×2048 所需，lab 默认 2k）；捕获时注入 `.dock{display:none}`（既有四张为无 lab UI 的纯渲染）；rider 6420b4d（qual-t13 发现 README:9 陈旧数字，协调者裁决随 T14 修复）。
11. **Gate-1 Q1（用户裁决 2026-09-30）**：CRITICAL 修复需改 `vitest.config.ts`——原在 scope 白名单外且 plan 列为不动文件；用户裁决"授权分支内修"，卡 frontmatter scope 已加宽（task-finish 的卡同步会把新 scope 带回主卡）。
12. **Gate-1 Q3（用户裁决 2026-09-30）**：demo kind 清单由字面量改为 `PROJECTION_KINDS` import，共两处（panels/camera.ts 的 KINDS、main.ts 的 URL 白名单）——偏离 plan Task 12 的字面写法，落在裁决声明的意图内（"第六投影落地时 demo 不会再漏"）。

**执行事故（均已闭环，无产物影响）**：
- T3 协调者的变异检查指令写错对象（task 3 mutation-check dispatch error）。
- T4 初版 GLSL dispatch-arm 删除变异 unit 盲 → 8e44eae 修复后双守望齐备。
- T5 IEEE −0 地雷（符号函数在 ±0 处的断言），实测规避。
- T8 审查简报自相矛盾（qual-t8 briefing contradictions），复核测量后澄清。
- T12 ①协调者简报引用了过时的 trailer 拼写，impl 产物从头就是对的——多余的 amend 只造成 SHA 更迭（f8fd9be 成为孤儿锚点）；②impl 自述与 od 级核验不符（称改过实未改），被 od 检查抓出。协调者简报缺陷记入台账。
- T14 协调者简报引了 4b8923e 的原始 blob 尺寸（约 1.0–1.25 MB）当"兄弟张现状"，盘上实为 713–867 KB——差值来自 d631d1c（task-p7-cleanup，CR F4）那次合法的截图收缩。impl 以实测盘上尺寸比对，未受影响。
- 端口：lab 冒烟用 5174（5173 属主检出 vite，全程未触碰）。

**计划内但值得记录的项**：stale-count 陈旧计数注释折叠共十余处（WGSL 3+1、GLSL 4+1、backend.ts 2、camera-controller 2、viewer 2、README 1〔随 T13 落地〕；终末 review 又补 4 处——见补充记录）；gate C 仲裁腿 measured 行按四要求协议以实测 1/1 回填（plan 留白处）；README 截图在合并进 master 前渲染 404（既有五张同款 raw.githubusercontent 模式，plan 已声明非门禁物）。

### 遗留风险

1. **仓库根 CLAUDE.md 仍写 "four camera models"**——不在本卡 scope 白名单内，未改动；留协调者/用户裁决（一处文字，无行为影响）。
2. **零拖拽幻影事件**（qual-t8 唯一未携带 Minor）：mercator 与既有 kind 共享的幻影路径行为，非本分支引入；本分支不修（修它 = 改共享输入层，越 scope）。
3. **切走切回 round-trip gap**：所有五个 kind 共有的既有行为（pre-existing），T9 记录 report-only。
4. **zoom-1-invisible 共享错误类**（qual-t11 Minor 1）：gate C 双后端一致 + 仲裁腿对 lat 30/zoom 1 的组合把关；lat≠0 × zoom≠1 组合若两 shader 同错则仲裁不可见。未来闭环 = 增一条 lat≠0×zoom≠1 的 reference pin（独立小卡即可，不阻塞本卡）。
5. README 画廊五张截图 URL 合并前 404（见上，非门禁）。
6. **旧四款相机的 rotate 事件在极点附近 overshoot**（gate-1 对抗腿 ADV-3）：`lat` 报请求增量而 pose 被钳位，delta 求和消费者会高估；mercator 已报 applied delta，旧四款统一到 applied 是候选后续卡——改的是共享事件语义，越本卡 scope，README/TSDoc 已如实写明 kind-dependent。

### 补充记录：T14 双审 / 终末全分支 review / 终末修复

- **spec-t14：SPEC_COMPLIANT，零缺口。**拓扑/trailer 逐字节过；截图 800×450、盘上五张尺寸复测与 impl 一致；兄弟张尺寸疑案以史实闭环（4b8923e 原始 1.0–1.25 MB → d631d1c〔task-p7-cleanup CR F4〕合法收缩至 713–867 KB，本分支未碰兄弟张）；捕获脚本逐行核对（视口/dpr、`source=4k` 必要性、fresh reload 恢复 zoom 1、dock 注入、banner 仅检查未强改）；全链固定顺序独立复跑全绿且每个数字与 impl 报告一致（343 / 219+1 skip / 98.44% / 36.94 kB）。
- **qual-t14：Ready to merge，零 Critical/Major/Minor，5 条 Informational。**截图保角签名三法独立验证（视觉分析：赤道带等比、向两极渐增的纵向拉伸、与 cylindrical 可区分；PIL 客观测量：亮度 139.2 居五张中游、零削波、接缝扫描 1.51× 分位属内容分布非伪影；与 cylindrical 像素距离 65.5 恰在全十对跨投影族范围 64.2–69.8 内）；画廊引用与兄弟张同形；bundle 口径裁决 vite 数字为正确约定（读者以 `npm run build` 可复现；node zlib gzipSync = 36,936 B = 36.94 kB 精确吻合；旧任务日志 p7-cleanup.md:142 记录的 `gzip -c` 法日后会量出 37.0——工具差异非漂移，Informational）；1 个 skip 为 dispose-order 设计内探针跳过（vitest.config 注释明载），mercator 集成 9 条 + 单测 22 条 + camera-switch 双项目收集无遗漏（`vitest list` 行数差为参数化标题未展开所致）。
- **终末全分支 review：READY——零接缝缺陷，分支作为单一变更端到端自洽。**九项全分支检查全过：三家公式逐项同形（reviewer 独立复算全部测试精确字面量——u/v pin、EPSG 屏沿、极点塌缩、拖拽链纬度/applied delta——全部精确复现）；拖拽链四层单位/符号一致、rotate 事件带 applied 纬度差（极点吸收 pin 在 lat 89 验证）；常量 5 只在唯一事实源、生成物与豁免 pin 三处出现；层规干净；README 逐项对代码（36.9 kB 在项目度量工具下精确复现：node zlib 36936 B = 36.94 kB）；测试体系一个故事；公共面仅 `Projection` 联合增量加宽、`src/index.ts` 零触碰；两个 rider 成立；台账无矛盾。新发现 4 Minor + 2 Informational（全部注释级，零行为影响）：M1 gate C 头注释 "four formulas"、M2 WGSL:39 生成器常量枚举漏 `/_MERCATOR`、M3 camera-controller.test.ts:504 "other three"、M5(I) webgpu-backend.test.ts:430 "three of the four"——四处已修（e9b76b4，纯注释 4+/4−，gate-a-pixels.test.ts / generated.ts / panorama.glsl 未触碰，I6 裁决被遵守；final-review-3 复核 VERIFIED 六点全过）；M4（T5–T14 勾选欠账）收尾一次补齐；M6(I) gate A "all four projections" 裁决保持不动——gate A 的宇宙就是 v0.2.2 基线所持的四相机，措辞是基线事实非陈旧计数。台账修正：T1 的"全部陈旧计数注释刷新"清单不穷尽——M1/M2/M3 三处不在清单上（M5 所在文件本分支未触）；终末全分支 review 正是补这个盲区的。

## 自审记录

两关结论如下（第 3 关 verify 链结果见完成报告·自测结果的最终 verify 链条目）。

### CR 结论

- **手段**：gstack `/review` 五专科（perf / security / api / maintain / testing）→ Step 4.6 去重合并（10 unique，quality 3.5）→ 红队两腿 → 对抗复核 adv-claude-2（最终 Recommendation **APPROVE_WITH_FIXES**）；Codex 两腿合法跳过（gstack-codex probe not_installed）。
- **各级发现数**：CRITICAL 1（testing：no-webgpu include 白名单漏 mercator-drag.test.ts——integration 项目在软件 WebGPU 下五条全 skip，mercator 拖拽链在 CI 零执行测试）；INFORMATIONAL 10 去重后（security 1 / api 3 / maintain 5 / testing 1）+ 红队 2 + 对抗 3（ADV-1/2/3）。
- **整改**（提交 edf59db，11 文件 123+/20−）：CRITICAL 按用户裁决**授权分支内修**——vitest.config.ts no-webgpu include 增补 mercator-drag（含注释段），**vitest.config.ts 由用户裁决进 scope**（原在白名单外且 plan 列为不动文件），分支卡 frontmatter scope 已加宽、task-finish 的 syncCardToMain 会同步主卡；六项自动修复（cross-backend 陈旧计数、README rotate 语义、ViewerEvents TSDoc、ptz dragToMercatorPan 孪生、matrix gate-B mercator extent 用例、mercator-drag 第二测改挂 lat 45——lat 0 处 bit-exactness 只是平凡路径）；Q2 按裁决**加断言**——assertProjectionFinite 于构造器与 setProjection 双入口（fov/zoom/extent 有限、aspect 正，镜像 setAspect 既有守卫；range 刻意不断言，zoom 5 是既有 pin 行为）+ 单测两条；Q3 按裁决**改为 import**——demo/lab KINDS 字面量 → PROJECTION_KINDS 单一事实源；Q4 按裁决**保持逐用例挂载**（例外）。
- **轮数**：3（初审 → edf59db 复核轮〔独立验证者：0 critical / 2 informational〕→ 1367d49 收尾轮〔typecheck+lint 绿；改动与复核者已逐项验证过的 panel 同款 import 模式〕）。
- **复核轮结果**：edf59db 全项过——assertProjectionFinite 五处 #projection 赋值全枚举、双入口先断言后存储、zoom/setAspect 只写钳位有限值、全仓无非有限投影字面量（仅两条新单测）、合法调用方零误伤；include 正则精确匹配三文件无碰撞；mercator-drag 零像素读回、探针在 adapter null 时短路 healthy；demo 导入无层规违反；frontmatter 可解析；错误消息与测试正则吻合。2 条 informational：①main.ts URL 白名单仍手写五 kind 字面量（与 Q3 同漂移类，越 edf59db diff 但在裁决意图内）→ **已修**（1367d49，同一单一事实源 import）；②cameraOptions setter 先应用 pose 后 setProjection 抛出 = 抛后 pose 已动、旧投影保留——复核者判定为一致性边界语义非缺陷（setPose 半途抛出同形），**记录在案不动作**。
- **例外台账**（初审无法清零、已记录待协调者裁决）：①VERSION 陈旧（release-time 事项）；②unknown-kind 静默黑（spec §7 既有行为）；③仓库根 CLAUDE.md "four camera models"（越 scope，遗留风险 #1）；④gate-A "all four projections"（M6/I6+RT-2 两次裁决维持）；⑤Q4 逐用例挂载（用户裁决 2026-09-30）；⑥cameraOptions setter 抛出后半应用语义（复核轮判定一致性边界，记录在案）。
- **整改后验证**：no-webgpu 全项目 11 文件 58 通过 + 1 skip（adapter null、WebGL2，mercator-drag 五条全部执行——CRITICAL 的闭环证据）；单测全项目 23 文件 346 通过；typecheck 三程序零错；lint 全绿；分支 diff 零 TODO/FIXME。
- **留痕**：gstack-review-log 已持久化（skill:"review"，status issues_found=5 全为例外/裁决项，critical 0，quality 3.5，commit edf59db）。

### 测试质量结论

**评估对象**：分支 test/ 增量 +638/−30，15 文件——新文件 mercator-drag.test.ts（5 条用户故事）；加宽 reference.test（float64 仲裁 pin）、gate-b（extent/纬度行为）、gate-c（mercator 相机态跨后端）、camera-controller（pan 语义 + 本轮新增双入口校验）、gestures（classifyDragMercator）、matrix（extent 用例）、constants/shaders/webgl2-shaders（kind 常量单源）、ptz（委托孪生）、camera-switch/user-story（第五 kind）、support/viewer（PROJECTIONS 表）。

**有效性（有 Bug 必红）——本分支以具名突变体逐条钉死，非自评**：
- `zoom: 1` 硬编码可过单测 343/343 + 集成 139/139 → "metres scale by the zoom in force" 测试是 live read 的唯一 pin（qual-t8 实测）；
- 事件发绝对 pose 可过全绿 → lat 89 applied-delta pin（0.6340606476375115）；
- lng 符号翻转可过全绿（垂直测试的 lng 恰为 −0）→ unwrapped −72 pin；
- `deltaM === 0` 捷径删除仅在 lat≠0 可测 → 本轮改挂 lat 45（ADV-2）；
- 测试间 write-through 通道 → 逐用例工厂（在 write-in-place 突变体上实测定位）。

**断言强度**：全部精确字面量独立推导（2π·0.16 = 1.0053096491487339；asin(tanh(2π·0.08)) = 27.658619791226776；89.63406064763751 / 0.6340606476375115），toBeCloseTo 9 位；捷径路径 toBe 位精确。**负面路径**：构造器/setProjection 非有限投影 5 变体（本轮）；极点渐近非饱和；零增量 no-op 不脏帧。**分层**：单元 1:1 映射源文件、无 GPU 依赖；集成按用户故事走公共面（src/index 直挂）。

**覆盖陈述（哪些路径有网、哪些没有、为什么）**：
- 有网：投影公式三写一致（reference float64 + 双 shader + gate C 互证；gate A 对 mercator 刻意无基线）；拖拽全链四层（input → classifyDragMercator → panMercator → pose/事件，集成故事 + 单测委托孪生）；zoom live read；applied-delta 语义；投影状态入口校验；extent 矩阵定尺；kind 常量单源；camera-switch 双后端挂载；**no-webgpu 世界执行（本轮闭环：五条全部在 WebGL2/adapter null 下执行）**。
- 没有及理由：①mercator 无 v0.2.2 像素基线（该相机是新的，gate C 跨后端 + reference 仲裁替代把关）；②lat≠0 × zoom≠1 reference pin（zoom-1-invisible 共享错误类，遗留风险 #4，独立小卡闭环）；③幻影拖拽事件在 mercator 的表现（共享输入层既有行为，遗留风险 #2，越 scope）；④切走切回 round-trip gap（五 kind 共有既有行为，#3）；⑤像素门在 CI 的执行（设计上需真 GPU——CI SwiftShader 下 skip，位姿/事件层由 no-webgpu 项目覆盖，本轮堵上最后一个零执行洞）。此五项均"没有 ≠ 失职"：①是设计、②③④是既有/越界并已记录、⑤已以替代网闭环。

**轮数**：1。结论：零未清发现；分支覆盖率 98.45%（阈 90 强制）。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
