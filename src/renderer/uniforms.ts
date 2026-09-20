/**
 * The camera uniform block, described once.
 *
 * WebGPU has no uniform reflection -- there is no `getUniformLocation` to ask
 * where a field landed. The JavaScript side must know the offsets, and if it is
 * wrong nothing complains: the shader reads whatever bytes happen to be there.
 *
 * So the layout is data, and `test/integration/uniform-layout.test.ts` does a
 * round trip through the GPU to confirm the data is right. A unit test can only
 * check that the offsets are self-consistent; only the round trip can check
 * that they match WGSL's idea of the struct.
 *
 * Layout rules that matter here (verified on Metal and SwiftShader):
 *   - WGSL's uniform address space allows consecutive 4-byte scalars. It is
 *     NOT std140. For this shape (a mat4 then scalars) the two land the same
 *     offsets and size. Verify any new shape against the WGSL spec, not
 *     either mental model: base WGSL uniform also pads array strides and
 *     embedded struct members to 16-byte steps (vec3 is 16-aligned in both),
 *     while std140 uniquely pads every matrix column to a vec4 -- mat2x2 is
 *     32 bytes there, 16 in WGSL.
 *   - The whole block must be a multiple of 16 bytes.
 */

import type { mat4 } from 'gl-matrix'

/** One field of the uniform block. */
export interface UniformField {
  readonly name: string
  /** Byte offset from the start of the block. */
  readonly offset: number
  /** Size in bytes. */
  readonly byteLength: number
}

/**
 * The camera uniform block.
 *
 * `invClip` is the inverse of the camera's clip matrix. The vertex shader does
 * not use it -- it emits clip-space coordinates directly from the vertex index.
 * The fragment shader uses it to turn a screen position back into the surface
 * position the projection formulas expect. See the P3 design note.
 */
export const CAMERA_UNIFORM_LAYOUT: readonly UniformField[] = [
  { name: 'invClip', offset: 0, byteLength: 64 },
  { name: 'projKind', offset: 64, byteLength: 4 },
  { name: 'texProjKind', offset: 68, byteLength: 4 },
  { name: 'povLatitude', offset: 72, byteLength: 4 },
  { name: 'povLongitude', offset: 76, byteLength: 4 },
  { name: 'zoom', offset: 80, byteLength: 4 },
  // Alignment padding, not dead uniforms. The legacy struct uploaded
  // u_CamGeoWidth and u_CamGeoHeight every frame and the shader read neither;
  // those are gone. These exist only to round the block up to 16 bytes.
  { name: '_pad0', offset: 84, byteLength: 4 },
  { name: '_pad1', offset: 88, byteLength: 4 },
  { name: '_pad2', offset: 92, byteLength: 4 }
] as const

/** Total block size in bytes. Must be a multiple of 16. */
export const CAMERA_UNIFORM_SIZE = 96

/** The values `packCameraUniforms` writes. */
export interface CameraUniformValues {
  readonly invClip: mat4
  readonly projKind: number
  readonly texProjKind: number
  readonly povLatitude: number
  readonly povLongitude: number
  readonly zoom: number
}

/** Byte offset of a named field. Throws if the name is not in the layout. */
function offsetOf (name: keyof CameraUniformValues | '_pad0' | '_pad1' | '_pad2'): number {
  const field = CAMERA_UNIFORM_LAYOUT.find(f => f.name === name)
  if (!field) throw new Error(`no uniform field named ${name}`)
  return field.offset
}

/**
 * Packs the camera values into a GPU-ready buffer.
 *
 * The matrix is copied straight through in gl-matrix's column-major order,
 * which is the same order WGSL's `mat4x4<f32>` uses: `m[col][row]` corresponds
 * to `elements[col * 4 + row]`. No transpose.
 *
 * @param target - Buffer to fill. Must be exactly `CAMERA_UNIFORM_SIZE` bytes.
 * @throws If `target` is the wrong size -- a short buffer would make the writes
 *   land outside the typed-array view and silently vanish.
 */
export function packCameraUniforms (target: ArrayBuffer, values: CameraUniformValues): void {
  if (target.byteLength !== CAMERA_UNIFORM_SIZE) {
    throw new RangeError(
      `camera uniform buffer must be ${CAMERA_UNIFORM_SIZE} bytes, got ${target.byteLength}`
    )
  }

  const f32 = new Float32Array(target)
  const u32 = new Uint32Array(target)

  f32.set(values.invClip as unknown as ArrayLike<number>, offsetOf('invClip') / 4)
  u32[offsetOf('projKind') / 4] = values.projKind
  u32[offsetOf('texProjKind') / 4] = values.texProjKind
  f32[offsetOf('povLatitude') / 4] = values.povLatitude
  f32[offsetOf('povLongitude') / 4] = values.povLongitude
  f32[offsetOf('zoom') / 4] = values.zoom

  for (const pad of ['_pad0', '_pad1', '_pad2'] as const) {
    f32[offsetOf(pad) / 4] = 0
  }
}
