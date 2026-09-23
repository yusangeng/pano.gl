/*
 * This file IS the README's minimal example, verbatim except for the import
 * specifier: the dev server serves demo/ as its root and the library lives in
 * this repo rather than in node_modules, so it is imported by path. Every line
 * below the import is what a user copies from the README.
 */
import { FramelessImageViewer } from '../src/index'

const viewer = await FramelessImageViewer.create({
  container: document.querySelector<HTMLElement>('#pano')!,
  src: '/image/2048x1024.jpg'
})

viewer.on('media-error', (event) => console.error(event.error))
