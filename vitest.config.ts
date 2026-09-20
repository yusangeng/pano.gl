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
        'src/**/types.ts'
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
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node'
        }
      }
    ]
  }
})
