# OmniBlock 当前维护状态

更新时间：2026-08-30
状态来源：0.46.0 本地候选实现、结构回归与维护控制平面重建；历史过程见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

## 当前版本

- 本地候选 userscript：`0.46.0`
- 构建：`0.46.0-signed-bridge-lifecycle-budgeted-scanner-storage-metrics`
- 当前公开版本：`0.45.0`
- 当前公开功能提交：`17c6c45fe169da3943bd64544155eb5e6056514d`
- 最近验证的源码快照：`74bf0f87b0fed560445018447740875652615936`
- 当前候选源码 SHA-256：`eebd7523ca594e4209565eb040872bd6d17f7517f432a578d097bbb3b8ef4f5f`
- 快照语义：`74bf0f8` 是包含 0.46.0 userscript、开发桥、性能/生命周期回归、真实 B站探针和用户说明的功能提交；
  后续维护控制平面文档提交位于它之后，但不冒充新的功能快照。
- 当前候选发布状态：未创建 `v0.46.0` tag，未 push，未创建 GitHub Release。
- 当前公开 tag/Release：[`v0.45.0`](https://github.com/a2787/ub-utils/releases/tag/v0.45.0)。

## 本轮已落实

- 开发扩展桥使用构建期随机 HMAC、来源/序列校验、存储和只读 URL 白名单；页面不再获得 `window.GM_*`，ready 最多 8 次后降级。
- `RuntimeResources`、freeze/resume/BFCache/pagehide 边界和共享 SPA route 信号已落地；扫描器、循环、订阅和抖音播放器观察器有统一 teardown。
- MutationObserver 回调只排队新增子树；下一帧按 8ms/32 根预算处理，超过 128 根合并为全量请求。三个无效启动补扫已移除。
- B站/微博作者、快速菜单、作品和批量入口改为活动信号触发的一次性防抖；非当前平台不创建活动作者循环。
- EventLog 缓存日期分片字符数；Store/EventLog 与可选诊断分别报告 persist/flush、mutation、扫描和微博布局耗时。
- 设置页显示主名单人物、身份和序列化体积，并在 2 MiB/3 MiB 区间提供软预警；不自动删数据，也不增加人数硬限制。
- 通用页面生命周期、共享 MutationObserver、增量脏节点和 Shadow DOM 遍历复用。
- 后台标签页暂停非必要工作，恢复前台时补同步；一次性 timeout 循环避免重入和失控唤醒。
- 抖音活动播放器/视频会话缓存，自动弹幕规则按当前观察节点处理，避免逐条弹幕递归深扫。
- B站弹幕 progress/CRC/例外索引、评论管理器和微博评论缓存设置数量上限，只保存必要元数据。
- 被动 DOM/扫描日志改为 10 秒窗口聚合；用户操作、屏蔽/恢复、状态转移和错误仍逐条记录。
- 持久 MV3 开发扩展、跨页面 GM 存储桥接和无源码注入双新页探针。
- `test/installed-browser-probe.cjs` 使用直接页面级 CDP，规避 Chrome 148 浏览器级 CDP handshake 超时误判。

## 2026-08-29 文档治理重组（本轮）

- 范围：把维护流程、当前事实、版本说明和历史台账拆成知识树；明确每轮“注意更新”责任；为活动文档建立 UTF-8 大小预算和自动门禁。
- 已完成：根 `MAINTENANCE.md`/`CHANGELOG.md` 改为短入口，新增 `docs/KNOWLEDGE_TREE.md`、`docs/MAINTENANCE_WORKFLOW.md`、
  `docs/maintenance/CURRENT.md`、历史索引、当前版本条目和 `test/docs-check.cjs`；原维护与变更台账完整移动到只读归档。
- `structure regression`：`node test/docs-check.cjs` 已通过；活动文档均在预算内，内部 Markdown 链接、当前版本和构建标识一致。
- `node test/maintenance-check.cjs` 的本地部分通过，综合退出为 `blocked`；阻断原因仍是上方列出的既有真实站点条件，未发现文档改动导致的代码回归。
- 本轮没有修改 userscript 功能、版本号、tag 或 Release；功能发布事实仍以本文件上方的 0.45.0 条目为准。
- 关闭状态：文档重组已在本地提交 `a9b531c0c527d7b101492646868065b093f9f164`，提交后工作区干净；本轮没有推送远端。

## 2026-08-30 维护控制平面与 0.46.0 候选收口

- 范围：建立唯一活动计划、运行时架构地图、单项 ADR，并把计划状态、源码快照、文档大小和发布授权纳入机器门禁；
  同时完成签名开发桥、页面 teardown、分帧扫描、空轮询清理、名单容量提示和性能归因。
- `structure regression`：最终矩阵 116/116：通用 UI/状态 19、核心状态 7、B站 33、自动弹幕 6、统一评论管理器 3、
  作品级屏蔽 3、性能边界 7、持久扩展 4、跨平台适配 21、抖音推荐流 2、微博回放 11；控制台错误、页面异常均为 0。
- 综合维护检查结果为 `blocked` 而不是失败：所有本地/扩展项目和 B站真站探针通过，抖音验证码与微博顶层
  虚拟列表样本不足被保留为证据阻断。
- 当前计划：见 [PLAN.md](PLAN.md)；运行时边界见 [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)。
- 当前限制：专用 Chrome 尚未手动刷新到 0.46.0；抖音真实 CPU 基线和微博公开虚拟列表仍受下方 `blocked` 条件限制。

## 证据

### `structure regression`

0.46.0 最终结构矩阵 116/116；userscript、评论管理器、自动弹幕、作品级屏蔽和已安装浏览器探针语法通过；
`node test/docs-check.cjs`、`git diff --check` 与公开页面标识隐私门禁通过。持久扩展 4/4 证明三个新文档自动加载、
跨页存储、未签名消息拒绝、页面无 `GM_*` 能力和 8 次后有界降级。性能 7/7 证明无独立 `setInterval`，名单/日志、
Mutation/扫描均有指标，后台页面不消费 MutationObserver 变化。

### `real-site verified`

- 2026-08-30，隔离未登录 `bilibili.com/video/...` 页面注入 0.46.0（SHA-256 与上方一致）：2 条根评论、2 位当前作者；
  评论菜单、批量入口和 Dock 收起/悬停展开可用；目标线程隐藏后闭合 335px 并可撤销；「屏蔽该楼回复」读取 5 位作者，
  一次本地存储写入后全部命中，再一次撤销全部恢复。公开 API 契约返回 3 条根评论和 2 条子回复，均有 mid/ctime。
- 2026-08-30，隔离未登录 `weibo.com/...` 页面注入 0.46.0：识别 20 条评论（14 条根评论、6 条回复）和 16 位去重作者；
  一条楼中楼评论可独立隐藏并撤销，正文和根评论保持可见。顶层虚拟列表补位未获得样本，见 `blocked`。
- 2026-08-29 的 0.45.0 B站评论/弹幕验收仍是历史证据，不被自动升级或替代上面当前候选的实际观察。

### `blocked`

- 专用 Chrome 需要在 `chrome://extensions` 手动刷新本地开发扩展，才能核对 0.46.0 的无注入持久运行标记。
- 抖音隔离未登录入口进入「验证码中间页」；OmniBlock 0.46.0 与适配器已启动，但候选/身份数均为 0，因此没有线上
  CPU、Mutation 或切换视频数字。人工性能夹具不能替代该真实基线。
- 微博真实页没有带可测 spacer 的活动顶层虚拟评论；楼中楼隐藏/恢复已验证，但顶层虚拟补位只能保留为 `blocked`。
- B站匿名页统一评论管理器显示“部分加载：根评论分页读取失败”；当前 DOM、公开 API 数据契约和整楼操作闭环已验证，
  但本轮不能声称匿名环境下“加载全部根评论分页”通过。

## 常用命令

```powershell
node test/docs-check.cjs
node test/maintenance-check.cjs
node test/dev-browser.cjs build
node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
```

开发扩展源码更新后必须在专用 Chrome 的 `chrome://extensions` 手动刷新扩展，再打开新页面；真实用户使用则通过
Tampermonkey 安装已公开发布的版本并刷新目标平台页面。0.46.0 目前只是本地候选，远端检查更新不会取得它。

## 下一项最有价值的验证

在专用 Chrome 扩展页手动刷新 `test/_dev-extension`，用无源码注入探针核对两个新页面显示 0.46.0；随后若抖音页面
不再被验证码阻断，采集当前构建的静置、播放和换片 CPU/脚本时长。CI/CD、push、tag 和 Release 仍需用户另行明确授权。
