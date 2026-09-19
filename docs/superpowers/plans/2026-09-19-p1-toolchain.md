# P1 — 工具链骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 让 `npm run build` 出包、`npm test` 真的在跑测试、CI 会因 WebGPU 不可用而**红**。不写任何产品逻辑。

**Architecture:** 新实现与旧实现**并存于同一仓库、同一分支**：旧源码 `git mv` 到 `legacy/`（webpack 配置随之指向），新源码从零开始写在 `src/`。`legacy/` 的构建脚本原样保留并在 CI 里跑，保证 v0.2.x 全程可以发版。

**Tech Stack:** TypeScript 5 (strict) · tsup (esbuild) · vitest · Playwright · neostandard · GitHub Actions

---

## ⚠️ 一个需要明确拍板的动作

**本计划的第一件事是把旧源码从 `src/` 移到 `legacy/`。**

spec §10.5 写的是「旧代码不被触碰」。这次移动**不违背它的本意**（v0.2.x 全程可构建、可发布），但确实是**字面意义上的触碰**，所以在这里显式记一笔：

- **为什么必须移**：新分层要占 `src/core/` 和 `src/viewer/`，这两个目录名旧的也在用。让两棵树交错在同一个目录里，会让 P2–P6 每一步都要先判断「这个文件是新的还是旧的」，代价贯穿全程。
- **风险**：webpack 配置里的路径。极低 —— 一次构建即可验证。
- **兜底**：Task 2 的验证步骤会在移动后重建 bundle 并与 P0 的存档做内容比对。不一致就回滚这次 `git mv`，退回交错方案。

**如果执行者认为这个动作不可接受**：停下，把这一条作为卡点上报，不要自行发明第三种布局。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `legacy/**` | v0.2.2 的全部旧源码，原样迁移，只改引用它的构建配置 |
| `src/` | **新实现的唯一根目录**，P1 时只有 `diagnostics.ts` 和 `index.ts` |
| `test/unit/` | vitest 单元测试 |
| `test/integration/` | Playwright 集成测试 |
| `scripts/` | 构建期脚本（P2 起是 shader 常量生成器） |
| `tsconfig.json` | strict + `noUncheckedIndexedAccess` |
| `tsup.config.ts` | 打包配置，两套入口 |
| `vitest.config.ts` | 单元测试 + 覆盖率阈值 |
| `playwright.config.ts` | 集成测试，**含 WebGPU 守卫** |

---

### Task 1: 迁移旧源码到 legacy/

**Files:**
- Move: `src/` → `legacy/`
- Modify: `webpack/debug.js`, `webpack/release.js`, `demo/webpack.config.js`, `package.json`

- [ ] **Step 1: 先确认迁移前是绿的**

Run: `npm install && npm run build-debug && ls -la .package/`
Expected: `.package/bundle.js` 与 `.package/BundleSizeDebug.html` 存在

记下现在的大小：
```bash
wc -c .package/bundle.js | tee /tmp/pano-prepare-bundle-size.txt
```

- [ ] **Step 2: 移动**

```bash
git mv src legacy
git status --short | head -40
```

- [ ] **Step 3: 更新构建配置里的路径**

`git grep -n "src/" -- webpack demo package.json` 会列出所有引用点。逐个改：

- `webpack/debug.js` / `webpack/release.js`：`entry` / `resolve.modules` / loader 的 `include` 里凡是 `path.resolve(__dirname, '../src')` 一律改成 `'../legacy'`。
- `demo/webpack.config.js`：引用 `../src` 的地方改成 `../legacy`。
- `package.json`：`es5` 脚本 `babel src -d lib` 改成 `babel legacy -d lib`。

**顺带修掉 CLAUDE.md 记录的已知缺陷**：`demo/webpack.config.js` 的 `entry: './index.js'` 与实际文件 `Index.js` 大小写不符，在 Linux/CI 上失败。改成 `'./Index.js'`。

- [ ] **Step 4: 重建并比对**

