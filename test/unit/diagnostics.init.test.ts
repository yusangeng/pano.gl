/*
 * Import-time behaviour of src/diagnostics, in its own file on purpose.
 *
 * The module inspects debug's enable state once, at import: the top-level
 * normalisation must rewrite the nothing-enabled case to `''` while leaving a
 * host-provided DEBUG pattern exactly as the environment set it. Vitest gives
 * every test file its own isolated module registry, so stubbing DEBUG before
 * the dynamic import below is the one way a unit test can observe that first
 * initialisation -- in a shared registry the module would already be cached
 * and its top level would never run again.
 */

import { describe, it, expect, vi } from 'vitest'

describe('diagnostics import-time', () => {
  it('honours a host-provided DEBUG pattern instead of normalising it away', async () => {
    // Stubbed before the first import of anything that pulls in `debug`:
    // debug's Node engine reads process.env.DEBUG at its own module init,
    // which the dynamic import below triggers. The normalisation's failure
    // mode is clobbering the host's pattern with enable(''), which would
    // silently switch off tracing the host explicitly asked for.
    vi.stubEnv('DEBUG', 'pano:gpu')
    try {
      const { channels } = await import('../../src/diagnostics')
      expect(channels.gpu.enabled).toBe(true)
      expect(channels.media.enabled).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
