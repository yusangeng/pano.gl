/**
 * 摄影变换模型
 *
 * @author yusangeng@outlook.com
 */

import validate from 'io-validate'
import undisposed from 'refra/lib/decorator/undisposed'
import clamp from '../../utils/clamp'

export default superclass => class PerspectiveTrans extends superclass {
  @undisposed
  get fov() {
    return this.fov_
  }

  @undisposed
  set fov(newVal) {
    validate(newVal, 'newVal').isNumber()

    if (newVal <= 0) {
      return
    }

    this.updateConstitutive({
      fov: newVal,
      aspect: this.aspect
    })
  }

  @undisposed
  get aspect() {
    return this.aspect_
  }

  @undisposed
  set aspect(newVal) {
    validate(newVal, 'newVal').isNumber()

    if (newVal <= 0) {
      return
    }

    this.updateConstitutive({
      fov: this.fov,
      aspect: newVal
    })
  }

  // delta单位为度
  @undisposed
  zoom(delta) {
    validate(delta, 'delta').isNumber()
    this.fov += delta
  }

  updateConstitutive({ fov, aspect }) {
    validate(fov, 'fov').gt(0)
    validate(aspect, 'aspect').gt(0)

    const magicMax = 179.38
    const magicMin = 1.99

    fov = clamp(fov, magicMin, magicMax)
    this.projectionMatrix.setPerspective(fov, aspect, 0.1, 1000)

    this.fov_ = fov
    this.aspect_ = aspect

    this.dirty = true
  }
}