```bash
npm run build-debug && wc -c .package/bundle.js
```
Expected: 与 Step 1 记下的字节数**完全一致**。

若不一致，`git diff` 两个 bundle 找出差异；**若差异涉及函数体而非路径注释，回滚整个 Task（`git reset --hard && git clean -fd`）并上报卡点。**

- [ ] **Step 5: 确认基线 fixture 仍可用**

Run: `cd tools/baseline && node verify-fixtures.mjs`
Expected: 6 个测试 PASS

（基线 fixture 用的是存档 bundle，不随源码移动而变 —— 这一步确认的是它没被误改。）

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move v0.2.2 sources to legacy/ to free src/ for the rewrite

The new layering needs src/core/ and src/viewer/, both of which the old
tree already uses. Interleaving the two would make every subsequent commit
start with 'is this file new or old'. The legacy build is untouched
otherwise: npm run build-debug produces a byte-identical bundle."
```

---

### Task 2: package.json 重写

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 写新的 package.json**

```json
{
  "name": "pano.gl",
  "version": "1.0.0-alpha.0",
  "description": "Dependency-light WebGPU/WebGL2 viewer for equirectangular 360 images and video",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "build:legacy": "node scripts/legacy-build.mjs",
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:integration": "playwright test",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src test scripts",
    "gen:shaders": "node scripts/gen-shader-constants.mjs",
    "start": "vite demo",
    "doc": "typedoc"
  },
  "dependencies": {
    "gl-matrix": "^3.4.3",
    "debug": "^4.4.3"
  },
  "devDependencies": {
    "@types/debug": "^4.1.12",
    "@types/pngjs": "^6.0.5",
    "@vitest/coverage-v8": "^3",
    "eslint": "^9",
    "neostandard": "^0.12.0",
    "playwright": "^1.63.0",
    "@playwright/test": "^1.63.0",
    "pngjs": "^7.0.0",
    "tsup": "^8",
    "typedoc": "^0.28",
    "typescript": "^5.9",
    "vite": "^7",
    "vitest": "^3"
  }
}
```

**与旧 package.json 的差异是刻意的**：`babel` / `babel-*` / `webpack` / `webpack-glsl-loader` / `isparta` / `istanbul` / `mocha` / `chai` / `litchy` / `konph` / `polygala` / `shortid` / `lodash` / `chivy` / `param-check` / `dodele` **全部退出**。

> `pngjs` 装在 P1 而不是用它的 P2/P3，因为「测试要读基线 PNG」这件事从 P0 存下 `test/fixtures/baseline/*.png` 的那一刻就定了。它进 devDependencies 而不是 dependencies：只被测试读，运行时不碰。`test/support/baseline.ts` 和 P3 的门禁 A 都从它取像素。

> `build:legacy` 需要 webpack 与 babel 的依赖。它们**必须留着**直到 P7 —— 否则 v0.2.x 就发不了版了。见 Task 6。

- [ ] **Step 2: 确认依赖树不再包含旧库**

Run: `npm install && npm ls litchy konph polygala shortid chivy param-check dodele 2>&1 | tail -20`
Expected: 每条 `(empty)` 或 `not found`。**除 `build:legacy` 需要的 webpack/babel 外，运行时依赖树里不应再出现它们。**

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: replace the babel 6 / webpack 3 toolchain with tsup + vitest

Dependencies drop from 8 to 3: gl-matrix, debug, and debug's ms. The
legacy build keeps its own dependencies until P7 deletes the code."
```

---

### Task 3: TypeScript 配置

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.legacy.json`（让编辑器不为 `legacy/` 里的 JS 报错）

- [ ] **Step 1: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["@webgpu/types"],

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,

    "declaration": true,
    "sourceMap": true,
    "noEmit": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.mjs"]
}
```

**`noUncheckedIndexedAccess` 是刻意的**：spec §7.4 说明删掉 `param-check` 的前提是类型够严。它会让 `arr[i]` 的类型变成 `T | undefined`，一开始会很烦 —— 但那正是 GPU 缓冲下标这类代码该有的严谨度。**不要为了省事关掉它。**

`@webgpu/types` 需要装：把它加进 devDependencies。

- [ ] **Step 2: 写 legacy 的隔离配置**

`tsconfig.legacy.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "checkJs": false, "allowJs": true, "noEmit": true },
  "include": ["legacy/**/*.js"]
}
```

**目的**：让编辑器知道 `legacy/` 是 Babel 6 时代的 JS，不要拿新规则去检查它。它不参与 `npm run typecheck`。

- [ ] **Step 3: 加 @webgpu/types 并确认类型可用**

```bash
npm i -D @webgpu/types
npm run typecheck
```
Expected: 退出码 0（此时 `src/` 几乎是空的）

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json tsconfig.legacy.json package.json package-lock.json
git commit -m "build: strict TypeScript config with WebGPU types"
```

