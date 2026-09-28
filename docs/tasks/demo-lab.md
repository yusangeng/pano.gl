---
plan: docs/superpowers/plans/2026-09-24-demo-lab.md
scope: [demo/**, README.md]
verify: npm run typecheck && npm run lint && npm test
layer: tool
state: reported
createdAt: 2026-09-24T08:49:29.827Z
---
# 任务：demo: 交互实验室（lab 主入口 + minimal 双页）



## 完成报告

**做了什么**：demo 双页落地——`demo/minimal.html`（原 index.html 字节保留改名，= README 示例）+ `demo/lab/`（主入口：外壳 + camera/media/status/eventlog 四面板 + diagnostics 通道开关，零新依赖）。7 个 SDD 任务全部双审（spec + 质量）APPROVED，全分支终审 APPROVED（I-1 修复 38daced）。三轮整改循环：CR 32 发现 / 12 修复 / 20 记录（见下）→ 测试质量 4 发现全落 spec §7 豁免（覆盖陈述见结论）→ verify 全绿。

**自测结果**：`npm run typecheck && npm run lint && npm test` 全绿（交卷时 task-finish 当面再跑）。浏览器验收：每任务目检（Task 4 六项含用户本人 headed 实测、Task 5 六项、Task 6 六项）+ 终审十条验收清单 + CR 修复复验（去抖/往返/直写/光标/零 pageerror 六证 + F4 真实场景三证 + transport 四证）。

**偏离 plan 的点**（工作底稿在 `.vibe/deviation-ledger.md`，gitignored，此处为全量摘要）：
- **plan 自身缺陷（编译器/lint/运行时实证后修复）**：D10 lab.css 建了未接线（浏览器目检发现，main.ts 补 import，1290704）；D12 plan 的 camera.ts 过不了 tsc 5 错（判别收窄变量名、pose cast、lint 三处）；D14 `void video.play()` 被 no-void 拒绝（摘 void，行为零差异）；D16 eventlog `{text}` 简写笔误（TS2552，→ `text: type`）。
- **质审 Important 裁决修复**：D13 linear aspect 陈旧缓存 → 单一咽喉点现测（c2bab22）；D15 playHint 残留双触发（同 viewer 连点 + 跨 viewer pending play）→ alive 守卫 + media-play 清 hint（ad3546c）；D15a 裁决 snippet 自删 refreshPlay 会冻结 Play/Pause 标签，实证后保留。
- **终审 Important**：I-1 滚轮缩放不写 URL 书签 → installViewer 挂 zoom 监听、事件时读 `viewers.current`（闭包捕获 handle 会 stale-source，终审确认；38daced）。
- **机械偏离**：D1 commit 补 `task-demo-lab:` 前缀（superloop 硬性要求）；D2/D11 import 深度 `../../src`（plan 路径短一层）；D3 showBanner fatal 参（plan 漏写；CR 轮 M-1 已删该死参数，终态三参）；D4 pose 用公共 API 形状 `Partial<CameraState>`；D5 lint 整改 4 项；D6 跨类换源先 publish(null) 再 dispose；D7 h() 布尔属性 presence 语义；D8 挂载注释措辞；D9 parseNumber 空白参数回退。
- **CR 轮（第1关）**：D17 共 11 项修复（771e1de），含红队 CRITICAL（transport 隐藏失效）与 F4 机制勘误（debug 浏览器端 `save('')` 是 removeItem 非写空串——结论不变、注释措辞已按实证改）。**目检勘误**：Task 5 记录"transport 藏"只查了 hidden 属性未查级联，红队证实 `.transport{display:flex}` 压过 UA `[hidden]`——已修复并四证复验。

**遗留风险**：20 条 CR 记录级发现（逐条见 CR 结论，交协调者裁决）；device-lost 后残余 assertAlive 异常在 fatal 横幅之后（publish(null) 已堵键盘主径，根因 shell 级已记录）；本机 GPUAdapterInfo 原型 getter 对 Object.entries 不可见（status 面板 adapter 行零条——平台无数据非缺陷）。

**附注**：①浏览器复验期间 gstack /browse 守护进程被 headed/connect 会话占用（疑似用户连接的 Chrome），未 disconnect（不动用户会话），改用隔离 headless Playwright 脚本（沿本卡验收条 10 先例）；②会话中两条 gstack 提示未处理（升级 1.60.2.0→1.91.2.0、routing-rules 注入——后者会写 master 的 CLAUDE.md，越本卡 scope）。

## 自审记录

### CR 结论

**手段**：gstack `/review`（`master...HEAD` 全 diff）——Step 4 critical pass（0 新 CRITICAL）→ 5 名专项 agent（testing / performance / maintainability / design / adversarial；Codex 未安装跳过）→ 红队第 6 名 agent（DIFF_LINES>200 激活）；红队唯一发现经主会话代码级亲验（级联法 + 文件内不对称 + 修后浏览器四证）后落地。修复后 typecheck/lint 亲验绿。

**各级发现数**：共 32——CRITICAL 1（红队）、INFORMATIONAL 31（adversarial 8 / maintainability 9 / testing 4 / performance 4 / design 6）。gstack 公式 Quality Score 0.0（1×2+31×0.5 触底；对 demo 级低危密度失真——12 项修复后残留全部为记录级取舍）。

**整改**：12 项修复（commit 771e1de，全部 demo/** scope 内）：URL 书签写 250ms 去抖 + flush 时重读 handle + replaceState 容错（F1+P-3）；device-lost 先 publish(null)（F2）；boot 无横幅分支补 console.error（F3）；诊断空集守卫恢复面板前基线（F4）；showBanner 删死参数（M-1）；清"Tasks 3-6"注释（M-6）；CHANNELS 与库 channels 同步注释（M-8）；SLIDER_STEPS/SEEK_STEPS 具名常量（M-9）；sliderRow 回调先于读数写避免每 tick 强制布局（P-4）；状态 chip cursor:default（design）；transport `[hidden]` CSS 守卫 + 清理路径清空死控件（红队 CRITICAL）。

**轮数**：1 轮（专项+对抗+红队一次 dispatched，修复后复验闭环；无二轮返工）。

**无法清零项（20 条，逐条：内容 / 原因 / 风险自评）**：

*测试类 4 条*——T-1 format.ts 零测试、T-2 parseNumber 负路径零测试、T-3 对数滑条映射无往返测试、T-4 applySource 并发无竞态测试。原因：spec §7 明确 demo 免测试（示例代码首要质量维度是可读性，绑实现细节的测试反而伤示例）。风险：低——库公共面（src/**）本卡零改动、全测试网绿；demo 逻辑错误影响面限于示例页自身，且已有浏览器验收复盖。
*adversarial 4 条*——F5 status adapter 行可能空（原因：GPUAdapterInfo 原型 getter 对 Object.entries 不可见，本机实测零数据——平台现象非代码缺陷，修在库侧还是 demo 侧需真机测量裁决；风险：显示缺行无功能影响）；F6 书签量化 zoom.toFixed(2)/fov 整度（原因：有意设计与面板读数一致；风险：深端 ~17% 相对漂移，仅恢复精度）；F7 重建窗口输入静默丢弃（原因：null 窗口即重入锁的正确行为，亚秒窗口；风险：UX 打磨级）；F8 dpr/aspect 读数为快照（原因：显示层 lazy 更新，应用值始终现测——D13 修复后仅只读行数字暂陈；风险：纯显示陈旧下次交互自愈）。
*performance 2 条*——P-1 每 zoom tick 全量重建控件（原因：plan 的 replaceChildren 设计取舍，质审 Minor 已录同族——重建换取状态一致性；风险：demo 页无可感知卡顿）；P-2 每条日志 append 后读 scrollHeight 强制布局（原因：follow 滚动设计必然读布局；风险：200 行环上限内无感知）。
*maintainability 5 条*——M-2 投影 kind 列表双写、M-3 源枚举三写、M-4 边界字面量双写（原因：公共面不导出这些常量，demo 内跨文件 import 徒增示例耦合，plan 原文如此；风险：demo 演进需手工同步，无运行时风险）；M-5 LabViewer.mode 可由 source 推导（原因：携带 TS 判别类型是 plan 结构；风险：零）；M-7 currentKind() 查 DOM（原因：DOM 即单一事实源；风险：零）。
*design 5 条*——D-1 无 :hover/:focus-visible（原因：样式决策留后续设计轮，UA 默认 outline 仍在；风险：键盘可达性依赖 UA 默认，非零但可接受）；D-2 13px 正文（原因：仪表盘密度即页面存在目的，checklist 自身不建议此处 16px；风险：低）；D-3 窄窗 <500px stage 被挤（原因：桌面工具定位；风险：窄窗体验差无横向滚动）；D-4 触控目标 <44px（原因：指针驱动桌面工具；风险：触屏用户操作偏难）；D-6 标题层级倒置无 h1（原因：示例页面语义；风险：屏幕阅读器大纲非常规）。

### 测试质量结论

**评估**：testing 专项 agent 全量评估本 diff 的测试面——4 条发现（format.ts/parseNumber/对数映射/applySource 并发均零测试），全部因 spec §7 落入豁免，整改为零改动（豁免即裁决，非失职）；无其它发现。

**覆盖陈述（必含）**：本卡改动面 = `demo/**` + `README.md`，**库代码（src/**）零改动**。库侧路径全部有既有测试网且全绿——unit（90% 分支覆盖率硬闸）+ integration 双后端 + 三门 gate（A 像素基线 / B 投影 / C 跨后端），`npm test` 交卷当面绿。demo 侧路径（URL 解析、面板状态机、transport 接线、诊断开关、format 纯函数）**无自动化测试网**——依据 spec §7 demo 免测试条款：示例代码的质量维度是可读性与正确用法示范，为其加实现细节级测试会把示例绑死；替代保障为每任务浏览器目检 + 终审十条验收清单 + CR 轮三组脚本复验（六证/三证/四证）。残余风险：demo 逻辑回归无自动化拦截——接受，属豁免条款的既定取舍。

## 审查意见

（协调者填：逐条编号；通过则写 approve）
