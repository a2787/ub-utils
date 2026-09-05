# OmniBlock 维护与交接入口

本文件是短索引，不再承载数十个版本的完整流水账。AI 接手本项目时按下面顺序读取；当前事实、详细流程和历史记录
分别只有一个权威位置，避免多份文档互相过期。

## 每轮必读

1. [AGENTS.md](AGENTS.md)：强制规则、安全红线、验证标签、最低验证矩阵。
2. [docs/KNOWLEDGE_TREE.md](docs/KNOWLEDGE_TREE.md)：知识树和按任务阅读路由。
3. [docs/MAINTENANCE_WORKFLOW.md](docs/MAINTENANCE_WORKFLOW.md)：标准维护、验证、发布和文档更新流程。
4. [docs/maintenance/CURRENT.md](docs/maintenance/CURRENT.md)：当前版本、证据、限制和下一步。
5. [docs/maintenance/PLAN.md](docs/maintenance/PLAN.md)：唯一活动计划、状态、依赖和验收条件。
6. [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md)：运行时架构、生命周期和资源边界。
7. [docs/decisions/0001-maintenance-control-plane.md](docs/decisions/0001-maintenance-control-plane.md)：维护控制平面架构决策。

README、测试、平台探针和历史记录只按任务读取；不要默认打开历史归档。

## 当前状态

- 当前版本、发布事实和证据：见 [docs/maintenance/CURRENT.md](docs/maintenance/CURRENT.md)。
- 当前版本详细发布说明：见 [docs/changelog/v0.46.0.md](docs/changelog/v0.46.0.md)。
- 历史维护索引：见 [docs/maintenance/HISTORY_INDEX.md](docs/maintenance/HISTORY_INDEX.md)。
- 历史变更索引：见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## 强制更新思路

每次修改结束、验证结束、发布结束都要“注意更新”：用户行为更新 README/changelog，证据和限制更新 CURRENT，
流程或文档结构更新 AGENTS/知识树/流程，版本和 Release 更新当前 changelog 与发布台账。文件移动、拆分或合并时，
同一提交更新所有索引和链接。提交前运行 `node test/docs-check.cjs`，使更新责任由门禁检查而不是个人记忆承担。

## 文档大小

活动文档按 UTF-8 字节预算管理：AGENTS 16 KiB、知识树 12 KiB、流程 24 KiB、根入口 16 KiB、当前状态 24 KiB、
根 changelog 24 KiB、单版本条目 24 KiB、README 64 KiB。超过预算必须拆分、去重并更新知识树；重组前的完整维护/变更记录
已移动为只读归档，不再是 AI 每轮读写对象。

详细规则、拆分顺序、验证矩阵和交接模板统一见 [docs/MAINTENANCE_WORKFLOW.md](docs/MAINTENANCE_WORKFLOW.md)。
