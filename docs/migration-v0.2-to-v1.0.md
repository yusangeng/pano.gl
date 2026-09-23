# Migrating from pano.gl 0.2.x to 1.0.0

1.0.0 是一次重写。公开 API 更小，构造选项有改动，并且**没有兼容 shim** —— 两代接口长得太像了，shim 会把最该改掉的部分一起保留下来。本文逐项列出差异；每一项都已对照 1.0.0 的源码核实。

## 构造方式：`new` 变成 `await create()`

```js
// 0.2.x
import FramelessImageViewer from 'pano.gl/lib/FramelessImageViewer'
const viewer = new FramelessImageViewer({ el: '#wrap', src: '/pano.jpg' })

// 1.0.0
import { FramelessImageViewer } from 'pano.gl'
const viewer = await FramelessImageViewer.create({
  container: document.querySelector('#wrap'),
  src: '/pano.jpg'
})
```

构造是异步的，因为获取 GPU 设备就是异步的。**没有可用渲染后端时 `create()` 会 throw**：0.2.x 的着色器编译失败只打一条 log 然后返回 null，viewer 报告创建成功、永远黑屏；1.0.0 认为一个画不出东西的 viewer 不算 viewer。

包的入口也变了：0.2.x 从 `pano.gl/lib/FramelessImageViewer` 这类深路径导入，1.0.0 只有 `pano.gl` 一个入口，导出 `FramelessImageViewer`、`FramelessVideoViewer` 和它们的选项类型。

## 构造选项

| 0.2.x | 1.0.0 | 说明 |
|---|---|---|
| `el` | `container` | 同一个元素，换成生态圈通用的名字。0.2.x 接受选择器字符串，1.0.0 只接受 `HTMLElement`。 |
| `src` | `src` | 图片不变。**视频变了**：0.2.x 传已有 `<video>` 元素或选择器，1.0.0 传 URL 字符串，viewer 自己创建元素。 |
| `projection: 'equiprectangular'` | `projection: 'equirectangular'` | 旧值是拼写错误，正确拼写现在是唯一接受的值。传旧值会抛 `TypeError` 并直接告诉你怎么改。 |
| `projection: 'fisheye'` | —— | 构造时抛出 "not implemented"。它从来没工作过：0.2.x 的 JS 侧把 fisheye 分支注释掉后直接 throw，着色器侧的 fisheye 分支返回 `vec2(0.0, 0.0)`。 |
| `frameSize` | —— | 已删除。它是 WebGL1 power-of-two 纹理限制的产物 —— 0.2.x 用它把超大图导流经过一张中转 canvas。WebGPU 和 WebGL2 都没有这个限制；超限的源现在按设备的 `maxTextureDimension` 自动降采样。 |
| `camera: { type, data }` | `camera: { projection, pose? }` | 见下。 |
| （仅视频）`video` | —— | 并入 `src`（传 URL）。0.2.x 的 `.video` getter 改名为 `.element`。 |
| （新增） | `autoplay` / `loop` / `muted` | 视频选项直达元素。`muted` 默认 `true`：现代浏览器一律拦截有声自动播放，0.2.x 的默认值产出一个永远不开始播放的视频。 |
| `PTZ` | `PTZ` | 保留，含义不变。 |

被删掉的选项（`el`、`frameSize`）不会被静默忽略 —— 传入会抛 `TypeError`。升级时这就是帮你定位没改干净的那一行的报错。

## 相机

0.2.x 用 `{ type, data }` 从工厂里选相机；1.0.0 的相机是一个判别联合（discriminated union），`kind` 是判别字段，每种 kind 带自己的参数：

| 0.2.x `type` | 1.0.0 `projection.kind` |
|---|---|
| `'perspective'` | `'linear'` |
| `'cylindrical'` | `'cylindrical'` |
| `'planet'` | `'planet'` |
| `'pannini'` | `'pannini'` |

`'ortho'` 从来不是公开选项（工厂里被注释掉了），1.0.0 里彻底不存在。

各 kind 的参数（都在 `projection` 对象上，不再放进 `data`）：

- `{ kind: 'linear', fov, aspect }` —— `fov` 是**弧度**。0.2.x 的 `fov` 是度（跟着 cuon 矩阵库走）；默认值都是 70°，但单位换了。`aspect` 由 viewer 按容器实际尺寸自动维护，通常不用传。
- `{ kind: 'cylindrical' | 'planet' | 'pannini', zoom, extent }` —— `zoom` 在 `[0.01, 1]`（linear 的 `fov` 夹在 `[15°, 110°]`）；`extent` 是投影自带的曲面尺寸（cylindrical 1×1，planet/pannini 4×4），0.2.x 把它藏在四边形网格的顶点坐标里。

