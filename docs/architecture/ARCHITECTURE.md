# OmniBlock 运行时架构与边界

更新时间：2026-09-08

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

最终发布物仍是一个可供 Tampermonkey 安装的 userscript；开发阶段的 MV3 扩展只提供持久加载和
本地 GM 存储桥接，不改变用户名单的本地归属，也不应被当成生产同步服务。网关宿主进程由根目录
`启动网关.cmd` 调用 PowerShell 7 启动脚本，设置页不获得启动宿主进程的能力。

## 核心不变量

- 身份键必须经过平台适配器规范化；身份不可靠时不提供可执行拉黑入口。
- 页面 UI 只由 OmniBlock 自己创建；不点击平台官方举报、拉黑、关注或“不感兴趣”控件。
- 屏蔽、恢复、自动规则和例外是不同语义；自动规则不能伪造永久人工身份。
- 屏蔽始终走同一条运行路径；详细诊断记录由设置页已有开关控制，不定义第二套“第一资源/低资源/诊断模式”。
- 同一文档只允许一个活动 runtime；重复执行必须在创建扫描器、观察器、定时器和 UI 前退出。
- 观察器、定时器、rAF、缓存、日志队列和 DOM 引用都必须有边界，并在页面不可见时暂停非必要工作。
- 用户名单、备份和日志默认只保存在本机；日志不能含 Cookie、凭证、身份键、正文、完整 URL 或原始 HTML。
- AI 默认关闭；只有启用后才分析当前页已经观察到的文本，候选必须人工确认；身份关联可靠性与
  “内容是否应屏蔽”是两个独立判断，不能因 hash 唯一就绕过 AI 审核。
- 内容屏蔽宿主由平台适配器的评论管理器和 `collectAIRecords` 共同提供；B 站/抖音继续按平台
  增加弹幕/关键词标签，微博、知乎、贴吧和 X 只提供已取得内容契约的评论/AI 标签。入口位置统一
  在设置齿轮同侧的右下固定列，首页或没有可读取内容的路由不显示空入口。

## 生命周期契约

每个页面功能属于一个明确的页面会话。会话至少需要能够失效以下资源：

- MutationObserver 和 ShadowRoot 观察关系；
- timeout、rAF 和异步刷新队列；
- `Store`、`PageLifecycle`、`PageMutationSignals`、`PageContentSignals` 的订阅；
- 播放器、评论、虚拟列表和弹幕缓存；
- B站 XHR/fetch 过滤包装和扩展桥接请求。

路由、作品、活动播放器或页面生命周期变化时，旧会话不能继续处理新会话的 DOM。`hidden`/`frozen`
状态暂停非必要工作，恢复时重新发现必要根节点并合并一次同步；不能用更高频轮询代替生命周期管理。

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
`EventLog` 只保存脱敏的 OmniBlock 事件元数据。开发扩展桥接
通过显式版本化消息协议连接隔离世界与主世界，能力最小化：存储键、网络目标、请求体和返回值都必须
经过边界校验。页面主世界不应被视为可信的特权调用者；若无法维持安全隔离，桥接默认降级为不可用。

开发桥的当前协议使用构建期随机 HMAC-SHA256 密钥、固定来源和单调序列；GM 能力是包住 userscript 的词法变量，
不挂到 `window`。存储只接受主名单、备份、日志索引、日期分片和版本化 AI 提示词/反馈 key；网络只接受脚本更新 GET、B站用户卡片 GET
和用户明确配置的 loopback AI 网关 POST；AI 请求体不含身份键，也不由开发桥保存 provider 凭据。持久 MV3 开发扩展
把窄 AI POST 转交给扩展 service worker 发起，避免内容脚本继承平台页面的跨源/混合内容限制；service worker
再次校验 loopback、JSON 结构、反馈样例的 `role/label/kind/contentType/text/reasonCode/note` 字段、`kind/contentType/title/text` 内容字段、单请求样本上限和响应大小；三层桥接校验必须保持同一字段契约，桥接仍拒绝 UID、mid、hash
等身份字段。多 provider、API Key、重试、配额和 cooldown 属于外部本地
网关，不是 userscript 的职责。
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
发送到 loopback 网关的请求不含 UID、`mid_hash`、昵称、URL、Cookie 或原始平台对象。
带受控理由的同类正/负反馈达到本地支持阈值后，只生成 `personalization.pending` 提案，
并保留支持/冲突反馈 ID；接受、停用、拒绝、暂停、删除和恢复都由用户显式操作，只有
`accepted` 且启用的偏好进入有效 prompt。反馈删除会重新计算提案并移除失去证据的有效偏好，
不得留下幽灵规则。任何个性化结果都不能绕过人工审核或直接触发平台官方拉黑。

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
