import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    // One .d.ts per source file, emitted next to the js. A single rollup'd
    // index.d.ts would pull api-extractor in for no benefit while src/ still
    // has one module; revisit if the public surface ever needs flattening.
    dts()
  ],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es', 'cjs'],
      fileName: format => (format === 'es' ? 'index.js' : 'index.cjs')
    },
    sourcemap: true,
    // Lib mode minifies by default; tsup did not. The toolchain pivot must
    // not silently flip recorded behavior, and an unminified bundle is the
    // one a consumer can actually read in node_modules while debugging
    // GPU math. (Task 4 quality review, 2026-09-20.)
    minify: false
    // No rollupOptions.external: lib mode externalizes package.json
    // "dependencies" by default, so gl-matrix and debug are importable from
    // the consumer's own install -- which is what a library dependency list
    // means. Bundling them in would be the thing that needs justifying.
    //
    // Shaders: the .glsl/.wgsl files stay real files and reach the bundle via
    // `import x from './panorama.wgsl?raw'` (P3). Vite handles that natively
    // in dev and lib mode alike; the root tsc program never needs vite/client
    // for it because a small local `declare module '*.wgsl?raw'` ambient file
    // types the suffix. scripts/gen-shader-constants.mjs stays regardless --
    // its job is the numeric projection-kind constants shared by TS + WGSL +
    // GLSL, which has nothing to do with which bundler moves the bytes.
  }
})
