# P1 — 工具链骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development（无 subagent 则 executing-plans）；收尾走 superloop 的 task-finish，禁用 finishing-a-development-branch。

**Goal:** 让 `npm run build` 出包、`npm test` 真的在跑测试、CI 会因 WebGPU 不可用而**红**。不写任何产品逻辑。

**Architecture:** 新实现与旧实现**并存于同一仓库、同一分支**：旧源码 `git mv` 到 `legacy/`（webpack 配置随之指向），新源码从零开始写在 `src/`。~~`legacy/` 的构建脚本原样保留并在 CI 里跑，保证 v0.2.x 全程可以发版。~~（划线句已废弃，见下方第二条拍板注记。）

**Tech Stack:** TypeScript 5 (strict) · vite（lib mode 出包；demo dev server 与 vitest 同根同工具）· vitest（单元 = node project，集成 = browser project）· neostandard · GitHub Actions

> **2026-09-20 拍板变更（用户裁决）**：出包工具由 tsup 换成 **vite library mode**。理由：demo dev server、vitest 浏览器模式、库打包三者本就共用 vite 作底层，再引入 tsup 是第五个构建工具；用户明确要求打包方案统一到 vite。tsup 相关内容已从本计划移除；Task 2 落地时（先于本变更提交）package.json 里仍是 tsup，由 Task 4 换掉——Task 2 的提交在当时规格下是合规的，不算偏离。

> **2026-09-20 拍板变更 II（用户裁决）：废弃「v0.2.x 全程可发版」约束。** 该约束源自 spec §10.5，经查证系设计共创时由 AI 写入、用户从未主动要求或逐条确认——用户质询后裁决砍掉。理由：旧版可发版的真正保险是 **git 历史**（需要时 checkout 迁移前提交构建发布，Task 1 已实测本机 Node 22 能跑旧 webpack 构建），不需要 master 上拖着一条 2017 年构建链；本包 2017 年后未动，重写期间发 0.2.x hotfix 的概率趋零，而为它付出约 12 个 webpack 3 / babel 6 旧 devDependencies + 一个 CI job 的实打实代价。**落地改动**：原 Task 6「legacy 构建保留」瘦身为只建 `tsconfig.scripts.json`（原 Step 1 装旧依赖、Step 2 的 `webpack/package.json` shim 与 `scripts/legacy-build.mjs`、Step 3 互不干扰验证全部移除，均已从本 plan 删除）；Task 2 已落地的 `build:legacy` 脚本行由瘦身版 Task 6 顺手删除（指向从此不会创建的文件）；Task 9 的 CI 不再有 legacy job；卡 verify 去掉 `npm run build:legacy`。**不影响**：Task 1 的 `git mv`（理由是目录名冲突，独立成立）、P0 基线（独立工具链 `tools/baseline/`）。**对 P7 的提示**：P7 计划里「删除 legacy 构建链」类任务届时变成空操作，其卡自查。spec §10.5 已由协调侧勘误。

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
| `test/unit/` | vitest 单元测试，跑在 node |
| `test/integration/` | vitest 浏览器模式集成测试，跑在真浏览器里 |
| `scripts/` | 构建期脚本（P2 起是 shader 常量生成器） |
| `tsconfig.json` | strict + `noUncheckedIndexedAccess`，库自身的 program |
| `vite.config.ts` | 库构建（vite lib mode）：`dist/` 出 esm + cjs 双格式 |
| `vitest.config.ts` | 三个 project：`unit`（node）、`integration`（浏览器，**含 WebGPU 守卫**）、`no-webgpu`（浏览器，反向守卫；P6 用） |

---

### Task 1: 迁移旧源码到 legacy/

**Files:**
- Move: `src/` → `legacy/`
- Modify: `webpack/debug.js`, `webpack/release.js`, `demo/webpack.config.js`, `package.json`

- [x] **Step 1: 先确认迁移前是绿的**

Run: `npm install && npm run build-debug && ls -la .package/`
Expected: `.package/bundle.js` 与 `.package/BundleSizeDebug.html` 存在

记下现在的大小：
```bash
wc -c .package/bundle.js | tee /tmp/pano-prepare-bundle-size.txt
```

- [x] **Step 2: 移动**

```bash
git mv src legacy
git status --short | head -40
```

- [x] **Step 3: 更新构建配置里的路径**

`git grep -n "src/" -- webpack demo package.json` 会列出所有引用点。逐个改：

- `webpack/debug.js` / `webpack/release.js`：`entry` / `resolve.modules` / loader 的 `include` 里凡是 `path.resolve(__dirname, '../src')` 一律改成 `'../legacy'`。
- `demo/webpack.config.js`：引用 `../src` 的地方改成 `../legacy`。
- `package.json`：`es5` 脚本 `babel src -d lib` 改成 `babel legacy -d lib`。

**顺带修掉 CLAUDE.md 记录的已知缺陷**：`demo/webpack.config.js` 的 `entry: './index.js'` 与实际文件 `Index.js` 大小写不符，在 Linux/CI 上失败。改成 `'./Index.js'`。

- [x] **Step 4: 重建并比对**

```bash
npm run build-debug && wc -c .package/bundle.js
```
Expected: 与 Step 1 记下的字节数**完全一致**。

若不一致，`git diff` 两个 bundle 找出差异；**若差异涉及函数体而非路径注释，回滚整个 Task（`git reset --hard && git clean -fd`）并上报卡点。**

（**实测（Task 1 落地，spec 审查与质量审查两轮独立复现）**：+304 字节，全部位于 inline sourcemap 的 `sources`/`sourcesContent` 路径串——`./src/` → `./legacy/`，38 对条目一一对应；JS 主体 17,403 行逐字节一致，mappings/names/version/file/sourceRoot 不变。属上方"路径注释"分类，不触发回滚。**此后所有字节比对以 JS 主体为准**：inline sourcemap 内嵌源路径，目录移动后整文件字节相等已不可达。）

- [x] **Step 5: 确认基线 fixture 仍可用**

Run: `cd tools/baseline && node verify-fixtures.mjs`
Expected: 6 个测试 PASS

（基线 fixture 用的是存档 bundle，不随源码移动而变 —— 这一步确认的是它没被误改。）

- [x] **Step 6: Commit**

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

- [x] **Step 1: 写新的 package.json**

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
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yusangeng/pano.gl.git"
  },
  "keywords": [
    "panorama",
    "equirectangular",
    "video-player",
    "webgl",
    "webgpu"
  ],
  "author": {
    "name": "yusangeng",
    "email": "yusangeng@outlook.com"
  },
  "scripts": {
    "build": "tsup",
    "build:legacy": "node scripts/legacy-build.mjs",
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "vitest run --project unit",
    "test:unit:watch": "vitest --project unit",
    "test:integration": "vitest run --project integration --project no-webgpu",
    "test:coverage": "vitest run --project unit --coverage",
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
    "@vitest/browser": "^5",
    "@vitest/browser-playwright": "^5",
    "@vitest/coverage-v8": "^5",
    "eslint": "^9",
    "neostandard": "^0.12.0",
    "playwright": "^1.63.0",
    "tsup": "^8",
    "typedoc": "^0.28",
    "typescript": "^5.9",
    "vite": "^7",
    "vitest": "^5"
  }
}
```

**与旧 package.json 的差异是刻意的**：`babel` / `babel-*` / `webpack` / `webpack-glsl-loader` / `isparta` / `istanbul` / `mocha` / `chai` / `litchy` / `konph` / `polygala` / `shortid` / `lodash` / `chivy` / `param-check` / `dodele` **全部退出**。

> **上方 JSON 里的 `tsup` 两处（`"build": "tsup"` 脚本 + `tsup` devDependency）已被 2026-09-20 的 vite 拍板取代**（见文件头部 Tech Stack 注记），Task 4 Step 2 会把它们换掉。Task 2 的提交（74a3009）按当时的规格落地，含 tsup 是合规的，不构成偏离、不需要返工；spec 审查已按本节原文核过、通过。上方 JSON 保持 Task 2 审核时的原样不改，避免"审查过的内容事后被静默改写"；最终真相以 Task 4 落地后的 package.json 为准。

> **发布元数据从旧文件原样携带**（`license` / `repository` / `author` / `keywords`，2026-09-20 拍板补入）：plan 初稿的 JSON 漏了它们——公共包丢 `license` 字段会让 npm 发版告警、下游 license 审计判 unknown。`keywords` 在旧表基础上加了 `webgpu`；更精细的营销性 keywords 属 P5/P7 的事，不在本卡扩。

> **不再需要 `pngjs`。** 集成测试现在跑在真浏览器里，读一张基线图就是
> `fetch(url) → blob → createImageBitmap()`，浏览器自带解码器。P0 的采集工具
> 如果要用 pngjs，那是它自己的 `tools/baseline/package.json` 的事，与本包的依赖树无关。
>
> **`playwright` 留着，`@playwright/test` 不要。** 前者是浏览器模式的 provider
> （`@vitest/browser-playwright` 的 peer dependency），由它负责起浏览器；后者的测试
> runner 已经不再使用。少一个 runner、少一套断言库。

> `build:legacy` 需要 webpack 与 babel 的依赖。它们**必须留着**直到 P7 —— 否则 v0.2.x 就发不了版了。见 Task 6。

> **（2026-09-20 用户裁决 II 已废弃上一条，见文件头部拍板变更 II。）** 旧版发版的保险改为 git 历史（checkout 迁移前提交构建），webpack/babel 旧依赖不再装回。Task 2 重写时已把旧 devDependencies 删净（落地 package.json 可证），但 `"build:legacy": "node scripts/legacy-build.mjs"` 脚本行还在——指向从此不会创建的文件，是死引用，由瘦身版 Task 6 Step 1 顺手删掉。本条原文按审查时点保留不改。

- [x] **Step 2: 确认依赖树不再包含旧库**

Run: `npm install && npm ls litchy konph polygala shortid chivy param-check dodele 2>&1 | tail -20`
Expected: 每条 `(empty)` 或 `not found`。**除 `build:legacy` 需要的 webpack/babel 外，运行时依赖树里不应再出现它们。**

- [x] **Step 3: Commit**

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

- [x] **Step 1: 写 tsconfig.json**

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
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["test/integration"]
}
```

