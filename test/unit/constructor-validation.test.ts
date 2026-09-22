import { describe, it, expect } from 'vitest'
import { validateImageOptions, validateVideoOptions, type ImageProjection } from '../../src/viewer/options'

describe('image viewer options', () => {
  const container = { nodeType: 1 } as unknown as HTMLElement

  it('accepts the minimum', () => {
    expect(() => validateImageOptions({ container, src: '/a.png' })).not.toThrow()
  })

  it('rejects a missing container with a message that names the field', () => {
    expect(() => validateImageOptions({ src: '/a.png' } as never))
      .toThrow(/container/)
  })

  it('rejects a non-string src', () => {
    expect(() => validateImageOptions({ container, src: 42 } as never)).toThrow(/src/)
  })

  it('rejects an empty src', () => {
    // An empty src silently loads the current page as an image, which then
    // fails to decode, and the error surfaces as a media-error with no hint
    // that the URL was the empty string.
    expect(() => validateImageOptions({ container, src: '' })).toThrow(/src/)
  })

  it('accepts the corrected spelling of the projection', () => {
    expect(() => validateImageOptions({ container, src: '/a.png', projection: 'equirectangular' }))
      .not.toThrow()
  })

  it('rejects the legacy misspelling with a message that says what to use', () => {
    // "equiprectangular" was the shipped spelling. Failing with the correction
    // in the message is the difference between a five-second fix and a
    // confusing "invalid projection" when upgrading.
    expect(() => validateImageOptions({ container, src: '/a.png', projection: 'equiprectangular' } as never))
      .toThrow(/equirectangular/)
  })

  it('rejects fisheye at construction rather than at render time', () => {
    // The legacy code accepted 'fisheye' and threw from inside the texture
    // update, so the viewer constructed "successfully" and then failed on the
    // first frame. Construct-time is the only useful time to fail.
    //
    // The cast is half the assertion. `ImageProjection` does not include
    // 'fisheye', and the directive below makes `npm run typecheck` prove it --
    // an unused `@ts-expect-error` is itself an error. What is left for the
    // runtime check is the JavaScript caller, who has no compiler and does
    // arrive here.
    // @ts-expect-error 'fisheye' is not an ImageProjection
    const fisheye: ImageProjection = 'fisheye'
    expect(() => validateImageOptions({ container, src: '/a.png', projection: fisheye }))
      .toThrow(/fisheye.*not implemented/i)
  })

  it('accepts an omitted projection', () => {
    // `undefined` means equirectangular, which is what the sources default to.
    // Rejecting it would make the option mandatory in all but name.
    expect(validateImageOptions({ container, src: '/a.png' }).projection).toBeUndefined()
  })

  it('rejects the removed frameSize option with an explanation', () => {
    // Silently ignoring it would leave an upgrader believing their oversized
    // image is still being downscaled by that setting.
    expect(() => validateImageOptions({ container, src: '/a.png', frameSize: [2048, 1024] } as never))
      .toThrow(/frameSize.*removed/i)
  })
})

describe('video viewer options', () => {
  const container = { nodeType: 1 } as unknown as HTMLElement

  it('accepts the minimum', () => {
    expect(() => validateVideoOptions({ container, src: '/a.mp4' })).not.toThrow()
  })

  it('defaults to muted', () => {
    // Every modern browser blocks unmuted autoplay. The legacy default was
    // unmuted, so an autoplay video simply never started.
    expect(validateVideoOptions({ container, src: '/a.mp4' }).muted).toBe(true)
  })

  it('honours an explicit muted: false', () => {
    expect(validateVideoOptions({ container, src: '/a.mp4', muted: false }).muted).toBe(false)
  })
})

// The three below are additions to the plan's twelve, which the plan's own
// `options.ts` specifies checks for but does not test: the `el` removed-option
// guard, the unknown-projection tail of `assertProjection`, and the `null`
// container. Each of the three throw branches is otherwise reached by no test,
// and an untested throw is a branch whose removal nothing would notice -- the
// exact shape of hole this card exists to close. See the completion report.
describe('image viewer options -- branches the plan leaves untested', () => {
  const container = { nodeType: 1 } as unknown as HTMLElement

  it('rejects an unknown projection with a message that names what arrived', () => {
    // The tail of `assertProjection`: a string that is neither a known
    // projection nor one of the two recognised legacy spellings. Naming the
    // received value is what separates this from the misspelling message.
    expect(() => validateImageOptions({ container, src: '/a.png', projection: 'mercator' } as never))
      .toThrow(/unknown projection: mercator/)
  })

  it('rejects the removed el option with a message that names its replacement', () => {
    // `el` was renamed to `container`. Same reasoning as `frameSize`: an
    // upgrader who passes the old name has to be told the new one, and the
    // check is in the same function as frameSize's.
    expect(() => validateImageOptions({ container, src: '/a.png', el: container } as never))
      .toThrow(/el.*container/)
  })

  it('rejects a null container as a container error, not as a null dereference', () => {
    // `typeof null === 'object'`, so without the explicit null check the next
    // line reads `nodeType` off null and the caller gets "Cannot read
    // properties of null" -- which names neither the option nor the fix.
    expect(() => validateImageOptions({ container: null, src: '/a.png' } as never))
      .toThrow(/container must be an HTMLElement/)
  })
})
