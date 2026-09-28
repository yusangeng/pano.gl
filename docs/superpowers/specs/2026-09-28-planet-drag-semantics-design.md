# planet 拖拽语义：可驾驶中心（planet-drag-semantics）Design Spec

- **日期**：2026-09-28
- **状态**：设计已逐节确认（语义 / 范围 / 行程三项裁决，2026-09-28），待执行
- **关联**：修正 v1 对 v0.2.2 缺陷 F5 的 latitude 项在 **planet 相机**上的几何语义——v1-design §11.4 记录的 F5 修复只定义了「诚实换算（度→弧度）」，从未定义该项的几何意义，本 spec 补上这一裁决。与 `2026-09-23-pan-zoom-semantics.md` 无冲突（该 spec 只裁了 lng 换算与 zoom 语义），交叉引用见 §6。

---

## 0. 这份 spec 决定什么

planet 模式下，垂直拖拽今天走的是 `phi -= lat`：对每个片元的采样极角做均匀平移。几何上是**纬度环带的径向泵吸**——屏幕中心恒为极点（投影奇点，`phi` 平移永远动不了它），|lat|=90° 时 `v` 越出 [0,1] 被采样器夹持成极点糊屏。v0.2.2 时代该项不存在（F5：latitude 从未被读取），v1 补上换算时没有回答「它该是什么变换」。

本 spec 的回答：**把 planet 的 latitude 项升格为真球面旋转（倾斜），使屏幕中心显示的源点 = 姿态 `(povLatitude, povLongitude)`，拖拽移动这个点**——「行星转起来」。

**裁决记录**（用户逐项拍板，2026-09-28）：

| 决策点 | 结论 |
|---|---|
| 目标语义 | 「让行星转起来」：正对读者的图像中心对应一个源 (lat,lng)，拖拽改变它（用户原话） |
| 改造范围 | **只修 planet**——cylindrical / pannini 的 `phi_center = π/2 − lat` 已经是「中心跟随姿态」，不动 |
| 行程范围 | **极点 ↔ 地平线**：clampLatitude 维持 [-90°, 90°]。对面极点处投影奇异点正落屏幕中心（整帧退化），不追；主流（Street View / Insta360 tiny-planet）同款终点 |

---

## 1. 语义契约

修完后四个相机第一次能用同一句话描述自己：**屏幕中心 = 姿态**。

| 相机 | 屏幕中心显示 | 垂直拖拽 |
|---|---|---|
| linear | 姿态即视线方向（view matrix） | ✓ 本来就对 |
| cylindrical | 中心行 = `atan(0) + π/2 − lat` → 源纬度 = lat | ✓ 条带平移，不动 |
| pannini | 中心 `phi = π/2 − lat` → 源纬度 = lat | ✓ 不动 |
| **planet** | **中心源点 = (povLatitude, povLongitude)** | ✓ 本次修复 |

planet 的具体行为：

1. **默认（lat = 0）逐位不变**：λ = 0 时新公式是 IEEE 精确恒等（sin 0 = 0、cos 0 = 1，无舍入介入），小行星默认视图一个比特都不动。
2. **垂直拖拽**：中心纬度滚出，从极点（默认）到地平线（|lat| = 90°，clamp 端点）。两种现存退化态同时消失：环带径向泵吸、极点糊屏。
3. **水平拖拽**：中心经度跟随 lng；中心还在极点时精确退化为今天的自旋——`theta -= lng` **代码原样保留**，水平手感零变化（§2.2 给出复合正确性的论证）。
4. **方向约定**：画面跟随手指，与其他三个相机同款（`classifyDrag` 不动，方向由单测钉死符号）。

---

## 2. 数学设计

三处同步点的现状（`projectPlanet` / `project_planet`，三份逐句同形）：

- `src/core/reference.ts:168-192`（float64 仲裁者；lat 在 :190 被消耗）
- `src/renderer/webgpu/shaders/panorama.wgsl:171-195`（lat 在 :193）
- `src/renderer/webgl2/shaders/panorama.glsl:144-168`（lat 在 :166）

公因子：`yy = y·zoom; zz = −(z·zoom); m = 1+zz²+yy²; p = 2zz/m; q = 2yy/m; r = (m−2)/m`，即从平面点 `w = (zz, yy)` 到单位球的逆 stereographic（`|w| = tan(θ/2)`，θ 为自屏幕中心方向起的极角；w = 0 ↔ 中心 ↔ v = 0 极点，w → ∞ ↔ 被排除的对极点）。

### 2.1 倾斜 Möbius 预变换

