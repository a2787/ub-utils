# 2026-10-27 计划收尾归档：已关闭 verified 项原文

归档时间：2026-10-27（首批四项）；2026-10-27 追加四项（OB-AI-015、OB-RULE-003、OB-AI-016、OB-UI-001，
随 v0.58.0~v0.61.0 落地后移出活动正文）。各对应事实已回写 `docs/maintenance/CURRENT.md` 与版本 changelog。
本文件是只读归档，不追加当前状态；需要追溯验收证据与残留边界时读取。

---

### OB-RULE-001 — 自动规则正则安全边界

- status: verified
- priority: P2
- scope: 自动弹幕正则的灾难性回溯风险识别、失败提示和热路径编译缓存。
- non-goals: 不删除用户规则；不改变关键词规则；不为规避风险而关闭自动屏蔽；不做完备的正则安全性分析，只拒绝明显危险形态。
- dependencies: none
- acceptance: required
  - [x] 明显高风险表达式在保存前被拒绝并给出可理解原因。
  - [x] 合法表达式只编译一次，匹配过程不重复构造 RegExp。
  - [x] B站/抖音自动弹幕本地夹具和已授权真实页面只读探针保持通过。
- evidence: `structure regression`：`node test/danmaku-auto.cjs` 8/8；新增 AUTO-REGEX-SAFETY 在旧行为上失败后转通过：`(a+)+$`、`(a|aa)+` 被拒且原因含"回溯"，`(\w+\.)*example\.com`、`(cat|dog)+` 正常保存，直接写入的已存风险规则仍参与匹配（不回删），一个规则世代 51 次匹配只编译一次。quickblock 38/38、适配器 28/28、通用 20/20 通过。随 v0.57.2 发布。
- next: 已完成并随 v0.57.2 发布；更隐蔽的回溯形态（如 `(\w+\w)*`）未被拦截，如需更严判定另立计划评估误伤面。
- updated: 2026-09-12
- supersedes: none

### OB-REL-001 — CI 与公开发布准备

- status: verified
- priority: P3
- scope: 本地命令、CI status、源码/构建 hash、版本/tag/Release 一致性。
- non-goals: 真实站点探针不进 CI；未获当轮授权不改 push 策略或覆盖 tag。
- dependencies: none
- acceptance: required
  - [x] 获得 CI/CD 配置修改授权后，CI 可运行不依赖维护者机器上的隐含路径或未锁定依赖。
  - [x] 候选说明分别列出 real-site verified、structure regression 和 blocked。
  - [x] Release 门禁只接受明确授权和可追溯的构建产物。
- evidence: `.github/workflows/maintenance.yml`（ubuntu-latest + 系统 Chrome，`npm ci` 锁定 playwright-core 1.62.1，22 项本地回归 + 语法/文档门禁；真实站点探针明确排除）。CI 迭代三次转绿（run 34628105864，commit `dce2810`）：修 checkout 浅克隆导致快照祖先校验失败、work-block 微博方向键未落定采样、adapters 弹幕按钮 3px 对中在 Linux 字体度量下误报；三项都属测试/工作流脆弱性，不涉及产品行为。push 走 SSH（OAuth token 缺 workflow scope）。
- next: 已完成。CI 随每次 push/PR 自动运行；公开发布仍按当轮授权执行。
- updated: 2026-09-12
- supersedes: none
- updated: 2026-09-12
- supersedes: none

### OB-CTX-001 — 撤销接管右键的本地拉黑菜单

- status: verified
- priority: P1
- scope: 移除 userscript 中"命中条目时接管页面右键、弹出自建「🚫 拉黑此用户」菜单"的整套实现：`document` 级 `contextmenu` 捕获监听、`buildContextMenu`、只为该监听服务的 `findItem` 沿 `composedPath` 命中逻辑，以及 `#ob-ctx` 样式与相关提示文案；右键交还页面与平台原生菜单。
- non-goals: 不删除本地名单、确认气泡、撤销 toast、平台原生菜单旁的「本地拉黑」快捷入口、B站弹幕工具、批量/作品级屏蔽或任何存储格式；不新增替代手势或新入口；不改动身份键规范与平台写入红线。
- dependencies: none
- acceptance: required
  - [x] 任意平台条目（含 Shadow DOM 内的 B站评论）上派发 `contextmenu` 不再 `preventDefault`，也不再出现 `#ob-ctx`。
  - [x] 本地拉黑全流程仍可用：从平台原生菜单旁的快捷入口进入确认气泡、写入本地名单、条目隐藏并可撤销。
  - [x] `findItem`/`buildContextMenu`/`#ob-ctx` 在源码、样式与文档中无残留引用。
  - [x] `node test/run.cjs` 20/20、`node test/adapters.cjs` 28/28、`node test/quickblock.cjs` 38/38、`node test/userscript-product.cjs` 7/7，页面/控制台错误为 0。
  - [x] `node test/docs-check.cjs` 与 `git diff --check` 通过——曾因 2026-09-13 `.git` 对象库丢失事故阻断，重建后已补跑通过。
