# 2026-10-30 计划收尾归档：OB-RULE-004 / OB-UI-003 / OB-MAINT-004 原文

归档时间：2026-10-30（首批两项）；同日追加 OB-MAINT-004（OB-BRIDGE-001 立项后活动计划超预算）。各项均为 verified 且事实已回写 `docs/maintenance/CURRENT.md` 与对应版本
changelog（v0.62.0/v0.63.0）；因 OB-STORE-001 立项使活动计划接近 24 KiB 预算，按治理规则把已验证
项移出活动正文。本文件是只读归档，不追加当前状态。

---

### OB-RULE-004 — 已屏蔽内容样本库与规则提炼

- status: verified
- priority: P2
- scope: 把"已屏蔽内容"变成免费规则的原料（用户 2026-10-27 提出，含 AI 归纳设想）：用户确认拉黑（快捷/批量/弹幕组/评论管理器/AI 确认）时，把该条内容文本（截短、截断上限）写入本机"已屏蔽内容样本库"（按平台分桶、LRU 上限、独立 GM 键，本地 only，不入同步/导出/日志，可一键清空）；关键词面板提供从样本一键转关键词/正则规则的候选列表（全部经人工勾选确认后才写入 `DanmakuRules`）；提供"AI 归纳提炼规则"按钮：把有界样本（脱敏、限量）发给已配置 provider，请求输出候选关键词/正则与理由，结果同样只进人工确认列表，绝不自动写入；弹幕整条文本转关键词优先（重复度高），评论长文本默认不转整条关键词以免规则表被撑爆。
- non-goals: 不自动写入任何规则（全部人工确认）；不调用平台写入；样本库不进入账户同步；不改变身份键规范；样本只在本机保存，不含 Cookie/凭证。
- dependencies: none
- acceptance: required
  - [x] 确认拉黑后样本进入样本库，含平台、截短文本与时间；达到上限时按 LRU 淘汰并可清空（`test/rule-samples.cjs` SAMPLE-1a/1b/1c：批量确认入库且不进名单导出、重复文本去重并移队首、每平台 LRU 200 淘汰最旧且持久化一致、样本区可一键清空）。
  - [x] 样本转规则候选经人工勾选确认后才写入规则表；重复/超限/危险正则被拒并给可理解原因（SAMPLE-CONV-1 勾选 + 「把选中转为关键词」/行内「转为关键词」走 `DanmakuRules.add` 完整校验且样本保留；SAMPLE-AI-1b 候选写入时重复被去重、`(a+)+` 被 `assessDanmakuRegexRisk` 拒绝）。
  - [x] AI 归纳请求不含身份键/URL/Cookie，候选只进确认列表；失败给可理解原因，无 provider 配置时按钮不可用（SAMPLE-AI-1：请求正文仅样本数组、系统提示词受约束、关键词默认勾选/正则默认不勾选；CONV-1b 门控 title；SAMPLE-AI-ERR-1 provider 500 → 可读失败提示、候选清空、零写入）。
  - [x] 隐私门禁通过；`test/quickblock.cjs`、`test/danmaku-auto.cjs`、docs-check 通过（另见 SOURCE-1 源码级断言：样本 GM 键字面量全源码 1 处，快照/AccountSync/导出不引用 RuleSamples，样本/归纳事件日志只含平台与计数）。
- evidence: `structure regression`：新增 `test/rule-samples.cjs` 10/10（前置依赖 OB-RULE-003 已于同日 verified 并移入收尾归档）；rule-manager 5/5、quickblock 38/38、danmaku-auto 8/8、run 20/20、userscript-product 7/7、ui-settings 16 项、work-block 3/3、comment-manager 3/3、adapters 28/28、content-ai 12/12、content-coverage 6/6、ai-screening 25/25、ai-auto-gate 11/11、ai-autoload 3/3、state、performance、douyin、real-bilibili-probe --verify-local（含 --verify-danmaku-tool --verify-floating-danmaku）通过，页面/控制台错误 0；`node --check`、docs-check、隐私门禁通过。已随 v0.62.0 公开发布（tag/Release/raw 已核验）。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）。
- next: 已实现并随 v0.62.0 公开发布；实页验证（确认拉黑 → 样本出现 → 转规则、AI 归纳真实 provider 请求形态）待用户恢复授权后补齐。样本按入口锚点回溯正文，个别锚点不在内容容器内的入口不产生样本；AI 候选仅内存缓存——已知限制记录在版本条目。
- updated: 2026-10-27
- supersedes: none

