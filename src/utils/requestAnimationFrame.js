/**
 * requestAnimationFrame
 *
 * @author yusangeng@outlook.com
 */

const requestAnimationFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame ||
  window.mozRequestAnimationFrame || window.oRequestAnimationFrame ||
  window.msRequestAnimationFrame || ((callback, element) => setTimeout(callback, 1000 / 60))

export default requestAnimationFrame
