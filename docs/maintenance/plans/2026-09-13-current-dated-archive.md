# 2026-09-13 从 CURRENT.md 移出的旧日期条目存档

本文件是 `docs/maintenance/CURRENT.md` 在 v0.57.4 一轮中为守住 24 KiB 活动文档预算而移出的
2026-09-06 至 2026-09-08 条目原文，内容按当时的记录逐字保留，不追加新的当前状态。
2026-10-27 又为同一预算原因把 v0.57.4 的 OB-CTX-001 日期条目原样移入文末。
当前事实、最近证据与限制仍以 [CURRENT.md](../CURRENT.md) 为准；本节日期段的入口见
[HISTORY_INDEX.md](../HISTORY_INDEX.md)。

## 2026-09-08 B站新增内容累计增量 AI 分析（OB-AI-003）

- 范围：修复评论滚动/楼中楼新增内容和后续弹幕数据段只更新采集计数、未触发 AI 的问题；修复增量完成态把“已分析数量”显示成本批新增数量的问题。每个网关请求仍最多 80 条。
- 改动文件：`omniblock.user.js`、`test/ai-screening.cjs`、`docs/architecture/ARCHITECTURE.md`、`README.md`、`CHANGELOG.md`、`docs/changelog/INDEX.md`、`docs/changelog/v0.51.1.md`、`docs/maintenance/PLAN.md`、`docs/maintenance/CURRENT.md`。
- `structure regression`：`node test/ai-screening.cjs` 18/18；覆盖评论/楼中楼滚动与点击、弹幕数据段增量、累计 `analyzed` 和稳定 ID 去重，页面错误和控制台错误均为 0。`node test/content-ai.cjs` 8/8、`node test/ai-batch.cjs` 2/2、`node test/ai-autoload.cjs` 3/3、`node test/ai-platforms.cjs` 7/7、`node test/quickblock.cjs` 37/37 通过。
- `real-site verified`：2026-09-08 专用 Chrome 持久化开发扩展，B站只读视频页（登录状态未判定，页面形式 `bilibili.com/video/...`）bridge 为 `ready`；首轮 224 条弹幕完成 `224/224`，滚动到评论区后累计 `247/247`（采集 24 条评论，增量事件 23 条），继续加载/展开楼中楼后累计 `273/273`（采集 30 条评论、244 条弹幕，最后一次增量事件 6 条）；旧内容未重复发送，页面错误 0。未点击举报、官方拉黑、关注或发帖控件。
- `blocked`：B站根评论分页仍为 partial，不能由当前样本推导全量；登录态未判定，本轮未运行需要用户授权的登录态探针。
- 发布状态：0.51.1 已 commit 并 push 到 `origin/master`，未创建 tag、GitHub Release、部署或执行平台写入；下一步转入下一版本提示词系统的设计计划。

## 2026-09-08 平台关键词屏蔽与评论 AI 建议提醒（OB-RULE-002）

