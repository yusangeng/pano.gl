/*
 * Generates the shader-side projection constants from the single JSON source.
 *
 * WGSL has no preprocessor, so its constants are `const` declarations. GLSL ES
 * has #define. Both are emitted from the same JSON, which is the entire point:
 * in the legacy code these were two hand-maintained copies that happened to
 * agree.
 *
 * The output is committed. `npm run build` does not run this generator -- a
 * build that silently regenerates a source file makes a dirty working tree
 * look clean. Instead the constants unit test runs `--check` and fails if the
 * committed output is stale.
 *
 * Usage: node scripts/gen-shader-constants.mjs [--check]
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(repoRoot, 'src/core/projection-kinds.json')
const outPath = path.join(repoRoot, 'src/renderer/shaders/generated.ts')

const check = process.argv.includes('--check')

/**
 * `linear` -> `LINEAR`; `equirectangular` -> `EQUIRECTANGULAR`.
 *
 * @param {string} key
 * @returns {string}
 */
const screamingSnake = key => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()

const kinds = JSON.parse(await readFile(sourcePath, 'utf8'))

// Each entry line is `SECTION_KEY=VALUE`; the bare section headers carry no
// '=' and are what the emitters' filter strips, leaving only the assignments.
const lines = []
lines.push('CAMERA_PROJECTION')
for (const [key, value] of Object.entries(kinds.camera)) {
  lines.push(`CAMERA_PROJECTION_${screamingSnake(key)}=${value}`)
}
lines.push('TEXTURE_PROJECTION')
for (const [key, value] of Object.entries(kinds.texture)) {
  lines.push(`TEXTURE_PROJECTION_${screamingSnake(key)}=${value}`)
}

const wgsl = lines
  .filter(l => l.includes('='))
  .map(l => {
    const [name, value] = l.split('=')
    return `const ${name}: u32 = ${value}u;`
  })
  .join('\n')

// GLSL wants `#define NAME VALUE`. The intermediate's '=' separator becomes
// that space -- emitting `NAME=VALUE` would make the macro body the token
// `=1`, and every comparison against the constant a syntax error.
const glsl = lines
  .filter(l => l.includes('='))
  .map(l => `#define ${l.replace('=', ' ')}`)
  .join('\n')

/**
 * A TypeScript string literal, single-quoted. JSON.stringify gives the correct
 * escaping but double quotes, which lint rejects in the committed output, so
 * its delimiters are swapped for the project's own.
 *
 * @param {string} s
 * @returns {string}
 */
const tsLiteral = s => `'${JSON.stringify(s).slice(1, -1)}'`

const content = `/*
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Produced by scripts/gen-shader-constants.mjs from src/core/projection-kinds.json.
 * Edit the JSON and run \`npm run gen:shaders\`.
 *
 * Committed rather than built so that a stale value shows up as a failing
 * \`--check\` rather than as a working tree that quietly rewrites itself.
 */

/** WGSL declarations, prepended to the WGSL shader source. */
export const WGSL_CONSTANTS = ${tsLiteral(wgsl + '\n')}

/** GLSL ES declarations, prepended to the GLSL shader source. */
export const GLSL_CONSTANTS = ${tsLiteral(glsl + '\n')}
`

if (check) {
  const existing = await readFile(outPath, 'utf8').catch(() => null)
  if (existing !== content) {
    console.error('src/renderer/shaders/generated.ts is stale. Run: npm run gen:shaders')
    process.exit(1)
  }
  console.log('generated shader constants are up to date')
} else {
  await writeFile(outPath, content)
  console.log(`wrote ${path.relative(repoRoot, outPath)}`)
}
