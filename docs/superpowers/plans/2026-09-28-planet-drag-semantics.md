# planet 拖拽语义：可驾驶中心（planet-drag-semantics）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 planet 相机的 latitude 项从「phi 均匀平移」（环带泵吸 + 极点糊屏）升格为真球面旋转（tilt Möbius 预变换），使屏幕中心显示源点 = 姿态 `(povLatitude, povLongitude)`——「行星转起来」。

**Architecture:** 三处同步点同一轮全改：`src/core/reference.ts`（float64 仲裁者，先改 + 先测）、`panorama.wgsl`、`panorama.glsl`（两份手抄 shader，token-for-token 单测钉住同形）。改动只有一处公式：删掉 phi 行的 `- lat`，换成作用在 `w = zz + i·yy` 上的 Möbius；`theta -= lng` 一行不动（旋转等变性，spec §2.2）。

**Tech Stack:** TypeScript 5 strict / WGSL / GLSL ES 3.00；vitest（unit node + integration browser）。

**Spec:** `docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md`（已提交 master，含 2026-09-28 勘误 `790920b`：I2 绝对值、旋转轴、tilt 符号；另有同日 plan 期勘误——§2.3 防护改为对 `d2` 下限夹持，见该节）。

**测试口径:** 卡片 verify = `npm run typecheck && npm run lint && npm test`。集成测试零翻转（spec §5 已逐一核查：三个门与用户故事均不钉 planet 垂直拖拽像素）。

---

## 改动事实（写代码前读一遍，全部已对源码核实）

**现状公式**（三处逐句同形，`src/core/reference.ts:168-192` 为准）：

```
yy = y·zoom;  zz = −(z·zoom)
m = 1 + zz² + yy²          // 逆 stereographic：|w| = tan(θ/2)
p = 2zz/m;  q = 2yy/m;  r = (m−2)/m
theta = atan(p/q) + 象限修补;  theta −= lng
phi = atan(r/√(p²+q²)) + π/2 − lat     // ← 本任务要换掉的唯一一行
```

**缺陷**：`− lat` 是均匀极角平移——屏幕中心恒为极点（`phi` 平移动不了投影奇点），|lat|=90° 时 v 越出 [0,1] 被采样器夹持成极点糊屏。cylindrical/pannini 的中心是普通点（`phi_center = π/2 − lat`），早已是「中心跟随姿态」；planet 是唯一违例。

**修法**：删除 `phi` 的 `− lat`，在 `w` 进逆 stereographic 之前插入倾斜 Möbius（spec §2.1，含勘误）：

```
tilt = lat                    // 不取负！见下「符号已定死」
ct = cos(tilt/2);  st = sin(tilt/2)
w' = (ct·w − i·st) / (−i·st·w + c)      // w 视为复数 zz + i·yy
```

复数除法展开成实部分量（shader 与 reference 同形）：

```
numRe = ct·zz;      numIm = ct·yy − st
denRe = ct + st·yy; denIm = −st·zz
d2 = denRe² + denIm²
zn = (numRe·denRe + numIm·denIm) / d2      // 之后 zn/yn 完全顶替 zz/yy
yn = (numIm·denRe − numRe·denIm) / d2      // 进入原有的 m/p/q/r/theta/phi 流水线
```

**符号已定死（spec I4，勘误 `790920b`）**：`tilt = lat`，不经 negation。几何：该 Möbius 的不动点是 w = ±1（屏幕左右轴），中心 w=0 映到 `w'(0) = −i·tan(tilt/2)`——**拖下（lat<0）→ w'(0) 落 +i 射线（屏幕上方）→ 中心改采上方内容 → 画面跟随手指**，与 cyl/pannini 的中心采样方向逐点一致（两者 v_center 均随 |拖拽| 增大）。

**四条不变量（单测逐条钉，spec §2.1）**：

