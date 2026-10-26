# 2026-10-27 计划收尾归档：四个 verified 项原文

归档时间：2026-10-27。以下四项在活动计划中均已 `verified`，对应事实已回写 `docs/maintenance/CURRENT.md`
与版本 changelog。本文件是只读归档，不追加当前状态；需要追溯验收证据与残留边界时读取。

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
