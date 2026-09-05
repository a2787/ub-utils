# OmniBlock 当前维护计划

更新时间：2026-09-05

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

### OB-CORE-001 — 单一运行路径的正确性与低开销治理

- status: verified
- priority: P0
- scope: 已证实的启动去重竞态、持久化成功语义、事件日志写放大、热路径重复判定等通用核心路径；保持一个运行模式，诊断详细记录继续由插件内开关控制。扫描时间片与可取消异步任务等尚未实施的优化留在后续性能计划，不在本项冒充完成。
- non-goals: 不新增“第一资源模式”/“低资源模式”或独立“诊断模式”；除独立的 OB-TIEBA-001 外不改变平台选择器、身份规则或屏蔽效果；不处理 X 平台；不执行公开发布、push 或部署。
- dependencies: none
- acceptance: required
  - [x] 启动守卫在异步初始化期间也能原子地阻止重复实例。
  - [x] 持久化失败不会继续宣称成功或触发成功后置流程，并有回归断言。
  - [x] 日志/扫描热路径不引入额外常驻轮询；现有本地矩阵保持通过。
  - [x] 修改前后均有 `node --check`、受影响测试和 `git diff --check` 证据。
  - [x] 每个平台行为变更仍须同轮真实浏览器验证；没有现场结构证据时只做通用核心修复。
- evidence: 2026-09-04 `node test/run.cjs` 20/20、`node test/state.cjs` 9/9、`node test/performance.cjs` 8/8、`node test/adapters.cjs` 22/22 及其余本地矩阵通过；用户授权专用 Chrome 登录态页面均 `readyState=complete` 且运行时可读；X 明确排除。
- next: 启动守卫、持久化失败语义、日志裁剪、抖音规则重复计算、异步任务取消和身份索引缓存均已分项落地；深扫描时间片仍须先取得可归因线上基线，不在本项扩大范围。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/run.cjs; test/state.cjs; test/performance.cjs

### OB-UI-001 — 移除跨平台通用悬浮拉黑入口

- status: verified
- priority: P1
- scope: 删除跨平台通用的 `.ob-block-btn` body 浮层和 document 级 `mouseover` 注入路径；保留各平台已经单独实现并验证的评论、楼层、作者、作品、原生菜单、弹幕和批量入口。共享的名单、身份规范化、确认框、右键菜单和扫描器仍保留；`showHoverButton` 仅继续控制平台专用悬浮入口（当前为抖音弹幕跟随按钮），不再代表一个跨平台评论入口。
- non-goals: 不改变任何平台选择器、身份键、屏蔽/恢复语义、扫描调度或 X；不删除微博“本地拉黑”/“屏蔽该楼回复”、B 站/抖音/其他平台的专用入口；本项不执行平台写入，版本发布由全局发布流程处理。
- dependencies: OB-CORE-001
- acceptance: required
  - [x] 微博人工合成评论在鼠标事件路径中不再创建 `.ob-block-btn`，而 `.ob-weibo-comment-block` 与 `.ob-weibo-thread-block` 仍可用。
  - [x] 抖音弹幕专用 `.ob-dy-dm-block` 悬浮、确认、隐藏和恢复回归保持通过；B 站、微博、知乎、贴吧的专用快捷/批量入口和现有右键菜单回归保持通过。
  - [x] 设置页不再把“显示悬浮拉黑按钮”描述成跨平台通用入口；保留的开关语义明确指向平台专用悬浮入口。
  - [x] 用户授权登录态专用 Chrome 的微博详情页真实悬停核对：不出现通用 `.ob-block-btn`，现有评论专用按钮仍保留；不点击平台写入控件。
  - [x] 同步 README、当前版本 changelog、CURRENT 和本计划；用户体验确认前不创建本地提交，不进行公开发布。
  - [x] 用户在专用浏览器中体验候选并确认没有回归；确认后才把本项改为 `verified` 并创建本地提交。