---

### Task 4: 打包配置

**Files:**
- Create: `tsup.config.ts`

- [ ] **Step 1: 写配置**

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  // The shaders are TypeScript string constants by the time they reach here
  // (see scripts/gen-shader-constants.mjs), so there is no .glsl/.wgsl loader to
  // configure. That is the whole point: the published artifact has no external
  // resource dependencies, unlike the legacy lib/ which shipped unresolved
  // require('../shader/vshader.glsl') calls.
  external: ['debug']
})
```

- [ ] **Step 2: 造一个最小入口让它能跑**

`src/index.ts`：

```ts
/**
 * pano.gl -- equirectangular 360 image and video viewer.
 *
 * The public surface is intentionally tiny. Everything else lives behind the
 * viewer classes so that the internal layering stays free to move.
 */

export const VERSION = '1.0.0-alpha.0'
```

- [ ] **Step 3: 构建**

Run: `npm run build && ls -la dist/`
Expected：`index.js`、`index.cjs`、`index.d.ts`、`index.d.ts.map`、两个 `.map`

- [ ] **Step 4: 确认产物可以被普通 Node 加载**

```bash
node -e "import('./dist/index.js').then(m => console.log('esm ok:', m.VERSION))"
node -e "console.log('cjs ok:', require('./dist/index.cjs').VERSION)"
```
Expected：
```
esm ok: 1.0.0-alpha.0
cjs ok: 1.0.0-alpha.0
```

**这一条是本任务的核心验收**：它正是旧 `lib/` 做不到的事（`lib/index.js` 里有无法解析的 `.glsl` require）。

- [ ] **Step 5: Commit**

```bash
git add tsup.config.ts src/index.ts
git commit -m "build: tsup bundle producing self-contained esm + cjs"
```

---

### Task 5: 日志通道

**Files:**
- Create: `src/diagnostics.ts`
- Create: `test/unit/diagnostics.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { channels, enableChannels } from '../../src/diagnostics'