初始朝向放进 `camera.pose`：`{ povLatitude, povLongitude }`，单位是度。运行时切换投影用 `cameraOptions` setter —— **它现在只换投影、保留当前朝向**。0.2.x 的 setter 重建整个相机并重置回原点，换投影会悄悄丢掉用户正在看的地方。

`rotate(lat, lng)`、`zoom(delta)`（正值放大）、`PTZ` 都还在，名字和含义不变。

## 行为变更

除下面两条外，1.0.0 渲染和 0.2.2 相同的像素 —— 这是本次迁移三条像素门禁（gate A/B/C）的验收标准。仅有的两处有意变更都发生在非线性相机（cylindrical / planet / pannini）上：

1. **纬度生效了。** 0.2.x 上传了 `u_CamPOVLatitude` uniform，但着色器的三个非线性公式从不读它 —— 设了纬度没反应。1.0.0 里纬度参与计算。如果你的应用在用旋转图片本身来补偿旧行为，把那个补偿删掉。
2. **平移灵敏度修正了。** 0.2.x 的着色器从弧度角里直接减 `povLongitude / 4` —— 拿度数减弧度，比正确换算过敏约 14.3 倍（45/π）：拖一个视口宽，画面转约 14.3 圈。1.0.0 正确做度→弧度换算，拖一个视口宽转一圈。（2026-09-23 用户裁决，见 `docs/superpowers/specs/2026-09-23-pan-zoom-semantics.md` §1。）

## 事件

`on()` 现在返回**自己的取消函数** —— 不再需要为了 `off()` 而保存函数引用：

```js
const off = viewer.on('media-error', (event) => { /* ... */ })
// ...之后
off()
```

`on('*', handler)` 仍然可用，回调解构为 `(type, event)`，是旧版 `trigger('*')` 的带类型形式。事件清单：

| 事件 | 载荷 | 时机 |
|---|---|---|
| `media-load` | `{ target }` | 源的元数据就绪 |
| `media-error` | `{ target, error }` | 源加载/解码失败 |
| `media-play` / `media-pause` / `media-ended` | `{ target }` | 播放状态变化 |
| `media-seeking` / `media-seeked` | `{ target }` | 进度跳转（仅视频） |
| `media-progress` | `{ target }` | 播放推进（仅视频） |
| `rotate` | `{ lat, lng }` | 用户拖拽后 |
| `zoom` | `{ delta }` | 滚轮/双指缩放后 |
| `device-lost` | `{ reason, message }` | GPU 设备/上下文丢失 |

`target` 是 viewer 自己 —— 0.2.x 的事件直接透传 DOM 事件对象，1.0.0 的载荷是稳定的库类型。

## 渲染后端

1.0.0 优先 WebGPU，拿不到设备就降到 WebGL2。`viewer.capabilities.backend` 告诉你实际用了哪个（`'webgpu'` 或 `'webgl2'`）；`FramelessImageViewer.probe()` / `FramelessVideoViewer.probe()` 让你**先问再决定** —— 两个都没有时它返回 `{ backend: 'none' }`，这是一个答案，不是一个异常。

两个后端渲染同样的像素：门禁 C 对全部四个相机 × 多个姿态断言两后端的最差逐通道差 ≤ 2（0–255 尺度），CPU float64 参考实现作仲裁（≤ 3；极点附近放宽到 < 64）。你的应用不需要、也无法选择后端 —— 但可以读 `capabilities` 把「正在用较慢的渲染器」告诉用户。

## 清理

`dispose()` 依然必须调用，而且现在真的会释放资源（幂等，重复调用安全）：

- **WebGL2** 走 `WEBGL_lose_context` 主动释放上下文。0.2.x 从不释放 —— 浏览器的活跃上下文上限通常是 16 个，建满之后新的 viewer **静默失败**。
- **DOM 监听**通过一个 `AbortController` 一次性拆掉；`ResizeObserver` 断开；canvas 从容器里移除。0.2.x 的 `removeEventLstener` 拼错了（少了一个 e），resize 监听从来没有被移除过。

设备丢失（笔记本休眠、驱动重置）现在有 `device-lost` 事件，viewer 收到后自行清理 —— 0.2.x 对上下文丢失没有任何处理，画布只是永远停在最后一帧。
