# OmniBlock 运行时架构与边界

更新时间：2026-09-11

本文件记录相对稳定的运行时职责、资源所有权、安全边界和性能契约。它不是版本台账；当前版本、
验证数字和阻断原因以 `docs/maintenance/CURRENT.md` 为准，活动工作以 `docs/maintenance/PLAN.md` 为准。

## 运行时分层

```text
启动栅栏 / runtime guard
        ↓
页面生命周期与共享 DOM/内容信号
        ↓
当前平台页面会话
        ├── 主扫描器、Shadow DOM 发现和隐藏引擎
        ├── 快捷/批量/作品级屏蔽与评论管理器
        ├── 浮动 Dock、设置和反馈 UI
        ├── B站弹幕拦截、解析和弹幕会话
        ├── AI 文本建议与本地多选审核（不直接写名单）
        └── Store、备份环、EventLog 和跨页面同步
```

`omniblock.user.js` 是电脑与平板共同交付物，由 Tampermonkey 在匹配页面的 document-start 阶段注入。
页面适配器、Store、设置面板、审核浮层、AI 和同步客户端都运行在 userscript 内；名单与普通设置使用
GM 存储，设备 API Key 使用独立的 GM 存储键。`extension/` 只保留上一轮 MV3 方案的未采用实验产物，
不属于当前用户安装路径。

### AI 直连与账户级客户端加密同步

AI 只有 `direct` 模式：用户在设置中填写 OpenAI-compatible API 地址和模型名，再通过“设置/更换本机 Key”
写入设备本地 GM 存储。请求由 Tampermonkey 的 `GM_xmlhttpRequest` 发出，Key 只放在请求的
`Authorization` 头，不进入页面对象、请求正文、导出文件或同步文档。地址必须是 HTTPS；仅 loopback
地址允许 HTTP。没有有效配置、Key、网络或 HTTP 错误时，AI 给出失败状态，不偷偷改走其他传输方式。

同步范围是名单/规范身份、可同步设置、AI 提示词个性化和反馈账本。userscript 使用
`sync/sync-core.js` 的按记录拆分文档；每个记录带设备 ID + Lamport counter，删除以墓碑保留，合并按时钟、
墓碑优先和稳定 JSON 规则确定性收敛。同步口令在客户端通过 PBKDF2-SHA-256 派生 AES-256-GCM 密钥，
服务器只接收 `omniblock.sync-envelope` 密文和最小 revision/账户元数据。

当前实现先提供显式“立即同步（合并）”，不在页面生命周期或 Tampermonkey 被系统挂起时偷偷执行后台同步。
服务器源码位于 `sync-server/`，独立于 Vibeme/V2/KB；东京服务器的数据库、HTTPS 反向代理、凭据和部署
尚未改变，必须在单独动作确认后上线。

## 核心不变量

- 身份键必须经过平台适配器规范化；身份不可靠时不提供可执行拉黑入口。
- 页面 UI 只由 OmniBlock 自己创建；不点击平台官方举报、拉黑、关注或“不感兴趣”控件。
- 屏蔽、恢复、自动规则和例外是不同语义；自动规则不能伪造永久人工身份。
- 屏蔽始终走同一条运行路径；详细诊断记录由设置页已有开关控制，不定义第二套“第一资源/低资源/诊断模式”。
- 同一文档只允许一个活动 runtime；重复执行必须在创建扫描器、观察器、定时器和 UI 前退出。
- 观察器、定时器、rAF、缓存、日志队列和 DOM 引用都必须有边界，并在页面不可见时暂停非必要工作。
- 用户名单、备份和日志默认只保存在本机；userscript 只有在用户主动配置账户并点击同步后，才上传名单/规则/提示词/反馈的客户端密文。日志不能含 Cookie、凭证、身份键、正文、完整 URL 或原始 HTML。
- AI 默认关闭；只有启用后才分析当前页已经观察到的文本，候选必须人工确认；身份关联可靠性与
  “内容是否应屏蔽”是两个独立判断，不能因 hash 唯一就绕过 AI 审核。
- AI 审核确认是本地用户操作；B站弹幕确认后先释放审核浮层并立即写入基础 hash/已有 UID，再由最多 2 个并发任务后台完成 hash→UID 关联、反馈和完成提示；
  唯一校验失败或碰撞时保留 hash-only，不因异步化扩大可执行身份范围。