- **I1 恒等**：tilt=0 → ct=1, st=0 → zn=zz、yn=yy **逐位**（d2=1 精确、乘 0/1 精确）。默认小行星一个比特不动，门 A 零波及的构造性保证。数值验证过：w=1 不动、w=i→0、w=2i→i/3、极角恰 −tilt。
- **I2 中心契约**：中心采样 `v = |lat_rad|/π`（极点↔地平线，clamp 下 ∈[0,½]）；方位角 lat>0 走 π 分支（q<0）、lat<0 走 0 分支。**极点是默认中心 ⟹ 拖上/拖下都只能离开极点，符号选择的是滚落经线**——v_center 带 |·| 不是笔误。
- **I3 无中心退化**：Möbius 分母零点在半径 `cot(|lat|/2)`（≥1，clamp 域内永不在 w=0）。
- **I4 方向**：见上。

**退化片元防护（spec §2.3，只进 shader）**：tilt ≳39°（视口对角）/≳53°（边中点）后分母零点进入视口，`d2=0` 处 `0/0 = NaN`。两份 shader 给 `d2` 加下限 `max(d2, 1e-15)`；**reference（float64）故意不加**——它是仲裁者不是像素比较者，测试采样避开零点（零点位于 |yy| ≥ 1, zz = 0，网格取 |y| ≤ 0.75 即可全避）。uniform 零改动：ct/st 在 shader 内从现有 lat uniform 算。

**门禁影响（spec §3）**：门 A 构造性零波及（可比较态全在 lat=0 = I1 恒等；lng 路径代码未动）；门 B 照绿（`maxChannelDiff > 2` 与公式无关，gate-b-projection.test.ts:23-47）；门 C 是执行网。`npm run gen:shaders` **不需要跑**（无新投影类型，generated.ts 不涉及）。