> **`test/integration` 被排除在根 program 之外，这不是遗漏。**
>
> 集成测试跑在**浏览器模式**下，也就是说它们由 Vite 编译、可以 `import baseline from '../fixtures/x.bin?url'`。`?url` / `?raw` 这类后缀的模块声明来自 `vite/client`。于是集成测试需要一个带 `"types": ["@webgpu/types", "vite/client"]` 的 program，而**库自己不该有** —— 一个纯库的 `tsc --noEmit` 不该需要知道 Vite 的存在。
>
> 所以集成测试自成一个 program：`test/integration/tsconfig.json`，**本计划 Task 8 Step 1 建它**：
>
> ```json
> {
>   "extends": "../../tsconfig.json",
>   "compilerOptions": { "types": ["@webgpu/types", "vite/client"] },
>   "include": ["./**/*.ts"],
>   "exclude": []
> }
> ```
>
> **`"exclude": []` 必须写，它看着多余但不是。** 继承下来的 `exclude` 相对**声明它的那个文件**解析，所以根配置里的 `"exclude": ["test/integration"]` 会跟到子配置里，把子 program 自己要检查的文件全部排掉。实测（tsc 5.9）：少了这一行，往 `test/integration/` 里放一个故意写错的测试，`tsc -p test/integration` **照样退出码 0**；加上就报出那个错。一个静默地什么都不检查的 typecheck program 比没有还糟 —— 它会让「typecheck 是绿的」变成一句没有信息量的话。
>
> **`npm run typecheck` 因此必须是三条**（Task 8 Step 1 改）：`tsc --noEmit && tsc --noEmit -p test/integration && tsc --noEmit -p tsconfig.scripts.json`。否则后两个 program 根本不会被跑到。（第三条是 Task 3 质量审查后补的：scripts 的 program 由 Task 6 建，见 Task 3 的 include 注记。）
>
> 单元测试不碰 `window`、不碰 GPU、不 import 资源（见 Testing 一节），所以留在根 program 里是对的。**别把 `exclude` 去掉图省事** —— 去掉了根 program 立刻红，而且报错会指向集成测试文件，看起来像测试写错了。

**`noUncheckedIndexedAccess` 是刻意的**：spec §7.4 说明删掉 `param-check` 的前提是类型够严。它会让 `arr[i]` 的类型变成 `T | undefined`，一开始会很烦 —— 但那正是 GPU 缓冲下标这类代码该有的严谨度。**不要为了省事关掉它。**

`@webgpu/types` 需要装：把它加进 devDependencies。

> **include 里没有 `scripts/**/*.mjs`，这是 2026-09-20 实测后的修正（Task 3 质量审查）**：`.mjs` 在 `allowJs` 关闭时根本不是可被 include 的扩展名——tsc 对它静默跳过（有 .ts 时）或 TS18003 硬错（只有它时）。原来写着的那个条目是**惰性假覆盖**：「typecheck 是绿的」对 scripts 什么都没说。修法沿用本 plan 已有的"一种环境一个 program"模式：`scripts/` 的 node 环境 .mjs 由 **Task 6** 建的 `tsconfig.scripts.json` 覆盖（`types: ["node"]`，届时装 `@types/node`——**不要**把 @types/node 加进根 types 数组，那会把 `process`/`Buffer` 全局泄进 `src/`，库里手滑写 `process.env` 也能编译）。在那之前 scripts/ 没有文件，也无需覆盖。

- [x] **Step 2: 写 legacy 的隔离配置**

`tsconfig.legacy.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "checkJs": false, "allowJs": true, "declaration": false, "noEmit": true },
  "include": ["legacy/**/*.js"]
}
```

**目的**：让编辑器知道 `legacy/` 是 Babel 6 时代的 JS，不要拿新规则去检查它。它不参与 `npm run typecheck`。

> **`"declaration": false` 不能省（Task 3 质量审查实测，tsc 5.9.3）**：根配置的 `declaration: true` 会被继承，而它在 `noEmit` 下**不是惰性**——声明发射诊断照跑，对 legacy 的 JS（连同被 import 拉进来的 `vendor/cuon.js`）报一片 TS9005/TS9006，`tsc -p tsconfig.legacy.json` 退出码 2。加上这一行，同一文件集退出码 0。`checkJs: false` 的那一半行为如设计所愿：类型错误被压住、语法错误（TS1005）仍会浮出。

- [x] **Step 3: 加 @webgpu/types 并确认类型可用**

```bash
npm i -D @webgpu/types
npm run typecheck
```
Expected: 见下方实测注记——**不能**期待此时退出码 0。

（**实测（Task 3 落地，2026-09-20）**：tsc 5.9 在 include 匹配零文件时硬错误 **TS18003**（"No inputs were found in config file"），不是静默通过。Task 3 落地后的孤立状态下 src/test/scripts 还没有可匹配文件，`npm run typecheck` 是红的——这会在 Task 4 落地第一个 `src/index.ts` 时自然消失。本步的真实意图（配置有效 + @webgpu/types 类型可用）的验证法：往 src/ 放一个引用 `GPUDevice` / `GPUTextureFormat` 的临时探针 .ts，跑 typecheck 确认退出码 0，然后删掉探针、不入库。Task 3 实现者正是这样做的。）

- [x] **Step 4: Commit**

```bash
git add tsconfig.json tsconfig.legacy.json package.json package-lock.json
git commit -m "build: strict TypeScript config with WebGPU types"
```

---

### Task 4: 打包配置

**Files:**
- Create: `vite.config.ts`
- Create: `src/index.ts`
- Modify: `package.json`、`package-lock.json`（build 脚本换 vite；devDeps 换掉 tsup）

- [x] **Step 1: 写配置**

```ts
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
```

- [x] **Step 2: 换 package.json 的构建工具位**

```bash
npm rm tsup && npm i -D vite-plugin-dts@^5
```

`package.json` 两处改：

```json
    "build": "vite build",
```

（`tsup` 从 devDependencies 消失，`vite-plugin-dts@^5` 进来——peer `vite: >=3`，实测对 vite 7 兼容。`vite` 本来就在，demo / 测试 / 打包从此一个工具。）

同一编辑里顺带落两条发布加固（Task 2 质量审查 2026-09-20 提出，均为首次发版前的硬要求，趁 package.json 开着一起改）：

```json
  "bugs": { "url": "https://github.com/yusangeng/pano.gl/issues" },
  "publishConfig": { "tag": "alpha" },
```

以及 scripts 表加一行：

```json
    "prepublishOnly": "npm run build",
```

理由：①semver 里 `1.0.0-alpha.0 > 0.2.2`，裸 `npm publish` 会把 alpha 打成 `latest`，所有 `npm i pano.gl` 用户默认拿到 alpha——`publishConfig.tag: alpha` 是唯一写在 manifest 里的防线（GA 时 `--tag latest` 或删掉该字段）；②`files: ["dist"]` 下从干净检出直接 publish 会**成功发布一个只有 package.json 的坏包**（实测 `npm pack --dry-run` 静默通过），`prepublishOnly` 把构建挂进发布链；③`bugs` 补全 npm 页 Issues 入口，`npm bugs pano.gl` 因此可用。

- [x] **Step 3: 造一个最小入口让它能跑**

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

