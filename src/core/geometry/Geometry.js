/**
 * 几何形状
 *
 * @author yusangeng@outlook.com
 */

import validate from 'io-validate'
import isArray from 'lodash/isArray'
import Vertex from './Vertex'

export default superclass => class extends superclass {
  get vertexes() {
    return this.vertexes_
  }

  constructor(...params) {
    super(...params)
    this.vertexes_ = []
  }

  initGeometry(vertexes) {
    // 至少三个点
    validate(vertexes, 'vertexes').isArray().length().gt(2)

    const vts = vertexes

    this.vertexes_ = vts.map(el => {
      if (isArray(el)) {
        return new Vertex(el)
      }

      validate(el, 'vertex').instanceOf(Vertex)
      return el.clone()
    })
  }

  // 获取顶点坐标数组
  flatten() {
    return this.vertexes_.map(el => el.xyz).reduce((prev, el) => {
      return prev.concat(el)
    }, [])
  }
}
