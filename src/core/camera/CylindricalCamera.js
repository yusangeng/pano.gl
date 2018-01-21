/**
 * 圆柱广角摄像机
 *
 * @author Y3G
 */

import check from 'param-check'
import undisposed from 'litchy/lib/decorator/undisposed'
import Camera from './Camera'
import OrthoCamera from './OrthoCamera'
import Polygon from '../geometry/Polygon'
import projectionType from './projectionType'

const CYNLINDRICAL_CAMERA_WITH = 4
const CYNLINDRICAL_CAMERA_HEGHT = 1

const w = CYNLINDRICAL_CAMERA_WITH
const h = CYNLINDRICAL_CAMERA_HEGHT
const z = w / 2
const y = h / 2

const geoVertexes = (new Polygon([
  [1, y, z],
  [1, y, -z],
  [1, -y, -z],
  [1, -y, z]
])).mesh()

export default class CylindricalCamera extends Camera {
  // 配合使用的顶点集
  @undisposed
  get geoVertexes () {
    return geoVertexes
  }

  // point of view 纬度，单位为度
  @undisposed
  get povLatitude () {
    return this.povLatitude_
  }

  @undisposed
  set povLatitude (lat) {
    check(lat, 'lat').isNumber()
    this.povLatitude_ = lat
  }

  // point of view 经度，单位为度
  @undisposed
  get povLongitude () {
    return this.povLongitude_
  }

  @undisposed
  set povLongitude (long) {
    check(long, 'long').isNumber()
    this.povLongitude_ = long
  }

  constructor ({ povLatitude = 0, povLongitude = 0, debug = false }) {
    super(projectionType.PROJECTION_CYNLINDRICAL, debug)

    check(povLatitude, 'povLatitude').isNumber()
    check(povLongitude, 'povLongitude').isNumber()

    const m = Math.max(y, z)

    this.ortho_ = new OrthoCamera({
      left: -m,
      right: m,
      top: m,
      bottom: -m,
      povLongitude: 0,
      povLatitude: 0
    })

    this.povLatitude = povLatitude
    this.povLongitude = povLongitude
  }

  @undisposed
  rotate (angleX) {
    check(angleX, 'angleX').isNumber()
    // check(angleY, 'angleY').isNumber()

    this.povLongitude += angleX
    // this.povLatitude += angleY
  }

  @undisposed
  zoom (delta) {
    //return this.ortho_.zoom(delta)
  }

  @undisposed
  status () {
    const ret = this.ortho_.status()

    ret.CamProjType = {
      type: 'uniform1i',
      value: this.projection
    }

    ret.CamGeoWidth = {
      type: 'uniform1f',
      value: CYNLINDRICAL_CAMERA_WITH
    }

    ret.CamGeoHeight = {
      type: 'uniform1f',
      value: CYNLINDRICAL_CAMERA_HEGHT
    }

    ret.CamPOVLongitude = {
      type: 'uniform1f',
      value: this.povLongitude
    }

    ret.CamPOVLatitude = {
      type: 'uniform1f',
      value: this.povLatitude
    }

    return ret
  }
}