- [x] **Step 4: 构建**

Run: `npm run build && ls -la dist/`
Expected：`index.js`、`index.cjs`、`index.d.ts`，以及 `index.js.map` / `index.cjs.map`（lib mode 双格式各带 sourcemap；`emptyOutDir` 默认开，无需清理配置）

> **实测与裁决（Task 4 质量审查，2026-09-20）**：落地产物 = 恰好 5 文件；`npm pack --dry-run` 8 文件 2.7 kB（LICENSE/README 自动带入）。四条裁决：
> ① **`minify: false` 补进 Step 1**——vite lib mode 默认 minify on，tsup 时代产物 unminified 是被记录的行为（CLAUDE.md "unminified"），pivot 不能静默翻转它；整改轮已同步代码与本 plan。
> ② **不做 IIFE/UMD 第三格式**——v0.2.x 的 manifest `main` 从未指向过 webpack UMD bundle（`PanoGL` 全局只喂 demo 页），npm 受众里没有任何人被 ESM+CJS-only 落下；GA 后若出现 script-tag/CDN 需求，加格式是纯增量（新文件 + exports 新条件 + unpkg/jsdelivr 字段），P5 公开 API 设计不用为它留心。
> ③ **`.map` 进 tarball 是对的**——`sourcesContent` 已内嵌（实测），GPU 数学的 bug 报告能直接映射回 TS 源；体积可忽略。将来 tarball 大小真成问题时用 `files` 里的否定模式再收。
> ④ **`dist` 缺 `.gitignore` 条目**（webpack 时代只 ignore lib/.package/doc/wasm）——原 plan 没有任何一步补它，推迟到 Task 8 等于永不修；已补进 Task 8 Step 1 的 .gitignore 块（该步本就改 .gitignore）。

- [x] **Step 5: 确认产物可以被普通 Node 加载**

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

- [x] **Step 6: Commit**

```bash
git add vite.config.ts src/index.ts package.json package-lock.json
git commit -m "task-p1-toolchain: build: vite lib mode producing self-contained esm + cjs"
```

---

### Task 5: 日志通道

**Files:**
- Create: `src/diagnostics.ts`
- Create: `test/unit/diagnostics.test.ts`

- [x] **Step 1: 写失败测试**

> **（2026-09-20 Task 5 质量审查整改版）**：初版 5 个测试有三处强度缺口——①TSDoc 旗舰示例 `'pano:*,-pano:media'`（skip 模式）零覆盖；②undo 只从全关默认态测过，一个把 skip 状态清掉的坏 undo 也能通过；③`pano:` 命名空间前缀没钉住（test 1 只查对象键，`createDebug('pano:gpu')` 改名 `createDebug('gpu')` 后 suite 依然绿，而所有文档化的 `DEBUG=pano:*` 示例全断）。下方为补强后的 9 测试版（skip 模式、非默认先前态 undo、namespace 断言、垃圾模式 = 无效输入路径；test 4 顺带补 try/finally，与同文件其余测试一致，断言失败时不向后续测试泄漏已启用通道）。
>
> **（同日第二轮修正）**：上版 undo 测试的前态用了 `'pano:gpu'`（不含 skip 条目），缺陷注入实验证明「丢 skip 的坏 undo」对它不可见、而其注释恰恰声称覆盖该形状——注释说谎比没注释更糟。修法采用复审给出的、经出厂代码探针验证的形状：前态改为 `'pano:*,-pano:media'`（自带 skip），undo 后断言 `media.enabled === false` 把 skip 存活钉住；丢 skip 的 undo 形状现在会且只会红在这条断言上。

```ts
import { describe, it, expect } from 'vitest'
import { channels, enableChannels } from '../../src/diagnostics'

describe('diagnostics', () => {
  it('exposes the trace channels the library actually uses', () => {
    expect(Object.keys(channels).sort()).toEqual(
      ['camera', 'gpu', 'input', 'media', 'renderer', 'viewer'].sort()
    )
  })

  it('pins the pano: namespace prefix of every channel', () => {
    // The prefix is the module's whole contract with the DEBUG environment:
    // every documented example (DEBUG=pano:*) silently breaks if a channel
    // drifts to a bare name, while the object-key test above stays green.
    expect(Object.entries(channels).map(([, fn]) => fn.namespace).sort()).toEqual(
      ['pano:camera', 'pano:gpu', 'pano:input', 'pano:media', 'pano:renderer', 'pano:viewer'].sort()
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

  it('honours skip patterns, as the documented DEBUG example promises', () => {
    const restore = enableChannels('pano:*,-pano:media')
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
    try {
      expect(channels.gpu.enabled).toBe(true)
    } finally {
      restore()
    }
    expect(channels.gpu.enabled).toBe(before)
  })

  it('undo restores a partially-enabled previous state, not just all-off', () => {
    // The discriminating case for the undo: the previous state carries a
    // skip entry of its own. An undo that drops skips (rebuilds the previous
    // list without its '-pano:media' term) or clobbers everything to all-off
    // passes the all-off round-trip above and fails only here.
    const restoreFirst = enableChannels('pano:*,-pano:media')
    try {
      const restoreSecond = enableChannels('pano:camera')
      try {
        expect(channels.camera.enabled).toBe(true)
        expect(channels.gpu.enabled).toBe(false)
      } finally {
        restoreSecond()
      }
      expect(channels.gpu.enabled).toBe(true)
      // The skip entry must survive the undo: an undo that loses the
      // '-pano:media' term leaves media on, and only this line catches it.
      expect(channels.media.enabled).toBe(false)
    } finally {
      restoreFirst()
    }
  })

  it('treats an empty pattern as enable nothing', () => {
    const restore = enableChannels('')
    try {
      expect(Object.values(channels).some(fn => fn.enabled)).toBe(false)
    } finally {
      restore()
    }
  })

  it('treats an unparsable pattern as enable-nothing, not an error', () => {
    // debug's parser silently ignores garbage; pin that inherited leniency
    // so a future debug major that starts throwing shows up as a red test
    // here rather than as a crashed host page later.
    const restore = enableChannels('not a pattern!')
    try {
      expect(Object.values(channels).some(fn => fn.enabled)).toBe(false)
    } finally {
      restore()
    }
  })
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `npx vitest run test/unit/diagnostics.test.ts`
Expected: FAIL —— `Failed to resolve import "../../src/diagnostics"`

> **为什么不是 `npm run test:unit`（2026-09-20 实测修正）**：该脚本是 `vitest run --project unit`，而 `unit` project 由 Task 7 的 vitest.config.ts 定义——此刻配置不存在，vitest 直接抛错退出（不是"跑不了测试"意义上的红）。直跑测试文件即可；**显式路径同时是必需的**：vitest 零配置的默认 glob 会扫到 `tools/baseline/fixtures.test.mjs`（P0 的 node:test 产物），把它当自己的测试文件拾进来报 no tests。Task 7 建好 unit project（include 锁定 `test/unit/**`）后，`npm run test:unit` 才成为正式入口。

- [x] **Step 3: 实现**

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
 * Usage from an application (once P5 opens the public surface -- until then
 * import from the module path directly):
 *
 *     import { enableChannels } from 'pano.gl'
 *     enableChannels('pano:gpu,pano:renderer')
 *
 * Or from outside the page entirely:
 *
 *     DEBUG=pano:*,-pano:media
 */

import createDebug from 'debug'

// debug's Node engine initialises its enable state from `process.env.DEBUG`
// verbatim: when DEBUG is unset, `enable(undefined)` runs and the internal
// `namespaces` marker stays undefined. A channel's `.enabled` getter only
// recomputes when that marker *changes* value, so on a fresh import every
// channel reports `undefined` rather than `false` until the first
// enable()/disable() call. Normalising the nothing-enabled case to `''` here
// makes "silent by default" observable, while a host-provided DEBUG pattern
// (names/skips non-empty) is left exactly as the environment set it.
if (createDebug.names.length === 0 && createDebug.skips.length === 0) {
  createDebug.enable('')
}

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
 * Enabling also persists through debug's own storage -- `process.env.DEBUG`
 * in Node, localStorage in browsers -- so the setting survives page reloads.
 * Inherited `debug` semantics, but surprising enough to an application
 * developer to say out loud.
 *
 * @param namespaces - A `debug` namespace pattern, e.g. `'pano:gpu'` or
 *   `'pano:*,-pano:media'`. An empty string enables nothing; an unparsable
 *   string is silently treated the same way, exactly as `debug` does.
 * @returns A function restoring the enabled set that was in effect before.
 */
