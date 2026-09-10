# OmniBlock 当前维护计划

更新时间：2026-09-10

本文件是 OmniBlock 唯一的活动计划：记录问题、范围、依赖、验收和下一步；当前事实放在
`CURRENT.md`，用户可见变化放在 README/版本 changelog，结束项移入历史索引。

## 使用契约

- 每项计划有稳定 `OB-*` ID；`status` 只能为 `proposed`、`approved`、`in_progress`、`verified`、`deferred`、`blocked` 或 `superseded`。
- `verified` 必须有可追溯证据，`blocked` 必须写原因和下一步；依赖引用本文件 ID 且不得成环。
- 接近 24 KiB 时先拆分职责并更新知识树，不能继续追加历史台账。

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
- scope: B站评论/弹幕、规则/人工审核和 OpenAI 兼容 loopback 网关。
- non-goals: 不改 V2、Key、UID、自动屏蔽或无结构证据的平台。
- dependencies: none
- acceptance: required
  - [x] AI 配置、loopback 脱敏出站、人工审核和既有矩阵已通过。
  - [ ] 商汤 provider、额度、fallback 和 cooldown 另行评估。
- evidence: `structure regression` 与既有 DeepSeek 证据见 `CURRENT.md`；未完成项保持 `blocked`。
- next: 另行评估商汤 provider；不影响本轮维护。
- updated: 2026-09-09
- supersedes: none

### OB-AI-002 — AI 多平台采集与一键网关启动

- status: blocked
- priority: P1
- scope: 保留 B站 AI；接入抖音当前页评论/弹幕和活动视频会话隔离；提供网关启动文件。
- non-goals: 不引入系统启动组件/私有接口；不自动展开/滚动；不改身份、审核、名单、V2 或发布边界。
- dependencies: OB-AI-001
- acceptance: required
  - [x] B站/抖音当前页采集、持久化隔离、启动文件和只读边界已有验证。
  - [ ] 抖音同 URL 换片后的新会话隔离需稳定真实样本。
- evidence: 详见 `CURRENT.md`；抖音同 URL 换片仍 `blocked`，匿名入口可能停在验证码中间页。
- next: 专用 Chrome 重放稳定换片并确认新会话隔离；不公开发布。
- updated: 2026-09-09
- supersedes: none

### OB-RULE-002 — 平台关键词屏蔽与评论 AI 建议提醒

- status: verified
- priority: P1
- scope: B站/抖音关键词标签与即时本地屏蔽；AI 排除关键词命中；评论增量；微博/知乎 AI 入口。
- non-goals: 不调用平台写入；不伪造身份；不为关键词消耗 token；不绕过 AI 人工审核；不改 80 条批次、身份键或平台选择器。
- dependencies: OB-AI-001
- acceptance: required
  - [x] 关键词优先、评论增量和微博/知乎 AI 入口回归及真站证据已记录。
- evidence: `structure regression` 与 `real-site verified` 详见 `CURRENT.md`/v0.51.0 条目。
- next: 保持候选，发布前另行复核差异、哈希和隐私门禁并取得发布授权。
- updated: 2026-09-09
- supersedes: none

### OB-AI-003 — B站新增内容的累计增量 AI 分析

- status: verified
- priority: P1
- scope: 首轮后新增评论、楼中楼和弹幕数据段触发稳定 ID 去重的有界增量；`analyzed` 显示页面累计数。
- non-goals: 不移除每批 80 条上限；不自动滚动/展开；不改 hash→UID、审核、关键词、身份或平台写入边界。
- dependencies: OB-RULE-002
- acceptance: required
  - [x] 评论/楼中楼/弹幕新增记录触发去重增量，`analyzed` 保持页面累计数。
- evidence: `structure regression` 与 2026-09-08 B站 `real-site verified` 数字详见 `CURRENT.md`；根评论分页仍 partial。
- next: 依赖结果已交给 OB-AI-004；不公开发布。
- updated: 2026-09-09
- supersedes: none

### OB-AI-004 — 可学习的 AI 提示词系统（v0.52.0）