- evidence: `structure regression`：`test/run.cjs` C 用例改为"右键既不 `preventDefault` 也不出现 `#ob-ctx`，身份仍解析为 `bili:uid:333`"，在旧源码上以 `{"defaultPrevented":true,"ctxShown":true}` 失败、删除实现后转通过；`test/adapters.cjs` 的贴吧嵌套正文目标与 B站 Shadow DOM 两处右键用例同样在旧源码上以 `defaultPrevented:true` 失败后转通过，六平台其余 26 项保持通过；`run.cjs` D 用例（原生菜单快捷入口 → 确认 → `bili:uid:333` 入库并隐藏）证明拉黑链路未受影响；与 CI 同一组本地矩阵 21/22 脚本退出 0；`node --check`、`docs-check`、`git diff --check` 通过。`real-site verified`：2026-09-13 用户授权恢复实页验证，隔离匿名探针在脱敏 `bilibili.com/video/...` 页面命中 2 个评论 renderer 并派发 2 次右键（`prevented=0`、`menu=0`），在脱敏 `weibo.com/...` 页面派发 7 次右键（`prevented=0`、`menu=0`）；专用登录态 Chrome 在知乎、抖音、X 上确认当前扩展版本/build 活跃且右键保持原生。`blocked`：贴吧因 CDP 驱动下渲染进程卡死，无法读取右键状态；本轮没有把 body 或空页面当成条目证据。`structure regression`：`ai-screening` 25/25 断言通过，预期 AI-24 429 mock console error 单独归档，未知 console/page error 仍使退出失败。
- next: 已完成并随 v0.57.4 发布；功能提交为 `b83003a56b901796cacf25da369dc6642bca4428`，tag/Release 已创建。页面单独验证仍按本条 evidence 中的 `blocked` 边界保留。
- updated: 2026-09-13
- supersedes: none

### OB-MAINT-002 — 接手审计、探针判据与活动文档一致性

- status: verified
- priority: P2
- scope: 审计最近维护对话、当前 Git/工作区和 v0.57.4 交接；修复真实右键探针的目标命中、`preventDefault`、build 版本和失败退出判据；将 AI screening 的预期 429 mock console error 与未知错误分开；同步活动文档、版本索引和临时调试产物规则。
- non-goals: 不改变 `omniblock.user.js` 行为；不触碰平台写入；不执行本轮未授权的登录态验证；不删除上一轮调试文件，不修改 `.env`、凭据、存储格式或数据库。
- dependencies: OB-CTX-001
- acceptance: required
  - [x] 探针没有命中真实条目、读不到事件状态、版本/build 不匹配或检测到右键接管时，不得给出 verified；专用右键探针对失败平台返回非零退出码，通用平台探针由 `maintenance-check` 解析为 `blocked` 或失败。
  - [x] 当前公开版本、东京同步服务状态和右键证据在 README、CHANGELOG、知识树、CURRENT、PLAN 中一致。
  - [x] 忽略规则覆盖本轮临时导航调试脚本，但不吞掉可交付探针；AI screening 只归档预期 429，未知 console/page error 仍失败；脚本语法、聚焦回归、文档/隐私门禁通过。
