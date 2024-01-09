/**
 * zoom插件
 *
 * @author yusangeng@outlook.com
 */

/* global Event */

export default class ZoomPlugin {
  get eventType() {
    return 'zoom'
  }

  get delegate() {
    return this.delegate_
  }

  get selector() {
    return this.selector_
  }

  get status() {
    return this.status_
  }

  constructor(delegate, selector) {
    this.delegate_ = delegate
    this.selector_ = selector
    this.offs_ = []
    this.status_ = {}
  }

  recognize() {
    const { delegate, selector } = this

    this.offs_.push(delegate.on$('mousewheel', selector, this.onMouseWheel.bind(this)))
    this.offs_.push(delegate.on$('touchstart', selector, this.onTouchStart.bind(this)))
    this.offs_.push(delegate.on$('touchmove', selector, this.onTouchMove.bind(this)))
    this.offs_.push(delegate.on$('touchend', selector, this.onTouchEnd.bind(this)))
    this.offs_.push(delegate.on$('touchcancel', selector, this.onTouchCancel.bind(this)))

    this.status.zooming = false
    this.status.target = null
  }

  unrecognize() {
    this.status.zooming = false
    this.status.target = null

    this.offs_.forEach(fn => fn())
    this.offs_ = []
  }

  onMouseWheel(evt) {
    const newEvt = new Event('zoom', {
      bubbles: true
    })

    newEvt.delta = evt.deltaY * 50
    evt.target.dispatchEvent(newEvt)

    evt.stopPropagation()
    evt.preventDefault()
  }

  onTouchStart(evt) {
    const touches = evt.targetTouches

    if (touches.length !== 2) {
      this.status.zooming = false
      return
    }

    this.status.zooming = true

    this.status.x0 = touches[0].clientX
    this.status.y0 = touches[0].clientY
    this.status.x1 = touches[1].clientX
    this.status.y1 = touches[1].clientY

    this.status.target = evt.target
    evt.preventDefault()
  }

  onTouchMove(evt) {
    const touches = evt.targetTouches

    if (touches.length !== 2) {
      this.status.zooming = false
      return
    }

    if (!this.status.zooming) {
      return
    }

    const target = evt.target

    if (target !== this.status.target) {
      return
    }

    const x0 = touches[0].clientX
    const y0 = touches[0].clientY
    const x1 = touches[1].clientX
    const y1 = touches[1].clientY
    const distX = x1 - x0
    const distY = y1 - y0
    const distance = Math.sqrt(distX * distX + distY * distY)

    const lastX0 = this.status.x0
    const lastY0 = this.status.y0
    const lastX1 = this.status.x1
    const lastY1 = this.status.y1
    const lastDistX = lastX1 - lastX0
    const lastDistY = lastY1 - lastY0
    const lastDistance = Math.sqrt(lastDistX * lastDistX + lastDistY * lastDistY)

    const newEvt = new Event('zoom', {
      bubbles: true
    })

    newEvt.distance = distance
    newEvt.lastDistance = lastDistance
    newEvt.delta = -(distance - lastDistance) * 50
    target.dispatchEvent(newEvt)

    this.status.x0 = x0
    this.status.y0 = y0
    this.status.x1 = x1
    this.status.y1 = y1

    evt.preventDefault()
  }

  onTouchEnd(evt) {
    this.status.zooming = false
    this.status.target = null
    evt.preventDefault()
  }

  onTouchCancel(evt) {
    this.status.zooming = false
    this.status.target = null
    evt.preventDefault()
  }
}