### OB-UI-003 — 深色模式

- status: verified
- priority: P3
- scope: 用户 2026-10-27 采纳：为 userscript 全部自建 UI（设置面板、内容弹窗、审核浮层、确认气泡、toast、浮条）增加 `prefers-color-scheme: dark` 适配，深色下保持对比度与触控/悬停反馈；提供"跟随系统"默认即可，不加独立开关（若需要再加）。
- non-goals: 不改布局与交互；不做主题自定义；不改动平台页面本身。
- dependencies: none
- acceptance: required
  - [x] 深色系统偏好下自建 UI 可读，无浅色残留死块（DARK-2 静态断言样式表末尾深色覆盖段 142 条规则 + `color-scheme: dark`，逐面覆盖设置面板/内容弹窗/审核/关键词/确认/toast/浮条/行内入口；DARK-1 在合成 B站夹具上用 `emulateMedia` 断言面板/内容弹窗/确认气泡/确认浮层深底浅字与输入框深色，浅色切换后逐项复原）。
  - [x] 浅色行为与现状一致（DARK-1 同批元素浅色下恢复白底深字且 `color-scheme` 计算值回 `normal`；DARK-3 快捷拉黑 → 确认 → 名单 → toast 链路回归；浅色规则源码零改动、全样式表仅 1 处 `@media (prefers-color-scheme`）。
  - [x] `test/run.cjs` 20/20、`test/userscript-product.cjs` 7/7、docs-check 通过。
- evidence: `structure regression`：新增 `test/dark-mode.cjs` 18/18（DARK-2 源码级、DARK-1 浏览器级双向 emulateMedia、DARK-3 浅色行为回归；深色正文亮度 0.824 > 0.7、背景亮度 0.015 < 0.25）；run 20/20、userscript-product 7/7、ui-settings 16 项通过，页面/控制台错误 0；`node --check`、docs-check、隐私门禁通过。已随 v0.63.0 公开发布（tag/Release/raw 已核验）。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）；深色为纯 CSS 媒体查询，无平台结构依赖。
- next: 已随 v0.63.0 公开发布；实页恢复授权后可在系统深色浏览器中抽查一次真实页面观感（无新增 DOM 断言需求）。后续如需用户手动主题开关，另立计划项。
- updated: 2026-10-27
- supersedes: none

---

### OB-MAINT-004 — 探针内容发现的 Shadow DOM 深度遍历与路由形状兜底