- evidence: `structure regression`：`node test/dedicated-rightclick-probe.cjs --self-test`、`node test/dedicated-browser-probe.cjs --self-test` 分别通过 5/5 与 8/8 分类断言；userscript、探针脚本语法检查通过；`node test/ai-screening.cjs` 25/25 且退出 0，预期 429 单独归档；`node test/maintenance-check.cjs` 的本地矩阵全部通过，最终只保留预期的外部 `blocked` 分类；`node test/dev-browser.cjs sync` 能通过 `/json/list` 找到扩展页并完成刷新路径，bridge 仍如实报告 `degraded/ready-timeout`。`real-site verified`：2026-09-13 隔离匿名 B站脱敏视频页命中 2 个评论 renderer 并派发 2 次右键（`prevented=0`、`menu=0`）；微博脱敏详情页派发 7 次右键（`prevented=0`、`menu=0`）。同日此前获得用户授权的专用登录态 Chrome 记录了知乎、抖音、X 的当前 build 活跃且 `ctxShown=false`、`ctxDefaultPrevented=false`。`blocked`：匿名抖音验证码中间页、微博该页无可测顶层 spacer、贴吧专用 CDP 渲染进程卡死；这些阻断均未被探针升级为 verified。活动文档、版本索引、东京服务状态和隐私门禁已同步。
- next: 维护审计与 v0.57.4 push/tag/Release 已完成；贴吧右键证据待用户未来单独授权登录态验证或改用人工浏览器确认，专用 bridge 的唤醒/attach 重试另立专项。
- updated: 2026-09-13
- supersedes: none

---

## 2026-10-27 第二批：随 v0.58.0~v0.61.0 落地后移出活动正文的 verified 项

### OB-AI-015 — AI 自动分析独立开关与成本可见性

- status: verified
- priority: P1
- scope: 新增独立设置 `aiAutoAnalyze`（默认 `false`）：`aiEnabled` 只表示允许使用 AI（手动分析、审核、提示词）；自动分析的全部触发点（`start()` 末尾的 `scheduleAuto(1400)`、路由变化、DOM 新评论/弹幕、seg.so 内容信号、页面重新可见与 `noteAutoContentChanged`）必须同时满足 `aiEnabled && aiAutoAnalyze`。手动「分析本页」不再强制填写"本页面附加规则"，页规则改为可选增强。自动模式的候选不再自动弹窗，等在屏幕右侧「AI 待审建议」浮条（`#ob-ai-pending`），点击才进入同一套多选审核。AI 面板新增本地成本计数（本次页面会话与当日累计的批次数/记录数/发送字符数，独立 GM 键 `omniblock:ai-usage:v1`，纯本地统计，不含正文与身份键，不入同步/导出）与"本地名单/关键词已先行处理 N 条"提示；自动关闭时状态栏明示"AI 仅在手动点击时请求"。
- non-goals: 不改 AI 请求协议、批量常量与脱敏边界；不实现持久缓存（见 OB-AI-016）；不改变事实核查默认关闭；不动审核确认与后台 UID 增强链路；不执行平台写入。
- dependencies: none
- acceptance: required
  - [x] 默认设置下夹具页面加载与等待期间触发 0 次 provider 请求（`test/ai-auto-gate.cjs` AUTO-GATE-1；旧源码在 `start()` 固定 `scheduleAuto(1400)`，该断言对应旧行为必然失败，旧版实跑被写入保护钩子拒绝，已按源码路径推理记录）。
  - [x] 两个开关同时开启时现有自动分析行为保持（AUTO-GATE-3 与 ai-screening/ai-platforms/content-ai 等既有自动路径测试全绿）。
  - [x] 手动分析在未填写页面附加规则时可运行（AUTO-GATE-2；两者皆空时提示"尚未设置 AI 规则"）。
  - [x] 用量计数与 mock 收到的请求数一致并持久化，不含正文或身份键（AUTO-GATE-4）。
  - [x] `node --check omniblock.user.js`、`test/run.cjs` 20/20、`test/ai-screening.cjs` 25/25、`test/content-ai.cjs` 12/12、docs-check 与隐私门禁通过。
- evidence: `structure regression`：新增 `test/ai-auto-gate.cjs` 5 项全绿；ai-screening 25/25、content-ai 12/12、ai-platforms 7/7、ai-prompt-system 13/13、ai-prompt-eval 5/5、ai-fact-integration 4/4、content-coverage 6/6、ai-batch 2/2、ai-autoload 3/3、ai-bridge、ai-watchdog、ai-context、run 20/20、quickblock 38/38、danmaku-auto 8/8、userscript-product 7/7，页面/控制台错误 0。依赖自动分析路径的既有测试 shim 显式加 `aiAutoAnalyze: true`。随 v0.58.0 本地候选交付（未 push/tag/Release）。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）。
- next: 已实现并随 v0.58.0 候选交付；真实站点验证待用户恢复授权后补齐。后续省钱项在 OB-AI-016（跨会话缓存与批量上限）。
- updated: 2026-10-27
- supersedes: none

### OB-RULE-003 — 关键词/正则规则管理升级

