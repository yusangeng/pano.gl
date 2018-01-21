/**
 * 摄影摄像机
 *
 * @author Y3G
 */

import mix from 'litchy/lib/mix'
import Camera from './Camera'
import Projection from './LinearProjection'
import Trans from './PerspectiveTrans'
import projectionType from './projectionType'

export default class PerspectiveCamera extends mix(Camera).with(Projection, Trans) {
  constructor ({ fov, aspect, povLatitude = 0, povLongitude = 0, debug = false }) {
    super(projectionType.PROJECTION_LINEAR, debug)

    this.initModel(povLatitude, povLongitude)
    this.updateConstitutive({ fov, aspect })
  }
}
