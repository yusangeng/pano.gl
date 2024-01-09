/**
 * 查看器(包含渲染和PTZ)
 * 
 * @author yusangeng@outlook.com
 */

import { mix } from 'mix-with'
import validate from 'io-validate'
import Delegate from 'dodele/lib/Delegate'
import undisposed from 'refra/lib/decorator/undisposed'
import callback from 'dodele/lib/decorator/callback'
import Eventable from 'refra/lib/mixin/Eventable'
import selectorToElement from '../utils/selectorToElement'
import RenderFlow from '../core/RenderFlow'
import ZoomPlugin from './ZoomPlugin'
import PanPlugin from './PanPlugin'

const ViewerBase = mix().with(Eventable, Delegate, RenderFlow)

export default class Viewer extends ViewerBase {
  @undisposed
  get PTZ() {
    return this.ptz_
  }

  @undisposed
  set PTZ(value) {
    this.ptz_ = !!value
  }

  constructor(el) {
    super()

    this.PTZ = true

    const realEl = selectorToElement(el)
    validate(realEl, 'realEl').isElement()

    this.initRenderFlow(realEl)

    this.installPlugin(new ZoomPlugin(this, `#${this.frameId}`))
    this.installPlugin(new PanPlugin(this, `#${this.frameId}`))

    this.initDecoratedDelegate(realEl)
  }

  dispose() {
    super.dispose()
  }

  @callback('zoom', '.renderer-canvas')
  onZoom(evt) {
    if (!this.PTZ) {
      return
    }

    const w = this.frameWidth
    const h = this.frameHeight
    var maxDistance = Math.sqrt(w * w + h * h)

    this.zoom(evt.delta / maxDistance)
  }

  @callback('pan', '.renderer-canvas')
  onPan(evt) {
    if (!this.PTZ) {
      return
    }

    this.rotate(evt.deltaX * 90 / this.frameWidth,
      evt.deltaY * 90 / this.frameHeight)
  }

}
