/*
 * The demo grows a real viewer in P5. Until then it exists so `npm start` has
 * something to look at. It is deliberately NOT what the integration tests
 * drive -- those run in vitest's browser mode and import the library directly,
 * so the demo page cannot break the suite and the suite cannot quietly start
 * depending on the demo's markup.
 */

import { VERSION } from '../src/index'

const host = document.getElementById('viewer')
if (!host) throw new Error('#viewer is missing from index.html')

const note = document.createElement('p')
note.style.cssText = 'color:#888;font:14px system-ui;padding:16px'
note.textContent = `pano.gl ${VERSION} -- viewer lands in P5`
host.appendChild(note)
