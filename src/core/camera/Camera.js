/**
 * 摄像机基类
 *
 * @author Y3G
 */

import disposable from 'litchy/lib/decorator/disposable'
import undisposed from 'litchy/lib/decorator/undisposed'
import hasid from 'litchy/lib/decorator/hasid'

@hasid
@disposable
export default class Camera {
  @undisposed
  get debug () {
    return this.debug_
  }

  @undisposed
  set debug (value) {
    this.debug_ = !!value
  }

  @undisposed
  get dirty () {
    return this.dirty_
  }

  @undisposed
  set dirty (value) {
    this.dirty_ = !!value
  }

  @undisposed
  get projection () {
    return this.projection_
  }

  @undisposed
  get geoVertexes () {
    return []
  }

  constructor (projection, debug = false) {
    this.debug = debug
    this.dirty = true
    this.projection_ = projection
  }

  @undisposed
  status () {
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

  updateStatus () {
  }
}
