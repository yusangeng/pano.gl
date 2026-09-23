/*
 * Fails the coverage run when branch coverage is under the 90% floor.
 *
 * vitest.config.ts (P1) carries the same 90% thresholds, but a number that
 * only exists inside a report is a number nobody reads. This makes the gate
 * an exit code.
 */

import { readFileSync } from 'node:fs'

const SUMMARY = new URL('../coverage/coverage-summary.json', import.meta.url)
const THRESHOLD = 90

const { total } = JSON.parse(readFileSync(SUMMARY, 'utf8'))
const branch = total.branches.pct
console.log(`branch coverage: ${branch}%`)

if (branch < THRESHOLD) {
  console.error(`branch coverage ${branch}% is below the ${THRESHOLD}% floor`)
  process.exit(1)
}
