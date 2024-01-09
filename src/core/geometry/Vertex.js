/**
 * 几何顶点
 *
 * @author yusangeng@outlook.com
 */

import validate from 'io-validate'
import isArray from 'lodash/isArray'

export default class Vertex {
  constructor(x, y, z) {
    validate(x, 'x').is('array', 'number')
    validate(y, 'y').is('number', 'undefined')
    validate(z, 'z').is('number', 'undefined')

    var components = isArray(x) ? x.slice() : [x, y, z]

    this.x = components[0]
    this.y = components[1]
    this.z = components[2]
    this.xyz = components
  }

  // 复制
  clone() {
    const { x, y, z } = this
    return new Vertex(x, y, z)
  }
}
