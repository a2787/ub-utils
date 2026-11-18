# 2026-11-18 计划收尾归档：OB-BRIDGE-001 / OB-STORE-001 / OB-MAINT-003 原文

归档时间：2026-11-18。三项均为 verified 且事实已回写 `docs/maintenance/CURRENT.md` 与对应版本
changelog（OB-BRIDGE-001、OB-STORE-001 随 v0.63.2 发布；OB-MAINT-003 为测试与文档治理项）。
因活动计划接近 24 KiB 预算，按治理规则把已验证项移出活动正文。本文件是只读归档，不追加当前状态。

---

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

---

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

---

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
