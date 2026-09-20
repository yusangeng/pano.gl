---
plan: docs/superpowers/plans/2026-09-19-p0-freeze-baseline.md
scope: [tools/baseline/**, test/fixtures/baseline/**, .gitignore, docs/superpowers/specs/**]
verify: if [ -f tools/baseline/verify-fixtures.mjs ]; then (cd tools/baseline && node verify-fixtures.mjs); fi
bootstrap: (cd tools/baseline && npm install && npx playwright install chromium)
layer: foundation
state: reported
createdAt: 2026-09-19T08:51:52.107Z
---
# 任务：P0 — 冻结基线

开工先读 plan 头部。本卡把 v0.2.2 的 debug bundle 与它的一组渲染结果冻结进 `test/fixtures/baseline/`，P2 起的 CPU 参考实现和 P6 的门禁 C 都拿它当对照。

verify 写成条件式是**自举悖论**：`verify-fixtures.mjs` 是本卡自己产出的，合并前主分支上还没有它。条件式让「还没产出」等于「跳过」而不是永远红。**不要把条件式当冗余删掉。**

`tools/baseline/` 有自己的 `package.json`，**`package-lock.json` 是要提交的**（plan 的 `git add` 里就有它），只有 `node_modules` 进 `.gitignore`。worktree 建成后需要 `cd tools/baseline && npm i`，并 `npx playwright install chromium`。

**这里的 playwright 是合法的，不要改成 vitest。** 它驱动的是 v0.2.2 那个 webpack 产物的 debug bundle，是一次性取证工具，不是本包的测试套件 —— 本包的测试从 P1 起全部跑在 vitest 浏览器模式里。

`tools/baseline/fixtures.test.mjs` 用 `node --test` 跑，不走 vitest，也不需要 P1 的工具链。

## 完成报告

**做了什么**：plan 的 6 个 Task 全部完成——`tools/baseline/` 取证工具（`probe.html` 逐 drawArrays 录 uniform 流 + readPixels、`capture.mjs` 走 4 相机 × 4 状态矩阵、`states.mjs` 单一状态矩阵、`fixtures.test.mjs` 10 个断言、`verify-fixtures.mjs` 闸 6 入口），`test/fixtures/baseline/` 冻结产物（16 组 PNG + uniform 流 JSON、`source.png`、`index.json` 逐条 sha256/字节数、v0.2.2 debug `bundle.js`），README 记录取证方式与可复现性，spec §10.2/§11/§12 的 P0 行与全部【实测】标注同步更新。

**自测结果**：
- 卡 verify（`node verify-fixtures.mjs`）12/12 绿，含清单对账、内容神谕、可区分性与 verify 失败分支；
- 完整重捕获跑了四遍（最后一遍带着全部新断言）：16 PNG + 16 uniform 流逐字节相同，`index.json` 仅 `capturedAt` 变化——基线可按需重推导；
- `source.png` 逐像素解码核验 = 文档所记图案（16384 像素全对），防「拿别的图重渲染再比对」；
- 破坏实验 ×2：翻转任一 PNG 单字节 → 清单对账测试红；植入哈希已同步篡改的合法纯色 PNG → 清单测试被骗过、**只有内容神谕红**——它防的正是清单管不到的「渲染成功但内容是垃圾」。

**偏离 plan 的点**（均为等价或加强）：
1. 探针 API 依实测修正：构造参数是 `{el, src, camera}`（plan 原文 `container`/`cameraOptions` 不存在于 v0.2.2）；`rotate(lat,lng)` 实为**增量**旋转且首参是经度。
2. plan 写「等两帧」，实测改为「等三帧全收、取末帧」——第二、三帧是稳态证据，且等录制数而非数 rAF tick，杜绝差一帧静默成功。
3. `index.json` 每条加了 `pngSha256`/`pngBytes`/`uniformNames`/`frameCount`（plan 只要求清单）；对应新增对账测试，哈希列是**被执行的约束**不是装饰。
4. fixtures 测试 12 个（plan 设想 6 个）：多出「manifest 与磁盘对账」「verify 失败分支」「内容神谕（解码 PNG 断言 ≥1000 distinct 色）」「投影与姿态像素级可区分」四个，且第 4 个（旋转到达 GPU）按相机族分别断言载体 uniform，重写为 plan 未展开的形式。
5. plan Task 6 Step 3 的文件名笔误 `...-redesign.md`，实际提交为 `...-design.md`。

**实测确立的四项根因**（供 P2+ 直接消费，均在 spec §11 与 README 留档）：`u_CamPOVLatitude` 是死 uniform（纬度原理上到不了 GPU，V3 结案）；非线性相机 pose 只走 `u_CamPOVLongitude`（`u_CamTransMatrix` 跨状态逐字节恒定）；`% 25` 经度守卫逐值吻合（45→20、180→5、300→0）；缩放夹取是单向的（cyl/planet 放大整个丢弃，`cylindrical/zoomed`、`planet/zoomed` 与 `origin` 逐字节相同）。另：L1 的 dispose 拼写错误使 rAF 循环永不停止——探针按 canvas 身份过滤绘制正是为此。

**遗留风险**：
1. 基线的逐字节可复现限于**同机同 Chromium 构建**；异机 GPU 圆整差异是真实风险，README 已写明处置原则（差异出现先怀疑浏览器构建，动基线须显式决策）。
2. `tools/baseline/` 是第二个依赖树（playwright）。根包发布时应在 `files`/`.npmignore` 排除之——属 P1 打包范畴，本卡不动根包配置。
3. `bundle.js`（1.5MB，v0.2.2 产物）占了交付字节的大头。它是「冻结 v0.2.2 渲染行为」的物证与重捕获前提，保留；若 P7 清理时判定可由重捕获产物替代，届时裁决。
4. 【休眠，审查员留档】栅格器取证依赖 `WEBGL_debug_renderer_info`：若未来 Chromium 禁用该扩展，探针回退到 masked `gl.RENDERER` 的泛型字符串（"WebKit WebGL" 之类）——它可通过 `/swiftshader|software/i` 正则但不携带任何来源。信号是 `index.json` 的 `renderer` 字段**内容变模糊**（字段存在性测试不会红，这是设计而非漏洞）。处置：regeneration 时 renderer 出现在 diff 里即显式决策点，先查明扩展是否被禁用再决定基线动不动。今日 chromium 暴露该扩展，风险未激活。

## 自审记录

### CR 结论

**手段**：两轮。第 1 轮自查（通读 diff + 逐条实证 spec 里的【实测】声明 + 对照 bundle.js 源核探针 API）；第 2 轮两个独立 subagent 并行审查（`general-purpose`/sonnet，一个审采集器 probe.html/capture.mjs/states.mjs，一个审测试套件），并明确约束不跑 Playwright、限调用数。中间三次 subagent 派遣因 stream watchdog 停滞、一次因 API 断连失败，最终两份报告均有效送达——独立审查真实发生，非自查充数。（gstack /review 与 codex 不可用：codex 未安装，gstack 需交互式决策，subagent 审查是本环境可用的最强独立手段。）

**第 1 轮发现 → 整改**（commit `3acb6cc`）：
1. probe.html 未断言画布实际尺寸——readPixels 固定读 128×128 原点矩形，别的尺寸会被静默裁切收录 → 构造后校验 canvas 尺寸链路。
2. fixtures.test.mjs 遍历含 error 桩的 captures 会产生 TypeError/ENOENT 噪声掩埋真实信息 → `captured()` 过滤 + 完备性由前两个测试直接断言。
3. README 未记录可复现性 → 补 Reproducibility 节（两次全量捕获逐字节相同）。

**第 2 轮发现 → 整改**（commit `bbe131c`，5 条全实锤）：
- 采集器侧 2 条：三帧「稳态证据」只收不断言、probe 注释自相矛盾（首帧 vs 末帧）→ capture.mjs 断言三帧 uniforms+pixels 全等否则拒收，注释改为如实描述；fixture 目录跨次运行不对账（旧成功文件留在新 error 桩旁、半写 png+陈旧 uniforms 可成对出现）→ 运行前清空相机目录、失败态删除残留文件。
- 测试侧 3 条：「PNG 解码」测试只查 4 字节签名（截断文件可过、尺寸从未与 canvasSize 挂钩）→ 内建解码器断言 IHDR 尺寸；无内容神谕（死上下文的纯色帧通过全部结构检查）→ 解码断言 ≥1000 distinct 色（实测最低 5774）；缩放夹取针对缺失 u_CamZoom 静默 `continue`（uniform 消失 = 针无声蒸发）→ 按相机断言存在/缺席。
- 两份报告的「已核无误」清单（canvas 身份闸、pending 归帧、bundle 仅有三种被钩的 uniform setter、单一 drawArrays 调用点、`rotate` 增量语义与实测相符）作为反向确认留档。

**整改后复审**：两条变异实验反向验证（单字节翻转必红；合法纯色+同步篡改哈希只被内容神谕抓住）+ 第 4 次全量捕获带全部新断言 16/16 通过且逐字节复现。CRITICAL / INFORMATIONAL 清零，共 2 轮。

**第 3 轮（交卷后送达的复审）**：两位审查员的复审钉在 `0438e3a`——即整改提交 `bbe131c` 的父提交——所报 5 条中 4 条为陈旧（内容神谕/IHDR 解码/缩放针存在性/三帧稳态断言，均已在 `bbe131c` 落地并带变异验证）；**1 条新发现实锤并整改**：harness 无硬件栅格器断言——`channel: 'chromium'` 的"load-bearing"只是注释声称，headless chromium 在 GPU 进程起不来时（CI 容器/VM）静默回落 SwiftShader，且 index.json 不记渲染器字符串，软件渲染的伪基线与真基线不可区分。整改：probe.html 经 `WEBGL_debug_renderer_info` 读 unmasked renderer（读毕即 `loseContext` 归还，避免挤爆 16 个不死 viewer 之上的上下文上限）；capture.mjs 采样于任何捕获之前，命中 `/swiftshader|software/i` 即拒绝运行，字符串记入 index.json；fixtures.test.mjs 新增断言（记录缺失或软件渲染即红），使闸 6 每次都重执此约束而非只在捕获时执行一次。实测本机 renderer 为 `ANGLE (Apple, ANGLE Metal Renderer: Apple M2)`——既有 4 次捕获确系硬件栅格化，此发现属"堵未来静默回落"而非"既有基线错了"。变异验证：植入 SwiftShader → 红；字段缺失（旧 index.json）→ 红。第 5–7 次全量捕获 16/16、数据文件逐字节复现，index.json 仅 +renderer+capturedAt。

**第 3 轮终审闭环**：整改后两位审查员均在 HEAD 亲自核实（非采信整改声明）——rev-harness2 逐行验证三帧深比较与 renderer 采样/拒绝/落盘；rev-tests2 重读三个修复点、复核 `decodePng` 解码正确性（chunk 遍历/形状守卫/五种滤波含 Paeth）并实跑套件 13/13。双方结论：No findings remain。随附两条已论证的非缺陷备注留档：decodePng 跳过 CRC（sha256 清单已钉住字节漂移）、不校验 inflate 后扫描线长度（损坏流要么 inflateSync 抛异常要么解码为全零、由内容神谕拦下）；"看起来合理但语义错误"的渲染不是 fixture 校验器的职责边界，属 gate-a/gate-b。CR 三轮全部闭环。

**第 4 轮（协调者终审打回 ①–⑨，本卡整改轮）**：三轮闭环后协调者以独立变异实验打回——其 `u_CamPOVLongitude 20→999.5` 变异在 13/13 全绿下通过，证明 uniform 流无完整性锚（①），连带指出输入锚缺失（②）、软件栅格器谓词漏 llvmpipe 族（③）、对账单向（④）、黑帧出口码 0（⑤）五个阻断项与 ⑥–⑨ 四个顺带项。整改全录见上方「整改轮记录」。CR 结论：协调者的变异不是理论威胁——本轮自证时五个变异（锚点篡改 / source 翻字节 / llvmpipe 植入 / 孤儿文件 / 同步哈希黑帧）逐一复现"过去全绿"，逐一在新断言下变红；且 ④ 的新断言首跑抓获整改实现自身 walk 相对路径 bug、⑤ 的 fail-closed 在第 8 次全量捕获中真实拒收过一次产物——两个机制都经受了计划外实战。协调者要求的三个必红（锚点篡改、llvmpipe 植入、黑帧）均以实际红屏验证，非推演。CR 四轮全部闭环。

### 测试质量结论

**手段**：effective-testing 清单（维度 0–4 + 反模式 A–F）审查 `fixtures.test.mjs` + `verify-fixtures.mjs`，缺陷思维实验驱动（逐类破坏基线数据，看套件是否变红）。

**发现 → 整改**（循环 2 轮收敛，终态 CRITICAL 0 / WARNING 0）：
1. 【CRITICAL 级】`index.json` 的 `pngSha256`/`pngBytes`/`uniformNames`/`frameCount` 从不与磁盘对账——手改 PNG + 陈旧清单可过闸。整改：新增「manifest 与磁盘对账」测试（哈希、字节数、帧数、uniforms.json 内 camera/state 身份、拒绝 `'?'` 占位名、磁盘名字集 == 清单名字集），并做了变异验证（翻 1 字节必红）。
2. 【CRITICAL 级】`verify-fixtures.mjs` 失败分支从未执行过，且从 node:test 上下文内运行时继承 `NODE_TEST_CONTEXT` 使嵌套 runner 什么也不跑就退出 0——闸 6 信任的出口码在该场景静默变空。整改：wrapper 剥离该标记；新增负面测试（临时目录副本 + 空 manifests → 断言退出码 1 且 stderr 给出重捕获指引；env 护栏防副本自我递归）。
3. 【WARNING 级】同相机两个 state 的 uniforms.json 互换不可测、probe 名字恢复链路（`'?'` 回退）无断言 → 并入上述对账测试。
4. 【WARNING 级】6 个测试重复读 `index.json` → 提升为模块级单次读取。

**追加轮（独立测试审查，CR 第 2 轮的测试侧 3 条，commit `bbe131c`）**：套件升至 12 个——PNG 真·解码（IHDR 尺寸绑定 canvasSize）、内容神谕（≥1000 distinct 色，实测最低 5774，纯色帧 1）、投影/姿态像素级 pairwise 可区分（测量先行，仅有的字节相等对是已被有意钉住的两个简并态）、缩放针存在性断言。变异验证：合法纯色 PNG + 同步篡改的哈希能骗过清单对账，唯独内容神谕红——「结构合法但内容是垃圾」从此有网。

**整改轮变异实验补（协调者打回后的自证，套件 12→14）**：本轮在整改断言落地后新跑五组变异，全部必红且报错指名要害：
1. **锚点篡改必红**——`cylindrical/tilt` 的 `u_CamPOVLongitude` 20→999.5（协调者同款变异，上轮 13/13 全绿通过的那一个）→ 对账测试红，`uniforms.json on disk does not match index.json uniformsSha256`。
2. **llvmpipe 植入必红**——renderer 字符串植入 `llvmpipe (LLVM 15.0.7, 256 bits)`（③ 扩族后的谓词目标）→ provenance 测试红。同族变异：谓词正则若仍只匹配 swiftshader/software 则此变异依旧全绿，这正是 ③ 成立的理由。
3. **黑帧必红**——合法 143 字节纯黑 PNG + **同步篡改** pngSha256/pngBytes（哈希对账被刻意骗过）→ 唯内容神谕红（`only 1 distinct colours`）；且 capture 出口码经 ⑤ 改造后连带此红一起变 1，重捕获指令的信任链闭合。
4. source.png 中位字节翻转 → 输入锚测试红（② 的正向验证）。
5. 植入 `perspective/ghost.png` 孤儿 → 双向对账红并指名路径（④ 的正向验证）；该断言首跑即抓获实现自身 walk 相对路径 bug——断言有效性收到了一次计划外实证。

另：⑨ 的 skipped-0 断言无法用变异验证（需泄漏 `BASELINE_VERIFY_NEGATIVE_TEST` 的完整环境），其逻辑以代码审读闭环——TAP footer 的 `# skipped N` 由 node:test 自身产出，非本套件可伪造。

**覆盖陈述**（改动触及的路径，哪些有测试网 / 哪些没有 / 为什么）：
- **有网**：`verify-fixtures.mjs` 两个分支（成功=每次 verify；失败=负面测试，含 env 剥离回归）；`states.mjs` 的 STATES/CAMERAS/CANVAS_SIZE（完整性测试遍历矩阵，间接消费 `captureId`）；`test/fixtures/baseline/**` 全部数据（每个 PNG 逐哈希、每份 uniforms.json 结构与身份、矩阵完备性、死 uniform、简并态合成）。
- **没有网**：`probe.html`、`capture.mjs` 的代码路径。原因：二者只能在带 GPU 的真浏览器里跑，单测里 mock WebGL 等于测 mock 而不是测本基线要钉死的栅格化行为。它们的**输出**即被测物（上述数据网），它们的失败路径（画布尺寸不符 / 无帧 / 超时）在两次真实完整捕获中实际执行过，失败会落成 index.json 的 error 桩，而测试 1+2 对 error 桩是响亮失败。
- vitest/90% 分支覆盖等要求自 P1 起适用——本卡在 v1 工具链之前，用 node:test 是 plan 明文约定。

## 审查意见

**结论：打回整改**（2026-09-20，superloop-verify 第 5 关）

**手段**：gstack /review 全流程——主审 CRITICAL 清单（本 diff 无 SQL/竞态/LLM 信任/注入命中；枚举三张映射 EXPECTED/CARRIER/EXPECTS_ZOOM 由 states.mjs 单源驱动、四相机全覆盖）＋ 三专家子代理并行（testing / maintainability / 对抗，对抗侧自行在 /tmp 导出副本跑变异实验）＋ 最重发现逐条亲验（主审独立复现两场变异实验，与对抗侧互证）。

**整改项（阻断，逐条编号）**：

1. **uniforms.json 内容无完整性锚**（capture.mjs:88、fixtures.test.mjs:225；变异实证：cylindrical/tilt 的 `u_CamPOVLongitude` 20→999.5 后 13/13 仍绿，主审独立复现）。index.json 钉了 pngSha256/pngBytes，却没给本阶段**自述的主要产物**（uniform 流，P2 对拍与 F10/F11 结论的唯一载体）任何哈希。对账测试只查 camera/state 身份、帧数、名字集——永不查值。意外向量：JSON 重排、坏合并、Windows autocrlf 对 .json 的 LF→CRLF 静默改写（PNG 二进制免疫，JSON 不免疫）。**整改：每条 capture 记 `uniformsSha256`（对落盘文件字节），对账测试补断言。**
2. **两个基线输入均无锚**（capture.mjs:88；亲验：套件对 source.png/bundle.js 零引用，index.json 无对应字段）。source.png 是 16 组捕获的唯一输入函数，bundle.js 是被测物本身（1.5MB、17k 行）——截断/换错/静默漂移零信号，直到下游 gate-a 以"渲染器代码问题"的假象爆红。捕获时你已人工逐像素核验 source.png（16384 像素）并核过 bundle 标记——缺的是可重跑的永久断言。**整改：index.json 记 `sourceSha256`/`bundleSha256`，对账断言。与 ① 同机制，一次改完。**
3. **软件栅格器门放行 llvmpipe 族**（capture.mjs:70、fixtures.test.mjs:264；变异实证：renderer 字符串植入 `llvmpipe (LLVM 15.0.7, 256 bits)` 后 provenance 测试照过，主审静态核正则一致）。`/swiftshader|software/i` 不含 llvmpipe/lavapipe/SoftPipe——恰是 headless Linux CI 的默认软栅格，即该门存在的目标环境；README 声称"refuses … on a software rasterizer (SwiftShader *et al*)"宽于实际执行。且正则在两文件重复，违背 states.mjs 自己申明的共享谓词原则。**整改：扩充模式（llvmpipe/lavapipe/softpipe），谓词提入 states.mjs 单源，两处消费。**
4. **对账单向，孤儿文件对 verify 隐形**（fixtures.test.mjs:215 只走 manifest→磁盘；capture.mjs:99 的清理循环只遍历现存 CAMERAS）。矩阵里改名/移除相机或状态后，旧 fixture 永久滞留且 verify 常绿——capture.mjs:91–96 的注释自己点名了这个失败模式，却只堵了一半。**整改：对账补磁盘方向——递归枚举 fixture 树，断言 磁盘文件集 == manifest 条目 + 静态白名单（index.json/README.md/bundle.js/source.png）。**
5. **capture.mjs 对结构合法的垃圾帧 exit 0**（capture.mjs:129–133；机制亲验：probe.html:57 先记后调，上下文丢失时 wrapper 照录、readPixels 零填充，三帧互等的黑帧通过全部捕获侧断言）。steady-state 只比帧与帧，从不比内容；内容神谕（≥1000 distinct 色）只在 verify 里，而 README 与 verify-fixtures.mjs 的再生指引都止于 `node capture.mjs`——按文档再生的操作者信出口码即提交黑基线。上下文逐出（L1 死循环 + 16 不死 viewer 恰在 ~16 上限、零余量）使这是活场景而非假设。**整改：fail-closed——capture.mjs 末尾 spawn `verify-fixtures.mjs`（红即 exit 1），或驱动侧对每帧断言 distinct 色数。**

**顺带整改（非阻断，可声明跳过，但在 worktree 里顺手）**：

6. 驱动侧无超时（capture.mjs：全文无 setDefaultTimeout；页/GPU 进程楔死时 page.evaluate 永挂，无输出无 index.json 无失败）。`page.setDefaultTimeout` 或每 evaluate 加 race。
7. probe 只钩三种 uniform setter（probe.html:45–47；亲验 v0.2.2 bundle 今日确只调这三种——这是面向未来的加固而非当下缺陷）。给其余 `uniform*` setter 打"未钩即抛"补丁，防未来 bundle 静默漏录。
8. 帧数 `3` 三处硬编码（capture.mjs:16 命名 / probe.html:280 / fixtures.test.mjs:232）——提入 states.mjs，probe 走 `__CANVAS_SIZE__` 同款占位替换。
9. 负面测试护栏 `{ skip: env === '1' ? … : false }`：变量若泄漏进外层 env 即静默跳过（node:test 只在 `# skipped` 计数里可见，无断言查零）。加 `# skipped 0` 断言或反转护栏语义。

**接受留档（不改，理由如下）**：

- maintainability 五条（注释"six tests"过期、FIXTURE_ROOT 双拼、路径拼法三套、pairwise 循环 DRY）：纯打磨，随 ⑧ 顺带可做，不据此阻断。
- 对抗 8（16 不死上下文恰在上限、零余量）：事实成立，但 ⑤ 的内容断言已封死其可观测后果（黑帧必红）；卡片留档为再生时的已知边界即可。
- decodePng 短扫描线容忍：① 落地后字节被 sha256 锚死，内容神谕兜底——维持执行者自审时的例外裁决。
- 套件未接根 CI：P1 起工具链属主，本卡不动根包配置（卡片遗留风险 2 已声明）。

**行为性声明核验**：测试套件于分支导出副本亲跑 **13/13 绿**、verify 包装出口码 0（自报"12/12"为 round-3 加测前旧计数，与你方叙述自洽）；四项根因（u_CamPOVLatitude 死 uniform、非线性 pose 只走 u_CamPOVLongitude、`% 25` 归约 45→20/180→5/300→0、单向缩放夹取致 cyl/planet zoomed==origin 逐字节）全部亲验吻合；u_CamTransMatrix 非线性跨 4 态恒定 / perspective 4 态各异实证；bundle 含 PanoGL 与内联 GLSL，1.49MB。

**门禁证据复核**：47 个 diff 文件全在 scope 白名单；17/17 commit 前缀合规；自审三轮收敛真实（含双方变异验证，非自查充数）；覆盖陈述如实枚举了有网/无网路径——但"完整性锚定"的覆盖面判断存在系统性盲区（①②④的根因）：网只织到 PNG 就停了。这不是流程违规，是校准问题，供你方后续自审参考。

**整改路径**：主检出 `task-claim` 认领（rejected→fixing）→ 进原 worktree 续干（分支已存在，**不跑 task-go**）→ 重读本卡 → ①–⑤ 必改、⑥–⑨ 顺带 → 全量重捕获（你方已证逐字节可复现，index.json 预期只增锚点字段与 capturedAt/renderer 复现）→ 自审两节更新（变异实验补：锚点篡改必红、llvmpipe 植入必红、黑帧必红）→ `task-finish` 交卷。复审时我将重跑上述三组变异实验。

---

## 审查意见（复审，2026-09-20）

**结论：approve，合并。**

**复审手段**：协调者直审整改增量（`c785924` + 卡同步 `c50d6ac`，约 200 行代码增量逐 hunk 亲读）＋ 四组独立变异实验于净导出副本亲跑（按收窄后的轮询编排：变异实验为主审亲执，不再整建制派专家团——整改轮的评审对象是九条已知结论，不是开放式发现）。

**①–⑨ 逐条核销**：

1. ✅ `uniformsSha256` 对落盘字节记录，对账测试断言磁盘哈希。**变异复验**：同款 `u_CamPOVLongitude` 20→999.5 篡改（上轮 13/13 全绿的那一个）→ 对账红，报错指名 `uniformsSha256` 不符。
2. ✅ `sourceSha256`/`bundleSha256` 顶层入 manifest（bundle 改 Buffer 读，路由注入与哈希同源），新增输入锚测试。
3. ✅ `isSoftwareRenderer` 单源谓词（+llvmpipe/lavapipe/softpipe），capture 与测试共同消费，正则双份拷贝消除。**变异复验**：植入 `llvmpipe (LLVM 15.0.7, 256 bits)` → provenance 红。
4. ✅ 双向对账：递归 walk、`STATIC_FIXTURE_FILES` 单源白名单，orphaned/missing 双向断言。**变异复验**：植入 `orphanCam/ghost.png` → 对账红。执行者留档的 walk 相对路径 bug 被该断言首跑自擒，属断言有效性的计划外实证，采信。
5. ✅ capture 末尾内嵌 verify（剥 `NODE_TEST_CONTEXT`），红即 exit 1。**变异复验（最强攻击形态）**：合法纯黑 PNG + **同步篡改** pngSha256/pngBytes 骗过哈希网 → 唯内容神谕红（distinct 色数）。出口码信任链闭合。执行者第 8 次全量捕获被该机制真实拒收过一次（walk bug 触发），机制经受过计划外实战，采信。
6. ✅ `page.setDefaultTimeout(60_000)`。
7. ✅ 动态枚举全部 `uniform*` 原型方法，未钩者在**录制 target 上**抛错（canvas 身份闸语义正确：不死 viewer 透传），未来 bundle 启用 `uniform4f` 等即刻炸响。
8. ✅ `FRAMES_PER_CAPTURE` 单源三处消费；占位符校验改双向（顺带发现并消除原单向校验死码——超整改范围的诚实发现）。
9. ✅ TAP `# skipped 0` 断言入 wrapper；泄漏场景无法变异构造（需泄漏完整环境），以代码审读闭环：TAP footer 计数由 node:test 自身产出，非套件可伪造。裁决：接受。

**亲验汇总**：分支净导出实跑 **14/14 绿、0 skipped、wrapper 出口 0**；manifest 三锚点字段在案；`0668175..branch` 区间 32 个数据文件 diff 为空——"逐字节未变"声明属实，基线幂等第十次成立。commit 前缀合规、scope 全在白名单、整改轮记录如实（含自身失误留档，佳）。

**遗留按留档处理**：maintainability 五条、对抗 8 上下文余量、decodePng 扫描线容忍、根 CI 归 P1——理由成立，随卡留档。

**给执行者的校准反馈（随卡留档，无动作项）**：本轮整改质量高于首轮交付——九条全中、零越界文件、五个变异自证先于我复验。上轮的盲区（网的边界）本轮自审已内化：你们自己的孤儿断言抓住自己 walk bug、fail-closed 拒收自己第 8 次产物，都是"问网外"的行为。保持这个问法。
