import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

// demo/image and demo/video are referenced by URL at runtime, not through
// the bundler, so vite never sees them as inputs. publicDir would have to be
// demo/ itself to pick them up, which would also ship the demo sources and
// every html page as static files; copying just these two trees is narrower.
const copyDemoMedia = (): Plugin => ({
  name: 'copy-demo-media',
  closeBundle: async () => {
    await cp(`${repoRoot}demo/image`, `${repoRoot}demo-dist/image`, { recursive: true })
    await cp(`${repoRoot}demo/video`, `${repoRoot}demo-dist/video`, { recursive: true })
  }
})

// The lib build (vite.config.ts) and this demo-site build are unrelated
// outputs of the same sources: the demo imports src/ directly and ships as
// a plain static site.
export default defineConfig({
  root: 'demo',
  // GitHub Pages serves a project site under /pano.gl/, so generated asset
  // URLs carry that prefix. Media URLs inside the demo are handled at
  // runtime by demo/asset-url.ts for the same reason.
  base: '/pano.gl/',
  publicDir: false,
  plugins: [copyDemoMedia()],
  build: {
    outDir: '../demo-dist',
    // outDir sits outside root 'demo', where vite refuses to empty it on
    // rebuilds unless told to — without this, stale hashed assets accumulate.
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: `${repoRoot}demo/index.html`,
        minimal: `${repoRoot}demo/minimal.html`
      }
    }
  }
})
