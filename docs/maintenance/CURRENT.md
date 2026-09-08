# OmniBlock 当前维护状态

更新时间：2026-09-08
状态来源：0.51.1 B站增量 AI 候选已推送到 `origin/master`，尚未创建 tag/Release；公开 Release 仍为 0.46.2；历史过程见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

## 当前版本

- 当前 userscript：`0.51.1`（源码已推送到 `origin/master`，未创建 tag/Release）
- 构建：`0.51.1-content-ai-incremental`
- 当前公开版本：`0.46.2`
- 当前公开功能提交：`acd3b0a47ef56f9a0c662ded8efdb8332aedfff4`
- 最近验证的源码快照：`94528c483554845dc35c8c57121788f311d2e6ce`（候选工作区变更基于此祖先）
- 当前候选源码 SHA-256：`119030f1e5e528ce7b7c3003354c49606ad323a3e0cd9c860bd78bd826a9574f`
- 发布状态：0.51.1 已推送到 `origin/master`，提交为 `910d2def9cb445273ebdc73472ec332d5043eafe`，尚未创建 tag/Release；0.49.0 仍是已推送源码候选；公开的 0.46.2 仍保留原 tag/Release。
- 当前公开 tag/Release：[`v0.46.2`](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)。

## 本轮已落实

- 开发扩展桥、loopback 网关、存储恢复、生命周期和页面会话均有来源/序列/teardown/AbortController 边界；页面不获得 `window.GM_*`，桥接失败有界降级。
- 通用扫描、Shadow DOM、作者/批量入口和 EventLog 走共享节流/预算路径；后台页面暂停非必要工作，名单索引、备份和日志写入失败保持可诊断，不自动删数据。
- B站/抖音弹幕会话与自动规则按当前视频隔离；时间轴管理器关闭、换片或取消时恢复页面播放状态并释放扫描资源。
- 评论、楼中楼、作品级批量和平台适配器均保留 generation/身份规范化/只读加载边界；旧异步结果不会重新渲染或提交名单。
- B站和抖音的视频评论/弹幕入口合并为一个「内容屏蔽」按钮，统一弹窗提供评论、弹幕、AI 三个标签；切换标签会销毁旧子管理器并释放对应的 FloatingDock/键盘/扫描资源。
- 本轮 B站候选把统一内容入口固定到设置齿轮同侧的右下列；评论/AI 使用 `bili-rich-text` 正文，排除操作组件/菜单文字；单条、批量、悬浮、原生列表和 AI 确认弹幕只在目标动作时按需尝试 hash→UID 关联。
- 持久化开发扩展的 service worker 现在只为 B站用户卡片 `GET` 转发白名单 URL（`type=json&mid=数字`），与 loopback AI `POST` 分支分开；桥接结构回归已覆盖该边界。
- AI 网关、模型、规则、分析与审核控件已从设置页迁移到 B站/抖音统一弹窗的「AI 屏蔽」标签；设置页保留迁移提示，loopback 校验、脱敏出站和人工确认边界不变。
- B站/抖音关键词和正则规则已从设置页迁移到各自内容弹窗的「关键词屏蔽」标签；已有规则键兼容，规则默认启用，命中当前已观察且身份可靠的评论/弹幕时直接本地屏蔽，不请求 AI、不弹确认；身份不可靠时不伪造 UID。
- B站评论晚于首轮 AI 采集时会按稳定哈希增量提醒，评论关键词命中会先于 AI 被处理；微博、知乎当前可靠评论接入统一的评论/AI 内容弹窗，知乎正文取 CommentContent 层并排除同级操作文字。
- B站滚动/展开楼中楼后的新增评论与 `seg.so` 弹幕数据段通过共享内容信号进入同一套有界增量调度；增量请求只发送新的稳定记录，AI 状态中的 `analyzed` 保持为当前页面累计已分析数。
- 贴吧现代详情页只接受已捕获的 `.pb-comment-item` + Vue `userInfo.id` 数字身份；不透明作者参数不被猜测。

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

## 2026-09-07 抖音一键加载与 AI 分析闭环（OB-AI-008）

- 范围：抖音设置页一次点击完成评论展开/有限滚动、当前视频弹幕时间轴扫描、实际记录收集、AI 分批和人工审核；不调用私有接口、不执行平台写入、不自动确认候选。
- `structure regression`：`node test/ai-autoload.cjs` 3/3；覆盖加载后记录全量分析、播放器状态 class 变化不误取消和 AbortSignal 取消；语法、AI/评论/弹幕回归和文档门禁通过。
- `real-site verified`：2026-09-07 用户授权专用 Chrome 登录态 `douyin.com/video/...` 点击一次后，实际记录 365 条，弹幕时间轴 55/55，5 批完成 365/365，审核框 28 条候选，错误为 0；未确认候选或点击平台写入控件。
- 修复根因：播放器播放状态 class 不再被当作换片；明确视频身份改变仍取消旧 run。加载/分析可见进度并可取消。
- `blocked`：匿名入口验证码仍不稳定；商汤 provider、额度和真实 fallback 未纳入本候选。
- `maintenance-check` 本地矩阵和独立 B站探针重跑通过；综合 `BLOCKED`：一次匿名 B站样本无 `aid`、抖音验证码、微博无 spacer。

