import { chromium } from 'playwright'

for (const [label, opts] of [
  ['DEFAULT (headless:true)', { headless: true }],
  ['channel:chromium', { channel: 'chromium', headless: true }]
]) {
  const b = await chromium.launch(opts)
  console.log(`\n### ${label} ###`)
  console.log(`  .version() = ${b.version()}`)
  await b.close()
}