export function enableChannels (namespaces: string): () => void {
  const previous = createDebug.disable()
  createDebug.enable(namespaces)

  return () => {
    createDebug.disable()
    createDebug.enable(previous)
  }
}
```

> **实现上的坑**：`debug` 没有「读当前 enable 列表」的公开 API，`disable()` 返回上一次的列表（既有行为）是唯一读出口——`previous` 靠它捕获。undo 里的 `disable()` 在 debug 4.4.3 下**并不承重**（复审缺陷注入实验：去掉它直接 `enable(previous)`，9/9 仍全绿——`enable()` 原子地重建 names/skips，marker 相等蕴含状态相等，getter 不重算结果也对）；保留它是 belt-and-braces：`.enabled` 的 getter 只在内部 namespaces marker **变化**时重算，这是 debug 的内部实现细节而非契约，先 disable 再 enable 保证 marker 必经跳变，防的是 debug 未来版本改变重算条件。若 `@types/debug` 把 `disable()` 标成 `void`，用 `(createDebug.disable as () => string)()` 取。

> **（2026-09-20 Task 5 质量审查整改）**：初版实现里 enable 后还有一次「disable 读回 → 恢复 previous → 再设 enabled」的三行往返——审查以 9 模式对照探针证明它与删除可观察等价（读回值无任何消费者，previous 一次捕获就够），纯维护成本，已删；同时删掉的还有 `?? ''` 守卫（`disable()` 经 `.join()` 重建串，实测永不返回 undefined，且它是 90% 分支门槛下的永久未覆盖分支）。行为不变的证明与探针记录见质量审查报告。

> **第二个坑（2026-09-20 Task 5 落地实测，debug@4.4.3，主控复现确认）**：DEBUG 未设时，debug 的 Node 引擎在模块初始化跑 `enable(undefined)`，内部 marker 停在 `undefined`；而 `.enabled` 的 getter 只在 marker **变化**时重算（`undefined !== undefined` 为假），于是在第一次 `enable()`/`disable()` 之前，每个通道的 `.enabled` 读出来是 `undefined` 而非 `false`——「默认全静默」在可观测层面不成立，Step 1 的「默认静默」测试因此红（`expected undefined to be false`，确定性复现，非 flaky）。修法是 import 后加一段归一化（已并入上方代码块）：`names`/`skips` 双空（= host 没给 DEBUG）时 `createDebug.enable('')`，把「什么都没开」显式化成可观测的 `false`；host 设了 DEBUG 则双空不成立、原样透传（实测 `DEBUG='pano:*,-pano:media'` 下归一化不触发）。备选——放宽断言为 falsy、或测试里强制清 env——分别弱化规格与绕环境，均不取。附带结论：`@types/debug@4.1.12` 把 `disable()` 标为 `() => string`，与实现用法一致。

- [x] **Step 4: 跑测试确认通过**

Run: `npx vitest run test/unit/diagnostics.test.ts`
Expected: 9 个测试 PASS

- [x] **Step 5: Commit**

```bash
git add src/diagnostics.ts test/unit/diagnostics.test.ts
git commit -m "feat: opt-in trace channels built on debug"
```

---

### Task 6: scripts 的 typecheck program

> **本任务曾名为「legacy 构建保留」，2026-09-20 用户裁决 II 砍掉了它的 legacy 半边**（见文件头部拍板变更 II）：不再装回 webpack 3 / babel 6 旧依赖、不再建 `scripts/legacy-build.mjs` 与 `webpack/package.json` shim、不再验证新旧构建互不干扰。存活下来的是另一半——`tsconfig.scripts.json`，它承载的东西与 legacy 无关：scripts/ 的 node 环境 .mjs 覆盖、`vite.config.ts` / `vitest.config.ts` 的类型检查（coverage 键拼错 = 90% 门槛静默失效，这是它存在的真正理由）。Task 2 落地时写下的 `"build:legacy"` 脚本行（指向从此不会创建的文件）在本任务 Step 1 顺手删除。

**Files:**
- Create: `tsconfig.scripts.json`（scripts/ 的 node 环境 program）
- Modify: `package.json`（删 `build:legacy` 死脚本行；质量审查整改追加两处：`@types/node` pin `^22`、lint 行去掉 `scripts` 参数——见 Step 5）
- Modify: `package-lock.json`（整改轮随 `npm i` 重生成）

- [x] **Step 1: 删掉 build:legacy 死脚本行**

`package.json` 的 `scripts` 表里删这一行：

```json
    "build:legacy": "node scripts/legacy-build.mjs",
```

它是 Task 2 按当时规格落地的（当时本任务还包含 legacy 构建保留），裁决 II 之后 `scripts/legacy-build.mjs` 不会创建，该行成了指向空处的死引用——任何人跑 `npm run build:legacy` 会得到一个 Node 找不到模块的报错。删行后无需动 lockfile（旧 webpack/babel 依赖 Task 2 重写时已删净）。

- [x] **Step 2: 建 tsconfig.scripts.json**

缘由见 Task 3 Step 1 的 include 注记：`.mjs` 进不了根 program，那不是覆盖是静默。`tsconfig.scripts.json`：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "declaration": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["scripts/**/*.mjs", "vite.config.ts", "vitest.config.ts"]
}
```

装 node 类型：`npm i -D @types/node`（原指令无版本约束，落地装到 latest＝26.x；质量审查后 pin `^22`，见 Step 5）。`types` 是**替换**不是追加——它挡掉 `@webgpu/types`（scripts 用不到）和一切 `node_modules/@types/*` 的自动混入；`declaration: false` 的理由同 `tsconfig.legacy.json` 的注记——**质量审查实测精确化（2026-09-20）**：TS9005/TS9006 的触发形态是 legacy 那种 2012 年式跨模块未类型化导出，本 program 的现实文件集（TS 配置 + 现代 node 脚本）当下不触发，此行属预防性保留（零成本挡掉一整类未来报错），不应被读作「不加就炸」。**Task 8 Step 1 会把 `npm run typecheck` 改成三条**，把 `-p tsconfig.scripts.json` 也跑起来；在那之前手动 `npx tsc --noEmit -p tsconfig.scripts.json` 验证本步（P2 的 `gen-shader-constants.mjs` 落地时自动继承这份覆盖，不必再改）。

> **include 里的两个配置文件（Task 4 质量审查 2026-09-20 提出，探针实测）**：vite 加载 `vite.config.ts` / `vitest.config.ts` 走 esbuild **只转译不检查类型**——配置键拼错是静默 no-op。最坏的点在 Task 7：`vitest.config.ts` 的 coverage 键拼错会**静默禁用 90% 门槛**，测试全绿、门槛失效——和 Task 3 打掉的惰性 include 是同一类「绿灯没有信息量」问题。两个文件当时不在任何 tsc program（`tsc --listFiles` 实测零命中）。**落点在本 program 而不是根 program，是实测出来的**：根 program 刻意不带 @types/node（Task 3 的纪律），而 Task 8 Step 2 的 `vitest.config.ts` 要用 `process.env.CI`——探针实测它在根 program 报 TS2591 `Cannot find name 'process'`；本 program 的 `types: ["node"]` 恰好是它们运行所在的环境，同一份完整 `vitest.config.ts`（含 `process.env.CI`）在本 program 探针全绿。`vite.config.ts` 自 Task 4 已存在，本步建好即覆盖；`vitest.config.ts` 由 Task 7 创建，include 预列它（精确文件名此刻匹配不到是静默的，但另两条 include 保证 program 非空，无 TS18003 风险），届时自动进程序。Task 8 的 typecheck 第三条因此天然覆盖两个配置文件，无需再改。

- [x] **Step 3: 手动验证本 program**

```bash
npx tsc --noEmit -p tsconfig.scripts.json
```
Expected: 退出码 0（此刻 include 里只有 `vite.config.ts` 匹配得到文件；`scripts/**/*.mjs` 与 `vitest.config.ts` 分别由 P2、Task 7 落地后自动进入）

- [x] **Step 4: Commit**

```bash
git add tsconfig.scripts.json package.json package-lock.json
git commit -m "task-p1-toolchain: build: scripts typecheck program; drop the dead build:legacy script"
```

- [x] **Step 5: 质量审查整改（2026-09-20）**

两条独立发现，各自单独 commit：

**5a — `@types/node` pin 到 `^22`（Important 1）**。原指令 `npm i -D @types/node` 无版本约束，落地装到 latest（26.6.2），而运行环境是 Node 22（本机 22.23.2；Task 9 的 CI 两个 job 均 `node-version: 22`）。类型面描述 Node 26 意味着「typecheck 绿」对「Node 22 上能跑」什么都不敢保证——scripts 手滑用了 Node 23+ 的 API 时依然全绿、运行时才炸。这是本 plan 已打过三次的「惰性绿灯」病（惰性 include、coverage 键拼错、无 GPU 绿测）的第四个实例，而该 program 存在的全部意义就是绿灯有信息量。pin 代价已验证为零：vite@7 与 vitest@5 的 peer 范围均覆盖 `^22`，hoisted 副本不变。

