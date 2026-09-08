# OmniBlock 当前维护计划

更新时间：2026-09-08

本文件是 OmniBlock 唯一的活动计划。它记录当前要解决的问题、范围、依赖、验收条件和
下一步动作；当前事实放在 `CURRENT.md`，用户可见变化放在 README/版本 changelog，已经
结束的计划移入历史索引，不在这里无限累积。

## 使用契约

- 每项计划必须有稳定的 `OB-*` ID；代码、测试、ADR 和交接记录引用该 ID，而不是依赖对话中的临时称呼。
- `status` 只能使用 `proposed`、`approved`、`in_progress`、`verified`、`deferred`、`blocked`、`superseded`。
- `verified` 必须有可追溯证据；`blocked` 必须写明阻断原因和下一步，不能当作通过。
- 依赖必须引用本文件已有 ID，不能形成循环；被替代的计划保留原文并链接新的决定。
- 活动计划接近 24 KiB 时先拆分职责并更新知识树，不能把历史台账继续追加到本文件。

## 状态流转

```text
proposed → approved → in_progress → verified
                                ├→ blocked
                                ├→ deferred
                                └→ superseded
```

## 活动项

### OB-AI-001 — AI 智能屏蔽第一阶段

- status: in_progress
- priority: P1
- scope: B站评论/弹幕、规则/审核、OpenAI 兼容网关；向导生成 LiteLLM 配置，userscript 不实现 router。
- non-goals: 不改 V2；Key 不入仓库；不伪造 UID；不自动屏蔽；不扩展无结构证据的平台。
- dependencies: none
- acceptance: required
  - [x] AI 默认关闭；配置、规则和审核状态有本地回归。
  - [x] loopback 仅发送无身份键文本；候选须多选确认后才写入名单。
  - [x] 本地矩阵、B站只读探针、docs/隐私门禁通过；DeepSeek V4 thinking 超时由 `thinkingMode=disabled` 解决。
  - [x] 网关向导、生命周期、健康、mock fallback 及官方 DeepSeek 页面联调通过；商汤与多 provider fallback 待补。
