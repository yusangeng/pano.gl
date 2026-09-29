# Mercator 相机（mercator-camera）Design Spec

- **日期**：2026-09-29
- **状态**：设计已逐节确认（拖拽语义 / zoom 锚点 / 交付范围三项裁决，2026-09-29），待执行
- **关联**：`Projection` 联合的第五个 kind。无 v0.2.2 对应物——验收标准是 gate C 三方一致 + 本 spec 的解析不变量，**不是** legacy parity（与 planet-drag-semantics 的「F5 补语义」同类：v1 自己的裁决）。拖拽语义的先例是 `2026-09-28-planet-drag-semantics-design.md` §1（内容跟手原则）。

---

## 0. 这份 spec 决定什么

cylindrical 在高纬把内容压扁（垂直比例 ∝ cos(lat)）；Mercator 是它的保角版——**全图均匀比例尺**，水平垂直同缩放，两极推到无穷远。用户侧动机：用的人多（地图心智、街景横移、高纬航拍），是 cylindrical 之外唯一常用的圆柱家族成员。

**裁决记录**（用户逐项拍板，2026-09-29）：

| 决策点 | 结论 |
|---|---|
| 垂直拖拽语义 | **A：内容跟手**——垂直拖拽在 Mercator 度量空间平移（`gd⁻¹ ∘ translate ∘ gd`），任何纬度、任何 zoom 下指下内容精确跟手。代价：手势路径按 kind 分流（§4）。先例：planet-drag-semantics §1 |
| zoom=1 锚点 | **满宽 360°，同 cylindrical**——`theta = z·2π·zoom` 逐字相同；垂直按保角条件取 K=2π。zoom 范围沿用非线性相机的 0.01–1，滚轮/捏合手感与其它相机一致 |
| 交付范围 | **全栈一次到位**——核心栈 + 双 shader + 三门测试 + demo lab 面板 + README（含 `check-readme-options.mjs` 绿），单任务卡 |

**两处对口头设计的修正**（推导中心奇偶不变量 I2 时暴露，以本 spec 为准）：`atanh(sin(lat))` 项取**负号**（与 cylindrical 的 `− lat` 同向）；`φ` 公式**无 −π/2 尾项**。由此 zoom=1 的垂直张角是 **±85.051°**（gd(π)），不是口头陈述中的 ±81.7°。

---

## 1. 语义契约

五个相机继续用同一句话描述自己：**屏幕中心 = 姿态**。

| 相机 | 屏幕中心显示 | 垂直拖拽 |
|---|---|---|
| linear | 姿态即视线方向（view matrix） | ✓ |
| cylindrical | `atan(0) + π/2 − lat` → 源点纬向 = `π/2 − lat` | ✓ 条带平移（角度线性） |
| planet | 中心源点 = (povLatitude, povLongitude) | ✓ Möbius 倾斜 |
| pannini | `π/2 − lat` | ✓ |
| **mercator** | `gd(−artanh(sin lat)) + π/2 = π/2 − lat`（I2，与 cylindrical 同点） | **✓ M 度量平移（本 spec）** |

两条输入通道，刻意不同：

- **手势**（pan 事件）：垂直走 M 度量（§4），内容跟手到像素级；
- **程序化**（`viewer.rotate` / `setPose` / `cameraOptions.pose`）：保持角度线性，与其它相机同一公共契约，不因 kind 改变形状。

---

## 2. 数学设计

### 2.1 公式（三家逐行同形）

每片元，表面点 `(x, y, z)`，`x` 不读（与 cylindrical 同款注释钉住）；`yy = y·zoom`，`zz = z·zoom`：

```
theta = zz * TWO_PI - lng              // 与 cylindrical 逐字相同
M     = yy * TWO_PI - atanh(sin(lat))  // 负号：与 cylindrical 的 "- lat" 同向（I2）
phi   = asin(tanh(M)) + PI/2           // gd(M) + π/2；选型理由见 §2.4
uv    = (wrap01(theta/TWO_PI), phi/PI)
```

`gd` 是 Gudermannian：`gd(M) = asin(tanh M) = 2·atan(e^M) − π/2`，其逆 `gd⁻¹(φ) = artanh(sin φ)`。整个投影就是「源极角 φ ↔ 地图度量 M」的 gd 对，`M = gd⁻¹(φ)` 加线性项。

### 2.2 不变量（spec 级验收，逐条有单测）

