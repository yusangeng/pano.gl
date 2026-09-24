# P7 deletion audit

Recorded before deleting anything, so that "why is this gone" has an answer
that is not `git log --follow`.

Every "Verified no live reference" cell below is the outcome of a grep run on
this branch on 2026-09-24, not a claim carried over from the plan. The two
commands that back them:

```bash
git grep -n "legacy/" -- . ':(exclude)legacy' ':(exclude)docs' ':(exclude)package-lock.json'
git grep -n "cuon" -- . ':(exclude)vendor' ':(exclude)docs'
```

Sources under `src/` and `test/` return ZERO live references — every hit there
is prose inside a comment (see "Retained mentions" below). No import, require,
or path resolution anywhere in `src/` or `test/` reaches a deleted path.

## Removed

| Path | Reason | Verified no live reference |
|---|---|---|
| `legacy/` (160K) | The v0.2.2 source tree. v1's acceptance criterion was "renders what v0.2.2 rendered"; P0–P6 closed against the captured baseline in `test/fixtures/baseline/`, so the tree itself has no remaining consumer. | `src/` and `test/`: zero live references (comment prose only, listed below). Live importers were `demo/Index.js:5-6` and `webpack/{debug,release}.js` entries — both deleted in this same task. Config mentions: `eslint.config.js:7` (deferred, see below) and `tsconfig.legacy.json` (deleted in this task). |
| `webpack/` (8K: `debug.js`, `release.js`) | The v0.2.2 build configs; both files' entry is `../legacy/index.js`. Nothing on the v1 toolchain (vite) reads them. | Zero references outside `webpack/` itself. The only other "webpack" string in the tree is a comment in `test/integration/support/baseline-browser.ts:20` describing the fixture bundle as "v0.2.2 webpack output" — prose, not a path. |
| `.babelrc` | Babel config for the legacy webpack build (`transform-decorators-legacy` etc. for `demo/Index.js`). v1 compiles nothing with babel. | Zero references. `package.json` has no babel dependency or script; the only consumer was `demo/webpack.config.js` (`babel-loader`), deleted in this task. |
| `vendor/` (24K, contains only `cuon.js`) | cuon-matrix, the v0.2.2 matrix library. v1 uses `gl-matrix` plus its own `src/core/matrix.ts`. `vendor/` has no other content, so the directory goes whole. | Only live import was `legacy/core/camera/LinearProjection.js:13`, deleted with `legacy/`. All other "cuon" hits are comment prose or the baseline fixture (listed below). |
| `tsconfig.legacy.json` | An editor-facing intent record for `legacy/`, included nothing else (`"include": ["legacy/**/*.js"]`) and is referenced by no script (`typecheck` runs the root, `test/integration`, and `tsconfig.scripts.json` programs). Its own header says "Deleted by P7 along with legacy/ itself" (final branch review MINOR 5, 2026-09-20). | Referenced by nothing: `package.json` scripts name only the three real programs; no other tsconfig extends it. |
| `demo/Index.js` | The v0.2.x demo entry: babel-decorator classes importing `../legacy/Frameless*Viewer` and libs (`litchy`, `dodele`) that v1 does not even declare. Superseded by `demo/main.ts`. | Zero references anywhere (`git grep "Index\.js"` matches only the file itself). |
| `demo/webpack.config.js` | Built the old `demo/Index.js` (`babel-loader`, `webpack-glsl-loader`). The new demo is served by `vite demo`. | Zero references anywhere. |
| `demo/index.css` | The v0.2.x demo stylesheet (`.view-wrap`, `.j-2048` button styles — selectors that target markup only the old `Index.js` demo had). The P1-rewritten `demo/index.html` styles itself inline. | Zero references anywhere (`git grep "index\.css"` matches only the file itself). |

## Kept

| Path | Reason |
|---|---|
| `demo/index.html` | This IS the new demo — P1 Task 10 rewrote it in place over the v0.2.x page (commit `24c4469`): inline styles, `<script type="module" src="./main.ts">`, and a reference to nothing that P7 deletes (grep-verified zero hits for `libs`, `fonts`, `index.css`). |
| `demo/main.ts` | The other half of the new demo — created by P1 Task 10, made the real viewer demo by P5 Task 6 (commit `18b493c`): imports `FramelessImageViewer` from `../src/index` and serves `/image/2048x1024.jpg` off the vite demo root. Deleting it would leave the README example nothing to run against. |
| `demo/image/` (20M) | The demo's showcase panoramas — `demo/main.ts` renders `/image/2048x1024.jpg` from it. Not published: `package.json` `files: ["dist"]` keeps every demo asset out of the npm tarball. |
| `demo/video/` (11M) | The demo's video showcase material, same category as `demo/image/`; kept in the repo, excluded from the tarball by `files: ["dist"]`. |
| `demo/shots/` (3.1M) | The four projection comparison screenshots Task 4 captured for the README (`linear`, `cylindrical`, `planet`, `pannini`, commit `b6877e8`). An addition, not a deletion-leftover — recorded here because this audit is the tree's asset ledger. Originally 960×540 (4,547,953 B); resized to 800×450 (3,194,929 B — the 3.1M in the size column is `du`'s MiB view, the same convention as the other rows) during the close-out CR review (2026-09-24), which found the capture size exceeded what the README's half-width table cells render. Not published: `files: ["dist"]` keeps them out of the tarball; the README references them by absolute GitHub URL. |