- evidence: `structure regression`：`node test/adapters.cjs` 28/28（微博悬停路径 generic `.ob-block-btn` 为 0，微博专用按钮仍在；抖音弹幕专用悬浮入口通过），并由 `node test/run.cjs` 20/20、`node test/quickblock.cjs` 33/33、`node test/weibo-replay.cjs` 13/13、`node test/work-block.cjs` 3/3、`node test/danmaku-auto.cjs` 7/7、`node test/performance.cjs` 8/8 保持受影响路径通过；`real-site verified`：2026-09-05 用户授权登录态专用 Chrome 的 `weibo.com/...` 详情页刷新候选扩展后，实际移入评论行观察到通用按钮数量 0，同时保留 21 个“本地拉黑”和 17 个“屏蔽该楼回复”专用按钮；未点击平台举报、官方拉黑、关注或发帖控件。用户随后在同一专用浏览器体验悬停、滚动和专用按钮并明确确认无问题。`blocked`：同轮微博探针的既有顶层虚拟列表 spacer 无可测样本，不影响本入口核对。
- next: 继续观察真实平台 DOM 变化；本项已完成并随 `v0.46.0` 发布，后续版本按发布门禁重新核对。
- updated: 2026-09-05
- supersedes: none
- files: omniblock.user.js; test/adapters.cjs; README.md; docs/changelog/v0.46.0.md; docs/maintenance/CURRENT.md

### OB-TIEBA-001 — 现代详情评论身份路径

- status: verified
- priority: P1
- scope: 为登录态真站已捕获的 `.pb-comment-item` 增加 Vue `userInfo.id` 数字身份解析和自身容器隐藏；保留旧版 `data-field` 路径。
- non-goals: 不读取或保存 Cookie；不把 `home/main?id` 的 opaque portrait 当作 UID；不猜测首页 `.thread-card` 作者或未加载楼中楼；不处理 X 平台。
- dependencies: OB-CORE-001
- acceptance: required
  - [x] 新增人工合成结构回归，数字 `userInfo.id` 可解析，集合容器不被误选。
  - [x] 旧版 `data-field`、楼中楼集合防护和现有跨平台矩阵保持通过。
  - [x] 2026-09-04 用户授权登录态专用 Chrome 的 `tieba.baidu.com/p/...` 真实详情页选中 1 个 `.pb-comment-item`，来源 `dom-vue`，测试存储桩写入后零占位隐藏。
  - [x] 选择器来自本轮真实 DOM 捕获，未新增首页 `.thread-card` 猜测兜底。
- evidence: `structure regression`：`node test/adapters.cjs` 22/22；`real-site verified`：2026-09-04 登录态贴吧详情页 1 个现代评论项解析/隐藏通过；页面无登录拦截。
- next: 取得第二个现代详情页或可展开楼中楼样本后，复核虚拟回收和多评论项边界；此前不扩展首页帖子作者。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/adapters.cjs

### OB-LIFE-001 — 评论/楼操作异步会话边界

- status: verified
- priority: P1
- scope: 评论管理器、楼中楼读取和作品读取完成后回调的会话校验；页面关闭、路由切换或面板重开时丢弃旧结果。
- non-goals: 不改变任何平台选择器、身份来源或平台请求协议；不把平台写入操作交给脚本；不新增运行模式。
- dependencies: OB-CORE-001
- acceptance: required
  - [x] 关闭或切换路由后，旧评论/楼操作不会重新渲染或提交名单。
  - [x] 旧异步结果只记录安全的取消原因，不保存页面节点或原始内容。
  - [x] B站、抖音、微博本地管理器回归保持通过，并在登录态真实页面完成只读入口核对；微博真实楼目标因平台重渲染无法确认时保持取消，不扩大为通过。
- evidence: `structure regression`：`node test/comment-manager.cjs` 3/3，覆盖管理器关闭、SPA 路由切换、AbortSignal 和取消诊断；`real-site verified`：2026-09-04 抖音详情页管理器 3 行且本地隐藏/恢复通过，微博登录态管理器 23 行/搜索/全选/3 个根楼入口可读，并观察到 1 次路由切换取消；B站当前真实探针管理器 2 行且本地楼层/整楼隐藏与恢复通过。微博实际楼目标被平台回收，确认动作按 `blocked` 保留。
- next: 若后续平台提供稳定楼目标，再复核真实确认动作；当前不修改选择器、不增加运行模式。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/run.cjs; test/comment-manager.cjs

### OB-STORE-001 — 名单身份索引与并发合并