- **I1 默认恒等**：lat = 0 → `atanh(sin 0) = 0` 精确，`M = y·2π·zoom`；y = 0 → `tanh(0)=0, asin(0)=0` 精确 → `v_center = 0.5`。无舍入介入的位级恒等。
- **I2 中心奇偶**：`phi_center = gd(−artanh(sin lat)) + π/2 = −gd(artanh(sin lat)) + π/2`（gd 奇函数）`= π/2 − lat`——**与 cylindrical 中心逐项相同**：同一姿态下两相机指同一源点。这是负号与无尾项的来源。
- **I3 单调开值域**：`gd` 严格单调 → `phi ∈ (0, π)` 开区间，`v ∈ (0, 1)`——**两极不可达**（渐近线，非裁剪）。
- **I4 各向同性**：每 ndc 单位 `|dθ| = |dM| = 2π·zoom`——K = 2π 的定义本身就是保角条件，无需另证。
- **I5 水平共享**：`theta` 行与 cylindrical 完全一致——水平跟手性（cylindrical 已证）自动继承。
- **I6 无分支无守卫**：`tanh` 饱和于 ±1、`asin` 定义域闭合 `[-1, 1]`，任意 M（含 ±∞）输出有限、无 NaN。planet 的 branch-point 裁决整案在此不存在。

### 2.3 K = 2π 与 Web Mercator 截断纬度

zoom=1、extent 1×1：水平 `z ∈ [-0.5, 0.5] → θ ∈ [-π, π]`（满宽 360°）；垂直 `M ∈ [-π, π] → φ = gd(π) = 85.051129°`。**这就是 EPSG:3857 Web Mercator 瓦片的截断纬度**——满宽 360° + 方形保角映射的纵横比正是标准瓦片格局，非巧合。屏幕上下沿 `v = 0.5 ± gd(π)/π ≈ 0.0275 / 0.9725`。

### 2.4 gd 形式 vs 教科书 exp 形式

教科书逆 Mercator 是 `2·atan(e^M) − π/2`。三家实现统一用 `asin(tanh(M)) + π/2`：

- `tanh` 饱和、`asin(±1) = ±π/2` 精确——极点姿态下 `M = ±∞` 仍走有限路径（I6）；
- `e^M` 在 f32 于 `M ≈ 88.7` 溢出为 `inf`，把单参 `atan` 喂给未规定输入（GLSL ES 对 inf 的逐函数行为未作承诺）；
- 两式恒等（`asin(tanh M) ≡ 2·atan(e^M) − π/2`）由单测 pin 住，防止「实现形式」被误当「公式变了」。

CPU 手势侧的逆变换 `lat' = asin(tanh(artanh(sin lat) + ΔM))` 同构同理：有限 ΔM 下 `tanh ∈ (−1, 1)` 严格，`asin` 永不越界、永不 NaN。

### 2.5 数值行为

- **极点姿态**（`setPose(±90)`）：float64 中 `(90·π)/180` 的 `sin` 恰舍入到 1.0 → `atanh(1) = +∞` → `M = −∞`（有限 `yy·2π` 加不动 ∞）→ `phi = 0`，全屏收敛到 `v = 0` 行（`-90°` 对称到 `v = 1`）。诚实极限：连续、无 NaN、与 cylindrical 的 clamp 端点行为同风格。gate B 钉住。
- **手势不可达极点**：有限像素 → 有限 ΔM → `tanh ∈ (−1,1)` → `|lat'| < 90°` 严格。全屏极点行只能由 `setPose(±90)` 显式到达。
- **f32**：`atanh(sin lat)` 随 lat → ±90° 对数增长（`≈ 0.5·ln(2/ε)`），f32 的 `sin` 在极点前一位即舍入到 1.0f，行为与 float64 同构。

---

## 3. 常量管线（单源）

`src/core/projection-kinds.json` 的 `camera` 加 `"mercator": 5` → `npm run gen:shaders` → `generated.ts` 的 WGSL/GLSL 常量块。`src/core/types.ts` 联合加 `{ kind: 'mercator'; zoom; extent: [1,1] }`；`src/core/constants.ts` 的 `CAMERA_CODES: Record<ProjectionKind, number>` 被类型系统强制补齐（漏补即编译错，这是该表存在的方式），`PROJECTION_KINDS` 追加。**禁止任何位置手写数值字面量**（CLAUDE.md 铁律）。

---

## 4. 拖拽语义 A 的落点

水平通道**零改动**（I5：`theta` 公式相同，现有 `lng = −(Δx/w)·360°` 的完全补偿证明直接继承）。垂直走 M 度量，四处小改：

| 文件 | 改动 |
|---|---|
| `src/interaction/gestures.ts` | 纯函数 `classifyDragMercator(delta, surface, zoom) → { meters, lng }`：`meters = −(Δy/h)·2π·zoom`（符号约定与 `classifyDrag` 的「场景跟手」反转一致），`lng` 公式复用；零尺寸守卫同款 |
| `src/interaction/input-controller.ts` | `dragToMercatorPan(...)`，与 `dragToRotation` 并列 |
| `src/viewer/camera-controller.ts` | `panMercator(deltaM, deltaLng)`：`lat' = asin(tanh(atanh(sin lat) + deltaM))` 后 `clampLatitude`；零 delta 不 dirty；`assertFinite`。`zoom()` 的非线性分支（÷scale、clamp 0.01–1）自动覆盖 mercator，零改动 |
| `src/viewer/viewer.ts` | pan 处理器按 `projection.kind === 'mercator'` 分流；公共 `'rotate'` 事件**仍发度数**（等效 `Δlat = lat' − lat`），事件形状不变 |

