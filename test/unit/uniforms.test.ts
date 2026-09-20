import { describe, it, expect } from 'vitest'
import { CAMERA_UNIFORM_LAYOUT, CAMERA_UNIFORM_SIZE, packCameraUniforms } from '../../src/renderer/uniforms'
import { mat4 } from 'gl-matrix'

describe('camera uniform layout', () => {
  it('is a multiple of 16 bytes', () => {
    // A uniform buffer binding whose size is not 16-byte aligned is a
    // validation error on some implementations and a silent misread on others.
    expect(CAMERA_UNIFORM_SIZE % 16).toBe(0)
  })

  it('places every field at a 4-byte-aligned offset', () => {
    for (const field of CAMERA_UNIFORM_LAYOUT) {
      expect(field.offset % 4, `${field.name} at ${field.offset}`).toBe(0)
    }
  })

  it('has no overlapping fields', () => {
    const sorted = [...CAMERA_UNIFORM_LAYOUT].sort((a, b) => a.offset - b.offset)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      expect(cur.offset, `${cur.name} overlaps ${prev.name}`).toBeGreaterThanOrEqual(prev.offset + prev.byteLength)
    }
  })

  it('covers the whole buffer with no unexplained gap beyond alignment padding', () => {
    const sorted = [...CAMERA_UNIFORM_LAYOUT].sort((a, b) => a.offset - b.offset)
    let end = 0
    for (const f of sorted) {
      if (f.name.startsWith('_pad')) continue
      // Padding between fields may exist for alignment, but the gap must be
      // small. A large gap means a field was moved and the size was not.
      expect(f.offset - end, `gap before ${f.name}`).toBeLessThanOrEqual(12)
      end = f.offset + f.byteLength
    }
    expect(CAMERA_UNIFORM_SIZE - end).toBeLessThanOrEqual(12)
  })

  it('accounts for every byte the struct needs', () => {
    const expected = 64 /* invClip */ + 4 * 8 /* eight scalars */
    expect(CAMERA_UNIFORM_SIZE).toBe(expected)
    expect(CAMERA_UNIFORM_SIZE).toBe(96)
  })
})

describe('packCameraUniforms', () => {
  const invClip = mat4.create()

  it('writes the matrix column-major, matching WGSL mat4x4 indexing', () => {
    // WGSL's `m[col][row]` is gl-matrix's `elements[col * 4 + row]`. Getting
    // this wrong transposes the picture, and there is no error.
    mat4.identity(invClip)
    invClip[12] = 7
    invClip[13] = 8
    invClip[14] = 9

    const buf = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(buf, {
      invClip,
      projKind: 1,
      texProjKind: 1,
      povLatitude: 0,
      povLongitude: 0,
      zoom: 1
    })

    const f32 = new Float32Array(buf)
    // elements[12], [13], [14] are m[3][0], m[3][1], m[3][2] -- the translation
    // column. They must land at float indices 12, 13, 14.
    expect(f32[12]).toBeCloseTo(7, 6)
    expect(f32[13]).toBeCloseTo(8, 6)
    expect(f32[14]).toBeCloseTo(9, 6)
  })

  it('writes the projection kinds as unsigned integers, not floats', () => {
    const buf = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(buf, {
      invClip,
      projKind: 3,
      texProjKind: 1,
      povLatitude: 0,
      povLongitude: 0,
      zoom: 1
    })
    const u32 = new Uint32Array(buf)
    const projField = CAMERA_UNIFORM_LAYOUT.find(f => f.name === 'projKind')!
    expect(u32[projField.offset / 4]).toBe(3)
  })

  it('writes the scalars at their declared offsets', () => {
    const buf = new ArrayBuffer(CAMERA_UNIFORM_SIZE)
    packCameraUniforms(buf, {
      invClip,
      projKind: 1,
      texProjKind: 1,
      povLatitude: -12.5,
      povLongitude: 200,
      zoom: 2.5
    })
    const f32 = new Float32Array(buf)
    const at = (name: string) =>
      f32[CAMERA_UNIFORM_LAYOUT.find(f => f.name === name)!.offset / 4]!
    expect(at('povLatitude')).toBeCloseTo(-12.5, 5)
    expect(at('povLongitude')).toBeCloseTo(200, 5)
    expect(at('zoom')).toBeCloseTo(2.5, 5)
  })

  it('rejects a buffer of the wrong size', () => {
    // A short buffer would make the writes silently land outside the typed
    // array view and vanish, producing a frame drawn from zeros.
    expect(() =>
      packCameraUniforms(new ArrayBuffer(CAMERA_UNIFORM_SIZE - 4), {
        invClip,
        projKind: 1,
        texProjKind: 1,
        povLatitude: 0,
        povLongitude: 0,
        zoom: 1
      })
    ).toThrow(/96/)
  })
})