- status: verified
- priority: P2
- scope: 2026 版 B 站 SPA 首页把内容详情链接渲染进嵌套 open shadow root，test/discover.cjs（隔离匿名证据链）与 test/dedicated-browser.cjs navigateToContent（专用登录态证据链）的浅层 querySelectorAll 均发现失败，2026-10-28 专用登录态验证只能依赖未入库临时脚本 _probe_features.cjs/_probe_diag*.cjs 的深度遍历兜底。新建共享模块 test/content-discovery.cjs（open shadowRoot 深度遍历，40 层/2000 锚点有界 + ^/video/、^/question/ 等 href 路由形状匹配，自包含纯函数可在页面上下文与 Node 运行），两条证据链的发现路径统一改用它；新增人工合成 SPA 夹具（浅层无 `<a>`、目标链接位于嵌套 open shadow root，并内嵌旧浅层实现逐字复刻）证明旧行为失败、新实现通过。同轮修复 test/real-platform-probe.cjs 恒定退出 0：fatal 或任一目标 errors 非空时退出 1，语义对齐 real-bilibili-probe.cjs:1730。
- non-goals: 不改动 omniblock.user.js 与任何用户可见行为；不改动 PLATFORM_CONFIG.contentSelectors 在 readSnapshot 右键兜底中的既有用途；不给微博增加入口→详情导航（contentRouteShapes 保持空、沿用"不导航"语义）；不改动 maintenance-check 与 dedicated-browser-probe 既有 blocked/failed 分类行为；不修复专用扩展桥接的 degraded/ready-timeout（仍是 CURRENT.md 中的另立专项）；真实页面标识（BV 号/uid 等）不入库，夹具全部使用人工合成标识。
- dependencies: none
- acceptance: required
  - [x] test/discover.cjs 与 test/dedicated-browser.cjs 的内容发现改用 test/content-discovery.cjs 同一实现（夹具 DISC-7 调用点级接线断言：require/page.evaluate/模板插值调用形态 + dedicated-browser selfTest 新增 4 条路由形状断言，--self-test 零失败）。
  - [x] 合成 SPA 夹具（人工合成，结构来自 2026-10-28 专用会话捕获形态）上旧浅层复刻发现 0 目标（DISC-1 旧 discover 收集 0 条、DISC-2 旧 navigateToContent video=false/question=false，旧行为上确认失败），共享实现在同页发现 /video/ 与 /question/ 各 1 个目标（DISC-3 深度遍历 4 个 open shadow 链接、DISC-4 形状匹配各命中 1），closed root 不可见、http/跨主机被排除、深度/数量界值生效（DISC-3/5/6），SVG 锚点与旧收集面净等价（DISC-8：querySelectorAll 匹配 tagName 小写的 SVG 锚点，其 SVGAnimatedString href 在旧下游 URL 解析与新的路由过滤中同样被拒，深度结果不含该锚点）；夹具 9/9 并已接线进 maintenance-check 本地矩阵。
  - [x] test/real-platform-probe.cjs fatal 或 errors 非空时退出 1（实测 `node test/real-platform-probe.cjs x --verify-local` goto 阻断 → exit 1），全净时退出 0（:157-197 分类仿真 A/B/C/D：blocked 前缀 + 非零退出归类 blocked 不误判硬失败）；头注释写明 blocked 也非零退出、分类以 errors[] 前缀为准；maintenance-check 既有分类逻辑未改动。
  - [x] omniblock.user.js SHA-256 前后一致（97d9d02b…763d）；real-bilibili-probe --verify-local（exit 0、errors []、0 pageerror，其 B 站目标发现已走共享深度收集）、docs-check、`git diff --check`、maintenance-check 本地全套（含 content discovery fixtures 9/9）通过。
- evidence: `structure regression`：新增 test/content-discovery.cjs 夹具 9/9（2026-10-28，真实 headless Chromium 合成页，旧实现失败→新实现通过逐条见 acceptance）；real-bilibili-probe --verify-local 通过；dedicated-browser-probe --self-test 通过；real-platform-probe x 匿名会话 exit 1 为 goto 阻断证据（退出码经 process.exitCode 自然排空 stdout 后设置，管道输出完整）。`real-site verified`：2026-10-28 用户专用 Chrome 登录态只读探针（9222）在 bridge degraded 状态下仍读到 bilibili.com/page/... 8 条、douyin.com/jingxuan/... 49 条、weibo.com/page/... 6 条内容（页面世界读取，不含 AI/存储链路），证明专用会话本身可用；内容详情导航路径本轮未能在专用会话完成验证。`blocked`：maintenance-check --dedicated-only 的专用链路两项复跑（含扩展自动重载后）均失败——6 平台桥接 degraded/ready-timeout（8 尝试 8 拒绝）+ tieba/x `Target.getTargets` 超时，签名与 2026-09-12 已知桥接故障一致且先于本轮任何改动路径（sync 阶段在导航前已 degraded；contentRouteShapes 为空的微博同样 failed）；按既有分类落 failed 使维护总检 FAILED，桥接唤醒/重试修复仍按 CURRENT.md 另立专项。
- next: 已关闭；专用 Chrome 桥接恢复（手动重载无效时重启专用 Chrome 或实施 bridge 唤醒/重试专项）后，用 `node test/maintenance-check.cjs --dedicated-only` 复跑，即可在真实登录态会话上完成发现路径的端到端复核。
- updated: 2026-10-28
- supersedes: none