describe('diagnostics', () => {
  it('exposes the trace channels the library actually uses', () => {
    expect(Object.keys(channels).sort()).toEqual(
      ['camera', 'gpu', 'input', 'media', 'renderer', 'viewer'].sort()
    )
  })

  it('leaves every channel silent by default', () => {
    // A library that writes to the console on import is a library people
    // uninstall. debug's whole value here is that the default is silence.
    for (const fn of Object.values(channels)) {
      expect(fn.enabled).toBe(false)
    }
  })

  it('enables exactly the namespaces that match the pattern', () => {
    const restore = enableChannels('pano:gpu')
    try {
      expect(channels.gpu.enabled).toBe(true)
      expect(channels.media.enabled).toBe(false)
    } finally {
      restore()
    }
  })

  it('restores the previous state when the returned undo runs', () => {
    const before = channels.gpu.enabled
    const restore = enableChannels('pano:*')
    expect(channels.gpu.enabled).toBe(true)
    restore()
    expect(channels.gpu.enabled).toBe(before)
  })

  it('treats an empty pattern as enable nothing', () => {
    const restore = enableChannels('')
    try {
      expect(Object.values(channels).some(fn => fn.enabled)).toBe(false)
    } finally {
      restore()
    }
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:unit -- diagnostics`
Expected: FAIL —— `Failed to resolve import "../../src/diagnostics"`

- [ ] **Step 3: 实现**

`src/diagnostics.ts`：

```ts
/**
 * Trace channels for pano.gl.
 *
 * Two rules govern everything here:
 *
 * 1. Nothing is written to the console unless the host application asked for it.
 *    The library ships inside other people's pages; a console log nobody opted
 *    into is a bug report waiting to happen.
 * 2. Anything the *application* needs to know is an event on the viewer, never
 *    a log line. `debug` is for diagnosing the library from the outside; it is
 *    not a control channel. If you find yourself grepping logs to decide what
 *    UI to show, the thing you want is an event.
 *
 * Usage from an application:
 *
 *     import { enableChannels } from 'pano.gl'
 *     enableChannels('pano:gpu,pano:renderer')
 *
 * Or from outside the page entirely:
 *
 *     DEBUG=pano:*,-pano:media
 */

import createDebug from 'debug'

/**
 * Trace channels, declared once. Creating them anywhere else would let a typo
 * produce a channel that silently never fires -- which is indistinguishable
 * from code that never runs.
 */
export const channels = {
  viewer: createDebug('pano:viewer'),
  renderer: createDebug('pano:renderer'),
  gpu: createDebug('pano:gpu'),
  camera: createDebug('pano:camera'),
  media: createDebug('pano:media'),
  input: createDebug('pano:input')
} as const

export type ChannelName = keyof typeof channels

/**
 * Enables the named namespaces and returns a function that puts the previous
 * state back.
 *
 * `debug` has a single global enable list, so enabling is process-wide rather
 * than per-instance. Returning the undo keeps tests from leaking an enabled
 * channel into the next test.
 *
 * @param namespaces - A `debug` namespace pattern, e.g. `'pano:gpu'` or
 *   `'pano:*,-pano:media'`. An empty string enables nothing.
 * @returns A function restoring the enabled set that was in effect before.
 */
export function enableChannels (namespaces: string): () => void {
  const previous = createDebug.disable()
  createDebug.enable(namespaces)
  const enabled = createDebug.disable() ?? ''
  createDebug.enable(previous)
  createDebug.enable(enabled)

  return () => {
    createDebug.disable()
    createDebug.enable(previous)
  }
}
```

> **实现上的坑**：`debug` 没有「读当前 enable 列表」的公开 API。`disable()` 返回上一次的列表（这是它的既有行为），所以上面用了一次「取出 → 恢复 → 再设」的往返。若 `@types/debug` 把 `disable()` 标成 `void`，用 `(createDebug.disable as () => string | undefined)()` 取。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:unit -- diagnostics`
Expected: 5 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics.ts test/unit/diagnostics.test.ts
git commit -m "feat: opt-in trace channels built on debug"
```

---

### Task 6: legacy 构建保留

**Files:**
- Create: `scripts/legacy-build.mjs`
- Modify: `package.json`

- [ ] **Step 1: 把旧构建的依赖装回来**

旧的 webpack/babel 依赖在 Task 2 被移除了，但 `build:legacy` 需要它们。装回来：

Run: `npm i -D webpack@3 webpack-dev-server@2 babel-cli@6 babel-core@6 babel-loader@6 babel-preset-es2015@6 babel-plugin-transform-decorators-legacy@1 babel-plugin-transform-class-properties@6 webpack-glsl-loader@1`

> **版本号必须与旧 package.json 一致**。先 `git show HEAD~N:package.json`（N 指到 Task 2 之前）把原版本抄下来，不要凭记忆写。

- [ ] **Step 2: 写 legacy 构建脚本**

`scripts/legacy-build.mjs`：

```js
/*
 * Builds the v0.2.x UMD bundle from legacy/.
 *
 * This exists so the shipping version keeps building while the rewrite is in
 * progress. It is deleted in P7 along with legacy/ itself.
 *
 * The legacy webpack config is CommonJS and predates "type": "module", so it is
 * loaded through createRequire rather than imported.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const config = require(path.join(repoRoot, 'webpack/debug.js'))
const webpack = require('webpack')

webpack(config, (err, stats) => {
  if (err) { console.error(err); process.exit(1) }
  const info = stats.toJson({ errors: true, warnings: false })
  if (stats.hasErrors()) {
    console.error(info.errors.map(e => e.message || e).join('\n'))
    process.exit(1)
  }
  console.log(`legacy bundle ok: ${path.relative(repoRoot, config.output.path)}`)
})
```

- [ ] **Step 3: 验证新旧两套构建互不干扰**

```bash
npm run build && npm run build:legacy && npm run build
ls dist/ .package/
```
Expected: `dist/` 与 `.package/` 双双存在；`build:legacy` 的输出没有污染 `dist/`

- [ ] **Step 4: Commit**

```bash
git add scripts/legacy-build.mjs package.json package-lock.json
git commit -m "build: keep the v0.2.x bundle buildable during the rewrite"
```

---

### Task 7: 单元测试配置

**Files:**
- Create: `vitest.config.ts`
- Create: `test/unit/tsconfig.json`（可选，若编辑器需要）

- [ ] **Step 1: 写配置**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        // Pure type declarations compile to nothing, so there is no branch to
        // cover. Listing them keeps the threshold meaningful rather than
        // diluted by files that can never contribute.
        'src/**/types.ts'
      ],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90
      }
    }
  }
})
```

- [ ] **Step 2: 确认覆盖率门槛真的会拦人**

Run: `npm run test:coverage`
Expected: PASS（此时 `src/` 只有两个文件，且都有测试）

临时把 `src/index.ts` 从 exclude 里去掉再跑一次，确认它**失败** —— 证明门槛不是摆设。改回来。

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: vitest with a 90% branch threshold that actually fails the build"
```

