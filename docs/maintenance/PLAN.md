# OmniBlock 当前维护计划

更新时间：2026-08-30

本文件是 OmniBlock 唯一的活动计划。它记录当前要解决的问题、范围、依赖、验收条件和
下一步动作；当前事实放在 `CURRENT.md`，用户可见变化放在 README/版本 changelog，已经
结束的计划移入历史索引，不在这里无限累积。

## 使用契约

- 每项计划必须有稳定的 `OB-*` ID；代码、测试、ADR 和交接记录引用该 ID，而不是依赖对话中的临时称呼。
- `status` 只能使用 `proposed`、`approved`、`in_progress`、`verified`、`deferred`、`blocked`、`superseded`。
- `verified` 必须有可追溯证据；`blocked` 必须写明阻断原因和下一步，不能当作通过。
- 依赖必须引用本文件已有 ID，不能形成循环；被替代的计划保留原文并链接新的决定。
- 活动计划接近 24 KiB 时先拆分职责并更新知识树，不能把历史台账继续追加到本文件。

## 状态流转

```text
proposed → approved → in_progress → verified
                                ├→ blocked
                                ├→ deferred
                                └→ superseded
```

## 活动项

### OB-PERF-001 — 可归因的性能预算

- status: blocked
- priority: P2
- scope: 抖音高频 DOM、深层扫描、虚拟列表、B 站弹幕和日志/存储写入的测量与优化。
- non-goals: 不凭单次主观 CPU 观察修改多个平台的行为。
- dependencies: none
- acceptance: required
  - [x] 能分别报告 mutation、扫描、布局、日志和存储耗时。
  - [x] 有可重复的可见/隐藏/换片场景本地基线和回归阈值。
  - [x] 真实页面无法访问时保留 blocked，不用夹具数字替代。
  - [ ] 取得可归属于当前构建的抖音真实静置、播放和换片基线。
- evidence: structure regression 7/7；2026-08-30 抖音隔离页进入验证码中间页，无法采集真实 CPU/脚本时长。
- next: 在无需读取 Cookie 的可访问抖音会话中复跑只读探针并采集静置、播放和切换视频基线；此前保持 blocked。
- updated: 2026-08-30
- supersedes: none
- files: omniblock.user.js; test/performance.cjs; test/real-platform-probe.cjs

### OB-MAINT-001 — 重复路径清理与受控模块化

- status: deferred
- priority: P3
- scope: 已证实不可达的兼容代码、重复测试夹具以及最终 userscript 构建边界。
- non-goals: 不为了“文件变小”而一次性重写全部平台适配器。
- dependencies: OB-PERF-001
- acceptance: required
  - [ ] 每个删除项有调用方审计和替代路径回归。
  - [ ] 若拆分源码，生成产物与元数据、执行顺序和行为保持可比对。
  - [ ] 模块化带来的构建复杂度不高于它解决的维护成本。
- evidence: pending
- next: 等抖音真实基线解除 blocked 后，先做调用方审计；没有明确收益时维持单文件发布物。
- updated: 2026-08-30
- supersedes: none

### OB-REL-001 — CI 与公开发布准备

- status: deferred
- priority: P3
- scope: 本地命令入口、CI status check、源码/构建 hash、版本/tag/Release 一致性。
- non-goals: 不在未获当前任务明确授权时 push、覆盖 tag 或公开发布。
- dependencies: OB-PERF-001
- acceptance: required
  - [ ] 获得 CI/CD 配置修改授权后，CI 可运行不依赖维护者机器上的隐含路径或未锁定依赖。
  - [x] 候选说明分别列出 real-site verified、structure regression 和 blocked。
  - [x] Release 门禁只接受明确授权和可追溯的构建产物。
- evidence: 本地完整矩阵、源码 hash 和发布边界已落地；当前任务未授权修改 CI/CD、push、tag 或 Release。
- next: 用户明确授权 CI/CD 修改时再新增最小工作流；公开发布需另获当轮 push/tag/Release 授权。
- updated: 2026-08-30
- supersedes: none

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
