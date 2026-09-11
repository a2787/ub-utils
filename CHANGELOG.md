# 更新日志

本文件只保留当前版本摘要和稳定入口；完整版本条目见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## v0.57.1 - 无 hover 触控入口补齐 - 2026-09-11（本地候选，未公开发布）

- coarse pointer/无 hover 设备上的页面级“内容屏蔽/弹幕屏蔽”入口常驻可见，齿轮继续直接打开设置；设置、内容管理器、AI 审核和确认框的主要控件补齐至少 44px 触控目标。
- 抖音滚动弹幕、B站播放器浮动弹幕都增加点按目标后显示自有本地入口的路径；桌面鼠标悬停路径保持不变，不触发平台举报、官方拉黑、关注或发帖。
- `structure regression`：userscript product 5/5、通用 20/20、B站 quickblock 38/38、跨平台适配器 28/28；`real-site verified`：2026-09-11 匿名 B站只读候选加载无页面/控制台错误；`blocked`：目标平板触控实机和抖音验证码页面未完成。

详细变更、证据和边界：[v0.57.1 完整条目](docs/changelog/v0.57.1.md)。

当前公开版本仍为 v0.57.0；本地候选尚未 push、创建 tag/Release 或改变更新地址。

## v0.57.0 - Tampermonkey 移动端适配、API 直连与账户级加密同步 - 2026-09-11（已发布）

- 保持 `omniblock.user.js` 为电脑与平板共同交付物，设置、审核浮层、内容管理器和输入控件增加窄屏/触控适配；不再把 MV3 扩展作为本版本安装路径。
- AI 只保留用户直接填写的 OpenAI-compatible API 地址、模型名和设备本地 Key；Key 只进入 `Authorization` 请求头，不进入页面对象、请求正文、导出文件或同步文档，不加入本地模型和网关主链路。
- userscript 增加账户注册/登录和显式“立即同步（合并）”；客户端用同步口令加密名单、设置、提示词个性化和反馈状态，服务端只保存 opaque 密文，支持逻辑时钟、墓碑、CAS 冲突重试和离线恢复。
- `structure regression`：userscript product 4/4 及受影响的 AI、通用、平台、提示词、同步核心和独立 Python 服务回归通过；目标平板实际安装、真实 provider 和东京线上服务仍为 `blocked`/未部署，不宣称线上能力。

详细变更、证据和边界：[v0.57.0 完整条目](docs/changelog/v0.57.0.md)。

发布状态：功能提交 `3c11525f3cac69f310d58294a62f6ac89afd9e5a` 已推送到 `origin/master`；`v0.57.0` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.57.0) 已创建；独立同步服务已部署，目标平板真实 provider 与电脑/平板双设备同步仍待本轮验证，未执行平台写入。

## v0.56.0 - 作品语境 AI 请求压缩与 OB-AI-014 收口 - 2026-09-10（已发布）

- loopback AI 请求升级为 context schema v2：同一作品批次共享默认语境，弹幕时间和父评论使用紧凑表示；无法安全归并时保留显式上下文，不改变语义边界。
- 持久化开发扩展三层桥同步校验 v2 字段，继续拒绝 UID、hash、URL、Cookie、Token 和原始平台对象。
- `structure regression` 与真实 B站只读探针通过；最近三个 AI 批次上下文额外输入为 `16.4%/19.8%/16.8%`，loopback 单作品分组评测总输入增长 `16.95%`、聚合 p95 比值 `1.0014`。
- 真实用户内容长期精度、字幕/音频/画面语义没有可验证输入，已从活动计划移出并作为远期预留封存，不宣称已支持。

详细变更、证据和边界：[v0.56.0 完整条目](docs/changelog/v0.56.0.md)。

发布状态：功能提交 `3f94c1bb7cfa75f2a5f223387492ee90b18b1de3` 已推送到 `origin/master`，`v0.56.0` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.56.0) 已创建；无登记部署链，未执行平台写入。

## v0.55.0 - 作品语境感知的 AI 屏蔽 - 2026-09-10（已发布）

- B站视频详情页 AI 记录加入作品标题/简介、分 P、真实回复父评论和弹幕进度；同文跨作品/楼层/位置不再只凭文字合并。
- AI 审核默认按当前作品作用域确认，显式选择“全局作者”且身份可靠时才写入全局名单；确认后浮层立即关闭，当前作品内容立即生效。
- contextCatalog 共享作品元数据，条目只发送 ordinal 引用和必要上下文；语境不足、未知 rule ID 和旧响应缺少语境字段统一延期。
- `structure regression` 与匿名 B站只读真实探针已通过；线上模型精度、字幕/音频理解和成本基线仍按 `blocked` 记录。

