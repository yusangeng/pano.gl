/**
 * The WebGPU backend.
 *
 * Structure worth knowing before editing:
 *
 * - The pipeline does not depend on the camera or on which source is bound, only
 *   on the source's KIND. Two pipelines exist for that reason and both come from
 *   the same shader module, one per fragment entry point (see panorama.wgsl).
 * - A render pass is opened only after `getCurrentTexture()`, and the early-out
 *   for an unchanged frame happens before that call. Acquiring the swapchain
 *   texture and not submitting is a validation error.
 * - External textures die at the end of the microtask in which they are
 *   imported, and a bind group holding one does not keep it alive. So the import,
 *   the bind group, the encoder and the submit all happen inside one synchronous
 *   stretch of `render()` -- never split across a `setSource` and a later frame.
 */

import { mat4 } from 'gl-matrix'
import { cameraProjectionCode, textureProjectionCode } from '../../core/constants'
import { buildCameraTransform } from '../../core/matrix'
import type { CameraState, Projection } from '../../core/types'
import type { Backend, Capabilities, DeviceLost, RenderableSource } from '../backend'
import { CAMERA_UNIFORM_SIZE, packCameraUniforms } from '../uniforms'
import { MIN_TRUSTWORTHY_TEXTURE_DIMENSION } from '../capabilities'
import { acquireDevice, withValidationScope, type AcquiredDevice } from './device'
import { PANORAMA_WGSL } from './shaders'
import { createPanoramaSampler } from './shaders/sampler'
import { channels } from '../../diagnostics'

/** RGBA8, the one format both backends can render to and read from. */
const TARGET_FORMAT: GPUTextureFormat = 'rgba8unorm'

export class WebGPUBackend implements Backend {
  readonly kind = 'webgpu' as const

  #canvas: HTMLCanvasElement
  #acquired: AcquiredDevice
  /**
   * Public, not `#private`: this satisfies `Backend.capabilities`, and the
   * viewer reads it to decide whether a source needs downscaling before it ever
   * calls `setSource`. A private field would fail `implements Backend` at
   * typecheck -- which is the point of declaring the interface in the first
   * place.
   */
  readonly capabilities: Capabilities
  #cameraBuffer: GPUBuffer
  // Typed as Float32Array<ArrayBuffer>, not the bare name: the default type
  // argument is ArrayBufferLike, which would make `.buffer` an ArrayBufferLike
  // and fail both the packer's ArrayBuffer parameter and writeBuffer's view
  // type. This array is always over a plain ArrayBuffer we allocated.
  #cameraValues: Float32Array<ArrayBuffer>
  /** The clip matrix as last uploaded, for detecting an unchanged camera. */
  #clip: mat4 = mat4.create()
  #invClip: mat4 = mat4.create()
  #sampler: GPUSampler
  #cameraLayout: GPUBindGroupLayout
  #sourceLayout: GPUBindGroupLayout
  #externalSourceLayout: GPUBindGroupLayout
  #cameraBindGroup: GPUBindGroup
  #texturePipeline: GPURenderPipeline
  #externalPipeline: GPURenderPipeline
  #context: GPUCanvasContext

  /** Last camera arguments, kept so a source swap can repack the uniforms. */
  #state: CameraState | null = null
  #projection: Projection | null = null

  /** The source as last passed to `setSource`. Metadata only, never the element. */
  #source: RenderableSource | null = null
  /** The version already uploaded to `#sourceTexture`, `-1` for "none yet". */
  #uploadedVersion = -1
  #sourceTexture: GPUTexture | null = null
  /** Rebuilt whenever `#sourceTexture` is reallocated, which invalidates it. */
  #sourceBindGroup: GPUBindGroup | null = null

  /**
   * Whether the next `render()` has anything to do.
   *
   * The render loop calls `setCamera` and `setSource` every frame, so a backend
   * that drew unconditionally would present 60 identical frames a second and
   * burn the battery. This is the replacement for the legacy `dirty` flag on
   * `Camera.status()`, moved to the one place that knows about both inputs.
   *
   * Starts true so the first frame is never skipped.
   */
  #dirty = true

  #disposed = false

