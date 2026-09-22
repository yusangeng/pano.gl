/*
 * Containers and the elements the viewer puts inside them.
 *
 * The viewer appends its own canvas to the container you hand it and removes it
 * on dispose, so `container.querySelector` is how a test reaches the thing that
 * was drawn into. `.pano-canvas` is the class the viewer sets; a test that
 * queried `canvas` would also match a canvas the host page happened to put
 * there, and would then compare the wrong element.
 */

/** A positioned container, appended to the page, with a size it can be told. */
export function makeContainer (width = 400, height = 300): HTMLDivElement {
  const el = document.createElement('div')
  Object.assign(el.style, { width: `${width}px`, height: `${height}px`, position: 'fixed', top: '0px' })
  document.body.appendChild(el)
  return el
}

/** The viewer's canvas inside `container`. */
export function canvasOf (container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector<HTMLCanvasElement>('.pano-canvas')
  if (canvas === null) throw new Error('the container has no .pano-canvas in it')
  return canvas
}

/**
 * The viewer's video element inside `container`, if it has one.
 *
 * Returns null rather than throwing: "there is no video element" is the answer
 * several tests want -- after a source swap away from video, and after dispose
 * -- so making its absence an error would force every one of them to wrap this
 * in a try.
 */
export function videoOf (container: HTMLElement): HTMLVideoElement | null {
  return container.querySelector('video')
}
