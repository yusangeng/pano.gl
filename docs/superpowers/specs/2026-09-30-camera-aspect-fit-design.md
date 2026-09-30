# 非线性相机的容器宽高比自适应（camera-aspect-fit）Design Spec

- **日期**：2026-09-30
- **状态**：设计已在对话中逐轮确认（zoom 语义 / 垂直自动 / extent 高级用法，2026-09-30 用户拍板），spec 落档待审
- **关联**：v0.2.2 框架性继承缺陷的裁决修正，同类先例 `2026-09-23-pan-zoom-semantics.md` §1（lngOffset 偏离，用户裁决）；mercator 渐近线行为继承 `2026-09-29-mercator-camera-design.md` §2.4–2.5 / I6；下游 demo-lab 重构卡（本卡合并后立项）

## 0. 这份 spec 决定什么

四台非线性相机的「取景纸」是正方形的，被无条件拉伸到容器形状上。根因三处连锁：v0.2.2 的方形 quad 网格边长 → `buildProjection` 的 `m = max(extent)/2` 方形 ortho 盒（src/core/matrix.ts）→ `setAspect` 只写 linear（src/viewer/camera-controller.ts）。非线性路径上没有任何一处读取容器宽高比，shader 里也没有任何 aspect 补偿——分辨率全部由 invClip 决定，而 invClip 来自那个方形盒。

拉伸量（纵向放大倍数，屏心处）按相机与容器形状：

| 容器 | cylindrical | mercator / pannini / planet |
|---|---|---|
| 1:1 方形 | **6.28×** | 1×（干净——这就是 bug 在方形 demo 里不显眼的原因） |
| 16:9 | **3.53×** | 1.78× |

**修法一句话**：取景纸的宽度继续由 zoom / `extent[0]` 决定（水平跨度旋钮，语义不变），高度默认自动按容器宽高比推导，使**屏心处一像素横竖覆盖等量全景角距**——「不变形」的可执行定义。用户代码零改动即受益：viewer 已在 `#resize` 把 W/H 喂给 `setAspect`（src/viewer/viewer.ts），只是今天只有 linear 消费它。

**裁决记录**（用户逐项拍板，2026-09-30）：

| 决策点 | 结论 |
|---|---|
| zoom 语义 | 唯一日常旋钮 = 水平跨度。zoom 1 身份不变：cylindrical/mercator 360°、pannini 180°、planet 全球 |
| 默认行为 | 垂直自动跟容器（§1 等距规则）；resize 即时跟随（ResizeObserver 既有通路，非线性腿补上 dirty） |
| extent 高级用法 | `extent[0]` 校准语义不变；`extent[1]` 由新字段 `fit: 'extent'` 显式启用（变形镜头 / 锁定画幅），默认 `fit: 'container'` 下被忽略 |
| linear | 零改动（fov 管 fov、aspect 由 viewer 维护的既有契约保持） |

**两处对口头讨论的修正**（落 spec 推导时暴露，以本 spec 为准）：

1. **mercator 竖屏不需要钳制**。口头讨论预留了「竖屏下 m_y 顶到极点怎么办」的开放问题；推导发现 tanh/asin 的渐近线就是天然的优雅极限（mercator spec I6 直接继承）：9:16 竖屏 extent_y = 1.78 → M_half = 5.59 → 屏沿 ±89.6°，无特判、无 NaN、无死区。而方形容器 A=1 恰好给出 extent_y = 1 → M_half = π → ±85.0511°——**既有 EPSG:3857 pin 从测试事实升格为方形容器的默认框架**，这本身就是无钳制设计正确的最强信号。
2. **gate A 基线零波及**。原本预期非线性腿要像 lngOffset 那样重拍基线；发现 `fit: 'extent'` + 方形元组在任何视口下与今日渲染**逐位一致**（m_x = m_y = max/2 的塌缩与今日相同），gate A 给非线性状态钉 `fit: 'extent'` 即可继续看守 v0.2.2 像素契约——legacy 框架以手动模式的形式被完整保留，成为本机制的回归锚而非债务。

## 1. 语义契约

### 1.1 唯一规则：屏心等距

**在屏幕中心，一个像素横向覆盖的全景角距 = 纵向覆盖的角距。**

