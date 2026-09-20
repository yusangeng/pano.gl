/**
 * 正交摄像机
 *
 * @author Y3G
 */

import mix from 'litchy/lib/mix'
import Camera from './Camera'
import Projection from './LinearProjection'
import Trans from './OrthoTrans'
import projectionType from './projectionType'

export default class OrthoCamera extends mix(Camera).with(Projection, Trans) {
  constructor ({ left, right, top, bottom, povLatitude = 0, povLongitude = 0, debug = false }) {
    super(projectionType.PROJECTION_LINEAR, debug)

    this.initModel(povLatitude, povLongitude)
    this.updateConstitutive({ left, right, top, bottom })
  }
}
