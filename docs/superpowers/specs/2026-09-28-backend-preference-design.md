# 后端选择选项（backend-preference）Design Spec

- **日期**：2026-09-28
- **状态**：设计已确认（失败语义经用户拍板；API 形态 / lab 落法 / 测试口径经用户确认），待执行
- **关联**：动 `src/` 冻结公开面（纯增量，不破坏 v1.0 冻结）；lab 消费新选项加开关。与 2026-09-24 demo-lab spec 的 demo 免测条款（§7）衔接。

---

## 0. 这份 spec 决定什么

库是双后端（WebGPU 优先、自动回退 WebGL2），但选择写死在 `createBackend`（`src/viewer/backend-factory.ts:73-87`），公开 API 没有强制入口——应用程序与 lab 都无法指定后端，真机对比双后端做不到。本 spec 给 create 选项加后端偏好，并在 lab 状态面板加开关。

**裁决记录**（用户拍板，2026-09-28）：

| 决策点 | 结论 |
|---|---|
| 失败语义 | **严格强制**：指定后端不可用 → `create` 拒绝并点名。绝不静默降级（与 probe() 的设计立场一致："a viewer that cannot render is not a viewer"）；要回退行为用缺省 `'auto'` |
| API 形态 | `backend?: 'auto' \| 'webgpu' \| 'webgl2'`，缺省 = `'auto'`（现行为）。否掉 `forceBackend?`（负空间无法在 UI/URL 具名）与独立工厂函数（公开面膨胀） |
| 类型导出 | `BackendPreference`，`src/index.ts` 纯增量导出 |
| lab 落法 | 状态面板三段开关 + `?backend=` 入书签 + 切换即销毁重建（姿态照搬） |
| 不可用置灰 | **不做**——点不可用后端吃整页报错横幅，这本身就是严格语义该演示的行为；置灰需要更富的 probe 数据，YAGNI |

---

## 1. 库 API

一切都在既有选项对象约定内：

- `src/viewer/options.ts`：`export type BackendPreference = 'auto' | 'webgpu' | 'webgl2'`；`ImageViewerOptions` 加 `readonly backend?: BackendPreference`（`VideoViewerOptions extends ImageViewerOptions` 自带）。
- 校验沿用 `assertProjection` 套路：`assertBackend` 拦"类型对但成员错"（JS 调用者 / cast 场景），非法成员 `TypeError` 且消息列出三个合法值；`undefined` 通过（= auto）。挂在 `validateImageOptions` 里，`validateVideoOptions` 经由它自动覆盖。
- `createBackend(canvas, preference?: BackendPreference)`（`src/viewer/` 内部签名变更，非公开面）：`'auto'`/缺省走现路径一字不动；`'webgpu'` 只试 `WebGPUBackend.create`；`'webgl2'` 只试 `WebGL2Backend.create`。两个公开 create（`image-viewer.ts:90` / `video-viewer.ts` create）把 `valid.backend` 线程化进去；失败清理路径（已 acquire 又失败的 dispose 顺序）不变。
- **只在 create 时可指定，事后不可改**：后端绑定画布与设备，无 `viewer.backend` setter——切换 = 重建 viewer。实际拿到哪个永远可用 `viewer.capabilities.backend` 查（读回值域是 `'webgpu' | 'webgl2'`，不含 `'auto'`——偏好是请求，capability 是事实，两个类型刻意不同域）。
- `probe()` 不动。
- `src/index.ts`：`export type { BackendPreference }`（与 `ImageViewerOptions` 并列）。

## 2. 行为规范

| `backend` 值 | WebGPU 可用 | WebGPU 不可用、WebGL2 可用 | 双双不可用 |
|---|---|---|---|
| 缺省 / `'auto'` | WebGPU | WebGL2 | throw（现行为，不变） |
| `'webgpu'` | WebGPU | **throw 点名 webgpu** | **throw 点名 webgpu** |
| `'webgl2'` | WebGL2 | WebGL2 | **throw 点名 webgl2** |

- 错误消息与现有 `"no usable rendering backend: neither WebGPU nor WebGL2 is available in this browser"` 同风格：`backend 'webgpu' was requested but is unavailable in this browser`（webgl2 同理）——点名所请求的后端，是"降级必须是可编程状态"立场的延伸。
- 兼容性红线：不带 `backend` 的既有调用，行为逐字节不变（`'auto'` 与 `undefined` 在 `createBackend` 内同路径）。

## 3. lab UI

