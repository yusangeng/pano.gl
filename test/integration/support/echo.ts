/*
 * Uniform-layout probe.
 *
 * Writes values into the camera uniform block, has the GPU read every 4-byte
 * slot back out, and returns them. This is the only way to check the JavaScript
 * layout against WGSL's: WebGPU has no uniform reflection, so a field landing at
 * the wrong offset is not an error -- it is a wrong picture.
 *
 * The shader is *generated* from `CAMERA_UNIFORM_LAYOUT` rather than written by
 * hand. WGSL cannot index a struct's members -- each one has to be named -- so a
 * hand-written shader would be a second copy of the layout, which is precisely
 * the pair that has to agree.
 *
 * A compute shader over a storage buffer, not a fragment shader writing colour.
 * Same uniform binding and the same validation, but it round-trips raw bits: an
 * f32/u32 mix-up comes back as a bit pattern instead of surviving a float-to-unorm
 * conversion that happens to look plausible.
 */

import {
  CAMERA_UNIFORM_LAYOUT,
  CAMERA_UNIFORM_SIZE,
  packCameraUniforms
} from '../../../src/renderer/uniforms'
import type { CameraUniformValues } from '../../../src/renderer/uniforms'
import { acquireDevice, withValidationScope } from '../../../src/renderer/webgpu/device'

/** Fields WGSL declares as `u32`. Everything else in the block is `f32`. */
const U32_FIELDS = new Set(['projKind', 'texProjKind'])

/** Floats in the 4x4 matrix that heads the block. */
const MATRIX_FLOATS = 16

/**
 * Builds the WGSL: the struct, and one `out[n] = ...` per 4-byte slot.
 *
 * Index `n` in `out` is byte offset `n * 4` in the block, so the readback is the
 * block's bytes and nothing has to agree about field order beyond the layout
 * itself.
 *
 * The matrix is indexed `invClip[col][row]`. That is where the column-major
 * question gets settled -- gl-matrix's `elements[col * 4 + row]` is the same
 * order, and if that were wrong, this is the thing that would notice.
 */
function buildEchoShader (): string {
  const slots: string[] = []

  for (const field of CAMERA_UNIFORM_LAYOUT) {
    for (let i = 0; i < field.byteLength / 4; i++) {
      const flat = field.offset / 4 + i
      const access = flat < MATRIX_FLOATS
        ? `bitcast<u32>(camera.invClip[${Math.floor(flat / 4)}][${flat % 4}])`
        : U32_FIELDS.has(field.name)
          ? `camera.${field.name}`
          : `bitcast<u32>(camera.${field.name})`
      slots.push(`  out[${flat}] = ${access};`)
    }
  }

  const members = CAMERA_UNIFORM_LAYOUT.map(f => {
    const type = f.byteLength === 64
      ? 'mat4x4<f32>'
      : U32_FIELDS.has(f.name) ? 'u32' : 'f32'
    return `  ${f.name}: ${type},`
  })

  return `
struct Camera {
${members.join('\n')}
}

@group(0) @binding(0) var<uniform> camera: Camera;
@group(0) @binding(1) var<storage, read_write> out: array<u32>;

@compute @workgroup_size(1)
fn main () {
${slots.join('\n')}
}
`
}

/** Fills in whatever the caller left out, so `packCameraUniforms` gets a whole block. */
function withDefaults (values: Partial<CameraUniformValues>): CameraUniformValues {
  return {
    // A plain array is accepted: the probe is reading the block back, not using
    // the matrix, so it need not be a usable transform.
    invClip: Float32Array.from(values.invClip ?? new Array(MATRIX_FLOATS).fill(0)),
    projKind: values.projKind ?? 0,
    texProjKind: values.texProjKind ?? 0,
    povLatitude: values.povLatitude ?? 0,
    povLongitude: values.povLongitude ?? 0,
    zoom: values.zoom ?? 0
  } as CameraUniformValues
}

/**
 * Builds a probe bound to a fresh device.
 *
 * Throws when the browser has no usable WebGPU. The project's setup-file guard
 * has already asserted that `requestAdapter()` returns non-null, so reaching
 * this line means something is genuinely wrong -- not that this machine has no
 * GPU. A skip would hide that, which is why this is a throw.
 */
export async function createEchoRenderer (): Promise<
  (values: Partial<CameraUniformValues>) => Promise<Record<string, unknown>>
> {
  const acquired = await acquireDevice()
  if (!acquired) throw new Error('no WebGPU device available')
  const { device } = acquired

  const uniformBuffer = device.createBuffer({
    label: 'echo-uniforms',
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  })
  const outBuffer = device.createBuffer({
    label: 'echo-out',
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  })
  const readBuffer = device.createBuffer({
    label: 'echo-read',
    size: CAMERA_UNIFORM_SIZE,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
  })

  // `layout: 'auto'` has the pipeline reflect its own bind group layout from
  // the WGSL bindings, so the probe never maintains an explicit layout that
  // would be a second copy of what the shader already declares. Pipeline and
  // bind group are built once here and reused by every call through the closure.
  const module = await withValidationScope(device, 'probe shader module', () =>
    device.createShaderModule({ label: 'echo', code: buildEchoShader() })
  )
  const pipeline = await withValidationScope(device, 'probe compute pipeline', () =>
    device.createComputePipeline({
      label: 'echo',
      layout: 'auto',
      compute: { module, entryPoint: 'main' }
    })
  )
  const bindGroup = await withValidationScope(device, 'probe bind group', () =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: outBuffer } }
      ]
    })
  )

  return async function echo (values) {
    const bytes = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(bytes, withDefaults(values))
    device.queue.writeBuffer(uniformBuffer, 0, bytes)

    const encoder = device.createCommandEncoder({ label: 'echo' })
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(1)
    pass.end()
    encoder.copyBufferToBuffer(outBuffer, 0, readBuffer, 0, CAMERA_UNIFORM_SIZE)
    device.queue.submit([encoder.finish()])

    await readBuffer.mapAsync(GPUMapMode.READ)
    // Copied out before `unmap`: the mapped range is only valid until then.
    const bits = new Uint32Array(readBuffer.getMappedRange().slice(0))
    readBuffer.unmap()
    // Both views are over the same bytes, so this is a reinterpretation and not
    // a conversion -- which is the point: a value that crossed as the wrong type
    // has to come back wrong.
    const floats = new Float32Array(bits.buffer)

    const echoed: Record<string, unknown> = {}
    for (const field of CAMERA_UNIFORM_LAYOUT) {
      // Only what was asked for. A caller checking five scalars should not have
      // to ignore the three padding words in the assertion.
      if (!(field.name in values)) continue
      const start = field.offset / 4
      const count = field.byteLength / 4
      echoed[field.name] = count === 1
        ? (U32_FIELDS.has(field.name) ? bits[start] : floats[start])
        : Array.from(floats.subarray(start, start + count))
    }
    return echoed
  }
}

/*
 * A named export, not a default one merged onto a global. The `PanoTestApi`
 * indirection existed so a Node-side test could reach page-side code; with the
 * tests in the page, the test imports this module like any other.
 */