  private constructor (init: {
    canvas: HTMLCanvasElement
    acquired: AcquiredDevice
    capabilities: Capabilities
    cameraBuffer: GPUBuffer
    sampler: GPUSampler
    cameraLayout: GPUBindGroupLayout
    sourceLayout: GPUBindGroupLayout
    externalSourceLayout: GPUBindGroupLayout
    cameraBindGroup: GPUBindGroup
    texturePipeline: GPURenderPipeline
    externalPipeline: GPURenderPipeline
    context: GPUCanvasContext
  }) {
    this.#canvas = init.canvas
    this.#acquired = init.acquired
    this.capabilities = init.capabilities
    this.#cameraBuffer = init.cameraBuffer
    this.#cameraValues = new Float32Array(CAMERA_UNIFORM_SIZE / 4)
    this.#sampler = init.sampler
    this.#cameraLayout = init.cameraLayout
    this.#sourceLayout = init.sourceLayout
    this.#externalSourceLayout = init.externalSourceLayout
    this.#cameraBindGroup = init.cameraBindGroup
    this.#texturePipeline = init.texturePipeline
    this.#externalPipeline = init.externalPipeline
    this.#context = init.context

    // Deliberately floating: the loss is observed, not awaited. (No `void`
    // operator -- the lint config bans it; an unawaited .then is the same
    // statement.)
    this.#acquired.lost.then(lost => {
      channels.gpu('device lost: %o', lost)
      this.#deviceLostObserver?.(lost)
    })
  }

  #deviceLostObserver: ((lost: DeviceLost) => void) | undefined

  /**
   * The device this backend draws on.
   *
   * Exposed because a render target must belong to the same device as the
   * pipeline that renders into it, and a backend that keeps its device private
   * leaves no way for anyone to render offscreen. `create()` acquires a fresh
   * device per backend, so knowing this one buys no access to anything else on
   * the page. A renderer publishing its device is ordinary -- it is the same
   * relationship three.js has between `WebGPURenderer` and `renderer.backend`.
   */
  get device (): GPUDevice {
    return this.#acquired.device
  }

  /**
   * Registers the device-loss observer.
   *
   * The subscription is created inside this method rather than in the
   * constructor, so that the returned unsubscribe function can be a precise
   * one: it clears the observer only if it is still the one this call installed.
   */
  onDeviceLost (fn: (lost: DeviceLost) => void): () => void {
    this.#deviceLostObserver = fn
    return () => {
      if (this.#deviceLostObserver === fn) this.#deviceLostObserver = undefined
    }
  }

  /**
   * Creates a backend, or returns `null` when the page has no usable WebGPU.
   *
   * Every resource-creating call is scoped. WGSL compile errors in particular
   * are only visible through `getCompilationInfo()`, and a pipeline built from
   * a broken shader is invalid rather than throwing.
   */
  static async create (canvas: HTMLCanvasElement): Promise<WebGPUBackend | null> {
    const acquired = await acquireDevice()
    if (!acquired) return null
    const { adapter, device } = acquired

    const limits = adapter.limits
    const capabilities: Capabilities = {
      backend: 'webgpu',
      adapter: adapter.info as unknown as Record<string, string>,
      // The floor is applied here, not only inside `describeCapabilities`: this
      // object is built by hand and is the one callers actually read, so an
      // adapter reporting 0 would otherwise make every source look oversized.
      maxTextureDimension: Math.max(MIN_TRUSTWORTHY_TEXTURE_DIMENSION, limits.maxTextureDimension2D),
      externalTextures: true
    }

    const module = device.createShaderModule({ code: PANORAMA_WGSL, label: 'panorama' })

    // Compilation errors never throw. Ask explicitly: a pipeline built from a
    // broken module is invalid rather than an exception, and every subsequent
    // draw is a no-op with a console message nobody reads.
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter(m => m.type === 'error')
    if (errors.length > 0) {
      const detail = errors
        .map(m => `${m.lineNum}:${m.linePos} ${m.message}`)
        .join('\n')
      throw new Error(`WGSL compilation failed:\n${detail}`)
    }

    const cameraBuffer = device.createBuffer({
      size: CAMERA_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'camera'
    })

    const cameraLayout = device.createBindGroupLayout({
      label: 'camera',
      entries: [
        {
          binding: 0,
          // FRAGMENT only: the vertex stage emits clip space from the vertex
          // index and reads no buffer at all. Declaring VERTEX here would work
          // and would be a lie about what the shader does.
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' }
        }
      ]
    })

    // Two source layouts because `texture_2d<f32>` (binding 1) and
    // `texture_external` (binding 2) are different binding types. Both carry the
    // shared sampler at binding 0: the external path samples through
    // `textureSampleBaseClampToEdge`, whose signature takes the sampler even
    // though that form ignores its address modes. Each pipeline layout names
    // only the bindings its entry point uses, and a binding the entry point
    // does not reference is not validated against it.
    const sourceLayout = device.createBindGroupLayout({
      label: 'source',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }
      ]
    })
    const externalSourceLayout = device.createBindGroupLayout({
      label: 'source-external',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, externalTexture: {} }
      ]
    })

    const texturePipeline = await withValidationScope(device, 'texture pipeline', () =>
      device.createRenderPipeline({
        label: 'panorama-texture',
        layout: device.createPipelineLayout({
          bindGroupLayouts: [cameraLayout, sourceLayout]
        }),
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main',
          targets: [{ format: TARGET_FORMAT }]
        },
        primitive: { topology: 'triangle-list' },
        // No depth or stencil attachment anywhere in this backend. The legacy
        // renderer enabled depth testing and never cleared the buffer, so its
        // output depended on the previous frame's depth values (defect F4).
        // There is exactly one triangle and nothing to occlude. (The property is
        // omitted rather than set to `undefined`: exactOptionalPropertyTypes
        // rejects an explicit undefined here, and absence means the same thing.)
        multisample: { count: 1 }
      })
    )

    const externalPipeline = await withValidationScope(device, 'external pipeline', () =>
      device.createRenderPipeline({
        label: 'panorama-external',
        layout: device.createPipelineLayout({
          bindGroupLayouts: [cameraLayout, externalSourceLayout]
        }),
        vertex: { module, entryPoint: 'vs_main' },
        fragment: {
          module,
          entryPoint: 'fs_main_external',
          targets: [{ format: TARGET_FORMAT }]
        },
        primitive: { topology: 'triangle-list' },
        // See the texture pipeline above: no depth/stencil, stated by omission.
        multisample: { count: 1 }
      })
    )

    const sampler = createPanoramaSampler(device)

    const cameraBindGroup = await withValidationScope(device, 'camera bind group', () =>
      device.createBindGroup({
        label: 'camera',
        layout: cameraLayout,
        entries: [{ binding: 0, resource: { buffer: cameraBuffer } }]
      })
    )

    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('canvas.getContext("webgpu") returned null')
    context.configure({
      device,
      format: TARGET_FORMAT,
      alphaMode: 'opaque'
    })

    return new WebGPUBackend({
      canvas,
      acquired,
      capabilities,
      cameraBuffer,
      sampler,
      cameraLayout,
      sourceLayout,
      externalSourceLayout,
      cameraBindGroup,
      texturePipeline,
      externalPipeline,
      context
    })
  }

  setCamera (state: CameraState, projection: Projection): void {
    this.#state = state
    this.#projection = projection

    // WebGPU's clip space has z in [0, 1]; GL's is [-1, 1]. This is the one
    // place the two backends genuinely differ, and the matrix builder takes it
    // as a parameter precisely so neither has to know about the other.
    const clip = mat4.create()
    buildCameraTransform(state, projection, 'zero-to-one', clip)

    if (mat4.equals(clip, this.#clip)) return

    mat4.copy(this.#clip, clip)
    // The fragment stage inverts it. `invert` returns null when the matrix is
    // singular; every matrix this builder produces is invertible, so a null here
    // means the builder changed shape, and silently rendering black would hide it.
    if (!mat4.invert(this.#invClip, clip)) {
      throw new Error('camera clip matrix is singular')
    }

    this.#writeCameraUniforms()
  }

  /**
   * Packs and uploads the uniform block from the last camera and source.
   *
   * One writer rather than one per setter, because `texProjKind` comes from the
   * source and everything else from the camera: two writers would each have to
   * know about the other's fields, and the one that ran last would win.
   */
  #writeCameraUniforms (): void {
    const state = this.#state
    const projection = this.#projection
    if (!state || !projection) return

    packCameraUniforms(this.#cameraValues.buffer, {
      invClip: this.#invClip,
      projKind: cameraProjectionCode(projection.kind),
      texProjKind: textureProjectionCode(this.#source?.state.projection ?? 'equirectangular'),
      povLatitude: state.povLatitude,
      povLongitude: state.povLongitude,
      zoom: projection.kind === 'linear' ? 1 : projection.zoom
    })

    this.#acquired.device.queue.writeBuffer(this.#cameraBuffer, 0, this.#cameraValues)
    this.#dirty = true
  }

  /**
   * Accepts the frame and decides whether the GPU side needs new pixels.
   *
   * Nothing is imported or copied here. An external texture is only valid inside
   * the task that imported it, so the import has to happen in `render()`, in the
   * same synchronous stretch as the submit. Doing it here and drawing later
   * would be a use-after-free that happens to work on some drivers.
   */
  setSource (source: RenderableSource | null): void {
    const previous = this.#source
    this.#source = source

    if (source === null) {
      // Nothing to draw. Destroy rather than keep: a texture held for a source
      // that is gone is GPU memory the viewer has no other way to reclaim.
      this.#sourceTexture?.destroy()
      this.#sourceTexture = null
      this.#sourceBindGroup = null
      this.#uploadedVersion = -1
      this.#dirty = true
      return
    }

    if (source.version !== this.#uploadedVersion || previous?.element !== source.element) {
      this.#dirty = true
    }

    // The source's projection is a uniform, so a different source can mean
    // different uniforms with the camera untouched. Without this, swapping in a
    // source with a different texture projection would render with the old value
    // until the camera happened to move.
    if (previous?.state.projection !== source.state.projection) {
      this.#writeCameraUniforms()
    }
  }

  /**
   * Draws one frame.
   *
   * With no argument the frame goes to the canvas, which is what the render loop
   * does and what every production call site relies on. A caller may instead
   * name its own target, which is how a frame is rendered offscreen for
   * readback -- the integration tests need raw texture bytes, and the only way
   * to get them is `copyTextureToBuffer` on a texture this device created.
   *
   * Not on the `Backend` interface: a `GPUTextureView` is a WebGPU type and the
   * WebGL2 backend has no equivalent. An extra *optional* parameter still
   * satisfies `Backend.render`, so this is a widening, not a divergence.
   */
  render (target?: GPUTextureView): void {
    if (this.#disposed) return
    // The loop calls this every frame. Drawing an unchanged frame 60 times a
    // second would work and would drain the battery for nothing.
    if (!this.#dirty) return

    const source = this.#source
    // A source whose metadata has not loaded yet has a zero upload size. That is
    // not an error; there is simply nothing to draw, and no texture may be
    // created with a zero dimension.
    if (source === null || source.state.width === 0 || source.state.height === 0) {
      this.#dirty = false
      return
    }

    const device = this.#acquired.device
    const queue = device.queue

    // Pushed before any of the work and popped after the submit. An error scope
    // only sees what happens between push and pop, so wrapping the calls in a
    // helper that pushes and pops around them would be the same thing -- the
    // reason this is spelled out is that the scope must still be open while the
    // command encoder is alive, and that is easy to get wrong when the work is
    // split across branches.
    device.pushErrorScope('validation')

    let bindGroup: GPUBindGroup
    let pipeline: GPURenderPipeline

    if (source.kind === 'video') {
      // Import, bind, encode, submit -- one synchronous stretch. An external
      // texture is destroyed at the end of this microtask and the bind group
      // does not keep it alive.
      const external = device.importExternalTexture({
        source: source.element as HTMLVideoElement,
        label: 'source'
      })
      bindGroup = device.createBindGroup({
        label: 'source-external',
        layout: this.#externalSourceLayout,
        // The sampler rides along at binding 0; see the externalSourceLayout
        // note in `create()` for why it is required but inert.
        entries: [
          { binding: 0, resource: this.#sampler },
          { binding: 2, resource: external }
        ]
      })
      pipeline = this.#externalPipeline
      // A video presents a new frame every rAF, so the next frame is always
      // worth drawing. `version` is bumped by `markFramePresented`, which the
      // render loop calls after this returns, so at this point it still
      // describes the frame just drawn -- gating on it would draw every other
      // frame.
      this.#dirty = true
    } else {
      if (this.#sourceTexture === null || source.version !== this.#uploadedVersion) {
        if (
          this.#sourceTexture === null ||
          this.#sourceTexture.width !== source.state.width ||
          this.#sourceTexture.height !== source.state.height
        ) {
          this.#sourceTexture?.destroy()
          this.#sourceTexture = device.createTexture({
            label: 'source',
            size: { width: source.state.width, height: source.state.height },
            format: TARGET_FORMAT,
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
          })
          // The bind group holds the old texture, so a reallocation invalidates
          // it. Dropping the reference is enough; it is garbage collected.
          this.#sourceBindGroup = null
        }

        // `flipY: false` is deliberate. See `to_uv` in panorama.wgsl: the shader
        // absorbs the flip for BOTH source paths, because a flip here could not
        // apply to the video path at all and the two would end up with opposite
        // orientations. (It sits on the copy's SOURCE descriptor -- that is the
        // argument the API defines it on; the destination has no such option.)
        queue.copyExternalImageToTexture(
          { source: source.element, flipY: false },
          { texture: this.#sourceTexture },
          { width: source.state.width, height: source.state.height }
        )
        this.#uploadedVersion = source.version
      }

      this.#sourceBindGroup ??= device.createBindGroup({
        label: 'source',
        layout: this.#sourceLayout,
        entries: [
          { binding: 0, resource: this.#sampler },
          { binding: 1, resource: this.#sourceTexture!.createView() }
        ]
      })
      bindGroup = this.#sourceBindGroup
      pipeline = this.#texturePipeline
      this.#dirty = false
    }

    // Only now, and only in the canvas case. Acquiring the swapchain texture and
    // not submitting it is a validation error, so every early-out above has to
    // happen before this line.
    const view = target ?? this.#context.getCurrentTexture().createView()
    const encoder = device.createCommandEncoder({ label: 'panorama' })
    const pass = encoder.beginRenderPass({
      label: 'panorama',
      colorAttachments: [
        {
          view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store'
        }
      ]
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.#cameraBindGroup)
    pass.setBindGroup(1, bindGroup)
    // Three vertices, no buffer: `vs_main` computes the corner positions from
    // `vertex_index` alone.
    pass.draw(3)
    pass.end()
    queue.submit([encoder.finish()])

    // Popped, not awaited. Validation errors are asynchronous and never throw, so
    // a frame that is wrong is indistinguishable from one that is fine until
    // someone reads the console -- and the loop cannot await. The pop has to
    // happen regardless of the branch taken, so it is not inside the `if`.
    device.popErrorScope().then(error => {
      if (error !== null) channels.gpu('render validation error: %s', error.message)
    })
  }

  resize (cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    if (this.#canvas.width === width && this.#canvas.height === height) return
    this.#canvas.width = width
    this.#canvas.height = height
    // The swapchain is reconfigured from the canvas size on the next acquire,
    // so no explicit reconfiguration is needed here -- but the canvas drawing
    // buffer is resized by this assignment, which is what the next frame sees.
  }

  dispose (): void {
    if (this.#disposed) return
    this.#disposed = true

    // Everything here is owned by this instance and by nothing else: `create()`
    // acquires a fresh adapter and device on every call, so there is no second
    // consumer of this device to take down. That is what makes destroying it
    // correct rather than rude -- and it is the only way to release the memory,
    // since a GPUDevice has no other teardown.
    this.#sourceTexture?.destroy()
    this.#cameraBuffer.destroy()
    this.#acquired.device.destroy()

    // Deliberately not calling the device-lost observer. `device.destroy()` does
    // resolve `device.lost` with reason 'destroyed', but this disposal is not a
    // loss -- reporting it would make the viewer's `device-lost` event fire on
    // every clean teardown.
    this.#deviceLostObserver = undefined
  }
}