- 屏心对应取景纸原点（表面点 (1, 0, 0)），与姿态无关——所以这条规则在任意 povLatitude/povLongitude/zoom 下都成立。
- zoom 在推导中约掉：等距条件两边同乘 zoom，故**解析结果与 zoom 无关、与容器形状一一对应**（§2 不变量 I3）。
- 「等距」是屏心处的局部性质，不是全图均匀：cylindrical/pannini 远离屏心仍有投影自身的压缩（atan 的性质），mercator 全图均匀（conformal），planet 全图保角。本规则修的是「纸被拉变形」；投影自身的曲率是相机性格，不是缺陷。

### 1.2 各相机推导（详见 §2.1）

| 相机 | extent_y（A = 容器宽/高，extent_x = `extent[0]`） | 为什么 |
|---|---|---|
| cylindrical | `extent_x · 2π / A` | 水平项 θ = z·2π（每单位纸 2π rad），垂直项 φ = atan(y)（每单位 1 rad）——垂直要 2π 倍的纸高才能追平每像素角距 |
| mercator | `extent_x / A` | 水平 θ = z·2π 与垂直 M = y·2π 同率 |
| pannini | `extent_x / A` | 屏心两轴同率（θ′ = 1，φ′ = 1） |
| planet | `extent_x / A` | Möbius 保角，平面度量两轴同率 |

### 1.3 zoom 1 默认框架（extent_x 默认值，屏中列计）

| 相机 | extent_x | 1:1 方形 | 16:9 横屏 | 9:16 竖屏 |
|---|---|---|---|---|
| cylindrical | 1 | 360°×144.7° | 360°×121.0° | 360°×159.8° |
| mercator | 1 | 360°×±85.05°（EPSG） | 360°×±70.6° | 360°×±89.6° |
| pannini | 4 | 180°×126.9° | 180°×96.7° | 180°×148.6° |
| planet | 4 | 纸 4×4（地平线圆内余量足） | 纸 4×2.25 | 纸 4×7.11 |

对比今日：16:9 下 cylindrical 垂直拉 3.53×、其余三台 1.78×；方形下 cylindrical 拉 6.28×、今日仅显示 360°×53.1°。上表所有数字都是无变形的。pannini 的竖直跨度按屏心列计——其左右边缘列因投影自身特性更窄（1/√(1+z²) 压缩），非变形。

### 1.4 高级用法：手动画幅

`fit: 'extent'` 时 `extent[1]` 字面生效（纸高 = extent[1]），不再看容器——用于变形镜头、锁定画幅、复刻 v0.2.2 框架。cylindrical/pannini/planet 的 atan 渐近与 mercator 的 tanh/asin 饱和保证任意纸高无 NaN（I5），手动模式用户自负其值。

## 2. 数学设计

### 2.1 屏心等距的推导

非线相机纸点 (y, z)（屏心为原点），水平角距率 k_x = ∂θ/∂（纸横向单位）、垂直角距率 k_y = ∂φ/∂（纸纵向单位），都在屏心取值：

| 相机 | k_x | k_y | k_x / k_y |
|---|---|---|---|
| cylindrical | 2π（θ = z·2π） | 1（φ = atan(y)，y=0 处导数 1） | 2π |
| mercator | 2π（θ = z·2π） | 2π（M = y·2π，φ = gd(M)，gd′(0) = 1） | 1 |
| pannini | 1（θ = 2·atan(z/2)，z=0 处导数 1） | 1（φ = atan(y/√(1+z²))，z=0 处即 atan(y)） | 1 |
| planet | 1（平面度量） | 1（Möbius 保角） | 1 |

屏心每像素角距：横向 = k_x·2m_x·zoom/W，纵向 = k_y·2m_y·zoom/H（m = extent/2，A = W/H）。相等 ⟺

```
m_y = m_x · (k_x / k_y) / A        （zoom 约掉）
```

代入 k_x/k_y 得 §1.2 表。zoom 在等式两边同时出现，故解析与 zoom 无关（I3）；planet 的保角性使该式在任意 tilt 下成立（保角映射保持各向同性）。

### 2.2 `resolveExtent`：唯一事实源

新建 `src/core/extent.ts`，纯函数 float64：

```ts
resolveExtent(projection, aspect): readonly [number, number]
// projection: 任一非线性 Projection 成员；aspect = W/H，assertPositive
// fit:'extent' → 字面返回 [extent[0], extent[1]]
// fit:'container'（默认/缺省/未知值）→ [extent[0], 按相机推导]
```

