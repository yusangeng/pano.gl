import { describe, it, expect } from 'vitest'
import { renderVideoBothPaths } from './support/upload-paths'

/*
 * The largest per-channel difference between two readbacks.
 *
 * Defined here rather than in a shared helper: it is six lines, it has exactly
 * one caller, and the tolerance below only means anything next to the reason for
 * it. A shared module holding this one function would be a file whose only
 * content is a subtraction.
 */
function maxChannelDiff (a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('readbacks differ in size')
  let max = 0
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!))
  return max
}

/*
 * The two upload paths must agree on orientation.
 *
 * importExternalTexture has no flipY option; copyExternalImageToTexture does.
 * If they disagree, a browser that falls back to the copy path renders the
 * video upside down relative to one that uses external textures -- a bug that
 * only appears on some devices and looks like a shader problem.
 */
describe('video upload paths', () => {
  it('produce the same orientation', async (ctx) => {
    const result = await renderVideoBothPaths('/fixtures/clip.mp4')
    if (result.kind === 'unavailable') {
      // A skip, not a pass, and it says why. Nothing else reaches this branch:
      // the probe reports `unavailable` only after the fixture has decoded with
      // contrast of its own and the same device has rendered a constant colour,
      // so a machine that simply renders nothing still fails instead.
      //
      // Printed as well as handed to `skip`, because a reporter may show either
      // one and not the other -- the verbose reporter prints the note, the
      // default one passes the skip through quietly.
      console.warn(`video-orientation: ${result.detail}`)
      // `return`ed because `skip` is typed `never`: that is what narrows the
      // union for the assertion below without a cast.
      return ctx.skip(result.detail)
    }
    const { external, copy } = result
    // Not zero: the two paths do different colour-space conversions, so a couple
    // of levels of difference is expected. What must not happen is a whole frame
    // being mirrored, which moves every pixel that matters.
    expect(maxChannelDiff(external.rgba, copy.rgba)).toBeLessThanOrEqual(2)
  })
})
