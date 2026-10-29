# 更新日志

本文件只保留当前版本摘要和稳定入口；完整版本条目见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## v0.63.2 - degraded 存储只读降级（数据安全修复）与桥接就绪快照分块 - 2026-10-30（已公开发布）

GitHub Release：[https://github.com/a2787/ub-utils/releases/tag/v0.63.2](https://github.com/a2787/ub-utils/releases/tag/v0.63.2)。

数据安全修复与桥接根因修复合并为 v0.63.2 单一发布（中间数据安全候选未单独创建 tag/Release）。

- 修复（critical，OB-STORE-001）：专用开发扩展桥接 degraded（ready 握手被全量拒绝）时，页面以
  默认空存储启动且写路径全部畅通——改设置/确认拉黑会把空态写回 `omniblock:data:v1` 覆盖真实
  名单，首载/外部变更也会把空快照写进 `omniblock:backup:v1` 快照环（旧行为已在夹具中字节级
  复现）。现在桥接 ready 被拒后整页进入只读降级：主名单 persist 与本地快照一律拒写，设置面板
  顶部与右下浮条持续警示「存储桥接未就绪，本页为只读降级模式：名单与设置变更不会保存」（浮条
  可关闭，面板警示保留）；存储恢复后刷新页面即可读回真实名单。Tampermonkey 正常路径行为不变。
  隔离桥双层防御（`test/build-dev-extension.cjs`）：主世界 ready 后先发 `ready-ack` 再放行用户
  脚本，GM 写入在 `!ready` 时拒绝并计数；隔离世界锁存 `ready-ack` 后才转发 `set`/`remove`——
  即使上层误调用，degraded 下也不落盘。
- 修复（high，OB-BRIDGE-001/OB-DEF-002）：专用开发扩展桥接因 ready-response 单信封超过主世界
  8MiB 校验上限而永久 degraded（2026-09-12 起六平台 8 尝试 8 拒绝，根因已实测坐实为事件日志
  分片撑爆载荷）。就绪快照现按 2MiB 分块投递、主世界聚齐后再就绪，每条信封仍受 HMAC/单调序列
  与 8MiB 校验保护——此前永久 degraded 的页面恢复 ready 并能读回真实名单。事件日志保留期补上
  日期口径：不在索引里、超过 30 天保留期的历史分片（含降级时代产生的孤儿大分片）在 `rotate()`
  中被自动清理（≤365 次有界空读，每本地日至多一次），日志总量重新可收敛；`EventLog.status()`
  新增 `orphanSweeps`/`orphanShardsDeleted` 计数。
- `structure regression`：`test/degraded-storage.cjs` 两阶段 10 项——>8MiB 夹具断言分块后 ready
  成功、种子名单读回、孤儿分片被清理、ready 放行对照（六项在旧行为上失败，基线以 git worktree
  运行 HEAD 留证），fallback degraded 只读降级断言（data:v1 被空态覆盖、backup:v1 新增空快照、
  无警示 UI 三项核心断言在旧行为上字节级失败）；修复后 10/10。dev-extension 13/13（新增分块协议
  与桥接门控源码级守卫）；run 20/20、dark-mode、product-extension 3/3。`real-site verified`：
  2026-10-30 专用 Chrome 登录态只读探针（--dedicated-only）扩展刷新到 0.63.2 后四可达平台桥接
  全部 ready（1~2 尝试 0 拒绝），真实读取正常（脱敏 bilibili.com/page/... content=8、
  weibo.com/page/... content=6 users=6、douyin.com/jingxuan/... content=10），同轮捕获 0.63.0
  degraded（8/8）→0.63.2 ready 的前后对照；zhihu 无可探测条目 blocked、tieba/x 浏览器级 CDP
  超时 failed 为既有另案边界。发布后同日专项复测 8/8（真实页桥接 ready、设置跨刷新持久化并还原、
  名单写入与样本→转关键词全链路落桩零污染）。

详细变更、证据和边界：[v0.63.2 完整条目](docs/changelog/v0.63.2.md)。

## v0.63.0 - 自建界面深色模式 - 2026-10-27（已公开发布）

GitHub Release：[https://github.com/a2787/ub-utils/releases/tag/v0.63.0](https://github.com/a2787/ub-utils/releases/tag/v0.63.0)。

- 系统深色（`prefers-color-scheme: dark`）时脚本自建界面自动切换深色主题：设置面板、内容弹窗、
  AI 审核/反馈浮层、关键词面板、确认气泡与确认浮层、作品确认、批量范围面板、AI 待审/后台状态
  浮条等全部可读，原生表单控件与滚动条经 `color-scheme: dark` 随主题变暗；无独立开关，不改动
  平台页面配色。浅色主题规则零改动：深色是样式表末尾纯追加的媒体查询覆盖段，零 JS 行为改动。
- `structure regression`：新增 `test/dark-mode.cjs` 18 项（DARK-2 源码级覆盖段断言；DARK-1 浏览器
  级 emulateMedia 双向切换断言深底浅字/浅底深字；DARK-3 浅色行为回归）；run 20/20、product 7/7、
  ui-settings 16 项全绿。`blocked`：实页验证暂停（2026-09-12 起）。

详细变更、证据和边界：[v0.63.0 完整条目](docs/changelog/v0.63.0.md)。

## 历史版本（完整内容以各条目为准）

- v0.62.0 已屏蔽内容样本库与规则提炼（2026-10-27 发布）：[完整条目](docs/changelog/v0.62.0.md)、[Release](https://github.com/a2787/ub-utils/releases/tag/v0.62.0)。
- v0.61.0 AI 已分析持久缓存、自动批量上限与只看评论（2026-10-27 发布）：[完整条目](docs/changelog/v0.61.0.md)、[Release](https://github.com/a2787/ub-utils/releases/tag/v0.61.0)。
- v0.60.0 设置面板信息架构与操作一致性（2026-10-27 发布）：[完整条目](docs/changelog/v0.60.0.md)、[Release](https://github.com/a2787/ub-utils/releases/tag/v0.60.0)。
- v0.59.0 关键词/正则规则管理升级（2026-10-27 发布）：[完整条目](docs/changelog/v0.59.0.md)、[Release](https://github.com/a2787/ub-utils/releases/tag/v0.59.0)。
- v0.58.0 AI 默认仅手动分析与待审浮条（2026-10-27 发布）：[完整条目](docs/changelog/v0.58.0.md)、[Release](https://github.com/a2787/ub-utils/releases/tag/v0.58.0)。
- v0.57.0~v0.57.4 移动端适配/API 直连/账户加密同步、无 hover 触控入口、自动弹幕正则安全边界、撤销接管右键（2026-09-11~13 发布）：完整条目 [v0.57.4](docs/changelog/v0.57.4.md)、[v0.57.3](docs/changelog/v0.57.3.md)、[v0.57.2](docs/changelog/v0.57.2.md)、[v0.57.1](docs/changelog/v0.57.1.md)、[v0.57.0](docs/changelog/v0.57.0.md)；Release 入口见 [v0.57.4](https://github.com/a2787/ub-utils/releases/tag/v0.57.4)。
- v0.46.0~v0.56.0 AI 屏蔽各阶段、多平台内容入口与作品语境（2026-09-05~10）：完整条目与当时发布状态见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md) 与只读归档；旧条目中的候选/发布状态只代表当时事实。
