/**
 * 摄像机创建器
 *
 * @author Y3G
 */

import merge from 'lodash/merge'
import PerspectiveCamera from './core/camera/PerspectiveCamera'
import OrthoCamera from './core/camera/OrthoCamera'
import CylindricalCamera from './core/camera/CylindricalCamera'
import PlanetCamera from './core/camera/PlanetCamera'

const cameraMap = {
  perspective: PerspectiveCamera,
  ortho: OrthoCamera,
  cylindrical: CylindricalCamera,
  planet: PlanetCamera
}

const defaultDataMap = {
  perspective: {
    fov: 70,
    aspect: 1
  },

  ortho: {
    left: -1,
    right: 1,
    top: 1,
    bottom: -1
  },

  cylindrical: {},
  planet: {}
}

function create ({ type, data }) {
  const CameraClass = cameraMap[type]

  if (!CameraClass) {
    throw new TypeError(`Can NOT find camera class: ${type}.`)
  }

  return new CameraClass(merge({}, defaultDataMap[type], data))
}

export default superclass => class c extends superclass {
  createCamera (options = {}) {
    const el = this.el

    const defaultOptions = {
      type: 'perspective',
      data: {
        fov: 70,
        aspect: el.clientWidth / el.clientHeight
      }
    }

    const opt = options || defaultOptions

    return create(opt)
  }
}