---

### Task 8: Playwright 配置与 WebGPU 守卫

**Files:**
- Create: `playwright.config.ts`
- Create: `test/integration/support/fixtures.ts`
- Create: `test/integration/smoke.test.ts`

这是本计划**最重要的一步**。spec §9.5 已用实测钉死：Playwright 默认 headless 起的是 `chrome-headless-shell`，**WebGL 正常、WebGPU 拿不到适配器**。不写守卫的话，整套 WebGPU 测试会变成空跑而 CI 一路绿灯。

- [ ] **Step 1: 写配置**

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/integration',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // Serve the repo over http:// -- WebGPU requires a secure context.
    baseURL: 'http://localhost:5173'
  },
  projects: [
    {
      name: 'chromium-gpu',
      use: {
        ...devices['Desktop Chrome'],
        /*
         * channel: 'chromium' is load-bearing, and not for the reason it looks
         * like. Playwright's default headless launch uses chrome-headless-shell,
         * a separate binary with no GPU stack: WebGL still works (through
         * SwiftShader) and renders correct pixels, but requestAdapter() returns
         * null, so every WebGPU test no-ops. The failure mode is "looks fine",
         * not "reports an error".
         *
         * Do not remove this to make CI faster, and do not add --disable-gpu.
         * The guard in test/integration/support/fixtures.ts is what turns a
         * silent downgrade into a red build.
         */
        channel: 'chromium'
      }
    }
  ],
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI
  }
})
```

- [ ] **Step 2: 写守卫 fixture**

`test/integration/support/fixtures.ts`：

```ts
import { test as base, expect } from '@playwright/test'

/**
 * A page that has been proven to have a working WebGPU adapter.
 *
 * Every WebGPU test must use this instead of the base `test`. Playwright's
 * default headless launch has no WebGPU at all, and without an explicit check
 * the whole suite silently passes while testing nothing.
 */
