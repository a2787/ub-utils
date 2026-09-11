# OmniBlock 当前维护计划

更新时间：2026-09-11

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

### OB-EXT-001 — 统一 MV3 扩展、API 直连与账户级加密同步

- status: superseded
- priority: P1
- scope: 在保留 userscript 兼容发行物的同时，生成同一版本的正式 Manifest V3 扩展，兼容桌面 Chrome/Edge 与实际支持扩展的平板 Edge；将现有 GM 存储/网络桥提升为产品运行时；AI 保留本机 loopback 网关和设备/API 直连两种模式；新增独立于 V2/KB 的账户登录、端到端加密同步协议、客户端、冲突合并和本地 mock 服务。
- non-goals: 不加入本地模型；不把 LiteLLM/Docker 嵌入扩展；不把 API Key 打包进扩展或同步到服务器；不自动执行平台举报、官方拉黑、关注或发帖；不立即替换电脑上的 Tampermonkey 安装；不共享 V2/KB 数据库；不在未完成真实设备验证前宣称平板支持；不在未取得动作级确认前修改东京服务器 DB schema、凭据、系统配置或部署。
- dependencies: OB-AI-001, OB-AI-004
- acceptance: required
  - [x] 同一源码版本可生成 userscript 与正式 MV3 扩展；扩展不依赖 Tampermonkey，桌面和平板使用同一构建号（平板实际安装仍待验证）。
  - [x] 扩展版本地名单、规则、反馈和设置可持久化；支持从 userscript 导出的 JSON 预览、校验、导入和回滚。
  - [x] AI 运行方式明确区分本机 loopback 网关与设备直连 provider；直连 Key 仅设备本地保存，service worker 发起请求，页面和同步包均不可见。
  - [x] 账户同步采用客户端加密文档、服务端 CAS revision、设备逻辑时钟和带墓碑的确定性合并；服务端只保存密文和最小认证/版本元数据。
  - [x] 本地 mock server 覆盖注册/登录、401、revision 冲突、密文不透明存储、离线重试和客户端合并；独立 Python 服务也通过本地 health/auth/CAS 回归。
  - [ ] 桌面与目标平板实际页面分别取得 `real-site verified`；本地夹具只记 `structure regression`，安装/登录/验证码/设备 API 不可用记 `blocked`。
  - [ ] 线上 sync server 的 schema/凭据/部署/切换在独立动作确认后再执行，并完成同一密文 artifact 的只读健康和同步读回。
- evidence: `structure regression`：product 3/3、dev 11/11、sync mock 7/7、Python 服务 5 项及既有 AI/平台回归；`blocked`：平板扩展安装、真实 provider、东京线上服务未验证/部署。
- next: 用户已确认平板 Edge 以 Tampermonkey 为唯一安装入口；本项停止作为交付主线。现有 `extension/`、`dist/` 相关构建代码保留在未提交工作区，待后续明确确认后再决定是否清理或复用。
- updated: 2026-09-11
- supersedes: none

### OB-TM-001 — Tampermonkey 移动端适配、API 直连与账户级加密同步

