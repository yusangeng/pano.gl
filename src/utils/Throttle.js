/**
 * 频率限制器
 *
 * @author Y3G
 */

import check from 'param-check'
import disposable from 'litchy/lib/decorator/disposable'
import undisposed from 'litchy/lib/decorator/undisposed'

@disposable
export default class Throttle {
  @undisposed
  get shouldRun () {
    const now = (new Date()).getTime()
    const ret = now - this.lastTime_ >= this.limit_

    if (ret) {
      this.lastTime_ = now
    }

    return ret
  }

  constructor (limit) {
    check(limit, 'limit').gt(0)

    this.lastTime_ = 0
    this.limit_ = 1000 / limit
  }
}

