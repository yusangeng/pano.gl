/**
 * 几何顶点
 *
 * @author Y3G
 */

import check from 'param-check'
import isArray from 'lodash/isArray'

export default class Vertex {
  constructor (x, y, z) {
    check(x, 'x').is('array', 'number')
    check(y, 'y').is('number', 'undefined')
    check(z, 'z').is('number', 'undefined')

    var components = isArray(x) ? x.slice() : [x, y, z]

    this.x = components[0]
    this.y = components[1]
    this.z = components[2]
    this.xyz = components
  }

  // 复制
  clone () {
    const { x, y, z } = this
    return new Vertex(x, y, z)
  }
}
