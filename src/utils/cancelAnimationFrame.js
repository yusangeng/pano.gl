/**
 * cancelAnimationFrame
 *
 * @author Y3G
 */

const cancelAnimationFrame = window.cancelRequestAnimationFrame ||
  window.webkitCancelAnimationFrame || window.webkitCancelRequestAnimationFrame ||
  window.mozCancelAnimationFrame || window.mozCancelRequestAnimationFrame ||
  window.msCancelAnimationFrame || window.msCancelRequestAnimationFrame ||
  window.oCancelAnimationFrame || window.oCancelRequestAnimationFrame || window.clearTimeout

export default cancelAnimationFrame