- 内容屏蔽宿主由平台适配器的评论管理器和 `collectAIRecords` 共同提供；B 站/抖音继续按平台
  增加弹幕/关键词标签，微博、知乎、贴吧和 X 只提供已取得内容契约的评论/AI 标签。入口位置统一
  在设置齿轮同侧的右下固定列，首页或没有可读取内容的路由不显示空入口。

## 生命周期契约

每个页面功能属于一个明确的页面会话。会话至少需要能够失效以下资源：

- MutationObserver 和 ShadowRoot 观察关系；
- timeout、rAF 和异步刷新队列；
- `Store`、`PageLifecycle`、`PageMutationSignals`、`PageContentSignals` 的订阅；
- 播放器、评论、虚拟列表和弹幕缓存；
- B站 XHR/fetch 过滤包装、AI `GM_xmlhttpRequest` 请求和同步请求。

路由、作品、活动播放器或页面生命周期变化时，旧会话不能继续处理新会话的 DOM。`hidden`/`frozen`
状态暂停非必要工作，恢复时重新发现必要根节点；同步仍须由用户显式点击，不能用更高频轮询代替生命周期管理。

当前实现由 `RuntimeResources` 登记清理函数；`PageLifecycle` 统一处理 visibility、freeze、resume 和 pageshow。
BFCache 的 persisted pagehide 只暂停，普通 pagehide 调用一次幂等 dispose。`Store`、页面 mutation 和 SPA route
订阅在注册时同时登记注销；主扫描器持有自己的 MutationObserver、rAF、路由循环和适配器 dispose。
评论管理器与楼中楼读取另外持有面板/页面 generation 和 `AbortController`；关闭面板、SPA 路由切换或目标节点
被平台回收时，完成回调必须通过 generation、URL、连接状态和 signal 检查，旧结果只能安全丢弃。

## 扫描与调度契约

- 主扫描器负责共享 DOM/Shadow DOM 观察和信号广播；其他模块优先标记 dirty、排队或低频刷新，不另起全页深扫。
- 平台在 fetch/XHR 响应中解析出的非 DOM 内容（例如 B站 `seg.so` 弹幕数据段）通过 `PageContentSignals` 广播平台和内容类型；订阅者只标记/排队，不能把正文或身份塞进信号，也不能因此建立高频轮询。
- B站评论在滚动或展开楼中楼后可能才创建开放 ShadowRoot；扫描器用合并后的低频交互重扫重新登记根，随后再由同一内容信号触发 AI 增量。
- MutationObserver 回调不做无界同步工作；新增子树、属性变化和平台特例都要有范围和批次预算。
- 当前新增子树队列每帧最多处理 32 个根且最多占用约 8ms；超过 128 个待处理根时合并为一次全量同步请求。
- 深层查询、布局读取和样式写入尽量分离并节流；高频播放器节点不能触发整页身份重算。
- 日志记录不应成为扫描热路径的同步大对象序列化点。
- B站评论/微博作者、快速菜单、作品和批量入口使用活动信号触发的一次性防抖任务；SPA 路由只由主扫描器轮询并广播。
- 抖音活动播放器身份观察器只在播放器身份属性/根节点替换时向共享信号转发；AI 将其作为同 URL 换片边界，
  普通弹幕属性变化不触发新的页面会话或模型请求。
- AI 自动分析对 DOM 评论变化和平台内容信号使用同一稳定记录 ID 去重；一次分析运行期间到达的变化只合并成收尾后的下一次有界增量运行，状态中的 `analyzed` 表示当前页面累计已分析记录，不表示最后一批大小。
- `contentRouteAvailable` 只判断平台详情路由是否适合挂载内容宿主，不等同于当前已经加载评论；
  允许懒加载评论或作品卡的平台可先显示宿主，评论标签显示空状态，后续 DOM 变化再触发同一套增量采集。

## 内容读取契约

适配器把“作者身份”和“语义内容”分开读取，再合并为统一的 AI 记录。统一记录至少包含
`kind`（`content`、`comment` 或 `danmaku`）、`contentType`、截短后的 `text`、展示用 `title`
和适配器解析出的规范身份键；身份键只留在本机，不进入网关请求。平台操作区不作为正文兜底。

- B站：视频页取 `h1.video-title`、`.video-desc-container` 内的 `.basic-desc-info`/`.desc-info-text`
  和 `.up-name`；推荐流取 `.bili-video-card` 的视频标题链接和作者链接；动态流取已捕获的
  `.bili-dyn-content`、`.bili-dyn-card-video__title`/`__desc` 和动态标题；`.bili-dyn-item__footer`、
  `.bili-dyn-item__action` 等操作区永远不作为正文。动态作者没有可靠 UID 时仍生成只读 AI 记录，
  不生成拉黑入口；评论继续取 `bili-rich-text`，弹幕继续取当前已观察会话。
