/**
 * Trace channels for pano.gl.
 *
 * Two rules govern everything here:
 *
 * 1. Nothing is written to the console unless the host application asked for it.
 *    The library ships inside other people's pages; a console log nobody opted
 *    into is a bug report waiting to happen.
 * 2. Anything the *application* needs to know is an event on the viewer, never
 *    a log line. `debug` is for diagnosing the library from the outside; it is
 *    not a control channel. If you find yourself grepping logs to decide what
 *    UI to show, the thing you want is an event.
 *
 * Usage from an application (once P5 opens the public surface -- until then
 * import from the module path directly):
 *
 *     import { enableChannels } from 'pano.gl'
 *     enableChannels('pano:gpu,pano:renderer')
 *
 * Or from outside the page entirely:
 *
 *     DEBUG=pano:*,-pano:media
 */

import createDebug from 'debug'

// debug's Node engine initialises its enable state from `process.env.DEBUG`
// verbatim: when DEBUG is unset, `enable(undefined)` runs and the internal
// `namespaces` marker stays undefined. A channel's `.enabled` getter only
// recomputes when that marker *changes* value, so on a fresh import every
// channel reports `undefined` rather than `false` until the first
// enable()/disable() call. Normalising the nothing-enabled case to `''` here
// makes "silent by default" observable, while a host-provided DEBUG pattern
// (names/skips non-empty) is left exactly as the environment set it.
if (createDebug.names.length === 0 && createDebug.skips.length === 0) {
  createDebug.enable('')
}

/**
 * Trace channels, declared once. Creating them anywhere else would let a typo
 * produce a channel that silently never fires -- which is indistinguishable
 * from code that never runs.
 */
export const channels = {
  viewer: createDebug('pano:viewer'),
  renderer: createDebug('pano:renderer'),
  gpu: createDebug('pano:gpu'),
  camera: createDebug('pano:camera'),
  media: createDebug('pano:media'),
  input: createDebug('pano:input')
} as const

export type ChannelName = keyof typeof channels

/**
 * Enables the named namespaces and returns a function that puts the previous
 * state back.
 *
 * `debug` has a single global enable list, so enabling is process-wide rather
 * than per-instance. Returning the undo keeps tests from leaking an enabled
 * channel into the next test.
 *
 * Enabling also persists through debug's own storage -- `process.env.DEBUG`
 * in Node, localStorage in browsers -- so the setting survives page reloads.
 * Inherited `debug` semantics, but surprising enough to an application
 * developer to say out loud.
 *
 * @param namespaces - A `debug` namespace pattern, e.g. `'pano:gpu'` or
 *   `'pano:*,-pano:media'`. An empty string enables nothing; an unparsable
 *   string is silently treated the same way, exactly as `debug` does.
 * @returns A function restoring the enabled set that was in effect before.
 */
export function enableChannels (namespaces: string): () => void {
  const previous = createDebug.disable()
  createDebug.enable(namespaces)

  return () => {
    createDebug.disable()
    createDebug.enable(previous)
  }
}