- status: in_progress
- priority: P1
- scope: 提示词/反馈/偏好；审计六平台作者/作品/评论/弹幕/帖子，含抖音精选/搜索/主页、无身份样本。
- non-goals: 不自动转规则、微调或训练；不改关键词/审核/脱敏/网关；无内容路由不显示入口；不调用平台写入。
- dependencies: OB-AI-003
- acceptance: required
  - [x] schema、迁移、脱敏、预算通过。
  - [x] 反馈三态/理由、提示词、提案、离线评测通过。
  - [x] `structure regression`：微博/知乎/贴吧详情右下入口；知乎空评论宿主；微博/知乎无弹幕/关键词；贴吧主题帖/评论仅接受数字 Vue 身份或 `data-field`。
  - [x] `structure regression`：六平台读取/操作文案隔离 6/6；扩展窄 JSON 桥 7/7。
  - [x] `real-site verified`：2026-09-09 专用 Chrome 候选只读页读到 B站作品/评论/弹幕 `1/27/66`、微博内容/评论 `6/1+6`、知乎内容/回答 `12/3` 后展开评论 `10`、持久扩展贴吧主题帖/评论 `1/11`、抖音精选/主页作品 `45/1`；适用内容面板均挂载。
  - [ ] `blocked`：X 根入口为空壳无推文；抖音本轮未展开评论/弹幕；B站分页/动态 UID、微博 spacer、抖音换片和 DeepSeek 真实精度仍待补验。
- evidence: `structure regression`：覆盖/扩展7/7、提示词12/12、评测5/5、内容 AI12/12、AI screening19/19、适配器28/28、quickblock37/37、运行器20/20；`real-site verified`：2026-09-09 专用 Chrome 候选/持久扩展只读，未触发平台写入；`blocked`：X 空壳、抖音未展开。
- next: 抖音评论/弹幕与 X 样本；复核哈希/隐私/maintenance-check；未发布。
- plan: [详](plans/2026-09-08-ob-ai-004.md)
- updated: 2026-09-09
- supersedes: none

### OB-AI-009 — 提示词反馈样例与开发扩展桥协议修复

- status: verified
- priority: P1
- scope: 修复提示词系统输出的反馈样例与持久化开发扩展桥请求白名单不一致的问题；保留 `contentType` 作为 AI 内容形态上下文；让桥接拒绝、网关 HTTP、超时和桥状态错误在页面上可区分；补充带反馈样例的端到端开发扩展回归，并在用户授权的专用 Chrome 当前页面复验。
- non-goals: 不改 provider、模型路由、API Key、提示词隐私边界、80 条批次上限、关键词/人工审核/身份键或任何平台写入；不删除已有反馈或重置用户浏览器存储；不公开发布。
- dependencies: OB-AI-004
- acceptance: required
  - [x] `contentType` 反馈样例在主世界、隔离世界和 service worker 三层白名单中保持一致，并到达 loopback mock 网关。
  - [x] `request-not-allowed` 等桥接错误不再伪装成“AI 网关请求失败”；只有桥状态降级时才提示刷新扩展。
  - [x] 持久化开发扩展带含 `contentType` 的反馈样例分析成功，既有无反馈样例路径继续通过，页面/控制台错误为 0。
  - [x] `node --check`、受影响 AI/提示词/扩展回归、文档门禁和专用 Chrome 当前微博页真实只读验证均已按 `structure regression` 或 `real-site verified` 记录。
- evidence: `structure regression`：开发扩展7/7、内容 AI12/12、screening18/18、提示词12/12、评测5/5、多平台7/7；三层白名单与拒绝路径通过。`real-site verified`：2026-09-09 专用 Chrome 微博页 bridge ready，分析6/6、HTTP 200、无 lastError；未执行平台写入。
- next: 源码已随 v0.52.0 推送；若要创建 tag/Release，另行复核最终差异、源码哈希、隐私门禁和对应授权；DeepSeek 真实语义精度继续由独立评测衡量。
- updated: 2026-09-09
- supersedes: none

### OB-AI-010 — AI 审核负向反馈可撤销切换

- status: verified
- priority: P1
- scope: 审核弹窗「不屏蔽」按钮；负向反馈精确删除、候选重新可选、再次记录，以及持久化开发扩展刷新后的状态读回。
- non-goals: 不写入主屏蔽名单；不改平台写入、提示词隐私、批次上限或 AI 判定。
- dependencies: OB-AI-009
- acceptance: required
  - [x] 首次点击仍记录 `ai_rejected` 负反馈且按钮保持可点击的灰态。
  - [x] 再次点击删除对应反馈、恢复可靠身份候选的勾选能力；第三次点击可重新记录。
  - [x] 新记录经持久化开发扩展保存后，刷新页面仍能恢复灰态反馈并允许撤销。
  - [x] 夹具回归和专用 Chrome 当前审核弹窗验证通过，未执行平台写入。
