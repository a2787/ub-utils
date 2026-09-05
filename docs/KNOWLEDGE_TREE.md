# OmniBlock 文档知识树

本文件是 AI 接手仓库时的阅读路由。它解决两个问题：先读什么，以及哪些内容不应该在每轮
工作中整篇加载。规则正文只保留在一个位置，其他文档通过链接引用，不复制另一份会过期的规则。

## 标准阅读顺序

1. `AGENTS.md`：本仓库的强制约束、安全红线、验证标签和最低门禁。
2. `docs/KNOWLEDGE_TREE.md`：本文件，确定任务范围和需要继续读取的节点。
3. `docs/MAINTENANCE_WORKFLOW.md`：从复现、修改、验证到发布的标准流程。
4. `docs/maintenance/CURRENT.md`：最近验证的源码快照、版本、证据、限制和下一项最有价值的验证。
5. `docs/maintenance/PLAN.md`：唯一活动计划、依赖、验收标准和下一步。
6. `docs/architecture/ARCHITECTURE.md`：运行时职责、生命周期、数据和性能边界。
7. 按任务读取 `README.md`、相关测试、相关平台探针和必要的历史条目；不要默认读取历史归档。

## 知识树

```text
AGENTS.md
├── 强制规则、安全红线、证据标签、最低验证矩阵
├── docs/KNOWLEDGE_TREE.md                 ← 阅读路由与文档治理
├── docs/MAINTENANCE_WORKFLOW.md           ← 唯一维护流程正文
├── docs/maintenance/CURRENT.md            ← 当前事实与交接状态
├── docs/maintenance/PLAN.md               ← 唯一活动计划与状态机
├── docs/architecture/ARCHITECTURE.md      ← 运行时架构与资源边界
├── docs/decisions/                         ← 不可频繁变化的单项架构决策
│   └── 0001-maintenance-control-plane.md
├── docs/maintenance/HISTORY_INDEX.md      ← 历史事实按需索引
│   ├── docs/maintenance/plans/             ← 已关闭计划的短归档
│   └── docs/maintenance/LEGACY-HISTORY.md ← 重组前只读完整历史
├── README.md                              ← 安装用户行为与当前限制
├── CHANGELOG.md                           ← 当前版本短摘要与历史入口
└── docs/changelog/
    ├── INDEX.md                           ← 版本条目路由
    ├── v0.46.0.md                         ← 当前版本完整发布说明
    └── LEGACY-HISTORY.md                  ← 重组前只读完整变更日志

验证入口：`test/docs-check.cjs` 维护本知识树的大小、链接、计划、快照、版本和关键内容门禁；受影响平台的
回归测试和真实探针仍按 `AGENTS.md` 的验证矩阵选择，不在本树中复制测试细节。
```

## 按任务路由

| 任务 | 必读节点 | 只在必要时读取 |
|---|---|---|
| 普通代码修复 | `AGENTS.md`、本文件、`MAINTENANCE_WORKFLOW.md`、`maintenance/CURRENT.md`、`maintenance/PLAN.md`、`architecture/ARCHITECTURE.md` | 受影响平台的源码/测试、README 对应段落 |
| 平台适配或真实站点验证 | 上述活动节点 | 对应 `test/real-*.cjs`、平台回放、相关历史条目 |
| 性能、日志、生命周期 | 上述活动节点 | `test/performance.cjs`、运行时相关测试、性能历史 |
| 用户可见功能 | 上述活动节点、`README.md` | 当前版本 changelog 条目、受影响测试 |
| 发布或回滚 | 上述活动节点、`CHANGELOG.md`、`docs/changelog/INDEX.md` | 对应版本条目和发布历史 |
| 仅文档治理 | `AGENTS.md`、本文件、`MAINTENANCE_WORKFLOW.md` | 受影响索引，不读取平台历史 |

## 文档所有权

- 规则的唯一正文：`AGENTS.md` 和 `docs/MAINTENANCE_WORKFLOW.md`。两者发生冲突时，先在同一轮明确修订并同步。
- 活动计划的唯一正文：`docs/maintenance/PLAN.md`；架构边界的唯一正文：`docs/architecture/ARCHITECTURE.md`。
- 当前事实的唯一正文：`docs/maintenance/CURRENT.md`。根 `MAINTENANCE.md` 只是入口索引。
- 安装用户行为：`README.md`；版本发布摘要：根 `CHANGELOG.md` 与对应 `docs/changelog/vX.Y.Z.md`。
- 历史归档只用于追溯，不作为当前规则、当前版本或当前验证状态的来源。不得在归档中追加“最新状态”。
- 代码、测试、文档和发布说明都不得保存 Cookie、凭证、原始个人浏览数据或未经脱敏的真实页面标识。

## 更新不变量

每次工作结束前必须检查“注意更新”清单：

- 用户可见行为变了：同步 `README.md`、当前版本 changelog 和 `CURRENT.md`。
- 验证结果、限制、命令或下一步变了：同步 `CURRENT.md`；必要时追加历史交接，而不是覆盖旧事实。
- 流程、安全红线或文档结构变了：同步 `AGENTS.md`、本文件和 `MAINTENANCE_WORKFLOW.md`。
- 版本、构建、tag、Release 或 raw 地址变了：同步当前状态、changelog 和发布台账。
- 文档被拆分、合并或移动：同一提交更新所有索引、链接和 AI 阅读顺序。
- 提交前运行 `node test/docs-check.cjs`；不要只依赖人工记忆“以后再更新”。
- 计划状态、依赖、验收或架构边界变化：同步 `PLAN.md`/`ARCHITECTURE.md`，必要时新增短 ADR；不要在 CURRENT 里复制完整计划。

## 文档大小边界

活动文档按 UTF-8 字节数管理，不按“看起来还好”判断。默认预算为：`AGENTS.md` 16 KiB、
`docs/KNOWLEDGE_TREE.md` 12 KiB、`docs/MAINTENANCE_WORKFLOW.md` 24 KiB、
`MAINTENANCE.md` 16 KiB、`docs/maintenance/CURRENT.md` 24 KiB、根 `CHANGELOG.md` 24 KiB、
单个版本条目 24 KiB、`README.md` 64 KiB。超过预算必须在本轮拆分，或在台账中记录明确理由和期限。

`LEGACY-HISTORY.md` 是本次重组前保留的不可编辑归档，不进入每轮 AI 必读集合，也不允许把新事实写回其中；
以后若需要修订历史，新增小型补充条目并更新历史索引。任何新的活动文档都不能借“历史”名义绕过大小预算。

活动计划预算为 24 KiB，架构正文预算为 24 KiB，单个 ADR 预算为 12 KiB；达到预算先去重、拆分并更新本树。