- 抖音：播放器取 `[data-e2e="feed-active-video"]`/已带视频标识的 feed 节点，正文只取
  `[data-e2e="video-desc"]`；精选卡取 `.discover-video-card-item` 的标题语义层或 `img[alt]`，搜索卡取
  `.search-result-card` 末级信息区的首个非元数据叶节点，主页“作品”取
  `[data-e2e="user-post-list"] [data-e2e="scroll-list"] > li` 的作品链接/图片 alt。作者取已捕获的
  `[data-e2e="video-avatar"]`、作者名或主页路由；卡片没有可靠作者 UID 时仍保留只读 AI 记录，不把作品 ID/昵称冒充身份。评论和弹幕保持各自语义层。
- 微博：帖子取 `article.woo-panel-main` 等已捕获帖子卡中的 `.wbpro-feed-content .wbpro-feed-ogText`
  和帖子作者槽；评论按详情、回复弹窗和虚拟行的独立评论选择器读取。
- 知乎：`ContentItem.AnswerItem`、`ArticleItem`、`PinItem`、`ColumnItem` 分别映射回答、文章、想法、
  专栏；通用 `ContentItem` 再依据已捕获的回答、专栏、问题、视频和想法链接判定内容类型。正文取
  `.RichContent-inner`，专栏摘要取 `.ColumnItem-meta`，作者取 `.AuthorInfo` 中的用户链接；身份缺失时
  保留只读 AI 记录但不提供拉黑入口。内嵌评论和独立评论 portal 继续取 `CommentContent`。
- 贴吧：旧版 `l_post`/`.d_post_content_main` 与现代详情 `.image-text` 的
  `.pb-content-wrap`（`pb-content-item`/`richtext-item`）作为主题帖内容；视频/播放器变体
  缺少正文 DOM 时取已捕获 Vue `thread.title`/`origin_thread_info.content`，现代
  `.pb-comment-item`/`.pb-lzl-item` 作为评论；作者只接受已捕获的数字 `data-field`、
  Vue 主题帖 `author.id` 或评论 `userInfo.id`。
- X：现有 `article[data-testid="tweet"]` 只做受控文本节点提取，排除作者链接、按钮、时间和 SVG；
  当前真实页面若仍停在登录墙则记为 `blocked`，夹具通过不能升级为线上结论。

这些读取器只覆盖当前 DOM/Shadow DOM 和安全展开、滚动后已经观察到的内容；虚拟列表回收、登录墙、验证码
或没有稳定作者身份时，记录会保持 `partial`/`blocked`，不会把页面显示总数推断为已读全量。

## 数据与安全边界

`Store` 管理规范化名单、设置和本地备份；内部用惰性 key→人物索引服务批量身份查找，不改变 v1 导入导出格式。
主名单写入失败会保留待确认状态；此期间收到外部标签页变化只报告冲突，不静默覆盖当前内存，直到写入成功或用户刷新。
`EventLog` 只保存脱敏的 OmniBlock 事件元数据。上一轮开发扩展桥接
通过显式版本化消息协议连接隔离世界与主世界，能力最小化：存储键、网络目标、请求体和返回值都必须
经过边界校验。页面主世界不应被视为可信的特权调用者；若无法维持安全隔离，桥接默认降级为不可用。

当前 userscript 的跨源边界由 Tampermonkey 的 `GM_xmlhttpRequest` 和独立 GM 存储承担：provider/sync 地址先做
协议、凭据字段、大小和响应格式校验；页面对象、普通导出、日志和同步文档都不能读取 API Key。同步请求只携带
服务端访问令牌，AI 请求只携带当前设备 Key 的 `Authorization` 头。

### 上一轮 MV3/开发桥实验（历史兼容）

