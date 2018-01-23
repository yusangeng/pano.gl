/**
 * 正交变换模型
 *
 * @author Y3G
 */

import check from 'param-check'
import undisposed from 'litchy/lib/decorator/undisposed'
import clamp from '../../utils/clamp'

export default superclass => class OrthoTrans extends superclass {
  @undisposed
  get left () {
    return this.left_
  }

  @undisposed
  set left (newVal) {
    check(newVal, 'newVal').isNumber()

    this.updateConstitutive({
      left: newVal,
      right: this.right_,
      top: this.top_,
      bottom: this.bottom_
    })
  }

  @undisposed
  get right () {
    return this.right_
  }

  @undisposed
  set right (newVal) {
    check(newVal, 'newVal').isNumber()

    this.updateConstitutive({
      left: this.left_,
      right: newVal,
      top: this.top_,
      bottom: this.bottom_
    })
  }

  @undisposed
  get top () {
    return this.top_
  }

  @undisposed
  set top (newVal) {
    check(newVal, 'newVal').isNumber()

    this.updateConstitutive({
      left: this.left_,
      right: this.right_,
      top: newVal,
      bottom: this.bottom_
    })
  }

  @undisposed
  get bottom () {
    return this.bottom_
  }

  @undisposed
  set bottom (newVal) {
    check(newVal, 'newVal').isNumber()
    
    this.updateConstitutive({
      left: this.left_,
      right: this.right_,
      top: this.top_,
      bottom: newVal
    })
  }

  @undisposed
  zoom (delta) {
    check(delta, 'delta').isNumber()

    const aspect = (this.right - this.left) / (this.bottom - this.top)
    const xd = delta / 5 // 分母调节缩放速度
    const yd = xd / aspect

    this.left -= xd
    this.right += xd
    this.top -= yd
    this.bottom += yd
  }

  updateConstitutive ({ left, right, top, bottom }) {
    check(left, 'left').isNumber()
    check(right, 'right').isNumber()
    check(top, 'top').isNumber()
    check(bottom, 'bottom').isNumber()

    const minMagic = 0.1
    const maxMagic = 1000

    left = clamp(left, -maxMagic, -minMagic)
    right = clamp(right, minMagic, maxMagic)
    top = clamp(top, minMagic, maxMagic)
    bottom = clamp(bottom, -maxMagic, -minMagic)

    this.projectionMatrix.setOrtho(left, right, bottom, top, 0.1, 1000)

    this.left_ = left
    this.right_ = right
    this.top_ = top
    this.bottom_ = bottom

    this.dirty_ = true
  }
}
