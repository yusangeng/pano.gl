/**
 * 把输入量钳在某个区间内
 *
 * @author Y3G
 */

export default function clamp (val, min, max) {
  if (val < min) return min
  if (val > max) return max

  return val
}
