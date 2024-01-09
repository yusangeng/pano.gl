/**
 * 摄像机基类
 *
 * @author yusangeng@outlook.com
 */

import { mix } from 'mix-with'
import Disposable from 'refra/lib/mixin/Disposable'
import undisposed from 'refra/lib/decorator/undisposed'
import HasId from '../../utils/HasId'

export default class Camera extends mix().with(Disposable, HasId) {
  @undisposed
  get debug() {
    return this.debug_
  }

  @undisposed
  set debug(value) {
    this.debug_ = !!value
  }

  @undisposed
  get dirty() {
    return this.dirty_
  }

  @undisposed
  set dirty(value) {
    this.dirty_ = !!value
  }

  @undisposed
  get projection() {
    return this.projection_
  }

  @undisposed
  get geoVertexes() {
    return []
  }

  constructor(projection, debug = false) {
    super()

    this.initId()

    this.debug = debug
    this.dirty = true
    this.projection_ = projection
  }

  @undisposed
  status() {
    if (this.dirty) {
      this.updateStatus()
      this.dirty = false
    }

    return {
      CamProjType: {
        type: 'uniform1i',
        value: this.projection
      }
    }
  }

  // private

  updateStatus() {
  }
}
