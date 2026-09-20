/**
 * 断言
 *
 * @author Y3G
 */

export default function assert (condition, message) {
  if (!condition) {
    var err = new Error('Assertion failed! ' + (message || ''))
    throw err
  }
}
