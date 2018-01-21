/**
 * 平面(多边形)
 *
 * @author Y3G
 */

import mix from 'litchy/lib/mix'
import Geometry from './Geometry'

const Mesher = superclass => class Mesher extends superclass {
  mesh () {
    const vertexes = this.vertexes
    const len = vertexes.length

    if (len === 3) {
      return this.flatten()
    }

    const triangleVertexes = []
    const end = len - 1

    for (let i = 1; i < end; ++i) {
      triangleVertexes.push(vertexes[0])
      triangleVertexes.push(vertexes[i])
      triangleVertexes.push(vertexes[i + 1])
    }

    return triangleVertexes.map(el => el.xyz).reduce((prev, el) => prev.concat(el), [])
  }
}

export default class Polygon extends mix().with(Geometry, Mesher) {
  constructor (vertexes) {
    super()
    this.initGeometry(vertexes)
  }
}
