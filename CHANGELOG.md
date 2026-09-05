# 更新日志

本文件只保留当前版本摘要和稳定入口；完整版本条目见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## v0.46.2 - B站子评论菜单与楼回复入口修复 - 2026-09-05（本地候选，未公开发布）

- 将 B站主评论菜单中的楼操作显示为四字短文案「🧵 屏蔽回复」，保持菜单单行；完整功能语义保留在 title/aria-label「屏蔽该楼回复」。
- 识别真实 `BILI-COMMENT-ACTION-BUTTONS-RENDERER` 内的 `#more`/更多图标触发器，使子评论三点菜单打开后能及时补扫并插入「🚫 本地拉黑」。
- 子评论只插入本地拉黑，不插入只适用于主评论的楼回复入口；弹幕举报的 `mid_hash` 安全边界和评论 `bili:uid` 解析保持不变。

详细用户变化、验证标签和限制：[v0.46.2 完整条目](docs/changelog/v0.46.2.md)。

发布状态：`v0.46.2` 仅为本地候选，未 push、未创建 tag 或 GitHub Release；当前公开版本仍为
[OmniBlock 0.46.0](https://github.com/a2787/ub-utils/releases/tag/v0.46.0)。候选构建为
`0.46.2-bili-subcomment-menu-layout`；当前源码版本/构建和真实站点边界见
[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.46.1 - B站评论举报菜单本地入口回归修复 - 2026-09-05（历史本地候选，未公开发布）

- 修复 B站视频评论菜单中「硬核会员举报」被误判为弹幕举报，导致没有浮动弹幕身份时提前返回、本地入口不再插入的问题。
- 评论菜单继续按当前评论节点解析规范 `bili:uid`；只有非评论菜单的 B站弹幕举报仍要求唯一、未过期的 `mid_hash` 身份。
- 新增人工合成回归覆盖“仅有硬核会员举报”的 `bili-comment-menu`，避免后续菜单文案变体再次绕过本地入口。

详细用户变化、验证标签和限制：[v0.46.1 完整条目](docs/changelog/v0.46.1.md)。

发布状态：`v0.46.1` 仅为本地候选，未 push、未创建 tag 或 GitHub Release；当前公开版本仍为
[OmniBlock 0.46.0](https://github.com/a2787/ub-utils/releases/tag/v0.46.0)。候选构建为
`0.46.1-bili-comment-menu-report`；当前源码版本/构建和未完成的真实站点边界见
[当前维护状态](docs/maintenance/CURRENT.md)。

## 历史版本

上一候选版本 [v0.46.1](docs/changelog/v0.46.1.md)，上一公开版本 [v0.46.0](docs/changelog/v0.46.0.md)；更早条目已移至
[变更日志索引](docs/changelog/INDEX.md) 和只读归档；旧条目中的候选/发布状态只代表当时事实。