## 2026-09-07 统一内容屏蔽标签弹窗（OB-UI-002）

- 范围：B站/抖音各保留一个「内容屏蔽（评论/弹幕）」入口；统一弹窗内以「屏蔽评论」「屏蔽弹幕」「AI 屏蔽」三个标签承载原有功能。AI 控件从设置页移出，但不改变网关、身份键、审核和名单写入边界。
- `structure regression`：B站 quickblock 36/36、自动弹幕 7/7、跨平台适配器 28/28、统一评论管理器 3/3；AI screening、bridge、batch、autoload 均通过，`node --check omniblock.user.js` 和 `node test/dev-browser.cjs build` 通过，构建标识为 `0.49.0-content-manager-tabs`。
- 回归根因修复：B站旧弹幕按钮移除后，弹幕管理器不再因旧按钮不存在而提前返回；屏蔽/恢复名单变化会立即重绘嵌入面板。统一入口隐藏时同时关闭评论、弹幕和 AI 子面板。
- `real-site verified`：2026-09-07 隔离匿名 B站视频页（页面形式 `bilibili.com/video/...`，未登录）实际显示统一「内容屏蔽（评论/弹幕）」入口；三标签均挂载，评论管理器 2 行可读取/搜索/全选，弹幕管理器 16 组/15 位发送者可单条与批量屏蔽后撤销，浮动弹幕本地入口也完成屏蔽/撤销。未读取 Cookie，未点击 B站举报、官方拉黑、关注或发帖控件；根评论分页仍按探针结果标记 partial。
- `blocked`：2026-09-07 抖音匿名隔离入口落在「验证码中间页」，没有可验证的视频评论/弹幕条目；抖音三标签真站结果需用户另行授权登录态只读探针。源码已 push，未创建 tag/Release。

## 历史事实路由

- 2026-08-29 至 2026-09-05 的治理、B站入口/身份、微博虚拟列表与作品级读取等已关闭或阶段性条目，保留在 [HISTORY_INDEX.md](HISTORY_INDEX.md) 指向的计划和 `LEGACY-HISTORY.md`；本页只保留当前候选、最近证据和仍影响当前决策的限制。
- 需要追溯旧版本的具体数字、根因或当时发布状态时，按历史索引读取对应归档，不用旧条目覆盖当前 0.51.0 快照。

## 汇总证据

### `structure regression`

- 当前 0.51.0 候选的受影响回归为内容规则 8/8、AI screening 14/14、AI 多平台 7/7、自动弹幕 7/7、B站 quickblock 37/37、统一评论管理器 3/3、跨平台适配器 28/28、基础运行器 20/20、AI 自动加载 3/3、watchdog 1/1、持久化开发扩展 6/6；本轮浏览器回归无页面错误/控制台错误。
- `node --check omniblock.user.js`、各探针语法检查、docs check 和 diff check 是同轮门禁；历史 AI、网关、生命周期与其他平台结果保留在各自 dated 条目。

### `real-site verified`

- `real-site verified`：2026-09-08 匿名/登录状态未判定的自动发现 `bilibili.com/video/...` 页面观察到 2 个评论 renderer、2 位当前评论作者，内容弹窗 4 标签、评论管理器 2 行和关键词面板；公开评论 API 返回 3 条根评论、14 条楼中楼回复。`real-site verified`：同日自动发现 `weibo.com/...` 详情页观察到 26 个评论节点、23 个可识别身份、21 个根评论和 5 个回复行，内容弹窗为评论/AI 两标签，最新一次本地屏蔽可撤销恢复。其他平台日期、页面形式和样本量保留在各自 dated 条目。

### `blocked`

- 抖音匿名入口验证码、知乎匿名入口登录页、微博活动顶层虚拟列表 spacer 不可测、B站根评论分页 partial、弹幕/换片样本不足，以及商汤 provider、额度、cooldown 和记忆仍按各自条目标记为 `blocked`；平台限制不变。用户没有对本轮登录态验证显式授权，未运行登录态探针。

## 常用命令

```powershell
node test/docs-check.cjs
node test/maintenance-check.cjs
node test/ai-screening.cjs
node test/ai-platforms.cjs
node test/content-ai.cjs
node test/ai-autoload.cjs
node test/gateway-smoke.cjs
node test/dev-browser.cjs build
node test/dev-extension.cjs
node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool --verify-floating-danmaku --verify-auto-danmaku
node test/real-platform-probe.cjs --verify-local
node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
```

固定专用 Chrome 的 profile 仍保留上次人工加载状态；本轮 0.51.0 已在隔离浏览器会话完成 B站与微博公开只读 UI smoke，未执行平台写入。
公开的 0.46.2 tag 与 Release 保持不变；0.48.0 和 0.49.0 均已推送到 `origin/master`，均未创建新 tag/Release。

## 下一项最有价值的验证

下一项最有价值的验证是完成最终工作区差异、源码哈希、版本/隐私门禁和候选发布说明复核；若要创建 tag/Release，需另获当轮授权，不把匿名分页 partial、验证码或登录页阻断当作全量通过。
