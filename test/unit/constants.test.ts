import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import kinds from '../../src/core/projection-kinds.json'
import {
  PROJECTION_KINDS,
  cameraProjectionCode,
  textureProjectionCode
} from '../../src/core/constants'

const repoRoot = path.resolve(__dirname, '../..')

// The guard tests walk the whole of src/, not a hand-picked file list -- a
// scan that only covers the files the rule was written for cannot catch the
// next file that breaks it.
const srcTsFiles = readdirSync(path.join(repoRoot, 'src'), { recursive: true, encoding: 'utf8' })
  .filter(entry => entry.endsWith('.ts'))
  .map(entry => path.join(repoRoot, 'src', entry))

// The JSON source is scanned alongside the TypeScript files, because a kind
// that sneaks into either side of the bridge is the same bug.
const fisheyeScanFiles = [...srcTsFiles, path.join(repoRoot, 'src/core/projection-kinds.json')]

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
    for (const file of fisheyeScanFiles) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/fisheye/i)
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
