/**
 * Types the Vite `?raw` import suffix for the root tsc program.
 *
 * That program deliberately does not include `vite/client` — a pure library's
 * typecheck should not have to know Vite exists (the vite.config.ts build note
 * records this arrangement). The declaration describes only the import's
 * shape: Vite's `?raw` suffix yields the file's contents as a string. Runtime
 * behavior is Vite's, in dev, test, and lib-mode build alike.
 */
declare module '*.wgsl?raw' {
  const source: string
  export default source
}