- `aspect > 0` 之外无分支、无钳制、无特判——四台相机的渐近行为天然优雅（I5）。
- 不读 zoom（结构性保证 I3）。
- matrix.ts（渲染路径）与 reference.ts（仲裁路径）**共享**此函数——因此推导本身没有第二意见，I2 的验收必须是**性质测试**（§5.3），不经 resolveExtent。

### 2.3 不变量（每条有测试钉）

- **I1 水平不变**：解析不改 `extent[0]`；水平跨度 = 2·(extent[0]/2)·zoom·k_θ，与容器形状无关。zoom 语义原样。
- **I2 屏心等距**：§1.1 规则本体。验收 = 性质测试：对 reference 输出直接测屏心 ±ε 的每像素角距相等。
- **I3 zoom 正交**：解析与 zoom 无关（签名不读 zoom；resize 与 zoom 两个旋钮正交）。
- **I4 方形退化**：A=1 时 mercator extent_y = extent[0] → M_half = π → ±85.051129°。EPSG pin 成为方形容器默认。
- **I5 连续渐近**：任意 A ∈ (0, ∞) 无 NaN 无分支——cylindrical/pannini 的 atan 渐近、planet 的平面延展、mercator 的 tanh/asin 饱和（继承 mercator spec I6：m ≳ 9 时 f32 tanh 饱和到 1，屏沿收敛到极行，连续极限非缺陷）。
- **I6 手动位保真**：`fit: 'extent'` + 方形元组 ⟹ m_x = m_y = max/2，与今日 `m = max(extent)/2` 逐位一致，**任意视口**——今日方形元组本就塌缩成 max/2，故 gate A 钉此模式即看守 v0.2.2 像素契约（§5.1）。

### 2.4 types.ts 的 `[width, height]` 注释兑现

types.ts 里那段「order is presently unobservable — written down here before a non-square extent turns an unstated assumption into a silent transposition」的预言性注释，本卡就是它等的那一天：`extent[1]` 从死槽位变成活语义，注释随之改写为真实语义描述。

## 3. API 与状态流

### 3.1 类型（src/core/types.ts）

```ts
// 四个非线性成员各加（linear 不加）：
fit?: 'container' | 'extent'   // 缺省 'container'
```

- 运行时宽松：任何 ≠ 'extent' 的值按 'container' 读，镜像 unknown-kind 的既有处理；`assertProjectionFinite` 不需要新断言（fit 是字面量联合，注释说明即可）。
- 命名 `fit`：读作「垂直从哪来」——容器（container）还是 extent[1]（extent）。审阅时可否决改名。

### 3.2 状态流（每帧解析，永不缓存）

```
#resize → setAspect(W/H) ──┬─ linear: 照旧写 projection.aspect（公开契约，保持权威）
                           └─ 非线性: 存 #surfaceAspect，变化时 dirty+notify
#drawFrame → backend.setCamera(state, projection, camera.surfaceAspect)
           → buildCameraTransform(..., aspect) → buildProjection → resolveExtent → 矩形 ortho
```

- `CameraController` 新增 `#surfaceAspect`（默认 1，与 linear placeholder 同故事：构造期不可知，1 是最不可见的错法）与 `surfaceAspect` getter。
- 解析发生在矩阵构建时，不存储——没有「解析结果过期」这一类状态。
- `snapshotProjection` 的 spread 自然携带 `fit`，无需改。

### 3.3 接口改动

| 位置 | 改动 |
|---|---|
| `src/renderer/backend.ts` | `Backend.setCamera(state, projection, aspect)`——内部接口，`src/index.ts` 零触碰 |
| `src/core/matrix.ts` | `buildProjection(projection, depth, out, aspect)` / `buildCameraTransform(..., aspect)`；非线性：`ortho(-m_x, m_x, -m_y, m_y, QUAD_NEAR, QUAD_FAR)` 矩形化；linear 忽略 aspect 参数（projection.aspect 保持权威）；`m = max/2` 注释块替换为 fit 故事 |
| `src/core/reference.ts` | `ndcToSurface` 吃**已解析**的 extent：`[1, ndcY·extent_y/2, ndcX·extent_x/2]`，max 移除 |
| `src/viewer/viewer.ts` | `#drawFrame` 传 aspect；mercator pan 处理器传 `resolveExtent(projection, surfaceAspect)[1]` |

