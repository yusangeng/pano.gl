import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mat4 } from 'gl-matrix'
import { WebGPUBackend } from '../../src/renderer/webgpu/backend'
import { buildCameraTransform } from '../../src/core/matrix'
import type { RenderableSource } from '../../src/renderer/backend'
import { channels } from '../../src/diagnostics'

/*
 * The backend, exercised against a fake GPUDevice rather than a real one. Unit
 * tests must not reach a GPU context, and most of this class's logic is decision
 * logic -- dirty tracking, upload gating, lifecycle -- that a fake observes
 * precisely because it records every call. The pixels themselves are the
 * integration suite's job (backend-smoke, and the gates after it).
 *
 * The one branch a fake cannot reach is the singular-matrix throw: the real
 * builder never produces a singular matrix. The matrix module is mocked with a
 * pass-through so a single call can be forced to hand back a zeroed matrix.
 */
vi.mock('../../src/core/matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/matrix')>()
  return {
    ...actual,
    buildCameraTransform: vi.fn(actual.buildCameraTransform)
  }
})

/** Everything the tests need to observe about one fake GPU. */
interface Harness {
  backend: WebGPUBackend
  device: object
  /** The vi.fn()s behind the fake device, for call-count and call-arg checks. */
  mocks: {
    createBuffer: ReturnType<typeof vi.fn>
    createTexture: ReturnType<typeof vi.fn>
    createBindGroup: ReturnType<typeof vi.fn>
    importExternalTexture: ReturnType<typeof vi.fn>
    writeBuffer: ReturnType<typeof vi.fn>
    copyExternalImageToTexture: ReturnType<typeof vi.fn>
    submit: ReturnType<typeof vi.fn>
    pushErrorScope: ReturnType<typeof vi.fn>
    popErrorScope: ReturnType<typeof vi.fn>
    destroyDevice: ReturnType<typeof vi.fn>
    getCurrentTexture: ReturnType<typeof vi.fn>
    configure: ReturnType<typeof vi.fn>
  }
  /** The single render pass object the fake encoder hands out. */
  pass: {
    setPipeline: ReturnType<typeof vi.fn>
    setBindGroup: ReturnType<typeof vi.fn>
    draw: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
  }
  /** Every fake texture created, in order, with their own destroy spies. */
  textures: Array<{ width: number, height: number, destroy: ReturnType<typeof vi.fn> }>
  canvas: { width: number, height: number }
  /** Resolves `device.lost` on the fake device. */
  resolveLost: (info: { reason: string, message: string }) => void
}

/** A still source with the given metadata. `element` defaults to a fresh object. */
function imageSource (width: number, height: number, version: number, element?: object): RenderableSource {
  return {
    state: { projection: 'equirectangular', width, height },
    kind: 'image',
    element: (element ?? {}) as HTMLImageElement,
    version
  }
}

function videoSource (width: number, height: number, version: number): RenderableSource {
  return {
    state: { projection: 'equirectangular', width, height },
    kind: 'video',
    element: {} as HTMLVideoElement,
    version
  }
}

const LINEAR = { kind: 'linear', fov: Math.PI / 2, aspect: 2 } as const
const CYLINDRICAL = { kind: 'cylindrical', zoom: 2, extent: [1, 1] } as const
const CAMERA = { povLatitude: 10, povLongitude: 20 }

// Baseline call counts after `create()`: it opens three validation scopes
// (texture pipeline, external pipeline, camera bind group), so every assertion
// on pushErrorScope counts from 3, not 0.
const CREATE_SCOPES = 3

/** The fake GPU stack and canvas, before any backend is built on top of them. */
type Fakes = Omit<Harness, 'backend'>

/** Knobs the fake stack honours; see `makeFakes`. */
interface FakesOptions {
  maxTextureDimension2D?: number
  compilationMessages?: object[]
  contextIsNull?: boolean
  /** Results the n-th popErrorScope returns, before the default `null`. */
  popScopeResults?: Array<object | null>
}

/**
 * Builds the fake GPU stack alone. The throwing-create tests need it without a
 * backend: the mocks are the only surviving handle on what the failure path
 * did after the rejection has propagated.
 *
 * `navigator.gpu` is stubbed so `acquireDevice()` finds the fake adapter; the
 * stub is removed in `afterEach` so nothing leaks between tests.
 */
