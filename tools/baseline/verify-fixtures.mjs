/*
 * Entry point the superloop task's `verify` command calls. Kept as a separate
 * file from the test so the test can be run directly during development while
 * CI has one stable command to invoke.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/*
 * node marks the files it executes for the test runner with NODE_TEST_CONTEXT,
 * and a runner that sees the marker while starting refuses to run "recursively"
 * -- it warns, runs nothing, and exits 0. Inheriting the variable would turn
 * this wrapper into a silent no-op exactly when someone runs the card verify
 * from inside another test, so the marker is stripped before spawning.
 */
const env = { ...process.env }
delete env.NODE_TEST_CONTEXT

const r = spawnSync(process.execPath, ['--test', path.join(here, 'fixtures.test.mjs')], {
  stdio: 'inherit',
  env
})

if (r.status !== 0) {
  console.error('\nBaseline fixtures are missing or malformed. Regenerate with:')
  console.error('  cd tools/baseline && node capture.mjs')
  process.exit(1)
}
