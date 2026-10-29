# OmniBlock 当前维护状态

更新时间：2026-10-30
状态来源：v0.63.2（OB-STORE-001 degraded 存储只读降级 + OB-BRIDGE-001 桥接就绪快照分块与事件日志孤儿清理，两项合并单一发布）为本轮发布版本；v0.60.0~v0.63.0 已于 2026-10-28 同轮公开发布。东京独立同步服务已部署并取得 HTTPS health 证据；平板线 2026-09-12 起封存待重启，维护重心回到电脑。历史见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

> 2026-09-13 仓库事故（已修复）：`E:\pluginforchrome\.git` 对象库与 `refs/` 丢失（工作区无损失），经用户同意从远端重建，v0.55.0~v0.57.2 全部 tag 恢复；唯一无法恢复的未推送提交 `c025d8b`（v0.57.3）的代码内容已随提交 `b83003a` 落库。细节见当时交接与 [v0.57.3 条目](../changelog/v0.57.3.md)。

## 当前版本

- 当前 userscript：`0.63.2`（已公开发布：degraded 存储只读降级 + 桥接就绪快照分块，两项合并发布）
- 构建：`0.63.2-bridge-chunked-ready`
- 当前公开版本/功能提交：`0.63.2` / `5af465021a465ff071c588f22ac28536b2f46f99`
- 最近验证的源码快照：`5af465021a465ff071c588f22ac28536b2f46f99`（v0.63.2 功能提交）
- 当前候选源码 SHA-256：`d2bf5c0a7f3650b58a2e98dfe305ce72e0a674118bd1c305d619d4671682cf28`（v0.63.2 功能提交内 userscript 快照，2026-10-30 复核一致）
- 发布状态：v0.63.2 已公开发布（tag/Release/raw 详情见下方发布执行条目）；未执行平台写入。
- 当前公开 tag/Release：[v0.63.2](https://github.com/a2787/ub-utils/releases/tag/v0.63.2)。

## 2026-10-30 v0.63.2 合并发布：degraded 存储只读降级（OB-STORE-001，数据安全）+ 桥接就绪快照分块与孤儿清理（OB-BRIDGE-001）

- 发布决定：两项修复合并为 v0.63.2 单一发布（tag 与 `@version` 一致；中间数据安全候选未单独创建 tag/Release，`@version` 实际跨越 0.63.0→0.63.2）；两项计划各自保留 `verified`，均"同随 v0.63.2 发布"。
- 数据安全（OB-STORE-001，critical）：专用开发扩展桥接 degraded（ready 握手被全量拒绝）时页面以默认空存储启动且写路径全部畅通（2026-10-29 抢救报告的 backup:v1 覆盖即同一链路实际损害）。层 1（userscript）：ready 被拒后整页只读降级——`persist()` 拒写（`lastError='storage-degraded-readonly'`、`degradedRefusals` 计数）、`writeBackupRecords()` 拒写、`ensureLocalBackup()` 提前返回、`storageStatus()` 暴露 `degraded`，面板顶部横幅 + 存储状态行 + 右下浮条持续警示（浮条可关闭、面板警示保留）；`__OB_RUNTIME_INFO__`/`window.OB.runtime` 暴露 `storageDegraded`。层 2（`test/build-dev-extension.cjs` 模板，产物重新生成）：主世界 ready 后先发 `ready-ack`，`GM_setValue`/`GM_deleteValue` 在 `!ready` 时拒绝并计 `blockedWrites`；隔离世界锁存 `ready-ack` 后才放行 `set`/`remove`——即使上层误调用，degraded 下也不落盘。
- 桥接根因（OB-BRIDGE-001，high）：OB-DEF-002 永久 degraded 的 H1 根因——ready-response 单信封超主世界 8MiB 校验上限（真实存储 ≈9.1M 字符、事件日志分片为主，8 尝试 8 拒绝自 2026-09-12 起）。桥侧（build-dev-extension.cjs 两侧模板）：就绪快照按 2MiB 分块为 `ready-values-chunk` 信封（逐条 HMAC/单调序列/8MiB 校验保留，MAX_READY_CHUNKS=64，错误显式回包并透传原因），主世界聚齐后 ready-ack 先行 + readyResolve，任一分块缺失不 settle。日志侧：`rotate()` 新增 `sweepOrphanShards()` 日期口径清理（[today-365, today-30) 有界探测、每本地日至多一次，索引外的过期孤儿分片删除），`MAX_TOTAL_CHARS` 维持 16MiB（分块后 ready 能力已高于日志预算）；metrics 新增 orphanSweeps/orphanShardsDeleted。手工删除历史大分片为删除类写入未获授权、亦无必要。构建 `0.63.2-bridge-chunked-ready`。
- `structure regression`：`test/degraded-storage.cjs` 两阶段 10/10——Phase A（BR-1..5）在 >8MiB 存储夹具上断言分块 ready（BR-1）、读回 2 个种子人物（BR-2）、degraded===false（BR-3）、40 天孤儿分片被清理（BR-4）、ready 放行对照 setSetting 落盘且种子未被覆盖（BR-5）；Phase B（STORE-1..4）用 http:// 页面（适配器按 hostname 匹配、扩展 content script 仅 https）构造有 UI 无隔离桥的 degraded 场景，断言 data:v1/backup:v1 字节不变与警示 UI。旧行为基线以 git worktree 运行 HEAD（0.63.0）实测六项失败并字节级留证（合成种子被空态覆盖、backup:v1 新增空快照、无警示 UI、BR-1 生产同签名 degraded/8/ready-timeout）；修复后全绿。dev-extension 13/13（"就绪快照分块协议两侧同步"与"桥接双层写入门控存在"源码级守卫，旧模板上失败）、run 20/20、dark-mode 通过、product-extension 3/3、`node --check`（源码+生成桥接文件）通过。PLAN 移出已验证的 OB-RULE-004/OB-UI-003（原文见 [2026-10-30 计划收尾归档](plans/2026-10-30-plan-closure.md)）。
- `real-site verified`：2026-10-30 专用 Chrome 登录态只读探针（`node test/maintenance-check.cjs --dedicated-only`，CDP 9222）：扩展刷新到 `0.63.2` 后四可达平台桥接全部 ready（bilibili 1/0、douyin 1/0、weibo 1/0、zhihu 2/0 attempts/rejections），真实读取 bilibili.com/page/... content=8（withIdentity 8/8）、douyin.com/jingxuan/... content=10、weibo.com/page/... content=6 users=6（withIdentity 6/6）、zhihu.com/hot/... 加载但 0 条（既有 blocked）；同轮刷新环节先捕获 `0.63.0` degraded（8 尝试 8 拒绝 ready-timeout）再捕获 `0.63.2` ready（attempts=2），修复前后直接对照。整体 FAILED 仅由既有分类构成——zhihu 无可探测条目 blocked、tieba/x 浏览器级 `Target.getTargets` 超时 failed（entry=null，与桥接无关），签名与 2026-10-28 基线相同。
- 孤儿清理对真实存储的首次生效是用户浏览器加载新构建后自身 `rotate()` 的既有保留期语义（非探针写入）；真实收敛效果可用 `EventLog.status().orphanSweeps/orphanShardsDeleted` 复核，留作下一步验证。
- 发布后专项复测（2026-10-30 同日，专用 Chrome 登录态，`sync`+专项驱动，驱动/报告不入库）：`real-site verified` 8/8——扩展 `0.63.2`（sourceHash 同功能提交）、真实页 bridge=ready（脱敏 `bilibili.com/...`，attempts 1~2/rejections 0）、`storageDegraded`=false、真实名单可读（只读计数）；设置 `undoToastSeconds` 10→15→还原 10 各跨一次刷新读回（本轮唯一真实设置写入，零残留）；名单写入与 v0.62 样本→转关键词全链路落桩通过（页面内 GM 桩、真实名单零污染对照通过、平台写入控件 0 次；细节见版本条目）。
- 边界：测试种子全部人工合成（`p_seed1/2`、`bili:uid:10001/10002` 形态占位）；未读取/导出 Cookie；`out/` 交互实测产物（含 2026-10-29 备份导出）本轮起由 `.gitignore` `/out/` 兜底不入库。
- 发布执行（同轮，已完成）：功能提交 `5af465021a465ff071c588f22ac28536b2f46f99`，发布脚本 `scripts/release-0632.cjs`（工具性提交 `9df2370`/`5155f82` 仅发布脚本修复）创建附注 tag `v0.63.2` 指向功能提交并推送，GitHub Release [v0.63.2](https://github.com/a2787/ub-utils/releases/tag/v0.63.2) 已创建（说明见 `scripts/release-notes/v0.63.2-release.md`）；raw 核对通过（第 1 次尝试）：raw master 已服务 `@version 0.63.2` / 构建 `0.63.2-bridge-chunked-ready`。提交前封存深度扫描（MCP deep）：126 项（20 high + 106 medium，全部 `other-security`），均为 v0.58.0 已分诊两族（跨域请求告警、本地排序比较器误报，基线 `.mimosa/security-policy.json`），无新增族；扫描器 `runStatus=inconclusive`（partial coverage）如实记录；scanId `scan-2026-10-29T19-45-12.394Z-7a3d2c8d24dc`，seal `sha256:5db98c93…`。

## 2026-10-30 v0.63.2 发布前实装轮：数据事故抢救回写与 0.63.1 专用 Chrome 登录态功能实测

- `real-site verified`（数据事故与抢救）：2026-10-29T17:24 抢救报告（轮内记录、原文未入库，事实以本条与 [v0.63.2 条目](../changelog/v0.63.2.md) 引述为准）记录专用开发扩展桥接 degraded（ready 握手 8 尝试 8 拒绝，自 2026-09-12）时页面以默认空存储启动且写路径全部畅通——`omniblock:backup:v1` 被 initial 空快照覆盖且快照环内已无可恢复来源，降级页面事件日志分片经降级桥真实落盘，`omniblock:data:v1` 仅因未触发 persist 而幸存（主名单无用户可见丢失，但降级页面上任何改设置/确认拉黑/同步合并都会覆盖它）。同轮只读坐实根因为 ready-response 单信封载荷超限：真实存储 ≈9.1M 字符（单日最大事件日志分片 2.9M）> 主世界 8,388,608 上限。抢救结论直接立项 OB-STORE-001（fail-closed 只读降级）与 OB-BRIDGE-001（分块根因修复），两项同随 v0.63.2 发布（见上方条目）。
- `real-site verified`（0.63.1 实装功能实测）：本地 2026-10-30 02:38–02:39（startedAt 2026-10-29T18:38Z），用户专用 Chrome 登录态真实页面（主舞台脱敏 `bilibili.com/video/...`），数据安全候选 `0.63.1`（最终未单独发布、与 OB-BRIDGE-001 合并为 v0.63.2）以探针实例实装运行 30 步交互功能链路：29 步 verified、1 步 blocked、pageErrors=0——设置五分组导航与日志诊断、「新增屏蔽」名单 3→4→3 行、搜索/平台筛选（"显示 1 / 共 4"）、撤销 toast 9573ms 自然消失（目标 10000±2000ms）、清空日志 62→1；关键词规则命中 2 次自动隐藏并自动写名单、就地编辑即时生效、样本转关键词（规则 0→2 条）、命中清零、临时规则全清；AI 全程指向本机 loopback mock（127.0.0.1:8123），测试连接 135ms、「分析本页」1 次请求 72 条 10372 字符、审核确认+撤销、用量计数一致；深色面板 rgb(28,32,48)（亮度 0.015）↔ 浅色 rgb(255,255,255)（亮度 1.000）双向；知乎公开问题页（脱敏 `zhihu.com/question/...`）快扫通过（collectAIRecords 3 条）。blocked：weibo 落 `weibo.com/newlogin/...` 登录墙。唯一预案内回退：合成平面评论节点无 `.ob-quick` 快捷入口（快捷拉黑扫描未覆盖 `[data-comment-id]` 平面节点），按预案改真实评论条目执行（身份脱敏、仅进页面内桩并当场撤销）。全程写入均在页面内 GM 存储桩：真实 Tampermonkey 存储零写入、扩展实例未触碰、平台写入控件 0 次、未读取/导出 Cookie；桩内轮末 4 人随标签页丢弃，桩内导出（3 合成人/1 条规则，`out/omniblock-*-2026-10-29.json`）均为轮内合成数据；驱动/报告按 `.gitignore` `/_drive_test*.cjs`、`/out/` 兜底不入库。
- `blocked`（桥接当时未修复部分）：驱动期间持久扩展实例仍为 `0.63.0`/bridge=starting（即 2026-10-28 OB-MAINT-004 专用轮记录的同一 degraded/ready-timeout 故障），0.63.1 为探针实例注入运行并持运行锁——该部分随后由 OB-BRIDGE-001 同轮修复并经 v0.63.2 发布对照验证（0.63.0 degraded 8/8 → 0.63.2 ready，见上方 v0.63.2 条目）；既有另案边界不变：tieba/x `Target.getTargets` 超时、zhihu 无可探测条目、匿名链路知乎登录墙/抖音验证码/X 登录墙。
- `structure regression`（degraded-storage 断言，本轮回写轮复跑）：`node test/degraded-storage.cjs` PASS 10 / FAIL 0（exit 0、PageErrors 0）——STORE-1..4 degraded 只读（data:v1/backup:v1 字节不变、警示 UI 且浮条关闭后面板保留）、CONTROL-1 ready 放行对照、BR-1..5 >8MiB 存储分块 ready/种子读回/degraded=false/孤儿分片清理/ready 放行；旧行为基线（HEAD 0.63.0）六项失败字节级留证（data:v1 SHA-256 `6be1e28e…`→`4186f9d7…`、backup:v1 468→2,365 字节），对照见 [v0.63.2 条目](../changelog/v0.63.2.md)。

## 2026-10-29 仓库卫生完善（审计修复，无用户可见行为，摘要）

- 摘要：一次性探针 `_probe_diag4.cjs` 曾被 `b3fdbb1` 意外入库，本轮解除跟踪（本地保留）并以 `.gitignore` 根级锚定 `/_probe_diag*.cjs`、`/_probe_features.cjs`、`.mimosa/` 运行时子目录兜底；修复 `scripts/commit-pending.cjs`（多行提交信息经 `.git/OB_MSG` + `git commit -F`，杜绝字面 `\n` 主题行）、新增 `scripts/commit-worktree.cjs`（消息文件 + `--dry-run`，git 调用全部绕过 shell）。`omniblock.user.js` 零改动（SHA-256 前后一致）；`structure regression`：`node --check`（两个脚本）、docs-check、`git diff --check` 通过。详细边界见提交 `ec31217` 说明。

## 2026-10-28 专用登录态实装验证（v0.60.0~v0.63.0 实装回写）

- `real-site verified`：2026-10-28，用户专用 Chrome 登录态（browser-harness profile，CDP 9222）开发扩展 `0.63.0`/`0.63.0-dark-mode` 实装，runtime 在真实页面确认：脱敏 `bilibili.com/page/...`（首页形态）AI content 记录 8 条、`byKind={"content":8}`、withIdentity=8/8、gearCount=1。基线 `node test/maintenance-check.cjs --dedicated-only`（完整运行约 25 分钟）：41 个检查节全部执行，40 项本地门禁通过（docs governance/userscript syntax/run/quickblock/adapters/performance 等含 `RESULT: … PASSED`），整体 `RESULT: MAINTENANCE SELF-CHECK FAILED`（exit 1）——唯一失败项为 dedicated Chrome login-state real-site probe（exit 1）；legacy dev-browser sync 单独记 `blocked`（退出码 2）。
- 登录态基线读取（页面世界，按平台，2026-10-28 时桥接均 degraded/ready-timeout 8/8，该故障已于 2026-10-30 由 OB-BRIDGE-001 修复）：`bilibili.com/page/...` content=8（verified）；`douyin.com/jingxuan/...` content=49、withIdentity=0/49（verified 内容读取；页面级登录/安全门禁，导航 blocked）；weibo 页面加载但 content=0（failed；2026-09-12 与 2026-10-30 同 profile 均读到 6 条）；`zhihu.com/hot/...` content=0（failed，导航 blocked）；tieba/x 均 `CDP timeout: Target.getTargets`（浏览器级，未取得页面证据）。
- 分步实装细节（v0.60 五分组/名单搜索/最近操作、v0.61 自动分析默认关闭 0 请求、v0.62 快捷拉黑→样本→撤销、v0.63 深色双向断言的逐步探针记录）已回写各版本条目「实装验证」节，本页不再重复；全轮边界：未读取/导出 Cookie；探针标签页已关闭（CDP 目标列表仅剩用户原有标签页）。
- `blocked`：专用扩展桥接 degraded/ready-timeout（历轮既有，诊断见 2026-09-12 条目）；匿名链路知乎登录墙、抖音验证码、X 登录墙、贴吧。新功能逐版本回写见 v0.60.0~v0.63.0 条目「实装验证」节。`structure regression`：本轮测试层修复（OB-MAINT-004，见上节）。

## 2026-10-28 探针发现共享化（OB-MAINT-004，测试层）

- 摘要：新增 test/content-discovery.cjs（Shadow DOM 深度遍历 + 路由形状兜底），discover.cjs 与 dedicated-browser.cjs 内容发现统一走该实现；real-platform-probe.cjs 修复恒定退出 0；夹具 9/9（旧浅层 0 目标→新实现命中 /video/、/question/）。`blocked`：--dedicated-only 专用链路 6 平台桥接 degraded/ready-timeout，签名同 2026-09-12 已知故障（已于 2026-10-30 修复，见 OB-BRIDGE-001）。

## 2026-10-27 日期条目（已移出活动正文以守住 24 KiB 预算）

- OB-MAINT-003、OB-UI-003、OB-RULE-004、v0.60.0/v0.61.0 事实路由、OB-RULE-003、OB-AI-015 与接手调查的原始日期条目逐字保存在 [2026-10-30 移出存档](plans/2026-10-30-current-dated-archive.md)；各版本用户可见事实以对应版本 changelog（v0.58.0~v0.63.0）与 [PLAN 收尾归档](plans/2026-10-27-plan-closure.md) 为准。Mimosa 原生钩子当前为卸载状态，恢复命令 `node "C:/Users/et4vr/.zcode/cli/plugins/cache/zcode-plugins-official/mimosa/1.0.4/payload/dist/cli.js" git-gate install`（详见存档 OB-MAINT-003 条目）。
## 2026-09-13 撤销接管右键的本地拉黑菜单（OB-CTX-001，v0.57.4，已公开发布）

- 完整日期条目（范围/改动/证据/发布状态）已移入 [2026-09-13 移出存档](plans/2026-09-13-current-dated-archive.md)；当前公开版本与发布状态以本页"当前版本"区为准。

## 2026-09-11 上一轮 MV3 方案收回（OB-EXT-001，superseded）

- 平板 Edge 的实际安装路径确认以 Tampermonkey userscript 为准，因此不再把 `extension/`、正式 MV3、service worker 或扩展 options 作为本版本交付物；相关源码（含 `--product` 构建分支与 `test/product-extension.cjs`）已归档提交进仓库，未删除，保留复用可能。

## 已发布历史路由（详情见版本条目与 [HISTORY_INDEX.md](HISTORY_INDEX.md)）

- v0.54.0（独立 AI 评测）、v0.53.1（B站 AI 后台生命周期）、v0.53.0、v0.52.0、v0.51.x 与 2026-09-08/09 的 AI 型号、提示词、桥接和反馈证据均已移入对应版本 changelog 与历史索引；当前只继承“未核查不等于虚假、候选必须人工确认、平台不写入”的边界。

## 当前边界摘要

- 运行时、桥接、存储、Shadow DOM、generation、AbortController、只读平台写入边界和页面隐藏暂停规则以架构正文为准；当前版本仍只把用户确认后的本地动作写入 GM 存储。
- B站/抖音弹幕会话按视频隔离；统一内容弹窗按平台提供评论、弹幕、AI、关键词标签，正文采集排除操作文字，身份缺失不生成可执行入口。
- AI 入口只保留用户配置的 provider 直连、脱敏、最多 80 条分批、人工确认和事实核查保守门禁；本机 loopback 网关仅属于历史兼容/评测路径，不能作为当前 userscript 默认方式。B站新增后台 UID 增强遵守 OB-AI-012 的暂停/取消/hash-only 约束。
- 账户同步必须由用户点击“立即同步（合并）”触发；名单、可同步设置、提示词和反馈在客户端加密，API Key、密码、同步口令、令牌和日志不进入同步文档。东京独立同步服务已部署并有 health 证据；本项目未改 Vibeme/V2/KB schema。
- `real-site verified` 的当前只读入口与阻断以本文件顶部和版本条目为准；未判定登录、验证码、根评论 partial、模型精度和平台写入不能从夹具推导。

## 2026-09-06 至 2026-09-08 日期条目（已移出活动正文以守住 24 KiB 预算）

- OB-AI-001、OB-AI-002、OB-AI-003、OB-AI-003~007、OB-BILI-001、OB-RULE-002 的原始范围、改动文件、
  证据与当时发布状态逐字保存在 [2026-09-13 移出存档](plans/2026-09-13-current-dated-archive.md)；
  本节只保留仍影响当前版本的边界。
- 仍然生效的边界：B站根评论分页长期为 partial，不能由样本推导全量；抖音匿名入口验证码、知乎登录墙与
  微博 spacer 未被推翻；商汤 provider 与多 provider fallback 从未联调（商汤评估已作废）；抖音一键加载、
  评论/弹幕会话隔离的详细证据在版本条目中，本页不重复。以上项目前仍按未验证处理。

## 历史事实路由

- 2026-08-29 至 2026-09-05 的治理、B站入口/身份、微博虚拟列表与作品级读取等已关闭或阶段性条目，保留在 [HISTORY_INDEX.md](HISTORY_INDEX.md) 指向的计划和 `LEGACY-HISTORY.md`；本页只保留当前发布构建、最近证据和仍影响当前决策的限制。
- 需要追溯旧版本的具体数字、根因或当时发布状态时，按历史索引读取对应归档，不用旧条目覆盖当前候选事实。

## 汇总证据

### `structure regression`

- `node --check omniblock.user.js`、docs check 和 diff check 是每轮同轮门禁（完整矩阵见 `AGENTS.md`）；历史 AI、网关、生命周期与其他平台结果保留在各自 dated 条目与版本 changelog。

### `real-site verified` / `blocked`

- 2026-09-09 维护总检：`bilibili.com/video/...` 读到 1 条作品、3 条评论、210 条弹幕；`weibo.com/...` 详情读到 1 条帖子、12 条评论 AI 记录（页面评论行 12 条）。匿名入口的知乎登录墙、贴吧滑块、X 登录墙、抖音验证码、微博 spacer、B站根评论分页和动态 UID 仍按 `blocked`/`partial` 记录；专用 Chrome 不再沿用匿名结论；探针只读，未读取凭证或执行平台写入。其他平台日期、页面形式和样本量保留在各自 dated 条目。

## 常用命令

完整矩阵以 `AGENTS.md` 最低验证矩阵与 `docs/MAINTENANCE_WORKFLOW.md` §5 为准；本页只留高频入口：`node test/docs-check.cjs`、
`node test/userscript-product.cjs`、`node test/dev-extension.cjs`（先 `node test/build-dev-extension.cjs`）、
`node test/real-bilibili-probe.cjs --verify-local`、`node test/real-platform-probe.cjs <platform> --verify-local`。
固定专用 Chrome 的 profile 由 `dev-browser sync` 自动核对/刷新；登录态探针授权与红线见 `AGENTS.md`。

## 下一项最有价值的验证

v0.63.2 已公开发布且发布后专项复测通过（见 2026-10-30 条目）。下一项最有价值的验证：后续只读会话核对
孤儿分片真实收敛（`EventLog.status().orphanSweeps/orphanShardsDeleted` 与白名单总字符应从 ≈9.1M 回落）；
tieba/x `Target.getTargets` 超时与 zhihu 无可探测条目仍为既有另案边界；匿名链路的知乎登录墙/抖音验证码/
X 登录墙、贴吧右键证据仍为 `blocked`。
