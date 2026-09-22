---
plan: docs/superpowers/plans/2026-09-19-p4-media-interaction.md
scope: [src/core/events.ts, src/media/**, src/interaction/**, scripts/gen-fixtures.mjs, public/fixtures/**, test/**, vitest.config.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: domain
deps: [p3-renderer-webgpu]
state: merged
createdAt: 2026-09-19T08:51:52.642Z
---
# 任务：P4 — media + interaction

开工先读 plan 头部第 1、2 条：`src/media/` 里**不允许出现 `frameSize` 或它的任何同义词**（上传尺寸由后端按 device limit 决定），`SourceState` 由 core 定义、本层只组合，不重新定义。

**`src/core/events.ts` 是 foundation 层的，先做它** —— `EventEmitter` / `Disposable` 不依赖本卡其余任何东西，后面的 media 与 interaction 都建在它上面。

同样**没有桥**：本卡的集成测试直接 `import src/media/` 与 `src/interaction/` 的类，**不要重新长出 `demo/test-entry.ts` / `test-entry-hooks/` / `window.__panoTest`**。完成标准里有一条就是在查这个，写完自己 `git grep` 一遍。

Task 2 Step 7 用 `scripts/gen-fixtures.mjs` 生成两个集成测试素材（`public/fixtures/panorama.png` 与 `clip.mp4`）。**需要本机有 ffmpeg，产物要提交**（消费方不需要装 ffmpeg）：P5 的五个 User Story 和 P6 的后端对比都读它们，缺了 P5 那一卡做不下去。提交前用 `ffprobe` 复核 512x256 / 64 帧。

verify 用的是 `npm run test:coverage` 而不是 `test:unit`：**分支覆盖 ≥90% 是构建失败而不是目标**，`test:unit` 不带覆盖率会静默放过它。`vitest.config.ts` 在本卡 scope 里就是这个用途 —— `image-source.ts` / `video-source.ts` 这类围着 DOM 与解码器转的代码如果拉低了门槛，**首选补测试**，确实测不到才加 exclude 并写明理由。**不要删 `thresholds`。**

## 完成报告

**做了什么**：plan 五个 Task 全部落地。
- T1（foundation）：`src/core/events.ts` —— `EventEmitter<M>`（on 返回退订函数、快照迭代、typed wildcard）与 `Disposable`（幂等 dispose、assertAlive），13 条单元测试。
- T2：`src/media/source.ts`（`MediaSource` 接口、`MediaFrame = RenderableSource` 别名、共享 `MEDIA_EVENT_MAP`）+ `src/media/downscale.ts`（仅按 device limit 缩放，无 2 的幂量化，零维抛 RangeError）+ `scripts/gen-fixtures.mjs` 与两个已提交素材（`panorama.png` 1839B、`clip.mp4` 4886B，ffprobe 复核 `512,256,64`）。
- T3：`src/media/image-source.ts` —— 8 个 DOM 监听器单 AbortController 收口、未加载读 `frame` 即抛、`listenerCount` 公开可读、dispose 释放解码位图；7 条集成测试。
- T4：`src/media/video-source.ts` —— 10 个监听器同收口、每读 `frame` 必新对象、`load/play/seeked/ended` 四事件推进版本号、`markFramePresented` 带 paused/ended 守卫；12 条集成测试；`test/integration/support/upload-paths.ts` 探针直驱两个浏览器 API，钉住 external / copy 两条上传路径朝向一致（硬件 adapter 上 maxChannelDiff = 1 ≤ 容差 2）。探针在**软件 adapter**（CI 的 SwiftShader）上取不到视频帧，此时返回 `kind: 'unavailable'` 由调用方响亮跳过 —— 该分支只在同一次运行里当场量到「素材解码有对比度」与「同 device 常量色可读回」两个控制之后才可能返回，坏素材与瞎子设备仍是硬失败（见「整改记录」与 plan 末尾整改轮勘误）。
- T5：`src/interaction/gestures.ts`（wheel/pinch/drag 纯函数识别，Node 可测）+ `src/interaction/input-controller.ts`（Pointer Events、单 AbortController、touch-action 借用并还原、PTZ 开关不重绑）；19 条单元 + 11 条集成测试。

**自测结果**：分支 25 commits（21 files，+2580/−49；全部 `task-p4-media-interaction:` 前缀）。verify 六连全绿：`gen:shaders --check` up to date；`typecheck` 三程序；`lint` 0 错；`test:coverage` 206/206、99.17 / 98.10 / 100 / 99.70（90 门槛未动）；`test:integration` 45 条 —— 本机硬件 adapter 45/45（真实 WebGPU adapter 守卫），CI（`CI=1`，软件 adapter）44 passed | 1 skipped，跳过项为 video-orientation 且理由随注（见「整改记录」）；`build` 产出 dist/。终审于 `7c51586` 当面复跑六连全绿，同结果。

**口径更正（协调者意见 2）**：本节原写「分支 13 commits（+2360/−33）」，其中 **13 是陈旧计数**（13 = 到 `ed7203b` 为止的累计数，T4 feat 刚落地），**+2360/−33 与 20 files 才是终审 HEAD `7c51586` 的真值**。上一轮交卷时（`c02d064`）的真值是 22 commits / 21 files / +2399−49（协调者量得，与本卡 +2360−33 的差额 +39/−16 正是终审之后那几笔），本次整改后为 **25 commits / 21 files / +2580−49**。终审的覆盖范围见「自审记录·CR 结论」的如实表述。

**偏离 plan 的点**：全部登记在 plan 各 Task 勘误块（逐条可查），要点：T1 plan 的 `Disposable.dispose` 函数体过不了自身测试（改影子方法实现）、`on()` 闭包断言被 tsc 拒绝；T2 三处被仓库检查器否决（删未用 import、gen-fixtures JSDoc 化 —— 产物逐字节不变、未推送 reset 对齐）+ 四类补测；T3 coverage exclude（理由随注，thresholds 未动）+ 六类补测；T4 探针两处被实测否决（`copyExternalImageToTexture` 不缩放、Chromium 暂停视频无 GPU 后备帧需先 seek）+ 六类补测；T5 结构性缺陷修复（`setPointerCapture` 对合成指针抛 NotFoundError：跟踪先行 + try/catch 降级）+ 11 条补测 + 两处注释勘误 + 质量审查报告自身提议的 helper 形态被 tsc 否决（TS2322，控制器独立复现后采纳块体改法）。

**风险 / 留档**：
1. `test/integration/image-source.test.ts:8` 的说明性注释提及 `__panoTest`（内容是解释「没有这个桥」）；P7 的悬空引用 grep（docs/ 之外须为空）会命中它 —— 届时改写该注释即可。CLAUDE.md 的同类陈旧段落已于 P1 登记，重写归 P7 Task 4。
2. `src/renderer/backend.ts:48-53`（P3 产物，不在本卡 scope）的 TSDoc 称上传门槛「只比较 version」，实际实现另比较 element 同一性（backend.ts:414）—— 文档比代码严、行为正确，P4 的按源版本号在换源时因此安全；文档修正归后续层。
3. `emit` 载荷在全部 8 个事件上携带 `error: undefined`（仅 media-error 声明该字段）—— 联合成员匹配可编译，运行时无害；留档不改。
4. `ImageSource` 的 `maxTextureDimension` 可选（默认 8192）而 `VideoSourceOptions` 必填 —— 不对称仅是 ergonomic 小瑕疵，P5 会传真实 device limit，无行为风险。
5. 三个 DOM 绑定类（image/video-source、input-controller）在 coverage exclude 中（`vitest.config.ts` 内附理由）；其行为由浏览器集成套件覆盖，但该套件不报告覆盖率 —— 双 project 结构的既定取舍。
6. **软件 adapter 上视频帧不可观测**（CI 的 SwiftShader）：`importExternalTexture` 与 `copyExternalImageToTexture` 对 `<video>` 元素都采出全黑帧，而同一素材经 `drawImage` 解码是有对比度的真帧、同 device 画常量色也读得回来。因此 orientation 探针在该环境响亮跳过。**下游要接这一条**：P6 的跨后端像素对比若包含视频，必须带同样的守卫，否则会拿到「黑对黑的一致」（已写入 plan 末尾整改轮勘误第 3 条与「交给下游的东西」表）。
7. **一处未解释的实测（留档不建屋）**：`copyExternalImageToTexture` 从 2D canvas 上传曾成功过一次（读回与填充色精确相符），此后全尺寸、双 adapter、各种 settle 变体一律 max 0，而同文件常量色控制始终读回 191。因不可稳定复现，canvas 控制被整个放弃，改用两条可稳定重测的控制；**在软件 adapter 上「canvas → 纹理」同样不可依赖**。
8. `if (result.kind === 'unavailable')` 这条分支之下，`ctx.skip` 使该用例在 CI 记为 skipped 而非 passed —— 这是有意的：ci.yml 的 per-project 计数断言（`grep -cF "|$project ("`）要求 integration 与 no-webgpu 各非零，已模拟复核为 `integration` 44 / `no-webgpu` 1，均在。

### 整改记录（2026-09-22，协调者打回后）

**意见 1【阻塞】· CI 上 video-orientation 确定性红 —— 已整改，落地 `7df8d96`。**

先复现再定性：在 `CI=1`（Chromium 落到 SwiftShader 软件 WebGPU）下跑集成套件，红在探针自己的对比度守卫上，与协调者的描述一致。随后用两个临时探针把「有没有可用的取帧方式」量到底（测完即删，未留在树上）：

| 量的是什么 | 软件 adapter（`CI=1`） | 硬件 adapter（本机 Metal） |
|---|---|---|
| 渲染 + 读回（常量色） | 64/127/191 | 64/127/191 |
| canvas → 纹理上传 | max 0 | max 0（首轮探针曾读到 74.67/191.67，见意见 2 外的留档第 7 条） |
| video → 纹理（两条 API 都试） | 全黑（上下半 0 / 0） | 96.31 / 117.66 与 96.33 / 117.67 |
| 解码器帧（`drawImage` + `getImageData`） | 89.81 / 118.18（对比度 28.4） | 同左 |

结论：**整改方向 (b) 不成立** —— 软件 adapter 上没有任何方式能把 `<video>` 变成可用纹理，所以按协调者给出的方向 (a) 做响亮跳过。

改法：`renderVideoBothPaths` 的返回类型从 `{ external, copy }` 改为结果联合 `VideoPathComparison`（`kind: 'rendered' | 'unavailable'`，沿用仓库既有的 `kind` 判别式写法）。调用方遇到 `unavailable` 先 `console.warn` 再把理由交给 `ctx.skip`（`skip` 的类型是 `never`，所以用 `return ctx.skip(...)` 收窄联合，无需断言）。

关键在于**这个跳过不是无条件放行**：`unavailable` 只在同一次运行里当场量到下面两个控制之后才可能返回 ——
1. 素材控制：绕开 WebGPU，用 `drawImage` + `getImageData` 量解码器里的上下半对比度，不够即抛错（CI 实测 28.4）；
2. 设备控制：常量色 fragment（无纹理、无绑定）读回为 `max 191`，全 0 即抛错。

于是坏素材仍是硬失败、瞎子设备仍是硬失败，只有「素材有帧但上不了纹理」这一种机器才会走到跳过。守卫的理由串里带上 adapter 自报的 `vendor` / `architecture` 与上面当场量到的三个数字，CI 日志里能直接读出「这台机器是谁、为什么跳过」。

顺带修掉一个**假通过**：软件 adapter 上 copy 路径的读回同样是黑的，若只比 external 与 copy 会得到 0 对 0 的「相等」；是上下对比度守卫把这种情形变成响亮失败 —— 这条也是探针一开始就不该只做两两比较的原因。

**验证**：`CI=1 npx vitest run --project integration --reporter=verbose` → `Test Files 10 passed (10)`、`Tests 44 passed | 1 skipped (45)`，跳过行理由完整；模拟 ci.yml 的 per-project 断言得 `integration` 44 / `no-webgpu` 1（均非零）；本机硬件 adapter 下同一用例照常 `1 passed`；`typecheck` 三程序与 `lint` 均 0 错。

**意见 2【随卷修正】· 自报数字过期 —— 已更正。** 见「自测结果」下的口径更正段与「自审记录·CR 结论」的覆盖范围表述；plan 文本里的同一处陈旧口径也已就地更正并登记（整改轮勘误第 4 条）。

**本轮未新增未决项**：无超出 scope 的改动，无需要协调者裁决的取舍。

## 自审记录

### CR 结论

手段：每 Task 两段审查（先规格符合性、后代码质量 + 强制变异测试），终末另派 opus 全分支审查（`master...HEAD` @ `7c51586`；六维度：跨任务一致性 / 分层 / 完成标准 / 下游契约 / 测试套件完整性 / 遗留风险）。交卷前控制器另做任务卡红线七项自检（见下）。

**终审覆盖范围的如实表述（协调者意见 2）**：本行原写「13 commits」，那个数字是**陈旧的**——13 是到 `ed7203b` 为止的累计数，被我从早先的草稿带进了派发提示，终审报告头部又沿用了它。终审 HEAD `7c51586` 的真值是 **20 commits / 20 files / +2360−33**（终审报告自己的 diffstat 与此逐项吻合），且报告逐条点到 T5 的 `gestures.ts` / `ptz.test.ts` 与 T4 的两个源文件，可见它执行的 `git diff master...HEAD` 覆盖的是**全分支**，不受那个错计数影响。它给出的两条 MINOR 正是「plan 清单未勾、任务卡未填」这两件事，随后的 `49ba781` / `c02d064` 就是照它办的。**终审之后新增的提交**（`49ba781` / `c02d064` 两笔交卷 docs、本轮整改 `7df8d96`）未经任何审查，由本轮 verify 的完整重跑与协调者复审覆盖。
发现与整改：规格审查共否决 plan 逐字落地 10+ 处（含 plan 代码被仓库自身检查器否决两处、被实测浏览器行为否决两处、审查报告提议被 tsc 否决一处 —— 每处均独立复现后才采纳）；质量审查五轮变异测试（T3 14 个、T4 22 个、T5 46 个变异体，T1/T2 按类驱动），发现并修复结构性缺陷 2 个（EventEmitter 活迭代跳监听器、`setPointerCapture` 对合成指针抛 NotFoundError 打断 handler），补测 30+ 条，全部非等价变异体击杀后才结项；等价 / 良性变异体逐条裁定登记不测（R1–R7、N1、N3b、M1c/M6/M8b、M1/M8/M9/M13、MO2–MO5 等）。
循环轮数：每 Task 各「规格一轮（含勘误登记）+ 质量一轮整改后复审通过」；T4 质量复审撞 5h API 限额中断一次、限额重置后续做完成；终审一轮 APPROVED（零 CRITICAL / 零 IMPORTANT，两条 MINOR 均为交卷自有的文档状态项，已随交卷提交处理）。
红线自检（控制器亲跑，七项全过）：`src/media/` 无 `frameSize` 代码用法（唯一命中为 downscale.ts:4 的 legacy 说明注释）；无桥再生（demo/ 无 test-entry*，集成测试全部直 import）；无 2 的幂量化逻辑；`listenerCount` 两源公开；ffprobe `512,256,64`；分支提交前缀零违例；PTZ / touch-action / 不缓存帧 / 暂停不推版本号 / 朝向一致均有对应测试且绿。
终审于 `7c51586` 当面复跑 verify 六连全绿；**整改后的最终树另在本次整改轮完整重跑**（硬件 45/45 与 `CI=1` 的 44 passed | 1 skipped 各一遍），结果见「自测结果」。

### 测试质量结论

effective-testing 评估以变异测试机械化执行（「破坏实现看测试是否失效」）：五轮质量审查的所有非等价变异体均被击杀；反同构断言防常量自证（钳位断言硬编码 ±1 而非回读 `WheelZoom.MAX_STEP`、监听器计数精确 8/10、`version === 1` 精确值）；「测试因错误理由通过」的情形（如 1px 钳位被 round 半数进一救活、last-frame 基线读取时序）已逐一识别并加固。
覆盖陈述：纯逻辑路径（events / gestures / downscale / source 接口）由 node 单元套件覆盖 —— 206 条测试，99.17% statements / 98.10% branches / 100% functions / 99.70% lines，分支 ≥90 为构建失败级门槛；DOM / 浏览器绑定路径（image-source 7、video-source 12、video-orientation 1、ptz 11，共 31 条集成测试）由浏览器 project 用真实元素、真实事件、真实 adapter 覆盖，但该项目不报告覆盖率（vitest 双 project 既定取舍），对应三个源文件在 coverage exclude 中、理由随注、thresholds 未动；`source.ts` 的 `MEDIA_EVENT_MAP` 是该文件唯一运行时语句，单元报告 0%、浏览器套件实际执行，全局门槛吸收。没有处于两类之外、即无测试网的交付路径。

**整改轮补充（会跳过的测试为什么不是假通过）**：`video-orientation` 在软件 adapter 上现在会 skip。一个能静默跳过的测试天然可疑 —— 它随时可能退化成「什么都不测还报绿」。这里用两道**当场重测**的门槛挡住那种退化：跳过的分支只有在「同一素材经解码器有上下对比度」且「同一 device 画常量色读得回来」都被量到之后才可达，任何一条不成立都是抛错（硬失败），所以素材坏了、设备瞎了都不会被跳过掩盖；而跳过理由里带着 adapter 自报的 vendor / architecture 与那三个数字，CI 日志里能读到「是谁、为什么」。反向也钉住了：`maxChannelDiff` 的断言仍然只在 `kind === 'rendered'` 分支里跑，联合类型让「拿不到数据却做了比较」在类型层就不可能。

## 审查意见

**结论：reject，退回整改（1 项阻塞 + 1 项随卷修正）。**（2026-09-22，superloop-verify 第 5 关）

**手段**：协调者直审——卡面红线静态核查 ＋ 七个交付文件逐个亲读 ＋ verify 全链在分支树上亲跑 ＋ 集成双环境亲跑（真 GPU 与 `CI=1` SwiftShader）＋ 定向变异亲测。

**亲验记录**：

- **红线全过**：`src/media/` 无 `frameSize` 代码用法（唯一命中 downscale.ts:4 legacy 说明注释）；桥零再生（`__panoTest`/`PanoTestApi` 在 src / demo / test-unit 零命中，integration 侧唯一命中为 image-source.test.ts:8 **注释行**——内容正是解释「没有这个桥」，与登记一致）；thresholds 90×4 未动；三个 coverage exclude 均附成段英文理由。
- **代码亲读（7 文件全部）**：EventEmitter 快照迭代与影子方法 dispose（勘误登记与实现严格一致）；downscale 的 device-limit-only + `Math.max(1, round)` 钳位 + 零维 RangeError；`MediaFrame = RenderableSource` 别名（renderer←media 分层红线守住）；VideoSource 的 version 契约（load/play/seeked/ended 推进、pause/progress 故意不推进的死锁注释在案、`loadedmetadata` 承担 0→N 元数据推进——P3 移交风险 #1 满足）；ImageSource 8 监听器单 AbortController、未加载读 frame 即抛；InputController track-before-capture + try/catch、touch-action 借还、PTZ 开关不重绑；gestures 纯函数、常量导出供反同构断言。卡面主张逐条吻合。
- **verify 静态链 EXIT=0**（分支树亲跑）：gen:shaders --check → typecheck → lint → coverage **206/206、99.17 / 98.10 / 100 / 99.70（与自报逐字一致）** → build。
- **集成真 GPU**：10 文件 **45/45 全绿**。
- **定向变异亲测**：删 `markFramePresented` 的 paused/ended 守卫 → 「does not advance a paused video, so the loop can stop」红（exit 1）；还原后 12/12 复绿、树净。钉子有牙。
- **素材亲验**：ffprobe `h264,512,256,64`；panorama.png 1839B / clip.mp4 4886B，逐字对上。
- **门禁证据**：21 改动文件全在 scope 白名单（plan+卡为常规伴随物）；**22/22** commit 前缀合规；分支侧 plan 44/44 全勾、diff 仅勾选与登记勘误块；执行期 master 侧仅开工认领与卡同步两笔。

**打回意见（逐条编号）**：

1. **【阻塞】video-orientation.test.ts 在 CI 环境确定性红，合并即把 GitHub CI 拉成 permanently red**。亲跑 `CI=1 npm run test:integration`：45 条中**唯一红即本条**（单独复跑仍红，确定性非抖动），失败点是探针自身的对比度守卫 `the fixture frame has no top/bottom contrast (top 0, bottom 0)`——SwiftShader（软件 WebGPU）上 `importExternalTexture` 路径对 video 元素采出**全黑帧**（copy 路径未及参与比较即被拦截），external 路径无帧可判朝向（守卫行为正确：拒绝在黑屏上判朝向）。而 ci.yml 的 integration job 以 `CI: 'true'` 跑全量 `npm run test:integration`（ubuntu-latest 无 GPU → SwiftShader 双 flag），即**本卡一合并、用户一 push，远端 CI 必红且永久红**——ci.yml 自己的注释写着「a permanently red job is a job people learn to ignore」，那是 P1 建起来的底线，P3 也以「只在一边绿 = 容差定错了」守过同一条。plan 对 SwiftShader/CI=1 零提及、卡面自报也只声明「真实 WebGPU adapter 守卫」，所以这不是实现质量问题，是**这条测试的环境口径既没登记也没处理**。整改方向（执行者定夺）：按仓库守卫纪律在软件 adapter 下显式 skip 并写明理由（响亮跳过而非静默过，真 GPU 环境照常全跑），或证明 SwiftShader 存在可用取帧方式并让探针在该环境下成立。其余 44 条在 CI=1 下已绿，无连带。
2. **【随卷修正】自报数字过期**：卡面「分支 13 commits（+2360/−33）」，实际 `master...HEAD` 为 **22 commits / +2399/−49**。13 恰为到 ed7203b（09-21 23:25，T4 feat 刚落地）为止的累计数——若 CR 节「终末全分支审查（master...HEAD，13 commits）」按字面理解，该终审**没有看到** T4 加固两笔（8fa3f41 / e15a30d）、全部 T5 与交卷 docs；行数差额（+39/−16）与这些提交吻合。本轮验收的全部亲验都跑在最终树上，已覆盖该缺口；重新交卷时请把卡面数字更正为最终状态（含终审实际覆盖范围的如实表述）。

整改完成重新报 `reported` 即复审。本轮其余证据（红线 / 亲读 / verify 静态链 / GPU 45 条 / 变异）复审时直接沿用，只增量验证第 1 条的整改与第 2 条的更正。

---

**结论：approve，准予合并。**（2026-09-22，superloop-verify 第 5 关，打回后增量复审）

**增量验证范围**：按上条承诺，只验意见 1 与意见 2，其余证据沿用上轮；另各跑一遍静态链与两环境集成，确认整改没有碰坏既有行为。

**意见 1【阻塞】已闭合 —— 用 ci.yml 自己的判据复核，不是按卡面转述。**

- 原样跑 ci.yml 那一步 `CI=1 npm run test:integration -- --reporter=verbose` → **EXIT=0**。
- 逐字复跑 ci.yml 的 per-project 断言：`project 'integration' ran 44 test(s)`、`project 'no-webgpu' ran 1 test(s)`，两者均非零，`::error::` 分支不再触发——**上轮「合并即把远端 CI 拉成永久红」的判据已不成立**。
- 跳过行带 `|integration (chromium)|` 前缀，说明这条 skip 计入本 project 的计数，落不到空集上。
- 跳过是**有条件的**，不是无条件放行：亲读 `upload-paths.ts` 全文，`unavailable` 只在两道**同一次运行里当场重测**的控制之后才可达——① 绕开 WebGPU 量解码器里的上下半对比度，不够即抛错；② 无纹理无绑定的常量色 fragment 读回为 0 即抛错。坏素材与瞎子设备仍是硬失败，不会被跳过掩盖。
- 真 GPU 环境照常全跑：本轮亲跑 `vitest run --project integration --project no-webgpu` 得 **45 passed (45)**，无 skip——即该用例在硬件 adapter 上是**通过**而非跳过。
- 上轮我担心的**假通过**已被守卫挡死，且我亲手证过它有牙：把 `MIN_HALF_CONTRAST` 由 8 改成 0，`CI=1` 下该用例立刻由 skip 变 **pass**（exit 0，0 对 0 的静默通过）——守卫不是装饰。
- 跳过理由串写进日志，可自证：adapter 自报 `vendor "google" / architecture "swiftshader"` ＋ 当场量到的解码对比度 28.4、常量色 max 191、视频帧上下半 0/0。

**意见 2【随卷修正】已闭合 —— 三个快照逐一对表实测。**

| 快照 | 卡面声称 | 实测 |
|---|---|---|
| 分支 HEAD `582e8cc` | 25 commits / 21 files / +2580−49 | **25 / 21 / +2580−49** ✓ |
| 上轮交卷 `c02d064` | 22 commits / 21 files / +2399−49 | **22 / 21 / +2399−49** ✓ |
| 终审 HEAD `7c51586` | 20 commits / 20 files / +2360−33 | **20 / 20 / +2360−33** ✓ |

终审覆盖范围的表述与转录一致、接受：13 是从早先草稿带进派发提示的陈旧计数，错的只是这个数；终审报告自己的 diffstat 与 `20/20/+2360−33` 逐项吻合，且报告逐条点到 T5 与 T4 的文件，可见它执行的 `git diff master...HEAD` 覆盖全分支；终审之后新增的三笔提交未经任何审查，由本轮 verify 完整重跑与本次复审覆盖。卡面另在 `582e8cc` 自行把 24 更正为 25（只差它自己那一笔），与实测一致——这一处是执行者主动校出来的，不是本轮再揪出来的。

**回归确认**：静态链 EXIT=0，coverage **206/206、99.17 / 98.10 / 100 / 99.70**（与上轮逐字相同，`thresholds` 未动）；GPU 45/45；`CI=1` 44 passed | 1 skipped。

**遗留观察（不阻塞合并，登记备查）**：

1. 新守卫的**判定逻辑本身没有测试网**。两个非等价变异体在两种环境下都能存活：`MIN_HALF_CONTRAST` 8→0（`halfContrast(...) >= 0` 恒真，守卫成死代码，软件 adapter 上退回静默通过，已亲测），以及 `upload-paths.ts:283` 的 `||` 改 `&&`（只在「一条路径有对比度、另一条没有」时行为不同，而两个受测环境都产生不出这种组合）。两处影响的是同一条**在两个受测环境里都不可达**的防御分支，今天的行为在两个环境里都对，故不阻塞。登记在此是因为卡面要求 P6「带同样的守卫」——P6 复制这段逻辑时应当知道，它的判定分支在 CI 与硬件上都不曾被执行过。

**合并放行。** 本轮红线与七个交付文件的亲读结论沿用上轮（整改只动了 `upload-paths.ts`、`video-orientation.test.ts` 与三份文档，未触碰 `src/`）。
