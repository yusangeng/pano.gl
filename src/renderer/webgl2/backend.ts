/**
 * The WebGL2 backend, and pano.gl's fallback path.
 *
 * Deliberately not feature-equal with the WebGPU backend: it exists so that
 * browsers without WebGPU can still show a panorama. It does not get its own
 * capabilities, and the Backend interface makes no concession to it.
 *
 * The structural difference from WebGPU is the uniform upload. WebGPU packs
 * everything into one 96-byte block; here each value goes to its own named
 * uniform. The two layouts happen to coincide for this struct, which is a
 * coincidence and not a reason -- see the plan's "关键设计决定".
 *
 * The structural difference that does NOT exist is depth. Both matrices are
 * built by core/matrix.ts with the backend's own depth convention, and both
 * conventions put the far plane at ndc z = +1, so the fragment shader is
 * identical in both.
 */

import { mat4 } from 'gl-matrix'
import { cameraProjectionCode, textureProjectionCode } from '../../core/constants'
import { buildCameraTransform } from '../../core/matrix'
import type { CameraState, Projection } from '../../core/types'
import type { Backend, Capabilities, DeviceLost, RenderableSource } from '../backend'
import { describeCapabilities } from '../capabilities'
import { acquireContext, compileShader, linkProgram } from './context'
import { PANORAMA_GLSL_FRAGMENT, PANORAMA_GLSL_VERTEX } from './shaders'

/**
 * The `reason` token for a lost WebGL2 context.
 *
 * WebGL does not name its own loss reasons, so this is a project-level token
 * rather than a browser one. P3's `DeviceLost` documents it.
 */
const CONTEXT_LOST = 'context-lost'

const CONTEXT_LOST_MESSAGE =
  'the WebGL2 context was lost. The browser may restore it; this backend ' +
  'rebuilds its program and drops its texture if it does, and redraws on the ' +
  'next frame the viewer asks for.'

/** The uniforms the shader declares. One entry per `uniform` in panorama.glsl. */
const UNIFORM_NAMES = [
  'u_invClip', 'u_projKind', 'u_texProjKind',
  'u_povLatitude', 'u_povLongitude', 'u_zoom', 'u_tex'
] as const

type UniformName = (typeof UNIFORM_NAMES)[number]

/** Compiles and links the panorama program. Also the context-restore path. */
function buildProgram (gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, PANORAMA_GLSL_VERTEX, 'vertex')
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, PANORAMA_GLSL_FRAGMENT, 'fragment')
  return linkProgram(gl, vertex, fragment)
}

/**
 * Locates every uniform the shader declares.
 *
 * @throws If one is missing, naming it. A null location means the uniform was
 *   optimized out or misspelled; the `gl.uniform*` call is then silently
 *   ignored, the value stays at its default, and the picture is wrong in a way
 *   that reads as a projection bug. Failing here, at construction, is the whole
 *   point -- the legacy path found out by rendering a wrong image.
 */
function locateUniforms (
  gl: WebGL2RenderingContext,
  program: WebGLProgram
): Record<UniformName, WebGLUniformLocation | null> {
  const locations = {} as Record<UniformName, WebGLUniformLocation | null>

  for (const name of UNIFORM_NAMES) {
    const location = gl.getUniformLocation(program, name)
    // `u_tex` is the one exemption: its value is the constant 0, which is also
    // the default for every sampler uniform, so a driver that folded it away
    // has done nothing wrong.
    if (location === null && name !== 'u_tex') {
      throw new Error(`uniform ${name} not found in the linked program`)
    }
    locations[name] = location
  }

  return locations
}

/**
 * The capabilities this backend reports.
 *
 * Routed through `describeCapabilities` rather than assembled here. The
 * clamping rule for `maxTextureDimension` lives there, is unit tested there,
 * and a second copy of it here is exactly the kind of duplication that drifts
 * silently.
 */
function capabilityFor (gl: WebGL2RenderingContext): Capabilities {
  const selected = describeCapabilities({
    hasWebGPU: false,
    hasWebGL2: true,
    adapter: null,
    maxTextureDimension: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    // No WebGL2 equivalent of importExternalTexture.
    externalTextures: false
  })

  if (selected.backend === 'none') {
    // Unreachable: `hasWebGL2` above is a literal `true`. The throw exists
    // because the return type is a union and the narrowing has to happen
    // somewhere. Do not replace it with an assertion -- an assertion is a claim
    // that the compiler has already checked.
    throw new Error('describeCapabilities reported no backend for a live WebGL2 context')
  }

  return selected
}

export class WebGL2Backend implements Backend {
  readonly kind = 'webgl2' as const

