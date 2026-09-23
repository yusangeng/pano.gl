---
plan: docs/superpowers/plans/2026-09-23-camera-freeze-fix.md
scope: [src/renderer/webgpu/backend.ts, test/unit/webgpu-backend.test.ts, test/integration/user-story-photo.test.ts, test/integration/user-story-video.test.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: foundation
deps: [p5-viewer]
state: reported
createdAt: 2026-09-23T03:11:50.274Z
---
# 任务：相机冻结修复：删 setCamera 矩阵相等早退

开工先通读 plan 的「背景」节——修复形状是用户裁决（删早退而非补比较条件），机制链、v0.2.2 取证、门 A/B 失明原因都在里面。三条纪律：①三条红网必须在带缺陷的树上先跑出具名红再动手修（Task 1 的 Step 2/5 就是这道证据，结果写进完成报告）；②变异击杀只认 JSON 报告里具名 status=failed 的用例，退出码不算数，变异在 /tmp git-archive 沙箱做、落刀前后 sha 核对；③边界——不动 TARGET_FORMAT（E35 归 P6）、不动 CameraController.onChange（E37 归 P6/P7）、不动 US5 断言与 no-webgpu project（R1c 第 iii 条）。浏览器会话偶发连接超时是已登记平台抖动，同尖端重跑一次再判。

## 完成报告

四要素分节如下：做了什么 / 红网证据与自测结果 / 偏离 plan 的点 / 遗留风险。

### 做了什么

- **Task 1（只写测试）**：① `test/unit/webgpu-backend.test.ts` — 整体删除 `'skips the upload when the clip matrix is unchanged'`，原位插入 always-upload 红测（2 次上传 + 第 2 次内容带 pose，偏移 72/76）；② `test/integration/user-story-video.test.ts` — 整用例替换 `'a wheel zoom-out reaches the camera state of a non-linear projection'`，恢复像素断言（redraw 差分 + `maxChannelDiff > 2`，读回移到 dispose 之前）；③ `test/integration/user-story-photo.test.ts` — 拖拽用例之后插入 `it.each` 两半（latitude/longitude）非线性平移像素用例。三条均在带缺陷树上先跑出具名红（证据见下）。
- **Task 2（src 唯一改动）**：删除 `src/renderer/webgpu/backend.ts` `setCamera` 里的 `if (mat4.equals(clip, this.#clip)) return` 早退，`#writeCameraUniforms()` 无条件执行（含说明性英文注释）。src diff 仅此一处（`git diff d5812bc..HEAD -- src/` 可证）。
- **Task 2 Step 4**：测试与修复同一提交 `912ade5`，commit message 与 plan Task 2 Step 4 逐字一致。
- **Task 3**：verify 六连全绿；/tmp git-archive 沙箱变异抽查，四个具名杀手全数转红，还原 sha 核对相符。

### 红网证据（带缺陷树上，修复落地前）

1. **unit**：`npx vitest run test/unit/webgpu-backend.test.ts -t 'uploads the camera uniforms on every call'`
   → `FAIL setCamera > uploads the camera uniforms on every call, even when the matrix cannot see the change` · `AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times`（正是 plan 预测的 unit 级缺陷形态：早退吃掉第二次上传）。
2. **US2 滚轮**：`npx vitest run test/integration/user-story-video.test.ts -t 'wheel zoom-out'`
   → `AssertionError: the zoom-out did not move the picture: expected 0 to be greater than 2`（红在像素半边；`sourceCalls` 差分意外 >0——viewer 层循环跑了但 backend `#dirty` 未置——属 plan Task 1 Step 5 明文允许的「若 sourceCalls 差分意外 >0，红必然在像素半边，同样正确」）。
3. **US1 平移两半**：`npx vitest run test/integration/user-story-photo.test.ts -t 'moves the picture on a non-linear camera'`（见偏离①）
   → `AssertionError: rotate(30, 0) did not move the picture: expected 0 to be greater than 2` 与 `AssertionError: rotate(0, 90) did not move the picture: expected 0 to be greater than 2`（latitude/longitude 两半各红一次，红因同上）。

### 自测结果

- **三条网转绿**：unit 1 passed；wheel zoom-out 1 passed；rotate 两半 2 passed。
- **verify 六连**（提交后同尖端跑）：① `gen:shaders -- --check` up to date；② `typecheck` 三程序全过；③ `lint` 零告警；④ `test:coverage` 276/276，四门槛 statements 99.57% (464/466) / branches 98.6% (212/215) / functions 100% (91/91) / lines 100% (427/427)；⑤ `test:integration` 20 文件 108/108 全绿（integration + no-webgpu 两 project）；⑥ `build` 成功（ESM 100.57 kB / CJS 100.80 kB + dts）。浏览器连接超时抖动未发生。
- **变异抽查**（/tmp/camera-freeze-fix-mutation，`git archive HEAD` + 软链 node_modules；落刀前 sentinel sha `e1ed5d33…` 与 `git show HEAD:src/renderer/webgpu/backend.ts` 相符）：加回 `if (mat4.equals(clip, this.#clip)) return` 后三 project 全跑（JSON 报告：384 用例，380 过 4 红），具名杀手全数在场且**恰好只有这四个**：
  - `webgpu-backend` · `uploads the camera uniforms on every call, even when the matrix cannot see the change` — KILLED
  - `user-story-photo` · `rotate() moves the picture on a non-linear camera: the latitude half` — KILLED
  - `user-story-photo` · `rotate() moves the picture on a non-linear camera: the longitude half` — KILLED
  - `user-story-video` · `a wheel zoom-out reaches the camera state of a non-linear projection` — KILLED

  还原后沙箱文件 sha256 `e1ed5d33…` 与 `git show HEAD:src/renderer/webgpu/backend.ts` 再次相符；worktree 全程 clean。
- **边界核查**（`git diff d5812bc..HEAD`）：仅触碰 scope 白名单四个文件；`TARGET_FORMAT`/`backend.ts:31`/`:317` 区域零 diff（E35）；`src/interaction/` 零 diff（E37）；US5 所在 `test/integration/fallback/user-story-no-webgpu.test.ts` 零 diff，`no-webgpu` project 零 diff（R1c iii）。

### 偏离 plan 的点

1. **Task 1 Step 5 的 photo 过滤命令**：plan 原文 `-t 'rotate() moves the picture'` 实际匹配不到任何用例（vitest `-t` 是正则，`()` 是空捕获组，永远匹配不了字面括号），整文件 skip。改用同一用例名的正则安全片段 `-t 'moves the picture on a non-linear camera'` 重跑——用例名与断言与 plan 逐字一致，仅过滤串不同。
2. **无计数重排**：plan Task 2 Step 3 预警的 `'repacks the uniforms when a source swap changes the texture projection'` 计数漂移未发生（该用例只调一次 `setCamera`，无条件写不改变其基线），未做任何重排；`'throws when the clip matrix is singular'` 亦保持绿。

### 遗留风险

1. `backend.ts` 的 `#clip` 字段现为只写不读，其文档注释（"for detecting an unchanged camera"）已成历史。plan 的替换块刻意保留 `mat4.copy(this.#clip, clip)`，删除该字段不在本卡 scope 白名单内——建议 P6 照抄「无条件写」形状时一并裁决（删字段或改注释）。
2. 非线性相机的纬度平移是 v1 新有意行为（v0.2.2 从不读 `u_CamPOVLatitude`），latitude 半边钉的是 v1 自身语义；若后续有人按 v0.2.2 截图对照会误判，plan 背景节已写明依据。
3. 无条件写的代价（每绘制帧一次 96 字节上传 + 一次矩阵求逆）已被用户裁决接受并量级评估过；`render()` 的 `#dirty` 早退仍在，非绘制帧零成本。

## 自审记录

### CR 结论

执行者未跑独立的 gstack/codex review 轮；本轮自审手段与结果：① plan 逐块比对——plan 的三个代码块与树上现状（删除目标/替换目标）逐字相符，无一猜测；② 边界审计——`git diff d5812bc..HEAD` 逐文件核对 scope 白名单与三条边界（E35/E37/R1c iii）零 diff；③ 变异抽查——早退加回后 JSON 报告里恰好转红的正是四个具名杀手（无第九个意外红、无杀手缺席），还原 sha 双向核对；④ 红先绿后——三条网在未动 src 的树上各跑出具名红后才落刀。

**协调者双关审查（spec + quality）**：spec 侧 0 findings；quality 侧 3 条 MINOR，全部整改（提交 `d41d391`）——① `#clip` 声明注释仍描述已删除的相等检查，改为如实表述（只写不读、保留 copy 是最小 diff 选择、`#invClip` 才是被读的矩阵）；② 两条集成测试注释把 redraw 计数归因到后端脏标记，不准确（`setSource` 在 viewer 循环每选中一帧就无条件发生、位于后端 `#dirty` 门之前——变异证据四杀手全红在像素半边即其证明），改为分层表述（redraw 计数抓循环层、像素断言才是网住后端冻结的那半）；③ unit 网两次调用原用相同 pose，内容断言甄别不了「上传了但打包陈旧 pose」的变体，第二次调用改为 `{ povLatitude: 30, povLongitude: 40 }`、内容断言期望 30/40，用例名不动。整改后 `test/unit/webgpu-backend.test.ts` 38/38、typecheck、lint 全绿；并在 /tmp 沙箱（`git archive` 新 HEAD，sentinel sha `4441ad8b…` 落刀前后与 `git show HEAD:` 相符）重证加强后的 unit 网仍具名击杀早退变异体（变异下恰 1 红，即该用例；还原 sha 复核相符）。整合②③属注释/测试形状改动，未重跑 GPU 集成，task-finish 闸 6 当面全量再跑。

### 测试质量结论

三条网的可杀伤性已由变异抽查直接证明（早退加回 → 四用例具名转红），不存在「绿着但什么都没测」的网。断言设计：unit 网同时钉次数与内容（第 2 次上传带 pose，防「两次都丢 pose 的写」假绿）；两条 integration 网把 redraw 差分与像素差分分开断言且消息具名（「did not redraw」指认脏标记半边，「did not move the picture」指认 uniform 内容半边）；读回全部在 dispose 之前（dispose 销毁 device 后画布读回为空白）。未运行 effective-testing skill 的正式评估流程，以上为按其原则做的实质检查。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
