# OmniBlock 当前维护状态

更新时间：2026-08-29
状态来源：发布后只读核对；历史过程见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

## 当前版本

- userscript：`0.45.0`
- 构建：`0.45.0-persistent-runtime-floating-dock-log-aggregation-performance-resource-bounds`
- 功能发布提交：`17c6c45fe169da3943bd64544155eb5e6056514d`
- 当前 `master`（含发布证据回写）：`478b474e1c292fbd89d043eb19aca9e9cf6f142e`
- tag：`v0.45.0`，解引用后指向功能发布提交
- Release：[OmniBlock 0.45.0](https://github.com/a2787/ub-utils/releases/tag/v0.45.0)
- raw master 已核对返回当前版本和构建；本地工作区在最后核对时干净。

## 本轮已落实

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
- 关闭状态：文档重组当前仍在工作区，尚未提交；提交前需再次运行文档门禁、隐私门禁、暂存差异检查，并确认不把历史归档当作活动文档写入。

## 证据

### `structure regression`

0.45.0 源码本地矩阵通过：通用 UI 16/16、核心状态 7/7、B站 33/33、自动弹幕 6/6、统一评论 3/3、作品级 3/3、
性能边界 6/6、跨平台适配 21/21、抖音推荐流 2/2、微博回放 11/11、持久开发扩展隔离回归 3/3；userscript/测试语法检查、
`git diff --check` 和隐私门禁通过。

### `real-site verified`

2026-08-29，在专用 Chrome 的隔离、只读真实 `bilibili.com/video/...` 页面注入当前 0.45.0 源码：运行时标记一致；
发现 2 个评论渲染器和 2 位评论作者；评论菜单出现本地拉黑与「🧵 屏蔽该楼回复」；评论管理器读取 2 行；弹幕管理器读取
100 个文案组/95 位发送者；浮动弹幕发现 27 条；单条、批量、楼操作和撤销闭环完成。

源码版本提升前，持久扩展无注入探针在 B站视频页、抖音入口页和微博入口页各打开两个新页面，均自动加载开发扩展并保持控制坞
收起。该条证明持久安装机制，不证明版本提升后的 0.45.0 快照。

### `blocked`

- 源码提升后，专用 Chrome 的无注入探针仍读取旧 0.44.0 开发扩展快照；需要在 `chrome://extensions` 手动刷新开发扩展，
  才能核对 0.45.0 的持久运行标记。
- 抖音公开视频入口停在验证码中间页，未形成 0.45.0 修复后的线上 CPU 数字。
- 微博公开入口没有可安全验证的独立楼中楼作者和活动顶层虚拟列表 spacer。
- 维护总门禁的一次 B站导航遇到执行上下文销毁；本地部分通过，不能把整体退出码写成“全部通过”。

## 常用命令

```powershell
node test/docs-check.cjs
node test/maintenance-check.cjs
node test/dev-browser.cjs build
node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
```

开发扩展源码更新后必须在专用 Chrome 的 `chrome://extensions` 手动刷新扩展，再打开新页面；真实用户使用则通过
Tampermonkey 更新到 0.45.0 并刷新目标平台页面。

## 下一项最有价值的验证

在专用 Chrome 扩展页手动刷新 `test/_dev-extension`，然后用无源码注入探针核对两个新页面显示 0.45.0；之后若抖音页面
不再被验证码阻断，再采集修复后静置 CPU/脚本时长，不能沿用旧构建数字。
