# pan 手感与 zoom 语义修正（pan-zoom-semantics）Design Spec

- **日期**：2026-09-23
- **状态**：已裁决（用户三项数值决策见 §4），待执行
- **取代**：`2026-09-19-pano-gl-v1-design.md` §11.4 **B1**（非线性相机经度偏移「照旧」的决定）。历史 spec 原文不改——它是当时决策的记录；本节起以本 spec 为准。§11.4 末尾预告的「单独一次有意的变更，需要自己的测试（形状同 §12 的 F5），并且要说明为什么新的灵敏度是对的」，即本文档。

---

## 0. 这份 spec 决定什么

v1 移植 faithfully 保留了 v0.2.2 的两个交互层缺陷，又在移植中引入了一个新缺陷。本 spec 一次性修齐三件事：

| # | 变更 | 性质 |
|---|---|---|
| C1 | 非线性相机经度偏移改为诚实换算 | **有意的行为变更**，取代 v1-design §11.4 B1 |
| C2 | zoom 方向修正（滚上=放大） | **缺陷修复**——v1 移植引入的方向反转，v0.2.2 本来是对的 |
| C3 | linear 相机 zoom 落地（fov 乘法式） | **缺陷修复**——v0.2.2 的 linear zoom 是好的，v1 移植成了 no-op |

共同前提（用户原话，2026-09-23）：经度怪癖「之前我是因为不大懂这方面的知识才实现的很怪的」，应当「提供一个合理的手感」。

**修完后的验收语义不再是「渲染出 v0.2.2 渲染的东西」——在这三个行为上，v1 明确优于 v0.2.2。** 其余行为（投影公式形状、纹理路径、回退链）的验收标准不变，仍以 v0.2.2 基线为准。

---

## 1. C1：经度换算修正

### 现状（v1 = v0.2.2 的忠实复制）

`panorama.wgsl:245` / P6 的 `panorama.glsl` / `reference.ts` 的 `lngOffset`（:73-76）三处同构：

```text
实际减掉量 = povLongitude / 4      ← 度，直接从弧度角 theta 上减
```

（v0.2.2 源头：`fshader.glsl` 文件级 `float lng = u_CamPOVLongitude / 2.0` + 每个非线性公式各减 `lng / 2.0`，净 `/4`。）

### 修法

```text
lng = povLongitude * PI / 180.0
```

与纬度项（F5 修复，wgsl:252）同款诚实换算。三处同步改，缺一即被门 C 抓住。

### 量化的手感变化

- **旧**：姿态每 8π ≈ 25.13° 转一整圈，约为正确速率的 14.3 倍（45/π）。拖一个视口宽（`classifyDrag` 产出 360° 姿态）= 画面转约 14.3 圈。
- **新**：姿态 360° = 恰一圈。拖一个视口宽 = 一圈，与 linear 相机现状一致——**四种相机手感统一**。
- 连带自愈：`wrapLongitude` 的 [0, 360) 周期与画面周期自然对齐（旧周期 25.13° 与 360° wrap 错位）；v0.2.2 CylindricalCamera 那个 `% 25` 补丁所服务的错位不复存在。

---

## 2. C2：zoom 方向修正（v1 缺陷）

### 方向链（三步，逐步有源码为证）

1. `gestures.ts:60` `classifyWheel`：`step = -notches * 0.3`，**delta 正 = zoom in（放大）**（TSDoc 明文）。滚上（deltaY<0）→ delta 正。
2. `camera-controller.ts:119`：`next = zoom * (1 + delta)` → 滚上使 zoom **值变大**。
3. shader（wgsl:159-168 = reference.ts:144-153）：zoom 只乘 `y`/`z`。cylindrical（extent 1×1，surface y,z ∈ [-0.5, 0.5]）下 zoom=1 → theta 跨 ±π（一圈），zoom=0.5 → ±π/2（半圈）。**值越小视野越窄 = 放大。**

**净效果：滚上（应放大）→ 值变大 → 画面缩小。方向反了。** pinch 同链路（`classifyPinch` 张开 ratio 正 = 放大）同样反。

### 对照

- **v0.2.2 是对的**：`ZoomPlugin` → `delta = deltaY * 50` → `zoomValue += delta / 20`——滚下值变大 = 视野变广 = 缩小 ✓。
- v1 移植时 `zoom * (1 + delta)` 把符号约定弄反了。这是缺陷，不是设计分歧；无需权衡，直接修。

### 修法

见 §3 统一公式。US2 滚轮用例（camera-freeze-fix 恢复的那条）随之翻转：修方向后从默认 zoom=1 滚下是 clamp 顶上的 no-op，用例须改为**滚上**并断言 `zoom < 1`。

---

## 3. C3：linear zoom 落地 + 统一 zoom 语义

### 契约（修后 `zoom(delta)` 的定义，四种相机一致）

> **delta 正 = 画面放大 (1 + delta) 倍；delta 负 = 缩小。**

两种参数化同形——「视场参数除以 (1+delta)」，参数越小视野越窄：

| 相机 | 参数 | 公式 | clamp |
|---|---|---|---|
| linear | `fov`（弧度，Projection 既有字段） | `fov / (1 + delta)` | **[15°, 110°]**（用户裁决） |
| cylindrical / planet / pannini | `zoom` | `zoom / (1 + delta)` | **[0.01, 1]**（用户裁决：上限不动） |

