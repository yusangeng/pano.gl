/**
 * 频率限制器
 *
 * @author yusangeng@outlook.com
 */

import { mix } from 'mix-with'
import validate from 'io-validate'
import Disposable from 'refra/lib/mixin/Disposable'
import undisposed from 'refra/lib/decorator/undisposed'

export default class Throttle extends mix().with(Disposable) {
  @undisposed
  get shouldRun() {
    const now = (new Date()).getTime()
    const ret = now - this.lastTime_ >= this.limit_

    if (ret) {
      this.lastTime_ = now
    }

    return ret
  }

  constructor(limit) {
    super()

    validate(limit, 'limit').gt(0)

    this.lastTime_ = 0
    this.limit_ = 1000 / limit
  }
}

