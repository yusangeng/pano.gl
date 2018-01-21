/**
 * 渲染驱动器
 *
 * @author Y3G
 */

import eventable from 'litchy/lib/decorator/eventable'
import undisposed from 'litchy/lib/decorator/undisposed'
import RateCounter from '../utils/RateCounter'
import requestAnimationFrame from '../utils/requestAnimationFrame'
import cancelAnimationFrame from '../utils/cancelAnimationFrame'

@eventable
export default class FrameDriver {
  @undisposed
  get frameRate () {
    return this.frameRateCounter_.rate
  }

  constructor () {
    this.pause_ = false
    this.requestId_ = null
    this.frameRateCounter_ = new RateCounter()
  }

  dispose () {
    if (this.requestId_ !== null) {
      cancelAnimationFrame(this.requestId_)
      this.requestId_ = null
    }

    super.dispose()
  }

  @undisposed
  start () {
    if (this.requestId_ !== null) {
      return this
    }

    this.pause_ = false

    const step = _ => {
      if (!this.pause_) {
        this.trigger('frame')
        this.frameRateCounter_.increment()
      }

      this.requestId_ = requestAnimationFrame(step)
    }

    this.requestId_ = requestAnimationFrame(step)

    return this
  }

  @undisposed
  pause () {
    this.pause_ = true
    return this
  }
}