- evidence: `structure regression`：AI screening 19/19、持久化开发扩展 8/8，无页面/控制台错误；`real-site verified`：2026-09-09 专用 Chrome 当前微博审核弹窗完成负反馈四步切换，并验证新记录刷新后恢复灰态、再次撤销，最终反馈 0、候选可选、bridge ready。
- next: 已随 v0.52.0 源码推送并创建匹配的 tag/Release；DeepSeek 真实语义准确率和后续提示词迭代仍按新计划处理。
- updated: 2026-09-09
- supersedes: none

### OB-AI-011 — 事实核查状态与屏蔽决策分离

- status: verified
- priority: P1
- scope: AI 提示词和响应解析；区分规则违规、事实性主张、观点与“未核查/语境不足”；默认不因缺少引用或模型未查证而生成屏蔽候选，并在状态/审核说明中保留延后计数。
- non-goals: 不把平台正文发往公共搜索；不新增隐私扩展权限或非 loopback 通道；不把模型臆测当外部证据；不改关键词优先级、身份键、人工确认、80 条批次或平台写入边界。
- dependencies: OB-AI-004, OB-AI-009, OB-AI-010
- acceptance: required
  - [x] 提示词明确“缺少来源不等于虚假”，要求返回 `claimType`、`verificationStatus`、`verificationMethod` 和 `ruleMatched`。
  - [x] 客户端拒绝仅凭 `unverified/not_checked/insufficient_context` 的事实性屏蔽候选；兼容旧响应中的“未经证实/无可核实依据”误判。
  - [x] 规则性攻击、广告等非事实性违规仍能进入人工审核；未核查数量在 AI 状态和审核说明中可见，不写入名单。
  - [x] 人工合成回归覆盖“真实/未核查短句不误杀、明确违规仍候选、无身份仍不可执行”，专用 Chrome 当前页面复验。
- evidence: `structure regression` 与 `real-site verified` 详见 `CURRENT.md` 和 `docs/changelog/v0.53.0.md`；`blocked` 仅表示当前网关尚未接入外部检索，不是事实判断通过。
- next: 保持 0.53.0 已发布；若接入检索，另立计划并先评审来源、隐私、缓存、回退和成本。
- updated: 2026-09-09
- supersedes: none

### OB-AI-012 — B站 AI 确认后的后台任务闭环

- status: verified
- priority: P1
- scope: 即时生效、后台状态/撤销、会话隔离、UID 缓存和失败退避。
- non-goals: 不改 AI 判定/提示词、检索、平台写入、身份键和确认门槛。
- dependencies: OB-AI-001, OB-AI-003, OB-AI-011
- acceptance: required
  - [x] 即时关闭/基础写入/状态/撤销及 hidden、路由、停用隔离通过。
  - [x] 缓存、退避、矩阵、文档门禁和两次 B站探针通过。
- evidence: 矩阵与 2026-09-10 B站两探针；阻断项见 CURRENT。详见[实施说明](plans/2026-09-10-ob-ai-012.md)。
- next: 发布链完成；OB-AI-013 仅规划，等待确认。
- updated: 2026-09-10
- supersedes: none

### OB-AI-013 — 独立 AI 评测集与事实检索部署方案

- status: in_progress
- priority: P1
- scope: 评测、门禁、灰度、回滚。
- non-goals: 不接公共搜索/自动屏蔽；不放宽身份边界。
- dependencies: OB-AI-011, OB-AI-012
- acceptance: required
  - [x] 协议、门槛、allowlist、rollout 固化。
  - [x] 离线评测、broker、shadow/canary 回归通过。
  - [ ] 真实来源/精度观察；无来源 blocked。
- evidence: `structure regression`：24例评测/broker/AI；`blocked`：真实来源/精度未配置。见[方案](plans/2026-09-10-ob-ai-013.md)。
- next: 等真实来源/模型条件，完成精度/成本门禁。
- updated: 2026-09-10
- supersedes: none

### OB-VALID-001 — 专用登录态探针与开发扩展同步

- status: verified
- priority: P1
- scope: 修复隔离/专用 Chrome 验证分流；专用 profile 只读探针覆盖版本、桥接、入口和 AI 读取计数，扩展同步后可刷新旧构建。
- non-goals: 不读取凭证/Cookie/私有接口，不触发平台写入，不规避验证码/限流，不改 `.env`、凭据、选择器或既有发布物。
- dependencies: OB-COVERAGE-001, OB-AI-009, OB-AI-010
- acceptance: required
  - [x] `maintenance-check` 保留隔离探针；`--dedicated-only` 先同步扩展再读专用 profile，`--dedicated` 另保留匿名对照。
  - [x] 探针优先读取现有页，必要时创建/关闭临时页；输出脱敏路由、计数和 `real-site verified`/`blocked`。
  - [x] `dev-browser sync` 核对版本/桥接并刷新旧扩展；未就绪不能报告 ready。
  - [x] 人工合成分类回归 8/8 通过；不读取登录态、不注入源码、不触发平台写入。
  - [x] 2026-09-09 专用 Chrome 只读复验六平台：B站8条作品、抖音46条作品、微博6条帖子、知乎5条回答、贴吧1主题+2评论；X 当前为空壳，明确记 `blocked`。