function makeFakes (options: FakesOptions = {}): Fakes {
  const textures: Harness['textures'] = []

  // Real GPUBindGroup objects are never deep-equal to each other, so the fake
  // must not be either: returning deep-identical objects for every call is an
  // unfaithful double, and it blinded every bind-group argument assertion --
  // a fully swapped index pair could deep-match its way past them.
  let bindGroupSequence = 0

  // Declared before the fakes that reference it: the fake destroy() resolves
  // `lost` exactly as the real one does, and needs the resolver in scope.
  let resolveLost!: Harness['resolveLost']
  const lost = new Promise<{ reason: string, message: string }>(resolve => {
    resolveLost = resolve
  })

  const mocks = {
    createBuffer: vi.fn(() => ({ label: 'camera', destroy: vi.fn() })),
    createTexture: vi.fn(({ size }: { size: { width: number, height: number } }) => {
      const texture = {
        width: size.width,
        height: size.height,
        createView: vi.fn(() => ({ label: 'view' })),
        destroy: vi.fn()
      }
      textures.push(texture)
      return texture
    }),
    createBindGroup: vi.fn(() => ({ label: 'bind-group', n: bindGroupSequence++ })),
    importExternalTexture: vi.fn(() => ({ label: 'external' })),
    writeBuffer: vi.fn(),
    copyExternalImageToTexture: vi.fn(),
    submit: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn().mockResolvedValue(null),
    // The real GPUDevice.destroy() resolves `device.lost` with reason
    // 'destroyed'; wiring that is what lets the disposal tests observe what
    // the loss chain does on a deliberate teardown.
    destroyDevice: vi.fn(() => resolveLost({ reason: 'destroyed', message: '' })),
    getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({ label: 'swapchain' })) })),
    configure: vi.fn()
  }
  for (const result of options.popScopeResults ?? []) {
    mocks.popErrorScope.mockResolvedValueOnce(result)
  }

  const pass: Harness['pass'] = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn()
  }

  const queue = {
    writeBuffer: mocks.writeBuffer,
    copyExternalImageToTexture: mocks.copyExternalImageToTexture,
    submit: mocks.submit
  }

  const device = {
    lost,
    queue,
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: async () => ({ messages: options.compilationMessages ?? [] })
    })),
    createBuffer: mocks.createBuffer,
    createBindGroupLayout: vi.fn(() => ({ label: 'layout' })),
    createPipelineLayout: vi.fn(() => ({ label: 'pipeline-layout' })),
    createRenderPipeline: vi.fn(({ label }: { label: string }) => ({ label })),
    createSampler: vi.fn(() => ({ label: 'panorama' })),
    createBindGroup: mocks.createBindGroup,
    createTexture: mocks.createTexture,
    importExternalTexture: mocks.importExternalTexture,
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => pass),
      finish: vi.fn(() => ({ label: 'commands' }))
    })),
    pushErrorScope: mocks.pushErrorScope,
    popErrorScope: mocks.popErrorScope,
    destroy: mocks.destroyDevice
  }

  const adapter = {
    info: { vendor: 'stub-vendor', architecture: 'stub-arch' },
    limits: { maxTextureDimension2D: options.maxTextureDimension2D ?? 4096 },
    requestDevice: async () => device
  }

  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => adapter } })

  const context = options.contextIsNull
    ? null
    : { configure: mocks.configure, getCurrentTexture: mocks.getCurrentTexture }
  const canvas = {
    width: 8,
    height: 8,
    getContext: vi.fn(() => context)
  }

  return { device, mocks, pass, textures, canvas, resolveLost }
}

/** Builds a full fake GPU stack and a backend on top of it. */
async function makeBackend (options: FakesOptions = {}): Promise<Harness> {
  const fakes = makeFakes(options)
  const backend = await WebGPUBackend.create(fakes.canvas as unknown as HTMLCanvasElement)
  if (!backend) throw new Error('the stubbed navigator should always yield a backend')
  return { backend, ...fakes }
}

beforeEach(() => {
  // The WebGPU enum namespaces are browser globals; in node they exist only as
  // types, while the backend reads their members at runtime. The values are the
  // spec's own, though nothing here inspects them -- the fakes ignore usage.
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8 })
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, COPY_SRC: 4, RENDER_ATTACHMENT: 16, COPY_DST: 8 })
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Lets every pending microtask run. The device-loss path is two hops deep --
 * `acquireDevice()` derives its own promise from `device.lost`, and the backend
 * chains its observer on that -- so a single `await Promise.resolve()` observes
 * the link, not the delivery.
 */