- evidence: 详见 CURRENT；LiteLLM mock `structure regression`；官方 DeepSeek V4 Flash `real-site verified`；商汤、额度和记忆 `blocked`
- next: 增加商汤“日日新” provider，验证模型、额度、fallback 和 cooldown；不改 V2。
- updated: 2026-09-06
- supersedes: none
- files: omniblock.user.js; gateway/*; test/ai-screening.cjs; test/gateway-smoke.cjs; docs/decisions/0002-ai-screening-gateway-boundary.md; README.md; docs/changelog/v0.47.0.md; docs/maintenance/CURRENT.md

### OB-AI-002 — AI 多平台采集与一键网关启动

- status: blocked
- priority: P1
- scope: 保留并显式回归 B站评论/弹幕 AI 采集；接入抖音当前页面已观察到的评论/弹幕；按活动视频会话隔离抖音弹幕缓存；提供根目录双击启动网关包装文件，并同步设置页说明与本地验证。
- non-goals: 不引入 Native Messaging 或其他系统级启动组件；不修改注册表、系统服务或开机启动；不自动展开/滚动页面收集 AI 内容；不调用抖音私有接口；不改变现有身份键、人工审核、名单写入和平台只读边界；不改 V2；不执行 push、tag、Release 或其他公开发布。
- dependencies: OB-AI-001
- acceptance: required
  - [x] B站评论和当前弹幕会话仍通过统一 AI 采集契约，保持无身份字段出站和人工审核。
  - [x] 抖音评论使用已有可靠 `douyin:secuid` 身份；抖音弹幕保留正文与已有 `douyin:uid`/`douyin:secuid` 身份，无法确认身份的候选只读不可执行。
  - [x] 抖音活动视频换片、SPA 路由、节点回收和页面隐藏不会串用旧 AI 记录，也不会按高频 DOM 变化重复请求模型。
  - [x] 根目录双击启动文件只调用 PowerShell 7 的 `gateway\\start.ps1`，不含 API Key，不改变系统配置，并保留健康检查错误信息。
  - [x] 人工合成 B站/抖音 AI 夹具、适配器/弹幕/评论管理器回归、网关启动文件静态门禁和语法/doc 门禁通过。
  - [x] B站与抖音匿名真实只读探针同轮执行；B站目标通过，抖音验证码阻断已如实记录为 `blocked`，未以夹具替代。
  - [x] README、版本 changelog、CURRENT、架构/计划与当前候选版本同步；候选仍保持本地未发布。
  - [x] 抖音登录态真实页面完成当前已观察评论/弹幕、弹幕管理器和自动规则的只读观察；未点平台写入控件。
  - [ ] 抖音登录态同 URL 换片后完成新会话弹幕管理器/AI 采集隔离观察；数据不足时保留 `blocked`。
- evidence: `structure regression`：AI B站 8/8、抖音 6/6、受影响本地矩阵、完整 gateway smoke 和 `cmd.exe /c "启动网关.cmd"` 实际启动均通过；`real-site verified`：2026-09-06 B站匿名探针与专用 Chrome 0.48.0 页面通过，2026-09-07 抖音登录态当前视频 15 条带身份弹幕、10 条评论及管理器/自动规则闭环通过；抖音换片新行暂 `blocked`，匿名入口仍为验证码中间页。
- next: 在专用 Chrome 以当前已加载视频重放稳定同 URL 换片，确认新会话管理器/AI 记录不继承旧视频；不公开发布。
- updated: 2026-09-07
- supersedes: none
- files: omniblock.user.js; test/ai-screening.cjs; test/ai-platforms.cjs; test/adapters.cjs; test/danmaku-auto.cjs; test/comment-manager.cjs; test/real-bilibili-probe.cjs; test/real-platform-probe.cjs; test/real-douyin-probe.cjs; gateway/README.md; test/gateway-smoke.cjs; test/maintenance-check.cjs; 启动网关.cmd; README.md; docs/changelog/v0.48.0.md; docs/decisions/0002-ai-screening-gateway-boundary.md; docs/maintenance/CURRENT.md; docs/maintenance/PLAN.md; docs/architecture/ARCHITECTURE.md; docs/KNOWLEDGE_TREE.md

### OB-RULE-002 — 平台关键词屏蔽与评论 AI 建议提醒

- status: verified
- priority: P1
- scope: 将 B站/抖音现有本地关键词/正则自动规则从总设置页迁到各自内容屏蔽弹窗的“关键词屏蔽”标签；规则默认启用，命中当前页面已观察到且身份可靠的评论或弹幕时直接进入既有本地屏蔽链并立即隐藏，不请求 AI、不经过确认。保留既有设置键和规则例外的导入兼容。修复评论晚于弹幕挂载时自动 AI 已经完成首轮、却没有再次分析评论的问题；在当前页面新增可分析评论后有界地重新触发 AI 建议。为微博、知乎补齐当前可靠评论的 AI 采集和平台入口，使其使用同一人工审核弹窗。
- non-goals: 不调用任何平台写入接口；不把无可靠身份的评论或弹幕伪装成可屏蔽用户；不为关键词功能消耗 token；不让 AI 候选绕过人工确认；不自动滚动/展开微博或知乎评论，不调用私有接口；不改变 AI 80 条批次协议、已有身份键、B站弹幕 hash→UID 安全边界或其他平台适配器选择器。
- dependencies: OB-AI-001
- acceptance: required
  - [x] B站、抖音内容屏蔽弹窗各出现“关键词屏蔽”标签；已有 `biliDanmakuRules`/`douyinDanmakuRules` 数据可见、可添加/启停/删除，设置页不再作为主入口，仅保留迁移说明。
  - [x] 关键词/正则命中评论或弹幕时不产生 AI 网关请求；可靠身份直接写入既有名单并隐藏，页面刷新/后续同作者内容继续生效；无可靠身份时不提供伪造的可执行身份。
  - [x] AI 优先分析前先排除已经被关键词/本地名单处理的记录；关键词命中不进入 AI 候选审核队列。
  - [x] B站评论先加载、弹幕后加载，以及评论晚于首轮 AI 的场景均能在有界重试内触发一次新的 AI 采集；同一记录不重复请求，不建立常驻高频轮询，页面切换/关闭/取消时旧 run 失效。
  - [x] 微博、知乎在当前已有可靠评论 DOM 和身份契约下显示平台 AI 入口；AI 结果进入现有多选人工审核框，确认前不写名单，结果无法识别身份时只读展示或跳过执行。
  - [x] 为关键词即时屏蔽、评论延迟 AI、微博/知乎 AI 入口和候选确认各新增或更新回归断言；真实选择器先由当轮真站捕获确认。
  - [x] 运行受影响的 B站/抖音/微博/知乎回归、语法、文档和四平台真实只读探针；逐项记录 `real-site verified`、`structure regression` 或 `blocked`。
- evidence: `structure regression`：内容规则夹具 8/8、AI screening 14/14、AI 多平台 7/7、自动弹幕 7/7、quickblock 37/37、评论管理器 3/3、适配器 28/28、运行器 20/20、自动加载 3/3、watchdog 1/1、持久化开发扩展 6/6，受影响回归无页面/控制台错误；`real-site verified`：2026-09-08 匿名/登录状态未判定的 B站视频页观察到评论/弹幕/AI/关键词四标签及评论管理器；同日微博详情页观察到评论/AI 两标签和 26/23/21/5 评论统计及本地屏蔽撤销；`blocked`：抖音验证码、知乎登录页、微博顶层 spacer、B站根评论分页 partial。详见 CURRENT 与 v0.51.0 changelog。
- next: 保持当前候选本地状态；若要发布，先复核最终差异、源码哈希和隐私门禁，并另获当轮 tag/Release/push 授权。抖音和知乎需在后续获授权登录态只读会话可用时补真站验证；不因匿名阻断扩大结论。
- updated: 2026-09-08
- supersedes: none
- files: omniblock.user.js; test/content-ai.cjs; test/danmaku-auto.cjs; test/ai-screening.cjs; test/ai-platforms.cjs; test/adapters.cjs; test/comment-manager.cjs; test/quickblock.cjs; test/real-bilibili-probe.cjs; test/real-platform-probe.cjs; test/maintenance-check.cjs; README.md; CHANGELOG.md; docs/changelog/INDEX.md; docs/changelog/v0.51.0.md; docs/maintenance/CURRENT.md; docs/maintenance/PLAN.md

### OB-AI-003 — B站新增内容的累计增量 AI 分析

- status: verified
- priority: P1
- scope: 修复 B站首轮自动分析完成后，滚动评论、展开楼中楼或弹幕数据段新增内容未触发 AI 增量分析，以及增量完成后“已分析数量”显示为本批新增数量而非当前累计数量的问题；评论 DOM 变化和弹幕数据段变化均进入现有有界调度，并继续按稳定记录 ID 去重。
- non-goals: 不提高或移除 AI 每批 80 条上限；不自动滚动/展开评论；不改变 B站弹幕 hash→UID 安全边界、人工审核、关键词优先级、现有身份键或平台写入边界；不引入常驻高频轮询。
- dependencies: OB-RULE-002
- acceptance: required
  - [x] 首轮分析完成后新增 B站评论或楼中楼记录，能够触发一次只包含新记录的 AI 请求。
  - [x] 首轮分析完成后新增 B站弹幕数据段记录，能够触发一次只包含新记录的 AI 请求。
  - [x] 增量分析完成后，状态中的 `analyzed` 为当前页面已分析记录累计数，且记录总数、批次进度和候选状态一致。
  - [x] 首轮请求进行期间连续到达的评论/弹幕变化被合并为后续一次增量分析；同一稳定 ID 不重复发送。
  - [x] 新增回归断言、语法/文档门禁、B站受影响本地检查和当轮真实只读探针均按证据等级记录；80 条批次边界保持原样。
- evidence: `structure regression`：AI screening 18/18、内容规则 8/8、AI 多平台 7/7、AI 批次 2/2、自动加载 3/3、quickblock 37/37；`real-site verified`：2026-09-08 B站只读视频页首轮 224/224，滚动后 247/247，展开楼中楼后 273/273，均产生只含新增记录的事件；`blocked`：根评论分页仍 partial，登录态未判定。
- next: 保持 0.51.1 本地候选；若要发布，先复核最终差异、源码哈希和隐私门禁，并另获当轮 tag/Release/push 授权。
- updated: 2026-09-08
- supersedes: none
- files: omniblock.user.js; test/ai-screening.cjs; docs/architecture/ARCHITECTURE.md; docs/changelog/v0.51.1.md; README.md; CHANGELOG.md; docs/changelog/INDEX.md; docs/maintenance/CURRENT.md; docs/maintenance/PLAN.md

### OB-WEIBO-003 — 详情页作品级评论统计作用域

- status: in_progress
- priority: P1
- scope: 微博详情页“屏蔽作品”入口的作品作用域识别与一次性读取；把与帖子卡片同级的评论虚拟列表纳入当前帖子统计，在 page-mode 文档滚动中按有限分段保留规范化记录；关闭程序化展开的楼中楼后恢复页面原有滚动样式，并在用户取消/关闭读取时中止剩余异步扫描；插件自有弹窗收尾后把页面键盘焦点交还给文档，避免评论输入框吞掉方向键；在已有作品屏蔽身份且虚拟行被回收/复用时，只对视口内评论做轻量重判，避免已命中身份在滚动帧间短暂重新显示；保持作者、主评论、子评论的身份归属和现有虚拟列表补位逻辑不变。
- non-goals: 不改变微博评论/回复选择器或身份键；不读取平台写入接口；不新增运行模式或独立诊断模式；不扩大到微博信息流、其他平台或 X；不把页面总评论数猜测成已读取的可屏蔽用户数。
- dependencies: none
- acceptance: required
  - [x] 同一登录态专用 Chrome 详情页复现当前弹窗“主评论作者：0 位、子评论作者：0 位”，并记录现场 DOM 作用域与计数。
  - [x] 作品候选在真实详情结构下覆盖帖子卡片和同级评论容器；人工合成夹具验证第二个帖子及其评论不会被并入。
  - [x] `node test/work-block.cjs`、微博适配器回归、语法/文档门禁保持通过；旧行为回放对作用域边界断言失败、候选行为显示主评论/子评论计数。
  - [x] 候选注入同一专用 Chrome 后，弹窗显示现场可读取的作者/评论/回复数量；仍标记 partial，未将统计扩大为绝对全量。
  - [x] 作品级提交后，当前已挂载且身份命中的评论继续即时隐藏；page-mode 分段读取新增的可确认身份进入同一名单，未观察到的作者仍明确保留为 partial，不伪装成平台绝对全量。
  - [ ] 作品级提交后，微博虚拟行回收/复用时，视口内已在名单中的评论在下一绘制帧内重新判定并隐藏；没有屏蔽工作时不建立滚动扫描。
  - [x] 楼中楼程序化关闭后，真实页面 `woo-modal-main` 消失且 html/body 原滚动样式恢复；滚轮/脚本滚动不再被 `overflow-y:hidden` 卡住。
  - [x] 楼中楼弹窗延迟出现、读取异常或用户取消时仍能关闭本次打开的弹窗并恢复文档原滚动样式；回归夹具在旧的短等待路径上失败。
  - [x] 用户取消/关闭作品级读取后，未完成的异步扫描不再继续占用页面；页面焦点不留在已移除的插件按钮或微博评论输入框，方向键可继续滚动文档。
- evidence: `structure regression`：`node test/work-block.cjs` 3/3，覆盖延迟弹窗、AbortSignal 和取消清理；`real-site verified`：2026-09-04—09-05 微博详情读取/隐藏/取消清理通过，读取仍为 `partial`。详见 CURRENT。
- next: 保留虚拟行回收/复用的视口内下一帧重判为未完成项；继续逐项核验其他平台，发布动作已随 `v0.46.0` 完成，后续版本仍需当轮授权。
- updated: 2026-09-05
- supersedes: none
- files: omniblock.user.js; test/work-block.cjs

### OB-COVERAGE-001 — 各平台屏蔽功能现场核验矩阵

- status: in_progress
- priority: P1
- scope: 在专用浏览器和只读探针中逐项核对 B 站、微博、知乎、贴吧、抖音的作者/帖子、评论/楼中楼、批量入口、管理器、弹幕（适用平台）、恢复与页面稳定性；将真实观察、结构回归和外部阻断分开登记，作为 0.46.2 候选收口前的覆盖清单。
- non-goals: 不验证 X（按用户要求暂不做）；不点击任何平台举报、官方拉黑、关注、发帖或其他写入控件；不新增运行模式；不因夹具通过而扩大线上支持范围；本项不直接执行版本发布。
- dependencies: OB-WEIBO-003
- acceptance: required
  - [x] B站：评论/楼中楼快捷屏蔽、整楼、批量范围、弹幕工具/悬浮入口、UID 候选与恢复均有真实或明确 blocked 证据。
  - [x] B站本轮回归：真实视频评论菜单的 `硬核会员举报` 仍须注入 `本地拉黑`，且不改变无浮动弹幕身份时的弹幕举报安全边界。
  - [x] B站评论菜单版式：根评论的楼操作入口在真实 `bili-comment-menu` Shadow DOM 内保持单行显示，短文案与完整 title/aria-label 语义一致。
  - [x] B站子评论菜单：真实 `BILI-COMMENT-REPLY-RENDERER` 的“三个点”打开后触发菜单补扫，能够按当前子评论身份注入 `本地拉黑`，且不把楼操作入口错误添加到子评论。
  - [ ] 微博：帖子作者、主评论、楼中楼、评论管理器/批量、点赞用户列表、作品级入口与恢复均有真实或明确 blocked 证据；不把未加载评论写成全量。
  - [ ] 知乎：作者、评论、搜索/列表入口和恢复先取得当前 DOM 捕获；缺少稳定样本时维持 blocked，不猜选择器。
  - [ ] 贴吧：旧版楼层、新版现代详情评论、楼中楼/批量与恢复分别核验；opaque 首页作者继续 blocked。
  - [ ] 抖音：作者/评论、评论管理器与批量、弹幕悬停/管理器、推荐流遮罩/切换与恢复分别核验；验证码或换片目标不稳定时如实 blocked；弹幕管理器关闭时正在进行的时间轴扫描必须同步取消，不得留下后台任务。
  - [ ] 每项证据附日期、脱敏页面形式、登录状态、确切结果和命令；所有受影响本地回归保持通过。
- evidence: `structure regression`：本地 `node test/quickblock.cjs` 36/36 通过，新增 `QB-B-REPORT`、`QB-B-LAYOUT` 和 `QB-B-REPLY-MENU`；旧源码重放的两项新增断言均失败，弹幕举报安全边界保持通过。`real-site verified`：2026-09-05 专用 Chrome 复现旧版楼回复入口换行和子评论点击后缺少本地入口；隔离 0.46.2 候选运行 `node test/real-bilibili-probe.cjs --verify-local --verify-sub-comment`，真实发现 1 个子评论，身份解析成功，本地入口数量为 1，主评论/子评论/整楼屏蔽与恢复通过，错误为 0。`blocked`：当前 Chrome 无法按安全策略刷新候选扩展。其余范围按 CURRENT 逐项登记，X 明确排除。
- next: 用单标签补齐微博点赞列表、知乎作者/列表、贴吧旧版楼层和抖音推荐流换片；微博顶层 spacer、B站匿名根评论分页和抖音换片/归因性能保持 `blocked` 时不猜测扩展。任何新选择器仍须先捕获再实现，X 按用户要求排除。
- updated: 2026-09-05
- supersedes: none
- files: omniblock.user.js; test/quickblock.cjs; docs/maintenance/PLAN.md; docs/maintenance/CURRENT.md; README.md; docs/changelog/v0.46.1.md; docs/changelog/v0.46.2.md

### OB-RULE-001 — 自动规则正则安全边界

- status: proposed
- priority: P2
- scope: 自动弹幕正则的灾难性回溯风险识别、失败提示和热路径编译缓存。
- non-goals: 不删除用户规则；不改变关键词规则；不为规避风险而关闭自动屏蔽。
- dependencies: none
- acceptance: required
  - [ ] 明显高风险表达式在保存前被拒绝并给出可理解原因。
  - [ ] 合法表达式只编译一次，匹配过程不重复构造 RegExp。
  - [ ] B站/抖音自动弹幕本地夹具和已授权真实页面只读探针保持通过。
- evidence: pending；先补充人工合成的高风险/合法表达式回归。
- next: 设计保守启发式并评估对现有规则兼容性，必要时先以 warning 方式落地。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/danmaku-auto.cjs; test/state.cjs

### OB-PERF-001 — 可归因的性能预算

- status: in_progress
- priority: P2
- scope: 抖音高频 DOM、深层扫描、虚拟列表、B 站弹幕和日志/存储写入的测量与优化。
- non-goals: 不凭单次主观 CPU 观察修改多个平台的行为。
- dependencies: none
- acceptance: required
  - [x] 能分别报告 mutation、扫描、布局、日志和存储耗时。
  - [x] 有可重复的可见/隐藏/换片场景本地基线和回归阈值。
  - [x] 真实页面无法访问时保留 blocked，不用夹具数字替代。
  - [ ] 取得可归属于当前构建的抖音真实静置、播放和换片基线。
- evidence: `structure regression`：性能边界 8/8；2026-09-04 用户授权登录态抖音详情页只读探针识别 3 条带身份弹幕、6 条评论和 3 行管理器，弹幕/评论本地隐藏与恢复通过，稳定性采样 10 次、心跳错误 0、最大延迟 4ms；播放 4.025 秒 renderer/page 总量为 TaskDuration 0.482075 秒、ThreadTime 0.477392 秒、ScriptDuration 0.095069 秒、LayoutDuration 0.006822 秒、RecalcStyleDuration 0.041989 秒，暂停 4.012 秒分别为 0.345100、0.352478、0.038331、0、0.033411 秒。该指标是页面 renderer 总量，不是插件独占 CPU。换片场景在平台回收旧节点后没有稳定的新目标，按 `blocked` 记录。
- next: 保留播放/暂停数据作为当前候选的页面总量基线；取得稳定换片目标后再补采切换窗口。只有在获得可归因插件指标后，才考虑深扫描时间片或进一步缓存优化；若入口再次验证码阻断，维持 `blocked`。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/performance.cjs; test/real-platform-probe.cjs

### OB-MAINT-001 — 重复路径清理与受控模块化

- status: deferred
- priority: P3
- scope: 已证实不可达的兼容代码、重复测试夹具以及最终 userscript 构建边界。
- non-goals: 不为了“文件变小”而一次性重写全部平台适配器。
- dependencies: OB-PERF-001
- acceptance: required
  - [ ] 每个删除项有调用方审计和替代路径回归。
  - [ ] 若拆分源码，生成产物与元数据、执行顺序和行为保持可比对。
  - [ ] 模块化带来的构建复杂度不高于它解决的维护成本。
- evidence: pending
- next: 等抖音真实基线解除 blocked 后，先做调用方审计；没有明确收益时维持单文件发布物。
- updated: 2026-08-30
- supersedes: none

### OB-REL-001 — CI 与公开发布准备

- status: deferred
- priority: P3
- scope: 本地命令入口、CI status check、源码/构建 hash、版本/tag/Release 一致性。
- non-goals: 不在未获当前任务明确授权时 push、覆盖 tag 或公开发布。
- dependencies: OB-PERF-001
- acceptance: required
  - [ ] 获得 CI/CD 配置修改授权后，CI 可运行不依赖维护者机器上的隐含路径或未锁定依赖。
  - [x] 候选说明分别列出 real-site verified、structure regression 和 blocked。
  - [x] Release 门禁只接受明确授权和可追溯的构建产物。
- evidence: 本地完整矩阵、源码 hash 和发布边界已落地；当前任务未授权修改 CI/CD、push、tag 或 Release。
- next: 用户明确授权 CI/CD 修改时再新增最小工作流；公开发布需另获当轮 push/tag/Release 授权。
- updated: 2026-08-30
- supersedes: none

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
