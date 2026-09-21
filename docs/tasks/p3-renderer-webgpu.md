---
plan: docs/superpowers/plans/2026-09-19-p3-renderer-webgpu.md
scope: [src/renderer/**, src/core/reference.ts, test/unit/**, test/integration/**, vitest.config.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: foundation
deps: [p2-core]
state: reported
createdAt: 2026-09-19T08:51:52.509Z
---
# 任务：P3 — renderer + WebGPU

开工先读 plan 头部，以及 File Structure 上方那段「本期不再产出任何桥接层」。

**本卡最重要的一条：没有页面侧出口。** `index.html` / `demo/test-entry.ts` / `demo/test-entry-hooks/*` / `PanoTestApi` / `window.__panoTest` / `demo/tsconfig.json` —— **一个都不建**。集成测试改用 vitest 浏览器模式后，测试文件本身就在页面里，直接 `import src/` 的内部模块即可。上一版把这套桥接建在了这一卡，那一版已经作废。**如果你正在写一个 hook 文件，那是走错路了。**

本卡是门禁 A / 门禁 B / `uniform-layout` 三条集成测试的落点，全部跑在 `integration` project 里（真适配器由 `require-webgpu.ts` 守卫保证）。**容差必须在真 GPU 和 SwiftShader 上都成立**：本地是真 GPU，CI 走 `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`；`CI=1 npm run test:integration` 可以在本地复现 CI 的那一半。某条门禁只在一边绿 = 容差定错了，不是环境问题。

Task 8 Step 3 会给三个非线性投影的 `phi` 加 `- lat`，并同步改 `src/core/reference.ts`。**P6 转写的是这一步之后的最终形态**，转写中间版本会漏掉纬度，门禁 C 在非零纬度上立刻红。

本卡创建 `test/integration/support/baseline-browser.ts`（P6 门禁 C 要复用），并在 `src/core/reference.ts` 上留下本卡的改动 —— 那是 P2 的文件，但改它的理由来自本卡。

verify 用的是 `npm run test:coverage` 而不是 `test:unit`：项目的规则是**分支覆盖 ≥90% 是构建失败而不是目标**，而 `test:unit` 不带覆盖率，会静默放过它。`vitest.config.ts` 因此在本卡 scope 里 —— 如果 `src/renderer/webgpu/backend.ts` / `device.ts` 这类要真 device 的代码把门槛拉下去了，**首选是补单元测试（桩一个 device）**，确实测不到才加 exclude，并在那一条旁边写清为什么测不到。**不要删 `thresholds`。**

## 完成报告

**做了什么**：

8 个 Task 全部走完 SDD 闭环（实现 → spec 合规审 → 质量审含变异测试 → 整改 → 复审 → 勾选），终末全分支 review 后整改两提交收口。分支 `master...HEAD`：26 提交 / 25 文件 / +3702−63，全部 `task-p3-renderer-webgpu:` 前缀：

- **Task 1 接口与能力探测**：`backend.ts`（Backend / RenderableSource / Capabilities / DeviceLost）＋ `capabilities.ts` 纯函数决策表（含 MIN_TRUSTWORTHY_TEXTURE_DIMENSION 下限）＋ 单测
- **Task 2 uniform 布局唯一真源**：`uniforms.ts` 96B 布局数据（invClip 0-63 + 六标量 + 三填充）＋ `packCameraUniforms`
- **Task 3 WGSL 着色器**：`panorama.wgsl`（单三角形全屏、片元级逆矩阵投影、四投影公式逐句转写、双片元入口点）＋ 常量拼接 ＋ 采样器（终态双轴 repeat，见勘误 D1）＋ 源码级不变量单测
- **Task 4 设备与作用域**：`device.ts`（acquireDevice / withValidationScope / device.lost 管道）
- **Task 5 WebGPU 后端**：`webgpu/backend.ts`（上传门、双管线、dirty 节流、dispose 幂等、创建失败抛异常）＋ `support/gpu.ts` 离屏回读原语 ＋ smoke 测试
- **Task 6 布局往返**：`support/echo.ts` 生成式探针（WGSL 由布局数据生成、bitcast 位往返）＋ uniform-layout 集成测试
- **Task 7 门禁 A**：`gate-a-pixels.test.ts`（可比集从 fixture 实测推导、集合非空有断言钉住）＋ `baseline-browser.ts` 浏览器侧 fixture loader
- **Task 8 门禁 B**：矩阵表面重建单测（四列完整展开）＋ F5 纬度生效（`panorama.wgsl` 与 `reference.ts` 同步加 `- lat` 项）＋ 行为变更测试 ＋ 创建失败抛异常的集成测试（e16965f）
- **终审整改**：254774b（version 契约钉死 + element 保留语义 + legacy 上传注释 + P6 补记 v 翻转注）＋ 4e3a8fb（smoke canvas DOM 清理，含审查侧计数勘误：实际两个测试持 canvas）

**自测结果**（终审整改后当面跑，exit 0）：

- `typecheck` 三程序全过（root + test/integration + tsconfig.scripts.json）
- `lint`：0 error
- `test:unit`：164/164 @ 13 文件；`test:coverage` 分支 98.38%（122/124，两条未覆盖均良性，见风险 5）
- `test:integration`：全量双环境绿（真 GPU 与 `CI=1` SwiftShader 各 14 条）；终审整改后 backend-smoke 双环境 3+3 亲跑复绿
- `gen:shaders -- --check`：up to date；`build`：exit 0（终审期间亲跑）；task-finish 闸 6 当面再跑全链

**偏离 plan 的点**（重大偏离均有 plan 内勘误块在案；任务内其余小幅偏差——措辞修正、测试补充形状、计划代码块的机械适配——均随各 Task 的 spec/质量审裁定落地，勘误块与提交记录可查）：

- **D1（Task 3/7）** 采样器双轴 repeat 而非 plan 代码块的 clamp-to-edge——门禁 A 实测 clamp 时 U 轴接缝差最高 124、V 轴极点 73；旧实现不设 WRAP、吃 WebGL 默认 REPEAT 双轴。勘误块 plan Task 3 Step 3，落地 c6e5066
- **D2（Task 5）** 源纹理 usage 补 `RENDER_ATTACHMENT`——`copyExternalImageToTexture` 目标按 spec 必须带 `COPY_DST | RENDER_ATTACHMENT`（该拷贝实现为 blit）；缺它时 validation 被吞、整条 command buffer 连 clear 一起丢弃、症状「画了全黑」而非「上传被拒」。勘误块 plan Task 5 Step 2，落地 c6e5066
- **D3（Task 6）** 探针两处笔误：import 深度应为 `../../../src/...`；矩阵槽 f32 裸赋 `array<u32>` 是 WGSL 编译错（管线静默无效、读回全零），必须 `bitcast<u32>`（不得用值转换——探针职责是位往返）。勘误块 plan Task 6 Step 1，落地 fc95d06
- **D4（Task 8·U1）** gate B 的 `surfaceAt` 完整展开四列——plan 的三列展开漏 z 槽列（齐次向量 `vec4(ndc, 1, 1)` 的 z 槽乘数是 1，`invClip[8]` 三台相机非零），三列自测 x=0.1 过不了自身 `x ≈ 1` 断言；四列实测 x=1.000000、y/z 跨度恰为 extent、居中 0e+0，变异 M7 回退三列立即红。勘误块 plan Task 8 Step 1，落地 83fc9d8
- **D5（Task 8·U2）** fixture 证据测试改写——plan 断言的 `captured.u_CamPOVLatitude` 在 P0 捕获流里不存在（完整 uniform 集合六项、无该项，`CapturedUniforms` 只取末帧键注定 undefined）；改为断言 `state.lat`（origin 0 / tilt 30）＋ 遍历两份捕获文档全部帧断言零写入。F5 证据由「声明未读」升格「从未上传」。勘误块 plan Task 8 Step 4，落地 83fc9d8
- **D6（终审整改）** 终末 review 五项发现（I1/M1/M2/M3/N2）全部整改合并，见 254774b / 4e3a8fb；其中 final-p3 的 M3 计数有误（称三个测试泄漏 canvas，实为两个——device-loss 测试不建 canvas），提交信息已按实情勘误

**风险与移交下游**：

1. **P4 必须遵守 version 契约**（254774b 已钉死进 `backend.ts` 接口文档）：version 是后端唯一像素身份、跨 `setSource` 跨源对象比较；两个源同报 version 1 会被视为同一画面；元数据到达（width/height 0→N）必须 bump，否则后端永不绘制
2. **P6 门禁 C 硬要求**（plan 末补记，含 v 翻转注）：必须含一条非零纬度对 CPU 参考的绝对对拍（便宜做法 cylindrical 128px、lat 0→45，逐屏幕行 v 位移 −latRad/π 可算；−latRad/π 是 reference 侧的 v，WGSL 侧 v 已翻转为 `1.0 - phi / PI`，渲染图位移符号相反）；同源补杀两条：门禁 B 阈值双向化（补 0 vs 0.01 差 ≤ 2）、GLSL 转写保持 `(deg * PI) / 180` 左结合形状
3. **P6 复用纪律**：扩 `test/integration/support/gpu.ts` 不另起平行 helper；`TARGET_FORMAT='rgba8unorm'` 照抄、不改 `getPreferredCanvasFormat()`；`*.glsl?raw` 需要同款类型声明（P1 已建 `*.wgsl?raw` 的）；`CAMERA_UNIFORM_LAYOUT` 不给 P6——WebGL2 走具名 uniform
4. **N3**：gate A 非线性可比集当前恒为 {origin}（lat===0 过滤后的唯一幸存者），`longitudeIsInert` 金丝雀暂不改变下游行为（集合非空本身有断言钉住；perspective 跑全四状态）
5. **N4**：coverage 98.38% 分支（122/124），两条未覆盖均良性：`uniforms.ts:74`（offsetOf 的 throw）、`backend.ts:414`（「版本相等且 element 相同 → 不置 dirty」短路，与 I1 同源，后果只是多画一帧）
6. `test-results/.last-run.json` 未 gitignore（vitest 浏览器模式杂物）——白名单外，交 P7 housekeeping
7. CLAUDE.md 的 Commands/Testing 节仍是 Playwright 时代写法已作废（plan 头部有登记块），重写归 P7 Task 4
8. npm audit 本地 2 条 dev-only（同 P2 移交口径）；GitHub 远端 dependabot 158 条 vs 本地 2 条的口径差已报用户，处置归 P7/用户裁决
9. e16965f（创建失败测试）为比例性裁定的微型实现路径：协调者机械验证＋终审专项审计通过（M4：rejects 断言足够窄、同 catch 路径 device.destroy() 恰一次被单测钉住、失败发生在真实 device/管线建成之后），未走全 SDD 两阶段——如实登记

**已接受残留台账**（终末 review 逐条核验分类，落盘以补 N1）：

- **M4/M5/M9 ＋ fixture 采样线索**：已在 plan 末补记（给 P6 的硬要求与 INFORMATIONAL）
- **M8a（extent 输入自洽）**：matrix.test 的 extent 测试是矩阵自身定义的自洽（输入 extent 与期望 span 同源），外部真值由门禁 A 像素承担——非线性 origin 在 zoom=1 下 extent 错会缩放画面直接红。终审复核成立
- **Task 5 post-dirty-false**：终审升格并入 I1(b)，已随 254774b 文档钉死
- **Task 5 double-pop**：`device.ts` popped 标志 ＋ `device-scopes.test.ts` 与 `webgpu-backend.test.ts` 双钉（throw 路径与 happy 路径 drain 各恰一次）
- **Task 6 M7/M10、Task 7 M5/M6**：终审代码级复核无风险；会话级编号细节不可再考（如实登记，即终审 N1 所指）
- **Task 7 M5 金丝雀**：即风险 4 的 N3
- **N2（v 翻转符号）**：已修（254774b，plan 补记括号注）

## 自审记录

### CR 结论

手段：SDD 两阶段审查 × 8 任务（spec 合规审在前、质量审在后且强制变异测试），整改循环后终末全分支 review（opus）。

- Task 1：质量审 2 轮整改（5eec645 补 pin 输出测试、106c44d std140 注释勘误）复审通过
- Task 2：1 轮（dd1c1ff 补 texProjKind 钉值与 byteLength 断言）复审通过
- Task 3：1 轮（e580a60 u32 kind 钉值 + 注释剥离后源码断言）复审通过；sampler 寻址由门禁 A 实证回炉（c6e5066，勘误 D1）
- Task 4：1 轮（f1fa6c2 scope 恰弹一次 + acquireDevice 桩覆盖）复审通过
- Task 5：1 轮清 8 项（1f668a8，F1-F4/F6-F9）；usage 缺失由门禁 A 首跑暴露（c6e5066，勘误 D2）
- Task 6：落地即对（fc95d06，勘误 D3 两笔误修正后通过）
- Task 7：门禁 A 首跑双缺陷（D1/D2 同源）c6e5066 修复后全绿
- Task 8：spec 审 U1/U2 偏离裁定有据（勘误 D4/D5）；质量审 10 变异 6 灭 4 分类（见测试质量结论）
- 终末全分支 review（opus，26 提交全读、四投影三源逐句对照、13+ 注释事实主张对 legacy 源码与捕获流核验、全量验证实跑）：**READY TO SUBMIT，0 CRITICAL / 1 IMPORTANT / 4 MINOR / 4 INFORMATIONAL**。I1（version 契约二义）/M1（element 保留语义文档矛盾）/M2（legacy 上传注释失实）/M3（canvas 泄漏）/N2（v 翻转注）五项已整改合并（254774b / 4e3a8fb）；M4 为 e16965f 专项审计通过；N1 由本台账落盘解决；N3/N4 记录在案
- CRITICAL / INFORMATIONAL 计数：0 / 4

### 测试质量结论

按 effective-testing 清单评估，变异测试作为断言强度的硬证据：

- **有效性**：各任务质量审变异全灭或有据分类。代表：Task 7 门禁 A 变异 M1-M4 全灭（差异计数精确击杀 47/73/255）；Task 8 十变异六灭——M1/M2/M3（逐投影删 `- lat`）→ gate-b 红，M6（latOffset→0）→ D5 单测红 ×3，M7（回退三列展开）→ x 钉值红（`expected 0.09999999403953552 to be close to 1`），M8b（m=2）→ cylindrical 跨度红；存活的 M4/M5/M9/M8a 分类见台账（M4/M5/M9 正是 plan 末给 P6 补记的三条同源补杀来源）
- **断言强度**：门禁 A 每可比状态 maxChannelDiff ≤ 2 对 v0.2.2 基线像素；门禁 B 表面重建精确钉值（x=1.000000、y/z 跨度恰为 extent、居中 0e+0）＋ 纬度响应差 > 2 ＋ fixture 全帧零 `u_CamPOVLatitude` 写入；uniform 往返 sentinel 逐字段（1234567/7654321/−12.5/234.75/3.5）＋ 矩阵 16 相异值不转置；探针位往返用 bitcast 不用值转换
- **负面路径**：创建失败抛异常（2d context 抢占，真实 device/管线建成后失败）、dispose 幂等、device.lost 5s 内可观测、callback throw 后 scope 恰弹一次、短 buffer RangeError、元素换 version 同不重传的边界钉为预期
- **覆盖陈述**：98.38% 分支（122/124）≥ 90% 门槛；两条未覆盖均良性（风险 5）。无测试网路径：需要真 device 的管线创建路径由 backend-smoke/uniform-layout/gate 系列集成测试覆盖（浏览器模式真适配器，守卫保证非 null）
- 整改轮数：Task 1 ×2、Task 2 ×1、Task 3 ×1、Task 4 ×1、Task 5 ×1、Task 6 ×1、Task 7 ×1、Task 8 ×1 ＋ 终审整改 ×1

## 审查意见

**结论：approve，合并。**（2026-09-21，superloop-verify 第 5 关）

**手段**：协调者直审——卡面红线静态核查（页面侧桥接零残留）＋ 三源投影公式逐句亲读（legacy GLSL ↔ reference.ts ↔ panorama.wgsl）＋ verify 全链在分支树上亲跑 ＋ 集成测试双环境亲跑 ＋ F5 定向变异亲测。

**亲验记录**：

- **卡面最重要红线全过**：无 `index.html` / `demo/test-entry*` / `PanoTestApi` / `window.__panoTest` / hook 文件——页面侧桥接零残留，集成测试走 vitest 浏览器模式直 import src/。
- **三源逐句对读**：`panorama.wgsl` 四投影公式与 `reference.ts`、legacy `fshader.glsl` 逐句一致——linear 的象限修正、planet 的 z 取负＋m/p/q/r、pannini 的 `2*atan((z*0.5)/s.x)` 先加倍后修正、atan 不化简为 atan2；保留 bug `lng = povLongitude/4.0`（度减弧度）与无 `+0.5` 均在；F5 `- lat` 项 WGSL 与 reference 两侧同步落地、`(deg*PI)/180` 形状正确；v 翻转 `1.0 - phi/PI` 与 spec §4.4 及 legacy `UNPACK_FLIP_Y` 语义一致，u 侧用 `fract` 而非 `%`（截断取模会缝负角）理由成立。着色器内零投影 kind 数值字面量，常量全走 generated。
- **verify 全链 EXIT=0**（分支树亲跑）：`gen:shaders -- --check` → typecheck 三条腿 → lint → coverage 分支 **98.38%（122/124，与自报逐字一致）** → build。两个良性未覆盖分支（uniforms.ts:74 throw / backend.ts:414 版本短路）核实分类成立。
- **集成双环境亲跑**：真 GPU 6 文件/14 测试 exit 0；`CI=1` SwiftShader 6 文件/14 测试 exit 0——容差两边都成立，卡面「只在一边绿=容差定错了」的要求满足。
- **F5 定向变异亲测**：删 cylindrical 的 `- lat` 项 → gate-b「cylindrical responds to povLatitude」红（exit 1）；还原后 4/4 复绿、树净。纬度钉子有牙，卡面 M1 变异主张亲自复现。
- **门禁证据**：26 改动文件 = 24 白名单内 ＋ plan ＋ 卡（两者均卡面预告的常规伴随物）；28/28 commit 前缀合规；分支侧 plan 48/48 全勾、diff 仅勾选与勘误块；执行期 master 侧仅开工认领与卡同步两笔（4818c2e / 6d9f29d），无越权。

**留档（非阻断）**：

1. **Task 3 Step 5 的 grep 证据结构性落空**（协调者验收时发现）：`grep -c "fn to_uv" dist/index.js` 在本卡树上必为 0——`src/index.ts` 仍是 P1 stub，`vite build` 只变换可达模块（实测输出「1 modules transformed」，dist/index.js 0.09 kB）。该步被勾选但无勘误块。vitest 侧（`shaders.test.ts` 的 `?raw` 断言）真实跑过、build 真实跑过，故不阻断本卡；但 **`?raw` 经 `vite build` 的通路从未被证明**，P1 S1 勘误「vite lib mode 全部直接支持」仍是 build 未证状态。**移交 P5 硬要求**：P5 接线 viewer → renderer 后，必须实际跑一次 dist 产物含着色器源的断言（grep 或等价物），并在卡面回填证据。
2. npm audit 2 条 dev-only（brace-expansion HIGH / esbuild LOW）维持 P2 移交口径，处置待用户裁决。
3. 下游移交风险 9 条（P4 version 契约、P6 门禁 C 硬要求、P6 复用纪律、N3/N4 残留等）均在卡面登记，属正常移交。