- status: verified
- priority: P1
- scope: Store 内部身份到人物的索引、批量导入/批量屏蔽的重复遍历，以及跨标签页变化的安全合并。
- non-goals: 不改变 v1 导入导出格式、身份规范化规则或用户可见名单语义；不引入云端同步；不执行远程写入。
- dependencies: OB-CORE-001
- acceptance: required
  - [x] 批量添加和导入不再为每个组重复构建完整身份集合。
  - [x] 重复身份仍只归属一个人物，合并结果与现有回归一致。
  - [x] 外部标签页变化不会静默覆盖尚未确认落盘的本地内存变更；冲突有可观测结果。
- evidence: `structure regression`：2026-09-04 `node test/state.cjs` 9/9，人工合成批量身份索引命中/惰性重建、重复身份归属和主名单写入失败后的跨标签页冲突保护均通过；索引只存在于 Store 内存，不改变 v1 导入导出格式。
- next: 观察真实长名单下的 `identityIndex.rebuilds/lookups` 指标；任何跨标签页三方合并或格式变化另立 ADR，不在本项静默扩展。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/state.cjs; test/performance.cjs

### OB-WEIBO-002 — 详情页虚拟评论滚动稳定性

- status: verified
- priority: P1
- scope: 微博帖子详情页 `.woo-panel-main` 的虚拟评论列表；在连续屏蔽多条主评论/楼主评论并快速滚轮时，以当前回收器的空间位置作为补位基线，避免物理行临时重排导致内容层重叠或空白；补充人工合成快速滚动回归和用户授权专用浏览器复测。
- non-goals: 不新增运行模式或独立诊断模式；不降低屏蔽效果；不改用户主页嵌套评论、微博选择器/身份来源、其他平台或 X；不执行平台写入；不在用户确认前收尾、版本发布或公开推送。
- dependencies: OB-CORE-001, OB-LIFE-001
- acceptance: required
  - [x] 人工合成的多条隐藏 + 物理行重排/快速滚动回归在旧行为上失败，在候选行为上无可见内容重叠或异常空白。
  - [x] 既有 `node test/weibo-replay.cjs` 与跨平台矩阵保持通过，身份键、回收占位和撤销恢复语义不变。
  - [x] 2026-09-04 用户授权登录态专用 Chrome 的 `weibo.com/...` 详情页复现问题：快速上下滚轮期间捕获到物理行 DOM 顺序与空间顺序不一致，出现最大约 195px 重叠、345px 空白；候选修复后同一详情页采样活动内容最大重叠约 0.33px，用户体验后未报告主要问题并要求继续收口。
  - [x] 用户确认候选体验无主要问题后，同步 CURRENT/README/版本 changelog 并创建本地提交；随后按当轮授权完成 `master`、`v0.46.0` tag 与 Release 发布。
- evidence: `structure regression`：`node test/weibo-replay.cjs` 当前候选 12/12，旧行为同一回放失败；`real-site verified`：2026-09-04 用户授权登录态专用 Chrome 的微博详情页只读多条临时屏蔽/快速滚轮采样，候选活动内容最大重叠约 0.33px。
- next: 继续观察微博回收器结构变化；若再次出现真实滚动异常，另立计划并先重新捕获当前 DOM，不扩大本项范围。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/weibo-replay.cjs

### OB-WEIBO-003 — 详情页作品级评论统计作用域

- status: in_progress
- priority: P1
- scope: 微博详情页“屏蔽作品”入口的作品作用域识别与一次性读取；把与帖子卡片同级的评论虚拟列表纳入当前帖子统计，在 page-mode 文档滚动中按有限分段保留规范化记录；关闭程序化展开的楼中楼后恢复页面原有滚动样式，并在用户取消/关闭读取时中止剩余异步扫描；插件自有弹窗收尾后把页面键盘焦点交还给文档，避免评论输入框吞掉方向键；在已有作品屏蔽身份且虚拟行被回收/复用时，只对视口内评论做轻量重判，避免已命中身份在滚动帧间短暂重新显示；保持作者、主评论、子评论的身份归属和现有虚拟列表补位逻辑不变。
- non-goals: 不改变微博评论/回复选择器或身份键；不读取平台写入接口；不新增运行模式或独立诊断模式；不扩大到微博信息流、其他平台或 X；不把页面总评论数猜测成已读取的可屏蔽用户数。
- dependencies: OB-CORE-001, OB-LIFE-001, OB-WEIBO-002
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
- evidence: `structure regression`：`node test/work-block.cjs` 3/3 覆盖延迟弹窗、AbortSignal 和取消清理；`real-site verified`（2026-09-04 至 2026-09-05，用户授权登录态专用 Chrome，页面形式 `weibo.com/...`）：真实详情 wrapper 读取到作品作者 1、主评论作者 49、子评论作者 23–24，提交后当前已挂载且身份命中的评论行进入隐藏路径，读取保持 `partial`。取消/关闭后 `woo-modal-main=0`、html 恢复 `overflow: auto`、焦点回到 `BODY`，方向键与脚本滚动可继续。
- next: 保留虚拟行回收/复用的视口内下一帧重判为未完成项；继续逐项核验其他平台，发布动作已随 `v0.46.0` 完成，后续版本仍需当轮授权。
- updated: 2026-09-05
- supersedes: none
- files: omniblock.user.js; test/work-block.cjs

