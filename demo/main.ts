/*
 * This file IS the README's minimal example, with two local adaptations: the
 * import specifier (the library lives in this repo rather than in
 * node_modules) and assetUrl() around the src (the demo is also deployed
 * under /pano.gl/ on GitHub Pages, where a root-absolute path would 404 —
 * a user self-hosting at the origin root copies the README path as-is).
 * Every other line below is what a user copies from the README.
 */
import { FramelessImageViewer } from '../src/index'
import { assetUrl } from './asset-url'

const viewer = await FramelessImageViewer.create({
  container: document.querySelector<HTMLElement>('#pano')!,
  src: assetUrl('/image/2048x1024.jpg')
})

viewer.on('media-error', (event) => console.error(event.error))
