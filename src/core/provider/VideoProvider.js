/**
 * 视频纹理数据
 * 
 * @author Y3G
 */

import check from 'param-check'
import eventable from 'litchy/lib/decorator/eventable'
import undisposed from 'litchy/lib/decorator/undisposed'
import Throttle from '../../utils//Throttle'

const MAX_UPDATE_RATE = 30

const mediaEventTypes = [
  'abort',
  'canplay',
  'canplaythrough',
  'durationchange',
  'emptied',
  'ended',
  'error',
  'loadeddata',
  'loadedmetadata',
  'loadstart',
  'pause',
  'play',
  'playing',
  'progress',
  'ratechange',
  'readystatechange',
  'seeked',
  'seeking',
  'stalled',
  'suspend',
  'timeupdate',
  'volumechange',
  'waiting'
]

@eventable
export default class VideoProvider {
  @undisposed
  get media () {
    return this.media_
  }

  constructor (video) {
    check(video, 'video').isElement().got('tagName').among('video', 'VIDEO')

    video.setAttribute('webkit-playsinline', 'true') // iOS 10-
    video.setAttribute('playsinline', 'true') // iOS 10+

    this.updateThrottle_ = new Throttle(MAX_UPDATE_RATE)
    this.media_ = video

		// 绑定 video 事件
    this.mediaEventOffs_ = mediaEventTypes.map(type => {
      const callback = evt => this.trigger({
        type: `media-${type}`,
        domEvent: evt
      })

      video.addEventListener(type, callback)
      return _ => video.removeEventListener(type, callback)
    })
  }

  dispose () {
    this.detachMedia()
    this.updateThrottle_ = null
    super.dispose()
  }

  @undisposed
  updateTexture (texture) {
    const video = this.media_

    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      return false
    }

    if (!this.updateThrottle_.shouldRun) {
			// 限制帧率
      return false
    }

    if (!texture.direct) {
      const canvas = texture.frameCanvas
      const ctx = texture.frameCanvas.getContext('2d')

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    }

    return true
  }

  // private

  detachMedia () {
    this.mediaEventOffs_.forEach(fn => fn())
    this.media_ = null
  }
}