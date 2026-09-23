---
plan: docs/superpowers/plans/2026-09-23-pan-zoom-semantics.md
scope: [[src/core/reference.ts, src/renderer/webgpu/shaders/panorama.wgsl, src/renderer/webgl2/shaders/panorama.glsl, src/viewer/camera-controller.ts, src/viewer/viewer.ts, test/**, CLAUDE.md]]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: foundation
deps: [p6-webgl2-backend]
state: doing
createdAt: 2026-09-23T09:00:57.224Z
---
# 任务：pan 手感与 zoom 语义修正：lng 诚实换算 / zoom 方向 / linear fov zoom

开工先通读 plan「背景」节：C2 方向链三步推论、/4 考古、负分母陷阱、门 A 已测定零改动，全在里面。纪律：①红网先行——Task 1 全部用例在带缺陷树上跑出具名红并记录后才动 src，测试与修复同一提交；②lng 公式 wgsl/glsl/reference 三处同一提交改齐（门 C 红线），三处注释互指一致；③gen:shaders 管线不碰，src/renderer/shaders/generated.ts 不得进本卡 diff；④不动 src/interaction/ 与 src/index.ts，US5 与 no-webgpu project 零 diff；⑤完成报告受检节标题下先放一行正文再接 ### 子节，否则 task-finish 闸 1 会误报未填（superloop 已知缺陷）。无本地环境依赖，无需 bootstrap。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
