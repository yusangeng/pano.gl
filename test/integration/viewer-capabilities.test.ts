import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBackend } from '../../src/viewer/backend-factory'
import { Viewer } from '../../src/viewer/viewer'
import type { Backend } from '../../src/renderer/backend'
import { makeContainer } from './support/dom'

/*
 * `Viewer.capabilities` is a public getter over a `Backend`, and `Backend` is
 * an object the caller of `Viewer`'s constructor already holds -- so a getter
 * that returns the backend's own record hands every caller write access to
 * state other callers are reading. `Capabilities`' fields are `readonly`, but
 * that is a compile-time modifier; at runtime they are ordinary properties.
 *
 * The damage differs from `cameraOptions`' and is worth stating, because it is
 * not the same defect: `maxTextureDimension` is the number that decides whether
 * a source has to be downscaled, so corrupting it does not merely make one
 * application's view disagree with the screen -- it changes what the shared
 * backend reports to everyone. Measured before the fix: writing through the
 * getter was visible on `viewer.capabilities` and on `backend.capabilities`
 * alike, because they were the same object.
 */

async function mount (): Promise<{ viewer: Viewer, backend: Backend }> {
  const container = makeContainer()
  const canvas = document.createElement('canvas')
  const backend = await createBackend(canvas)
  const viewer = new Viewer({ container, canvas, camera: undefined, backend })
  return { viewer, backend }
}

afterEach(() => { vi.restoreAllMocks() })

describe('Viewer.capabilities', () => {
  it('hands out a copy, so writing to it cannot change what the backend reports', async () => {
    const { viewer, backend } = await mount()

    const before = viewer.capabilities.maxTextureDimension
    expect(before).toBeGreaterThan(0)

    const alias = viewer.capabilities as unknown as { maxTextureDimension: number }
    alias.maxTextureDimension = 1
    // The write has to be shown to have landed, or "the viewer did not change"
    // would hold just as well for a getter that returned nothing writable at
    // all -- the vacuous-assertion trap E8 in the errata.
    expect(alias.maxTextureDimension, 'the handed-out object was not writable').toBe(1)

    expect(viewer.capabilities.maxTextureDimension).toBe(before)
    expect(backend.capabilities.maxTextureDimension).toBe(before)
  })

  it('copies the nested adapter record too, since Readonly is only compile-time', async () => {
    const { viewer, backend } = await mount()

    // Loud rather than skipped: if a future adapter stops reporting `info`, this
    // test cannot prove the nested copy and should say so instead of passing
    // without having checked anything.
    const adapter = viewer.capabilities.adapter
    expect(adapter, 'the adapter reported no info, so the nested copy is untested').toBeDefined()

    const alias = adapter as Record<string, string>
    alias.injected = 'written through the getter'
    expect(alias.injected).toBe('written through the getter')

    expect(viewer.capabilities.adapter?.injected).toBeUndefined()
    expect(backend.capabilities.adapter?.injected).toBeUndefined()
  })

  it('forwards backend and externalTextures unchanged', async () => {
    /*
     * The other two fields, and the forwarding path rather than the table.
     * `maxTextureDimension` and `adapter` were the only ones asserted;
     * `test/unit/capabilities.test.ts` covers `describeCapabilities`' own
     * output, which is a different fact -- a getter that replaced either of
     * these on the way through would leave that table perfectly correct.
     *
     * `externalTextures` is asserted to be TRUE first. On a backend that
     * reports false, forcing false is identity, and the comparison below would
     * hold whether or not anything was forwarded -- loud rather than silently
     * vacuous if a future adapter changes that.
     */
    const { viewer, backend } = await mount()

    expect(
      backend.capabilities.externalTextures,
      'the backend reports no external textures, so a forced false would be invisible here'
    ).toBe(true)

    expect(viewer.capabilities.backend).toBe(backend.capabilities.backend)
    expect(viewer.capabilities.externalTextures).toBe(backend.capabilities.externalTextures)
  })
})
