/*
 * Keeps the README constructor-options table and the option interfaces in
 * src/viewer/options.ts in lockstep. The table once claimed to list every
 * shared option while the public `backend` option was missing from it —
 * a spec drives execution right up to the spec's edge and stops, and nothing
 * guarded the perimeter. This script is that guard: adding an option to
 * ImageViewerOptions without documenting it (or documenting one that does not
 * exist, or resurrecting a removed one) fails with a plain exit code.
 *
 * Wired into `npm run typecheck`, which every task-card verify runs.
 */

import { readFileSync } from 'node:fs'

const README = new URL('../README.md', import.meta.url)
const OPTIONS = new URL('../src/viewer/options.ts', import.meta.url)

const readme = readFileSync(README, 'utf8')
const options = readFileSync(OPTIONS, 'utf8')

/** Extracts the `readonly name` member names of one interface body. */
function interfaceMembers (name) {
  const start = options.indexOf(`interface ${name}`)
  if (start === -1) throw new Error(`interface ${name} not found in options.ts`)
  const body = options.slice(start, options.indexOf('}', start))
  const members = []
  for (const match of body.matchAll(/readonly (\w+)\??:/g)) {
    members.push(match[1])
  }
  return members
}

const imageMembers = interfaceMembers('ImageViewerOptions')
const videoExtras = interfaceMembers('VideoViewerOptions')
  .filter(name => !imageMembers.includes(name))
const removed = interfaceMembers('RemovedOptions')

// The table lives in the `## Constructor options` section; first cell is the
// option name in backticks, the Description cell carries the "Video only" tag.
const section = readme.slice(
  readme.indexOf('## Constructor options'),
  readme.indexOf('### Camera')
)
const rows = []
for (const line of section.split('\n')) {
  const match = line.match(/^\| `(\w+)` \|(.*)$/)
  if (!match) continue
  rows.push({ name: match[1], rest: match[2] })
}

const failures = []
const documented = rows.map(row => row.name)
const videoOnly = rows.filter(row => row.rest.includes('Video only')).map(row => row.name)

for (const name of imageMembers) {
  if (!documented.includes(name)) {
    failures.push(`README table is missing \`${name}\` (public option in ImageViewerOptions)`)
  }
}
for (const name of videoExtras) {
  if (!documented.includes(name)) {
    failures.push(`README table is missing \`${name}\` (video-only option in VideoViewerOptions)`)
  } else if (!videoOnly.includes(name)) {
    failures.push(`README row for \`${name}\` lacks the "Video only" tag`)
  }
}
for (const name of documented) {
  if (removed.includes(name)) {
    failures.push(`README documents \`${name}\`, which is a removed option and must stay undocumented`)
  } else if (!imageMembers.includes(name) && !videoExtras.includes(name)) {
    failures.push(`README documents \`${name}\`, which exists in no options interface`)
  }
}

// The intro sentence counts the video-only rows; keep the count honest too.
const intro = section.match(/the video viewer adds the (\w+) marked/)
const wordCounts = { one: 1, two: 2, three: 3, four: 4, five: 5 }
if (!intro || wordCounts[intro[1]] !== videoExtras.length) {
  failures.push(
    `intro sentence must read "the video viewer adds the ${['zero', 'one', 'two', 'three', 'four', 'five'][videoExtras.length] ?? videoExtras.length} marked" to match the ${videoExtras.length} video-only options`
  )
}

console.log(`README options table: ${documented.length} documented, ${videoExtras.length} video-only, in sync with options.ts`)
if (failures.length > 0) {
  console.error(failures.map(f => `- ${f}`).join('\n'))
  process.exit(1)
}