  /**
   * Public, not `#private`: this satisfies `Backend.capabilities`, and the
   * viewer reads it to decide whether a source needs downscaling before it ever
   * calls `setSource`. A private field would fail `implements Backend` at
   * typecheck, which is the point of declaring the interface in the first place.
   */
  readonly capabilities: Capabilities

  readonly #canvas: HTMLCanvasElement
  readonly #gl: WebGL2RenderingContext
  readonly #clip = mat4.create()
  readonly #invClip = mat4.create()

  // Not readonly: a lost-and-restored context invalidates the program and every
  // uniform location with it, and both are rebuilt in #restore().
  #program: WebGLProgram
  #uniforms: Record<UniformName, WebGLUniformLocation | null>

  #texture: WebGLTexture | undefined
  #textureVersion = -1
  #observer: ((lost: DeviceLost) => void) | undefined
  /** True between `webglcontextlost` and `webglcontextrestored`. */
  #lost = false
  #disposed = false

  private constructor (init: {
    canvas: HTMLCanvasElement
    gl: WebGL2RenderingContext
    capabilities: Capabilities
    program: WebGLProgram
    uniforms: Record<UniformName, WebGLUniformLocation | null>
  }) {
    this.#canvas = init.canvas
    this.#gl = init.gl
    this.capabilities = init.capabilities
    this.#program = init.program
    this.#uniforms = init.uniforms

    // Arrow-function properties, not prototype methods: removeEventListener
    // matches on identity, and a bound copy is a different function.
    this.#canvas.addEventListener('webglcontextlost', this.#onContextLost)
    this.#canvas.addEventListener('webglcontextrestored', this.#onContextRestored)
  }

  /**
   * Creates a backend, or returns `null` when WebGL2 is unavailable.
   *
   * @throws If WebGL2 is available but the shader will not compile or link, or
   *   a uniform is missing. Those are bugs in this package, not a property of
   *   the device, and reporting them as "no backend" would hide them behind a
   *   fallback that also does not work.
   */
  static create (canvas: HTMLCanvasElement): WebGL2Backend | null {
    const gl = acquireContext(canvas)
    if (!gl) return null

    const program = buildProgram(gl)
    const uniforms = locateUniforms(gl, program)

    return new WebGL2Backend({
      canvas,
      gl,
      capabilities: capabilityFor(gl),
      program,
      uniforms
    })
  }

