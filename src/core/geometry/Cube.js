/**
 * 立方体
 *
 * @author Y3G
 */

import isArray from 'lodash/isArray'
import check from 'param-check'
import mix from 'litchy/lib/mix'
import Geometry from './Geometry'
import Vertex from './Vertex'
import Polygon from './Polygon'

function genVerexes (sideLen, center) {
  var len = sideLen / 2

  var vertexes = [
      [-len, -len, len], [len, -len, len], [len, len, len], [-len, len, len],
      [-len, -len, -len], [len, -len, -len], [len, len, -len], [-len, len, -len]
  ].map(vertex => {
    return [vertex[0] + center.x, vertex[1] + center.y, vertex[2] + center.z]
  })

  return vertexes
}

function genPlanes (vertexes) {
  const vts = vertexes
  const makePolygon = (index1, index2, index3, index4) => {
    return new Polygon([vts[index1], vts[index2], vts[index3], vts[index4]])
  }

  return [
    makePolygon(0, 1, 2, 3),
    makePolygon(1, 5, 6, 2),
    makePolygon(2, 6, 7, 3),
    makePolygon(3, 7, 4, 0),
    makePolygon(0, 4, 5, 1),
    makePolygon(4, 5, 6, 7)
  ]
}

const Mesher = superclass => class Mesher extends superclass {
  mesh () {
    return genPlanes(this.vertexes)
      .map(el => el.mesh())
      .reduce((prev, triangles) => prev.concat(triangles), [])
  }
}

export default class Cube extends mix().with(Geometry, Mesher) {
  get center () {
    return this.center_
  }

  get sideLen () {
    return this.sideLen_
  }

  constructor (sideLen, centerX, centerY, centerZ) {
    super()

    check(sideLen, 'sideLen').gt(0)

    let center

    if (centerX instanceof Vertex) {
      center = centerX.clone()
    } else if (isArray(centerX)) {
      center = new Vertex(centerX)
    } else {
      center = new Vertex(centerX, centerY, centerZ)
    }

    this.center_ = center
    this.sideLen_ = sideLen

    this.initGeometry(genVerexes(sideLen, center))
  }
}
