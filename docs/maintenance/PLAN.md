# OmniBlock 当前维护计划

更新时间：2026-10-27

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

2026-10-27 将已 verified 的 OB-RULE-001、OB-REL-001、OB-CTX-001、OB-MAINT-002 移出活动正文；
同日第二批把随 v0.58.0~v0.61.0 落地的 OB-AI-015、OB-RULE-003、OB-AI-016、OB-UI-001 一并移出，
原文均见 [2026-10-27 计划收尾归档](plans/2026-10-27-plan-closure.md)；对应事实已回写 `CURRENT.md`
与版本 changelog。

## 活动项

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
- evidence: `structure regression`：新增 `test/rule-samples.cjs` 10/10（前置依赖 OB-RULE-003 已于同日 verified 并移入收尾归档）；rule-manager 5/5、quickblock 38/38、danmaku-auto 8/8、run 20/20、userscript-product 7/7、ui-settings 16 项、work-block 3/3、comment-manager 3/3、adapters 28/28、content-ai 12/12、content-coverage 6/6、ai-screening 25/25、ai-auto-gate 11/11、ai-autoload 3/3、state、performance、douyin、real-bilibili-probe --verify-local（含 --verify-danmaku-tool --verify-floating-danmaku）通过，页面/控制台错误 0；`node --check`、docs-check、隐私门禁通过。随 v0.62.0 本地候选交付（未 push/tag/Release）。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）。
- next: 已实现并随 v0.62.0 本地候选交付；实页验证（确认拉黑 → 样本出现 → 转规则、AI 归纳真实 provider 请求形态）待用户恢复授权后补齐。样本按入口锚点回溯正文，个别锚点不在内容容器内的入口不产生样本；AI 候选仅内存缓存——已知限制记录在版本条目。
- updated: 2026-10-27
- supersedes: none

### OB-UI-003 — 深色模式

- status: proposed
- priority: P3
- scope: 用户 2026-10-27 采纳：为 userscript 全部自建 UI（设置面板、内容弹窗、审核浮层、确认气泡、toast、浮条）增加 `prefers-color-scheme: dark` 适配，深色下保持对比度与触控/悬停反馈；提供"跟随系统"默认即可，不加独立开关（若需要再加）。
- non-goals: 不改布局与交互；不做主题自定义；不改动平台页面本身。
- dependencies: none
- acceptance: required
  - [ ] 深色系统偏好下六平台夹具中自建 UI 均可读，无浅色残留死块（截图或断言 CSS 变量覆盖）。
  - [ ] 浅色行为与现状一致（回归断言）。
  - [ ] `test/run.cjs`、`test/userscript-product.cjs`、docs-check 通过。
- evidence: 尚未实施（2026-10-27 立项）；当前全部样式为硬编码浅色，无 `prefers-color-scheme`。
- next: 排在 P1/P2 项之后，作为低风险 UI 轮实施。
- updated: 2026-10-27
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

### OB-MAINT-003 — dev-extension 遗留用例重构与扫描噪声治理

- status: proposed
- priority: P3
- scope: `test/dev-extension.cjs` 的"loopback AI 桥接"用例自 v0.57.1 直连切换后写入已不存在的 `aiGatewayUrl`（结构性过时，当前必然失败）；按当前持久扩展直连架构重写该用例（loopback mock provider + direct handler + 设备 Key 语义），或将其明确降级为历史兼容夹具并从默认矩阵移出。同时为 Mimosa 静态扫描建立已审阅基线的治理方式：20 个 high 的"SSRF"告警属 userscript 按设计跨域能力（provider/同步 endpoint 均经 HTTPS 规范化校验，B站 API/更新地址固定），与维护者确认后的接受方式需要在工具配置或文档中固化，避免每轮误报阻断提交。
- non-goals: 不改变 AI 直连/桥接运行时行为；不删除历史实验文件；不降低身份、隐私或平台写入红线。
- dependencies: none
- acceptance: required
  - [ ] dev-extension 用例在当前架构下可运行并通过，或已从默认矩阵明确移出并在文档记录原因。
  - [ ] 扫描 high 告警的处置方式（基线/忽略/文档）落地后，常规提交不再被已知误报阻断。
  - [ ] docs-check 与相关回归通过。
- evidence: 2026-10-27 安全轮确认：当前源码 0 处 `aiGatewayUrl`（v0.56.0 时代 8 处）；dev-extension 失败与安全门禁无关。
- next: 排在 OB-RULE-003 之后的维护轮处理；处理前每轮如实记录该用例为既有失败。
- updated: 2026-10-27
- supersedes: none

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
