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

## 整改轮记录（2026-09-20，审查意见 ①–⑨）

**阻断项 ①–⑤ 全部整改**：

1. **uniform 流完整性锚**：每条 capture 记 `uniformsSha256`（对落盘文件字节），manifest 对账测试补断言。变异实证：`cylindrical/tilt` 的 `u_CamPOVLongitude` 20→999.5（协调者同款变异）→ 对账红，报 `uniforms.json on disk does not match index.json uniformsSha256`。
2. **基线输入锚**：index.json 顶层记 `sourceSha256`/`bundleSha256`（bundle 改为 Buffer 读，路由注入与哈希同源字节），新增「the two baseline inputs are pinned」测试。变异实证：source.png 翻中间一字节 → 输入锚测试红。
3. **软件栅格器谓词扩族并单源**：`isSoftwareRenderer` 提入 states.mjs（`/swiftshader|software|llvmpipe|lavapipe|softpipe/i`），capture.mjs 与 fixtures 测试共同消费，正则不再有两份拷贝。变异实证：renderer 植入 `llvmpipe (LLVM 15.0.7, 256 bits)` → provenance 测试红。README 措辞同步（不再声称宽于实际）。
4. **对账补磁盘方向**：manifest 测试升级为「the manifest and the fixture tree agree, in both directions」——递归枚举 fixture 树，磁盘文件集必须 == manifest 条目 ∪ `STATIC_FIXTURE_FILES`（README.md/index.json/bundle.js/source.png，白名单同在 states.mjs 单源）。变异实证：植入 `perspective/ghost.png` → 双向对账红并**指名孤儿路径**。意外收获：该断言首跑即抓获整改实现自身的 walk bug（`path.relative` 误放递归每层，子目录相对串被相对 cwd resolve 成幻影路径）——修复后断言与实现互证。
5. **capture 出口码 fail-closed**：capture.mjs 末尾 spawn `verify-fixtures.mjs`（剥 `NODE_TEST_CONTEXT`），suite 红即 `exit 1` 并明示 `capture completed but the fixture suite rejected the result`。README 再生指引同步声明出口码语义。端到端实证 ×2：第 8 次全量运行（walk bug 使 suite 红）capture 拒收自己的产物；黑帧变异（合法 143 字节纯黑 PNG + **同步篡改** pngSha256/pngBytes 骗过哈希对账）→ 唯内容神谕红（`only 1 distinct colours`）。

**顺带项 ⑥–⑨ 一并整改**（未声明跳过）：

6. 驱动侧超时：`page.setDefaultTimeout(60_000)`——GPU 进程楔死时不再无输出永挂。
7. 未钩 setter 守卫：probe 对原型上**全部** `uniform*` 方法动态枚举，除已钩三种外，在录制 target 上调用即抛 `probe has no hook for <name>`；非 target（不死 viewer）透传。未来 bundle 若启用 `uniform4f` 等即刻炸响，不再静默半录。
8. 帧数单源：`FRAMES_PER_CAPTURE` 入 states.mjs，capture/probe（`__FRAMES_PER_CAPTURE__` 占位，正向+反向校验防占位符丢失）/fixtures 测试三处消费。占位符校验重写为"源含 marker + 替换后无残留"双向（原单向校验是死码）。
9. skipped-0 断言：verify-fixtures.mjs 改 pipe 收集 TAP，`status !== 0 || !/^# skipped 0$/m` 即红——`BASELINE_VERIFY_NEGATIVE_TEST` 泄漏进外层环境时，负面测试的静默 skip 变成响亮的闸 6 红（消息指明 unset 该变量）。负拷贝场景不受影响（空 manifests 本就 status 1，先走老分支）。

**接受留档项确认不动**：maintainability 五条纯打磨（注释计数过期一条已随本套件 12→14 失效口径一并修正为不写死数字）、对抗 8（16 不死上下文零余量）以 ⑤ 的内容断言封死可观测后果、decodePng 短扫描线容忍维持原裁决、根 CI 归 P1。

**自测结果**：第 8–11 次全量捕获（8 因 walk bug 被 ⑤ 机制当场拒收——机制本身的端到端红；9–11 全绿）。第 11 次终态：16/16、capture 内嵌 verify **14/14**、出口码 0；git diff 中 32 个数据文件与上轮提交**逐字节相同**，index.json 仅 +锚点字段与 capturedAt——第十次实证基线幂等可重推导。

**整改中的失误如实记录**：变异实验恢复手段踩坑——对**未提交的新 index.json** 用 `git checkout --` 恢复会回到无锚点的 HEAD 版，造成 8/9 两测试假红；正确恢复手段是重跑 capture（幂等）。方法论留档：manifest 类未提交产物的变异恢复，一律走重跑生成器，不走 git。

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

（协调者填：逐条编号；通过则写 approve）