改动只有一处：**删除 `phi` 行的 `- lat` 项，换成作用在 `w = (zz, yy)` 上的倾斜预变换**，即把 `w` 先经一个 Möbius 变换再进逆 stereographic：

```
c = cos(lat/2);  s = sin(lat/2)
w' = (c·w − i·s) / (−i·s·w + c)        // w 视为复数 zz + i·yy
```

这是「绕屏幕左右轴（Möbius 不动点 w = ±1）、把极角 |lat| 的源点沿屏幕竖直经线滚到屏幕中心」的球面旋转的平面表达。不变量（spec 级验收，逐条有单测）：

- **I1 恒等**：lat = 0 → `w' = w` 逐位成立（`0·w + 1 = 1`，`w/1 = w`）；
- **I2 中心契约**：w = 0 → `w' = −i·tan(lat/2)` → 中心采样极角恰为 |lat| → `v_center = |lat_rad|/π`，clamp 下 ∈ [0, ½]（极点 ↔ 地平线，与裁决一致；拖上/拖下都只能离开极点，**符号选择的是滚落经线**）；
- **I3 无中心退化**：Möbius 分母零点位于半径 `cot(|lat|/2) = tan((π−|lat|)/2)` 处，|lat| ≤ 90° 时 ≥ 1，永不在 w = 0；
- **I4 方向（已定死）**：`tilt = lat`，不经 negation——拖下（lat < 0）→ `w'(0)` 落 +i 射线（屏幕上方）→ 中心改采上方内容 → **画面跟随手指**，与 cyl/pannini 的中心采样方向逐点一致（两者 v_center 均随 |拖拽| 增大）。中心采样方位角：lat > 0 走 π 分支（q < 0），lat < 0 走 0 分支。

每片元成本：一次 sin/cos + 约十条 ALU，相对现有 atan 可忽略。`lat` 仍由 `panorama_uv` / `main` 统一换算传入，`project_planet` 签名不变。

### 2.2 `theta -= lng` 保留的论证

stereographic 对过极轴的旋转有**旋转等变性**：平面坐标绕原点旋转 α ⟺ 球面绕极轴旋转 α。因此「先倾斜、后 `theta -= lng`」的复合恰好就是目标球面旋转 `R = R_极轴(lng) ∘ R_倾斜(lat)`——lng 代码一行不动，语义自动升级为「中心经度 = povLongitude」（倾斜后 theta 平移不再动中心纬度，只改中心经度）。这也是门 A 零波及的构造性保证：lng 路径代码未动，lat 态本就 never-comparable。

### 2.3 退化片元防护（实现要求）

倾斜足够大后（默认 extent 4 / zoom 1 下，约 39° 起从视口对角、约 53° 起从边中点），Möbius 分母零点进入视口。**2026-09-28 勘误（plan 期推导）**：NaN 的第一现场不是 `(m−2)/m` 的 `inf/inf`，而是分量除法本身——该点 `d2 = denRe² + denIm² = 0`，`zn/yn = 0/0` 直接 NaN，事后夹持 `m` 救不了它。要求 shader 里对 `d2` 做下限夹持：`d2 = max(d2, 1e-15)`——在源头兜底，`|w'| ≤ ~3e15`、`m ≤ ~9e30`（f32 域内），极限值连续（p, q → 0，r → 1，phi → π）。reference（float64）保持纯数学不带夹持——它是仲裁者不是像素比较者，且测试采样点避开分母零点。**2026-09-28 二次勘误（planet-review-followups spec §2.4）**：上文「极限值连续（p, q → 0，r → 1, phi → π）」在**精确分支点**不成立——floor 在极点**附近**交付有限 zn/yn（f32 证人钉住的档位），但 lat 恰 ±90 的精确命中站点上 f32 `sin`/`cos` 对同一半角舍入到同一位，`den_re` 恰 +0（Möbius 极点站点）或分子恰 ±0（倾斜中心站点，d2 = 2，任何 d2 下限夹持够不着）→ `p = q = 0` → `atan(0/0) = NaN`；phi 的连续极限也按站点分侧（极点站点 → π，中心站点 → 0），不存在单一 phi 极限值。按 2026-09-28 用户裁决，分支点在三处实现（WGSL / GLSL / reference.ts）由显式守卫取规范值 `theta = 1.5·π`、phi 按零因子侧取 π/0，详见 planet-review-followups spec §2.1–2.2。本 spec 的任务卡是历史记录，实现以该 spec 为准。

### 2.4 uniform 零改动

