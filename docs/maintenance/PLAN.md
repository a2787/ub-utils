# OmniBlock 当前维护计划

更新时间：2026-10-30

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
与版本 changelog。2026-10-28 更正：OB-UI-001/OB-AI-016（及归档中 OB-AI-015）evidence 里"本地候选交付
（未 push/tag/Release）"的表述已被同日统一发布取代——v0.60.0~v0.63.0 四个 tag/Release 与 raw 均已核验，
归档原文按只读规则不改写。2026-10-29 更正：OB-MAINT-004 scope 里「未入库临时脚本
_probe_features.cjs/_probe_diag*.cjs」的表述不准确——一次性探针 `_probe_diag4.cjs` 已被提交
`b3fdbb1` 连带入库（add -A + 白名单 reset 漏列），本轮已解除跟踪（本地保留）并以 `.gitignore`
根级锚定规则兜底；scope 原文按已验证项不改写，详见 `CURRENT.md` 同日条目。

2026-10-30 把已 verified 且事实已回写 CURRENT/版本 changelog 的 OB-RULE-004（v0.62.0）、
OB-UI-003（v0.63.0）与 OB-MAINT-004（测试层）移出活动正文，原文见
[2026-10-30 计划收尾归档](plans/2026-10-30-plan-closure.md)；同日立项 OB-STORE-001 与 OB-BRIDGE-001。

## 活动项

### OB-BRIDGE-001 — 桥接就绪快照分块与事件日志孤儿清理（永久 degraded 根因修复）

- status: verified
- priority: P0
- scope: OB-DEF-002 根因已实测坐实（H1 载荷超限）：ready-response 把全部白名单键打包单信封，真实存储 ≈9.1M 字符 > 主世界 verifyEnvelope 8,388,608 上限，2026-09-12 起六平台永久 degraded（8 尝试 8 拒绝）；叠加 OB-DEF-001 降级写链覆盖索引后老分片成为孤儿，rotate 索引口径永远清不掉，不可自愈。修复：①桥侧分块——build-dev-extension.cjs 两侧模板把就绪快照序列化后按 2MiB（READY_CHUNK_CHARS）分块为 ready-values-chunk 信封（每条仍受 8MiB/HMAC/单调序列保护，MAX_READY_CHUNKS=64；序列化失败/截断显式 snapshot-serialize-failed/snapshot-too-large 错误回包，错误原因透传 failReady），主世界按 requestId 聚齐→JSON.parse→白名单过滤→ready-ack 先行→readyResolve，任一分块缺失不 settle 由既有重试覆盖；②EventLog rotate() 增加日期口径孤儿清理 sweepOrphanShards（[today-365, today-30) 每日期键有界探测 ≤365 次、每本地日至多一次，凡存在且不在裁剪后索引里的分片删除），MAX_TOTAL_CHARS 维持 16MiB（分块后 ready 能力 64×2MiB 已高于日志预算）；③metrics 新增 orphanSweeps/orphanShardsDeleted。@version 0.63.0→0.63.2（与 OB-STORE-001 合并单一发布），构建 `0.63.2-bridge-chunked-ready`。
- non-goals: 不手工删除真实存储的历史大分片（分诊 ① 为删除类写入，未获授权且分块修复后无必要——孤儿清理会按保留期自动收敛）；不改动存储键白名单、身份规范、同步协议与平台写入红线；不把 OB-STORE-001 的只读降级语义改为可写。
- dependencies: none
- acceptance: required
  - [x] >8MiB 夹具断言分块后 ready 成功而旧单信封路径 ready-timeout（degraded-storage BR-1：旧行为基线 state=degraded/attempts=8/reason=ready-timeout，修复后 ready）。
  - [x] 索引缺失的大日期分片按日期被清理（BR-4：40 天前孤儿分片旧代码残留、修复后删除）；dev-extension.cjs 新增分块协议两侧同步源码级守卫（旧模板上失败）。
  - [x] ready 放行对照（OB-DEF-001 在 ready 状态解除）：setSetting 落盘且种子名单未被覆盖（BR-5）；fallback degraded 只读降级回归保留（STORE-1..4）。
  - [x] `test/degraded-storage.cjs` 10/10、`test/dev-extension.cjs` 13/13、`test/run.cjs` 20/20、`test/dark-mode.cjs`、`test/product-extension.cjs` 3/3、`node --check`（源码+生成桥接文件）通过；README/CHANGELOG/v0.63.2/CURRENT/知识树同步；@version 0.63.0→0.63.2（合并发布）、构建 `0.63.2-bridge-chunked-ready`。
