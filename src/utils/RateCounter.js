/**
 * 频率计数器
 *
 * @author yusangeng@outlook.com
 */

import { mix } from 'mix-with'
import Disposable from 'refra/lib/mixin/Disposable'
import undisposed from 'refra/lib/decorator/undisposed'


const RATE_CHECK_INTERVAL = 1000

export default class RateCounter extends mix().with(Disposable) {
  @undisposed
  get rate() {
    return this.rateValue_
  }

  constructor() {
    super()

    this.rateValue_ = 0
    this.counter_ = 0

    const interval = RATE_CHECK_INTERVAL

    this.timer_ = setInterval(_ => {
      this.rateValue_ = this.counter_ * 1000 / interval
      this.counter_ = 0
    }, interval)
  }

  dispose() {
    clearInterval(this.timer_)
    super.dispose()
  }

  @undisposed
  increment() {
    this.counter_++
  }
}
