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
  encoding: 'utf8',
  env
})
process.stdout.write(r.stdout)
process.stderr.write(r.stderr)

if (r.status !== 0) {
  console.error('\nBaseline fixtures are missing or malformed. Regenerate with:')
  console.error('  cd tools/baseline && node capture.mjs')
  process.exit(1)
}

/*
 * A green exit code alone does not mean the suite ran everything it owns
 * (review finding 9). The negative test guards itself from infinite recursion
 * with a skip condition keyed on an env var -- if that var ever leaks into an
 * outer environment, the negative test silently reports "skipped", node:test
 * still exits 0, and this wrapper has no way to know the deepest check in the
 * chain never executed. The TAP footer counts skips, so demanding zero skips
 * turns that leak into a red gate instead of a silent hole.
 */
if (!/^# skipped 0$/m.test(r.stdout)) {
  console.error('\nFixture suite exited 0 but skipped at least one test.')
  console.error('If BASELINE_VERIFY_NEGATIVE_TEST is set in your environment, unset it: it is a')
  console.error('recursion guard for the negative test\'s own copy of the suite, not a mode to run here.')
  process.exit(1)
}
