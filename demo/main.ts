import { FramelessImageViewer } from '../src/index'

const host = document.getElementById('viewer')
if (!host) throw new Error('#viewer is missing from index.html')

/*
 * The asset is one of the demo's own 2017 panoramas, served by vite's dev
 * server from inside the demo root: `vite demo` makes demo/ the server root,
 * so `/image/...` resolves to demo/image/. It is NOT `/fixtures/...` -- that
 * path belongs to the integration tests, served from the repo root's public/
 * by the browser-mode dev server, a different server with a different root.
 */
try {
  const viewer = await FramelessImageViewer.create({
    container: host,
    src: '/image/2048x1024.jpg'
  })

  // Results travel as events, not console logs (spec 7.3): an application
  // learns that its panorama failed from an event it can render.
  viewer.on('media-error', (event) => {
    const note = document.createElement('p')
    note.style.cssText = 'color:#f66;font:14px system-ui;padding:16px'
    note.textContent = `the panorama failed to load: ${String(event.error)}`
    host.appendChild(note)
  })
} catch (error) {
  // create() throws rather than returning a viewer that cannot draw, so a
  // failed backend shows up here -- the demo says so instead of showing a
  // black rectangle with no explanation.
  const note = document.createElement('p')
  note.style.cssText = 'color:#f66;font:14px system-ui;padding:16px'
  note.textContent = `pano.gl could not start: ${String(error)}`
  host.appendChild(note)
}
