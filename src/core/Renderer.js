/**
 * 渲染器
 *
 * @author yusangeng@outlook.com
 */

import shortid from 'shortid'
import { mix } from 'mix-with'
import validate from 'io-validate'
import Disposable from 'refra/lib/mixin/Disposable'
import undisposed from 'refra/lib/decorator/undisposed'
import * as glu from '../utils/gl'
import RateCounter from '../utils/RateCounter'
import Throttle from '../utils/Throttle'
import selectorToElement from '../utils/selectorToElement'
import assert from '../utils/assert'

const { keys } = Object

// 顶点着色器
const vshaderSource = require('../shader/vshader.glsl')
// 片元着色器
const fshaderSource = require('../shader/fshader.glsl')

const MAX_FRAME_RATE = 60

export default class Renderer extends mix().with(Disposable) {
  @undisposed
  get frameWidth() {
    return this.canvas_.width
  }

  @undisposed
  get frameHeight() {
    return this.canvas_.height
  }

  @undisposed
  get frameId() {
    return this.canvas_.getAttribute('id')
  }

  @undisposed
  get frameRate() {
    return this.frameRate_.rate
  }

  @undisposed
  get updateRate() {
    return this.updateRate_.rate
  }

  constructor(el) {
    super()
    el = selectorToElement(el)

    validate(el, 'el').isElement()

    this.prepareGL(el)
    this.adjustSize()

    // textureObject 是 WebGL 纹理对象，texture 是外部纹理数据
    this.textureObject_ = glu.createTextureObject(this.gl_)
    this.programs_ = {}
    this.currentCameraId_ = null

    // 内容刷新到显存中的频率
    this.updateRate_ = new RateCounter()
    // 内容渲染到画面的频率
    this.frameRate_ = new RateCounter()

    this.renderThrottle_ = new Throttle(MAX_FRAME_RATE)
  }

  dispose() {
    this.renderThrottle_ = null
    this.frameRate_.dispose()
    this.frameRate_ = null
    this.updateRate_.dispose()
    this.updateRate_ = null

    this.currentCameraId_ = null

    this.cleanProgram()
    this.gl_.deleteTexture(this.textureObject_)
    this.textureObject_ = null

    window.removeEventListener('resize', this.wrapResizeCallback_)
    this.cleanGL()

    super.dispose()
  }

  @undisposed
  render(camera, texture) {
    if (!this.renderThrottle_.shouldRun) {
      // 限制帧率
      return
    }

    this.frameRate_.increment()

    const gl = this.gl_
    const program = this.getProgram()
    const triangleCount = this.setVertexBuffer(camera)

    gl.useProgram(program)

    // 不同的摄像机输出不同的状态信息，这些信息都通过全局变量传到 shader 中
    const status = camera.status()

    keys(status).forEach(name => {
      const conf = status[name]
      const uniform = gl.getUniformLocation(program, 'u_' + name)

      if (!uniform) {
        return
      }

      if (conf.type === 'uniformMatrix4fv') {
        gl[conf.type](uniform, gl.FALSE, conf.value)
        return
      }

      gl[conf.type](uniform, conf.value || 0)
    })

    // 纹理采用的投影方式
    const uniformTexProjType = gl.getUniformLocation(program, 'u_TexProjType')
    if (uniformTexProjType) {
      gl.uniform1i(uniformTexProjType, texture.projection)
    }

    // 内部使用
    const uniformSampler = gl.getUniformLocation(program, 'u_Sampler')
    if (uniformSampler) {
      gl.uniform1i(uniformSampler, 0)
    }

    if (texture.update()) {
      glu.updateTextureObject(gl, texture.frame)
      this.updateRate_.increment()
    }

    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, triangleCount)
  }

  // private

  prepareGL(el) {
    el = this.el_ = el
    validate(el, 'el').isElement()
    el.innerHTML = ''

    const canvas = this.canvas_ = document.createElement('canvas')
    canvas.setAttribute('id', `renderer-canvas-${shortid()}`)
    canvas.setAttribute('class', `renderer-canvas`)
    el.appendChild(canvas)

    const gl = this.gl_ = glu.createContext(canvas)

    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    return gl
  }

  cleanGL() {
    this.gl_ = null
    this.canvas_ = null
    this.el_.innerHTML = ''
    this.el_ = null
  }

  adjustSize() {
    const onWrapResize = this.wrapResizeCallback_ = _ => {
      const cvs = this.canvas_
      const el = this.el_

      cvs.style.width = `${el.clientWidth}px`
      cvs.style.height = `${el.clientHeight}px`
      cvs.width = cvs.clientWidth
      cvs.height = cvs.clientHeight

      this.gl_.viewport(0, 0, cvs.clientWidth, cvs.clientHeight)
    }

    window.addEventListener('resize', onWrapResize)
    onWrapResize()
  }

  getProgram(camera) {
    const programs = this.programs_
    const name = 'dummy'
    let prog = programs[name]

    if (!prog) {
      prog = programs[name] = this.createProgram()
    }

    return prog
  }

  createProgram() {
    const gl = this.gl_

    const vsource = vshaderSource
    const fsource = fshaderSource

    const vshader = glu.createShader(gl, 'v', vsource)
    const fshader = glu.createShader(gl, 'f', fsource)

    assert(vshader, 'Create vshader failed.')
    assert(fshader, 'Create fshader failed.')

    const program = glu.createProgram(gl, vshader, fshader)

    assert(program, 'Create program failed.')

    return program
  }

  setVertexBuffer(camera) {
    if (camera.id !== this.currentCameraId_) {
      const programs = this.programs_
      const gl = this.gl_
      const name = 'dummy'
      const prog = programs[name]

      this.triangleCount_ = glu.initVertexBuffer(gl, prog, camera.geoVertexes)
      this.currentCameraId_ = camera.id
    }

    return this.triangleCount_
  }

  cleanProgram() {
    Object.values(this.programs_).forEach(prog => this.gl_.deleteProgram(prog))
    this.programs_ = {}
  }
}
