---
plan: docs/superpowers/plans/2026-09-19-p1-toolchain.md
scope: [package.json, package-lock.json, tsconfig.json, tsconfig.legacy.json, tsconfig.scripts.json, vitest.config.ts, vite.config.ts, eslint.config.js, .gitignore, .travis.yml, .github/workflows/**, README.md, scripts/legacy-build.mjs, src/diagnostics.ts, src/index.ts, test/**, demo/**, webpack/**, legacy/**]
verify: if [ -f vitest.config.ts ]; then npm run typecheck && if [ -f eslint.config.js ]; then npm run lint; fi && npm run test:coverage && npm run test:integration && npm run build; fi
bootstrap: npx playwright install chromium
layer: foundation
deps: [p0-freeze-baseline]
state: open
createdAt: 2026-09-19T08:51:52.237Z
---
# 任务：P1 — 工具链骨架

开工先读 plan 头部。本卡把 v0.2.2 的源码整体迁到 `legacy/`，同时建起新工具链，并把集成测试迁到 **vitest 浏览器模式**（`@vitest/browser` + `@vitest/browser-playwright`，vitest ^5）。

**这是本卡最容易做错的地方：** devDependencies 里是 `playwright`（`@vitest/browser-playwright` 的 peer），**不是 `@playwright/test`**；仓库里不应该出现 `playwright.config.ts`，也不应该有 `page.goto`。测试文件本身就跑在页面里，`import` 就是全部。凡是看到 `demo/test-entry.ts` / `PanoTestApi` / `window.__panoTest` / `demo/test-entry-hooks/`，那都是 P3 切换前的写法，见到就删，不要补建。

verify 写成条件式是**自举悖论**：`vitest.config.ts` 是本卡自己产出的，合并前主分支上还没有它。条件为假时整条跳过，为真时整条跑 —— 所以 `test:integration` 在里面是安全的。

> **lint 段二次条件化（2026-09-20，Task 6 质量审查整改发现）**：`eslint.config.js` 是 Task 9 Step 1 的交付物，而 verify 的外层条件开关（`vitest.config.ts` 存在）在 Task 7 就打开——若 lint 不加自己的守卫，Task 7 落地后、Task 9 落地前的每次交卷检查闸 6 必红（eslint 9 无 flat config 硬错，实测 exit 2）。处理与 `vitest.config.ts` 同款：lint 段套 `if [ -f eslint.config.js ]`，Task 9 落地 config 后条件永真，不再有窗口期。

bootstrap 里的 `npx playwright install chromium` 不能省：默认的 chrome-headless-shell 没有 GPU 栈，`requestAdapter()` 返回 null，所有 WebGPU 测试会静默空跑 —— 两个守卫（`require-webgpu.ts` / `require-no-webgpu.ts`）就是为此而设，Task 8 Step 5 要求验证它们真的会拦人。

`.travis.yml` 在这一卡删除（Task 9 Step 4），所以它必须在 scope 里 —— scope 是改动白名单，**删除也算改动**。

> **scope 修订（2026-09-20，用户裁决 A）**：初版白名单与 plan 对不上，缺三处，已补入上方 scope：
> ①② `tsconfig.scripts.json`（Task 6 建，scripts program）与 `.gitignore`（Task 8 改，补 `.vitest` 与 `dist`）——纯漏列，用户裁决直接授权补正；
> ③ `vite.config.ts`（Task 4 建，库打包配置）——同日 vite 拍板（tsup → vite lib mode）改了 plan，清单没跟着同步，条目 `tsup.config.ts` 已随之替换。此项是执行补正时的复查发现，按同一裁决原则（清单跟定稿图纸对上）延伸处理，已单独向用户报备。
> 均属清单与定稿 plan 的对齐修正，不是执行期扩权。

> **verify/plan 修订（2026-09-20，用户裁决 B）**：「v0.2.x 全程可发版」约束废弃（经查证系 spec 阶段由 AI 写入、用户从未裁决；用户质询后拍板砍掉，发版保险 = git 历史，需要时 checkout 迁移前提交构建）。落地：plan Task 6 瘦身为「scripts 的 typecheck program」——只建 `tsconfig.scripts.json` 并顺手删 Task 2 落地的 `build:legacy` 死脚本行，不再装回 webpack/babel 旧依赖；Task 9 的 CI 两个 job（无 legacy job）；本卡 verify 已去掉 `npm run build:legacy`（即本行所在处）。scope 里的 `scripts/legacy-build.mjs` 条目自此空匹配、无害保留（gate 2 按实际改动路径核对，不会因未触碰的条目报警）。Task 1 的 `git mv` 不受影响——其理由是目录名冲突，独立成立。

> **scope 修订 III（2026-09-20，Task 9 质量审查 I-2）**：`.travis.yml` 删除后 README 首屏残留指向已关停 travis 服务的 Build Status 徽章——它是 Task 9 Step 4「删掉 travis」的残留物，清理属该步本意的收尾而非新功能，`README.md` 补入 scope。授权范围仅限删除该徽章行（standardjs 徽章不动）；是否换挂 GitHub Actions 徽章属仓库门面决策，留给用户合并后自行定夺。

## 完成报告

**做了什么**（截至 d764437 共 51 个提交，均带 `task-p1-toolchain:` 前缀，工作树干净）——按 plan Task 1–10 全量落地：

- **T1** 整树迁移：`git mv src legacy`（6fd0958），为新建 `src/` 腾位（理由是目录名冲突，独立于裁决 B 成立）
- **T2** 工具链替换：移除 babel6/webpack3 全家桶，重装现代化 devDeps（74a3009）；发布加固三件套（00cab2a）——`bugs` URL、`publishConfig.tag: alpha`（1.0.0-alpha.0 > 0.2.2，不设会让 alpha 直接变 latest）、`prepublishOnly`（`files:["dist"]` + 干净检出会静默发出只剩 package.json 的空包，`npm pack --dry-run` 实证过）
- **T3** strict TS 配置 + WebGPU 类型（9a7ddb2）
- **T4** 库打包：vite lib mode 自含 ESM + CJS + dts（cb4a469；tsup→vite 系用户拍板，plan 同步于 d2fb846）；产物不压缩（eac9208，审查裁决，可调试性优先）
- **T5** `src/diagnostics.ts` opt-in trace 通道（edd6c83）；debug 的 unset-DEBUG 状态归一化（cddadbb，审查裁决）；测试强度整改（3907eb8+be30c41）
- **T6** `tsconfig.scripts.json`（scripts typecheck program）+ 删 `build:legacy` 死脚本行（9b8a991，裁决 B 瘦身后的形态）；`@types/node ^22` 对齐 CI 的 Node 22（525f95f）
- **T7** vitest 单元 project，分支覆盖率 ≥90% 作为失败线而非目标（967d8e7）；verify 措辞与 lint 二次条件化（0ad81a5+df5be10）
- **T8** vitest 浏览器模式集成测试 + `require-webgpu` / `require-no-webgpu` 双守卫（b2c1de0，守卫实测会拦人——无适配器的环境响亮地红而不是静默空跑）；质量整改：`__traces__/` ignore、adapter-info 改 getter（0129a5f+580cf61）
- **T9** eslint.config.js（neostandard）+ GitHub Actions ci.yml 两 job，删 node-9 时代的 `.travis.yml`（28a5689）；整改：artifact 步 drifted-glob 可见性（`if-no-files-found: warn`）、lint 忽略 `test/fixtures/**`（d828aec+0f1b30d）；README 删指向已关停 travis 的死徽章（e5fd8fa）
- **T10** 最小 demo 页走 vite dev（b1818bf）；demo TS 并入根 tsc program + lint 引号 glob 圈住 2017 遗产 JS（6c0b2aa+1fa3ca5，Task 10 审查 I-1 整改）
- 完成标准 7 项勾选前，在最终提交树上把整条 verify 重跑了一遍再打勾（b8bcc89），不是只信过程中绿过
- **终审（全分支审查）整改**：必修 #1 dts `include`/`entryRoot` 双钉（13fa5eb）+ 勘误计数（ff0e132）；MINOR 4 typedoc 改输出 `doc/` 并 gitignore（36ef881）；MINOR 5 `tsconfig.legacy.json` 头注释说明 tsserver 静默性（d764437）；必修 #2/#3 与 MINOR 6 属 master 侧 plan 预补（12d0143 / a9eac83 / cb34610 / 94fa3f6）。整改汇总已请终审复审

**自测结果**：verify 全链在最终树上重跑全绿——typecheck 三条腿（根 / integration / scripts program）exit 0 → lint exit 0 → coverage 全阈值通过（分支 ≥90% 为失败线）→ test:integration 浏览器模式全绿（真适配器由守卫断言）→ build 成功且 `dist/index.d.ts` 存在（dts 双钉后由构建直接证明）。交卷第 4 关 task-finish 的闸 6 会当面再跑一遍，以那一刻的绿为准。

**偏离 plan 的点**（均已裁决或登记在卡）：

1. 裁决 A：scope 补正——补 `tsconfig.scripts.json`、`.gitignore`，`vite.config.ts` 替换 `tsup.config.ts` 条目
2. tsup → vite lib mode（用户同日拍板，plan 勘误 d2fb846）
3. 裁决 B：砍「v0.2.x 全程可发版」约束——Task 6 瘦身、CI 两 job、verify 去 `build:legacy`
4. minify:false 与 debug unset-DEBUG 归一化两条审查裁决，已折进 plan（eac9208 / cddadbb）
5. 执行期 plan/card 勘误与逐任务审查整改的 docs 系列提交（约 30 个，审查驱动）
6. 两个 carried-forward debts（明示非本卡工作，00cab2a 登记）：`.npmignore` 待 P7 随 legacy 清理删除；`VERSION` 与 package.json version 双写待 P5/GA 收敛

**风险**：

- typedoc 输出到 git-ignored `doc/`，正式配置归 P7 Task 4（36ef881）
- `tsconfig.legacy.json` 不进 tsserver 自动发现（tsserver 只跟随名为 tsconfig.json/jsconfig.json 的文件），显式 `tsc -p tsconfig.legacy.json` 可用——已写进该文件头注释（d764437），文件由 P7 删除
- CLAUDE.md 的 Commands/Testing 段仍是 Playwright 桥接时代写法、对本期已作废：master 侧已在 P2–P6 plan 登记日期注记（94fa3f6），该文件重写归 P7 Task 4
- 是否换挂 GitHub Actions 徽章：留给用户合并后定夺（scope 修订 III 授权仅删不挂）
- 逐任务质量审查记录在案未整改的 Minor（均为观察/规则集级，非缺陷）：Task 9 的 M-2/M-3/M-4/M-6（neostandard 规则集与 eslint.config.js 的观察项，其中「lint 不含 demo」一项已被 Task 10 的 I-1 整改覆盖）；Task 8 的 Minor 8（`readCanvas` 异常路径无单测——plan 把 canvas.ts 的证明职责放在冒烟 happy path，测试支撑代码不加单测可接受）
- 终审第一轮 NEEDS_FIXES（必修 3 条 + MINOR 3 条）已全部整改落地；终审复审判定写入下方「自审记录·CR 结论」

## 自审记录

### CR 结论

**手段**：superpowers:subagent-driven-development 双段评审（每 Task 先 spec 合规审查、后代码质量审查，T1–T10 共 10 轮 × 2 段，发现即整改即复审）＋ 终末全分支审查（独立评审 agent final-review-p1，独立上下文，审 `main...HEAD` 全量提交及与 master 侧 plan 的一致性）。

**各级发现数与整改**：

- 逐任务阶段：各 Task 质量审查发现均当场整改并复审通过。代表性整改：minify:false（eac9208）、unset-DEBUG 归一化（cddadbb）、测试强度（3907eb8+be30c41）、`__traces__` ignore 与 adapter-info getter（0129a5f+580cf61）、CI drifted-glob 可见性（d828aec）、lint fixtures ignore（0f1b30d）、demo 纳管根 program + 引号 glob（6c0b2aa+1fa3ca5）。
- 终审第一轮 NEEDS_FIXES，共 CRITICAL 1 + IMPORTANT 3 + MINOR 3：
  - CRITICAL #1 dts `include`/`entryRoot` 双钉缺失 → 分支侧 13fa5eb + 勘误计数 ff0e132；
  - IMPORTANT #2 P2/P3 plan legacy 路径预补、#3 P7 plan tsup 残留 → master 侧协调提交 12d0143 / a9eac83 / cb34610；
  - MINOR #4 typedoc 输出 `doc/`（36ef881）、#5 `tsconfig.legacy.json` 头注释（d764437）在分支侧；MINOR #6 CLAUDE.md 作废段落登记（94fa3f6）在 master 侧。
- 终审第二轮复审：上述六项全部确认，新增 IMPORTANT S1（P3/P6 plan 的 tsup 残留）→ master 侧 04336ee（含勘误注记、tombstone 步、按语言选验证 token；残留 grep 命中仅存在于日期注记内，by design）。
- 终审第三轮：**APPROVED**（判定基准 d764437；登记债务按登记处理——VERSION 双写→P5、`.npmignore`→P7、CLAUDE.md 重写→P7 Task 4）。

**轮数**：终审 3 轮闭环（NEEDS_FIXES → 整改 → 复审新增 S1 → 整改 → APPROVED）；连同逐任务双段评审，全程 10 × 2 段 + 3 轮。

### 测试质量结论

**手段**：effective-testing 审查清单逐文件评估本卡全部变更测试（8 文件 +383 行，在最终提交树上通读）：`test/unit/diagnostics.test.ts`（9 条）、`test/unit/diagnostics.init.test.ts`（1 条）、`test/integration/smoke.test.ts`（2 条）、`test/integration/fallback/smoke.test.ts`（1 条）、守卫 `require-webgpu.ts` / `require-no-webgpu.ts`、支撑 `support/canvas.ts`、`test/integration/tsconfig.json`；覆盖率以 `npm run test:coverage` 为准（分支 ≥90% 是失败线，不是目标）。

**发现与整改**：

- 断言强度：diagnostics 用精确清单断言（toEqual 全量键表 / 命名空间表）加区分性用例——「undo 必须保留 skip 项」那条对丢 skip 的弱实现是唯一会红的用例（注释写明）；集成冒烟用精确像素 `[255,0,0,255]`（专抓通道交换）与全量非黑计数（专抓空读回）。唯一弱断言（adapter 信息 `toBeTruthy`）属有意设计：硬断言在守卫，日志可见性归 CI，注释已说明实测依据。无需整改项。
- 负面路径：默认静默、skip 模式、空模式、不可解析模式、无适配器环境（守卫响亮红而非静默空跑）、WebGL2 缺失——单测层占比约四成；两个守卫整体就是负面路径护栏。
- 依赖真实性：单元层仅 stub 环境变量（`vi.stubEnv`），debug 库真实运行；集成层真浏览器真适配器，无核心依赖 mock，无「伪装成单测的集成测试」。
- 本轮评估 **0 条新增 CRITICAL / WARNING**；遗留观察均已在「风险」节记录（Task 9 M-2/M-3/M-4/M-6 规则集观察项、Task 8 Minor 8）。
- 执行期已落地的测试整改：3907eb8+be30c41（Task 5 强度）、0129a5f+580cf61（Task 8）、d828aec+0f1b30d（Task 9）、6c0b2aa+1fa3ca5（Task 10）。

**覆盖陈述**（改动触及的路径，哪些有测试网、哪些没有、为什么）：

- **有网**：`src/diagnostics.ts` 行为面 9 条单测 + import 时序 1 条（独立文件隔离模块注册表，动态 import 前 stub DEBUG）；集成工具链端到端——双守卫钉环境前提，两条冒烟钉「配置-编译-绘制-提交-跨帧-读回」全链；`canvas.ts` 的 happy path（readCanvas / nextFrames / countNonBlack）由冒烟实际调用证明；`tsconfig.json` ×3 由 typecheck 三条腿证明，`vitest.config.ts` 由双 project 实际运行证明，`eslint.config.js` 由 lint 绿证明（含 fixtures ignore 生效）。
- **没有网 + 理由**：① `canvas.ts` 异常分支（decode 失败、2D context 为 null、`maxChannelDiff` 尺寸不一致的 throw）——测试支撑代码，plan 把它的证明职责放在冒烟 happy path（Task 8 Minor 8，记录在案）；② 配置文件的分支行为（include glob 漂移等）无法在单元层表达，其失效模式由 CI 兜底（d828aec 的 `if-no-files-found: warn` 让 drifted-glob 可见 + project 计数断言）；③ `diagnostics.init` 的「nothing-enabled 归一化为 `''`」半边无直接断言——host-pattern 半边有直接测试，nothing-enabled 半边由「默认静默」测试在无 DEBUG 的运行环境观察（运行环境若泄漏 DEBUG 会响亮地红，属可见失效而非静默漂移）。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
