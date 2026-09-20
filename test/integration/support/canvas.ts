/*
 * Reading pixels back out of a canvas, for tests that assert on what was
 * drawn rather than on what was returned.
 *
 * Goes through `toDataURL`, NOT `drawImage`. This is measured, not assumed:
 * a WebGPU canvas read by `drawImage` is correct in the task that drew it and
 * in the animation frame immediately after, and fully transparent one frame
 * past that -- 3/3 blank at two rAFs, across all four combinations of
 * {rgba8unorm, bgra8unorm} x {opaque, premultiplied}. The one-rAF case is a
 * race, which is why single samples of it disagree. A test that waited for a
 * frame and then read with `drawImage` would see an empty canvas and report it
 * as a renderer that drew nothing -- a wrong answer wearing the shape of a
 * real failure. `toDataURL` was correct at 0, 1, 2, 5 and 20 frames: 15 of 15.
 *
 * It costs about 2ms per read at 64x32, which is the other reason the read
 * below downscales: a full 1600x1200 canvas is 400x the pixels to decode for
 * a question ("did this change", "is there content") that 64x32 answers.
 *
 * The bytes come back RGBA whatever the canvas's GPU format is: `getImageData`
 * converts on the way out, so the `bgra8unorm` that `getPreferredCanvasFormat()`
 * returns on macOS never reaches the caller and nothing here reorders channels.
 */

/** One frame's worth of waiting for the renderer's own rAF loop to run again. */
export function nextFrames (count = 1): Promise<void> {
  return new Promise((resolve) => {
    let left = count
    const tick = (): void => {
      if (--left <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function decode (dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('the canvas did not produce a decodable PNG'))
    image.src = dataUrl
  })
}

/**
 * Reads `canvas` back as RGBA8, downscaled to `width`x`height`.
 *
 * @param canvas - Any canvas, WebGPU or 2D.
 * @param width - Output width. 64 keeps the readback near the 256-byte row
 *   alignment `copyTextureToBuffer` wants and keeps comparisons cheap.
 * @param height - Output height.
 */
export async function readCanvas (
  canvas: HTMLCanvasElement,
  width = 64,
  height = 32
): Promise<ImageData> {
  const image = await decode(canvas.toDataURL('image/png'))
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (ctx === null) throw new Error('no 2D context to read the canvas back into')
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/** The largest per-channel difference between two same-size readbacks. */
export function maxChannelDiff (a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('readbacks differ in size')
  let max = 0
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!))
  return max
}

/**
 * How many pixels are not fully transparent black.
 *
 * The question a "did anything render" test is really asking, and one an exact
 * comparison cannot answer: a viewer that drew the wrong thing still drew.
 */
export function countNonBlack (image: ImageData): number {
  let count = 0
  const { data } = image
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 0 || data[i + 1]! > 0 || data[i + 2]! > 0) count++
  }
  return count
}