- 状态面板徽章下加一组三段开关 `[auto | WebGPU | WebGL2]`（复用现有 `.segmented` 样式）。
- **开关反映偏好，徽章反映事实**：`'auto'` 在 WebGPU 机器上开关亮 auto、徽章亮 WebGPU——这个区分是本面板的教学点，spec 刻意保持两处信息不同源。
- 切换后端 = `publish(null)` → `dispose()` → 重建（`backend` 选项随 `installViewer` 线程化，姿态经 `cameraOptions` 照搬——与图↔视频跨类切换同款机器，不新造生命周期）。
- URL 加 `?backend=`：boot 读时非法值静默回退 `'auto'`（书签是便利不是接口）；**记偏好不记事实**——写的是开关状态，永不是 `capabilities.backend`，否则 auto 机器上的书签会把别的机器钉死在 webgpu。
- **写回只在重建成功之后**：lab 横幅是终局式、恢复靠 Reload（`main.ts` `showBanner`），若切换失败前就把新偏好写进 URL，Reload 会带着坏参数再失败一次、永远出不来。切换失败时 URL 留在旧值，Reload 回到上一个可用态。
- **boot 失败于强制后端时，先摘参再亮横幅**：手工构造 / 跨机器带来的 `?backend=webgpu` 在无 WebGPU 浏览器里 boot 即败，摘掉参数后 Reload 落回 `'auto'`，同一个按钮从死循环变成恢复路径。
- 现有 `"Why WebGL2?"` hint 的显示条件（`backend === 'webgl2'`）不动——天然覆盖强制态。
- 状态面板的 probe 只喂一次的语义不变（开关不依赖 probe 数据，见裁决表"不可用置灰"）。

## 4. 错误路径汇总

1. 强制后端不可用 → `create` 拒绝、消息点名后端；lab 走现有 "Viewer creation failed" 整页横幅，detail 带原始错误。恢复路径分两种：切换期失败（URL 未写新值，Reload 回旧态）与 boot 期失败（先摘 `?backend=` 再亮横幅，Reload 落回 auto）——见 §3。
2. URL `?backend=` 非法值（拼错的字符串）→ 静默回退 `'auto'`；合法但不可用 → 走错误路径 1。
3. 强制会话中 device-lost → 现有 device-lost 横幅逻辑不变。
4. 校验层：非成员字符串（JS 调用者）→ `TypeError` 列合法值。

## 5. 测试口径

本卡动 `src/`，**库侧无免测条款**（区别于 demo-lab）；demo 侧沿 2026-09-24 spec §7 免测条款。

- **单测**（node，不碰 GPU，扩展既有 `test/unit/constructor-validation.test.ts`——`validateImageOptions` 的用例本来就住在那里）：`backend` 校验——非法成员 throw 且消息列合法值；三个合法值 + 缺省通过；图/视频两个 validate 入口都覆盖。入全局 90% 分支闸。
- **集成·真 GPU 项目**（`test/integration/backend-preference.test.ts`，user-story 式走公开面）：强制 `'webgl2'` → `capabilities.backend === 'webgl2'` 且渲染像素与缺省路径在 Gate C 容差内一致；强制 `'webgpu'` → `capabilities.backend === 'webgpu'`。
- **集成·no-webgpu 项目**（`test/integration/fallback/backend-preference.test.ts`，只在 `--disable-gpu` 项目收集）：强制 `'webgpu'` → `create` 拒绝且消息点名 webgpu；缺省 → 照常回退 WebGL2（对照）。这个项目天生就是该反例的家。
- demo 侧替代保障：浏览器目检（三段开关、切换重建保姿态、URL 书签、强制 webgl2 徽章变化）。

## 6. 文件清单

| 文件 | 动作 |
|---|---|
| `src/viewer/options.ts` | `BackendPreference` + `assertBackend` + 选项字段 |
| `src/viewer/backend-factory.ts` | `createBackend(canvas, preference?)` 分支 |
| `src/viewer/image-viewer.ts` | create 线程化 `valid.backend` |
| `src/viewer/video-viewer.ts` | 同上 |
| `src/index.ts` | 导出 `BackendPreference` 类型 |
| `test/unit/constructor-validation.test.ts` | 校验用例扩展 |
| `test/integration/backend-preference.test.ts` | 新增 user story |
| `test/integration/fallback/backend-preference.test.ts` | 新增反例 |
| `demo/lab/main.ts` | backend 偏好态、installViewer 线程化、URL 读写 |
| `demo/lab/panels/status.ts` | 三段开关 |
| `README.md` | 演示节一句：lab 可切后端对比 |

## 7. 验收口径

1. 兼容性：不带 `backend` 的既有代码与测试，行为逐字节不变。
2. 语义：行为矩阵（§2）全格落地——强制不可用必拒且点名。
3. 一致性：强制 `'webgl2'` 与缺省路径渲染一致（Gate C 容差内）。
4. 类型：`BackendPreference` 从 `src/index` 可导；TS 调用者拼错值编译期即红。
5. lab：三段开关、切换重建保姿态、`?backend=` 书签读写、强制 webgl2 徽章如实显示。
6. 机器验证全绿：`npm run typecheck && npm run lint && npm test`（含 90% 分支覆盖闸）。
