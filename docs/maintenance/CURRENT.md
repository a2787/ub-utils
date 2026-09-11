# OmniBlock 当前维护状态

更新时间：2026-09-11
状态来源：v0.57.0 已成为 userscript 主线公开版本；移动/触控布局、AI 直连、客户端加密同步和独立服务已完成本地回归。东京独立同步服务已部署并取得 HTTPS health 证据，目标平板真实同步、真实 provider 和固定域名仍未完成。上一轮 MV3 方案已标记 superseded。历史见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

## 当前版本

- 当前 userscript：`0.57.0`（已公开发布）
- 构建：`0.57.0-tampermonkey-mobile-direct-sync`
- 当前公开版本/功能提交：`0.57.0` / `3c11525f3cac69f310d58294a62f6ac89afd9e5a`
- 最近验证的源码快照：`3c11525f3cac69f310d58294a62f6ac89afd9e5a`
- 当前候选源码 SHA-256：`40c8ffe0de745036cbc5e198e7fde6f372e4de602287c0b68d6bd0a18ded72b4`
- 发布状态：v0.57.0 功能提交已推送到 `origin/master`，`v0.57.0` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.57.0) 已创建；独立同步服务已部署，未执行平台写入。
- 当前公开 tag/Release：[v0.57.0](https://github.com/a2787/ub-utils/releases/tag/v0.57.0)。

## 2026-09-11 Tampermonkey 移动端适配、API 直连与账户同步（OB-TM-001，已发布，设备互测进行中）

- 范围/文件：`omniblock.user.js` 窄屏/触控、设备直连 API、GM Key、账户注册/登录和 PBKDF2/AES-GCM opaque-CAS；`sync/`、`sync-server/` 提供协议/本地服务回归。上一轮 `extension/` MV3 实验不属于交付路径。
- `structure regression`：userscript product 4/4；AI screening、AI bridge、多平台、内容 AI、覆盖、提示词、批次、自动加载、watchdog、同步核心等受影响回归通过；390px 触控、Authorization、Key 脱敏、密文和无横向溢出均通过。
- `real-site verified`：2026-09-11，匿名隔离只读会话，脱敏页面形式 `bilibili.com/video/...`；候选 userscript `0.57.0`/`0.57.0-tampermonkey-mobile-direct-sync` 实际加载，观察到 2 个评论 renderer、1 条作品内容、2 条评论、65 条弹幕（共 68 条 AI 记录），内容弹窗 4 个标签，页面/控制台错误 0。该证据只覆盖桌面匿名页面加载和只读入口，不覆盖平板触控、真实 provider 或线上同步。
- `real-site verified`：2026-09-11，匿名隔离只读会话，脱敏页面形式 `weibo.com/...`；候选实际加载并观察到 1 条帖子内容、19 条评论 AI 记录，平台评论统计为 16 条（10 根行、6 回复行），内容弹窗 2 个标签，页面/控制台错误 0；活动顶层虚拟评论 spacer 未出现，相关项仍记为 `blocked`。
- `real-site verified`：2026-09-11，东京机独立 `omniblock-sync` 服务在 loopback health 返回 200，独立 HTTPS Quick Tunnel 的 `/healthz` 也返回 200，服务标识为 `omniblock-sync`；部署源码 SHA-256 与本地 `sync-server/server.py` 一致。
- `blocked`：目标平板真实同步、电脑/平板账户注册登录和加密合并尚未取得本轮用户设备结果；当前 Quick Tunnel 没有固定域名，进程重启后可能更换地址。
- 发布状态：v0.57.0 功能提交已推送到 `origin/master`，`v0.57.0` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.57.0) 已创建；独立同步服务已部署，目标平板真实 provider 与电脑/平板双设备同步仍待本轮验证，未执行平台写入。

## 2026-09-11 东京独立同步服务首次部署（OB-SYNC-001，in_progress）

- 范围/文件：东京机新增独立 `/opt/omniblock-sync/server.py`、`/opt/omniblock-sync/data/omniblock-sync.sqlite3`、`omniblock-sync.service` 和独立 Quick Tunnel 服务；未改 Vibeme/V2/KB 数据库、代码、网关路由或既有隧道。
- `structure regression`：本地 sync-core 7/7、Python 服务 5/5；服务模板启用 loopback、独立数据目录、最小权限和不记录请求内容。
- `real-site verified`：2026-09-11，东京机本地 `/healthz` 与独立 HTTPS Quick Tunnel `/healthz` 均返回 200；部署源码与本地源码 SHA-256 一致。
- `blocked`：还没有用用户真实账户完成注册/登录、第一台写入、第二台解密合并和墓碑/冲突读回；稳定 HTTPS 域名/命名隧道也未配置。
- 当前限制：Quick Tunnel 地址只作为本轮电脑/平板互测入口；隧道重启可能更换地址，若更换需在两台设备更新同步服务地址。API Key、密码、同步口令、令牌和日志不进入服务端同步文档。
- 下一步：先在电脑或当前平板注册一个同步账户并点击“立即同步（合并）”，再在另一台设备登录同一账户、输入同一同步口令并再次点击合并；完成后记录真实结果。