### 3.4 零触碰清单（明确不动）

- **双 shader（panorama.wgsl / panorama.glsl）**：invClip 携带矩形 ortho，uniform 布局零新增，shader 无感。
- **常量管线**：projection-kinds.json / gen:shaders / generated.ts——本卡不加投影、不改常量。
- **uniform-layout / dispose-order 集成测试**：无 uniform 变化。
- **linear 全链**：fov/aspect/zoom 语义、`buildViewMatrix`、gate A linear 腿——原样。

## 4. 拖拽语义落点

| 链节 | 改动 |
|---|---|
| `classifyDragMercator` | `meters = -(Δy/h) · 2π · zoom · extent_y_resolved`——一屏高的米数 = 2π·zoom·extent_y（今日硬编码 extent[1]=1，是本机制前的占位）。mercator「内容跟手」裁决（mercator spec §4）的忠实延伸 |
| `dragToMercatorPan` | 薄透传 extent_y |
| viewer pan 处理器 | 传 `resolveExtent(projection, surfaceAspect)[1]`；rotate 事件仍报 applied delta，语义不变 |
| 旧四款 `classifyDrag` / `dragToRotation` | **不动**。zoom≠1 的水平跟手性是 pan-zoom-semantics §C1 之外从未裁决的既有行为（C1 是 zoom-1 域），极点 overshoot 是 ADV-3 遗留——均记录在案，候选后续卡 |
| 程序化 `rotate`/`setPose` | 角度线性语义不变 |

## 5. 门禁与保真契约

### 5.1 gate A：fit:'extent' 钉住，基线零波及

gate-a-pixels 的非线性状态 `{ kind, zoom: 1, extent: LEGACY_EXTENT[kind] }` 加 `fit: 'extent'`（I6 位保真）。基线不重拍、不重裁决；linear 腿原样。**框架性偏离本身由本 spec 的用户审阅裁决**（你正在读的这份文档即裁决载体）。

### 5.2 reference.ts 模块头：第四条裁决注记

既有三条（lngOffset 2026-09-23、latOffset、planet 分支点 2026-09-28）之后增第四条：**aspect fit**——v0.2.2 方形 ortho 盒是继承缺陷（方形 quad 网格的遗留），本卡以容器形盒修正；与 lngOffset 同类（继承缺陷的用户裁决修正），同受 gate A `fit:'extent'` 模式的位保真锚看守。CLAUDE.md 的「three adjudicated exceptions」段落同步改 four。

### 5.3 仲裁独立性：性质测试

resolveExtent 被渲染与仲裁两条路径共享，推导没有第二意见（这正是 reference.ts 模块头警告的「共享矩阵盲区」）。所以 I2 的验收是**对 reference 终输出测性质**：对每台相机 × aspect ∈ {1, 16/9, 9/16} × zoom ∈ {1, 0.5}，取屏心 ±ε 两点的 UV，换算角距，断言横竖每像素角距相等——全程不经 resolveExtent，这才是推导的独立仲裁。

### 5.4 测试矩阵

| 层 | 文件 | 内容 |
|---|---|---|
| unit | `test/unit/extent.test.ts`（新） | resolveExtent 精确字面量（如 16:9 cylindrical → [1, 3.534292…]）；fit:'extent' 字面透传；A=1 mercator → [1,1]（I4）；aspect 非正断言；未知 fit 按 container |
| unit | `test/unit/matrix.test.ts` | 矩形 ortho 非均匀缩放项；方形 extent 矩阵与今日逐位一致（I6 矩阵级）；`matrix-baseline.test.ts` 既有 v0.2.2 位级锚在方形 extent 下天然保持 |
| unit | `test/unit/reference.test.ts` | ndcToSurface 逐轴；**等距性质测试**（§5.3，I2 独立仲裁）；既有 EPSG pin 以解析后 [1,1] 传入，数字零漂移 |
| unit | `test/unit/camera-controller.test.ts` | setAspect 非线性 dirty+notify（及不变时不脏）；surfaceAspect getter；fit 经 cameraOptions 往返保持 |
| unit | `test/unit/gestures.test.ts` | classifyDragMercator ×extent_y（一屏高 = 2π·zoom·extent_y 米；符号不变；零尺寸守卫） |
| integration | `gate-a-pixels.test.ts` | 非线性状态钉 `fit:'extent'`（§5.1），基线零波及 |
| integration | `gate-b-projection.test.ts` | aspect 维度：1:1 / 16:9 / 9:16 × 四相机，屏沿 UV 对 reference（解析后 extent） |
| integration | `gate-c-cross-backend.test.ts` | 状态扫描加 aspect 维度（至少方形 + 16:9 + 9:16 各一态），三方一致覆盖矩形 ortho 路径 |
| integration | `test/integration/aspect-fit.test.ts`（新） | 用户故事：容器 resize 后画面无变形（挂载 → 容器变形 → 读回 vs reference at 新 aspect） |

