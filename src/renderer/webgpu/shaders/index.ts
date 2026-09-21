/**
 * Assembles the final WGSL source.
 *
 * The projection kind constants are generated from `src/core/projection-kinds.json`
 * and prepended here rather than written into the shader file, so the numbers in
 * the shader and the numbers in TypeScript cannot drift. In the legacy code they
 * were two independent hand-maintained copies.
 *
 * WGSL has no preprocessor, which is why the generated form is `const`
 * declarations rather than `#define`.
 */

// '../../shaders/generated' -- the generated module is shared with the WebGL2
// backend that P6 adds, so it sits at src/renderer/shaders/, not inside this
// directory.
import { WGSL_CONSTANTS } from '../../shaders/generated'
import panoramaSource from './panorama.wgsl?raw'

export const PANORAMA_WGSL = `${WGSL_CONSTANTS}\n${panoramaSource}`