- 范围：将 B站/抖音既有关键词/正则规则从设置页迁移到各自内容屏蔽弹窗的「关键词屏蔽」标签；命中当前已观察且身份可靠的评论/弹幕时直接走本地名单链，不请求 AI、不弹确认。AI 采集先排除关键词/本地名单命中，并为 B站/抖音评论晚到首轮的情况增加有界稳定哈希增量触发；微博、知乎新增当前可靠评论的 AI 采集和统一评论/AI 入口。
- 改动文件：`omniblock.user.js`、`test/content-ai.cjs`、`test/ai-screening.cjs`、`test/ai-platforms.cjs`、`test/danmaku-auto.cjs`、`test/quickblock.cjs`、`test/comment-manager.cjs`、`test/adapters.cjs`、`test/real-bilibili-probe.cjs`、`test/real-platform-probe.cjs`、`test/maintenance-check.cjs`、`README.md`、`CHANGELOG.md`、`docs/changelog/INDEX.md`、`docs/changelog/v0.51.0.md`、`docs/maintenance/PLAN.md`、`docs/maintenance/CURRENT.md`。
- `structure regression`：内容规则夹具 8/8；AI screening 14/14；AI 多平台 7/7；自动弹幕 7/7；B站 quickblock 37/37；统一评论管理器 3/3；跨平台适配器 28/28；基础运行器 20/20；AI 自动加载 3/3；watchdog 1/1；持久化开发扩展 6/6。以上本轮受影响浏览器回归均无页面错误/控制台错误；userscript 与探针语法通过。
- `real-site verified`：2026-09-08 匿名/登录状态未判定的隔离只读会话，自动发现 `bilibili.com/video/...` 页面，源码运行标识与候选一致；观察到 2 个评论 renderer、2 位当前评论作者，内容弹窗 4 个标签（评论/弹幕/AI/关键词），评论管理器 2 行可读取/搜索/全选且关键词面板实际挂载；公开评论 API 返回 3 条根评论和 14 条楼中楼回复。未点击 B站举报、官方拉黑、关注或发帖控件。
- `real-site verified`：同日匿名/登录状态未判定的隔离只读会话，自动发现 `weibo.com/...` 详情页，观察到 26 个评论节点、23 个可识别身份、21 个根评论和 5 个回复行；内容弹窗 2 个标签（评论/AI），AI 控件实际挂载；最新一次本地评论屏蔽后撤销恢复可见。未点击微博举报、官方拉黑、关注或发帖控件。
- `blocked`：B站根评论分页仍是 partial，不能由样本推导全量；微博本轮没有可测的活动顶层虚拟列表 spacer，作品级补位不记为通过；抖音匿名入口停留验证码中间页，知乎匿名入口重定向登录页，因此本轮没有真实的抖音关键词/AI 或知乎评论/AI 样本。用户没有对本轮登录态验证显式授权，未运行登录态探针。
- 发布状态：0.51.0 仅是本地候选，未 commit、push、tag、GitHub Release、部署或执行平台写入；公开版本仍为 0.46.2。下一步最有价值的动作是审阅差异、源码哈希和隐私门禁；公开发布需要当轮单独授权。

## 2026-09-07 B站入口、列表正文与弹幕 UID 按需关联（OB-BILI-001）

- 范围：只修改 B站统一内容入口的位置、评论/弹幕列表正文提取，以及已经选中的弹幕目标在屏蔽动作中的 hash→UID 按需关联；没有修改其他平台、B站平台写入或初始全量反查。
- `structure regression`：quickblock 37/37、AI 13/13、评论管理器 3/3、自动弹幕 7/7、适配器 28/28、运行器 20/20；覆盖入口、正文、目标关联和碰撞边界。
- `real-site verified`：2026-09-07 B站公开视频页（登录未判定）复现旧入口左下（`left=32`、`right=196.7`、宽 1707），捕获 `bili-rich-text`/操作组件/菜单；当前 0.50.0 匿名隔离探针在公开页 `pageLoaded=true`，看到 2 个评论 renderer、1 个子评论、3 个菜单，统一评论管理器 3 行可读取/搜索/全选，弹幕工具 89 组/36 位发送者的单条与批量屏蔽均可撤销，6 条浮动弹幕可命中并撤销，UID 卡片请求 12 次且无路由错误，评论隐藏撤销和自动 hash 路径通过。独立坐标测量确认内容入口为 fixed 右下并位于设置齿轮上方。
- `real-site verified`：同日使用当前源码生成的持久化 MV3 开发扩展，在 Edge 临时隔离 profile 打开公开 B站视频页（登录状态未判定，页面形式 `bilibili.com/video/...`），未注入页面源码；bridge 为 `ready`，自动加载版本/构建一致，观察到 48 行弹幕，按需查询 2 个单 hash 目标后得到 1 个唯一候选，点击「拉黑本人」不出现二次确认，UID 与 hash 同时进入本地索引，撤销后两者均恢复，页面错误 0。
- `blocked`：该公开页的根评论分页状态仍显示 partial，不能把 3 行样本扩写成全分页结论；持久化 smoke 只覆盖实际加载到的 48 行和第 2 个查询到的唯一候选，不扩写为全视频全量 UID 反查。