function flushMicrotasks (): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, 0) })
}

/** Decodes the packed camera uniforms from the n-th writeBuffer call. */
function uniformUpload (harness: Harness, call: number): DataView {
  const args = harness.mocks.writeBuffer.mock.calls[call]!
  // writeBuffer(buffer, offset, data) -- data is the Float32Array over the block.
  return new DataView((args[2] as Float32Array<ArrayBuffer>).buffer)
}

describe('WebGPUBackend.create', () => {
  it('returns null when the page has no WebGPU', async () => {
    // The fallback contract: null means "use WebGL2", never an error.
    vi.stubGlobal('navigator', {})
    expect(await WebGPUBackend.create({} as HTMLCanvasElement)).toBeNull()
  })

  it('creates both pipelines, one sampler, one uniform bind group, and configures the canvas', async () => {
    const h = await makeBackend()
    const device = h.backend.device as unknown as Record<string, ReturnType<typeof vi.fn>>

    expect(device.createRenderPipeline).toHaveBeenCalledTimes(2)
    // One module serves both pipelines; the entry point is what differs.
    expect(device.createShaderModule).toHaveBeenCalledTimes(1)
    expect(device.createSampler).toHaveBeenCalledTimes(1)
    expect(h.mocks.createBindGroup).toHaveBeenCalledTimes(1)
    expect(h.mocks.createBuffer).toHaveBeenCalledTimes(1)
    expect(h.mocks.configure).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'rgba8unorm', alphaMode: 'opaque' })
    )
    // Three scoped creations: texture pipeline, external pipeline, camera bind
    // group. Leak or steal a scope and the counts below drift.
    expect(h.mocks.pushErrorScope).toHaveBeenCalledTimes(CREATE_SCOPES)
    expect(h.mocks.popErrorScope).toHaveBeenCalledTimes(CREATE_SCOPES)
  })

  it('exposes the acquired device and reports its capabilities', async () => {
    const h = await makeBackend()
    expect(h.backend.device).toBe(h.device)
    expect(h.backend.kind).toBe('webgpu')
    expect(h.backend.capabilities).toEqual({
      backend: 'webgpu',
      adapter: { vendor: 'stub-vendor', architecture: 'stub-arch' },
      maxTextureDimension: 4096,
      externalTextures: true
    })
  })

  it('floors maxTextureDimension at the trustworthy minimum', async () => {
    // A software adapter reporting 0 would otherwise make every source look
    // oversized to the viewer's downscale decision.
    const h = await makeBackend({ maxTextureDimension2D: 0 })
    expect(h.backend.capabilities.maxTextureDimension).toBe(2048)
  })

  it('throws WGSL compilation errors with line and position', async () => {
    // Compilation errors never throw on their own; the backend must ask. A
    // pipeline built from a broken module draws nothing, silently.
    await expect(makeBackend({
      compilationMessages: [{ type: 'error', lineNum: 287, linePos: 10, message: 'no matching call' }]
    })).rejects.toThrow(/WGSL compilation failed:\s*287:10 no matching call/)
  })

  it('throws when the canvas has no webgpu context', async () => {
    await expect(makeBackend({ contextIsNull: true }))
      .rejects.toThrow('canvas.getContext("webgpu") returned null')
  })

  it('throws when a scoped creation reports a validation error, naming the operation', async () => {
    // The second scope belongs to the external pipeline. The operation name is
    // the only thing that tells a CI log which creation step failed.
    await expect(makeBackend({
      popScopeResults: [null, { message: 'bad layout' }]
    })).rejects.toThrow(/external pipeline.*bad layout/)
  })

  it('destroys the acquired device when setup throws', async () => {
    // Built from the fakes directly: the harness never materialises when
    // create() rejects, and the mocks are the only surviving record of what
    // the failure path did.
    const fakes = makeFakes({
      compilationMessages: [{ type: 'error', lineNum: 1, linePos: 1, message: 'boom' }]
    })
    await expect(WebGPUBackend.create(fakes.canvas as unknown as HTMLCanvasElement))
      .rejects.toThrow(/WGSL compilation failed/)
    // The device was acquired, so the throw path owns it and must release it:
    // nothing else holds it, and browsers cap live devices per page.
    expect(fakes.mocks.destroyDevice).toHaveBeenCalledTimes(1)
  })
})

