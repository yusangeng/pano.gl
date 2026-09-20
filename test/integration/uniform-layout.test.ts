import { describe, it, expect } from 'vitest'
import { createEchoRenderer } from './support/echo'

/*
 * Writes sentinels into the camera uniform block, reads every slot back from
 * WGSL, and compares.
 *
 * Why this cannot be a unit test: the layout constants are the JavaScript side's
 * opinion of where the fields are. WGSL has its own opinion. Nothing checks that
 * the two agree -- there is no reflection API. A mismatch reads whatever bytes
 * are adjacent, which produces a picture that is wrong in a way that looks like
 * a projection bug.
 *
 * This test is also the guard on the std140 assumption. It was verified on Metal
 * and SwiftShader that WGSL's uniform address space packs consecutive 4-byte
 * scalars without per-member 16-byte slots; if a future browser changes that,
 * this test is where it shows up.
 */
describe('uniform layout round trip', () => {
  it('places every field at its declared offset', async () => {
    // Sentinels chosen so a one-field shift produces a visibly wrong value
    // rather than a plausible one. All five are exact in f32 and none is a
    // round number that could coincide with a neighbour's default.
    const values = {
      projKind: 1234567,
      texProjKind: 7654321,
      povLatitude: -12.5,
      povLongitude: 234.75,
      zoom: 3.5
    }

    const echo = await createEchoRenderer()
    expect(await echo(values)).toEqual(values)
  })

  it('round-trips the inverse clip matrix without transposition', async () => {
    // gl-matrix is column-major and WGSL's mat4x4 is m[col][row]; they line up,
    // but "they line up" is exactly the kind of claim that deserves a test.
    //
    // Sixteen distinct values, in the order the array is written. A transposed
    // round trip returns the same sixteen numbers in a different order, so the
    // values have to be distinct for the comparison to mean anything -- an
    // identity or constant matrix would pass while transposed.
    const invClip = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

    const echo = await createEchoRenderer()
    const echoed = await echo({ invClip })
    expect(echoed.invClip).toEqual(invClip)
  })
})
