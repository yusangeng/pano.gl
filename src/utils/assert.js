/**
 * 断言
 *
 * @author yusangeng@outlook.com
 */

export default function assert(condition, message) {
  if (!condition) {
    var err = new Error('Assertion failed! ' + (message || ''))
    throw err
  }
}