## Removed assets

| Path | Size | Reason |
|---|---|---|
| `demo/libs/` | 580K | The old demo's runtime dependencies: `jquery-1.10.2.min.js`, `modernizr-2.6.2.min.js`, `groundwork.all.js`, `groundwork.css`. The new demo references nothing in `libs/` — `git grep "libs\|fonts"` over `demo/index.html`, `demo/main.ts`, `src/**`, `test/**`, `vite.config.ts`, `vitest.config.ts`, `package.json` returns zero hits. |
| `demo/fonts/` | 1.7M | The old demo's webfonts: 32 files, 5 families in 8 variants (fontawesome, museo-slab-500, quicksand-regular, redacted ×4 — regular plus script light/regular/bold, sourcesanspro-regular), 4 formats each (eot/svg/ttf/woff). The same zero-hit grep covers them; the new demo has no font imports at all. |

## Never existed / already gone

`scripts/legacy-build.mjs` has no Add record in git history —
`git log --oneline --all --diff-filter=A -- scripts/legacy-build.mjs` returns
empty across every ref. The plan lists it for deletion (and its Task 2 block
has a `git rm scripts/legacy-build.mjs` line), but there is nothing to remove:
Task 2 must skip that `git rm` line, exactly the `.travis.yml` trap the plan
itself warns about — a deletion command whose path matches nothing errors out
and takes down the rest of its command line with it.

`.travis.yml` confirmed absent (`ls .travis.yml` → No such file or directory).
P1 Task 9 Step 4 deleted it when `.github/workflows/ci.yml` replaced it; this
phase only records that it is gone.

## Deferred

- `eslint.config.js:7` — the stale `'legacy/**'` ignore entry, originally
  listed as a Task 2 fix in "Removed". Re-registered here: the file is outside
  this card's scope whitelist, so editing it would fail the delivery gate. The
  entry has zero behavior impact — `legacy/` is gone, the glob matches no
  file, and `lint` stays green — and it is left for coordinator/user
  disposition.

## Config references found by the audit greps

None rides along with Task 2 any more:

- `eslint.config.js:7` — the `'legacy/**'` ignore entry. Originally listed as
  a Task 2 fix, now deferred (see "Deferred" above) because the file is
  outside this card's scope. It remains the only config in the tree that
  names a deleted path: `.gitignore`, `package.json`, `vite.config.ts`,
  `vitest.config.ts`, `tsconfig.json`, `tsconfig.scripts.json`, and
  `.github/workflows/ci.yml` were all grepped clean (`legacy` / `webpack` /
  `vendor` / `babel`), so no other config was touched.

None of the following need touching, and Task 2 should leave them alone:

- Provenance comments under `src/` and `test/` that name legacy paths or cuon:
  `src/core/reference.ts:14`, `src/renderer/webgpu/shaders/panorama.wgsl:114`,
  `src/viewer/camera-controller.ts:26`, `test/support/baseline.ts:46,60`,
  `test/unit/reference.test.ts:81`, `test/unit/camera-controller.test.ts:9`,
  `test/integration/support/viewer.ts:22`. Each documents where the transcribed
  v0.2.2 math came from or why a unit convention differs (cuon took degrees;
  v1 takes radians). After Task 2 the paths they name live only in git history,
  which is what a provenance note is for — "renders what v0.2.2 rendered" needs
  its paper trail even after the reference implementation leaves the tree.
- `test/fixtures/baseline/bundle.js` — the hash-pinned v0.2.2 oracle that
  gate A compares pixels against. It embeds compiled cuon/legacy code by
  design; its sha256 is recorded in `test/fixtures/baseline/index.json` and
  eslint ignores `test/fixtures/**` for exactly this reason. It is input data,
  not a live reference, and deleting `vendor/cuon.js` does not touch it.