## 2026-09-06 AI 智能屏蔽第一阶段（OB-AI-001）

- `structure regression`：AI 7/7；gateway mock smoke 通过；run20/20、state9/9、B站36/36、自动弹幕7/7、评论3/3、作品3/3、性能8/8、适配28/28、微博13/13、扩展5/5，均无错误。
- `real-site verified`：2026-09-06 专用 Chrome 的 `bilibili.com/video/...` 显示 0.47.0 AI 区块，AI 关闭未发请求。启用后官方 DeepSeek V4 Flash 经本机 LiteLLM 完成 45/80 条样本及页面附加规则分析，显示“本轮分析完成”；登录状态未判定，未读 Cookie、未点平台写入，未确认候选。隔离只读探针退出码 0：2 根/3 子/5 菜单，3 个子菜单有入口，主评论隐藏/恢复 1 次；根评论分页 partial。
- `blocked`：商汤未配置；多 provider fallback、额度、cooldown 和记忆未联调。未关闭 DeepSeek V4 thinking 时曾超 20 秒，现由 `thinkingMode=disabled` 解决；本地 mock 已验证 429 fallback。OpenClaw 未接入，V2 未改。

## 2026-09-06 AI 多平台采集与一键网关启动（OB-AI-002）

- 范围：保留 B站 AI 采集，新增抖音已观察评论/弹幕、活动视频会话隔离和根目录双击启动；当时明确不自动展开/滚动、不调用私有接口、不改 V2。
- `structure regression`：AI、平台、网关、生命周期、评论/弹幕、性能、扩展、适配器和文档矩阵均按 v0.48.0 记录通过；网关健康、429 fallback、Key/YAML 分离和 `启动网关.cmd` 静态/实际启动门禁通过。
- `real-site verified`：2026-09-06 B站匿名探针与专用 Chrome 设置/审核框通过；2026-09-07 抖音登录态当前视频 15 条带身份弹幕、10 条评论及管理器/自动规则闭环通过，未点平台写入控件。
- `blocked`：同 URL 换片后的新行不足、匿名入口验证码；商汤 provider、额度、长期 cooldown/fallback 未联调。

## 2026-09-07 AI 分析 watchdog、全量分批、抖音正文清洗与超时预算（OB-AI-003~007）

- `structure regression`：watchdog 1/1、探针清理 1/1、抖音 AI 6/6、全量分批 2/2、开发扩展 5/5、桥接降级失败 1/1；userscript 与 service worker 60 秒预算断言通过，页面/控制台错误为 0。
- `real-site verified`：2026-09-07 用户授权专用 Chrome 抖音登录态刷新候选扩展后，当前页观察到 245 条内容；“分析本页”进入 4 批并完成 245/245，审核态 8 条候选，桥接为 `ready`，网关收到 4 次 POST 且均为 HTTP 200，`lastError` 为空，控件尾缀命中 0；未点平台写入控件。
- `blocked`：抖音验证码；换片新行不足；商汤未联调。2026-09-07 Docker engine 已恢复（Model Runner 关闭）；health/models 200、compose healthy；目录保留，数据卷未动。


## 2026-10-27 追加：2026-09-13 撤销接管右键的本地拉黑菜单（OB-CTX-001，v0.57.4）原样移入

为守住 CURRENT 的 24 KiB 预算，以下为该日期条目移出时的原文，只读归档，不追加当前状态。

---

## 2026-09-13 撤销接管右键的本地拉黑菜单（OB-CTX-001，v0.57.4，已公开发布）

- 范围/文件：删除"命中评论/帖子条目时接管右键并弹出自建菜单「🚫 拉黑此用户」"的整套实现——`document` 级 `contextmenu`
  捕获监听、`buildContextMenu`、仅供该监听使用的 `findItem`、`#ob-ctx` 样式与引导"试右键"的提示文案（`omniblock.user.js`）。
  平台原生右键菜单、页面上下文操作与此前被 `preventDefault` 掉的功能全部交还页面。