**既有测试零波及的依据（已核实）**：`test/unit/reference.test.ts` 的 output-range / no-NaN / faithful-NaNs / isDegenerate-guard 四组扫描全部在 `povLatitude: 0` 下运行（:5 `state`、:196 显式 0）→ I1 恒等下逐位不变；`isDegenerate` planet 的 `y===0 && z===0` 在 tilt≠0 时已不再退化，但没有任何测试在 tilt≠0 采中心除本 plan 新增用例。`test/unit/shaders.test.ts`（WGSL 侧）无 latitude 结构断言（grep 核实），不需翻。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/core/reference.ts` | float64 仲裁者：`projectPlanet` 重写 + 头注/`latOffset` 文档更新 | Modify :27-41, :91-104, :168-192 |
| `test/unit/reference.test.ts` | F5 表 planet 行移出 + 新 planet-tilt describe（I1–I4） | Modify :313-351, 追加新 describe |
| `src/renderer/webgpu/shaders/panorama.wgsl` | `project_planet` 重写（含 1e-15 下限）+ lat 来源注记 | Modify :171-195, :250-256 |
| `src/renderer/webgl2/shaders/panorama.glsl` | `project_planet` 重写（与 WGSL token 同形）+ lat 来源注记 | Modify :144-168, :225-232 |
| `test/unit/webgl2-shaders.test.ts` | `/-\s*lat\b/` 循环 planet 移出 + planet Möbius 结构断言 | Modify :138-146 |

**顺序**：Task 1（reference + 单测）→ Task 2（两份 shader 同一提交，完成三处同步）→ Task 3（全量验证 + 人工验收）。Task 1 与 Task 2 之间的中间态（reference 已改、shader 未改）没有任何测试变红：reference 单测绿、shader 单测绿（`/-\s*lat\b/` 旧断言此刻仍真）、门 C 在 Task 3 才跑。

---

### Task 1: reference.ts——仲裁者先行（TDD）

**Files:**
- Modify: `src/core/reference.ts:168-192`（projectPlanet）、`:27-41`（头注 departure）、`:91-104`（latOffset doc）
- Test: `test/unit/reference.test.ts`（F5 describe :313-351 翻转 + 追加新 describe）

- [ ] **Step 1: 翻转 F5 表 + 写新的 planet-tilt 测试（先红）**

`test/unit/reference.test.ts` :322-326 的 `nonLinear` 表删掉 planet 行（cyl/pannini 留下），describe 块注释补一行去向说明。改后：

```ts
describe('latitude on the non-linear cameras (the F5 fix)', () => {
  /*
   * Derived, not observed: each non-linear phi is `... + HALF_PI - latRad`, and
   * v is phi / PI, so raising povLatitude from 0 to 30 must shift v by exactly
   * -(30 * PI / 180) / PI = -1/6 and leave theta -- therefore u -- untouched.
   * The size of the shift also pins the units: subtracting the raw degrees
   * instead of the radians would move v by -30/PI, and folding latitude into
   * theta would move u instead of v.
   *
   * Planet left this table on 2026-09-28: its latitude is no longer a phi
   * offset but the tilt of a Mobius pre-transform -- see the planet-tilt
   * describe below.
   */
  const nonLinear: Array<[string, Projection]> = [
    ['cylindrical', { kind: 'cylindrical', zoom: 1, extent: [1, 1] }],
    ['pannini', { kind: 'pannini', zoom: 1, extent: [4, 4] }]
  ]
```

（`it.each` :328-339 与 linear 用例 :341-350 原样不动。）

然后在文件末尾（:351 的 describe 收尾之后）追加：

```ts
describe('planet tilt (the steerable centre, 2026-09-28 spec)', () => {
  /*
   * The planet latitude is a sphere rotation: the Mobius pre-transform of
   * projectPlanet rolls the source point at polar angle |lat| to the screen
   * centre, so the centre displays the pose (povLatitude, povLongitude).
   * The four blocks pin the spec's invariants I1-I4 in order.
   */
  const projection: Projection = { kind: 'planet', zoom: 1, extent: [4, 4] }
  const wrap = (x: number): number => ((x % 1) + 1) % 1

  it('is bit-identical to the legacy closed form at lat = 0 (I1)', () => {
    // A verbatim copy of the pre-tilt formula. The tilt must be the identity
    // here term for term, which is gate A's unit-level precondition. Points
    // stay off the zz = 0 and yy = 0 axes so a signed-zero difference cannot
    // masquerade as (or hide) a real one.
    const legacy = (y: number, z: number, lng: number) => {
      const yy = y
      const zz = -z
      const m = 1 + zz * zz + yy * yy
      const p = (2 * zz) / m
      const q = (2 * yy) / m
      const r = (m - 2) / m
      let theta = Math.atan(p / q)
      if (q < 0) theta = Math.PI + theta
      else if (q > 0 && p < 0) theta = 2 * Math.PI + theta
      theta -= lng
      const phi = Math.atan(r / Math.sqrt(p * p + q * q)) + Math.PI / 2
      return { u: wrap(theta / (2 * Math.PI)), v: phi / Math.PI }
    }
    for (const [y, z] of [[0.3, 0.7], [-0.4, 0.2], [0.5, -0.6], [-0.25, -0.85]] as const) {
      const uv = project(1, y, z, { povLatitude: 0, povLongitude: 90 }, projection)
      const want = legacy(y, z, (90 * Math.PI) / 180)
      expect(uv.u, `u at (y=${y}, z=${z})`).toBe(want.u)
      expect(uv.v, `v at (y=${y}, z=${z})`).toBe(want.v)
    }
  })

  it('shows the pose at the screen centre: v = |lat| / PI, u tracks lng (I2)', () => {
    // ndcToSurface(0, 0, [4, 4]) is the surface point the exact centre of the
    // viewport reconstructs. The centre's sampled azimuth is PI for lat > 0
    // (the q < 0 fixup branch) and 0 for lat < 0: the sign of lat picks which
    // meridian the roll follows, |lat| how far -- the pole being the default
    // centre, either drag direction can only leave it.
    for (const [latDeg, lngDeg] of [[30, 90], [-45, 350], [90, 180], [-90, 0], [60, 0]] as const) {
      const centre = ndcToSurface(0, 0, projection.extent)
      const uv = project(centre[0], centre[1], centre[2], { povLatitude: latDeg, povLongitude: lngDeg }, projection)
      expect(uv.v, `v at lat=${latDeg}`).toBeCloseTo((Math.abs(latDeg) * Math.PI / 180) / Math.PI, 12)
      const azimuth = latDeg > 0 ? Math.PI : 0
      const expectedU = wrap((azimuth - (lngDeg * Math.PI / 180)) / (2 * Math.PI))
      expect(uv.u, `u at lat=${latDeg} lng=${lngDeg}`).toBeCloseTo(expectedU, 12)
    }
  })

  it('rolls monotonically from the pole to the horizon and stays finite (I3)', () => {
    let previous = -1
    for (let latDeg = 0; latDeg <= 90; latDeg += 15) {
      const uv = project(1, 0, 0, { povLatitude: latDeg, povLongitude: 0 }, projection)
      expect(Number.isFinite(uv.v), `v at lat=${latDeg}`).toBe(true)
      expect(uv.v, `v at lat=${latDeg}`).toBeGreaterThan(previous)
      previous = uv.v
    }
    expect(previous).toBeCloseTo(0.5, 12)

    // Finiteness across the full tilt range on a grid that never lands on the
    // Mobius pole (|yy| = cot(|tilt|/2) with zz = 0, so |yy| >= 1 everywhere in
    // the clamp range; 0.75 dodges it). The reference deliberately carries no
    // denominator floor -- it is the arbiter, not a pixel comparison.
    for (let latDeg = -90; latDeg <= 90; latDeg += 15) {
      for (const y of [-0.75, -0.5, 0.5, 0.75]) {
        for (const z of [-0.6, 0, 0.6]) {
          const uv = project(1, y, z, { povLatitude: latDeg, povLongitude: 30 }, projection)
          expect(Number.isFinite(uv.u), `u at lat=${latDeg} (y=${y}, z=${z})`).toBe(true)
          expect(Number.isFinite(uv.v), `v at lat=${latDeg} (y=${y}, z=${z})`).toBe(true)
        }
      }
    }
  })

  it('drags the content with the finger (I4)', () => {
    // A downward drag is povLatitude going negative (classifyDrag negates
    // deltaY). The roll must bring what was ABOVE the centre to the centre:
    // the source point at polar 30 degrees used to sit at w = +i*tan(15 deg)
    // (one arm up the screen-vertical meridian), and after a 30-degree
    // downward roll the centre samples exactly that point.
    const arm = Math.tan(Math.PI / 12)
    const before = project(1, arm, 0, { povLatitude: 0, povLongitude: 0 }, projection)
    const after = project(1, 0, 0, { povLatitude: -30, povLongitude: 0 }, projection)
    expect(after.u).toBeCloseTo(before.u, 12)
    expect(after.v).toBeCloseTo(before.v, 12)
    // The mirror roll: 0 -> +30 brings the point from below instead.
    const mirror = project(1, -arm, 0, { povLatitude: 0, povLongitude: 0 }, projection)
    const up = project(1, 0, 0, { povLatitude: 30, povLongitude: 0 }, projection)
    expect(up.u).toBeCloseTo(mirror.u, 12)
    expect(up.v).toBeCloseTo(mirror.v, 12)
  })
})
```

- [ ] **Step 2: 跑测试确认先红**

Run: `npx vitest run test/unit/reference.test.ts`
Expected: **3 红 1 绿**——I2/I3/I4 红（旧公式中心 u 是 `atan(0/0)=NaN`、v 随 lat 单调**下降**、方向不符），I1 绿（旧公式在 lat=0 本来就是 legacy 闭式——这条钉的是「恒等必须存活改动」，全程要保持绿）。cyl/pannini 的 F5 行与文件其余全部保持绿。

- [ ] **Step 3: 重写 projectPlanet + 两处文档注记**

`src/core/reference.ts` :168-192 整个函数体替换为（`phi` 行的 `- lat` 删除；**reference 故意不带 1e-15 下限**，注释里说明）：

```ts
function projectPlanet (x: number, y: number, z: number, zoom: number, lng: number, lat: number): UV {
  const yy = y * zoom
  // The negation is in the shader and is easy to drop. Without it the planet
  // projection renders mirrored and inside out.
  const zz = -(z * zoom)

  // The tilt: a sphere rotation expressed as a Mobius transform of the plane
  // point w = zz + i*yy, rolling the source point at polar angle |lat| along
  // the screen-vertical meridian to the screen centre (2026-09-28
  // planet-drag-semantics spec, section 2.1). The rotation axis is the
  // horizontal screen axis -- the fixed points are w = +-1 -- and the angle is
  // lat itself, no negation: drag down (lat < 0) rolls the centre so it
  // samples what was above it, the content-follows-the-finger convention the
  // other three cameras use. At lat = 0 this is the identity term for term
  // (sin 0 = 0, cos 0 = 1), so the default little planet does not move by one
  // bit. The WGSL/GLSL twins carry a 1e-15 floor on d2 for the excluded
  // point's viewport crossing; this float64 arbiter deliberately does not --
  // its tests sample around the pole, never on it.
  const tilt = lat
  const ct = Math.cos(tilt / 2)
  const st = Math.sin(tilt / 2)

  // w' = (ct*w - i*st) / (-i*st*w + ct), expanded into real components:
  // numerator (ct*zz, ct*yy - st), denominator (ct + st*yy, -st*zz).
  const numRe = ct * zz
  const numIm = ct * yy - st
  const denRe = ct + st * yy
  const denIm = -st * zz
  const d2 = denRe * denRe + denIm * denIm

  const zn = (numRe * denRe + numIm * denIm) / d2
  const yn = (numIm * denRe - numRe * denIm) / d2

  const m = 1 + zn * zn + yn * yn

  const p = (2 * zn) / m
  const q = (2 * yn) / m
  const r = (m - 2) / m

  let theta = Math.atan(p / q)

  if (q < 0) {
    theta = PI + theta
  } else if (q > 0 && p < 0) {
    theta = TWO_PI + theta
  }

  theta -= lng

  const phi = Math.atan(r / Math.sqrt(p * p + q * q)) + HALF_PI
  return toUV(theta, phi)
}
```

头注 :29-34 的第一条 departure 替换为：

```
 *   - The non-linear cameras consume a properly-converted latitude. v0.2.2
 *     read latitude nowhere on those cameras -- the shader declared
 *     `u_CamPOVLatitude` and never read it, and the recorded uniform stream
 *     shows the viewer never uploaded it either (defect F5). There is nothing
 *     to transcribe, so the term is v1's own, with correct units. Cylindrical
 *     and pannini subtract it from `phi`; planet, since 2026-09-28, consumes
 *     it as the tilt angle of the Mobius pre-transform in `projectPlanet`
 *     (docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md).
 *     See `latOffset`.
```

`latOffset` doc（:91-92 第一段）首行替换为：

```
/**
 * The latitude offset the non-linear projections consume: cylindrical and
 * pannini subtract it from `phi`; planet uses it as the tilt angle of the
 * Mobius pre-transform in `projectPlanet` (2026-09-28 planet-drag-semantics
 * spec, which supersedes the undefined-geometry reading of this term that
 * v1-design §11.4 F5 left open).
 *
 * This term is not a transcription of v0.2.2: on the non-linear cameras the
 ...（其余原样）
```

（其余段落原样保留。）

- [ ] **Step 4: 跑测试确认全绿 + 机械验证**

Run: `npx vitest run test/unit/reference.test.ts`
Expected: 全 PASS（新 4 条 + F5 翻转后 2 行 + 全文件其余）。

Run: `npm run typecheck && npm run lint`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/reference.ts test/unit/reference.test.ts
git commit -m "fix(core): planet latitude becomes a sphere-rotation tilt (planet-drag-semantics spec 2.1)

Replace the uniform phi shift (radial band pumping; the centre is a pole
and no phi shift can move it) with a Mobius pre-transform of the plane
point: the centre now displays the pose, lat=0 stays bit-identical, and
the float64 arbiter deliberately carries no denominator floor. The two
shaders follow in the next commit to complete the three-place sync.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 两份 shader 同步 + shader 单测翻转（同一提交）

**Files:**
- Modify: `src/renderer/webgpu/shaders/panorama.wgsl:171-195`（project_planet）、`:250-256`（lat 来源注记）
- Modify: `src/renderer/webgl2/shaders/panorama.glsl:144-168`（project_planet）、`:225-232`（lat 来源注记）
- Test: `test/unit/webgl2-shaders.test.ts:138-146`

- [ ] **Step 1: 翻转 shader 结构断言（先红）**

`test/unit/webgl2-shaders.test.ts` :138-146 整个 `it` 替换为两个：

```ts
  it('applies the latitude term in cylindrical and pannini', () => {
    // Defect F5. The legacy shader declared u_CamPOVLatitude and never read it,
    // and P3's Task 8 makes that a deliberate behaviour change. Copying the old
    // omission into the second backend would make the two backends disagree
    // only at non-zero latitude -- the hardest possible place to notice.
    // Planet left this table on 2026-09-28: its latitude is no longer a phi
    // offset but the tilt of a Mobius pre-transform, pinned by the next test.
    for (const fn of ['project_cylindrical', 'project_pannini']) {
      expect(skeleton(glslBody(fn)), `${fn} ignores latitude`).toMatch(/-\s*lat\b/)
    }
  })

  it('tilts planet through a Mobius pre-transform of the plane point', () => {
    // 2026-09-28 planet-drag-semantics spec section 2.1. The structural pins:
    // the half-angle trig of the tilt, the component-wise complex division,
    // and the denominator floor that keeps the excluded point's viewport
    // crossing finite (section 2.3). The token-for-token test below holds the
    // WGSL twin to the same shape, and gate C holds both to the reference.
    const body = skeleton(glslBody('project_planet'))
    expect(body, 'half-angle trig of the tilt is missing').toContain('tilt * 0.5')
    expect(body, 'the complex division is not component-wise').toContain('den_re * den_re + den_im * den_im')
    expect(body, 'the excluded-point floor is missing').toContain('1e-15')
  })
```

- [ ] **Step 2: 跑测试确认先红**

Run: `npx vitest run test/unit/webgl2-shaders.test.ts`
Expected: 新 planet 断言红（`tilt * 0.5` 不存在）；其余全绿——含 token-for-token（两份 shader 都还没改，仍然互相同形）。

- [ ] **Step 3: 改 WGSL `project_planet`**

`src/renderer/webgpu/shaders/panorama.wgsl` :171-195 整个函数替换为：

```wgsl
fn project_planet(s: vec3f, zoom: f32, lng: f32, lat: f32) -> vec2f {
  let y = s.y * zoom;
  // The negation is in the legacy shader and is easy to drop. Without it the
  // planet projection renders mirrored and inside out.
  let z = -(s.z * zoom);

  // The tilt: a sphere rotation expressed as a Mobius transform of the plane
  // point w = z + i*y, rolling the source point at polar angle |lat| along
  // the screen-vertical meridian to the screen centre (2026-09-28
  // planet-drag-semantics spec, section 2.1). The rotation axis is the
  // horizontal screen axis (the fixed points are w = +-1) and the angle is
  // lat itself, no negation: drag down (lat < 0) rolls the centre so it
  // samples what was above it -- content follows the finger, the convention
  // the other three cameras use. At lat = 0 this is the identity term for
  // term, so the default little planet does not move by one bit.
  let tilt = lat;
  let ct = cos(tilt * 0.5);
  let st = sin(tilt * 0.5);

  // w' = (ct*w - i*st) / (-i*st*w + ct), expanded into real components:
  // numerator (ct*z, ct*y - st), denominator (ct + st*y, -st*z).
  let num_re = ct * z;
  let num_im = ct * y - st;
  let den_re = ct + st * y;
  let den_im = -st * z;
  // The excluded sphere point crosses the viewport at large tilts (spec
  // section 2.3): exactly on its crossing the denominator is zero and the
  // division would be 0/0 = NaN, a bad pixel. The floor keeps w' finite and
  // the fragment at its continuous limit. The float64 reference deliberately
  // carries no floor -- it is the arbiter, and its tests sample around the
  // pole, never on it.
  let d2 = max(den_re * den_re + den_im * den_im, 1e-15);

  let zn = (num_re * den_re + num_im * den_im) / d2;
  let yn = (num_im * den_re - num_re * den_im) / d2;

  let m = 1.0 + zn * zn + yn * yn;

  let p = (2.0 * zn) / m;
  let q = (2.0 * yn) / m;
  let r = (m - 2.0) / m;

  var theta = atan(p / q);

  if (q < 0.0) {
    theta = PI + theta;
  } else if (q > 0.0 && p < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  let phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;
  return to_uv(theta, phi);
}
```

- [ ] **Step 4: 改 GLSL `project_planet`（与 WGSL 逐 token 同形）**

`src/renderer/webgl2/shaders/panorama.glsl` :144-168 整个函数替换为（仅声明关键字 `let`→`float`、既有 negation 注释差异保留——两者都被 skeleton 归一化/剥离，token-for-token 测试不受影响；**字面量必须与 WGSL 完全一致**：`0.5`、`1.0`、`2.0`、`1e-15`）：

```glsl
vec2 project_planet (vec3 s, float zoom, float lng, float lat) {
  float y = s.y * zoom;
  // The negation is in the WGSL and in the legacy shader, and it is easy to
  // drop. Without it the planet projection renders mirrored and inside out.
  float z = -(s.z * zoom);

  // The tilt: a sphere rotation expressed as a Mobius transform of the plane
  // point w = z + i*y, rolling the source point at polar angle |lat| along
  // the screen-vertical meridian to the screen centre (2026-09-28
  // planet-drag-semantics spec, section 2.1). The rotation axis is the
  // horizontal screen axis (the fixed points are w = +-1) and the angle is
  // lat itself, no negation: drag down (lat < 0) rolls the centre so it
  // samples what was above it -- content follows the finger, the convention
  // the other three cameras use. At lat = 0 this is the identity term for
  // term, so the default little planet does not move by one bit.
  float tilt = lat;
  float ct = cos(tilt * 0.5);
  float st = sin(tilt * 0.5);

  // w' = (ct*w - i*st) / (-i*st*w + ct), expanded into real components:
  // numerator (ct*z, ct*y - st), denominator (ct + st*y, -st*z).
  float num_re = ct * z;
  float num_im = ct * y - st;
  float den_re = ct + st * y;
  float den_im = -st * z;
  // The excluded sphere point crosses the viewport at large tilts (spec
  // section 2.3): exactly on its crossing the denominator is zero and the
  // division would be 0/0 = NaN, a bad pixel. The floor keeps w' finite and
  // the fragment at its continuous limit. The float64 reference deliberately
  // carries no floor -- it is the arbiter, and its tests sample around the
  // pole, never on it.
  float d2 = max(den_re * den_re + den_im * den_im, 1e-15);

  float zn = (num_re * den_re + num_im * den_im) / d2;
  float yn = (num_im * den_re - num_re * den_im) / d2;

  float m = 1.0 + zn * zn + yn * yn;

  float p = (2.0 * zn) / m;
  float q = (2.0 * yn) / m;
  float r = (m - 2.0) / m;

  float theta = atan(p / q);

  if (q < 0.0) {
    theta = PI + theta;
  } else if (q > 0.0 && p < 0.0) {
    theta = TWO_PI + theta;
  }

  theta -= lng;

  float phi = atan(r / sqrt(p * p + q * q)) + HALF_PI;
  return to_uv(theta, phi);
}
```

- [ ] **Step 5: 两处 lat 来源注记各加指向（注释，不进 token 测试）**

WGSL `panorama_uv` 内 :250-256 的 lat 注释块末尾（`let lat = ...` 之前）追加一段：

```
  // 2026-09-28: on planet this value is no longer subtracted from phi -- it is
  // the tilt angle of the Mobius pre-transform in project_planet (the
  // steerable-centre semantics,
  // docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md).
  // Cylindrical and pannini still subtract it.
```

GLSL `main()` 内 :225-232 的 lat 注释块：末句 `Both shaders carry the \`- lat\` term; neither carries it alone.` 替换为：

```
  // 2026-09-28: planet no longer subtracts it from phi -- it is the tilt
  // angle of the Mobius pre-transform in project_planet (steerable-centre
  // semantics; docs/superpowers/specs/2026-09-28-planet-drag-semantics-design.md).
  // Cylindrical and pannini still carry the `- lat` term; neither carries it
  // alone.
```

- [ ] **Step 6: 跑 shader 单测确认全绿 + 机械验证**

Run: `npx vitest run test/unit/webgl2-shaders.test.ts test/unit/shaders.test.ts`
Expected: 全 PASS——含 token-for-token（`bodyTokens` 归一化 `let`/`float` 后两份 body 逐 token 相等）、字面量多重集（`0.5`/`1.0`/`2.0` 两侧同集；`1e-15` 无小数点不进多重集但 token 序列相等）、atan 计数（每 body 仍 1 处）、cyl/pannini 的 `/-\s*lat\b/` 循环。

Run: `npm run typecheck && npm run lint`
Expected: PASS。

- [ ] **Step 7: Commit（两份 shader + 测试 + 注记，一个提交，完成三处同步）**

```bash
git add src/renderer/webgpu/shaders/panorama.wgsl src/renderer/webgl2/shaders/panorama.glsl test/unit/webgl2-shaders.test.ts
git commit -m "fix(renderer): planet tilt in both shaders, completing the three-place sync (planet-drag-semantics spec 2.1/2.3)

Same Mobius pre-transform as the reference commit before it, with the
1e-15 denominator floor the float64 arbiter deliberately lacks. WGSL and
GLSL changed in one commit -- the token-for-token unit test and gate C
exist to catch anything else.

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 全量验证 + 人工语义验收

**Files:** 无新改动（本任务只验证；发现缺陷回到对应 Task 修，重跑本任务）。

- [ ] **Step 1: 全量机器验证（卡片 verify）**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 三段全 PASS。重点看：

- 单测：新 planet-tilt 4 条 + F5 翻转后 cyl/pannini 2 行 + token-for-token；
- 覆盖率：90% 分支红线照过（projectPlanet 新代码是直线无新分支）；
- **门 A**（gate-a-pixels，v0.2.2 基线）必须零波及——可比较态全在 lat=0，I1 逐位恒等 + lng 路径代码未动。**门 A 红了即实现错**（多半是 tilt 符号或 Möbius 系数抄错），对照 spec §2.1 四不变量排查，不许调容差；
- **门 B**（gate-b-projection）照绿：lat=0 vs 45 画面仍不同（现在是旋转），`maxChannelDiff > 2` 与公式无关；
- **门 C**（gate-c-cross-backend）照绿：两份 shader 同一提交改的同形代码，CPU reference 是 tiebreaker。

- [ ] **Step 2: 人工语义验收（`npm run start` → 右栏切 planet）**

逐条过（spec §7）：

1. 默认视图与改前逐帧相同（lat=0 恒等）；
2. 水平拖拽手感与改前一致（极点处 = 自旋）；
3. 垂直拖拽：行星滚起，中心内容随拖拽离开极点滚向赤道；拉满（|lat|=90°）停在地平线视角，无糊屏、无泵吸；
4. 画面跟随手指，与 linear/cylindrical 同向；
5. 滚轮 zoom / extent 调节全程无坏像素（1e-15 下限生效）。

Expected: 五条全过。任何一条不过 → 回 Task 1/2 修 → 重跑 Step 1 与本步。

- [ ] **Step 3: 收尾**

按卡头执行约定走 superloop 的 task-finish（完成报告、自审记录落卡），禁用 finishing-a-development-branch。

---

## Self-Review（已跑）

- **Spec 覆盖**：§2.1 Möbius + I1–I4（Task 1 四个 it 逐条对应；tilt=lat 符号按勘误 `790920b` 定死）；§2.2 `theta -= lng` 保留（两份 shader 代码里原行未动）；§2.3 退化防护（Task 2 两份 shader 的 `max(d2, 1e-15)`，reference 注释明示故意不带）；§2.4 uniform 零改动（ct/st 在 shader 内从现有 lat 算，无 uniform 触碰）；§3 三处同步 + 门禁影响（Task 2 同一提交、Task 3 Step 1 逐门预期）；§4 不动清单（cyl/pannini 公式、classifyDrag/InputController/camera-controller、公开面、generated.ts 均未出现在任何 File 条目）；§5 两次翻转（Task 1 Step 1 的 F5 表、Task 2 Step 1 的 `/-\s*lat\b/` 循环）+ 新增四类用例；§6 文档注记（Task 1 Step 3 头注/latOffset、Task 2 Step 5 两份 shader lat 注记）；§7 验收（Task 3 两步）——逐节有任务对应。
- **占位符**：无 TBD/TODO；每个代码步骤给全量代码；两处「其余原样」引用的都是本 plan 未触碰的既有内容且已锚定行号。
- **类型/符号一致**：`tilt/ct/st/numRe/numIm/denRe/denIm/d2/zn/yn` 在 reference 与两份 shader 间按各语言命名惯例对应（TS camelCase vs shader snake_case，与既有 `yy/zz` vs `y/z` 的不对称同款）；测试引用的 `project/ndcToSurface/Projection/CameraState` 均为现有导出（reference.test.ts:1-3 已 import，无需改 import）；`skeleton/glslBody/bodyTokens` 均为既有测试内 helper；shader 断言的三个 toContain 子串与 Task 2 Step 3/4 写入的代码逐字符一致。