## 2026-09-11 上一轮 MV3 方案收回（OB-EXT-001，superseded）

- 平板 Edge 的实际安装路径确认以 Tampermonkey userscript 为准，因此不再把 `extension/`、正式 MV3、service worker 或扩展 options 作为本版本交付物；遗留文件未删除，等待单独清理或复用决策。

## 2026-09-10 作品语境感知的 AI 屏蔽与紧凑协议收口（OB-AI-014，v0.56.0，已发布）

- 范围/文件：B 站视频详情页的作品标题/简介、分 P、真实评论父级关系、已观察弹幕进度进入脱敏 `WorkContext/LocalContext`；v0.56.0 新增 `contextSchemaVersion=2` 紧凑线协议；上下文候选默认确认到当前作品 `ScopedBlocks`，全局作者屏蔽仍需单独显式选择。
- `structure regression`：上下文契约 CTX-1..9、AI screening、内容 AI、提示词系统/评测、事实核查、检索、批次、桥接、自动加载、平台 AI、watchdog、quickblock、适配器、通用运行器和性能回归通过；持久开发扩展 11/11，页面/控制台错误 0；v0.56.0 评测输入增长 `16.95%`，聚合 p95 比值 `1.0014`，unknown rule/context 不足均延期。
- `real-site verified`：2026-09-10，匿名隔离只读会话，脱敏页面形式 `bilibili.com/video/...`；构建/哈希为 `0.56.0-context-aware-ai-compact` / `0094f6e800fcdaf0f12257dc9e424db1b2ad11bee5619976125413375858945a`。动态页面采集作品 1、评论 3、弹幕 95 共 99 条，99 条带作品上下文、1 条带父评论、95 条带时间；三个实际 AI 批次额外输入 `16.4%/19.8%/16.8%`。
- `real-site verified`：同轮 AI mock 审核确认 2 条弹幕候选；审核浮层立即关闭，当前作品作用域记录 2 条，全局键保持不变，数据写入 0 次；未触发 B 站举报、官方拉黑、关注或发帖。
- 本机 loopback 评测（2026-09-10）：人工合成 `ai-eval-v1` 按 7 个不透明作品分组，baseline/full 各 3 次、42 次请求；输入字符 `15171/17742`，加权增长 `16.95%`，p95 `2174/2177ms`、比值 `1.0014`；误阻断率差 `0`，policy/context recall 与 defer precision 均 `1.0`，schema 错误、未核查事实误阻断和身份越权均 `0`。
- `real-site verified`：同轮来源探针确认标准文本轨道 `0`、`<track>` `0`、播放器仅有媒体存在证据且音频轨道元数据为 `0`；字幕和画面语义保持 `blocked`，未读取正文、音频或视频帧。
- `blocked`：真实用户内容长期精度没有标注集证据；登录状态未判定，根评论分页仍可能 partial。字幕/音频/画面语义已作为有前置条件的远期预留封存，不再作为 OB-AI-014 活动项。
- 发布状态：功能提交 `3f94c1bb7cfa75f2a5f223387492ee90b18b1de3` 已推送到 `origin/master`；`v0.56.0` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.56.0) 已创建。无登记部署链，未执行平台写入。详细设计、回滚和边界见 [实施方案](plans/2026-09-10-ob-ai-014.md) 与 [v0.56.0 changelog](../changelog/v0.56.0.md)。

## 已发布历史摘要

- v0.54.0 独立 AI 评测与受控事实核查：细节、数据集哈希和真实站点证据见 [v0.54.0 changelog](../changelog/v0.54.0.md)。
- v0.53.1 B 站 AI 后台屏蔽生命周期与 UID 缓存：细节和回滚见 [v0.53.1 changelog](../changelog/v0.53.1.md)。

## 已发布历史路由（详情见版本条目）

- v0.53.0 的事实核查门禁、v0.52.0 的提示词反馈、v0.51.x 的增量 AI/平台入口等历史证据已移入对应 changelog 和历史索引；当前只继承“未核查不等于虚假、候选必须人工确认、平台不写入”的边界。

## 历史事实路由

- 2026-09-08 至 2026-09-09 的 AI 型号、提示词、桥接和反馈证据已归档在对应版本条目；当前运行边界见本页“当前边界摘要”。