- status: verified
- priority: P1
- scope: `DanmakuRules` 与关键词面板（`mountKeywordControls`）升级：规则就地编辑（新增 update 路径，不靠删除重建）；每条规则可选备注；每条规则持久命中计数（本地保存、随规则删除清理、可清零）；规则独立导入/导出（JSON，去重、上限与 `assessDanmakuRegexRisk` 安全校验复用）；规则可选跨平台作用域（同一条规则同时作用于 B站与抖音，旧数据按原平台继续生效）；删除设置面板中已失去挂载点的死代码（`refreshAutoRules`、`.ob-auto-platform` 处理器）；修正弹幕管理器中"请在设置中停用或删除规则""可在设置中恢复规则作用"等指向失效的文案；在设置面板提供关键词管理可达入口，非统一内容弹窗平台也能打开。
- non-goals: 不扩大关键词匹配的平台范围（仍 B站/抖音；其他平台需先真站捕获结构）；不引入本地"允许关键词"负向规则；不改身份键规范与"身份可靠才写入名单"前提；不改关键词命中自动写入本地名单的语义。
- dependencies: none
- acceptance: required
  - [x] 编辑规则不需删除重建，编辑后匹配即时生效（`test/rule-manager.cjs` RULE-EDIT；旧源码无 update API，断言失败）。
  - [x] 命中计数跨会话持久，删除规则时一并清理（RULE-HITS；独立 GM 键 `omniblock:rule-hits:v1`，延迟落盘不经 Store 级联）。
  - [x] 规则导入/导出往返一致；超限、重复、危险正则被拒并给可理解原因（RULE-IO；`assessDanmakuRegexRisk` 复用）。
  - [x] 跨平台规则在两平台各自生效；无作用域字段的旧规则按原平台生效（RULE-SCOPE）。
  - [x] 源码与文案中无失效的"请在设置中…"规则指引；`refreshAutoRules`/`autoStatusText`/旧处理器已删除（源码断言）；`test/danmaku-auto.cjs` 8/8、`test/quickblock.cjs` 38/38、`test/adapters.cjs` 28/28、`test/run.cjs` 20/20、docs-check 通过。
- evidence: `structure regression`：新增 `test/rule-manager.cjs` 5/5 全绿；danmaku-auto 8/8、quickblock 38/38、run 20/20、userscript-product 7/7、content-ai 12/12、adapters 28/28、ai-screening 25/25 等全量矩阵通过，页面/控制台错误 0；`node --check`、docs-check、隐私门禁通过。已随 v0.59.0 公开发布（tag/Release/raw 已核对）。`blocked`：真实站点验证未执行（实页验证暂停中）。
- next: 已实现并随 v0.59.0 候选交付；真实站点验证待用户恢复授权后补齐。命中计数为匹配事件次数（不去重），已知限制记录在版本条目。
- updated: 2026-10-27
- supersedes: none

### OB-AI-016 — 已分析记录持久缓存与自动批量上限

- status: verified
- priority: P2
- scope: 为自动分析增加跨页面/会话的已分析缓存：以现有稳定记录签名为键，只存签名、时间与决策元数据（不存正文、昵称或身份键），LRU + TTL + 容量上限，规则或提示词签名变化时整体失效；自动模式设每页发送批量数上限，超出部分提示手动续跑；提供"自动模式只分析评论、弹幕仅手动"可选开关。
- non-goals: 不改变手动分析行为；不把缓存结果冒充新的 AI 决策；缓存不进入账户同步；不新增任何上传。
- dependencies: OB-AI-015
- acceptance: required
  - [x] 同一记录签名在 TTL 内重访不重复产生 provider 请求（mock 断言）。
  - [x] 规则/提示词变更后缓存失效并重新分析。
  - [x] 缓存内容仅含签名与决策元数据，隐私门禁通过。
  - [x] 批量上限触发时用户可见提示，手动路径不受限。
