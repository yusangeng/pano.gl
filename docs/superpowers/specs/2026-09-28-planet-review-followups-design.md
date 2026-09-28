# planet 审查跟进：分支点规范值与门 C planet 仲裁腿（planet-review-followups）Design Spec

## 0. 这份 spec 决定什么

来源：planet-drag-semantics（已合并）审查的两条例外——红队 RT1（CRITICAL，裁决保留：±90 精确命中站点 `atan(0/0)=NaN`）与 RT3（INFO，no-action：门 C 像素级仲裁腿只覆盖 cylindrical）。协调者审查意见已各留后续钩子（「spec §2.3 勘误留待后续 spec 维护」「扩门 C 仲裁到 planet 记为后续任务建议」）。**2026-09-28 用户裁决：两例均修正**（「第一个和第三个问题，应该修正一下」）。

本 spec 决定：

1. **分支点规范值**：planet 投影 Möbius 归约到达 `p = q = 0` 的全部站点，在 WGSL、GLSL、reference.ts 三处实现中取 spec 定义的单值规范值——**公开推翻** planet-drag-semantics 时期对 lat=0 中心像素的 faithful-NaN 保留立场（卡 1，domain 层）。
2. **门 C 仲裁腿扩到 planet**：`compareWithReference` 增 planet lat=30 态，补上 tilted planet 的像素级第三方裁判（卡 2，foundation 层）。

不决定：uniform 冻结（原 spec §2.4）延续不动；perf ×2 例外（ct/st 逐片段求值）维持 no-action；pannini / linear 的仲裁范围不在本次扩张。

## 1. 问题定义：分支点 NaN 的两类构成

旧裁决把全部站点 NaN 归为「faithful-NaN 同类」保留。逐类核验后两类性质不同：

- **A 类（lat=0 中心像素）**：`w = 0` → 分子全零 → `p = q = 0` → `atan(0/0)`，**float64 reference 同样产出 NaN**。shader 与仲裁者一致地 NaN——旧立场（「Normalising the NaN away would be a silent spec change」）钉的是它。
- **B 类（lat 恰 ±90 clamp 的精确命中站点）**：f32 `sin`/`cos` 对同一 f32 半角舍入到同一位 → `den_re` 恰 +0（Möbius 极点站点）或 `w' = 0`（倾斜中心站点，`d2 = 2`，任何 d2 下限夹持够不着）→ `p = q = 0` → NaN。**float64 reference 在这些点是有限值**（f64 的 `sin(π/4)` 与 `cos(π/4)` 差 1 ulp，`d2 ≈ 1.2e-32 ≠ 0`，落侧逐位确定）——只有 f32 shader NaN，严格说是 **shader 单方面偏离仲裁者**。

站点枚举（沿用 planet-drag-semantics 卡「遗留风险·RT1」的记录）：lat 恰 +90 与 −90 各有 1 个 Möbius 极点站点 + 1 个倾斜中心站点，共 4 个 B 类站点；触发需视口奇偶配合（zoom=1 时奇宽 × 高≡2 mod 4 的特定像素；zoom=1.25 × 高 5 等有理组合同达 y=±1）。门禁画布全偶数，CI 永不触达；运行时奇尺寸视口拖到 ±90 可见 ≤2 NaN 像素——本次修正的用户可见效果即它的消失。

按用户裁决，两类全部修正。

## 2. 决定一：分支点规范值（卡 1 `planet-exact-hit-nan`，domain）

### 2.1 规范值定义

- **分支点集合** := Möbius 归约到达 `p = q = 0` 的全部 (lat, 片元) 站点（A 类 ∪ B 类）。
- 在分支点上：`theta :=` 规范值（单值、确定、可复现），`v` 保持连续极限。
- **三处同规**：WGSL（`panorama.wgsl`）、GLSL（`panorama.glsl`）、reference.ts（`projectPlanet`）实现同一条规则——守卫加在 p、q 算出之后、`atan` 之前，条件统一为「p 与 q 均恰为零」；reference 同步加同一分支（仲裁者执行 spec 定义，而非复制 shader 算术，独立性不受伤）。注意命中集因精度而异：f64 在 B 类站点 p、q 非恰零（`sin(π/4)`/`cos(π/4)` 差 1 ulp），reference 的守卫实践上只在 A 类命中——B 类站点它的既有有限值原样保留，正是 §2.2 规范值要复现的目标。

### 2.2 规范值的选取规则（plan 期先测量后定）

