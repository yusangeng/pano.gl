/**
 * 小行星广角摄像机
 *
 * @author Y3G
 */

import check from 'param-check'
import undisposed from 'litchy/lib/decorator/undisposed'
import Camera from './Camera'
import OrthoCamera from './OrthoCamera'
import Polygon from '../geometry/Polygon'
import projectionType from './projectionType'
import clamp from '../../utils/clamp'

const CAMERA_WIDTH = 4
const CAMERA_HEIGHT = 4

const geoVertexes = (function () {
  var z2 = CAMERA_WIDTH / 2
  var y2 = CAMERA_HEIGHT / 2
  return (new Polygon([
    [1, y2, z2],
    [1, y2, -z2],
    [1, -y2, -z2],
    [1, -y2, z2]
  ])).mesh()
})()

export default class PlanetCamera extends Camera {
  // 配合使用的顶点集
  @undisposed
  get geoVertexes () {
    return geoVertexes
  }

  // point of view 纬度
  @undisposed
  get povLatitude () {
    return this.povLatitude_
  }

  @undisposed
  set povLatitude (lat) {
    check(lat, 'lat').isNumber()
    this.povLatitude_ = lat
  }

  // point of view 经度
  @undisposed
  get povLongitude () {
    return this.povLongitude_
  }

  @undisposed
  set povLongitude (long) {
    check(long, 'long').isNumber()
    this.povLongitude_ = long % 25
  }

  // 放大系数
  @undisposed
  get zoomValue() {
    return this.zoomValue_
  }

  @undisposed
  set zoomValue(value) {
    check(value, 'value').isNumber()
    this.zoomValue_ = clamp(value, 0.1, 1)
  }

  constructor ({ povLatitude = 0, povLongitude = 0, zoom = 1, debug = false }) {
    super(projectionType.PROJECTION_PLANET, debug)

    check(povLatitude, 'povLatitude').isNumber()
    check(povLongitude, 'povLongitude').isNumber()
    check(zoom, 'zoom').isNumber()

    const m = Math.max(CAMERA_WIDTH / 2, CAMERA_HEIGHT / 2)

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
    this.zoomValue = zoom
  }

  @undisposed
  rotate (angleX, angleY) {
    check(angleX, 'angleX').isNumber()
    check(angleY, 'angleY').isNumber()

    this.povLongitude += angleX
    this.povLatitude += angleY
  }

  @undisposed
  zoom (delta) {
    this.zoomValue += delta / 20
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
      value: CAMERA_WIDTH
    }

    ret.CamGeoHeight = {
      type: 'uniform1f',
      value: CAMERA_HEIGHT
    }

    ret.CamPOVLongitude = {
      type: 'uniform1f',
      value: this.povLongitude
    }

    ret.CamPOVLatitude = {
      type: 'uniform1f',
      value: this.povLatitude
    }

    ret.CamZoom = {
      type: 'uniform1f',
      value: this.zoomValue
    }

    return ret
  }
}