```bash
npm i -D @types/node@^22
git add package.json package-lock.json
git commit -m "task-p1-toolchain: build: pin @types/node to the Node 22 runtime the CI declares"
```

**5b — lint 行去掉 `scripts` 参数（审查相邻发现，越出 Task 6 原文但等不到 Task 9）**。Task 2 落地的 `"lint": "eslint src test scripts"` 里，`scripts/` 目录要到 P2 Task 1 才创建——eslint 9 对未匹配的显式 pattern 硬错（实测 `npm run lint` exit 2：`No files matching the pattern "scripts" were found`）。这不是「Task 9 跑 lint 时才发现」的问题：**Task 7 落地 vitest.config.ts 后本卡 verify（含 `npm run lint`）就会执行，闸 6 必红**。现在去掉参数，P2 建目录时加回——master 上的 P2 plan 已由协调侧预补回补步骤（其 Task 1 的 Step 9a）。

```json
    "lint": "eslint src test",
```

```bash
git add package.json
git commit -m "task-p1-toolchain: build: drop the scripts pattern from lint until the directory exists"
```

验证：`npx tsc --noEmit -p tsconfig.scripts.json` 仍 exit 0；`npm ls @types/node` 为 22.x；lint 的**失败点后移**——`npm run lint` 从 `No files matching the pattern "scripts" were found`（5b 所修的缺陷）变为 `couldn't find an eslint.config`（config 是 Task 9 Step 1 的交付物，此刻不存在属预期），exit 0 留给 Task 9 Step 2 验证。

> **（措辞修正 2026-09-20，整改轮实测取证）**：本验证行初版写的「`npm run lint` exit 0」没有算到 `eslint.config.js` 尚不存在——pattern 校验先于 config 解析，pattern 修复后失败点后移到 config 缺失，exit 0 在 Task 9 之前不可能达成。连带修正：任务卡 verify 的 lint 段改为 `if [ -f eslint.config.js ]` 条件式（与 `vitest.config.ts` 的自举悖论处理同款）——否则 Task 7 打开 verify 条件开关后、Task 9 落地 config 前，交卷检查闸 6 必红。另：`npm i -D @types/node@^22` 会把 spec 规范化成 `^22.20.4`（npm 在解析版本上应用 save-prefix），与「对齐运行时大版本」的意图不符——手动改回 `"^22"` 并 `npm install --package-lock-only` 同步镜像，解析结果 22.20.4 不变。

---

### Task 7: vitest 的 unit project 与覆盖率

**Files:**
- Create: `vitest.config.ts`

Task 8 会往同一个文件里加 `integration` project。**一个配置文件、两个 project、一个 vitest** —— 单元测试跑 node，集成测试跑真浏览器，命令都是 `vitest run --project <名字>`。

- [x] **Step 1: 写配置**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    /*
     * Coverage is configured at the ROOT, not inside the unit project.
     * Vitest reads coverage from the root config; a `coverage` block nested in
     * a project is not what the reporter looks at. Scoping is done by running
     * `vitest run --project unit --coverage` -- only unit tests contribute
     * because only they ran.
     */
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
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node'
        }
      }
    ]
  }
})
```

- [x] **Step 2: 确认覆盖率门槛真的会拦人**

Run: `npm run test:coverage`
Expected: PASS（此时 `src/` 只有两个文件，且都有测试）

**这一步不能只是「跑一下看看」。** 覆盖率门槛的价值全在「不达标会不会红」，所以必须实测一次红：

```bash
# 造一个没有人调用过的分支
cat > src/__threshold_probe.ts <<'EOF'
export function pick(n: number): string {
  if (n > 0) return 'pos'
  return 'non-pos'
}
EOF
npm run test:coverage; echo "exit=$?"
rm src/__threshold_probe.ts
```

Expected: `exit=1`，且输出里有
`ERROR: Coverage for branches (...) does not meet global threshold (90%)`。

（已实测：`exit=1`，四个维度各报一条 ERROR。删掉探针文件后恢复正常。）

> **（补注 2026-09-20，Task 7 落地实录）**：本步上方「Expected: PASS」首轮实测为红——branches 75%：`src/diagnostics.ts` 模块顶层归一化 if 的「DEBUG 已设」分支（names/skips 非空、不落 `enable('')`）无测试。「都有测试」是文件级事实，不等于分支级覆盖。修复：新增 `test/unit/diagnostics.init.test.ts`（`vi.stubEnv('DEBUG','pano:gpu')` + 动态 import，依赖 vitest 按文件的模块注册表隔离，故独立成文件——文件头注释已钉住这一前提），修后四维 100%。质量审查对补的测试做过双向缺陷注入（坏归一化→红；静态 import 破坏时序→红）与 `--no-isolate` 反事实实测（隔离前提被破坏时套件响亮地红，不会静默恒真）。

- [x] **Step 3: Commit**

```bash
git add vitest.config.ts
git commit -m "test: vitest unit project with a 90% branch threshold that fails the build"
```

---

### Task 8: 浏览器模式集成测试与 WebGPU 守卫

**Files:**
- Create: `test/integration/tsconfig.json`
- Modify: `vitest.config.ts`（加两个 browser project）
- Modify: `package.json`（typecheck 变三条）
- Modify: `.gitignore`
- Create: `test/integration/support/require-webgpu.ts`
- Create: `test/integration/support/require-no-webgpu.ts`
- Create: `test/integration/support/canvas.ts`
- Create: `test/integration/smoke.test.ts`
- Create: `test/integration/fallback/smoke.test.ts`

这是本计划**最重要的一步**。

集成测试跑在 **vitest 浏览器模式**下：测试文件本身就在页面里，直接 `import` 被测代码，不再需要 `window.__panoTest` 那套跨进程桥接。但「跑在真浏览器里」这件事本身有一个**静默失败模式**：浏览器可能根本没有 GPU，测试于是空跑，而 CI 一路绿灯。守卫就是把这个静默降级变成红灯的东西。

已实测的两条静默路径（两条都能被守卫抓到，见 Step 5）：

1. Playwright 自带的 headless chromium **没有 GPU**（`channel: 'chromium'` 才指到带 GPU 的那个完整构建）。此时 `navigator.gpu` **存在**、`requestAdapter()` 返回 **null**、WebGL2 照常工作 —— 所以「测试跑过了」和「测试什么都没测」在输出上长得一模一样。
2. **Vitest 5 的 `instances[].launch` / `instances[].context` 会被静默忽略** —— 见 Step 2 的说明。配置被吞掉不会有任何报错，你只是拿到了上面那个没 GPU 的浏览器。

> **（质量审查整改 2026-09-20，Task 8 质量审查 NEEDS_FIXES 轮，六处已并入本节代码块，落地以修正后为准）**：
> ① Step 1 的 .gitignore 补 `**/__traces__/`——实测 trace 落在 `test/integration/__traces__/`（未忽略），截图才落在 `.vitest/`；本节 Step 6 的故意跑红每轮都会留下未跟踪 zip，一次 `git add -A` 就入库。
> ② Step 2 注释旗名 `--enable-unsafe-swiftshader` 系笔误，实为 `--enable-unsafe-webgpu`（质量审查实测：shipped 双旗足够、去掉该旗即 null adapter——代码自始正确，说错话的是注释）。
> ③ Step 4 `countNonBlack` docstring 与谓词不符（代码只查 RGB、忽略 alpha，原注释说「not fully transparent black」）；`readCanvas` TSDoc 删弃用机制残留（`copyTextureToBuffer` 行对齐——现实现走 toDataURL，无此路径）。
> ④ Step 5 冒烟测试双 rAF 改用 `nextFrames(2)`（`nextFrames` 原为零覆盖死导出，smoke 内联重写了同一逻辑）；adapter 测试注释加 reporter 可见性限定（vitest 默认 reporter 不显示通过测试的 console.log，实测）。
> ⑤ Step 5 fallback 冒烟注释删「零测试 project 拦得住」的虚假承诺——实测 include 空匹配时 vitest 单跑与聚合均静默 exit 0，该测试随 include 一起消失。
> ⑥ 移交 Task 9 两项（见 Task 9 节注记）：CI 用能透出 stdout 的 reporter；对两个 project 的测试数做断言。

- [x] **Step 1: 集成测试的 tsconfig，并把 typecheck 改成三条**

`test/integration/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "types": ["@webgpu/types", "vite/client"]
  },
  "include": ["./**/*.ts"],
  "exclude": []
}
```

理由见 Task 3 Step 1 的说明。**`"exclude": []` 不能省** —— 少了它这个 program 会静默地什么都不检查（tsc 5.9 实测）。

> **（路径勘误 2026-09-20，Task 8 落地实测）**：上方代码块初版的 `"extends": "../tsconfig.json"` 是 plan 撰写期笔误——`extends` 相对**声明它的文件**解析，从 `test/integration/` 出发 `"../"` 指到不存在的 `test/tsconfig.json`。tsc 对此报 TS5083 但**非致命**（以默认 ES5 继续编译，涌出大量 lib 报错），所以它被 typecheck 第一腿当场抓红而不是静默。落地与 Task 3 Step 1 注记里的同款 json 块（本 plan 已一并修正）都改为 `"../../tsconfig.json"`（指根 tsconfig，Task 3 注记的意图所在）。代码以修正后为准。

`package.json` 里把 typecheck 改成三条（第三条跑 Task 6 建的 scripts program）：

```json
    "typecheck": "tsc --noEmit && tsc --noEmit -p test/integration && tsc --noEmit -p tsconfig.scripts.json",
