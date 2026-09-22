import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /*
     * Coverage is configured at the ROOT, not inside the unit project.
     * Vitest reads coverage from the root config; a `coverage` block nested in
     * a project is not what the reporter looks at. Scoping is done by running
     * `vitest run --project unit --coverage` -- only unit tests contribute
     * because only they ran.
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        // Pure type declarations compile to nothing, so there is no branch to
        // cover. Listing them keeps the threshold meaningful rather than
        // diluted by files that can never contribute.
        'src/**/types.ts',
        // DOM-bound classes, appended as they land. Their every path needs a
        // real element and real browser events, so the node project cannot
        // execute them without mocking the DOM -- which would replay the
        // author's assumptions back instead of testing anything. They are
        // exercised by the browser integration project, which does not report
        // coverage; excluding them here keeps this gate about code the node
        // project can genuinely reach.
        'src/media/image-source.ts',
        'src/media/video-source.ts',
        'src/interaction/input-controller.ts',
        // Task 3's two. `viewer.ts` builds a ResizeObserver, drives
        // requestAnimationFrame and appends a canvas; `backend-factory.ts` asks
        // `navigator.gpu` for an adapter and creates a canvas to test for
        // WebGL2. Neither reaches a single line under the node project, and
        // `viewer.ts` alone is 129 statements -- measured, leaving them in drops
        // the global statements figure from 99.32% to 78.43% and fails the gate
        // by construction rather than because anything is untested. Both ARE
        // exercised, by `dispose-order.test.ts` and `camera-options.test.ts` in
        // the integration project, which reports no coverage.
        'src/viewer/viewer.ts',
        'src/viewer/backend-factory.ts'
      ],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90
      }
    },
    projects: [
      {
        test: {
          name: 'integration',
          setupFiles: ['./test/integration/support/require-webgpu.ts'],
          include: ['test/integration/**/*.test.ts'],
          exclude: ['test/integration/fallback/**'],
          browser: {
            enabled: true,
            /*
             * The launch/context options live HERE, on the provider factory.
             *
             * Putting them on `instances[].launch` / `instances[].context`
             * instead is accepted without a word and then ignored -- you
             * silently get Playwright's bundled headless chromium, which has
             * no GPU at all. Measured: with the options in the wrong place
             * requestAdapter() returns null and every test in this project
             * fails at the guard; with them here the adapter is real
             * (apple/metal-3 on the machine this was verified on).
             *
             * channel: 'chromium' is load-bearing, and not for the reason it
             * looks like. Playwright's default headless launch uses
             * chrome-headless-shell, a separate binary with no GPU stack:
             * WebGL still works (through SwiftShader) and renders correct
             * pixels, but requestAdapter() returns null, so every WebGPU test
             * no-ops. The failure mode is "looks fine", not "reports an error".
             */
            provider: playwright({
              launchOptions: {
                channel: 'chromium',
                /*
                 * CI runners have no GPU, and a GPU-less browser hands back a
                 * null adapter -- which the guard would (correctly) turn into a
                 * red build. SwiftShader gives software WebGPU back, but only
                 * with BOTH of these flags: --enable-unsafe-webgpu and
                 * --use-webgpu-adapter=swiftshader on their own each still
                 * return null. Measured; see also the CI job in Task 9.
                 *
                 * Reproduce the CI environment locally with `CI=1 npm run
                 * test:integration`. Note that the gates therefore have to hold
                 * on a software rasteriser as well as on a real GPU -- that is
                 * a tolerance decision for P3, not something this file settles.
                 */
                args: process.env.CI
                  ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader']
                  : []
              },
              contextOptions: { deviceScaleFactor: 2 }
            }),
            headless: true,
            // Traces are Playwright-provider-only and open in
            // https://trace.playwright.dev -- the debugging story Playwright
            // users expect, kept.
            trace: 'retain-on-failure',
            instances: [{ browser: 'chromium' }]
          }
        }
      },
      {
        test: {
          name: 'no-webgpu',
          setupFiles: ['./test/integration/support/require-no-webgpu.ts'],
          include: ['test/integration/fallback/**/*.test.ts'],
          browser: {
            enabled: true,
            /*
             * --disable-gpu reproduces the real downgrade condition: navigator.gpu
             * still exists, requestAdapter() returns null, and WebGL2 keeps
             * working. Measured. Note --disable-features=WebGPU does NOT work
             * (the adapter still appears), and adding
             * --disable-software-rasterizer would kill WebGL2 too.
             *
             * This project is what P6 grows into: P6 widens its `include` to
             * the whole integration suite (excluding the gate tests) so that
             * every user story from P5 is proven to pass on the WebGL2 path.
             */
            provider: playwright({
              launchOptions: { channel: 'chromium', args: ['--disable-gpu'] }
            }),
            headless: true,
            instances: [{ browser: 'chromium' }]
          }
        }
      },
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node'
        }
      }
    ]
  }
})
