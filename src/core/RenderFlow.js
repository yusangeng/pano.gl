/**
 * 渲染流程
 *
 * @author yusangeng@outlook.com
 */

import validate from 'io-validate'
import Logger from 'chivy'
import undisposed from 'refra/lib/decorator/undisposed'
import Camera from './camera/Camera'
import Texture from './Texture'
import Renderer from './Renderer'
import FrameDriver from './FrameDriver'
import selectorToElement from '../utils/selectorToElement'

const log = new Logger('pano.gl/core/RenderFlow')

export default superclass => class RenderFlow extends superclass {
  @undisposed
  get frameId() {
    return this.renderer_.frameId
  }

  @undisposed
  get frameWidth() {
    return this.renderer_.frameWidth
  }

  @undisposed
  get frameHeight() {
    return this.renderer_.frameHeight
  }

  @undisposed
  get frameRate() {
    return this.renderer_.frameRate
  }

  @undisposed
  get updateRate() {
    return this.renderer_.updateRate
  }

  @undisposed
  get camera() {
    return this.camera_
  }

  @undisposed
  get texture() {
    return this.texture_
  }

  initRenderFlow(el) {
    el = selectorToElement(el)
    validate(el, 'el').isElement()

    // 渲染器
    this.renderer_ = new Renderer(el)

    // 定时器
    var driver = this.driver_ = new FrameDriver()
    // 定时渲染回调
    driver.on('frame', this.renderFrame.bind(this))
    // 开始轮询
    driver.start()

    // 监听尺寸改变事件，改变摄像机比例
    var cb = this.wrapResizeCallback_ = _ => {
      if (this.camera_.aspect) {
        this.camera_.aspect = this.el_.clientWidth / this.el_.clientHeight
      }
    }

    window.addEventListener('resize', cb)
  }

  dispose() {
    window.removeEventListener('resize', this.wrapResizeCallback_)

    this.driver_.dispose()
    this.driver_ = null

    this.renderer_.dispose()
    this.renderer_ = null

    if (this.texture_) {
      this.texture_.dispose()
      this.texture_ = null
    }

    if (this.camera_) {
      this.camera_ = null
    }

    super.dispose()
  }

  @undisposed
  setCamera(camera) {
    validate(camera, 'camera').instanceOf(Camera)
    this.camera_ = camera
    return this
  }

  @undisposed
  setTexture(texture) {
    validate(texture, 'texture').instanceOf(Texture)

    if (this.texture_) {
      this.texture_.dispose()
    }

    this.texture_ = texture

    return this
  }

  @undisposed
  rotate(lat, lng) {
    const { camera } = this
    if (camera) {
      camera.rotate(lat, lng)
      this.trigger({ type: 'rotate', lat, lng })
      log.debug(`rotate, camera.povLatitude = ${camera.povLatitude}, camera.povLongitude = ${camera.povLongitude}.`)
    }

    return this
  }

  @undisposed
  zoom(delta) {
    if (this.camera_) {
      this.camera_.zoom(delta)
      this.trigger({ type: 'zoom', delta })
    }

    return this
  }

  // private

  renderFrame() {
    this.renderer_.render(this.camera_, this.texture_)
  }
}
