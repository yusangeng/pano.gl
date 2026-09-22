/*
 * Regenerates the two fixtures the integration suites read. Both outputs are
 * committed, so this runs only when the fixtures themselves need to change --
 * cloning the repo and running the suite never requires ffmpeg.
 *
 *   node scripts/gen-fixtures.mjs
 *
 * Requires ffmpeg on PATH. Nothing in package.json depends on it.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'public', 'fixtures')
const png = path.join(outDir, 'panorama.png')
const mp4 = path.join(outDir, 'clip.mp4')

const W = 512
const H = 256

/*
 * Four quadrants, not two.
 *
 * Four colours because two different assertions have to hold at once: up and
 * down must differ (the orientation checks) and a horizontal pan must change
 * pixels (the PTZ checks). A single vertical split would make every pan a no-op.
 *
 * ffmpeg routes these hex values through YUV, so what lands in the file is the
 * converted value, not the literal below. They stay distinct and stable, which
 * is all the tests need -- do not assert exact channel values anywhere.
 */
/** @type {readonly [string, string, string, string]} */
const QUADRANTS = ['0xCC2222', '0x22CC22', '0x2222CC', '0xCCCC22']

/**
 * One lavfi input producing a solid quadrant.
 *
 * @param {string} color
 * @returns {string[]}
 */
const quad = (color) => ['-f', 'lavfi', '-i', `color=c=${color}:s=${W / 2}x${H / 2}`]

/**
 * Runs ffmpeg, letting any failure surface as a thrown exec error.
 *
 * @param {string[]} args
 */
const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

/**
 * Renders one frame from four quadrant colours, in TL, TR, BL, BR order.
 *
 * @param {string} file
 * @param {readonly [string, string, string, string]} quadrants
 */
const frame = (file, [tl, tr, bl, br]) =>
  ffmpeg([
    ...quad(tl), ...quad(tr), ...quad(bl), ...quad(br),
    '-filter_complex',
    '[0:v][1:v]hstack[top];[2:v][3:v]hstack[bottom];[top][bottom]vstack[out]',
    '-map', '[out]', '-frames:v', '1', file
  ])

/**
 * The palette rotated left by `n`.
 *
 * Written as four explicit branches rather than a modulo index, so the tuple
 * shapes are checkable as-is; `n` is only ever 0-3, from `CYCLE`'s map.
 *
 * @param {number} n
 * @returns {readonly [string, string, string, string]}
 */
const rotated = (n) => {
  const [a, b, c, d] = QUADRANTS
  if (n === 0) return [a, b, c, d]
  if (n === 1) return [b, c, d, a]
  if (n === 2) return [c, d, a, b]
  return [d, a, b, c]
}

/*
 * The clip cycles through four rotations of the palette, not two.
 *
 * The tests sample it at wall-clock intervals rather than at known frame
 * indices, so what has to hold is not "do consecutive frames differ" but "do two
 * samples 500ms apart differ, whatever phase they start at". With a two-image
 * alternation held 8 frames each, a sample taken 15 frames later lands back on
 * the same image for most phases, and the assertion reads zero difference on a
 * perfectly healthy video -- a flake that looks exactly like a broken renderer.
 * Four images push that alias out to a whole 32-frame cycle (~1.07s), and every
 * gap from 8 to 24 frames (267-800ms) then has zero aliasing at every phase.
 */
const CYCLE = QUADRANTS.map((_colour, n) => rotated(n))

mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(path.join(tmpdir(), 'pano-fixtures-'))

try {
  const stills = CYCLE.map((quadrants, i) => {
    const file = i === 0 ? png : path.join(tmp, `frame-${i}.png`)
    frame(file, quadrants)
    return file
  })

  // Two passes over the cycle, so the clip loops without a seam and no sampling
  // interval shorter than a full cycle can land on the same image twice.
  // `stills` has one entry per rotation, so this is exactly the cycle twice.
  const segments = [...stills, ...stills]

  const inputs = segments.flatMap((file) => [
    // 0.25s at 30fps is 8 whole frames, which is the hold this design assumes.
    '-loop', '1', '-t', '0.25', '-r', '30', '-i', file
  ])
  const labels = segments.map((_file, i) => `[${i}:v]`).join('')

  ffmpeg([
    ...inputs,
    '-filter_complex', `${labels}concat=n=${segments.length}:v=1[out]`,
    '-map', '[out]',
    // yuv420p is the only chroma layout every browser decodes without argument.
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    // Without faststart the moov atom sits at the end of the file and the
    // browser has to fetch the whole thing before it reports a duration.
    '-movflags', '+faststart',
    mp4
  ])
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

for (const file of [png, mp4]) {
  const { size } = statSync(file)
  if (size === 0) throw new Error(`ffmpeg produced an empty ${file}`)
  console.log(`${path.relative(root, file)}  ${size} bytes`)
}
