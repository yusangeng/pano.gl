import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import kinds from '../../src/core/projection-kinds.json'
import {
  PROJECTION_KINDS,
  cameraProjectionCode,
  textureProjectionCode
} from '../../src/core/constants'
import type { TextureProjection } from '../../src/core/constants'

const repoRoot = path.resolve(__dirname, '../..')

// The guard tests walk the whole of src/, not a hand-picked file list -- a
// scan that only covers the files the rule was written for cannot catch the
// next file that breaks it.
const srcTsFiles = readdirSync(path.join(repoRoot, 'src'), { recursive: true, encoding: 'utf8' })
  .filter(entry => entry.endsWith('.ts'))
  .map(entry => path.join(repoRoot, 'src', entry))

/*
 * The one place a bare fisheye token is allowed to appear, and the reason the
 * scan below is not simply "every file under src/".
 *
 * `specs/2026-09-19-pano-gl-v1-design.md:247` requires that `'fisheye'` stays
 * recognisable at the boundary and throws at construction -- the legacy code
 * accepted it, then failed on the first frame. `src/viewer/options.ts` is that
 * boundary, so it has to name the projection in the check, in the throw, and in
 * the prose explaining both.
 *
 * An entry here is EARNED, not granted, and the earning is asserted rather than
 * described: the test below calls the exempt file and requires it to reject
 * `'fisheye'` for real. Without that, this list would be a claim about
 * behaviour with nothing executing it -- deleting the rejection while leaving
 * the exemption would keep the scan green, which is the exact shape of failure
 * this file exists to prevent.
 *
 * Narrowing the regex is not the alternative. "Only flag a fisheye
 * *declaration*" asks a regex to tell a declaration from a mention, and one
 * that tries will next flag something that is neither -- this card has already
 * paid for that lesson once (see p5-plan-errata.md E29).
 */
const FISHEYE_REJECTION_SITES = ['src/viewer/options.ts']
  .map(entry => path.join(repoRoot, entry))

// The JSON source is scanned alongside the TypeScript files, because a kind
// that sneaks into either side of the bridge is the same bug. The exemption is
// TypeScript-only: an entry in the JSON is a declaration by construction, never
// prose.
const fisheyeScanFiles = [
  ...srcTsFiles.filter(file => !FISHEYE_REJECTION_SITES.includes(file)),
  path.join(repoRoot, 'src/core/projection-kinds.json')
]

