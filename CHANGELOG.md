# 更新日志

本文件只保留当前版本摘要和稳定入口；完整版本条目见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## v0.64.0 - Personal 2.0 一键屏蔽与诊断收口 - 2026-11-23（本地候选；发布状态待回写）

把作者/快捷入口的本地屏蔽压缩为一次点击，保留批量/弹幕/UID 确认与 `bili:dmhash` 确认守护；新增 10 秒可配撤销与“撤销上一次”，Health 诊断卡与一次存储异常提示，日志 7 天/5 千条/2 MiB，坏备份不覆盖；设置增加工作台/AI/撤销入口，移除重复规则按钮，更新检查覆盖设置面板/GM 菜单/关面板终态；README 拆分为 9 KiB 快速开始，CI 补 4 个核心测试、7 个 headless AI 套件与 code-health，并删除旧抖音管理器死代码。`structure regression` 全套通过；`real-site verified` 已覆盖 B站主/子评论与整楼直提、微博回复行直提和专用 Chrome 三平台入口；B站列表/关注流、微博顶层 spacer、知乎/贴吧/X 等受限项按 `blocked` 保留；tag/Release/raw 在发布轮回写。详细记录：[v0.64.0 完整条目](docs/changelog/v0.64.0.md)。

## v0.63.4 - 三项可发现性改进 - 2026-11-19（已公开发布；结构回归，未做真实站点验证）

GitHub Release：[https://github.com/a2787/ub-utils/releases/tag/v0.63.4](https://github.com/a2787/ub-utils/releases/tag/v0.63.4)。tag `v0.63.4` 指向提交 `9ffbd0d`，公开 raw 已核验返回 `0.63.4` / `0.63.4-discovery-fixes`。

三项同属"让已有功能能被用户找到"的可发现性改进，合并为 0.63.4 单一发布：

- 控制坞收起态齿轮常驻可见：桌面端控制坞（FloatingDock）收起态下设置齿轮 `#ob-gear` 被 `transform: translateX(32px)` 推出可视边缘只露一条边，且产品内无首次引导；2026-11-18 四平台桌面截图全部看不到齿轮，仅靠 DOM 的 `aria-label="打开 OmniBlock 设置"` 确认其存在。改为 `transform: translateX(0); opacity: .55`（常驻可见但低对比度），悬停/键盘聚焦由既有 expanded 规则恢复 opacity 1；其他按钮悬停展开、1800ms 自动收起与触控端均不变。
- 设置面板「规则」分组填实：该分组原本只有两段指路文字、零控件，按导航点进去扑空；现加入 B站/抖音规则管理两个按钮（`#ob-rules-bili` / `#ob-rules-douyin`），复用 `openKeywordManager`；分组 1 原按钮保留。该函数用硬编码 adapter、不读当前平台，实测在微博页点击也能打开对应平台管理界面。
- 首次访问一次性提示：新用户首次在某站点挂载后，齿轮左侧显示两行浮条「OmniBlock 已启用 / 本地内容屏蔽工具，点右下角 ⚙ 设置」，可点 × 关闭。标志位存独立键 `omniblock:ui-hint:v1`，直走 `GM_getValue`/`GM_setValue`，不经 Store/persist/键白名单；读失败按未提示处理，降级态可显示但零写入，点齿轮也算已知入口。

`structure regression`：完整 24 脚本矩阵 23 通过——`test/run.cjs` 20/20（E/E2/E3/E4/E5 全过）、`test/state.cjs` 9/9、`test/userscript-product.cjs` 7/7、`test/adapters.cjs` 28/28、`test/quickblock.cjs` 38/38、`test/degraded-storage.cjs` 15/15；computed style 收起态 0.55 / 展开态 1 / 触控态 1。仅本地夹具验证，未做真实站点验证。详细变更、证据和边界：[v0.63.4 完整条目](docs/changelog/v0.63.4.md)。

## v0.63.3 - 存储空态防护加固 - 2026-11-18（已公开发布）

GitHub Release：[https://github.com/a2787/ub-utils/releases/tag/v0.63.3](https://github.com/a2787/ub-utils/releases/tag/v0.63.3)。

承接 v0.63.2 的 degraded 只读降级，为 `persist()` 补上数据层空值校验：`countIdentityKeys`/`isDefaultState`
判定 + `EXPLICIT_EMPTY_REASONS` 白名单 + `lastPersistedIdentityCount` 基线跟踪 + `emptyOverwriteRefusals`
指标，阻止"空态被当成正常状态覆盖真实名单"。未改 degraded 状态机，纯 Tampermonkey 路径仍无层 2 兜底。

`structure regression`（仅夹具验证，无真实站点证据）。详细变更、证据和边界：[v0.63.3 完整条目](docs/changelog/v0.63.3.md)。

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