详细变更、证据和限制：[v0.55.0 完整条目](docs/changelog/v0.55.0.md)。

发布状态：功能提交 `b865d4261e8f9fb27303d0c14dd22192e84f1544` 已推送到 `origin/master`，`v0.55.0` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.55.0) 已创建；无登记部署链，未执行平台写入。

## v0.54.0 - 独立 AI 评测与受控事实核查 - 2026-09-10（已发布）

- 增加 24 条人工合成/脱敏独立评测集、schema/隐私校验和 mock-oracle 指标 runner；报告不把 mock 结果冒充真实模型精度。
- 增加 loopback-only 本机事实 broker 和显式来源 allowlist；无来源、冲突、过期、不可访问或证据不足统一保守延后，不把事实证据变成 UID 或屏蔽键。
- AI 事实核查默认关闭；`shadow` 只观测，`canary` 只有受限证据才能进入人工审核，仍不自动屏蔽、不扩大身份关联、不触发平台写入。
- `structure regression`：评测、broker、FACT-1..4、AI screening、内容 AI、提示词、批次和既有平台矩阵通过；`blocked`：真实来源 allowlist、线上模型精度和成本基线未配置/未观察。

详细变更、测试证据和限制：[v0.54.0 完整条目](docs/changelog/v0.54.0.md)。

## v0.53.1 - B站 AI 后台屏蔽生命周期与 UID 缓存 - 2026-09-10（已发布）

- B站 AI 审核确认后立即关闭浮层，基础 hash/已有 UID 先写入；右下状态条显示后台 UID 进度和撤销入口，完成后提示结果。
- hidden 时暂停，换路由/换视频/停用/撤销/运行时销毁时取消旧任务；迟到 UID 不写入新会话。
- UID 卡片缓存增加有界 TTL/LRU 和失败指数退避；唯一正向校验才关联 UID，碰撞/失败仍保留 hash-only。
- `structure regression`：AI screening 23 项、B站 quickblock 38/38；完整矩阵、真实只读探针和发布边界见[当前维护状态](docs/maintenance/CURRENT.md)。

详细用户变化和证据：[v0.53.1 完整条目](docs/changelog/v0.53.1.md)。

发布状态：功能提交 `e372bea97bf70ebbc873d60b4d060ae477e0307c` 已推送到 `origin/master`，`v0.53.1` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.53.1) 已创建；构建为 `0.53.1-ai-background-lifecycle-cache`。没有登记的生产部署链，未执行平台写入。

## v0.53.0 - 事实核查与屏蔽决策分离 - 2026-09-09（已发布）

- AI 现在区分规则违规、事实性主张、观点和核查状态；缺少引用、尚未核查或语境不足不再单独构成“虚假/谣言”的屏蔽候选。
- 旧式 `decision=block` 若理由仅为“未经证实/无可核实依据”，会被客户端保守降为延后；规则性违规和带正面矛盾依据的事实仍进入人工审核。
- 提示词和审核说明显示核查状态/依据与延后数量；loopback、人工确认、关键词优先级、身份和 80 条批次边界不变。
- B站 AI 弹幕确认后审核弹窗立即关闭；基础 hash/已有 UID 先写入本地名单，UID 关联由最多 2 个并发任务在后台补充，完成后提示结果；唯一校验失败或歧义仍安全保留 hash，不绕过人工确认。
- AI 分析日志补充 `runId`、采集/网关/总耗时，并抑制没有实际活动的虚假取消事件；新到内容不会在手动分析批次间隙抢占运行。
- `structure regression`：AI 提示词/离线评测、AI screening 21/21 及既有 AI/内容回归通过；真实专用 Chrome 复验和外部检索边界见[当前维护状态](docs/maintenance/CURRENT.md)。

详细用户变化、验证证据、未接入检索的限制和发布边界：[v0.53.0 完整条目](docs/changelog/v0.53.0.md)。