- evidence: `structure regression`：分类6/6及维护矩阵通过；`real-site verified`：2026-09-09 专用 Chrome 读到五个平台记录且 bridge ready；`blocked`：X 空壳、B站/抖音详情目标不稳定。
- next: 取得当轮授权后用 `node test/maintenance-check.cjs --dedicated-only`，匿名对照再用 `--dedicated`。
- updated: 2026-09-09
- supersedes: none

### OB-AI-005 — DeepSeek Flash 网关型号刷新（本机运行时）

- status: verified
- priority: P1
- dependencies: OB-AI-001
- scope: 本机 LiteLLM provider 切换至用户提供的内测型号 `deepseek-v4.1-flash-expires-on-0910`；保持 `omni-default`、官方地址、thinking、重试/限流和 API Key 不变。
- non-goals: 不改 `.env`/凭据、userscript、提示词/审核/身份/平台/版本；不测试视觉输入，不公开发布。
- acceptance: required
  - [x] 官方 `GET /models` 脱敏查询完成；公开列表未列出内测 ID，随后按用户提供的精确 ID 做直连路由验证。
  - [x] manifest 保持别名、地址和 primary 边界，health 与 loopback 窄 JSON 请求均通过。
  - [x] gateway smoke、语法、文档和差异门禁通过。
- evidence: `structure regression`：本机 manifest/health、gateway smoke、经目标 ID 路由的合成 HTTP 200；公开目录未列出内测 ID。
- next: 到期复核；精度另建人工标注评测。
- updated: 2026-09-08
- supersedes: none
- files: `gateway/runtime/*`（Git 忽略）；详见 `CURRENT.md`

### OB-WEIBO-003 — 详情页作品级评论统计作用域

- status: in_progress
- priority: P1
- scope: 微博详情页作品级读取与屏蔽作用域；纳入同级评论虚拟列表，按有限分段保留规范化记录；取消/关闭时中止扫描、恢复滚动和焦点；虚拟行回收时重判视口内容；保持作者、主评论、子评论归属与补位逻辑不变。
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
- evidence: `structure regression`：quickblock36/36，新增报告/布局/子评论菜单断言通过，举报安全边界保持。`real-site verified`：2026-09-05 专用 Chrome 与 B站只读探针通过；`blocked`：部分旧候选扩展刷新受 Chrome 策略阻断。详见 CURRENT，X 不在本项范围。
- next: 用单标签补齐微博点赞列表、知乎作者/列表、贴吧旧版楼层和抖音推荐流换片；微博顶层 spacer、B站匿名根评论分页和抖音换片/归因性能保持 `blocked` 时不猜测扩展。任何新选择器仍须先捕获再实现，X 按用户要求排除。
- updated: 2026-09-05
- supersedes: none

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
- evidence: `structure regression`：性能边界8/8；2026-09-04 抖音只读详情页弹幕/评论隐藏恢复、稳定性采样通过。renderer/page 指标不等于插件独占 CPU；换片目标不稳定，按 `blocked` 记录。
- next: 保留播放/暂停数据作为当前候选的页面总量基线；取得稳定换片目标后再补采切换窗口。只有在获得可归因插件指标后，才考虑深扫描时间片或进一步缓存优化；若入口再次验证码阻断，维持 `blocked`。
- updated: 2026-09-04
- supersedes: none

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
- scope: 本地命令、CI status、源码/构建 hash、版本/tag/Release 一致性。
- non-goals: 未获当轮授权不改 CI、push、覆盖 tag 或公开发布。
- dependencies: OB-PERF-001
- acceptance: required
  - [ ] 获得 CI/CD 配置修改授权后，CI 可运行不依赖维护者机器上的隐含路径或未锁定依赖。
  - [x] 候选说明分别列出 real-site verified、structure regression 和 blocked。
  - [x] Release 门禁只接受明确授权和可追溯的构建产物。
- evidence: 本地矩阵、源码 hash 和发布边界已落地；CI/CD 尚未改动。
- next: 取得授权后再新增最小工作流；push/tag/Release 按当轮授权。
- updated: 2026-08-30
- supersedes: none

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