export const test = base.extend<{ gpuPage: import('@playwright/test').Page }>({
  gpuPage: async ({ page }, use) => {
    await page.goto('/')

    const report = await page.evaluate(async () => {
      if (!('gpu' in navigator) || !navigator.gpu) {
        return { ok: false, reason: 'navigator.gpu is undefined' }
      }
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        return {
          ok: false,
          reason:
            'requestAdapter() returned null. If this ran under chrome-headless-shell ' +
            '(Playwright default) that is expected -- set channel: "chromium". ' +
            'Check with: DEBUG=pw:browser npx playwright test'
        }
      }
      return { ok: true, info: adapter.info }
    })

    expect(
      report.ok,
      `WebGPU unavailable: ${'reason' in report ? report.reason : 'unknown'}`
    ).toBe(true)

    await use(page)
  }
})

export { expect }
```

- [ ] **Step 3: 写冒烟测试**

`test/integration/smoke.test.ts`：

```ts
import { test, expect } from './support/fixtures'

test('the CI browser has a real WebGPU adapter', async ({ gpuPage }) => {
  const info = await gpuPage.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter()
    // Non-null: the fixture already asserted it.
    return adapter!.info
  })
  console.log('adapter:', JSON.stringify(info))
  expect(info).toBeTruthy()
})

test('docs/superpowers/plans is served, so the web server is the repo', async ({ gpuPage }) => {
  // Proves baseURL points at a real server rooted in this repo rather than
  // some default page. Cheap, and it catches a misconfigured webServer before
  // it shows up as a confusing failure in a real test.
  const res = await gpuPage.request.get('/package.json')
  expect(res.ok()).toBe(true)
  const pkg = await res.json()
  expect(pkg.name).toBe('pano.gl')
})
```

- [ ] **Step 4: 跑集成测试**

Run: `npx playwright install chromium && npm run test:integration`
Expected: 2 个测试 PASS，控制台打出 `adapter: {"vendor":"apple","architecture":"metal-3",...}`（厂商名随机器而变）

- [ ] **Step 5: 证明守卫真的会拦人**

Run: `npx playwright test --project=chromium-gpu --config=<(sed "s/channel: 'chromium'/channel: undefined/" playwright.config.ts) 2>&1 | tail -20`

（若进程替换在你的 shell 里不好使，就临时把 `channel: 'chromium'` 改成 `channel: undefined`，跑完改回来。）

Expected: **FAIL**，错误信息包含 `requestAdapter() returned null`。

**这一步不能省。** 一个从未失败过的守卫不算守卫。

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts test/integration/
git commit -m "test: playwright config with a WebGPU guard that fails loudly

Playwright's default headless binary renders WebGL correctly through
SwiftShader but exposes no WebGPU adapter, so a suite that only asserts
'pixels appeared' passes while testing nothing. The guard turns that
silent downgrade into a red build."
```

---

### Task 9: lint 与 CI

**Files:**
- Create: `eslint.config.js`
- Create: `.github/workflows/ci.yml`
- Delete: `.travis.yml`

- [ ] **Step 1: 写 eslint 配置**

```js
import neostandard from 'neostandard'

export default [
  ...neostandard({ ts: true, ignores: ['legacy/**', 'dist/**', '.package/**', 'doc/**'] })
]
```

> 选择 `neostandard` 而不是裸 eslint + 一堆插件：它就是把 standardjs 的规则以可维护的形式重新打包，和项目既有的无分号/单引号/2 空格风格一致。spec 里说的「match the surrounding code by hand」在有了 linter 之后可以自动化。

- [ ] **Step 2: 跑 lint 并修**

Run: `npm run lint`
Expected: 退出码 0。若有报错，**修源码而不是加 ignore** —— 唯一的例外是 `legacy/`，它已经在 ignores 里。

- [ ] **Step 3: 写 CI**

`.github/workflows/ci.yml`：

