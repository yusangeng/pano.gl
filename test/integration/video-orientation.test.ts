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
  it('produce the same orientation', async () => {
    const { external, copy } = await renderVideoBothPaths('/fixtures/clip.mp4')
    // Not zero: the two paths do different colour-space conversions, so a couple
    // of levels of difference is expected. What must not happen is a whole frame
    // being mirrored, which moves every pixel that matters.
    expect(maxChannelDiff(external.rgba, copy.rgba)).toBeLessThanOrEqual(2)
  })
})