以下开发桥协议只服务于上一轮隔离夹具和历史回归，不是当前用户安装路径。开发桥的历史协议使用构建期随机 HMAC-SHA256 密钥、固定来源和单调序列；GM 能力是包住 userscript 的词法变量，
不挂到 `window`。存储只接受主名单、备份、日志索引、日期分片和版本化 AI 提示词/反馈 key；网络只接受脚本更新 GET、B站用户卡片 GET、
用户明确配置的 loopback AI 网关 POST，以及默认关闭的受限事实 broker POST；AI/事实请求体不含身份键，也不由开发桥保存 provider 凭据。持久 MV3
开发扩展把窄 AI POST 转交给扩展 service worker 发起，避免内容脚本继承平台页面的跨源/混合内容限制；service worker 再次校验 loopback、AI JSON
结构、可选 `verificationSources` 的来源元数据、事实请求的 `schemaVersion/policyVersion/claims` 和 ordinal claim id，以及反馈样例的
`role/label/kind/contentType/text/reasonCode/note` 字段、`kind/contentType/title/text` 内容字段、单请求样本上限和响应大小。正式构建追加的
direct handler 还会再次校验 HTTPS provider、设备配置的精确 URL、host permission 和 response 大小；三层桥接校验必须保持同一字段契约，桥接仍拒绝
UID、mid、hash 等身份字段。多 provider、Key、重试、配额、cooldown 和事实来源 allowlist 属于 loopback 网关；正式 direct 模式只保留一个由
service worker 管理的设备 provider，不把 Key 下放到页面。
ready 最多尝试 8 次，失败后释放 userscript 启动栅栏并标记 degraded。请求被白名单拒绝时保留受控错误码，页面只在桥状态 degraded 时提示刷新扩展；网关 HTTP/格式/超时错误不伪装成桥未就绪。

### AI 提示词与反馈边界

`PromptSystem` 是独立于主名单的本地提示词层，使用版本化 `GM_*` key 保存
`PromptProfile`、三态 `FeedbackLedger` 和受控的个性化偏好。旧 `aiRules` 只在首次
加载时迁移为 `blockCriteria` 初稿；关键词、本地名单和平台身份执行链不由反馈账本替代。
手动屏蔽记录为 `positive/manual_miss`，明确拒绝 AI 候选记录为 `negative/ai_rejected`，
关闭、跳过或未完成审核记录为 `unknown`，未知样本不进入提示词例子。
审核弹窗中的 `negative/ai_rejected` 按钮保持灰态但可再次点击；撤销时只删除对应反馈事件，
恢复该候选的本地选择状态，不触碰主屏蔽名单；再次点击可重新记录负向反馈。

每次 AI 请求只注入当前有效 profile 和按平台/内容类型/正文词项确定性选出的有界正负例；
例子被标记为只读数据，不能覆盖系统指令。正文、理由和导入导出包按本地用户数据处理，
发送到已配置 provider 的请求不含 UID、`mid_hash`、昵称、URL、Cookie 或原始平台对象。
带受控理由的同类正/负反馈达到本地支持阈值后，只生成 `personalization.pending` 提案，
并保留支持/冲突反馈 ID；接受、停用、拒绝、暂停、删除和恢复都由用户显式操作，只有
`accepted` 且启用的偏好进入有效 prompt。反馈删除会重新计算提案并移除失去证据的有效偏好，
不得留下幽灵规则。任何个性化结果都不能绕过人工审核或直接触发平台官方拉黑。

AI 结果还必须把 `claimType`、`verificationStatus`、`verificationMethod` 与 `ruleMatched`
分开返回。缺少引用、没有检索结果、模型不知道或语境不足只能是 `not_checked`/
`insufficient_context`，不等于事实为假；客户端会丢弃仅凭这些状态或“未经证实/无可核实依据”
生成的事实性屏蔽候选，并在状态中累计延后数。v0.54.0 的事实核查默认关闭；开启后只对模型标记的事实性主张，先向
`127.0.0.1:4001/v1/fact-check` 发送脱敏 ordinal claim，再把受限来源摘要放入第二次 AI 请求。`shadow` 只观测，`canary` 才允许有来源的事实结果进入既有人工审核；没有来源、冲突、过期或失败仍延期。userscript 不把模型内部知识冒充外部来源，事实证据不直接生成屏蔽键、不增加 UID 可信度；只有非事实性规则违规，或带正面矛盾依据的事实性结果，才进入人工审核。

### AI 作品语境与作用域

v0.55.0 起，B站视频详情页的 AI 记录可带 `WorkContext`/`LocalContext`：作品标题、简介和分 P；评论只在真实 DOM/API 回复关系成立时带一层 parent；弹幕只在已观察的 seg.so 消息中带 progress/segment。推荐卡、动态卡和其他平台不能复用当前视频语境；缺少独立作品来源时保持既有 partial/只读行为。

