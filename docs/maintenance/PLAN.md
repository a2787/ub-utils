# OmniBlock 当前维护计划

更新时间：2026-09-13

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

## 已关闭项

2026-09-11 收尾轮关闭了 11 个积压项（OB-EXT-001 superseded；OB-AI-001/OB-COVERAGE-001/
OB-RULE-001/OB-MAINT-001/OB-REL-001 deferred；OB-AI-002/OB-AI-004/OB-AI-013/OB-PERF-001
blocked；OB-WEIBO-003 verified）。范围、证据、残留与恢复动作见
[2026-09-11 计划收尾归档](plans/2026-09-11-plan-closure.md)；残留的 blocked/partial 事实
仍以 `CURRENT.md` 为准。

## 活动项

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

### OB-TM-001 — Tampermonkey 移动端适配、API 直连与账户级加密同步

- status: deferred
- priority: P1
- scope: 保持 `omniblock.user.js` 为桌面与平板的共同交付物；优化窄屏/触控设置、内容入口、审核浮层和输入控件；补齐无 hover 设备的控制坞展开、页面内容入口和弹幕入口触控路径；AI 只保留用户直接填写的 OpenAI-compatible API 地址、模型名和设备本地 API Key；在 userscript 内提供账户注册/登录、客户端加密同步和显式“立即同步（合并）”入口，复用独立同步服务协议。
- non-goals: 不继续建设或发布 MV3 安装路径；不保留 AI 主链路的 loopback 网关模式；不加入本地模型；不把 API Key、账户密码、访问令牌或同步口令放入普通设置、导出文件或云端文档；不自动同步、不执行平台举报/官方拉黑/关注/发帖；东京服务器的独立同步部署由 `OB-SYNC-001` 管理，本项不改 Vibeme/V2/KB 既有服务；不删除上一项留下的实验文件。
- dependencies: none
- acceptance: required
  - [x] userscript 的 AI 配置只显示 API 地址、模型名和“设置/更换本机 Key”，旧 gateway 配置不会再触发网关请求；Key 只写入独立 GM 存储，并且不出现在名单导出、提示词导出、同步 state、日志或请求正文。
  - [x] userscript 在普通 Tampermonkey 运行时可以使用 GM 跨源请求直接调用已配置 provider；无 Key、无效 URL、网络错误和 HTTP 错误均给出可理解的失败状态，且不把 Key 写入页面对象。
  - [x] 390px、768px 和触控夹具验证：入口不遮挡安全区，设置面板不横向溢出，AI 配置和同步表单可滚动/提交；面板紧凑按钮组与 AI 审核/反馈浮层按钮在 561px 以上触控宽度被组件级 min-height 压回 26–34px 的缺陷已修复（coarse-pointer 组件规则后置覆盖），product 6/6 通过；真实平板安装未观察到前只记 `blocked`。
  - [x] 无 hover 的 coarse pointer 触控路径：页面入口常驻可见、齿轮单次点按直接进入设置，不依赖 `pointerover`/`mouseover`；原“齿轮首触展开控制坞、二次点按进设置”的手势在触控端 dock 挂载即 `expanded`，已不再适用。
  - [x] userscript 同步客户端复用 `sync/sync-core.js` 的 envelope/CAS/逻辑时钟/墓碑协议；账户密码和同步口令只在按钮调用期间留在内存，token/device id/本地文档单独保存；409 与离线重试可恢复，远端密文可在第二设备解密并合并。
  - [x] 本地 mock、独立 Python 服务、AI/平台/通用回归和文档/隐私门禁通过；未执行平台写入。
  - [ ] 目标平板实际 Tampermonkey 安装、AI provider 和东京线上同步服务分别取得 `real-site verified`，无法取得时明确记录 `blocked`，不以本地夹具替代。
- evidence: `structure regression`：v0.57.1 userscript product 6/6（含 768px 审核浮层触控目标断言，旧行为 26/32px 上失败）；同步核心 7/7；Python 服务 5/5；通用 20/20、状态 9/9、B站 38/38、自动弹幕 7/7、评论管理器 3/3、作品级 3/3、性能 8/8、适配器 28/28、内容 AI 11/11、内容覆盖 6/6；页面/控制台错误为 0。维护总检本地项通过。
- evidence: `real-site verified`：2026-09-11 匿名隔离只读会话加载 v0.57.1 B站候选，脱敏页面形式 `bilibili.com/video/...`；控制坞、统一内容入口、评论/回复和只读 AI 内容均有现场结果，页面/控制台错误为 0，但触控操作未在真实平板执行。`blocked`：目标平板真实触控/provider 与双设备同步结果尚未完成，抖音匿名探针停在验证码中间页。独立同步服务的线上部署与互测由 `OB-SYNC-001` 追踪。
- next: 2026-09-12 用户决定平板线封存（不是终止），维护重心回到电脑：本地开发、发布与更新地址均已完成，仅剩平板实机触控/AI provider 验证未执行。重启条件、待办清单与恢复动作见 [平板线封存记录](plans/2026-09-12-tablet-track-sealed.md)；重启前本项不再占用维护轮次。
- updated: 2026-09-12
- supersedes: OB-EXT-001

### OB-SYNC-001 — 东京独立同步服务上线与双设备互测

- status: deferred
- priority: P1
- scope: 在东京服务器建立独立 `omniblock-sync` 运行目录、独立 SQLite 数据库和独立 systemd 服务；通过独立 HTTPS 隧道提供 userscript 所需的 `/healthz`、账户认证和 opaque-CAS 同步接口；使用同一账户与同步口令完成电脑、平板两端的显式合并验证。
- non-goals: 不修改 Vibeme/V2/KB 的数据库、代码、网关路由或现有隧道；不上传 API Key、浏览器登录态、运行日志或明文名单；不启用后台自动同步；当前服务器没有可用的固定域名时不伪称为稳定生产域名，临时隧道若发生重启需重新取得 endpoint，固定域名/命名隧道另行处理。
- dependencies: OB-TM-001
- acceptance: required
  - [x] 东京服务器只新增独立服务目录、独立数据库和独立服务单元，health 可从公网 HTTPS 访问；auth/CAS 等待真实账户流程。
  - [ ] 服务器端只看到账户认证元数据和客户端加密 envelope；远端读回不得出现人工合成明文、API Key 或同步口令。
  - [ ] 电脑与平板使用同一账户、同一同步口令，分别点击“立即同步（合并）”后，名单/可同步设置/提示词/反馈能够确定性合并，删除墓碑不复活。
  - [ ] 线上健康、密文读回、冲突重试和双设备结果记录为 `real-site verified`；网络/设备/登录条件阻断时如实记为 `blocked`。
- evidence: `structure regression`：本地 sync-core 7/7、Python 服务 5/5；`real-site verified`：2026-09-11 独立服务 loopback 与 HTTPS Quick Tunnel health 返回 200，源码 SHA-256 一致；真实账户与双设备互测待本项完成。
- next: 双设备互测随平板线于 2026-09-12 封存（服务器保持部署在线，不改 schema/凭据）；重启时按 [平板线封存记录](plans/2026-09-12-tablet-track-sealed.md) 先单设备注册/合并，再电脑+平板互测并回填 `real-site verified`。
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

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
