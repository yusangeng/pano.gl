/**
 * 图片查看器
 *
 * @author yusangeng@outlook.com
 */

import validate from 'io-validate'
import { mix } from 'mix-with'
import undisposed from 'refra/lib/decorator/undisposed'
import Viewer from './viewer'
import Texture from './core/Texture'
import Provider from './core/provider/ImageProvider'
import CameraFactory from './CameraFactory'

const { assign } = Object

export default class FramelessImageView extends mix(Viewer).with(CameraFactory) {
  @undisposed
  get src() {
    return this.texture.provider.src
  }

  @undisposed
  set src(url) {
    validate(url, 'url').isString()
    this.texture.provider.src = url
  }

  @undisposed
  set cameraOptions(options) {
    const camera = this.createCamera(options)
    this.setCamera(camera)
  }

  constructor({ el, src, projection = 'equiprectangular', frameSize, camera: cameraOptions }) {
    super(el)

    validate(src, 'src').isString()
    validate(projection, 'projection').among('equiprectangular', 'fisheye')

    const camera = this.createCamera(cameraOptions)
    this.setCamera(camera)

    const provider = new Provider(src)
    const texture = new Texture({ projection, frameSize, provider })

    texture.on('*', evt => this.trigger(assign({ target: this }, evt)))
    this.setTexture(texture)
  }

  dispose() {
    super.dispose()
  }
}