## 当前边界摘要

- 运行时、桥接、存储、Shadow DOM、generation、AbortController、只读平台写入边界和页面隐藏暂停规则以架构正文为准；当前版本仍只把用户确认后的本地动作写入 GM 存储。
- B站/抖音弹幕会话按视频隔离；统一内容弹窗按平台提供评论、弹幕、AI、关键词标签，正文采集排除操作文字，身份缺失不生成可执行入口。
- AI 入口只保留用户配置的 provider 直连、脱敏、最多 80 条分批、人工确认和事实核查保守门禁；本机 loopback 网关仅属于历史兼容/评测路径，不能作为当前 userscript 默认方式。B站新增后台 UID 增强遵守 OB-AI-012 的暂停/取消/hash-only 约束。
- 账户同步必须由用户点击“立即同步（合并）”触发；名单、可同步设置、提示词和反馈在客户端加密，API Key、密码、同步口令、令牌和日志不进入同步文档。东京服务器尚未部署或改 schema。
- `real-site verified` 的当前只读入口与阻断以本文件顶部和版本条目为准；未判定登录、验证码、根评论 partial、模型精度和平台写入不能从夹具推导。

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

## 近期历史事实路由（OB-AI-008 及更早）

- 2026-09-07 抖音一键加载、评论/弹幕会话隔离和取消清理的详细证据已归档在历史版本条目；当前只保留其仍影响本版本的外部门禁。

## 历史事实路由

- 2026-08-29 至 2026-09-05 的治理、B站入口/身份、微博虚拟列表与作品级读取等已关闭或阶段性条目，保留在 [HISTORY_INDEX.md](HISTORY_INDEX.md) 指向的计划和 `LEGACY-HISTORY.md`；本页只保留当前发布构建、最近证据和仍影响当前决策的限制。
- 需要追溯旧版本的具体数字、根因或当时发布状态时，按历史索引读取对应归档，不用旧条目覆盖当前候选事实。

## 汇总证据

### `structure regression`

- 已发布 v0.56.0 基线回归为覆盖 6/6、规则 8/8、提示词 13/13、评测 5/5、内容 AI 12/12、AI screening 23 项、AI 多平台 7/7、自动弹幕 7/7、quickblock 38/38、适配器 28/28、运行器 20/20、扩展 8/8；本轮浏览器回归无页面/控制台错误。
- `node --check omniblock.user.js`、各探针语法检查、docs check 和 diff check 是同轮门禁；历史 AI、网关、生命周期与其他平台结果保留在各自 dated 条目。

### `real-site verified`

- `real-site verified`：2026-09-09 维护总检自动发现 `bilibili.com/video/...` 页面实际读到 1 条作品内容、3 条评论、210 条弹幕，四标签和 3 行评论管理器可见；公开评论 API 返回 3 条根评论、20 条楼中楼回复。`real-site verified`：同轮自动发现 `weibo.com/...` 详情页实际读到 1 条帖子内容、12 条评论 AI 记录，页面评论行 12 条（6 根、6 回复，其中 6 条回复可识别），评论/AI 两标签和 AI 面板可见。其他平台日期、页面形式和样本量保留在各自 dated 条目。

### `blocked`

- 匿名入口的知乎登录墙、贴吧滑块、X 登录墙、抖音验证码、微博 spacer、B站根评论分页和动态 UID 仍按 `blocked`/`partial` 记录；专用 Chrome 不再沿用匿名结论。本轮专用登录态探针只读，未读取凭证或执行平台写入。

## 常用命令

```powershell
node test/docs-check.cjs
node test/maintenance-check.cjs
node test/userscript-product.cjs
node test/ai-screening.cjs
node test/ai-platforms.cjs
node test/content-ai.cjs
node test/ai-autoload.cjs
node test/sync.cjs
node test/sync-server.cjs
node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool --verify-floating-danmaku --verify-auto-danmaku
node test/real-platform-probe.cjs <platform> --verify-local
node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
```

固定专用 Chrome 的 profile 由 `dev-browser sync` 自动核对/刷新；2026-09-10 v0.56.0 B站只读探针结果见顶部 OB-AI-014 条目，未执行平台写入。
v0.56.0 tag 与 Release 已创建并作为当前公开版本；v0.46.2 的历史 tag/Release 保持不变。0.48.0、0.49.0 和 0.51.1 仍是已推送但没有独立公开 Release 的历史候选。

## 下一项最有价值的验证

下一项最有价值的工作是评审 OB-AI-013 的独立评测集、指标、来源 allowlist、隐私/成本门禁和分阶段回滚方案；在用户确认前不实现事实检索，不把模型内部知识或未核查状态当作虚假。
