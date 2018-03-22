/**
 * 频率计数器
 *
 * @author Y3G
 */

import disposable from 'litchy/lib/decorator/disposable'
import undisposed from 'litchy/lib/decorator/undisposed'

const RATE_CHECK_INTERVAL = 1000

@disposable
export default class RateCounter {
  @undisposed
  get rate () {
    return this.rateValue_
  }

  constructor () {
    this.rateValue_ = 0
    this.counter_ = 0

    const interval = RATE_CHECK_INTERVAL

    this.timer_ = setInterval(_ => {
      this.rateValue_ = this.counter_ * 1000 / interval
      this.counter_ = 0
    }, interval)
  }

  dispose () {
    clearInterval(this.timer_)
    super.dispose()
  }

  @undisposed
  increment () {
    this.counter_++
  }
}