describe('device loss', () => {
  it('delivers the loss to the registered observer', async () => {
    const h = await makeBackend()
    const seen: object[] = []
    h.backend.onDeviceLost(lost => { seen.push(lost) })

    h.resolveLost({ reason: 'unknown', message: 'gpu process died' })
    await flushMicrotasks()

    expect(seen).toEqual([{ reason: 'unknown', message: 'gpu process died' }])
  })

  it('unsubscribes precisely: a stale unsubscribe does not remove a newer observer', async () => {
    const h = await makeBackend()
    const first: string[] = []
    const second: string[] = []
    h.backend.onDeviceLost(() => { first.push('first') })
    const unsubFirst = h.backend.onDeviceLost(() => { first.push('first') })
    h.backend.onDeviceLost(() => { second.push('second') })

    // The first registration was already replaced; removing it must leave the
    // current one in place.
    unsubFirst()
    h.resolveLost({ reason: 'unknown', message: 'x' })
    await flushMicrotasks()

    expect(first).toEqual([])
    expect(second).toEqual(['second'])
  })

  it('unsubscribes the observer that is still current', async () => {
    const h = await makeBackend()
    const seen: string[] = []
    const unsubscribe = h.backend.onDeviceLost(() => { seen.push('called') })

    unsubscribe()
    h.resolveLost({ reason: 'unknown', message: 'x' })
    await flushMicrotasks()

    expect(seen).toEqual([])
  })

  it('survives a loss with no observer registered', async () => {
    const h = await makeBackend()
    h.resolveLost({ reason: 'unknown', message: 'nobody listening' })
    await flushMicrotasks()
    // Reaching here without a throw is the assertion: the loss path must not
    // depend on an observer being present.
  })

  it('does not report a clean disposal as a device loss', async () => {
    const h = await makeBackend()
    const seen: object[] = []
    h.backend.onDeviceLost(lost => { seen.push(lost) })

    h.backend.dispose()
    await flushMicrotasks()

    // The fake's destroy() resolves device.lost (reason 'destroyed'), so this
    // observes the real chain: the observer is unhooked before the loss
    // microtask can run, because a deliberate teardown is not a loss and must
    // not fire the viewer's device-lost event.
    expect(seen).toEqual([])
  })
})

describe('setCamera', () => {
  it('packs and uploads the uniforms, with zoom 1 on the linear kind', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)

    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(1)
    const view = uniformUpload(h, 0)
    expect(view.getUint32(64, true)).toBe(1) // projKind: linear
    expect(view.getUint32(68, true)).toBe(1) // texProjKind: equirectangular
    expect(view.getFloat32(72, true)).toBe(10) // povLatitude
    expect(view.getFloat32(76, true)).toBe(20) // povLongitude
    expect(view.getFloat32(80, true)).toBe(1) // zoom: forced to 1 for linear
  })

  it('uploads the projection zoom for the non-linear kinds', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, CYLINDRICAL)

    const view = uniformUpload(h, 0)
    expect(view.getUint32(64, true)).toBe(2) // projKind: cylindrical
    expect(view.getFloat32(80, true)).toBe(2) // zoom: the projection's own
  })

  it('uploads the camera uniforms on every call, even when the matrix cannot see the change', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, CYLINDRICAL)
    h.backend.setCamera({ ...CAMERA }, { ...CYLINDRICAL })
    /*
     * Identical arguments, and the upload must happen anyway. On the
     * non-linear kinds the clip matrix is constant BY DESIGN (matrix.ts
     * builds their views from LEGACY_QUAD_VIEW), so a matrix-equality
     * early-out cannot tell "nothing changed" from "the camera moved in
     * the uniforms" -- the version this test replaced skipped both the
     * upload and the dirty flag on every camera change, freezing pan and
     * zoom on three of the four kinds. There is no skip left to get
     * wrong; the render loop already limits setCamera to frames that are
     * being drawn, so the unconditional write costs one small upload per
     * drawn frame.
     */
    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(2)
    // The second upload carries the camera too -- two writes that both
    // dropped the pose would satisfy the count above and freeze anyway.
    const view = uniformUpload(h, 1)
    expect(view.getFloat32(72, true)).toBe(CAMERA.povLatitude)
    expect(view.getFloat32(76, true)).toBe(CAMERA.povLongitude)
  })

  it('uploads again when the camera changes', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setCamera({ povLatitude: -10, povLongitude: 340 }, LINEAR)
    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(2)
  })

  it('throws when the clip matrix is singular', async () => {
    const h = await makeBackend()
    // Every matrix the real builder produces is invertible, so the only way
    // here is a builder that changed shape -- which is exactly what the throw
    // exists to announce instead of silently rendering black.
    vi.mocked(buildCameraTransform).mockImplementationOnce((_state, _projection, _depth, out) => {
      // gl-matrix's mat4 type carries no .fill; 16 explicit zeros say the same.
      mat4.set(out, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      return out
    })
    expect(() => h.backend.setCamera(CAMERA, LINEAR)).toThrow('camera clip matrix is singular')
  })

  it('repacks the uniforms when a source swap changes the texture projection', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(1)

    // The first setSource after a camera sets texProjKind; a later one with the
    // same projection does not rewrite.
    h.backend.setSource(imageSource(4, 4, 1))
    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(2)
    h.backend.setSource(imageSource(4, 4, 1))
    expect(h.mocks.writeBuffer).toHaveBeenCalledTimes(2)
  })

  it('drops the uniform write when no camera has been set yet', async () => {
    const h = await makeBackend()
    // A source can arrive before the first camera; the writer must not deref
    // a camera that does not exist.
    h.backend.setSource(imageSource(4, 4, 1))
    expect(h.mocks.writeBuffer).not.toHaveBeenCalled()
  })
})