- evidence: `structure regression`：`test/ai-auto-gate.cjs` 11/11（新增 CACHE-1 跨 reload 0 重复请求 + 缓存键只含 `ai-item-` ID 与时间戳的结构/隐私校验、CACHE-INV-1 提示词变更使缓存失效后重发、CAP-1 260 条只发 3 批 + `autoCappedRemaining=20` + 状态行提示 + 手动 4 批补齐、ONLY-COMMENTS-1 请求项 0 弹幕；GM shim 修复为 localStorage 后备）；ai-screening 25/25（同页增量不受影响）、content-ai 12/12、ai-platforms 7/7、ai-prompt-system 13/13、ai-autoload 3/3、run 20/20、quickblock 38/38、userscript-product 7/7，页面/控制台错误 0；`node --check`、docs-check、隐私门禁通过。缓存键 `omniblock:ai-analyzed:v1`（TTL 7 天 / LRU 2000 / 2s 防抖 + pagehide 冲刷），generation 覆盖规则文本 + `PromptSystem.signature()` + provider 地址 + 模型。随 v0.61.0 本地候选交付，发布由编排方执行。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）。
- next: 已实现并随 v0.61.0 候选交付；实页验证（重访 0 重复请求、上限提示在长评论区的触发）待用户恢复授权后补齐。
- updated: 2026-10-27
- supersedes: none

### OB-UI-001 — 设置面板信息架构与操作一致性

- status: verified
- priority: P2
- scope: 设置面板（`openOptions`）信息架构重构：按"屏蔽与名单 / 规则 / 备份与同步 / 更新与关于 / 日志诊断"分组导航，核心操作前置、日志诊断后置，支持分节跳转；名单（点击删除）增加搜索与筛选（按平台、关键词过滤，不区分大小写）与"显示 X / 共 Y"计数行，空结果给出可读空态；撤销 toast 固定 5 秒加长为可配置（`undoToastSeconds`，默认 10 秒、收敛 5–30），并在面板提供"最近本地屏蔽操作"撤销列表（`RecentActions` 模块，独立 GM 键 `omniblock:recent-actions:v1`，环 20 条，只存时间/类型/计数/短标签/身份键，不含正文，不入同步/导出/备份）；退出同步账户、清空日志、恢复快照、导入失败提示统一为自建确认浮层 `showOBConfirm`（AI API Key 输入保留原生 prompt 并注释原因）；清理指向失效的提示文案。
- non-goals: 不改存储格式与同步协议（`omniblock:data:v1` schema 不变；recent-actions 是独立键）；不动平台适配与屏蔽执行链；平台级主开关（用户 2026-10-27 否决）、全局快捷键（用户否决，平板仍在用）、新手引导（用户否决，自用工具）不做；深色模式在 OB-UI-003。
- dependencies: none
- acceptance: required
  - [x] 设置面板分组可导航（顶部 5 个锚点按钮 scrollIntoView），日志诊断置于备份与同步/更新与关于之后（DOM 顺序断言）；390px/768px 触控夹具无横向溢出（userscript-product 7/7 通过，面板按钮触控目标断言含新增按钮）。
  - [x] 名单搜索/筛选可按平台与关键词过滤并在空结果时给出可理解空态（UI-LIST-1：计数行、大小写不敏感、平台筛选、空态文案）。
  - [x] 撤销窗口可配置且默认加长（默认 10000ms，8.3s 行为断言旧源码必失败；`undoToastSeconds=5` 时提前消失）；"最近操作"可撤销对应本地写入且不含敏感正文（UI-ACTIONS-1：撤销后名单与记录同步移除；recent-actions 独立键且不进 Store 快照，UI-SRC-4 源码断言）。
  - [x] 关键路径不再混用原生 `confirm/prompt` 与自建浮层（UI-MODAL-1 行为断言 + UI-SRC-1/2/3 源码断言：openOptions 函数体内无原生对话框，`window.confirm(` 7→4 处，`alert(` 清零）。
  - [x] `test/run.cjs` 20/20、`test/userscript-product.cjs` 7/7、docs-check 通过。
- evidence: `structure regression`：新增 `test/ui-settings.cjs` 16 项全绿（人工合成 B站评论夹具；源码级断言在旧实现上必然失败：旧 showToast 固定 5000ms、无 `#ob-recent-actions`、无搜索框、openOptions 使用原生 confirm）；run 20/20、quickblock 38/38、userscript-product 7/7、danmaku-auto 8/8、work-block 3/3，页面/控制台错误 0；`node --check`、docs-check、隐私门禁通过。随 v0.60.0 本地候选交付（未 push/tag/Release）。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）。
- next: 已实现并随 v0.60.0 本地候选交付；实页验证（分组导航/搜索/最近操作在真实拉黑后的行为）待用户恢复授权后补齐。关键词自动规则命中与后台 UID 增强刻意不进最近操作（撤销会被规则再次覆盖），边界记录在版本条目。
- updated: 2026-10-27
- supersedes: none