describe('projection kinds', () => {
  it('uploads the numeric values the legacy shader hard-coded', () => {
    // These are not free choices. They are the numbers the GLSL #defines have
    // always used, and the P0 baseline fixtures were captured with them. If
    // this test fails, the baseline comparison in Task 3 is meaningless.
    expect(cameraProjectionCode('linear')).toBe(1)
    expect(cameraProjectionCode('cylindrical')).toBe(2)
    expect(cameraProjectionCode('planet')).toBe(3)
    expect(cameraProjectionCode('pannini')).toBe(4)
    expect(textureProjectionCode('equirectangular')).toBe(1)
  })

  it('keeps the wire numbers out of the public API', () => {
    // The whole reason kinds are strings. A caller writing `{ kind: 'planet' }`
    // must not be able to write `{ kind: 3 }`, and the type must be the thing
    // that stops them -- not a runtime check that only fires in production.
    expect(PROJECTION_KINDS).toEqual(['linear', 'cylindrical', 'planet', 'pannini'])
    for (const kind of PROJECTION_KINDS) {
      expect(typeof kind).toBe('string')
    }
  })

  it('keeps the JSON keys and the TypeScript union in lockstep', () => {
    // resolveJsonModule types the JSON exactly as written, so a key added to
    // the file without a matching member in ProjectionKind typechecks silently
    // and stays invisible until a caller trips over it. Set equality fails on
    // the day of the edit instead.
    expect(Object.keys(kinds.camera).sort()).toEqual([...PROJECTION_KINDS].sort())
  })

  it('has no fisheye entry, because fisheye is not implemented', () => {
    // The legacy code had a PROJECTION_FISHEYE constant that was only assigned
    // inside a commented-out branch, while the shader's tex_proj_fisheye
    // returned vec2(0.0) and the JS side threw. The two sides contradicted each
    // other. The fix is to not describe a projection that does not exist. The
    // regex is the bare token, case-insensitive, because the old spelling
    // ('fisheye'|Fisheye|FISHEYE) does not match a quoted JSON key like
    // "fisheye": 5 -- and the JSON is exactly where an entry would reappear.
    //
    // `fisheyeScanFiles` is every .ts file under src/ except
    // FISHEYE_REJECTION_SITES, plus the JSON -- and the exception is paid for
    // by the behavioural test below, not asserted away here.
    for (const file of fisheyeScanFiles) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/fisheye/i)
    }
  })

  it('grants the fisheye exemption only where the rejection is real', async () => {
    // What makes FISHEYE_REJECTION_SITES an exemption rather than a hole. The
    // list is consulted by the scan above; this is the half that keeps the list
    // honest, by running the exempt file instead of trusting a comment about
    // it.
    //
    // The two assertions fail in opposite directions, and both are wanted.
    // Disable the fisheye branch in `options.ts` -- leaving every token in
    // place, which is the mutation a scan cannot see -- and the file still
    // needs its exemption for the prose while no longer deserving it, so the
    // exemption has to be re-argued rather than quietly inherited. Delete the
    // mentions instead and the file stops needing the exemption at all, so the
    // entry has to go; an exemption nothing needs is a hole left open.
    for (const site of FISHEYE_REJECTION_SITES) {
      expect(readFileSync(site, 'utf8'), site).toMatch(/fisheye/i)
    }
    const { validateImageOptions } = await import('../../src/viewer/options')
    expect(
      () => validateImageOptions({
        container: { nodeType: 1 } as HTMLElement,
        src: 'pano.jpg',
        // The cast is the JavaScript caller the runtime check exists for: the
        // type deliberately does not include 'fisheye'.
        projection: 'fisheye' as TextureProjection
      }),
      'the exempted file must reject fisheye, or it has no claim on the exemption'
    ).toThrow(/not implemented/)
    // `/not implemented/`, not `/fisheye/`. The file also rejects fisheye by
    // falling through to `unknown projection: fisheye`, and that message
    // contains the token too -- so a looser regex would still pass against a
    // file whose fisheye branch had been disabled, which is the case this
    // assertion exists to catch. The exemption is for naming the projection
    // distinctly, so it has to be a distinct rejection that earns it.
  })

  it('leaves no texture key stranded on the JSON side of the bridge', () => {
    // The texture half of the lock `keeps the JSON keys and the TypeScript
    // union in lockstep` applies to `camera`, and `034069a` is the commit that
    // opened it: it pinned `Object.keys(kinds.camera)` to PROJECTION_KINDS and
    // left `texture` without a twin. This is that twin, not new scope.
    //
    // Two assertions doing different jobs. The literal names the requirement
    // outright -- an entry for a projection that does not exist is what would
    // appear here -- and, like the camera lock, fails on the day of the edit
    // rather than at some later call site. The loop then checks the values
    // agree across the bridge, which the literal cannot see: it fails if the
    // two sides ever stop being the same number.
    //
    // The literal is what makes a stranded key impossible, so the loop is not
    // carrying that weight and is not described as if it were. Neither restates
    // the union in this file, which is the one thing this file must not become.
    //
    // A key REMOVED from `texture` is caught by the literal, and also by `are up
    // to date with the JSON source` above, where the generator runs out of a
    // number to emit.
    expect(Object.keys(kinds.texture)).toEqual(['equirectangular'])
    for (const key of Object.keys(kinds.texture)) {
      expect(textureProjectionCode(key as TextureProjection), key)
        .toBe(kinds.texture[key as TextureProjection])
    }
  })

  it('is the only place these numbers appear', () => {
    // The whole point of the JSON file. If someone re-declares the numbers
    // inline anywhere in src/, the two-copies-by-luck problem is back. The
    // generated constants file is naturally immune: its lines begin with
    // `const`, `#` or `export`, never with a bare kind name.
    const offenders: string[] = []
    for (const file of srcTsFiles) {
      const src = readFileSync(file, 'utf8')
      for (const line of src.split('\n')) {
        if (/^\s*(linear|cylindrical|planet|pannini|equirectangular)\s*:\s*\d/.test(line)) {
          offenders.push(`${path.relative(repoRoot, file)}: ${line.trim()}`)
        }
      }
    }
    expect(offenders, 'declare kinds in projection-kinds.json, not in code').toEqual([])
  })
})

describe('generated shader constants', () => {
  it('are up to date with the JSON source', async () => {
    // Runs the generator in --check mode. Catches the case where someone edits
    // projection-kinds.json and forgets to regenerate -- which would leave the
    // shader reading one number and the CPU another, silently.
    const { spawnSync } = await import('node:child_process')
    const r = spawnSync(process.execPath, ['scripts/gen-shader-constants.mjs', '--check'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
    expect(r.status, r.stderr).toBe(0)
  })

  it('declares the same numbers as the TypeScript constants', async () => {
    // The one assertion that makes the whole JSON arrangement worth it: the
    // strings TS callers write, the integers uploaded as u_CamProjType, and the
    // GLSL/WGSL constants the shader compares against are proven equal here.
    const { WGSL_CONSTANTS, GLSL_CONSTANTS } = await import('../../src/renderer/shaders/generated')
    for (const kind of PROJECTION_KINDS) {
      const value = cameraProjectionCode(kind)
      const snake = kind.toUpperCase()
      expect(WGSL_CONSTANTS).toContain(`const CAMERA_PROJECTION_${snake}: u32 = ${value}u;`)
      expect(GLSL_CONSTANTS).toContain(`#define CAMERA_PROJECTION_${snake} ${value}`)
    }
    const tex = textureProjectionCode('equirectangular')
    expect(WGSL_CONSTANTS).toContain(`const TEXTURE_PROJECTION_EQUIRECTANGULAR: u32 = ${tex}u;`)
    expect(GLSL_CONSTANTS).toContain(`#define TEXTURE_PROJECTION_EQUIRECTANGULAR ${tex}`)
  })
})
