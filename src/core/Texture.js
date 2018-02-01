/**
 * 纹理
 *
 * @author Y3G
 */

import check from 'param-check'
import merge from 'lodash/merge'
import eventable from 'litchy/lib/decorator/eventable'
import undisposed from 'litchy/lib/decorator/undisposed'

const PROJECTION_EQUIPRECTANGLULAR = 1
const PROJECTION_FISHEYE = 2

@eventable
export default class Texture {
  @undisposed
  get frame () {
    if (this.direct_) {
      return this.provider_.media
    }

    // webgl纹理尺寸有限制, 可能需要canvas中转
    return this.frameCanvas_
  }

  @undisposed
  get projection () {
    return this.projection_
  }

  @undisposed
  get frameCanvas () {
    return this.frameCanvas_
  }

  @undisposed
  get direct () {
    return this.direct_
  }

  @undisposed
  get provider () {
    return this.provider_
  }

  constructor ({ projection = 'equiprectangular', frameSize, provider }) {
    check(projection, 'projection').among('equiprectangular', 'fisheye')
    check(provider, 'provider').isObject()

    let prj = projection.toLowerCase()

    if (prj === 'equiprectangular') {
      prj = PROJECTION_EQUIPRECTANGLULAR
    } /*else if (prj === 'fisheye') {
      prj = PROJECTION_FISHEYE
    }*/ else {
      throw new Error(`Unimplemented projection type(${prj}).`)
    }

    this.projection_ = prj

    if (frameSize) {
      // frame canvas 尺寸
      const frameSize = this.frameSize_ = merge({}, frameSize)
      const frame = this.frameCanvas_ = document.createElement('canvas')

      frame.width = frameSize.width
      frame.height = frameSize.height

      // 默认全黑
      const ctx = frame.getContext('2d')
      ctx.fillRect(0, 0, frame.width, frame.height)

      this.direct_ = false
    } else {
      // 如果不需要裁剪和缩放，则不需要创建 frameCanvas，直接把 media_ 传出去即可
      this.direct_ = true
    }

    provider.on('*', evt => this.trigger(assign({ target: this }, evt)))
    this.provider_ = provider
  }

  dispose () {
    this.provider_.dispose()
    this.provider_ = null
    this.frameCanvas_ = null

    super.dispose()
  }

  @undisposed
  update () {
    return this.provider_.updateTexture(this)
  }
}