- `structure regression`：`node test/run.cjs` 20/20（C 用例改为断言右键不再被接管且身份仍可解析，旧源码上以
  `{"defaultPrevented":true,"ctxShown":true}` 失败后转通过）；`node test/adapters.cjs` 28/28（贴吧嵌套正文目标与 B站
  Shadow DOM 两处右键用例同样在旧源码上失败后转通过，六平台其余 26 项保持通过）；`quickblock` 38/38、
  `userscript-product` 7/7；页面/控制台错误 0。`run.cjs` D 用例仍覆盖完整拉黑链路：点开"更多"挂载评论菜单 →
  原生菜单旁快捷入口 → 确认气泡 → `bili:uid:333` 进名单且评论隐藏。
- `structure regression`：与 CI 同一组本地矩阵 21/22 脚本退出 0（state、comment-manager、danmaku-auto、work-block、
  performance、weibo-replay、douyin、sync、sync-server、ai-platforms、content-ai、content-coverage、ai-autoload、
  ai-watchdog、probe-hygiene、ai-prompt-system、ai-prompt-eval 等）。
- `real-site verified`：2026-09-13 用户授权恢复实页验证。隔离匿名只读探针 `--verify-local`：脱敏页面形式 `bilibili.com/video/...` 实际命中 2 个评论 renderer、派发 2 次 `contextmenu`，`prevented=0`、`menu=0`；`weibo.com/...` 实际派发 7 次，`prevented=0`、`menu=0`。登录态专用 Chrome（开发扩展 `0.57.4-native-context-menu`，源码 SHA-256 `caacf227…`）：知乎/抖音/X 在扩展活跃（`ob=true`、`#ob-gear`=1、`runtime=0.57.4`）下 `ctxShown=false`、`ctxDefaultPrevented=false`，右键保持原生。新增 `test/dedicated-rightclick-probe.cjs` 用浏览器级 WS + 单次 `Target.attachToTarget` 绕开 Chrome 148 浏览器级 `Target.getTargets` 偶发卡死（页面级 WS 在本机构建上整体不可响应）。
- `blocked`：贴吧在 CDP 驱动下渲染进程卡死（反爬/重资源使 `Runtime.evaluate` 与 `Page.captureScreenshot` 均超时并连带卡死后续会话），无法读取右键状态；属环境限制而非产品回归，需用户在真实登录浏览器手动确认。右键接管本是覆盖全部平台的单一 `document` 级监听，已在 B站/微博/知乎/抖音/X 五平台（扩展均确认活跃）验证移除。
- `structure regression`：`node test/ai-screening.cjs` 25/25 断言通过并退出 0；AI-24 预期 mock HTTP 429 被单独归档为 expected console event，未知 console/page error 仍会使测试失败。
- `blocked`：`node test/dev-browser.cjs sync` 已读到当前 `0.57.4-native-context-menu` 与右键目标，但专用扩展 bridge 在刷新前后均为 `degraded/ready-timeout`，因此不能把专用浏览器完整 AI/存储链路写成 ready；这不是右键证据失败。
- 提交与门禁：产品行为提交为 `b83003a56b901796cacf25da369dc6642bca4428`；本轮接手审计未修改
  `omniblock.user.js`，验证脚本/文档差异与工作区状态须以 `git status --short` 实时核对；`git fsck` 无错误。
  `node --check omniblock.user.js` 通过，`node test/docs-check.cjs` 与 `git diff --check` 均通过。v0.57.4 已推送到
  `origin/master`，`v0.57.4` tag 与 GitHub Release 已创建；本仓库没有登记的插件生产部署链，未执行平台写入。
- 计划收尾：OB-CTX-001 已转 verified，证据与验收见 [PLAN.md](PLAN.md)；旧日期条目已移至
  [移出存档](plans/2026-09-13-current-dated-archive.md)。