语境不是屏蔽规则。AI block 仍必须命中本次 `ruleCatalog` 中的规则，`contextSufficiency=insufficient`、未知 `matchedRuleIds`、旧响应缺少语境字段和事实未核查路径均延期；客户端只接受输入中存在的规则 ID。v0.56.0 的 `contextSchemaVersion=2` 在同一作品、分 P 的批次建立 `contextCatalog.defaults`，无差异条目省略 context，弹幕时间使用 `[progressMs,segmentIndex]`，父评论使用 `[relation,text]`；作用域不一致时保留显式字段形态。开发扩展三层边界与 loopback 请求均拒绝平台 UID、弹幕 hash、URL、Cookie 和原始平台对象。

审核确认默认写入内存 `ScopedBlocks`，作用域为 `work/part/item`，立即参与扫描器、B站弹幕过滤和后续同实例重绘；撤销只移除本次 token，SPA 换路由或 runtime dispose 清空整个当前作品作用域。用户明确选择「全局作者」且存在可靠身份时，才沿用 `Store.addIdentityGroups` 和既有 UID 增强链。反馈事件保存脱敏作用域指纹，旧的无语境事件和其他作品事件不作为当前候选的负反馈；作用域确认不改变全局名单，也不改变关键词/手动名单优先级。

本边界只处理标题/简介、回复关系和弹幕位置，不能声称理解视频画面、字幕或音频；未来接入这些来源必须先有独立捕获、隐私/成本门禁和单独计划。

### B站 AI 弹幕确认后的后台增强

AI 审核确认只先把选中记录的基础 `bili:dmhash`/已有 UID 写入本地名单并关闭审核浮层；只有
纯 hash 的 B站弹幕组进入独立后台任务。任务拥有不透明 job id、页面 route/session 键和
`AbortController`，状态面板显示完成数/总数、暂停态和本次新增身份的撤销入口；完成后用一次 toast
报告唯一校验得到的 UID 数与保留 hash 数。后台任务最多沿用弹幕准备器的 2 路并发，不改变人工确认门槛。

页面隐藏时取消当前准备器并保留可恢复的 paused 状态；恢复可见后从当前 job 继续。停用 AI/总开关、SPA
换路由、B站视频会话变化、撤销或 runtime dispose 都会取消 job；任何异步回调在写名单前必须再次通过
job、route、session 和 signal 检查，迟到结果只丢弃不重绘/不写入。UID 卡片缓存最多 512 项、成功结果
保留 10 分钟并按 LRU 更新；失败卡片和失败 hash 不进入成功缓存，按 1 秒起、30 秒封顶的有界指数退避
重试。日志只写数量、状态和原因码，不写 hash、UID、昵称或弹幕正文。

名单没有人数硬上限，但设置页在 2 MiB/3 MiB 序列化字符区间提供 warning/critical 软提示；开发桥单值拒绝
超过 4 MiB 的消息。AI 每个网关请求最多分析 80 条、每条截短到 800 字符并受 48,000 字符文本预算限制；当前页面
已经观察到的记录会顺序分批并合并结果，不因单批上限静默丢弃；抖音 AI 弹幕正文缓存最多保留当前活动视频 1200 条且不保留
DOM 引用，页面会话缓存随路由、换片/运行时销毁。
日志仍受 30 天、每日 50,000 条和约 16 MiB 总量限制，分片字符数缓存在内存中，flush
不再重复序列化所有历史分片。详细诊断开关打开时分别累计 mutation、扫描、布局、名单 persist 和日志 flush 的耗时/体积；
关闭时仍保留必要的用户动作、错误和屏蔽状态记录，不改变屏蔽路径。

## 验证边界

- 本地夹具和回放只能证明 `structure regression`。
- 生产网站浏览器中实际观察到的结果才是 `real-site verified`，必须带日期、脱敏页面形式、登录状态和数字。
- 登录、验证码、限流、导航竞态或扩展未刷新造成的不可验证状态记录为 `blocked`，不能从夹具结果推导线上结论。

## 维护债务

- 当前 userscript 仍是大型单文件；在构建产物可比对前不进行全量拆分。
- 部分旧管理器和测试 fixture 可能仍是兼容遗留，只有完成调用方审计后才能删除。
- 性能预算需要真实页面基线校准；抖音验证码阻断期间不填写线上 CPU 数字。
- 当前长期任务及其状态只写在 `docs/maintenance/PLAN.md`，不要在本文件追加流水账。
