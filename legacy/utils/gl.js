/**
 * WebGL 辅助函数
 *
 * @author Y3G
 */

import shortid from 'shortid'
import Logger from 'chivy'

const log = new Logger('pano.gl/utils/gl')

export function createContext (canvas, options) {
  let gl = null

  ;['webgl', 'experimental-webgl', 'webkit-3d', 'moz-webgl'].some(name => {
    try {
      gl = canvas.getContext(name, options)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)

      return true
    } catch (e) {
      log.debug(`${name} is NOT supported.`)
      return false
    }
  })

  return gl
}

export function createShader (gl, type, source) {
  type = (type.indexOf('v') === 0) ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER

  const shader = gl.createShader(type)

  if (!shader) {
    log.error('Failed creating a shader.')
    return null
  }

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  // Check the result of compilation
  const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS)

  if (!compiled) {
    log.error(`Failed compiling shader, error log: ${gl.getShaderInfoLog(shader)}.`, source)
    gl.deleteShader(shader)
    return null
  }

  return shader
}

export function createProgram (gl, vshader, fshader) {
  const program = gl.createProgram()

  if (!program) {
    log.error('Failed creating a program.')
    return null
  }

  gl.attachShader(program, vshader)
  gl.attachShader(program, fshader)

  gl.linkProgram(program)

  // Check the result of linking
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS)

  if (!linked) {
    log.error(`Failed compiling shader, error log: ${gl.getProgramInfoLog(program)}.`)
    gl.deleteProgram(program)
    return null
  }

  program.$id = shortid()

  return program
}

export function initVertexBuffer (gl, program, vertexes = []) {
  const geometry = new Float32Array(vertexes)
  const buf = gl.createBuffer()

  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, geometry, gl.DYNAMIC_DRAW)

  const fsize = geometry.BYTES_PER_ELEMENT
  // Assign the buffer object to a_Pos and enable the assignment
  const aPos = gl.getAttribLocation(program, 'a_Pos')

  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, fsize * 3, 0)
  gl.enableVertexAttribArray(aPos)

  return vertexes.length / 3
}

export function createTextureObject (gl) {
  const textureObject = gl.createTexture()

  gl.bindTexture(gl.TEXTURE_2D, textureObject)

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.activeTexture(gl.TEXTURE0)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)

  return textureObject
}

export function updateTextureObject (gl, frame) {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, frame)
}