describe('setSource and render', () => {
  it('draws nothing before a source arrives, and only tries once', async () => {
    const h = await makeBackend()
    h.backend.render()
    h.backend.render()
    expect(h.mocks.pushErrorScope).toHaveBeenCalledTimes(CREATE_SCOPES)
    expect(h.mocks.submit).not.toHaveBeenCalled()
    // The swapchain is never acquired on an early-out path: acquiring it and
    // not submitting would itself be a validation error.
    expect(h.mocks.getCurrentTexture).not.toHaveBeenCalled()
  })

  it('uploads a still source once and draws through the texture pipeline', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    const element = {}
    h.backend.setSource(imageSource(4, 4, 1, element))

    const target = { label: 'offscreen' } as GPUTextureView
    h.backend.render(target)

    expect(h.mocks.copyExternalImageToTexture).toHaveBeenCalledTimes(1)
    // The copy reads the element with no flip: the shader owns the flip so both
    // source paths share one orientation.
    const copy = h.mocks.copyExternalImageToTexture.mock.calls[0]!
    expect(copy[0]).toEqual({ source: element, flipY: false })
    expect(copy[1]).toEqual({ texture: h.textures[0] })

    expect(h.pass.setPipeline).toHaveBeenCalledTimes(1)
    expect(h.pass.draw).toHaveBeenCalledWith(3)
    expect(h.pass.setBindGroup).toHaveBeenCalledTimes(2)
    // Group 0 is the camera's (the one create() built), group 1 the source's:
    // swapped indices would bind garbage with no validation error to say so.
    const cameraBindGroup = h.mocks.createBindGroup.mock.results[0]!.value
    const sourceBindGroup = h.mocks.createBindGroup.mock.results[1]!.value
    expect(h.pass.setBindGroup).toHaveBeenCalledWith(0, cameraBindGroup)
    expect(h.pass.setBindGroup).toHaveBeenCalledWith(1, sourceBindGroup)
    expect(h.mocks.submit).toHaveBeenCalledTimes(1)
    // An explicit target means the swapchain is never acquired -- acquiring it
    // and not submitting would be a validation error.
    expect(h.mocks.getCurrentTexture).not.toHaveBeenCalled()
  })

  it('does not redraw an unchanged frame', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()
    h.backend.render()
    expect(h.mocks.submit).toHaveBeenCalledTimes(1)
    expect(h.mocks.pushErrorScope).toHaveBeenCalledTimes(CREATE_SCOPES + 1)
  })

  it('redraws on a camera change without re-uploading the pixels', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()

    h.backend.setCamera({ povLatitude: 20, povLongitude: 40 }, LINEAR)
    h.backend.render()

    expect(h.mocks.submit).toHaveBeenCalledTimes(2)
    expect(h.mocks.copyExternalImageToTexture).toHaveBeenCalledTimes(1)
    // The bind group survives too: same texture, same group.
    expect(h.mocks.createBindGroup).toHaveBeenCalledTimes(2)
  })

  it('redraws, but does not re-copy, when the element changes at the same version', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    const a = {}
    const b = {}
    h.backend.setSource(imageSource(4, 4, 1, a))
    h.backend.render()

    h.backend.setSource(imageSource(4, 4, 1, b))
    h.backend.render()

    expect(h.mocks.submit).toHaveBeenCalledTimes(2)
    expect(h.mocks.copyExternalImageToTexture).toHaveBeenCalledTimes(1)
  })

  it('re-uploads on a version bump, reusing the texture and bind group at the same size', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()

    h.backend.setSource(imageSource(4, 4, 2))
    h.backend.render()

    expect(h.mocks.copyExternalImageToTexture).toHaveBeenCalledTimes(2)
    expect(h.mocks.createTexture).toHaveBeenCalledTimes(1)
    expect(h.mocks.createBindGroup).toHaveBeenCalledTimes(2)
  })

  it('reallocates the texture and the bind group when the source size changes', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()

    // A size change arrives with a version bump -- the contract says `version`
    // moves whenever the pixels change -- so each render re-enters the upload
    // branch and finds the old texture too small.
    h.backend.setSource(imageSource(8, 4, 2))
    h.backend.render()
    h.backend.setSource(imageSource(8, 16, 3))
    h.backend.render()

    expect(h.mocks.createTexture).toHaveBeenCalledTimes(3)
    expect(h.mocks.createBindGroup).toHaveBeenCalledTimes(4)
    // Every reallocation destroys the texture it replaced.
    expect(h.textures[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(h.textures[1]!.destroy).toHaveBeenCalledTimes(1)
    expect(h.textures[2]!.destroy).not.toHaveBeenCalled()
  })

  it('draws through the external pipeline for video, every frame', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(videoSource(4, 4, 1))

    h.backend.render()
    h.backend.render()

    // A video presents a new frame every rAF: the second render must draw too,
    // importing and binding again inside its own synchronous stretch.
    expect(h.mocks.importExternalTexture).toHaveBeenCalledTimes(2)
    expect(h.mocks.createBindGroup).toHaveBeenCalledTimes(3) // camera + two imports
    expect(h.mocks.submit).toHaveBeenCalledTimes(2)
    // No texture is allocated for a video -- that is the point of the path.
    expect(h.mocks.createTexture).not.toHaveBeenCalled()
    // The external bind group carries the shared sampler alongside the import.
    const entries = h.mocks.createBindGroup.mock.calls[1]![0].entries
    expect(entries).toEqual([
      { binding: 0, resource: expect.anything() },
      { binding: 2, resource: expect.anything() }
    ])
  })

  it('skips frames whose source metadata has not loaded, either dimension', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(0, 4, 1))
    h.backend.render()
    h.backend.setSource(imageSource(4, 0, 1))
    h.backend.render()

    // Zero dimensions are "nothing to draw", not an error: a texture may not
    // be created with a zero extent.
    expect(h.mocks.pushErrorScope).toHaveBeenCalledTimes(CREATE_SCOPES)
    expect(h.mocks.createTexture).not.toHaveBeenCalled()
    // And no swapchain texture either -- same rule as the no-source case.
    expect(h.mocks.getCurrentTexture).not.toHaveBeenCalled()
  })

  it('destroys the texture when the source is cleared, and re-uploads when one returns', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()

    h.backend.setSource(null)
    expect(h.textures[0]!.destroy).toHaveBeenCalledTimes(1)
    h.backend.render()
    expect(h.mocks.submit).toHaveBeenCalledTimes(1)

    // The upload gate was reset, so a returning source uploads again even at
    // the same version.
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()
    expect(h.mocks.createTexture).toHaveBeenCalledTimes(2)
    expect(h.mocks.copyExternalImageToTexture).toHaveBeenCalledTimes(2)
  })

  it('renders to the canvas swapchain when no target is given', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()
    expect(h.mocks.getCurrentTexture).toHaveBeenCalledTimes(1)
  })

  it('rethrows a synchronous failure inside the frame and still drains the scope', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(videoSource(4, 4, 1))
    // The spec-realistic throw between push and submit: the external-texture
    // import raises SecurityError for non-origin-clean cross-origin media.
    h.mocks.importExternalTexture.mockImplementationOnce(() => {
      throw new Error('SecurityError: non-origin-clean media')
    })

    expect(() => h.backend.render()).toThrow('SecurityError')

    // create() drained its three scopes; a fourth pop here means the failed
    // frame's scope went too, rather than leaking onto whatever the device
    // does next.
    expect(h.mocks.popErrorScope).toHaveBeenCalledTimes(CREATE_SCOPES + 1)
    // Nothing was submitted for the failed frame.
    expect(h.mocks.submit).not.toHaveBeenCalled()
  })

  it('leaves no unhandled rejection when the pop itself fails on a lost device', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    // The render's own pop rejects (a lost device rejects popErrorScope);
    // swallowing it inside the drain is the contract.
    h.mocks.popErrorScope.mockRejectedValueOnce(new Error('device was lost'))
    h.backend.render()
    await flushMicrotasks()
    // Reaching here without an unhandled rejection -- which fails the run --
    // is the assertion.
  })
})