发布状态：v0.53.0 的构建为 `0.53.0-ai-background-bili-commit`，提交/tag/Release 已完成；当前公开版本已推进到 [OmniBlock v0.53.1](https://github.com/a2787/ub-utils/releases/tag/v0.53.1)，本仓库没有登记的生产部署链。

## v0.52.0 - 多平台内容入口与可学习 AI 提示词反馈 - 2026-09-09（已创建 GitHub Release）

- 微博、知乎、贴吧详情页接入右下「内容屏蔽（评论/AI）」入口；知乎空评论也可先打开管理器，贴吧现代主题帖/评论进入 AI/评论管理器，视频主题缺少正文 DOM 时使用已捕获 Vue 文本字段。
- 六平台统一补齐作者作品内容的 AI 读取记录：B站视频/推荐/动态、抖音播放器/精选/搜索/主页作品、微博帖子、知乎回答/文章/想法/专栏/问题/视频、贴吧主题帖和 X 帖子；只读语义正文，平台操作文案不进入 AI。身份缺失时仍进入 AI 只读队列，不生成可执行拉黑入口。
- 持久化开发扩展桥同步放行 `content/contentType/title` 作品载荷和带 `contentType` 的反馈样例；扩展 service worker loopback mock 回归覆盖完整提示词请求，避免提示词工程字段在桥接层被旧白名单拒绝。
- 修复桥接拒绝、扩展回调失败、网关 HTTP/返回格式/超时等 AI 错误被统一伪装成“网关请求失败”的问题；只有桥状态降级时才提示刷新扩展。
- 反馈账本和个性化偏好只保存在本机；正/负/未知反馈不会训练模型或直接生成屏蔽规则，达到阈值后也只生成待确认提案。
- 审核弹窗的「不屏蔽」改为可撤销切换：已记录状态保持灰态但仍可点击，撤销只删除对应负向反馈并恢复候选选择，再次点击即可重新记录。
- 持久化开发扩展主世界存储白名单补齐提示词 profile/反馈键，新记录可跨新文档和页面刷新恢复审核状态；此前未真正写入存储的旧会话内存状态不作历史恢复承诺。
- `structure regression` 内容覆盖 6/6、内容 AI 12/12、AI screening 19/19、持久化扩展 8/8；2026-09-09 专用 Chrome 候选只读验证覆盖 B站、抖音、微博、知乎、贴吧，X 空壳阻断；详细数量、登录状态和限制见 [v0.52.0 工作区条目](docs/changelog/v0.52.0.md)。

发布状态：v0.52.0 源码已 commit、推送并创建 tag/Release；未执行部署或平台写入；当前公开版本为 [OmniBlock v0.52.0](https://github.com/a2787/ub-utils/releases/tag/v0.52.0)。

## v0.51.1 - B站新增内容累计增量 AI 分析 - 2026-09-08（源码已推送，未创建 Release）

- B站滚动评论、展开楼中楼和后续 `seg.so` 弹幕数据段新增内容会进入有界 AI 增量分析；同一稳定记录不重复发送。
- AI 状态的“已分析数量”改为当前页面累计数；每批最多 80 条的协议和人工审核/关键词优先级保持不变。
- `structure regression`：AI screening 18/18，覆盖评论与弹幕增量触发、累计计数和无重复请求；无页面/控制台错误。真实站点结果、阻断和当前候选边界见完整条目。

详细用户变化、验证标签、限制和发布边界：[v0.51.1 完整条目](docs/changelog/v0.51.1.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.51.1-content-ai-incremental`，提交 `910d2def9cb445273ebdc73472ec332d5043eafe` 已推送到 `origin/master`，未创建 tag/Release；真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.51.0 - 平台关键词屏蔽与评论 AI 建议提醒 - 2026-09-08（本地候选，未推送）

- B站/抖音关键词和正则规则迁移到各自「内容屏蔽」弹窗的「关键词屏蔽」标签；规则默认启用，可靠身份命中后直接本地屏蔽，不经过确认、不消耗 AI token，旧设置键继续兼容。
- AI 分析前先排除关键词和本地名单命中；B站/抖音评论晚到首轮分析后按稳定哈希增量提醒，微博/知乎接入评论 AI 采集和同一人工审核弹窗。
- B站和抖音有弹幕管理器时显示四个内容标签；微博/知乎显示评论与 AI 两个标签。知乎/B站等列表正文继续排除点赞、回复、举报等操作文字。
- `structure regression`：内容规则 8/8、AI screening 14/14、AI 多平台 7/7、quickblock 37/37、评论管理器 3/3、适配器 28/28 等受影响回归通过。`real-site verified`：2026-09-08 B站 4 标签与评论管理器/关键词面板、微博评论/AI 两标签与评论采集通过；抖音验证码、知乎登录页及微博顶层 spacer 按 `blocked` 记录。

详细用户变化、验证标签、限制和发布边界：[v0.51.0 完整条目](docs/changelog/v0.51.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.51.0-content-rules-ai-alerts`，仅保留在本地工作区，未 push、未创建 tag/Release；真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.50.0 - B站入口统一、列表正文清理与弹幕 UID 按需关联 - 2026-09-07（本地候选，未推送）

- B站「内容屏蔽（评论/弹幕）」入口固定到右下角，与设置齿轮同侧并位于其上方。
- B站评论管理器、AI 候选和原生弹幕列表只保留正文，排除点赞、回复、举报等平台操作组件文字；正文自身出现同名词时仍保留。
- 单条、批量、悬浮、原生列表和 AI 已确认的 B站弹幕目标，才会按需进行 hash→UID 候选反查与匿名用户卡片校验；唯一且完整校验的目标同时保存 hash/UID，碰撞或失败目标只保存 hash，不做初始全量反查。
- AI 仍保留人工审核和「确认屏蔽所选」写入门槛；自动化的是目标 UID 关联，不是静默拉黑。

详细用户变化、验证标签、限制和发布边界：[v0.50.0 完整条目](docs/changelog/v0.50.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.50.0-bili-lazy-uid-body-cleanup`，仅保留在本地工作区，未 push、未创建 tag/Release；真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.49.0 - 统一内容屏蔽标签弹窗与抖音一键 AI 分析 - 2026-09-07（已推送源码，未创建 tag/Release）

- B站和抖音各自把评论/弹幕入口合并为一个「内容屏蔽（评论/弹幕）」按钮，弹窗内提供「屏蔽评论」「屏蔽弹幕」「AI 屏蔽」三个标签；AI 配置和分析入口从设置页迁移到第三个标签。
- 抖音 AI 标签页的「加载并分析本页」一次点击依次加载评论、扫描当前视频弹幕时间轴，再把实际观察到的全部记录按批送入 AI，并直接进入原有人工审核框。
- 加载/分析进度可见且可取消；修复播放器播放状态 class 变化误判为换片、导致一键任务停在加载态的问题。仍不调用抖音私有接口、不执行平台写入、不自动确认候选。
- 匿名隔离 B站视频页已实际观察到统一入口、3 个标签、评论/弹幕管理器和浮动弹幕本地屏蔽/撤销；抖音匿名入口仍被验证码阻断。
- 专用 Chrome 登录态真实只读验证完成：`douyin.com/video/...` 当前会话最终分析 365 条记录，弹幕时间轴 55/55，5 批完成 365/365，进入 28 条候选审核，错误为 0。

详细用户变化、验证标签、限制和发布边界：[v0.49.0 完整条目](docs/changelog/v0.49.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.49.0-content-manager-tabs`，源码已推送到 `origin/master`，未创建 tag/Release；真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.48.0 - AI 多平台采集与一键网关启动 - 2026-09-07（已推送候选，未公开发布）

- 保留 B站 AI 评论/弹幕采集与人工审核，并接入抖音当前页面已观察到的评论和弹幕；身份无法确认的抖音弹幕只读展示，不提供可执行屏蔽。
- 抖音弹幕正文按活动视频会话隔离，同 URL 换片会清理旧 AI 记录；普通弹幕属性变化不会触发重复模型请求，不自动展开/滚动或调用私有接口。
- 根目录新增 [`启动网关.cmd`](启动网关.cmd)，双击即可调用 PowerShell 7 的 `gateway\start.ps1`；不包含 API Key，不修改系统服务/注册表，设置页同步显示说明。
- B站/抖音发往 loopback 网关的请求继续只含规则、临时项目编号、类型和截短正文，候选须人工确认后才写入现有名单。
- 修复本地网关 18 秒请求加 1 次重试超过客户端约 20 秒预算的问题；userscript 与持久开发扩展桥统一留出 60 秒请求上限，同时保留无回调 watchdog。
- AI 现在把当前已观察内容按每批最多 80 条顺序送入网关并合并结果，不再只分析前 80 条；设置页显示批次进度。抖音评论/弹幕 AI 正文会清理末尾“喜欢/举报/回复/分享/展开 N 条回复”等控件词，同时保留正文自身出现的同名词；GM/XHR 桥接无回调时仍会在有限时间内报错。持久开发扩展降级时会快速报告桥接不可用，loopback 地址有效但请求失败时不再附加误导性的地址提示；窄 AI POST 由 service worker 发起，抖音真实探针结束时会清理 document-start 测试注入。

详细用户变化、验证标签、限制和发布边界：[v0.48.0 完整条目](docs/changelog/v0.48.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.48.0-ai-batched-content-cleanup`，源码已推送至 `origin/master` 的 `be6e653`，未创建 tag/Release；真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.47.0 - AI 智能屏蔽第一阶段 - 2026-09-06（历史本地候选，未公开发布）

- 设置面板新增默认关闭的「启用 AI 智能屏蔽」；支持自然语言预设规则、本页面附加规则和「分析本页」入口。
- 第一阶段只分析 B 站当前页已观察到的评论/弹幕；AI 命中结果先进入可多选的本地审核框，确认后才复用现有名单写入链路。
- 只向用户配置的 loopback OpenAI 兼容网关发送截断正文、内容类型、临时项目编号和规则，不发送 UID、弹幕 hash、URL、Cookie 或 API Key；无可靠身份的候选不可执行。
- provider 多配置、自动切换、限流、cooldown 和记忆由外部 LiteLLM/OpenClaw 等网关负责，userscript 不重复实现 router。
- 仓库已附带 LiteLLM Docker 网关向导；DeepSeek V4 可由向导将 thinking mode 设为 `disabled`，本地人工 mock 的健康、兼容入口和 429 fallback
  已通过，官方 DeepSeek provider 已完成本地真实页面联调；商汤 provider、额度和记忆仍为 `blocked`；本候选未 push、未创建 tag/Release。

详细用户变化、验证标签和限制：[v0.47.0 完整条目](docs/changelog/v0.47.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.47.0-ai-screening-phase1`，源码/真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.46.2 - B站子评论菜单与楼回复入口修复 - 2026-09-05（已发布）

- 将 B站主评论菜单中的楼操作显示为四字短文案「🧵 屏蔽回复」，保持菜单单行；完整功能语义保留在 title/aria-label「屏蔽该楼回复」。
- 识别真实 `BILI-COMMENT-ACTION-BUTTONS-RENDERER` 内的 `#more`/更多图标触发器，使子评论三点菜单打开后能及时补扫并插入「🚫 本地拉黑」。
- 子评论只插入本地拉黑，不插入只适用于主评论的楼回复入口；弹幕举报的 `mid_hash` 安全边界和评论 `bili:uid` 解析保持不变。

详细用户变化、验证标签和限制：[v0.46.2 完整条目](docs/changelog/v0.46.2.md)。

发布状态：`v0.46.2` tag 与 GitHub Release 已创建并推送至 `origin`；当前公开版本为
[OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)。构建为
`0.46.2-bili-subcomment-menu-layout`；当前源码版本/构建和真实站点边界见
[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.46.1 - B站评论举报菜单本地入口回归修复 - 2026-09-05（历史本地候选，未公开发布）

- 修复 B站视频评论菜单中「硬核会员举报」被误判为弹幕举报，导致没有浮动弹幕身份时提前返回、本地入口不再插入的问题。
- 评论菜单继续按当前评论节点解析规范 `bili:uid`；只有非评论菜单的 B站弹幕举报仍要求唯一、未过期的 `mid_hash` 身份。
- 新增人工合成回归覆盖“仅有硬核会员举报”的 `bili-comment-menu`，避免后续菜单文案变体再次绕过本地入口。

详细用户变化、验证标签和限制：[v0.46.1 完整条目](docs/changelog/v0.46.1.md)。

发布状态：`v0.46.1` 仅为本地候选，未 push、未创建 tag 或 GitHub Release；当前公开版本仍为
[OmniBlock 0.46.0](https://github.com/a2787/ub-utils/releases/tag/v0.46.0)。候选构建为
`0.46.1-bili-comment-menu-report`；当前源码版本/构建和未完成的真实站点边界见
[当前维护状态](docs/maintenance/CURRENT.md)。

## 历史版本

上一候选版本 [v0.46.1](docs/changelog/v0.46.1.md)，上一公开版本 [v0.46.0](docs/changelog/v0.46.0.md)；更早条目已移至
[变更日志索引](docs/changelog/INDEX.md) 和只读归档；旧条目中的候选/发布状态只代表当时事实。
