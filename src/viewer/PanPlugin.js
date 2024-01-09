/**
 * pan插件
 *
 * @author yusangeng@outlook.com
 */

/* global Event */

export default class ZoomPlugin {
  get eventType() {
    return 'pan'
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

    this.offs_.push(delegate.on$('mousedown', selector, this.onMouseDown.bind(this)))
    this.offs_.push(delegate.on$('mousemove', selector, this.onMouseMove.bind(this)))
    this.offs_.push(delegate.on$('mouseup', selector, this.onMouseUp.bind(this)))
    this.offs_.push(delegate.on$('touchstart', selector, this.onTouchStart.bind(this)))
    this.offs_.push(delegate.on$('touchmove', selector, this.onTouchMove.bind(this)))
    this.offs_.push(delegate.on$('touchend', selector, this.onTouchEnd.bind(this)))
    this.offs_.push(delegate.on$('touchcancel', selector, this.onTouchCancel.bind(this)))

    this.status.panning = false
    this.status.target = null
  }

  unrecognize() {
    this.status.panning = false
    this.status.target = null

    this.offs_.forEach(fn => fn())
    this.offs_ = []
  }

  onMouseDown(evt) {
    this.start(evt, evt.target)
    evt.preventDefault()
  }

  onMouseMove(evt) {
    if (!this.status.panning) {
      return
    }

    const { target } = evt

    if (target !== this.status.target) {
      return
    }

    this.move(evt, target)
    evt.preventDefault()
  }

  onMouseUp(evt) {
    this.stop()
    evt.preventDefault()
  }

  onTouchStart(evt) {
    const { target, touches } = evt

    if (touches.length !== 1) {
      this.stop()
      return
    }

    this.start(touches[0], target)
    evt.preventDefault()
  }

  onTouchMove(evt) {
    if (!this.status.panning) {
      return
    }

    const { target, touches } = evt

    if (target !== this.status.target) {
      return
    }

    this.move(touches[0], target)
    evt.preventDefault()
  }

  onTouchEnd(evt) {
    this.stop()
    evt.preventDefault()
  }

  onTouchCancel(evt) {
    this.stop()
    evt.preventDefault()
  }

  start(pos, target) {
    this.status.panning = true
    this.status.x = pos.clientX
    this.status.y = pos.clientY
    this.status.target = target
  }

  stop() {
    this.status.panning = false
    this.status.target = null
  }

  move(pos, target) {
    var newEvt = new Event('pan', {
      bubbles: true
    })

    newEvt.deltaX = pos.clientX - this.status.x
    newEvt.deltaY = pos.clientY - this.status.y
    target.dispatchEvent(newEvt)

    this.status.x = pos.clientX
    this.status.y = pos.clientY
  }
}