- status: in_progress
- priority: P1
- scope: 保持 `omniblock.user.js` 为桌面与平板的共同交付物；优化窄屏/触控设置、内容入口、审核浮层和输入控件；AI 只保留用户直接填写的 OpenAI-compatible API 地址、模型名和设备本地 API Key；在 userscript 内提供账户注册/登录、客户端加密同步和显式“立即同步（合并）”入口，复用独立同步服务协议。
- non-goals: 不继续建设或发布 MV3 安装路径；不保留 AI 主链路的 loopback 网关模式；不加入本地模型；不把 API Key、账户密码、访问令牌或同步口令放入普通设置、导出文件或云端文档；不自动同步、不执行平台举报/官方拉黑/关注/发帖；不修改东京服务器 schema、凭据、HTTPS 反向代理或部署；不删除上一项留下的实验文件。
- dependencies: OB-AI-001, OB-AI-004
- acceptance: required
  - [x] userscript 的 AI 配置只显示 API 地址、模型名和“设置/更换本机 Key”，旧 gateway 配置不会再触发网关请求；Key 只写入独立 GM 存储，并且不出现在名单导出、提示词导出、同步 state、日志或请求正文。
  - [x] userscript 在普通 Tampermonkey 运行时可以使用 GM 跨源请求直接调用已配置 provider；无 Key、无效 URL、网络错误和 HTTP 错误均给出可理解的失败状态，且不把 Key 写入页面对象。
  - [x] 390px、768px 和触控夹具验证：入口不遮挡安全区，主要按钮/关闭按钮可触控，设置面板不横向溢出，AI 配置和同步表单可滚动/提交；真实平板安装未观察到前只记 `blocked`。
  - [x] userscript 同步客户端复用 `sync/sync-core.js` 的 envelope/CAS/逻辑时钟/墓碑协议；账户密码和同步口令只在按钮调用期间留在内存，token/device id/本地文档单独保存；409 与离线重试可恢复，远端密文可在第二设备解密并合并。
  - [x] 本地 mock、独立 Python 服务、AI/平台/通用回归和文档/隐私门禁通过；未执行平台写入。
  - [ ] 目标平板实际 Tampermonkey 安装、AI provider 和东京线上同步服务分别取得 `real-site verified`，无法取得时明确记录 `blocked`，不以本地夹具替代。
- evidence: `structure regression`：userscript product 4/4；同步核心 7/7；Python 服务 5/5；通用 20/20、状态 9/9、B站 38/38、自动弹幕 7/7、评论管理器 3/3、作品级 3/3、性能 8/8、适配器 28/28、内容 AI 11/11、内容覆盖 6/6；AI screening、平台/提示词/批次/自动加载/watchdog/事实核查均通过且页面/控制台错误为 0。维护总检本地项通过。
- evidence: `real-site verified`：2026-09-11 匿名隔离只读会话中的 B站当前候选加载和微博当前候选加载已记录在 `CURRENT.md`；`blocked`：目标平板 Tampermonkey 实际安装、真实 provider、东京线上 endpoint，以及抖音验证码/微博活动 spacer 等外部条件未验证。线上服务仍保持未部署。
- next: 用户在电脑和目标平板 Edge 的 Tampermonkey 中安装同一候选，分别配置本机 Key；随后做只读页面/触控检查，并在已准备 HTTPS 同步 endpoint 后验证同账户显式合并。未取得设备/线上条件前不把本地夹具升级为 `real-site verified`。
- updated: 2026-09-11
- supersedes: OB-EXT-001

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

### OB-AI-004 — 可学习的 AI 提示词系统（v0.52.0）

- status: in_progress
- priority: P1
- scope: 提示词/反馈/偏好；审计六平台作者/作品/评论/弹幕/帖子，含抖音精选/搜索/主页、无身份样本。
- non-goals: 不自动转规则、微调或训练；不改关键词/审核/脱敏/网关；无内容路由不显示入口；不调用平台写入。
- dependencies: OB-AI-001
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

### OB-AI-013 — 独立 AI 评测集与事实检索部署方案

- status: in_progress
- priority: P1
- scope: 评测、门禁、灰度、回滚。
- non-goals: 不接公共搜索/自动屏蔽；不放宽身份边界。
- dependencies: OB-AI-001, OB-AI-004
- acceptance: required
  - [x] 协议、门槛、allowlist、rollout 固化。
  - [x] 离线评测、broker、shadow/canary 回归通过。
  - [ ] 真实来源/精度观察；无来源 blocked。
- evidence: `structure regression`：24例评测/broker/AI；`blocked`：真实来源/精度未配置。见[方案](plans/2026-09-10-ob-ai-013.md)。
- next: 等真实来源/模型条件，完成精度/成本门禁。
- updated: 2026-09-10
- supersedes: none

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
