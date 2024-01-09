/**
 * 渲染驱动器
 *
 * @author yusangeng@outlook.com
 */

import { mix } from 'mix-with'
import Eventable from 'refra/lib/mixin/Eventable'
import undisposed from 'refra/lib/decorator/undisposed'
import RateCounter from '../utils/RateCounter'
import requestAnimationFrame from '../utils/requestAnimationFrame'
import cancelAnimationFrame from '../utils/cancelAnimationFrame'
export default class FrameDriver extends mix().with(Eventable) {
  @undisposed
  get frameRate() {
    return this.frameRateCounter_.rate
  }

  constructor() {
    super()

    this.pause_ = false
    this.requestId_ = null
    this.frameRateCounter_ = new RateCounter()
  }

  dispose() {
    if (this.requestId_ !== null) {
      cancelAnimationFrame(this.requestId_)
      this.requestId_ = null
    }

    super.dispose()
  }

  @undisposed
  start() {
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
  pause() {
    this.pause_ = true
    return this
  }
}