- evidence: `structure regression`：2026-10-30 旧行为基线（HEAD 0.63.0，git worktree 隔离运行）degraded-storage FAIL 8（BR-1..5、STORE-1..3，BR-1 输出生产同签名 degraded/8/ready-timeout，BR-5 空态覆盖种子 hasSeed=false）+ dev-extension 两守卫失败；修复后 degraded-storage 10/10（exit 0）、dev-extension 13/13、run 20/20、dark-mode 通过、product-extension 3/3。`real-site verified`：2026-10-30 专用 Chrome 登录态只读探针（--dedicated-only）：扩展刷新到 0.63.2 后四可达平台桥接全部 ready（bilibili/douyin/weibo 1 尝试 0 拒绝、zhihu 2 尝试 0 拒绝），真实读取脱敏 bilibili.com/page/... content=8（withIdentity 8/8）、douyin.com/jingxuan/... content=10、weibo.com/page/... content=6 users=6（withIdentity 6/6）、zhihu.com/hot/... 加载但 0 条（既有 blocked）；同轮刷新环节先捕获 0.63.0 degraded（8/8/ready-timeout）再捕获 0.63.2 ready（attempts=2），修复前后直接对照；2026-09-12 起六平台永久 degraded 在真实存储上解除。整体 FAILED 仅由既有分类构成（zhihu 无可探测条目 blocked、tieba/x 浏览器级 Target.getTargets 超时 failed）。发布合并更正（2026-10-30）：本项与 OB-STORE-001 同工作区叠加实现并同轮验证，按发布决定合并为 v0.63.2 单一发布（两项同随 v0.63.2 发布，tag/Release/raw 核对见 CURRENT 发布回写）；中间数据安全候选未单独创建 tag/Release。
- next: 已关闭；孤儿清理对真实存储的收敛效果可用 EventLog.status().orphanSweeps/orphanShardsDeleted 在后续只读会话复核；tieba/x CDP 超时与 zhihu 条目缺失为既有另案边界。
- updated: 2026-10-30
- supersedes: none

### OB-STORE-001 — degraded 存储只读降级（桥接未就绪时禁止一切写路径）

- status: verified
- priority: P0
- scope: 专用开发扩展桥接 degraded（ready 握手被全量拒绝）时，页面以默认空存储启动但旧写路径全部畅通：persist() 会把空态写回 `omniblock:data:v1` 覆盖真实名单，首载/外部变更快照会把空快照写进 `omniblock:backup:v1` 快照环（2026-10-29 抢救报告的 backup:v1 覆盖即同一链路的实际损害）。双层 fail-closed + UI 警示：层 1（userscript）ready 被拒后置 `storageBridgeDegraded`，`persist()`/`writeBackupRecords()` 拒写、`ensureLocalBackup()` 提前返回、`storageStatus()` 暴露 `degraded`，设置面板顶部与右下浮条持续警示（浮条可关闭、面板警示保留）；层 2（build-dev-extension.cjs 桥接模板）主世界 ready 后先发 `ready-ack`、GM 写入在 `!ready` 时拒绝并计数，隔离世界锁存 `ready-ack` 后才放行 `set`/`remove`。新建 `test/degraded-storage.cjs`（生产同款载荷超限退化夹具）断言 data:v1/backup:v1 字节不变、面板警示出现，三项核心断言在旧行为上失败。
- non-goals: 不修复桥接永久 degraded/ready-timeout 本身（载荷超限根因与唤醒/重试仍按 OB-DEF-002 另行专项）；不改变 Tampermonkey 正常路径（无栅栏时恒 false）；不做 degraded 期间的写队列/补写（恢复后以刷新重读为准）；不改动身份键规范、同步协议与平台写入红线。
- dependencies: none
- acceptance: required
  - [x] degraded 页面上 persist 触发后 `chrome.storage.local` 的 `omniblock:data:v1` 字节不变（CORE-1）；`omniblock:backup:v1` 不新增空快照（CORE-3）；面板顶部与存储状态行出现只读降级警示且浮条可关闭而面板警示保留（CORE-2）——三项在旧行为上实测失败（data:v1 SHA-256 `6be1e28e…`→`4186f9d7…`、backup:v1 468→2,365 字节、无警示 UI）。
  - [x] 层 2 门控字面量进入两个桥接模板并有源码级守卫（dev-extension 新增"桥接双层写入门控存在"用例）；ready 页共享存储、伪造消息拒绝、抖音自动加载、缺隔离桥有界降级等既有用例全部保留并通过（ready 路径行为不变）。
  - [x] `test/degraded-storage.cjs` 8/8（含 CONTROL-1 ready 放行对照与 FIX-0a/0b 夹具健全性）、`test/dev-extension.cjs` 12/12、`test/run.cjs` 20/20、`node --check`（源码与生成桥接文件）通过。
  - [x] README、根 CHANGELOG、`docs/changelog/v0.63.2.md`（合并条目）、CURRENT、知识树同步；`@version` 0.63.0→0.63.2、构建 `0.63.2-bridge-chunked-ready`（与 OB-BRIDGE-001 合并单一发布，中间构建标识未单独发布）。
