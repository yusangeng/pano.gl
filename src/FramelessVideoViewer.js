/**
 * 视频播放器
 *
 * @author yusangeng@outlook.com
 */

import validate from 'io-validate'
import { mix } from 'mix-with'
import undisposed from 'refra/lib/decorator/undisposed'
import Viewer from './viewer'
import Texture from './core/Texture'
import Provider from './core/provider/VideoProvider'
import CameraFactory from './CameraFactory'
import selectorToElement from './utils/selectorToElement';

const { assign } = Object

export default class FramelessVideoViewer extends mix(Viewer).with(CameraFactory) {
  @undisposed
  set cameraOptions(options) {
    const camera = this.createCamera(options)
    this.setCamera(camera)
  }

  @undisposed
  get video() {
    return this.texture.provider.media
  }

  constructor({ el, src, video, projection = 'equiprectangular', frameSize, camera: cameraOptions }) {
    super(el)

    const videoSource = selectorToElement(video || src)
    validate(videoSource, 'videoSource').isElement()
    validate(projection, 'projection').among('equiprectangular', 'fisheye')

    const camera = this.createCamera(cameraOptions)
    this.setCamera(camera)

    const provider = new Provider(videoSource)
    const texture = new Texture({ projection, frameSize, provider })

    texture.on('*', evt => this.trigger(assign({ target: this }, evt)))
    this.setTexture(texture)
  }

  dispose() {
    super.dispose()
  }
}
