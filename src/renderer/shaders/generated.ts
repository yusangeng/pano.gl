/*
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Produced by scripts/gen-shader-constants.mjs from src/core/projection-kinds.json.
 * Edit the JSON and run `npm run gen:shaders`.
 *
 * Committed rather than built so that a stale value shows up as a failing
 * `--check` rather than as a working tree that quietly rewrites itself.
 */

/** WGSL declarations, prepended to the WGSL shader source. */
export const WGSL_CONSTANTS = 'const CAMERA_PROJECTION_LINEAR: u32 = 1u;\nconst CAMERA_PROJECTION_CYLINDRICAL: u32 = 2u;\nconst CAMERA_PROJECTION_PLANET: u32 = 3u;\nconst CAMERA_PROJECTION_PANNINI: u32 = 4u;\nconst TEXTURE_PROJECTION_EQUIRECTANGULAR: u32 = 1u;\n'

/** GLSL ES declarations, prepended to the GLSL shader source. */
export const GLSL_CONSTANTS = '#define CAMERA_PROJECTION_LINEAR 1\n#define CAMERA_PROJECTION_CYLINDRICAL 2\n#define CAMERA_PROJECTION_PLANET 3\n#define CAMERA_PROJECTION_PANNINI 4\n#define TEXTURE_PROJECTION_EQUIRECTANGULAR 1\n'
