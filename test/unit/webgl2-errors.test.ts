import { describe, it, expect, vi } from 'vitest'
import { compileShader, linkProgram, describeShaderError } from '../../src/renderer/webgl2/context'

function fakeGl (ok: boolean, log = '') {
  return {
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => ok),
    getShaderInfoLog: vi.fn(() => log),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => ok),
    getProgramInfoLog: vi.fn(() => log),
    deleteProgram: vi.fn()
  } as unknown as WebGL2RenderingContext
}

describe('compileShader', () => {
  it('returns the shader when compilation succeeds', () => {
    expect(compileShader(fakeGl(true), 0x8b31, 'void main(){}', 'vertex')).toBeTruthy()
  })

  it('throws with the driver log when compilation fails', () => {
    // The legacy createProgram logged and returned null. The caller then stored
    // null as the program and called useProgram(null) every frame: the viewer
    // constructed "successfully" and drew nothing, forever. A shader that will
    // not compile is not a viewer.
    expect(() => compileShader(fakeGl(false, 'ERROR: 0:12: syntax error'), 0x8b31, 'x', 'vertex'))
      .toThrow(/vertex.*0:12.*syntax error/s)
  })

  it('names which stage failed, because the driver log often does not', () => {
    // getShaderInfoLog for a vertex shader sometimes reports line numbers with
    // no indication of which source file they belong to.
    expect(() => compileShader(fakeGl(false, 'bad'), 0x8b31, 'x', 'vertex')).toThrow(/vertex/)
    expect(() => compileShader(fakeGl(false, 'bad'), 0x8b30, 'x', 'fragment')).toThrow(/fragment/)
  })

  it('deletes the shader it failed to compile', () => {
    // A failed compile still allocates a shader object. Leaking it per attempt
    // adds up across source swaps.
    const gl = fakeGl(false, 'bad')
    try { compileShader(gl, 0x8b31, 'x', 'vertex') } catch { /* expected */ }
    expect(gl.deleteShader).toHaveBeenCalled()
  })
})

describe('linkProgram', () => {
  it('returns the program when linking succeeds', () => {
    const gl = fakeGl(true)
    expect(linkProgram(gl, gl.createShader(0)!, gl.createShader(0)!)).toBeTruthy()
  })

  it('throws with the program log when linking fails', () => {
    expect(() => linkProgram(fakeGl(false, 'varying mismatch'), 0x8b31 as never, 0x8b30 as never))
      .toThrow(/link.*varying mismatch/s)
  })

  it('detaches and deletes both shaders on success', () => {
    // Once linked, the shader objects are no longer needed. Keeping them is a
    // small leak per backend construction, which matters when a viewer is
    // recreated on every camera swap.
    const gl = fakeGl(true)
    const vs = gl.createShader(0)!
    const fs = gl.createShader(0)!
    linkProgram(gl, vs, fs)
    expect(gl.deleteShader).toHaveBeenCalledWith(vs)
    expect(gl.deleteShader).toHaveBeenCalledWith(fs)
  })
})

describe('describeShaderError', () => {
  it('annotates a line number with the offending source line', () => {
    // The driver reports "0:12"; without the source line, finding it means
    // counting lines by hand in a generated string.
    const source = '#version 300 es\nline a\nline b\nline c\n'
    // Line 3 of the source (1-indexed) is "line b".
    const described = describeShaderError('ERROR: 0:3: something', source)
    expect(described).toContain('line b')
  })

  it('passes the log through unchanged when no line number is present', () => {
    expect(describeShaderError('no line info here', 'x')).toBe('no line info here')
  })

  it('does not throw on a line number past the end of the source', () => {
    // Generated constants are prepended, so drivers sometimes report a line
    // number from the pre-substitution source.
    expect(() => describeShaderError('ERROR: 0:9999: boom', 'short')).not.toThrow()
  })
})