  #onContextLost = (event: Event): void => {
    // The default action for this event is to make the context permanently
    // unrestorable. preventDefault() must be called synchronously here -- there
    // is no later chance, and without it webglcontextrestored never fires and
    // the backend is dead for reasons nothing reports.
    event.preventDefault()
    this.#lost = true
    // Nobody may be listening. §6.5's rule is that the app can decide what to
    // show and how to report it, so reporting nothing here is not a failure --
    // it is an app that did not ask.
    this.#observer?.({ reason: CONTEXT_LOST, message: CONTEXT_LOST_MESSAGE })
  }

  #onContextRestored = (): void => {
    try {
      // Every GL object died with the context: the program, the uniform
      // locations and the texture. The restored context is a fresh one wearing
      // the same JavaScript object, so all of them are rebuilt here.
      this.#program = buildProgram(this.#gl)
      this.#uniforms = locateUniforms(this.#gl, this.#program)
      this.#texture = undefined
      this.#textureVersion = -1
      this.#lost = false
    } catch (error) {
      // Recompiling the same source in a context that just came back is not
      // expected to fail. If it does, the honest report is that this backend is
      // unusable, and the app's response is to build a new viewer (spec §6.4:
      // detection and clean release, not automatic recovery).
      this.#lost = true
      this.#observer?.({
        reason: CONTEXT_LOST,
        message: `${CONTEXT_LOST_MESSAGE} Rebuilding the program failed: ${String(error)}`
      })
    }
  }

  setCamera (state: CameraState, projection: Projection): void {
    const gl = this.#gl

    // 'minus-one-to-one' -- WebGL2's ndc z is [-1, 1]. The WebGPU backend passes
    // 'zero-to-one'. This one argument is the entire depth-convention difference
    // between the two backends.
    buildCameraTransform(state, projection, 'minus-one-to-one', this.#clip)
    mat4.invert(this.#invClip, this.#clip)

    gl.useProgram(this.#program)
    gl.uniformMatrix4fv(this.#uniforms.u_invClip, false, this.#invClip)
    // `cameraProjectionCode` takes the KIND, not the projection: it is the one
    // place a kind becomes a number, and it agrees with the #defines this shader
    // was compiled with because both come from projection-kinds.json.
    gl.uniform1i(this.#uniforms.u_projKind, cameraProjectionCode(projection.kind))
    gl.uniform1f(this.#uniforms.u_povLatitude, state.povLatitude)
    gl.uniform1f(this.#uniforms.u_povLongitude, state.povLongitude)
    // The three non-linear projections scale their input by zoom; the linear
    // one has no zoom term at all. 1 is what the WGSL packer writes for a linear
    // camera, so the two backends agree on a value neither of them reads.
    gl.uniform1f(this.#uniforms.u_zoom, projection.kind === 'linear' ? 1 : projection.zoom)
  }

  setSource (source: RenderableSource | null): void {
    const gl = this.#gl

    if (!source) {
      this.#texture = undefined
      this.#textureVersion = -1
      return
    }

    gl.useProgram(this.#program)
    // The upload description is inside `state`; `source.projection` does not
    // exist and reading it is the mistake this comment is here to prevent.
    gl.uniform1i(this.#uniforms.u_texProjKind, textureProjectionCode(source.state.projection))

    // WebGL2 has no external textures, so every source goes through a copy. The
    // version check is still worth having: a still image uploads once, and a
    // video uploads once per presented frame rather than once per rAF.
    //
    // `source.element` is used here and NOT retained past this call, which is
    // the interface's contract. That is also why there is no "redraw after a
    // context restore" path: the pixels are gone by the time the context comes
    // back. See #onContextRestored.
    const needsUpload = this.#texture === undefined || this.#textureVersion !== source.version
    if (!needsUpload) return

    if (!this.#texture) this.#texture = gl.createTexture() ?? undefined
    if (!this.#texture) throw new Error('could not allocate a texture object')

    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    // False, because the flip lives in the shader (`to_uv` flips v). Doing it
    // here instead would make the two backends' shaders differ by a flip while
    // their pixels agreed -- which is the one kind of drift gate C cannot see.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.element)
    // No power-of-two requirement in WebGL2, so REPEAT + linear is available
    // at any size. The legacy path could not have asked for REPEAT because
    // WebGL1 restricts NPOT textures to NEAREST + CLAMP_TO_EDGE. The wrap
    // modes must match WebGPU PER SOURCE KIND, not blanket: the WebGPU still
    // sampler is repeat on BOTH axes (src/renderer/webgpu/shaders/sampler.ts)
    // because the cross-seam/pole LINEAR blend lives in the sampler and
    // clamp-to-edge cannot express it (gate A measured the seam blend at up
    // to 124 LSB), while WebGPU video is edge-clamped by
    // textureSampleBaseClampToEdge whatever the sampler says -- an API limit
    // of its entry point, which a clamp-to-edge wrap mirrors exactly.
    const wrap = source.kind === 'video' ? gl.CLAMP_TO_EDGE : gl.REPEAT
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

    this.#textureVersion = source.version
  }

  render (): void {
    const gl = this.#gl
    // Drawing into a lost context is a silent no-op that can log per call. The
    // render loop keeps running until the viewer is told otherwise.
    if (this.#lost) return

    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    if (!this.#texture) return

    gl.useProgram(this.#program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.#texture)
    gl.uniform1i(this.#uniforms.u_tex, 0)
    // Three vertices, no attributes bound and no index buffer. gl_VertexID does
    // the work, exactly as the WGSL vertex stage does it.
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  resize (cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr))
    const height = Math.max(1, Math.round(cssHeight * dpr))
    if (this.#canvas.width !== width) this.#canvas.width = width
    if (this.#canvas.height !== height) this.#canvas.height = height
  }

  /**
   * Registers the device-loss observer.
   *
   * One observer, not a list: `Backend` documents that registering twice
   * replaces the previous one, and that the returned function unregisters only
   * if this call is still the current one. A stale unsubscribe is a no-op rather
   * than a surprise removal -- which is what a `Set` of listeners would give and
   * what the interface deliberately does not.
   */
  onDeviceLost (fn: (lost: DeviceLost) => void): () => void {
    this.#observer = fn
    return () => {
      if (this.#observer === fn) this.#observer = undefined
    }
  }

  dispose (): void {
    if (this.#disposed) return
    this.#disposed = true

    // Before loseContext(), not after: loseContext() fires webglcontextlost on
    // this canvas, and a listener still attached would report a device loss for
    // a backend the caller just released on purpose.
    this.#canvas.removeEventListener('webglcontextlost', this.#onContextLost)
    this.#canvas.removeEventListener('webglcontextrestored', this.#onContextRestored)
    this.#observer = undefined

    if (this.#texture) this.#gl.deleteTexture(this.#texture)
    this.#gl.deleteProgram(this.#program)
    // Ask the driver to release the context now rather than at GC time. The
    // legacy cleanGL() never did this (defect L5), so a page that created and
    // destroyed viewers accumulated contexts until the browser's limit (often
    // 16) was hit and new viewers silently failed to get one.
    this.#gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