```

`.gitignore` 末尾追加（browser mode 失败时会往这里落截图和 trace，是本地诊断产物，不入库）：

```gitignore
# Vitest browser-mode failure artifacts (screenshots, traces)
.vitest
# Playwright traces land beside the test files, not under .vitest/
# (measured: .vitest/ gets the screenshots, test/integration/__traces__/
# gets the zips -- Task 8 quality review, 2026-09-20)
**/__traces__/
# Library build output (produced since Task 4; never committed)
dist
```

> **`dist` 这一行是 Task 4 质量审查（2026-09-20）补的**：webpack 时代的 .gitignore 只 ignore `lib`/`.package`/`doc`/`wasm`，`dist` 从 Task 4 起产生却无人 ignore——原 plan 没有任何一步加它。Task 6 Step 3 会两次 `npm run build`，未跟踪的 `dist/` 会一直躺在工作区，任何一次手滑的 `git add -A` 都会把构建产物提进去。本步反正要开 .gitignore，一并补上。

- [x] **Step 2: 往 vitest.config.ts 里加两个 browser project**

```ts
import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  test: {
    coverage: { /* Task 7 写的，原样保留 */ },
    projects: [
      {
        test: {
          name: 'integration',
          setupFiles: ['./test/integration/support/require-webgpu.ts'],
          include: ['test/integration/**/*.test.ts'],
          exclude: ['test/integration/fallback/**'],
          browser: {
            enabled: true,
            /*
             * The launch/context options live HERE, on the provider factory.
             *
             * Putting them on `instances[].launch` / `instances[].context`
             * instead is accepted without a word and then ignored -- you
             * silently get Playwright's bundled headless chromium, which has
             * no GPU at all. Measured: with the options in the wrong place
             * requestAdapter() returns null and every test in this project
             * fails at the guard; with them here the adapter is real
             * (apple/metal-3 on the machine this was verified on).
             *
             * channel: 'chromium' is load-bearing, and not for the reason it
             * looks like. Playwright's default headless launch uses
             * chrome-headless-shell, a separate binary with no GPU stack:
             * WebGL still works (through SwiftShader) and renders correct
             * pixels, but requestAdapter() returns null, so every WebGPU test
             * no-ops. The failure mode is "looks fine", not "reports an error".
             */
            provider: playwright({
              launchOptions: {
                channel: 'chromium',
                /*
                 * CI runners have no GPU, and a GPU-less browser hands back a
                 * null adapter -- which the guard would (correctly) turn into a
                 * red build. SwiftShader gives software WebGPU back, but only
                 * with BOTH of these flags: --enable-unsafe-webgpu and
                 * --use-webgpu-adapter=swiftshader on their own each still
                 * return null. Measured; see also the CI job in Task 9.
                 *
                 * Reproduce the CI environment locally with `CI=1 npm run
                 * test:integration`. Note that the gates therefore have to hold
                 * on a software rasteriser as well as on a real GPU -- that is
                 * a tolerance decision for P3, not something this file settles.
                 */
                args: process.env.CI
                  ? ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader']
                  : []
              },
              contextOptions: { deviceScaleFactor: 2 }
            }),
            headless: true,
            // Traces are Playwright-provider-only and open in
            // https://trace.playwright.dev -- the debugging story Playwright
            // users expect, kept.
            trace: 'retain-on-failure',
            instances: [{ browser: 'chromium' }]
          }
        }
      },
      {
        test: {
          name: 'no-webgpu',
          setupFiles: ['./test/integration/support/require-no-webgpu.ts'],
          include: ['test/integration/fallback/**/*.test.ts'],
          browser: {
            enabled: true,
            /*
             * --disable-gpu reproduces the real downgrade condition: navigator.gpu
             * still exists, requestAdapter() returns null, and WebGL2 keeps
             * working. Measured. Note --disable-features=WebGPU does NOT work
             * (the adapter still appears), and adding
             * --disable-software-rasterizer would kill WebGL2 too.
             *
             * This project is what P6 grows into: P6 widens its `include` to
             * the whole integration suite (excluding the gate tests) so that
             * every user story from P5 is proven to pass on the WebGL2 path.
             */
            provider: playwright({
              launchOptions: { channel: 'chromium', args: ['--disable-gpu'] }
            }),
            headless: true,
            instances: [{ browser: 'chromium' }]
          }
        }
      },
      {
        test: { name: 'unit', /* Task 7 写的，原样保留 */ }
      }
    ]
  }
})
```

**为什么两个环境是两个 project 而不是两个 instance**：launch 选项挂在 provider 层，同一个 provider 下的所有 instance 共用一套启动参数。想拿两套，只能两个 project。已实测。

- [x] **Step 3: 写两个守卫**

守卫做成 **setup 文件**，不是「每个测试记得调一下的 helper」：setup 文件在 project 的每个测试文件之前自动跑，忘不掉。

`test/integration/support/require-webgpu.ts`：

```ts
import { beforeAll, expect } from 'vitest'

/*
 * Every test in the `integration` project runs against a real WebGPU adapter,
 * or the run stops here.
 *
 * This guard exists because the failure it catches is silent. Playwright's
 * default headless binary is chrome-headless-shell: WebGL still renders
 * correct pixels through SwiftShader, navigator.gpu still exists, and only
 * requestAdapter() gives the game away by returning null. Without this check
 * the whole suite passes while exercising nothing.
 */
beforeAll(async () => {
  expect(
    navigator.gpu,
    'navigator.gpu is undefined -- this browser has no WebGPU at all'
  ).toBeDefined()

  const adapter = await navigator.gpu.requestAdapter()
  expect(
    adapter,
    'requestAdapter() returned null, so this project is testing nothing. ' +
      'Most likely the browser is chrome-headless-shell (the bundled headless ' +
      'chromium): set launchOptions.channel = "chromium" on the provider ' +
      'factory in vitest.config.ts -- and make sure it is on the FACTORY, not ' +
      'on instances[].launch, where Vitest silently ignores it.'
  ).not.toBeNull()
})
```

`test/integration/support/require-no-webgpu.ts` —— **反向守卫，同样重要**：

```ts
import { beforeAll, expect } from 'vitest'

/*
 * The mirror of require-webgpu. If --disable-gpu ever stops taking effect the
 * fallback project would quietly start testing the WebGPU path instead, and
 * "the WebGL2 downgrade works" would become a claim backed by tests that never
 * went near WebGL2.
 */
beforeAll(async () => {
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
  expect(
    adapter,
    'this project must run WITHOUT a WebGPU adapter, but got one -- ' +
      '--disable-gpu is not taking effect'
  ).toBeNull()

  expect(
    document.createElement('canvas').getContext('webgl2'),
    'WebGL2 must still work here; without it the fallback has nothing to fall ' +
      'back to and the test would be measuring the wrong failure'
  ).not.toBeNull()
})
```

- [x] **Step 4: 写像素回读原语**

`test/integration/support/canvas.ts`。P5 的每个 User Story 都靠它把「画面上有没有东西」变成断言，所以它自己必须先被证明过 —— Step 5 的冒烟测试就是那个证明。

```ts
/*
 * Reading pixels back out of a canvas, for tests that assert on what was
 * drawn rather than on what was returned.
 *
 * Goes through `toDataURL`, NOT `drawImage`. This is measured, not assumed:
 * a WebGPU canvas read by `drawImage` is correct in the task that drew it and
 * in the animation frame immediately after, and fully transparent one frame
 * past that -- 3/3 blank at two rAFs, across all four combinations of
 * {rgba8unorm, bgra8unorm} x {opaque, premultiplied}. The one-rAF case is a
 * race, which is why single samples of it disagree. A test that waited for a
 * frame and then read with `drawImage` would see an empty canvas and report it
 * as a renderer that drew nothing -- a wrong answer wearing the shape of a
 * real failure. `toDataURL` was correct at 0, 1, 2, 5 and 20 frames: 15 of 15.
 *
 * It costs about 2ms per read at 64x32, which is the other reason the read
 * below downscales: a full 1600x1200 canvas is 400x the pixels to decode for
 * a question ("did this change", "is there content") that 64x32 answers.
 *
 * The bytes come back RGBA whatever the canvas's GPU format is: `getImageData`
 * converts on the way out, so the `bgra8unorm` that `getPreferredCanvasFormat()`
 * returns on macOS never reaches the caller and nothing here reorders channels.
 */