- evidence: `structure regression`：2026-10-30 修复前基线 `node test/degraded-storage.cjs` FAIL 5（CORE-1/2/3+EXTRA-1/2，CONTROL/FIX 通过，旧行为字节级复现空态覆盖，data:v1 SHA-256 `6be1e28e…`→`4186f9d7…`）；修复后同夹具 PASS 8（exit 0）；dev-extension 12/12、run 20/20、`node --check` 通过；生成产物 `test/_dev-extension/` 重新构建。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）；degraded 根因（ready-response 载荷超限）由 OB-BRIDGE-001 于 2026-10-30 修复。发布合并更正（2026-10-30）：本项与 OB-BRIDGE-001 合并为 v0.63.2 单一发布（两项同随 v0.63.2 发布），数据安全修复先行完成，发布态以 CURRENT 发布回写为准。
- next: 已关闭；专用 Chrome 桥接恢复或复现 degraded 时，可用生产只读 `__OB_RUNTIME_INFO__.storageDegraded` 与面板警示做一次登录态只读核对；桥接唤醒/重试与载荷超限治理另立计划项。
- updated: 2026-10-30
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

- status: verified
- priority: P3
- scope: `test/dev-extension.cjs` 的"loopback AI 桥接"用例自 v0.57.1 直连切换后写入已不存在的 `aiGatewayUrl`（结构性过时，当前必然失败）；按当前持久扩展直连架构重写该用例（loopback mock provider + direct handler + 设备 Key 语义），或将其明确降级为历史兼容夹具并从默认矩阵移出。同时为 Mimosa 静态扫描建立已审阅基线的治理方式：20 个 high 的"SSRF"告警属 userscript 按设计跨域能力（provider/同步 endpoint 均经 HTTPS 规范化校验，B站 API/更新地址固定），与维护者确认后的接受方式需要在工具配置或文档中固化，避免每轮误报阻断提交。
- non-goals: 不改变 AI 直连/桥接运行时行为；不删除历史实验文件；不降低身份、隐私或平台写入红线。
- dependencies: none
- acceptance: required
  - [x] dev-extension 用例在当前架构下可运行并通过，或已从默认矩阵明确移出并在文档记录原因。
  - [x] 扫描 high 告警的处置方式（基线/忽略/文档）落地后，常规提交不再被已知误报阻断。
  - [x] docs-check 与相关回归通过。
- evidence: `structure regression`：2026-10-27 重构前基线 dev-extension 9 过 2 失败（loopback AI 网关与事实核查往返，`mode: direct`、`providerConfigured: false`、0 请求，与立项证据一致）。选择降级路径：开发扩展内恢复直连往返需同时改 build-dev-extension.cjs 三处桥接协议（设备 Key 入存储白名单、Authorization 头白名单、service worker direct-ai 取回处理器；该处理器现属正式扩展 `extension/service-worker-extra.js` 产品路径），超出本轮非目标；两个往返降级为直连拒绝断言（配置合法 loopback provider 后 analyzePage 因缺设备 Key 有界失败、零 provider 请求离开页面、`setApiKey` 被桥接存储白名单丢弃，旧行为上会失败），保留全部其余用例并新增“内嵌源码无 aiGatewayUrl”形态守卫，降级原因写入测试头注释；重构后 dev-extension 11/11、product-extension 3/3、`node --check` 通过，`omniblock.user.js` SHA-256 前后一致。扫描治理：流程落 `docs/MAINTENANCE_WORKFLOW.md` §5（提交前封存深度扫描 + `.mimosa/security-policy.json` 基线 + 门禁 ETIMEDOUT 时如实记 inconclusive），钩子卸载/恢复命令与 ETIMEDOUT 证据记录于 `docs/maintenance/CURRENT.md` 当日条目；docs-check、`git diff --check` 通过。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）；本项为测试与文档治理，无用户可见行为。
- next: 已关闭；常规提交的扫描噪声按 `docs/MAINTENANCE_WORKFLOW.md` §5 流程处理。若未来要在开发扩展内恢复直连往返，需先另立计划评审 build-dev-extension.cjs 的三处协议变更。
- updated: 2026-10-27
- supersedes: none

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
