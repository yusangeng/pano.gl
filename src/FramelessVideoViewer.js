/**
 * 视频播放器
 *
 * @author Y3G
 */

import check from 'param-check'
import mix from 'litchy/lib/mix'
import undisposed from 'litchy/lib/decorator/undisposed'
import Viewer from './viewer'
import Texture from './core/Texture'
import Provider from './core/provider/VideoProvider'
import CameraFactory from './CameraFactory'

export default class FramelessVideoViewer extends mix(Viewer).with(CameraFactory) {
  @undisposed
  set cameraOptions(options) {
    const camera = this.createCamera(options)
    this.setCamera(camera)
  }

  constructor ({ el, src, video, projection = 'equiprectangular', frameSize, camera: cameraOptions }) {
    super(el)

    check(src || video, 'src || video').isElement()
    check(projection, 'projection').among('equiprectangular', 'fisheye')

    const camera = this.createCamera(cameraOptions)
    this.setCamera(camera)

    const provider = new Provider(src || video)
    const texture = new Texture({ projection, frameSize, provider })

    provider.on('*', evt => this.trigger(evt))
    this.setTexture(texture)
  }

  dispose () {
    super.dispose()
  }
}
