# 更新日志

本文件只保留当前版本摘要和稳定入口；完整版本条目见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## v0.45.0 - 全插件性能与资源效率优化 - 2026-08-29

- 共享 MutationObserver、增量脏节点、页面可见性暂停和 Shadow DOM 遍历复用，减少无意义扫描。
- 修复抖音弹幕逐条重复深扫造成的高 CPU 热路径，复用播放器/会话边界并按当前观察节点增量处理。
- 为评论、弹幕、微博虚拟列表和日志增加缓存/写入边界；保留详细用户操作日志，将被动 DOM/扫描事件改为窗口聚合。
- 增加持久 MV3 开发扩展和无源码注入双新页探针，统一右下角浮动控制坞的收起、展开、保持和动效行为。

详细用户变化、验证标签和限制：[v0.45.0 完整条目](docs/changelog/v0.45.0.md)。

发布状态：`v0.45.0` 已创建并推送，GitHub Release：[OmniBlock 0.45.0](https://github.com/a2787/ub-utils/releases/tag/v0.45.0)。
当前源码版本/构建和未完成的真实站点边界见 [当前维护状态](docs/maintenance/CURRENT.md)。

## 历史版本

历史条目已移至 [变更日志索引](docs/changelog/INDEX.md) 和只读归档；旧条目中的候选/发布状态只代表当时事实。