describe('resize', () => {
  it('rounds, applies the dpr, floors at 1, and skips no-op resizes', async () => {
    const h = await makeBackend()

    h.backend.resize(400, 300, 2)
    expect(h.canvas.width).toBe(800)
    expect(h.canvas.height).toBe(600)

    h.backend.resize(400, 300, 2)
    expect(h.canvas.width).toBe(800)
    expect(h.canvas.height).toBe(600)

    // 0.4 * 2 = 0.8 rounds to 1 with no floor needed. 0.2 * 2 = 0.4 rounds
    // to 0, and the floor is the only thing keeping a zero-sized drawing
    // buffer off the canvas.
    h.backend.resize(0.4, 0.4, 2)
    expect(h.canvas.width).toBe(1)
    expect(h.canvas.height).toBe(1)

    h.backend.resize(0.2, 0.2, 2)
    expect(h.canvas.width).toBe(1)
    expect(h.canvas.height).toBe(1)
  })

  it('repaints after a resize even when camera and source are unchanged', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()
    // Unchanged inputs: the second render early-outs and nothing new draws.
    h.backend.render()
    expect(h.mocks.submit).toHaveBeenCalledTimes(1)

    // Resizing clears the drawing buffer. If the resize did not mark the
    // frame dirty, this render would early-out too and the canvas would stay
    // blank until the camera moved.
    h.backend.resize(9, 9, 1)
    h.backend.render()

    expect(h.pass.draw).toHaveBeenCalledTimes(2)
    expect(h.mocks.submit).toHaveBeenCalledTimes(2)
  })
})

