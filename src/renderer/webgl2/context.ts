/**
 * WebGL2 context acquisition and program compilation.
 *
 * WebGL's error model is the opposite of WebGPU's: synchronous, non-throwing,
 * and mostly silent. `compileShader` reports failure only through
 * `getShaderParameter(COMPILE_STATUS)`, and every other call sets an error flag
 * that nobody reads. There is no error scope to pop.
 *
 * So every failure point has to be asked about explicitly. This file is where
 * that happens, and it throws -- the legacy `createProgram` logged and returned
 * null, and the viewer that received it reported success and drew nothing for
 * its entire lifetime.
 */

/** Which stage a shader belongs to, used for error messages. */
export type ShaderStage = 'vertex' | 'fragment'

/**
 * Annotates a driver error log with the offending source line.
 *
 * Drivers report positions as `ERROR: 0:12: message`, where 12 is a line number
 * into the string that was handed to `shaderSource`. Because the generated
 * constants are prepended to the shader body, that number is usually not the
 * line the author sees in the file -- so the source has to be echoed back.
 */
export function describeShaderError (log: string, source: string): string {
  const lines = source.split('\n')
  return log.replace(/ERROR:\s*\d+:(\d+)/g, (match, lineNumber: string) => {
    const index = Number(lineNumber) - 1
    // Out-of-range is possible: some drivers count against the pre-substitution
    // source. Echoing nothing is better than throwing inside an error path.
    const line = lines[index]
    return line === undefined ? match : `${match}\n    > ${line.trim()}`
  })
}

/**
 * Compiles one shader stage.
 *
 * @throws If compilation fails, with the driver log and the offending lines.
 *   The shader object is deleted before throwing.
 */
export function compileShader (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  stage: ShaderStage
): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error(`could not allocate a ${stage} shader object`)

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    // The log alone is often not enough to locate the line, because the
    // generated constants shift every number. describeShaderError adds the
    // actual source text back in.
    const log = describeShaderError(gl.getShaderInfoLog(shader) ?? '(no log)', source)
    gl.deleteShader(shader)
    throw new Error(`${stage} shader failed to compile:\n${log}`)
  }

  return shader
}

/**
 * Links a vertex and fragment shader into a program.
 *
 * Both shaders are deleted, attached or not, once linking is done: after a
 * successful link the program holds everything it needs. They are also deleted
 * on failure, so a caller retrying with a fixed source does not accumulate
 * shader objects.
 *
 * @throws If linking fails.
 */
export function linkProgram (
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader
): WebGLProgram {
  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    throw new Error('could not allocate a program object')
  }

  try {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program failed to link:\n${gl.getProgramInfoLog(program) ?? '(no log)'}`)
    }
    return program
  } catch (error) {
    gl.deleteProgram(program)
    throw error
  } finally {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
  }
}

/**
 * Creates a WebGL2 context configured the way this backend needs it.
 *
 * @returns `null` when the browser cannot provide one. Callers treat that as
 *   "no backend", not as an error -- it is the expected result on a device with
 *   no WebGL2 at all.
 */
export function acquireContext (canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    // The legacy context enabled depth testing and requested a depth buffer
    // that was never cleared (defect F4). Neither backend needs one now: there
    // is one triangle and nothing to occlude.
    depth: false,
    stencil: false,
    // The shader outputs exactly what the source contains. Letting the browser
    // post-multiply introduces a difference against the WebGPU backend that
    // gate C would then have to tolerate.
    premultipliedAlpha: false,
    /*
     * TRUE, and it is not a default worth taking. Without it the drawing buffer
     * is cleared when the browser composites the frame, so anything that reads
     * the canvas in a later task sees black. That is every user-story test (they
     * read after awaiting a media event), any consumer that screenshots the
     * canvas, and the context-loss test in Task 3.
     *
     * It costs a copy of the buffer per frame, which is why the WebGPU backend
     * does not pay it -- the WebGPU canvas keeps its last presented frame. This
     * backend is the fallback; correctness under read-back is worth more here
     * than the copy.
     */
    preserveDrawingBuffer: true,
    antialias: false
  })
}