四个 B 类站点的 f64 既有值已经有限且逐位确定。**优先**选取能同时复现这四个值的单条规则（使 reference 在 B 类站点的钉值不变、shader 与仲裁者在站点上精确一致）；若无此类一刀切规则，退到**常量侧规则**，并在单测中逐站点钉住三处取值与（若有）分歧及理由。spec 只钉要求：单值、确定、三处同文、逐站点可钉。

### 2.3 测试翻转与新增

- `test/unit/reference.test.ts`：A 类中心钉从 NaN 翻为规范值，原「silent spec change」注释改写为引用本裁决（2026-09-28 用户裁决公开推翻，非静默）；四个 B 类站点钉从 u=NaN 翻为规范值；f32 复刻证人（`shaderPlanet`）同步加守卫分支，保持对 shader 体的逐分量忠实拷贝。
- `test/unit/webgl2-shaders.test.ts`：结构钉增钉守卫表达式；token-for-token parity 与 atan2 禁令不动。
- 门 A / B / C 画布全偶数 → 分支点永不命中 → **零像素变化，基线不重做**。
- 两份 shader 内 floor 注释块的「精确命中不归一化」表述同步改写。

### 2.4 旧 spec 勘误

`docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md` §2.3 追加日期勘误段（沿用该文件已有勘误格式）：floor 在极点**附近**交付有限 zn/yn（f32 证人钉住的档位），但在精确分支点 `p = q = 0` → `atan(0/0) = NaN`；按 2026-09-28 用户裁决，分支点在三处实现中取规范值，原「极限值连续」表述在精确命中处不成立。planet-drag-semantics 任务卡是历史记录，不改。

## 3. 决定二：门 C planet 仲裁腿（卡 2 `gate-c-planet-arbiter`，foundation）

- 门 C 增一条 planet 仲裁腿：`compareWithReference(STATES[1], projectionFor('planet', STATES[1]))`——即合并卡建议的 **planet lat=30 / lng=45 / zoom=1**（该倾角极点在面外，无退化干扰；128×128 偶数画布天然避开分支点）。
- `compareWithReference` 本身 kind 无关（吃 `(camera, projection)` 走 `project()`），无需改 support 助手。
- **容差四要求**：实测、有界、带推导注释、留余量。数值不预设——plan 期先跑实测 maxDiff 再钉（planet 因 Möbius 逐分量复除与 4×4 extent 采样，预期容差大于 cylindrical 的 ≤3，但必须有界）。该腿抓的故障模式：**两份转写一起错**（A/B 对比与门 A 基线都构造性瞎掉的那类）。

## 4. 拆卡与依赖

| 卡 | slug | 层 | scope 要点 | deps |
|---|---|---|---|---|
| 1 | `planet-exact-hit-nan` | domain | 两份 shader、reference.ts、两个单测文件、`docs/superpowers/specs/*.md`（勘误） | 无 |
| 2 | `gate-c-planet-arbiter` | foundation | `test/integration/gate-c-cross-backend.test.ts` | 无 |

- planet-drag-semantics 已合并，两卡上榜即就绪。
- 两卡零文件交集、无依赖序：守卫在 lat=30 永不触发，卡 2 的容差测量与卡 1 无关；任意先后或并行皆可。
- verify 均为 `npm run build && npm test`（无代码生成步骤）；均无需 bootstrap 与准备工作。

## 5. 不动清单

- uniform 管线与 `uniform-layout` 测试（原 spec §2.4 延续）。
- pannini / cylindrical / linear 的公式与测试（无已知可达同类站点；不在裁决范围）。
- 门 C 极点例外测试（lat=89.5 跨后端腿，有文档的容差放宽）不动。
- `projection-kinds.json` / `generated.ts`（无新投影种类，不跑 gen:shaders）。
- planet-drag-semantics 任务卡（历史记录，append-only）。
- perf ×2 例外维持 no-action（守卫是每片段一个分支判定，量级可忽略）。

## 6. 验收口径

**卡 1**：三处同规可 grep（同一守卫条件与规范值表达式出现在 wgsl / glsl / reference.ts）；分支点全站点（A + 4×B）在 reference 与 f32 复刻证人均 finite 且逐站点钉值；门 A / B / C 全绿且零像素变化；A 类旧 NaN 钉已翻新、注释引用本裁决；旧 spec §2.3 勘误段在档。

**卡 2**：planet lat=30 仲裁腿在档，容差为实测值且带推导注释；cylindrical 既有腿（≤3）不动；全套 verify 绿。
