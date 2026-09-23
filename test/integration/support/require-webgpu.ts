import { beforeAll, expect } from 'vitest'
import { enableChannels } from '../../../src/diagnostics'

/*
 * DIAGNOSTIC ROUND (2026-09-24, temporary): the CI runner's integration
 * failures all sit downstream of signals this library already emits on its
 * trace channels -- `pano:gpu` carries "device lost" and "render validation
 * error", `pano:viewer` carries "frame failed" -- but nothing opts in by
 * default (rule 1 in src/diagnostics.ts), so the CI log holds the failures
 * and none of their causes. Enabled here, once per file, until the
 * runner-only mechanisms are root-caused. The volume is bounded: four call
 * sites in src/, three of which fire at most once per device lifetime.
 */
enableChannels('pano:gpu,pano:viewer')

/*
 * Every test in the `integration` project runs against a real WebGPU adapter,
 * or the run stops here.
 *
 * This guard exists because the failure it catches is silent. Playwright's
 * default headless binary is chrome-headless-shell: WebGL still renders
 * correct pixels through SwiftShader, navigator.gpu still exists, and only
 * requestAdapter() gives the game away by returning null. Without this check
 * the whole suite passes while exercising nothing.
 */
beforeAll(async () => {
  expect(
    navigator.gpu,
    'navigator.gpu is undefined -- this browser has no WebGPU at all'
  ).toBeDefined()

  const adapter = await navigator.gpu.requestAdapter()
  expect(
    adapter,
    'requestAdapter() returned null, so this project is testing nothing. ' +
      'Most likely the browser is chrome-headless-shell (the bundled headless ' +
      'chromium): set launchOptions.channel = "chromium" on the provider ' +
      'factory in vitest.config.ts -- and make sure it is on the FACTORY, not ' +
      'on instances[].launch, where Vitest silently ignores it.'
  ).not.toBeNull()
})