/** One frame's worth of waiting for the renderer's own rAF loop to run again. */
export function nextFrames (count = 1): Promise<void> {
  return new Promise((resolve) => {
    let left = count
    const tick = (): void => {
      if (--left <= 0) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

function decode (dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('the canvas did not produce a decodable PNG'))
    image.src = dataUrl
  })
}

/**
 * Reads `canvas` back as RGBA8, downscaled to `width`x`height`.
 *
 * @param canvas - Any canvas, WebGPU or 2D.
 * @param width - Output width. 64 keeps each readback and comparison cheap.
 * @param height - Output height.
 */
export async function readCanvas (
  canvas: HTMLCanvasElement,
  width = 64,
  height = 32
): Promise<ImageData> {
  const image = await decode(canvas.toDataURL('image/png'))
  const scratch = document.createElement('canvas')
  scratch.width = width
  scratch.height = height
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (ctx === null) throw new Error('no 2D context to read the canvas back into')
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/** The largest per-channel difference between two same-size readbacks. */
export function maxChannelDiff (a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) throw new Error('readbacks differ in size')
  let max = 0
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!))
  return max
}

/**
 * How many pixels are not RGB-black (any channel above zero; alpha ignored).
 *
 * The question a "did anything render" test is really asking, and one an exact
 * comparison cannot answer: a viewer that drew the wrong thing still drew.
 */
export function countNonBlack (image: ImageData): number {
  let count = 0
  const { data } = image
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 0 || data[i + 1]! > 0 || data[i + 2]! > 0) count++
  }
  return count
}
```

- [x] **Step 5: 写两个冒烟测试**

`test/integration/smoke.test.ts`（跑在 `integration` project）：

```ts
import { expect, test } from 'vitest'
import { countNonBlack, nextFrames, readCanvas } from './support/canvas'

test('the browser has a real WebGPU adapter', async () => {
  // Non-null: require-webgpu.ts already asserted it. This test's job is to
  // report WHICH adapter, so a machine slipping to a software rasteriser is
  // visible in the log rather than inferred from pixel tolerances later --
  // under a reporter that shows stdout. Vitest's default reporter swallows
  // console.log from passing tests (measured, Task 8 quality review); the
  // CI job (Task 9) is what makes this line visible on every run.
  const adapter = await navigator.gpu!.requestAdapter()
  // GPUAdapterInfo's fields are prototype getters on Chromium (measured on
  // 153 / playwright 1.63): JSON.stringify sees no own enumerable properties
  // and prints "{}", which would eat exactly the signal this log exists to
  // surface.
  console.log('adapter:', adapter!.info.vendor, adapter!.info.architecture)
  expect(
    adapter!.info.vendor,
    'a machine slipping to a software rasteriser must be visible here, not inferred from tolerances later'
  ).toBeTruthy()
})

test('a WebGPU canvas reads back as RGBA, after frames have passed', async () => {
  /*
   * The whole chain in one test: a real device, a canvas configured the way
   * P3's backend will configure it, one frame drawn, and pixels read out of
   * it after the frame boundary. Every later phase asserts on pixels, so if
   * any link here is broken the failures show up there as renderer bugs.
   *
   * `rgba8unorm`, not getPreferredCanvasFormat(). That returns bgra8unorm on
   * macOS, so a canvas whose format follows the host makes every pixel
   * assertion platform-dependent -- which is why the backend pins the format
   * instead (P3) and why this test pins the same one.
   */
  const adapter = await navigator.gpu!.requestAdapter()
  const device = await adapter!.requestDevice()

  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('webgpu')
  expect(ctx, 'no webgpu context on a canvas in a project with a real adapter').not.toBeNull()
  ctx!.configure({ device, format: 'rgba8unorm', alphaMode: 'opaque' })

  const module = device.createShaderModule({
    code: `
      @vertex
      fn vs (@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        return vec4f(p[i], 0.0, 1.0);
      }

      @fragment
      fn fs () -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }
    `
  })
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
    primitive: { topology: 'triangle-list' }
  })

  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: ctx!.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store'
    }]
  })
  pass.setPipeline(pipeline)
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])

  // Two frames, not one. The canvas is only presented after the submit has
  // been through the compositor, and reading inside the drawing task would
  // pass even if nothing were ever presented.
  await nextFrames(2)

  const image = await readCanvas(canvas)
  expect(countNonBlack(image), 'the canvas read back empty').toBe(image.width * image.height)

  // Red, not blue. This is the assertion that catches a channel swap, and it
  // is the reason nothing in this repo reorders bytes: getImageData converts
  // to RGBA on the way out, so a `bgraToRgba`-shaped helper would turn a
  // correct readback into a wrong one -- and, applied to both sides of a
  // comparison, would keep passing while doing it.
  expect(Array.from(image.data.slice(0, 4))).toEqual([255, 0, 0, 255])
})
```

`test/integration/fallback/smoke.test.ts`（跑在 `no-webgpu` project）：

> **（序列化勘误 2026-09-20，Task 8 落地实测）**：上方冒烟测试初版的日志行 `JSON.stringify(adapter!.info)` 在 Chromium 153（playwright 1.63）下恒打 `{}`——`GPUAdapterInfo` 的字段是原型 getter，`JSON.stringify` 只序列化自有可枚举属性。数据本身在（一次性探针实测 `info.vendor === "apple"`、`info.architecture === "metal-3"`，适配器是真 Metal GPU），但测试注释承诺的「机器滑向软渲染器时日志可见」会被序列化吃掉。已改为显式读 getter 打日志（见上方代码块），断言同步收紧到 `vendor` 非空（真 Metal 为 `"apple"`、SwiftShader 为 `"google"`，两条路径下都应非空）——原 `expect(info).toBeTruthy()` 对 getter-only 对象恒真，多收紧的这一步才真拦得住回归。

```ts
import { expect, test } from 'vitest'

test('this project really is the no-WebGPU one', () => {
  // require-no-webgpu.ts asserts the substance; this asserts the plumbing.
  // It cannot catch an include pattern that matches zero files -- vitest
  // exits 0 with no warning in that case (measured, Task 8 quality review);
  // the CI job (Task 9) asserts the project counts instead.
  expect(navigator.gpu).toBeDefined()
  expect(document.createElement('canvas').getContext('webgl2')).not.toBeNull()
})
```

- [x] **Step 6: 跑，并证明守卫真的会拦人**

```bash
npx playwright install chromium && npm run test:integration
```
Expected: 两个 project 都 PASS；日志里有 `adapter: {"vendor":"apple","architecture":"metal-3",...}`（厂商随机器变）。

> **（勘误 2026-09-20，Task 8 落地实录）**：日志格式随 Step 5 的序列化修正变为 `adapter: apple metal-3`（厂商随机器变）。另：下方改法 A 的注记「已实测：4 个测试文件全红」是 plan 撰写期更满的树；当前树 integration project 含 1 个测试文件，实测 1/1 红 + 2 skipped（守卫在 setup 拦下），语义一致——project 内全部文件被拦。

**然后必须实测两种改法都会变红。这一步不能省** —— 一个从未失败过的守卫不算守卫。

**改法 A：去掉 `channel: 'chromium'`**

把 provider 的 `launchOptions: { channel: 'chromium' }` 改成 `launchOptions: {}`，跑 `npx vitest run --project integration`。

Expected: **FAIL**，每个测试文件都报
`AssertionError: requestAdapter() returned null, so this project is testing nothing.`

（已实测：4 个测试文件全红。）改回来。

**改法 B：把 launchOptions 挪到 `instances[]` 上（那个静默陷阱）**

把 `provider: playwright({ launchOptions: { channel: 'chromium' } })` 改成
`provider: playwright()`，同时把 instance 写成
`instances: [{ browser: 'chromium', launch: { channel: 'chromium' } }]`，再跑一次。

Expected: **同样的 FAIL**。这正是这条守卫最大的价值：这个配置错误**本身不报错**，唯一能发现它的就是守卫。

（已实测：同样全红。）改回来。

- [x] **Step 7: Commit**

```bash
git add vitest.config.ts test/integration/tsconfig.json test/integration/ package.json .gitignore
git commit -m "test: browser-mode integration tests with a WebGPU guard that fails loudly

