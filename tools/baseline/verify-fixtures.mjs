/*
 * Entry point the superloop task's `verify` command calls. Kept as a separate
 * file from the test so the test can be run directly during development while
 * CI has one stable command to invoke.
 */

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const r = spawnSync(process.execPath, ['--test', path.join(here, 'fixtures.test.mjs')], {
  stdio: 'inherit'
})

if (r.status !== 0) {
  console.error('\nBaseline fixtures are missing or malformed. Regenerate with:')
  console.error('  cd tools/baseline && node capture.mjs')
  process.exit(1)
}
