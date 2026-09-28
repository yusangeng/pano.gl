/**
 * Resolves a root-absolute demo asset path against the page's base URI.
 *
 * The dev server serves demo/ at the origin root, so '/image/...' resolves
 * as written there. GitHub Pages serves the same build under /pano.gl/',
 * where a root-absolute path escapes the project prefix and 404s. Stripping
 * the leading slash makes the path relative, which URL resolution then
 * applies to whatever directory the page actually lives in — correct in
 * both environments, with no knowledge of the deploy target in demo code.
 */
export function assetUrl (path: string): string {
  return new URL(path.replace(/^\//, ''), document.baseURI).href
}