The integration tests now run in vitest's browser mode, so a test file is
in the page and imports the library directly -- no window.__panoTest bridge
and no second tsconfig program for demo/.

Two silent failure modes are possible and both are covered by setup-file
guards: Playwright's bundled headless chromium has no GPU (WebGL still
renders correctly through SwiftShader, so 'pixels appeared' proves nothing),
and vitest 5 ignores launch options placed on instances[] rather than on the
provider factory. Neither reports an error; both are caught here."
```

---

### Task 9: lint 与 CI

**Files:**
- Create: `eslint.config.js`
- Create: `.github/workflows/ci.yml`
- Delete: `.travis.yml`

> **（Task 8 质量审查移交的两项，2026-09-20，随本任务的 ci.yml 一并落地）**：
> ① **集成测试一步须以能透出 stdout 的 reporter 运行**（如 `--reporter=verbose`）。vitest 默认 reporter 不显示通过测试的 console.log（实测），`adapter: <vendor> <arch>` 日志在默认命令与 CI 下都不可见——而「机器滑向软渲染器时日志可见」正是该日志存在的理由，CI 是它每次运行都被看见的地方。
> ② **ci.yml 须对两个 project 的测试数做断言**（跑完检查输出中 `integration` 与 `no-webgpu` 各至少含 1 个测试文件，或等价手段）。实测 include 空匹配时 vitest 静默 exit 0，结构上拦不住「project 静默跑零个测试」；P6 计划要改 no-webgpu 的 include，触发路径是现实日程。

- [x] **Step 1: 写 eslint 配置**

```js
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
```

> **（ignores 增补 2026-09-20，Task 9 落地实测 + 协调侧裁决）**：上方代码块初版 ignores 只有四项，漏了 `test/fixtures/**`——lint 脚本是 `eslint src test`，`test/**` 含 fixtures；P0 vendored 的 v0.2.2 UMD bundle（`test/fixtures/baseline/bundle.js`，17,403 行）首跑贡献 22,929 个 problem（20,585 errors / 2,344 warnings），而它的 sha256 被 P0 capture manifest 钉死（`index.json` 的 `bundleSha256`，字节不一致即校验失败）——「修源码不加 ignore」对它在构造上不可能成立，它与 `dist/**` 同类（hash 钉死的非源码数据）。9 个手写文件（src×2、unit×2、integration×2、support×3）首跑零错零警。代码块已按落地 config 更新；下方 Step 2 的「唯一的例外是 legacy/」随之读作「已在 ignores 里的冻结非源码（legacy/、test/fixtures/）」。

> 选择 `neostandard` 而不是裸 eslint + 一堆插件：它就是把 standardjs 的规则以可维护的形式重新打包，和项目既有的无分号/单引号/2 空格风格一致。spec 里说的「match the surrounding code by hand」在有了 linter 之后可以自动化。

- [x] **Step 2: 跑 lint 并修**

Run: `npm run lint`
Expected: 退出码 0。若有报错，**修源码而不是加 ignore** —— 唯一的例外是 `legacy/`，它已经在 ignores 里。

- [x] **Step 3: 写 CI**

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
      # No GPU on a hosted runner. With CI set, vitest.config.ts adds
      # --enable-unsafe-webgpu --use-webgpu-adapter=swiftshader so the browser
      # exposes a software WebGPU adapter instead of a null one. Both flags are
      # needed; either alone still returns null.
      #
      # The point is NOT that software is a better oracle -- it is float32 like
      # any GPU, so it is not closer to the float64 CPU reference than a real
      # adapter is. The point is that without it this job would be red for a
      # reason that has nothing to do with the code, and a permanently red job
      # is a job people learn to ignore.
      #
      # What it does cost: the gates now have to hold on a software rasteriser
      # AND on a real GPU, so P3's tolerances must be checked under both.
      # `CI=1 npm run test:integration` reproduces this locally.
      - run: npm run test:integration
        env:
          CI: 'true'
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: vitest-browser-artifacts
          # Failure screenshots (always) and Playwright traces
          # (browser.trace: 'retain-on-failure'). Both live under .vitest/.
          path: |
            .vitest/attachments/
            **/__traces__/
          if-no-files-found: ignore
```

> **（2026-09-20 用户裁决 II：CI 不设 legacy job。）** 本步的 yaml 里原本还有第三个 job——checkout 后跑 `npm run build:legacy`，守住「v0.2.x 全程可发版」；该约束废弃后 job 一并删除（见文件头部拍板变更 II）。旧版构建的保险是 git 历史：需要发 0.2.x hotfix 时 checkout 迁移前提交构建发布，Task 1 已实测本机 Node 22 能跑旧 webpack 构建。

- [x] **Step 4: 删掉 travis**

```bash
git rm .travis.yml
```

（它指向 Node 9，早已失效。）

- [x] **Step 5: 本地预演 CI**

```bash
npm run typecheck && npm run lint && npm run test:coverage && npm run build
```
Expected: 全部退出码 0

再跑一遍集成测试的 **CI 路径**（软件适配器），确认它在没有 GPU 的机器上也能绿：

```bash
CI=1 npm run test:integration
```
Expected: PASS。

（已实测：本机与 `CI=1` 两种路径下，集成测试均全绿。`CI=1` 用的是
`google/swiftshader` 软件适配器。）

- [x] **Step 6: Commit**

```bash
git add eslint.config.js .github/workflows/ci.yml
git rm --cached .travis.yml 2>/dev/null || true
git commit -m "ci: replace the node-9 travis config with github actions

Two jobs: unit (typecheck, lint, coverage, build, artifact loads in
plain node) and integration (browser mode with the WebGPU guard, running
on a SwiftShader adapter since hosted runners have no GPU)."
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
 * something to look at. It is deliberately NOT what the integration tests
 * drive -- those run in vitest's browser mode and import the library directly,
 * so the demo page cannot break the suite and the suite cannot quietly start
 * depending on the demo's markup.
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
- [ ] `npm run test:integration` 通过（本机与 `CI=1` 两条路径都跑过），且**两个守卫都验证过会拦人**（Task 8 Step 5）
- [ ] `legacy/` 已建立，`src/` 里没有任何旧代码
- [ ] `.travis.yml` 已删除

## 交给下游的东西

| 产物 | 消费者 |
|---|---|
| vitest 的两个 project（`unit` / `integration`） | 之后每一期 |
| `integration` project 的 WebGPU 守卫（setup 文件，自动生效） | P3 起的所有 GPU 测试 |
| `no-webgpu` project 与反向守卫 | P6 的降级路径测试 |
| `CI=1` 的 SwiftShader 启动参数 | P3 门禁容差的跨环境验证 |
| `src/diagnostics.ts` 的 trace 通道 | P2 起的每一层 |
| 自包含的 vite 库产物 | P5 的公开 API |

> **给 P3 的提醒**：门禁容差必须在**真 GPU 与 SwiftShader 两种环境**下都验证过。
> CI 跑的是 SwiftShader，本机跑的是真 GPU —— 只在其中一边调出来的容差，另一边会红。

> **留给后续期的两笔账（Task 2 质量审查 2026-09-20 提出，P1 不处理）**：
> ① 仓库根还躺着 webpack 时代的 `.npmignore`——`files` 字段现在是白名单，它已失效（`files` 赢），但留着会误导人；P7 清 legacy 时一并 `git rm`。
> ② `src/index.ts` 将硬编码 `VERSION = '1.0.0-alpha.0'`，与 package.json 的 `version` 两处一份——发版时是两个要同步的手改点。要么写进发布检查单，要么 P5 起在构建期从 package.json 派生（vite `define` 一行的事），届时定。

> **给 P2/P3 的 API 类型纪律（Task 3 质量审查 2026-09-20 拍板，保留 `exactOptionalPropertyTypes`）**：该 flag 不写进产出的 .d.ts，只约束本仓库编译，消费者端按他们自己的设置走——所以"传染性"论点对发布产物不成立，且现在收紧、1.0 前放松是安全方向，反之是破坏性返工。**写公开 option 类型时的纪律**：凡消费者会动态构造/展开合并的 option 属性（partial 展开、默认值合并），声明成 `prop?: T | undefined` 而不是裸 `prop?: T`——前者在任何消费者配置下都合法传 `undefined`，产出的 .d.ts 对所有人群最顺手。

> **`sideEffects: false` 的模块结构纪律（Task 4 质量审查 2026-09-20）**：manifest 声明了 `sideEffects: false`，打包器据此可以整模块丢弃「导出未被使用」的模块。P2–P6 因此**不得在任何模块顶层放 load-bearing 工作**——典型翻车姿势是模块作用域里做 GPU 能力探测或全局补丁：import 它但不用其导出的人，这段代码会被 tree-shake 掉，且没有任何报错。副作用要么放进被导出的函数里，要么做成显式的 `init()`。
