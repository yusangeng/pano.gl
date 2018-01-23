/**
 * 线性投影模型
 *
 * @author Y3G
 */

import Logger from 'chivy'
import check from 'param-check'
import undisposed from 'litchy/lib/decorator/undisposed'
import Sphere from '../geometry/Sphere'
import clamp from '../../utils/clamp'
import { Matrix4 } from '../../../vendor/cuon'

const { sin, cos } = Math
const { assign } = Object

const log = new Logger('pano.gl/core/LinearProjection')

const SPHERE_READIUS = 1
const DEBUG_CAMERA_DISTANCE = 10


const time = (new Date()).getTime()
log.info(`Sphere generating...`)
const geoVertexes = (new Sphere(SPHERE_READIUS, 0, 0, 0)).mesh()
log.info(`Sphere generated, time: ${(new Date()).getTime() - time} ms.`)

export default superclass => class LinearProjection extends superclass {
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

    var phi = clamp(lat % 360, -90, 90)

    this.povLatitude_ = phi
    this.dirty = true
  }

  // point of view 经度，单位为度
  @undisposed
  get povLongitude () {
    return this.povLongitude_
  }

  @undisposed
  set povLongitude (long) {
    check(long, 'long').isNumber()
    
    let theta = long % 360

    if (theta < 0) {
      theta = 360 + theta
    }

    this.povLongitude_ = theta
    this.dirty = true
  }

  @undisposed
  get projectionMatrix() {
    return this.projectionMat_
  }

  initModel (povLatitude = 0, povLongitude = 0) {
    check(povLatitude, 'povLatitude').isNumber()
    check(povLongitude, 'povLongitude').isNumber()

    this.transMat_ = new Matrix4() // 顶点变换矩阵
    this.projectionMat_ = new Matrix4() // 投影矩阵
    this.viewMat_ = new Matrix4() // 观察矩阵(lookAt)

    this.povLatitude = povLatitude
    this.povLongitude = povLongitude
  }

  // 镜头旋转，angleX、angleY 分别为要旋转的经纬角度
  @undisposed
  rotate (angleX, angleY) {
    check(angleX, 'angleX').isNumber()
    check(angleY, 'angleY').isNumber()

    this.povLongitude += angleX
    this.povLatitude += angleY
  }

  @undisposed
  status () {
    return assign(super.status(), {
      CamTransMatrix: {
        type: 'uniformMatrix4fv',
        value: (new Matrix4(this.transMat_)).elements,
        extraParams: {}
      }
    })
  }

  updateStatus () {
    super.updateStatus()
    this.updateMatrix()
  }

  updateMatrix () {
    // 转换为弧度
    const theta = this.povLongitude * Math.PI / 180
    const phi = this.povLatitude * Math.PI / 180
    const dist = DEBUG_CAMERA_DISTANCE

    if (this.debug) {
      this.viewMat_.setLookAt(
        dist * cos(phi) * cos(theta),
        dist * sin(phi),
        dist * -cos(phi) * sin(theta),
        0, 0, 0,
        0, 1, 0)
    } else {
      this.viewMat_.setLookAt(
        0, 0, 0,
        cos(phi) * cos(theta),
        sin(phi),
        -cos(phi) * sin(theta),
        0, 1, 0)
    }

    this.transMat_ = (new Matrix4(this.projectionMat_)).multiply(this.viewMat_)
  }
}