describe('dispose', () => {
  it('destroys the source texture, the uniform buffer and the device, once', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()

    const cameraBuffer = h.mocks.createBuffer.mock.results[0]!.value as { destroy: ReturnType<typeof vi.fn> }
    h.backend.dispose()
    // Idempotent: teardown paths can race.
    h.backend.dispose()

    expect(h.textures[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(cameraBuffer.destroy).toHaveBeenCalledTimes(1)
    expect(h.mocks.destroyDevice).toHaveBeenCalledTimes(1)
  })

  it('stops rendering after disposal', async () => {
    const h = await makeBackend()
    h.backend.setCamera(CAMERA, LINEAR)
    h.backend.setSource(imageSource(4, 4, 1))
    h.backend.render()
    h.backend.dispose()
    h.backend.render()

    expect(h.mocks.submit).toHaveBeenCalledTimes(1)
  })
})

describe('render validation errors', () => {
  it('logs an asynchronous validation error instead of throwing', async () => {
    // Spying on the channel rather than on debug internals: whether the log
    // reaches a console depends on debug's engine, while the call through
    // `channels` is the library's own surface.
    const gpu = vi.spyOn(channels, 'gpu')
    try {
      const h = await makeBackend()
      h.backend.setCamera(CAMERA, LINEAR)
      h.backend.setSource(imageSource(4, 4, 1))
      // The render's own pop resolves an error; create()'s three pops already
      // ran with the default null.
      h.mocks.popErrorScope.mockResolvedValueOnce({ message: 'bad bind group' } as GPUError)
      h.backend.render()
      // The pop is consumed in a .then, not awaited by render().
      await Promise.resolve()
      await Promise.resolve()

      expect(gpu).toHaveBeenCalledWith('render validation error: %s', 'bad bind group')
    } finally {
      gpu.mockRestore()
    }
  })
})