### OB-COVERAGE-001 — 各平台屏蔽功能现场核验矩阵

- status: in_progress
- priority: P1
- scope: 在专用浏览器和只读探针中逐项核对 B 站、微博、知乎、贴吧、抖音的作者/帖子、评论/楼中楼、批量入口、管理器、弹幕（适用平台）、恢复与页面稳定性；将真实观察、结构回归和外部阻断分开登记，作为 0.46.0 候选收口前的覆盖清单。
- non-goals: 不验证 X（按用户要求暂不做）；不点击任何平台举报、官方拉黑、关注、发帖或其他写入控件；不新增运行模式；不因夹具通过而扩大线上支持范围；本项不直接执行版本发布。
- dependencies: OB-CORE-001, OB-LIFE-001, OB-WEIBO-002, OB-WEIBO-003, OB-TIEBA-001
- acceptance: required
  - [x] B站：评论/楼中楼快捷屏蔽、整楼、批量范围、弹幕工具/悬浮入口、UID 候选与恢复均有真实或明确 blocked 证据。
  - [ ] 微博：帖子作者、主评论、楼中楼、评论管理器/批量、点赞用户列表、作品级入口与恢复均有真实或明确 blocked 证据；不把未加载评论写成全量。
  - [ ] 知乎：作者、评论、搜索/列表入口和恢复先取得当前 DOM 捕获；缺少稳定样本时维持 blocked，不猜选择器。
  - [ ] 贴吧：旧版楼层、新版现代详情评论、楼中楼/批量与恢复分别核验；opaque 首页作者继续 blocked。
  - [ ] 抖音：作者/评论、评论管理器与批量、弹幕悬停/管理器、推荐流遮罩/切换与恢复分别核验；验证码或换片目标不稳定时如实 blocked；弹幕管理器关闭时正在进行的时间轴扫描必须同步取消，不得留下后台任务。
  - [ ] 每项证据附日期、脱敏页面形式、登录状态、确切结果和命令；所有受影响本地回归保持通过。
- evidence: `structure regression`：当前本地矩阵、`node test/work-block.cjs`、`node test/adapters.cjs`、`node test/quickblock.cjs`、`node test/danmaku-auto.cjs` 等通过；`real-site verified`：B站综合只读探针已覆盖评论/楼中楼、批量范围、弹幕工具/悬浮入口与恢复，微博登录态管理器/作品候选、知乎评论弹窗、贴吧现代详情/楼中楼/批量、抖音评论/弹幕管理器已取得部分闭环；其余范围按 CURRENT 逐项登记。X 明确排除。
- next: 继续用单标签补齐微博点赞列表、知乎作者/列表、贴吧旧版楼层和抖音推荐流换片；微博顶层 spacer、B站匿名根评论分页和抖音换片/归因性能保持 `blocked` 时不猜测扩展。任何新选择器仍须先捕获再实现，X 按用户要求排除。
- updated: 2026-09-05
- supersedes: none
- files: docs/maintenance/PLAN.md; docs/maintenance/CURRENT.md; README.md; test/real-*.cjs

### OB-RULE-001 — 自动规则正则安全边界

- status: proposed
- priority: P2
- scope: 自动弹幕正则的灾难性回溯风险识别、失败提示和热路径编译缓存。
- non-goals: 不删除用户规则；不改变关键词规则；不为规避风险而关闭自动屏蔽。
- dependencies: OB-CORE-001
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