```yaml
name: CI

on:
  push: { branches: [main, master] }
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:coverage
      - run: npm run build
      - name: the published artifact must load in plain node
        run: |
          node -e "import('./dist/index.js').then(m => console.log('esm ok'))"
          node -e "console.log('cjs ok', typeof require('./dist/index.cjs'))"

  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      # No GPU runner here. SwiftShader is the intended fallback: it is closer
      # to the float64 CPU reference than a real GPU is, so it is the better
      # oracle for correctness. See the spec, section 9.5.
      - run: npm run test:integration
        env:
          CI: 'true'
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/

  legacy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      # v0.2.x keeps shipping while the rewrite lands. This job is what keeps
      # "unbroken" a fact rather than an intention. Deleted in P7.
      - run: npm run build:legacy
```

- [ ] **Step 4: 删掉 travis**

```bash
git rm .travis.yml
```

（它指向 Node 9，早已失效。）

- [ ] **Step 5: 本地预演 CI**

```bash
npm run typecheck && npm run lint && npm run test:coverage && npm run build && npm run build:legacy
```
Expected: 全部退出码 0

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js .github/workflows/ci.yml
git rm --cached .travis.yml 2>/dev/null || true
git commit -m "ci: replace the node-9 travis config with github actions

Three jobs: unit (typecheck, lint, coverage, build, artifact loads in
plain node), integration (playwright with the WebGPU guard), and legacy
(the v0.2.x bundle still builds)."
```

---

### Task 10: demo 骨架

**Files:**
- Create: `demo/index.html`
- Modify: `demo/webpack.config.js`（若 Task 1 未完全处理）

- [ ] **Step 1: 写最小 demo 页**

`demo/index.html`：

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pano.gl</title>
  <style>
    html, body { margin: 0; height: 100%; background: #111; }
    /* The viewer sizes its canvas from the container, so a zero-height
       container is the most common way to get a blank page with no error. */
    #viewer { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="viewer"></div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: 写 demo 入口（此时只是占位）**

`demo/main.ts`：

```ts
/*
 * The demo grows a real viewer in P5. Until then it exists so `npm start` has
 * something to serve and so the Vite/Playwright web server config is exercised
 * from the first commit rather than debugged later.
 */

import { VERSION } from '../src/index'

const host = document.getElementById('viewer')
if (!host) throw new Error('#viewer is missing from index.html')

const note = document.createElement('p')
note.style.cssText = 'color:#888;font:14px system-ui;padding:16px'
note.textContent = `pano.gl ${VERSION} -- viewer lands in P5`
host.appendChild(note)
```

- [ ] **Step 3: 跑起来看一眼**

Run: `npm start`
Expected: Vite 起在 5173，页面显示 `pano.gl 1.0.0-alpha.0 -- viewer lands in P5`

（用 `/browse` skill 打开确认，不要用 `mcp__claude-in-chrome__*`。）

- [ ] **Step 4: Commit**

```bash
git add demo/index.html demo/main.ts
git commit -m "docs(demo): minimal vite-served demo page"
```

---

## 完成标准

- [ ] `npm run typecheck` 退出码 0
- [ ] `npm run lint` 退出码 0
- [ ] `npm run test:coverage` 通过，且**门槛已验证会拦人**（Task 7 Step 2）
- [ ] `npm run build` 后 `node -e "import('./dist/index.js')"` 成功
- [ ] `npm run build:legacy` 成功，产物字节数与迁移前一致
- [ ] `npm run test:integration` 通过，且**守卫已验证会拦人**（Task 8 Step 5）
- [ ] `legacy/` 已建立，`src/` 里没有任何旧代码
- [ ] `.travis.yml` 已删除

## 交给下游的东西

| 产物 | 消费者 |
|---|---|
| 能跑测试的 vitest | 之后每一期 |
| 带 WebGPU 守卫的 playwright | P3 起的所有 GPU 测试 |
| `src/diagnostics.ts` 的 trace 通道 | P2 起的每一层 |
| 自包含的 tsup 产物 | P5 的公开 API |
