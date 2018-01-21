/**
 * 球壳
 *
 * @author Y3G
 */

import isArray from 'lodash/isArray'
import check from 'param-check'
import mix from 'litchy/lib/mix'
import Polygon from './Polygon'
import Geometry from './Geometry'
import Vertex from './Vertex'

const MESH_COUNT = 40
const PI = 3.1415926535897932384626433832795
const TWO_PI = 6.283185307179586476925286766559
const HALF_PI = 1.5707963267948966192313216916398

const { sin, cos } = Math

function genVerexes (radius, center) {
  const thetaCount = MESH_COUNT // 水平分割数
  const phiCount = MESH_COUNT  // 垂直分割数，包含上下两顶点

  const thetaStep = TWO_PI / thetaCount
  const phiStep = PI / (phiCount - 1)
  let vertexes = []

  for (let i = 0; i < phiCount; ++i) {
    const phi = phiStep * i - HALF_PI

    if (i === 0) {
      vertexes.push([0, -radius, 0])
      continue
    }

    if (i === phiCount - 1) {
      vertexes.push([0, radius, 0])
      continue
    }

    const layerRadius = radius * cos(phi)
    const layerY = radius * sin(phi)

    for (let j = 0; j < thetaCount; ++j) {
      const theta = thetaStep * j
      vertexes.push([layerRadius * cos(theta),
        layerY, layerRadius * sin(theta)
      ])
    }
  }

  vertexes = vertexes.map(vertex => [
    vertex[0] + center.x,
    vertex[1] + center.y,
    vertex[2] + center.z
  ])

  return vertexes
}

function genPlanes (vertexes) {
  const thetaCount = MESH_COUNT // 水平分割数
  const phiCount = MESH_COUNT  // 垂直分割数，包含上下两顶点
  const vts = vertexes
  const planes = []

  function computeLayerOffset (layer) {
    if (layer === 0) return 0
    return (layer - 1) * thetaCount + 1
  }

  for (let i = 0; i < phiCount - 1; ++i) {
    const layer = i
    const layerOffset = computeLayerOffset(i)
    const nextLayerOffset = computeLayerOffset(i + 1)

    if (layer === 0) {
      const vtx0 = vts[0]

      for (let j = 0; j < thetaCount - 1; ++j) {
        planes.push(new Polygon([vtx0, vts[nextLayerOffset + j], vts[nextLayerOffset + j + 1]]))
      }

      planes.push(new Polygon([vtx0, vts[nextLayerOffset + thetaCount - 1], vts[nextLayerOffset]]))

      continue
    }

    if (layer === phiCount - 2) {
      const vtxLast = vts[nextLayerOffset + 0]

      for (let j = 0; j < thetaCount - 1; ++j) {
        planes.push(new Polygon([vtxLast, vts[layerOffset + j], vts[layerOffset + j + 1]]))
      }

      planes.push(new Polygon([vtxLast, vts[layerOffset + thetaCount - 1], vts[layerOffset]]))

      continue
    }

    for (let j = 0; j < thetaCount; ++j) {
      planes.push(new Polygon([vts[layerOffset + j], vts[layerOffset + j + 1],
        vts[nextLayerOffset + j + 1], vts[nextLayerOffset + j]
      ]))
    }

    planes.push(new Polygon([vts[layerOffset + thetaCount - 1], vts[layerOffset],
      vts[nextLayerOffset], vts[nextLayerOffset + +thetaCount - 1]
    ]))
  }

  return planes
}

const Mesher = superclass => class Mesher extends superclass {
  mesh () {
    const flattens = genPlanes(this.vertexes).map(el => el.mesh())

    // FIXME: 性能太差
    const ret = []
    flattens.forEach(flatten => flatten.forEach(el => ret.push(el)))

    return ret
  }
}

export default class Sphere extends mix().with(Geometry, Mesher) {
  get center () {
    return this.center_
  }

  get radius () {
    return this.radius_
  }

  constructor (radius, centerX, centerY, centerZ) {
    super()

    check(radius, 'radius').gt(0)

    let center

    if (centerX instanceof Vertex) {
      center = centerX.clone()
    } else if (isArray(centerX)) {
      center = new Vertex(centerX)
    } else {
      center = new Vertex(centerX, centerY, centerZ)
    }

    this.center_ = center
    this.radius_ = radius

    this.initGeometry(genVerexes(radius, center))
  }
}
