/**
 * 图片纹理数据
 * 
 * @author Y3G
 */

import check from 'param-check'
import eventable from 'litchy/lib/decorator/eventable'
import undisposed from 'litchy/lib/decorator/undisposed'

@eventable
export default class ImageProvider {
  @undisposed
  get src () {
    return this.media.src
  }

  @undisposed
  set src (value) {
    check(value, 'value').isString()
    
    if (this.media_) {
      this.media_.onload = this.media_.onerror = null
    }

    const img = this.media_ = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = evt => {
      this.needUpdate_ = true
      this.trigger({
        type: 'media-load',
        domEvent: evt
      })
    }

    img.onerror = evt => {
      this.trigger({
        type: 'media-error',
        domEvent: evt
      })
    }

    this.needUpdate_ = false
    img.src = value
    this.trigger('media-change')
  }

  @undisposed
  get media () {
    return this.media_
  }

  constructor(src) {
    this.src = src
  }

  updateTexture (texture) {
    if (texture.direct) {
      const ret = this.needUpdate_
      this.needUpdate_ = false
      return ret
    }

    if (!this.needUpdate_) {
      return false
    }

    const canvas = texture.frameCanvas
    const ctx = canvas.getContext('2d')

    ctx.drawImage(this.media, 0, 0, canvas.width, canvas.height)
    this.needUpdate_ = false

    return true
  }
}
