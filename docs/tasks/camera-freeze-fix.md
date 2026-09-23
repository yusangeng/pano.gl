---
plan: docs/superpowers/plans/2026-09-23-camera-freeze-fix.md
scope: [src/renderer/webgpu/backend.ts, test/unit/webgpu-backend.test.ts, test/integration/user-story-photo.test.ts, test/integration/user-story-video.test.ts]
verify: npm run gen:shaders -- --check && npm run typecheck && npm run lint && npm run test:coverage && npm run test:integration && npm run build
layer: foundation
deps: [p5-viewer]
state: doing
createdAt: 2026-09-23T03:11:50.274Z
---
# 任务：相机冻结修复：删 setCamera 矩阵相等早退

开工先通读 plan 的「背景」节——修复形状是用户裁决（删早退而非补比较条件），机制链、v0.2.2 取证、门 A/B 失明原因都在里面。三条纪律：①三条红网必须在带缺陷的树上先跑出具名红再动手修（Task 1 的 Step 2/5 就是这道证据，结果写进完成报告）；②变异击杀只认 JSON 报告里具名 status=failed 的用例，退出码不算数，变异在 /tmp git-archive 沙箱做、落刀前后 sha 核对；③边界——不动 TARGET_FORMAT（E35 归 P6）、不动 CameraController.onChange（E37 归 P6/P7）、不动 US5 断言与 no-webgpu project（R1c 第 iii 条）。浏览器会话偶发连接超时是已登记平台抖动，同尖端重跑一次再判。

## 完成报告

（执行者填：做了什么 / 自测结果 / 偏离 plan 的点 / 风险）

## 自审记录

### CR 结论

（执行者填：用了什么 review 手段（gstack review / codex review 等）、发现什么、整改了什么、循环了几轮）

### 测试质量结论

（执行者填：effective-testing 评估发现什么、整改了什么）

## 审查意见

（协调者填：逐条编号；通过则写 approve）
