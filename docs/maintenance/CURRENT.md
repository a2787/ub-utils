# OmniBlock 当前维护状态

更新时间：2026-09-10
状态来源：v0.53.1 是当前公开版本，v0.54.0 为本地候选；历史见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

## 当前版本

- 当前 userscript：`0.54.0`（本地候选，未发布）
- 构建：`0.54.0-ai-eval-fact-gates`
- 当前公开版本/提交：`0.53.1` / `e372bea97bf70ebbc873d60b4d060ae477e0307c`
- 最近验证的源码快照：`43d2bd16a4a4b7d0bb066ec90ae3783e17dae57a`
- 当前候选源码 SHA-256：`56e5d9f1a8400e311426a8900708ad6e34fea5b7ffe631025f95425cf446251f`
- 发布状态：v0.54.0 尚未 push/tag/Release；v0.53.1 仍为公开版本，无登记部署链，未执行平台写入。
- 当前公开 tag/Release：[v0.53.1](https://github.com/a2787/ub-utils/releases/tag/v0.53.1)。

## 2026-09-10 独立 AI 评测与受控事实核查（OB-AI-013，候选）

- 范围/文件：人工合成 24 例独立评测集与指标 runner；loopback-only、本机 allowlist 事实 broker；userscript `off/shadow/canary` 两阶段核查、脱敏 ordinal claim、事实缓存和状态展示；版本构建为 `0.54.0-ai-eval-fact-gates`。
- `structure regression`：评测集哈希 `4a7e2cc9403693c2ae3116ecc7f0ec985f65a47700c9a38dfb3a63527cfb84bc`；mock-oracle 门禁通过但不代表模型精度；broker RETRIEVAL-1..5、AI FACT-1..4、持久扩展桥 10/10、现有 AI screening 23 项及内容/提示词/批次回归通过，页面/控制台错误为 0。事实核查不产生 UID、不接收 Cookie/Key，不自动写名单。
- `real-site verified`：2026-09-10，隔离匿名只读会话，脱敏页面形式 `bilibili.com/video/...`；版本/构建/源码哈希为 `0.54.0` / `0.54.0-ai-eval-fact-gates` / `56e5d9f1a8400e311426a8900708ad6e34fea5b7ffe631025f95425cf446251f`。普通探针观察到作品 1、评论 3、弹幕 46 共 50 条 AI 内容，弹幕分组 77、发送者 46、浮动弹幕 7；AI 后台探针生成 1 个弹幕候选，确认后审核浮层关闭、基础 hash 写入 1 次并生效，完成提示已出现，最终键生效；未触发平台官方写入。
- `blocked`：未配置真实来源 allowlist，未进行公共搜索、线上模型三次精度运行或成本基线；无结果/冲突/过期/失败统一保守延期。专用浏览器 CDP 同步因 `127.0.0.1:9222` 不可用而 blocked，平台官方写入仍不执行。

## 2026-09-10 B站 AI 后台屏蔽生命周期与 UID 缓存（OB-AI-012，已发布）

- 范围/文件：确认后先写基础 hash/已有 UID并关闭审核浮层；右下状态条显示后台 UID 进度和撤销；hidden 暂停/恢复，停用、换路由、换视频、撤销和 runtime dispose 取消；用户卡片成功 TTL/LRU 与失败退避；涉及 `omniblock.user.js`、`test/ai-screening.cjs`、`test/quickblock.cjs`、真实探针和维护文档。AI 判定、人工确认、hash→UID 身份边界和平台只读边界不变。
- `structure regression`：AI screening 全部新增/既有断言通过（23 项）；B站 quickblock 38/38；完整矩阵中运行器 20/20、适配器 28/28、内容 AI、AI 多平台、提示词/评测、批次、自动加载均通过；页面/控制台错误均为 0。新增回归覆盖即时 hash、状态条、hidden/resume、SPA 迟到 UID 丢弃、完成提示、缓存 TTL/LRU/退避契约。
- `real-site verified`：2026-09-10 独立只读探针动态发现 `bilibili.com/video/...`，当前版本/构建一致；AI mock 自身 UI 链路采集 1 作品、3 评论、153 弹幕（157 条均带身份），1 个弹幕候选确认后审核层立即消失、基础 key 首次写入、后台提示出现；UID mock 返回不存在账号时只保留基础 hash。未执行平台写入。
- `real-site verified`：同日独立弹幕/评论探针观察 1 作品、3 评论、47 弹幕，弹幕管理器 49 组/47 位发送者，单条、批量、浮动弹幕屏蔽与撤销均通过；评论入口/楼回复屏蔽与撤销通过。未执行平台写入。
- `blocked`：登录状态未判定，根评论分页仍为 partial；真实线上模型精度、真实 AI UID 后台写入、外部事实检索和平台写入不在本轮验收范围，夹具/mock 结果不能替代这些结论。
- 发布与验证已闭环：功能提交、远端分支、`v0.53.1` tag/Release 已读回；已另立 OB-AI-013 详细规划，未实现评测集或事实检索。

## 2026-09-09 事实核查状态与屏蔽决策分离（OB-AI-011，已发布）

- 范围：修复 AI 把“未提供来源/尚未核查”直接写成“未经证实”并生成屏蔽候选的问题；提示词新增 `claimType`、`verificationStatus`、`verificationMethod`、`ruleMatched`，客户端对事实性候选做保守二次门禁；未核查数量只进入状态/审核说明，不写入名单。
- 改动文件：`omniblock.user.js`、`test/ai-prompt-system.cjs`、`test/ai-prompt-eval.cjs`、v0.53.0 changelog、架构/计划文档。
- `structure regression`：userscript 语法、AI prompt/eval、AI screening、内容 AI、多平台适配器、通用运行器、B站 quickblock、持久化扩展和完整维护自检中的本地项均通过；候选源码 SHA-256 已与本文件同步。
- `real-site verified`：2026-09-09 用户授权的专用 Chrome 只读页面，B站页面形式 `bilibili.com/...` 刷新到 0.53.0 后 bridge 为 ready，手动分析 `8/8` 条、屏蔽候选 `0`、延后 `1` 条；AI 面板显示“尚未核查，已保留未屏蔽”。贴吧页面形式 `tieba.baidu.com/p/...` 刷新到 0.53.0 后 bridge 为 ready，手动分析 `17/17` 条、候选 `2` 条，候选理由中“未经证实/无来源/无法核实”计数为 `0`。未点击平台举报、官方拉黑、关注或发帖控件。
- `real-site verified`：同日专用 Chrome 维护探针确认 B站入口 `content=15`、抖音入口 `content=12`、微博 `content=6/users=6`、知乎 `content=5/users=5`、贴吧 `content=6/users=5` 均运行 0.53.0 且 bridge ready；X 入口无可读取内容，B站/抖音详情目标未响应，按 `blocked` 记录。
- `blocked`：当前 loopback 网关没有检索证据通道；本版本不声称已对任意事实完成独立联网核查，也不把模型内部知识当来源。X 空壳、B站/抖音详情导航与评论分页等外部页面限制不变。
- 发布状态：该能力已随 v0.53.0 commit/push/tag/Release；无登记部署链，未执行平台写入。

## 2026-09-08 DeepSeek Flash 网关型号刷新（OB-AI-005，local runtime）

- 范围：先前曾将 Git 忽略的 `gateway/runtime/providers.local.json` 暂切到 `deepseek-v4-flash-vision-exp`；本轮按用户补充的内测调用名最终切换为 `deepseek-v4.1-flash-expires-on-0910`。`omni-default`、`http://127.0.0.1:4000` loopback、官方 base URL、thinking mode、重试/限流和 API Key 均保持不变；userscript 仍请求 `omni-default`，源码版本仍为 `0.51.1`。
- 官方 API 实时发现：使用当前本机 provider 的凭据请求 `https://api.deepseek.com/models`，仅输出型号 ID，得到公开的 `deepseek-v4-flash`、`deepseek-v4-pro`、`deepseek-v4-flash-vision-exp`，未列出内测 ID；随后按用户提供的精确内测 ID 经网关实请求成功。凭据未进入输出、源码或文档。
- `structure regression`：生成后的 `gateway.manifest.json` 显示 `deepseek-v4.1-flash-expires-on-0910`、单个 primary provider 和 `omni-default`；`pwsh -NoProfile -ExecutionPolicy Bypass -File .\gateway\health.ps1` 通过；经本机 loopback 发送人工合成审核请求返回 HTTP 200，响应模型别名为 `omni-default`，正文为可解析的 `block/reason` JSON；网关 smoke、userscript 语法、文档门禁和 `git diff --check` 见本轮交接结果。
- `blocked`：公开模型目录和当前官方公开文档未覆盖该内测 ID；`expires-on-0910` 到期后的有效性及真实语义准确率尚未验证。本轮只验证文本审核请求，没有额外导出 B站/抖音页面文本或执行平台写入。
- 发布状态（记录时）：这是本机运行时配置变更，不改变 userscript 源码哈希、版本号、commit、push、tag/Release 或部署状态；当时候选仍未公开发布。

## 2026-09-08 可学习 AI 提示词系统（OB-AI-004，local candidate）

- 范围：加入本地版本化 `PromptProfile`、三态 `FeedbackLedger`、理由/备注、正负例、固定 JSON 和提示词包；`blockCriteria` 为有效 AI 规则，旧 `aiRules` 仅迁移兼容；反馈达阈值生成待确认提案，接受后才入 prompt；并审计六平台作者、作品、评论、弹幕/帖子和统一右下内容入口。
- 改动文件：`omniblock.user.js`、AI/覆盖测试及 v0.52.0 文档。
- `structure regression`：覆盖6/6、扩展8/8、提示词12/12、评测5/5、screening19/19、内容 AI12/12、多平台7/7、适配器28/28、运行器20/20、quickblock37/37；页面/控制台错误0，语法/文档/差异门禁通过；maintenance-check 本地项通过，汇总受外部阻断。
- `real-site verified`：2026-09-09 用户授权专用 Chrome 只读：B站作品/评论/弹幕 `1/27/66`；微博内容/评论 `6/1+6`；知乎内容/评论 `12/3` 后新增 `10`；贴吧主题/评论 `1/11`；抖音精选/主页作品 `45/1`。未点平台写入。
- `blocked`：X 空壳无推文；抖音未展开评论/弹幕；B站分页/动态 UID、微博 spacer、抖音换片和 DeepSeek 精度仍待补验。
- 发布状态（记录时）：当时源码 `@version` 为 `0.51.1`；既有 0.51.1 已推送到 `origin/master`，本轮提示词/多平台改动随后纳入 v0.52.0，未在该条目记录时执行公开发布、部署或平台写入。

## 2026-09-09 v0.52 桥接与反馈修复（OB-AI-009/010）

- 已归档：反馈样例桥接白名单、loopback 错误分层和审核「不屏蔽」可撤销均已随 v0.52.0 发布；细节见 `docs/changelog/v0.52.0.md`。
- `structure regression`：开发扩展 8/8、AI screening 19/19、内容 AI 12/12、提示词系统 12/12；页面/控制台错误为 0。
- `real-site verified`：2026-09-09 用户授权专用 Chrome 微博只读页 bridge ready，AI `6/6`；审核负反馈完成记录/撤销循环并跨刷新读回，最终反馈 0；未执行平台写入。

## 当前边界摘要

- 运行时、桥接、存储、Shadow DOM、generation、AbortController、只读平台写入边界和页面隐藏暂停规则以架构正文为准；当前版本仍只把用户确认后的本地动作写入 GM 存储。
- B站/抖音弹幕会话按视频隔离；统一内容弹窗按平台提供评论、弹幕、AI、关键词标签，正文采集排除操作文字，身份缺失不生成可执行入口。
- AI 入口维持 loopback、脱敏、最多 80 条分批、人工确认和事实核查保守门禁；B站新增后台 UID 增强遵守 OB-AI-012 的暂停/取消/hash-only 约束。
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
- 需要追溯旧版本的具体数字、根因或当时发布状态时，按历史索引读取对应归档，不用旧条目覆盖当前 0.53.1 事实。

## 汇总证据

### `structure regression`

- 当前 v0.53.1 发布构建回归为覆盖 6/6、规则 8/8、提示词 13/13、评测 5/5、内容 AI 12/12、AI screening 23 项、AI 多平台 7/7、自动弹幕 7/7、quickblock 38/38、适配器 28/28、运行器 20/20、扩展 8/8；本轮浏览器回归无页面/控制台错误。
- `node --check omniblock.user.js`、各探针语法检查、docs check 和 diff check 是同轮门禁；历史 AI、网关、生命周期与其他平台结果保留在各自 dated 条目。

### `real-site verified`

- `real-site verified`：2026-09-09 维护总检自动发现 `bilibili.com/video/...` 页面实际读到 1 条作品内容、3 条评论、210 条弹幕，四标签和 3 行评论管理器可见；公开评论 API 返回 3 条根评论、20 条楼中楼回复。`real-site verified`：同轮自动发现 `weibo.com/...` 详情页实际读到 1 条帖子内容、12 条评论 AI 记录，页面评论行 12 条（6 根、6 回复，其中 6 条回复可识别），评论/AI 两标签和 AI 面板可见。其他平台日期、页面形式和样本量保留在各自 dated 条目。

### `blocked`

- 匿名入口的知乎登录墙、贴吧滑块、X 登录墙、抖音验证码、微博 spacer、B站根评论分页和动态 UID 仍按 `blocked`/`partial` 记录；专用 Chrome 不再沿用匿名结论。本轮专用登录态探针只读，未读取凭证或执行平台写入。

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
node test/dev-browser.cjs sync
node test/dev-extension.cjs
node test/dedicated-browser-probe.cjs --self-test
node test/maintenance-check.cjs --dedicated
node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool --verify-floating-danmaku --verify-auto-danmaku
node test/real-platform-probe.cjs --verify-local
node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
```

固定专用 Chrome 的 profile 由 `dev-browser sync` 自动核对/刷新；2026-09-10 v0.53.1 B站只读探针结果见顶部 OB-AI-012 条目，未执行平台写入。
v0.53.1 tag 与 Release 已创建并作为当前公开版本；v0.46.2 的历史 tag/Release 保持不变。0.48.0、0.49.0 和 0.51.1 仍是已推送但没有独立公开 Release 的历史候选。

## 下一项最有价值的验证

下一项最有价值的工作是评审 OB-AI-013 的独立评测集、指标、来源 allowlist、隐私/成本门禁和分阶段回滚方案；在用户确认前不实现事实检索，不把模型内部知识或未核查状态当作虚假。
