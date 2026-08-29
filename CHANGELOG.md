# 更新日志

本文件只保留当前版本摘要和稳定入口；完整版本条目见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## v0.46.0 - 受控生命周期、签名开发桥与分帧性能预算 - 2026-08-30

- 新增统一运行时资源注册表和 freeze/resume、BFCache、普通 pagehide 边界；SPA 路由由单一信号源广播。
- 新增子树队列的 8ms/32 根分帧预算，移除跨平台和空闲状态下的无效入口轮询。
- 持久 MV3 开发桥使用 HMAC 签名、序列校验、存储/网络白名单与有界降级，且不向页面暴露 `window.GM_*`。
- 设置页显示名单容量软预警；名单、日志、扫描和微博布局提供可归因性能指标，日志分片尺寸使用缓存避免反复序列化。
- 建立唯一活动计划、运行时架构、ADR 和可执行文档/源码快照门禁。

详细用户变化、验证标签和限制：[v0.46.0 完整条目](docs/changelog/v0.46.0.md)。

发布状态：`v0.46.0` 是本地候选；未创建 tag，未推送，未创建 GitHub Release。当前公开版本仍为
[OmniBlock 0.45.0](https://github.com/a2787/ub-utils/releases/tag/v0.45.0)。
当前源码版本/构建和未完成的真实站点边界见 [当前维护状态](docs/maintenance/CURRENT.md)。

## 历史版本

上一版本 [v0.45.0](docs/changelog/v0.45.0.md) 与更早条目已移至
[变更日志索引](docs/changelog/INDEX.md) 和只读归档；旧条目中的候选/发布状态只代表当时事实。