倾斜系数（c, s）在 shader 内从现有 `camera.povLatitude` / `u_povLatitude` 计算。不新增 uniform、不动两后端 uniform 管线与 `uniform-layout` 测试。

---

## 3. 三处同步与门禁影响

老规矩：**改投影公式 = reference + WGSL + GLSL 同一提交改三处**，门 C 钉住，改一处不改另处就是它存在的意义。

| 门禁 | 影响 | 论证 |
|---|---|---|
| 门 A（v0.2.2 基线） | **零波及（构造性）** | 非线性相机的 lat 态 never-comparable；可比较态全在 lat = 0，此时新公式逐位恒等（I1）+ lng 路径代码未动。红了即实现错 |
| 门 B（latitude 响应） | **照绿** | lat=0 vs lat=45 画面仍不同（现在是旋转）；`maxChannelDiff > 2` 断言与公式无关（gate-b-projection.test.ts:23-47） |
| 门 C（跨后端） | **执行网** | 两个 shader 必须同步改；token-for-token 单测（webgl2-shaders.test.ts:175-191）是单元级绊线 |
| 覆盖率 | 照旧 | 90% 分支红线不受影响 |

---

## 4. 不动清单

- `projectCylindrical` / `projectPannini` 及其两份 shader 拷贝（含它们的 `- lat` 项与 `latOffset` 语义）；
- `theta -= lng`（三处的 lng 路径全部原样）；
- `classifyDrag` / `InputController` / `camera-controller`（clampLatitude [-90,90]、wrapLongitude、zoom 全不动）；
- 公开面：`CameraState`、`Projection`、事件 API 零变化；
- uniform 布局（两后端）、`generated.ts`（无新投影类型，`gen:shaders` 不需要跑）；
- demo-lab（姿态读数按公开面工作，自动正确）。

---

## 5. 测试翻转与新增

**翻转（钉旧行为的用例）**：

1. `test/unit/reference.test.ts:313-339`——F5 的 `it.each` 对三个非线性相机断言「v 恰移 −latRad/π 且 u 逐位不变」。**planet 行移出该表**（cyl/pannini 留下继续钉），planet 换成 §5 新契约用例。
2. `test/unit/webgl2-shaders.test.ts:138-146`——「三个非线性投影都含 `-\s*lat\b`」的正则结构断言。**planet 移出循环**（cyl/pannini 留下），planet 换成自己的结构断言（project_planet 读 lat 且含 Möbius 倾斜项）。

**新增（planet 新契约）**：

3. 中心契约（I2）：过 `project` 投屏幕中心点（`ndcToSurface(0,0,extent)`），断言采样 `v = lat_rad/π`（clamp 域内多点）、`u` 随 lng 以既有方向移动；
4. λ=0 恒等（I1）：lat=0 时输出与旧闭式（测试内手写旧公式副本）逐位相等——门 A 的单元级前置；
5. 方向钉子（I4）：垂直拖拽方向的符号断言（画面跟随手指，与 classifyDrag 增量符号一致）；
6. 行程单调：lat 0→90° 时中心 v 从 0 单调到 1/2，全程有限（I3 的数值面）。

集成测试无翻转：三个门 + 用户故事均不钉 planet 垂直拖拽像素（已逐一核查）。

---

## 6. 文档与历史注记

- `src/core/reference.ts` 头注（:27-34「三个非线性投影减去 latitude」的 departure 注记）与 `latOffset` 的 doc（:91-104）：planet 部分更新为「2026-09-28 用户裁决，升格为球面旋转 Möbius，本 spec」；`latOffset` 本身保留（cyl/pannini 仍用）。
- 两份 shader 的 lat 来源注记（wgsl:250-256 / glsl:225-232）同步加一行指向本 spec。
- 本 spec 记录对 v1-design §11.4 F5 修复中 planet lat 语义未定义部分的 supersession；pan-zoom-semantics 无冲突，其 §5.4 测试翻转清单不受波及（那轮翻的是 lng 用例）。

---

## 7. 验收口径

**机器验收（卡片 verify）**：`npm run typecheck && npm run lint && npm test`——含三个门全绿。

**语义验收（人工，`npm run start` → planet）**：

1. 默认视图与改前逐帧相同（lat=0 恒等）；
2. 水平拖拽手感与改前一致（极点处 = 自旋）；
3. 垂直拖拽：行星滚起，中心内容随拖拽离开极点滚向赤道；拉满（|lat|=90°）停在地平线视角，无糊屏、无泵吸；
4. 画面跟随手指，与 linear/cylindrical 同向；
5. 滚轮 zoom / extent 调节全程无坏像素（§2.3 防护生效）。
