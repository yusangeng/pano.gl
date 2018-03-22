/**
 * 图片查看器
 *
 * @author Y3G
 */

import check from 'param-check'
import mix from 'litchy/lib/mix'
import undisposed from 'litchy/lib/decorator/undisposed'
import Viewer from './viewer'
import Texture from './core/Texture'
import Provider from './core/provider/ImageProvider'
import CameraFactory from './CameraFactory'

const { assign } = Object

export default class FramelessImageView extends mix(Viewer).with(CameraFactory) {
  @undisposed
  get src () {
    return this.texture.provider.src
  }

  @undisposed
  set src (url) {
    check(url, 'url').isString()
    this.texture.provider.src = url
  }

  @undisposed
  set cameraOptions (options) {
    const camera = this.createCamera(options)
    this.setCamera(camera)
  }

  constructor ({ el, src, projection = 'equiprectangular', frameSize, camera: cameraOptions }) {
    super(el)

    check(src, 'src').isString()
    check(projection, 'projection').among('equiprectangular', 'fisheye')

    const camera = this.createCamera(cameraOptions)
    this.setCamera(camera)

    const provider = new Provider(src)
    const texture = new Texture({ projection, frameSize, provider })

    texture.on('*', evt => this.trigger(assign({ target: this }, evt)))
    this.setTexture(texture)
  }

  dispose () {
    super.dispose()
  }
}
