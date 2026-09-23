/*
 * Fails the coverage run when branch coverage is under the 90% floor.
 *
 * vitest.config.ts enforces the same 90% thresholds and fails the run on its
 * own, so this script is belt-and-suspenders rather than the only gate: it
 * turns the number into a plain exit code that reads the same in any log,
 * independent of reporter configuration.
 */

import { readFileSync } from 'node:fs'

const SUMMARY = new URL('../coverage/coverage-summary.json', import.meta.url)
const THRESHOLD = 90

const { total } = JSON.parse(readFileSync(SUMMARY, 'utf8'))
const branch = total.branches.pct
console.log(`branch coverage: ${branch}%`)

// A summary that is missing or shaped differently must fail, not pass: both
// NaN and undefined compare false against `<` and would exit 0 silently.
if (!Number.isFinite(branch) || branch < THRESHOLD) {
  console.error(`branch coverage ${branch}% is below the ${THRESHOLD}% floor`)
  process.exit(1)
}