每屏高的 M 行程 = `2π·zoom`（zoom=1 时整屏恰为 ±π 米 → ±85.051°，与 §2.3 自洽）。分层合规：`interaction` 只 import `core`；`M` 的换算放 `gestures.ts`（纯函数、node 可测），pose 更新放 `camera-controller.ts`（单一状态主人），`viewer.ts` 只做分流。

---

## 5. 测试矩阵

| 层 | 文件 | 用例 |
|---|---|---|
| unit | `test/unit/reference.test.ts` | I1 位级恒等；I2 对若干 lat 与 cylindrical 中心逐点相等；gd 与 exp 形式恒等 pin；zoom 缩放（zoom 减半 → ΔM 减半）；极点极限（lat=±90 → v=0/1 全屏）；公式直算逐点 pin |
| unit | `test/unit/gestures.test.ts` | `classifyDragMercator` 符号（内容跟手）、zoom 因子、零尺寸守卫、与 `classifyDrag.lng` 一致 |
| unit | `test/unit/camera-controller.test.ts` | `panMercator` 的 M 平移正确性（对公式直算）；巨量 ΔM 渐近 ±90 不越界不 NaN；零 delta 不 dirty 不通知；非有限输入抛错 |
| unit | `test/unit/constants.test.ts` | `cameraProjectionCode('mercator') === 5`；`PROJECTION_KINDS` 含 mercator；fisheye 守卫不受扰 |
| gate B | `test/integration/gate-b-projection.test.ts` | mercator 加入 `responds to povLatitude` 参数化循环；extent 1×1 行为；极点姿态的退化屏 pin |
| gate C | `test/integration/gate-c-cross-backend.test.ts` | 状态扫描纳入 mercator（覆盖 lat ∈ {−90, −45, 0, 45, 90} × zoom ∈ {0.01, 0.5, 1}）→ WGSL/GLSL/float64 三方一致 |
| 用户故事 | `test/integration/user-story-camera-switch.test.ts` | mercator 入切换故事（切走切回、pose 保持） |

gate A **零波及**：其状态集取自 v0.2.2 capture，天然不含 mercator。分支覆盖 90% 门槛不变。

---

## 6. demo lab + README

- **lab**（`demo/lab/panels/camera.ts`、`demo/lab/context.ts`）：`KINDS` 数组加 `'mercator'`；`defaultProjection` 补 `{ kind: 'mercator', zoom: 1, extent: [1,1] }`。zoom/extent 滑条对非线性 kind 通用，自动工作。
- **README**：`camera.projection` 表加行 `| 'mercator' | zoom (0.01–1), extent (1×1) | Conformal cylinder — uniform scale everywhere, poles at infinity. |`；"The four projections" 节改五（截图格 3+2，补 `demo/shots/mercator.png`，lab 截图，README 插图非门禁物）；rule-of-thumb 补一句（均匀比例尺选 mercator）；`scripts/check-readme-options.mjs` 必须绿。

---

## 7. 非目标

- gate A 不动（无基线）；fisheye 三件套（类型排除 + 运行时拒绝 + 守卫测试）不动；
- 公共 API 仅 `Projection` 联合加宽——增量、非破坏；`viewer.rotate`/`setPose` 的角度语义不变；
- 不做 `K` 可配置化（YAGNI：K=2π 由保角条件唯一决定，不是自由参数）；
- `reference.ts` 模块头加一条豁免注记：mercator 非 v0.2.2 移植，是 v1 自有相机（与 `latOffset` 同类的「非转写」声明）；`latOffset` 文档更新为第三种用法（cylindrical/pannini 减 φ、planet 当 Möbius 倾角、mercator 当 M 平移的负项）。

---

## 8. 落点文件清单（plan 的锚）

```
src/core/projection-kinds.json        +mercator: 5（唯一事实源）
src/core/types.ts                     Projection 联合 +mercator 成员
src/core/constants.ts                 CAMERA_CODES / PROJECTION_KINDS 补齐（编译强制）
src/core/reference.ts                 projectMercator（float64 仲裁者）+ 模块头豁免 + latOffset 文档
src/renderer/shaders/generated.ts     生成物，npm run gen:shaders 产出，禁手改
src/renderer/webgpu/shaders/panorama.wgsl   +mercator case
src/renderer/webgl2/shaders/panorama.glsl   +mercator case（与上者逐行同形，gate C 看守）
src/interaction/gestures.ts           classifyDragMercator
src/interaction/input-controller.ts   dragToMercatorPan
src/viewer/camera-controller.ts       panMercator
src/viewer/viewer.ts                  pan 处理器按 kind 分流
demo/lab/panels/camera.ts             KINDS +mercator
demo/lab/context.ts                   defaultProjection +mercator
README.md                             相机表 + 五投影节 + shots/mercator.png
test/unit/{reference,gestures,camera-controller,constants}.test.ts
test/integration/gate-b-projection.test.ts
test/integration/gate-c-cross-backend.test.ts
test/integration/user-story-camera-switch.test.ts
```