每档步进 ±30%（`STEP_PER_NOTCH = 0.3` 不动），四相机视觉步进一致。

### 实现要点

- linear 分支替换 `camera-controller.ts:118` 的早退：`{ ...projection, fov: clamp(next) }`，`aspect` 经展开存活。
- clamp 落回原值 → 不置脏不通知（与既有同值守卫同构，防 wheel 顶格重绘）。
- fov 走 `buildProjection` 现有路径进矩阵，**uniform 布局、shader、backend、公开 API 零变化**（linear 的 `Projection` 本就有 `fov` 字段；backend 对 linear 恒上传 zoom=1 的现状不变）。
- 15°/110° 常量以弧度字面量或度转弧度表达式定义在 camera-controller，TSDoc 写明度数语义与用户裁决出处。
- `viewer.ts` `zoom` 的 TSDoc「No-op for the linear projection」删除，改述新契约。

---

## 4. 数值决策记录（用户，2026-09-23）

1. **linear fov clamp = [15°, 110°]**：15°≈长焦极限，110°≈超广角畸变边缘；v0.2.2 的 [1.99°, 179.38°] 两端均为极端，弃。
2. **非线性 zoom 上限保持 1.0**：默认即全景完整可见的最广状态，只能放大。v0.2.2 pannini 的上限 2 不跟进——cylindrical 拉远会水平跨两圈（内容重复），视觉合理性未经验证，不为未验证的放宽引入行为变更。
3. **P7 链式依赖**：`p7-cleanup` 的 deps 追加本卡 slug，锁死 P6 → 本卡 → P7 顺序（本卡使 CLAUDE.md 多处描述过时，P7 收尾须在其后）。

---

## 5. 波及面与约束

### 5.1 三处同步（CLAUDE.md 红线）

`src/renderer/webgpu/shaders/panorama.wgsl` + `src/renderer/webgl2/shaders/panorama.glsl` + `src/core/reference.ts` 的 lng 公式与注释**必须同一提交改齐**。门 C（gate-c-cross-backend）管两 shader 一致，reference 是仲裁者。只改其一 = 该门存在的意义所针对的失败。

### 5.2 门 A 可比集重推导（本卡最重的工程约束）

基线 PNG（`test/fixtures/baseline/`）是 v0.2.2 的历史记录，**不重捕、不改动**。C1 生效后：

- 基线态中 `povLongitude ≠ 0` 的非线性相机渲染**必然漂移**（这正是修复本身）；
- gate-a 的可比集须按「修后语义下两版本仍等价」重新推导并收窄，移出的态登记为**有意分歧**（形状同 v1-design §12 F5 的处理）；
- 默认位姿 (0,0) 下新旧公式等价（0 的任何倍数都是 0），静态基线态不受影响。

### 5.3 门 B / 门 C / US5

- 门 B（surface-extent + latitude）不在 C1 射程（lng 不参与 surface 恢复），全量跑绿即证。
- 门 C 是 C1 的直接看门。
- US5 两条断言与 `no-webgpu` project **零 diff**（延续 camera-freeze-fix 的 R1c-iii 边界）。

### 5.4 测试翻转清单（钉旧行为的网必须先红后绿）

| 现有网 | 翻转 |
|---|---|
| US2 `zoom is a no-op for the linear camera` | 整体替换为「linear zoom 到达 fov」（C3） |
| US2 滚轮用例（camera-freeze-fix 版，滚下断 zoom<1） | 改**滚上**断 `zoom < 1`，像素断言保留（C2） |
| unit 中钉 `/4` 的 reference 断言 | 翻为诚实换算期望值（C1） |
| unit 中钉非线性 `zoom * (1+delta)` 的断言 | 翻为 `zoom / (1+delta)` 方向（C2） |

新增网（灵敏度）：非线性相机 `rotate(0, 360)` 往返后画面 ≈ 原样（旧树 360/25.13 ≈ 14.33 圈 ≠ 整数圈，**必不回原样**——此断言在旧树红、新树绿，是 C1 的行为级红网）。

### 5.5 注释引用链同步

wgsl:235-244、glsl 对应块、`reference.ts:48-76` 的「deliberate retention, see spec §11.4 (B1)」注释改写为指向本 spec；`CLAUDE.md`「The CPU reference is the arbiter」节中 lngOffset 段落同步改述（该文件描述目标态，留着过时描述会误导后续读者）。

### 5.6 不动的东西

- `src/core/projection-kinds.json` 与 `gen:shaders` 管线（投影常量与本卡无关，`generated.ts` 不出现本卡 diff）。
- `STEP_PER_NOTCH = 0.3`、`MAX_STEP`、`classifyWheel`/`classifyPinch`/`classifyDrag` 全部不动（方向修正在消费端 controller，不在产出端 gestures——产出端的「正=放大」契约本来是对的）。
- 公开 API 面（`src/index.ts` 导出零 diff）。
- `LEGACY_QUAD_VIEW`、矩阵构建、uniform 打包与上传路径。

---

## 6. 非目标

- 非线性 zoom 上限放宽（§4.2 已裁决不做）。
- 惯性拖拽、平滑缩放、双击复位等手感增强——本卡只把「错的」修成「对的」，「更好的」另议。
- v0.2.2 滚轮 `deltaY * 50` 的手感考古复刻——v0.2.2 的 wheel 手感同样是坏的（±5000°/档打满 clamp），v1 的 0.3/档是合理值，保留。
