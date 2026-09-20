import neostandard from 'neostandard'

export default [
  ...neostandard({
    ts: true,
    ignores: [
      'legacy/**',
      'dist/**',
      '.package/**',
      'doc/**',
      /*
       * The v0.2.2 baseline fixtures include the vendored UMD bundle the
       * captures were rendered from. Its sha256 is recorded in
       * test/fixtures/baseline/index.json and the P0 manifest check fails if
       * the bytes ever change, so "fixing" its style is not an option -- it is
       * hash-pinned input data, the same category of non-source as dist/.
       */
      'test/fixtures/**'
    ]
  })
]