覆盖率 90% 分支门槛照旧强制。

## 6. README / 截图 / demo lab

- **README**：相机表四个非线性行加 `fit`；`extent` 语义改为「[水平校准, 垂直校准（仅 fit:'extent'）]」；rule-of-thumb 更新：非线性相机 zoom 管水平跨度、垂直自动跟容器，`fit:'extent'` 锁定画幅。`check-readme-options` 必须绿。
- **画廊五张截图重拍**（demo/shots/）：今日五张 800×450 全部带 1.78×/3.53× 纵向拉伸，合并后即失真展示——README 是库的脸，不能展示旧缺陷。重拍走既有 playwright-core 捕获流程，800×450 不变（新默认框架下的 16:9 无变形渲染）。
- **demo lab 本卡零改动**：extent 滑条写的 `[v, v]` 在默认 fit 下退化为 extent[0] 校准（extent[1] 被忽略），滑条照常工作；自动垂直即刻生效可见（拖动浏览器窗口即见）。fit 开关、extent[1] 独立滑条、容器形状 playground 等体验设计全部归 demo-lab 重构卡——那张卡 deps 本卡。

## 7. 非目标

- **拖拽跟手性统一**（zoom≠1 水平诚实度、旧四款极点 overshoot/ADV-3）——既有议题，独立后续卡。
- **letterbox / contain 模式**（固定画幅居中留黑）——展示层概念，lab 卡再议；本卡的 `fit:'extent'` 已提供锁定画幅的语义基底。
- **linear 相机的任何改动**——fov+aspect 契约今天是对的。
- **extent[1] 魔法值表示 auto**（NaN/0 特判）——被 `fit` 字段显式取代，显式优于魔法值。
- **各相机异性系数可调**（2π 之外的 k 配置）——推导唯一决定，不是自由参数。
- **shader / uniform / 常量管线**——零触碰（§3.4）。

## 8. 落点文件清单（plan 的锚）

| 文件 | 动作 |
|---|---|
| `src/core/types.ts` | 非线性成员 + `fit?`；`[width, height]` 注释兑现为真实语义 |
| `src/core/extent.ts` | **新建**：`resolveExtent` 唯一事实源 |
| `src/core/matrix.ts` | buildProjection/buildCameraTransform 加 aspect；ortho 矩形化；注释块替换 |
| `src/core/reference.ts` | ndcToSurface 逐轴；模块头第四条裁决注记 |
| `src/renderer/backend.ts` | `setCamera` 签名 + aspect |
| `src/renderer/webgpu/backend.ts` / `src/renderer/webgl2/backend.ts` | setCamera 透传 aspect |
| `src/viewer/camera-controller.ts` | `#surfaceAspect` + getter；setAspect 全相机化 |
| `src/viewer/viewer.ts` | #drawFrame 传 aspect；mercator pan 传解析 extent_y |
| `src/interaction/gestures.ts` | classifyDragMercator ×extent_y |
| `src/interaction/input-controller.ts` | dragToMercatorPan 透传 |
| `README.md` | 相机表 fit、extent 语义、rule-of-thumb |
| `CLAUDE.md` | reference.ts 裁决清单 three → four |
| `demo/shots/*.png` | 五张重拍（新默认框架） |
| `test/unit/extent.test.ts` | **新建** |
| `test/unit/{matrix,reference,camera-controller,gestures}.test.ts` | §5.4 对应用例 |
| `test/integration/gate-{a,b,c}-*.test.ts` | §5.4 对应维度 |
| `test/integration/aspect-fit.test.ts` | **新建**用户故事 |
