# OmniBlock 当前维护状态

更新时间：2026-10-30
状态来源：v0.63.2（OB-STORE-001 degraded 存储只读降级 + OB-BRIDGE-001 桥接就绪快照分块与事件日志孤儿清理，两项合并单一发布）为本轮发布版本；v0.60.0~v0.63.0 已于 2026-10-28 同轮公开发布。东京独立同步服务已部署并取得 HTTPS health 证据；平板线 2026-09-12 起封存待重启，维护重心回到电脑。历史见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

> 2026-09-13 仓库事故（已修复）：`E:\pluginforchrome\.git` 对象库与 `refs/` 丢失（工作区无损失），经用户同意从远端重建，v0.55.0~v0.57.2 全部 tag 恢复；唯一无法恢复的未推送提交 `c025d8b`（v0.57.3）的代码内容已随提交 `b83003a` 落库。细节见当时交接与 [v0.57.3 条目](../changelog/v0.57.3.md)。

## 当前版本

- 当前 userscript：`0.63.2`（本轮合并发布：degraded 存储只读降级 + 桥接就绪快照分块；tag/Release/raw 核对随发布脚本同轮执行，发布回写条目登记提交/tag/Release/raw 结果）
- 构建：`0.63.2-bridge-chunked-ready`
- 上一公开版本/功能提交：`0.63.0` / `d808e82faa95a9a3b333a2a463a5562b23ed7c28`
- 最近验证的源码快照：`d808e82faa95a9a3b333a2a463a5562b23ed7c28`（v0.63.0 功能提交；v0.63.2 功能提交于发布回写时登记）
- 当前候选源码 SHA-256：`d2bf5c0a7f3650b58a2e98dfe305ce72e0a674118bd1c305d619d4671682cf28`（v0.63.2 工作区快照，2026-10-30 复核一致）
- 发布状态：v0.63.0 为上一公开版本（`v0.60.0`~`v0.63.0` 四个 tag 与 GitHub Release 均已创建，raw 更新地址已服务 `0.63.0`，发布回写提交 `6c9ef66` 仅改文档）；v0.63.2 为数据安全修复与桥接根因修复的合并发布（两项同随 v0.63.2 发布），发布中；未执行平台写入。
- 当前公开 tag/Release：[v0.63.0](https://github.com/a2787/ub-utils/releases/tag/v0.63.0)（v0.63.2 于发布回写时登记）。

## 2026-10-30 v0.63.2 合并发布：degraded 存储只读降级（OB-STORE-001，数据安全）+ 桥接就绪快照分块与孤儿清理（OB-BRIDGE-001）

- 发布决定：数据安全修复与桥接根因修复合并为 v0.63.2 单一发布——tag 必须与 userscript `@version` 一致，两项在同一工作区叠加实现并同轮验证；中间数据安全候选未单独创建 tag/Release，`@version` 实际跨越 0.63.0→0.63.2。两项计划各自保留 `verified`，均"同随 v0.63.2 发布"。
- 数据安全（OB-STORE-001，critical）：专用开发扩展桥接 degraded（ready 握手被全量拒绝）时页面以默认空存储启动且写路径全部畅通（2026-10-29 抢救报告中 `backup:v1` 被空 initial 快照覆盖即同一链路的实际损害）。层 1（userscript）：ready 被拒后整页只读降级——`persist()` 拒写（`lastError='storage-degraded-readonly'`、`degradedRefusals` 计数、不置 pendingLocalWrite）、`writeBackupRecords()` 拒写、`ensureLocalBackup()` 提前返回、`storageStatus()` 暴露 `degraded`，面板顶部横幅 + 存储状态行 + 右下浮条持续警示「存储桥接未就绪，本页为只读降级模式：名单与设置变更不会保存」（浮条可关闭、面板警示保留）；`__OB_RUNTIME_INFO__`/`window.OB.runtime` 暴露 `storageDegraded`。层 2（`test/build-dev-extension.cjs` 模板，产物重新生成）：主世界 ready 后先发 `ready-ack`，`GM_setValue`/`GM_deleteValue` 在 `!ready` 时拒绝并计 `blockedWrites`；隔离世界锁存 `ready-ack` 后才放行 `set`/`remove`——即使上层误调用，degraded 下也不落盘。
- 桥接根因（OB-BRIDGE-001，high）：OB-DEF-002 永久 degraded 的 H1 根因——ready-response 单信封超主世界 8MiB 校验上限（真实存储 ≈9.1M 字符、事件日志分片为主，8 尝试 8 拒绝自 2026-09-12 起）。桥侧（build-dev-extension.cjs 两侧模板）：就绪快照按 2MiB 分块为 `ready-values-chunk` 信封（HMAC/单调序列/8MiB 校验逐条保留，MAX_READY_CHUNKS=64，序列化失败/截断显式错误回包并透传 failReady 原因），主世界聚齐后 ready-ack 先行 + readyResolve，任一分块缺失不 settle。日志侧：`rotate()` 新增 `sweepOrphanShards()` 日期口径清理（[today-365, today-30) 有界探测、每本地日至多一次，索引外的过期孤儿分片删除），`MAX_TOTAL_CHARS` 维持 16MiB（分块后 ready 能力已高于日志预算）；metrics 新增 orphanSweeps/orphanShardsDeleted。手工删除历史大分片（分诊 ①）为删除类写入未获授权、亦无必要。构建 `0.63.2-bridge-chunked-ready`。
- `structure regression`：`test/degraded-storage.cjs` 两阶段 10/10——Phase A（BR-1..5）在 >8MiB 存储夹具上断言分块 ready（BR-1）、读回 2 个种子人物（BR-2）、degraded===false（BR-3）、40 天孤儿分片被清理（BR-4）、ready 放行对照 setSetting 落盘且种子未被覆盖（BR-5）；Phase B（STORE-1..4）用 http:// 页面（适配器按 hostname 匹配、扩展 content script 仅 https）构造有 UI 无隔离桥的 degraded 场景，断言 data:v1/backup:v1 字节不变与警示 UI。旧行为基线以 git worktree 运行 HEAD（0.63.0）实测失败并字节级留证：data:v1 SHA-256 `6be1e28e…`→`4186f9d7…`（2 人合成种子被 1 人空态覆盖）、backup:v1 468→2,365 字节（新增空快照）、无警示 UI、setSetting/addIdentities 均"成功"、BR-1 生产同签名 degraded/8/ready-timeout；修复后全绿。dev-extension 13/13（"就绪快照分块协议两侧同步"与"桥接双层写入门控存在"源码级守卫，旧模板上失败）、run 20/20、dark-mode 通过、product-extension 3/3、`node --check`（源码+生成桥接文件）通过。PLAN 移出已验证的 OB-RULE-004/OB-UI-003（原文见 [2026-10-30 计划收尾归档](plans/2026-10-30-plan-closure.md)）。
- `real-site verified`：2026-10-30 专用 Chrome 登录态只读探针（`node test/maintenance-check.cjs --dedicated-only`，CDP 9222）：扩展刷新到 `0.63.2` 后四可达平台桥接全部 ready（bilibili 1/0、douyin 1/0、weibo 1/0、zhihu 2/0 attempts/rejections），真实读取 bilibili.com/page/... content=8（withIdentity 8/8）、douyin.com/jingxuan/... content=10、weibo.com/page/... content=6 users=6（withIdentity 6/6）、zhihu.com/hot/... 加载但 0 条（既有 blocked）；同轮刷新环节先捕获 `0.63.0` degraded（8 尝试 8 拒绝 ready-timeout）再捕获 `0.63.2` ready（attempts=2），修复前后直接对照。本轮本地门禁（docs governance/userscript syntax/结构回归等）全过；整体 FAILED 仅由既有分类构成——zhihu 无可探测条目 blocked、tieba/x 浏览器级 `Target.getTargets` 超时 failed（entry=null，与桥接无关），签名与 2026-10-28 基线相同。
- 孤儿清理对真实存储的首次生效是用户浏览器加载新构建后自身 `rotate()` 的既有保留期语义（非探针写入）；真实收敛效果可用 `EventLog.status().orphanSweeps/orphanShardsDeleted` 复核，留作下一步验证。
- 边界：测试种子全部人工合成（`p_seed1/2`、`bili:uid:10001/10002` 形态占位）；未读取/导出 Cookie；`out/` 交互实测产物（含 2026-10-29 备份导出）本轮起由 `.gitignore` `/out/` 兜底不入库。
- 发布执行（同轮）：提交信息与 Release 说明见 `scripts/release-notes/v0.63.2-commit.txt`/`v0.63.2-release.md`；`scripts/release-0632.cjs` 创建 tag v0.63.2（指向功能提交）、推送并创建 GitHub Release，随后 curl 核对 raw master 服务 0.63.2；发布回写条目登记 SHA/URL/核对结果。提交前封存深度扫描（MCP `security_scan_start`，deep，聚焦 userscript 与桥接模板/测试）：126 项（20 high + 106 medium，全部 `other-security`），均为既有已分诊两族（userscript 按设计跨域请求告警、本地内存排序比较器误报族，见 v0.58.0 逐条分诊与 `.mimosa/security-policy.json`），无新增族；扫描器 `runStatus=inconclusive`（partial coverage），按流程 §5.3 如实记 inconclusive；scanId `scan-2026-10-29T19-45-12.394Z-7a3d2c8d24dc`，seal `sha256:5db98c93…`。

## 2026-10-29 仓库卫生完善（审计修复，无用户可见行为，摘要）

- 摘要：一次性探针 `_probe_diag4.cjs` 曾被 `b3fdbb1` 意外入库，本轮解除跟踪（本地保留）并以 `.gitignore` 根级锚定 `/_probe_diag*.cjs`、`/_probe_features.cjs`、`.mimosa/` 运行时子目录兜底；修复 `scripts/commit-pending.cjs`（多行提交信息经 `.git/OB_MSG` + `git commit -F`，杜绝字面 `\n` 主题行）、新增 `scripts/commit-worktree.cjs`（消息文件 + `--dry-run`，git 调用全部绕过 shell）。`omniblock.user.js` 零改动（SHA-256 前后一致）；`structure regression`：`node --check`（两个脚本）、docs-check、`git diff --check` 通过。详细边界见提交 `ec31217` 说明。

## 2026-10-28 专用登录态实装验证（v0.60.0~v0.63.0 实装回写）

- `real-site verified`：2026-10-28，用户专用 Chrome 登录态（browser-harness profile，CDP 9222）开发扩展 `0.63.0`/`0.63.0-dark-mode` 实装，runtime 在真实页面确认：脱敏 `bilibili.com/page/...`（首页形态）AI content 记录 8 条、`byKind={"content":8}`、withIdentity=8/8、gearCount=1。基线 `node test/maintenance-check.cjs --dedicated-only`（完整运行约 25 分钟）：41 个检查节全部执行，40 项本地门禁通过（docs governance/userscript syntax/run/quickblock/adapters/performance 等含 `RESULT: … PASSED`），整体 `RESULT: MAINTENANCE SELF-CHECK FAILED`（exit 1）——唯一失败项为 dedicated Chrome login-state real-site probe（exit 1）；legacy dev-browser sync 单独记 `blocked`（退出码 2）。
- 登录态基线读取（页面世界，按平台，2026-10-28 时桥接均 degraded/ready-timeout 8/8，该故障已于 2026-10-30 由 OB-BRIDGE-001 修复）：`bilibili.com/page/...` content=8（verified）；`douyin.com/jingxuan/...` content=49、withIdentity=0/49（verified 内容读取；页面级登录/安全门禁，导航 blocked）；weibo 页面加载但 content=0（failed；2026-09-12 与 2026-10-30 同 profile 均读到 6 条）；`zhihu.com/hot/...` content=0（failed，导航 blocked）；tieba/x 均 `CDP timeout: Target.getTargets`（浏览器级，未取得页面证据）。
- 分步实装细节（v0.60 五分组/名单搜索/最近操作、v0.61 自动分析默认关闭 0 请求、v0.62 快捷拉黑→样本→撤销、v0.63 深色双向断言的逐步探针记录）已回写各版本条目「实装验证」节，本页不再重复；全轮边界：未读取/导出 Cookie；探针标签页已关闭（CDP 目标列表仅剩用户原有标签页）。
- `blocked`：专用扩展桥接 degraded/ready-timeout（历轮既有，诊断见 2026-09-12 条目）；匿名链路知乎登录墙、抖音验证码、X 登录墙、贴吧。新功能逐版本回写见 v0.60.0~v0.63.0 条目「实装验证」节。`structure regression`：本轮测试层修复（OB-MAINT-004，见上节）。

## 2026-10-28 探针发现共享化（OB-MAINT-004，测试层）

- 摘要：新增 test/content-discovery.cjs（Shadow DOM 深度遍历 + 路由形状兜底），discover.cjs 与 dedicated-browser.cjs 内容发现统一走该实现；real-platform-probe.cjs 修复恒定退出 0；夹具 9/9（旧浅层 0 目标→新实现命中 /video/、/question/）。`blocked`：--dedicated-only 专用链路 6 平台桥接 degraded/ready-timeout，签名同 2026-09-12 已知故障（已于 2026-10-30 修复，见 OB-BRIDGE-001）。

## 2026-10-27 dev-extension 遗留用例重构与扫描噪声治理（OB-MAINT-003，已关闭，无用户可见行为）

- 摘要（完整事实见 [PLAN 收尾归档](plans/2026-10-27-plan-closure.md) 与当日交接）：dev-extension 的 loopback AI 网关失效用例降级为直连拒绝断言（11/11，重构前基线 9 过 2 失败）；Mimosa 封存扫描 + `.mimosa/security-policy.json` 基线流程写入 MAINTENANCE_WORKFLOW §5；门禁内置扫描器对约 1MB 单文件多次 ETIMEDOUT 记 inconclusive，原生钩子已卸载，恢复命令 `node "C:/Users/et4vr/.zcode/cli/plugins/cache/zcode-plugins-official/mimosa/1.0.4/payload/dist/cli.js" git-gate install`。

## 2026-10-27 自建界面深色模式（OB-UI-003，v0.63.0，已公开发布）

- 范围：系统深色（`prefers-color-scheme: dark`）时全部自建 UI（设置面板、内容弹窗、审核/反馈浮层、关键词面板、确认气泡/浮层、批量范围面板、待审/后台浮条、行内入口）自动切换深色主题，无独立开关；浅色规则零改动，深色为样式表末尾纯追加媒体查询覆盖段（142 条规则 + `--ob-dark-*` 令牌 + `color-scheme: dark`），零 JS 行为改动。
- `structure regression`：新增 `test/dark-mode.cjs` 18/18（DARK-2 源码级、DARK-1 浏览器级 emulateMedia 双向切换、DARK-3 浅色快捷拉黑链路回归，逐项数字见 [v0.63.0 条目](../changelog/v0.63.0.md)）；run 20/20、userscript-product 7/7、ui-settings 16 项、`node --check`、docs-check、隐私门禁通过，页面/控制台错误 0。
- `blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）；深色为纯 CSS 媒体查询，无平台结构依赖。已知限制见 [v0.63.0 条目](../changelog/v0.63.0.md)。v0.63.0 已公开发布。

## 2026-10-27 已屏蔽内容样本库与规则提炼（OB-RULE-004，v0.62.0，已公开发布）

- 范围：确认拉黑五类提交点（快捷/批量/作品/B站弹幕/AI 审核确认）把正文（截断 240 字）写入本机样本库 `RuleSamples`（独立 GM 键，按平台 LRU 200 条，仅本机，不进 Store 快照/同步/导出/日志）；关键词面板新增样本区（最近 50 条，逐条/批量「转为关键词」走 `DanmakuRules.add` 完整校验）与「AI 归纳提炼规则」（该平台最近 100 条样本发一次性直连请求，候选经人工确认才写入，重复/超限/危险正则被拒并显示原因）。`@version` 0.61.0→0.62.0，构建 `0.62.0-rule-samples`。
- `structure regression`：新增 `test/rule-samples.cjs` 10/10（SOURCE-1 源码级隐私边界 + 入库/去重/LRU/转规则门控/AI 请求形态/失败零写入）；rule-manager 5、quickblock 38、danmaku-auto 8、run 20、product 7、ui-settings 16、work-block 3、comment-manager 3、adapters 28、content-ai 12、content-coverage 6、ai-screening 25、ai-auto-gate 11、ai-autoload 3、state、performance、douyin、real-bilibili-probe --verify-local 全绿；`node --check`、docs-check、隐私门禁通过，页面/控制台错误 0。
- `blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）。已知限制见版本条目：个别锚点不在内容容器内的入口不产生样本；AI 候选仅内存缓存；样本只存正文，不含作者与身份键。v0.62.0 已公开发布。

## 2026-10-27 v0.60.0/v0.61.0 事实路由（已公开发布，详细范围与证据见版本条目）

- v0.61.0（OB-AI-016，ai-auto-gate 11/11 等）：自动分析持久缓存（TTL 7 天/LRU 2000，generation 失效）、自动模式每页最多 3 批 + 上限提示、「自动分析只看评论」开关；手动分析不碰缓存不受限。`blocked`：实页验证暂停。
- v0.60.0（OB-UI-001，ui-settings 16 项等）：设置面板五分组导航、名单搜索/筛选/计数/空态、`undoToastSeconds`（默认 10s）、最近 20 条本地屏蔽操作（独立键，无正文）与自建确认浮层。`blocked`：实页验证暂停。
- 两个版本均已公开发布（tag/Release/raw 已核验）；完整范围、逐项证据与边界见 [v0.61.0 条目](../changelog/v0.61.0.md) 与 [v0.60.0 条目](../changelog/v0.60.0.md)。

## 2026-10-27 关键词/正则规则管理升级（OB-RULE-003，v0.59.0，已发布）

- 规则就地编辑（类型/内容/备注/作用域，内容派生 id 并迁移命中计数）、每条规则本机持久命中计数（`omniblock:rule-hits:v1`，可清零、随删除清理）、规则包导出/导入（去重/上限/危险正则校验）、跨平台作用域；设置面板新增任意页面可达的规则管理按钮，删除旧自动规则死代码并修正 4 处失效文案。详细范围、证据与矩阵数字见 [v0.59.0 条目](../changelog/v0.59.0.md)。
- `structure regression`：新增 `test/rule-manager.cjs` 5/5（旧源码上必然失败）；danmaku-auto 8/8、quickblock 38/38、run 20/20、userscript-product 7/7 等全量矩阵通过。`blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）。

## 2026-10-27 AI 默认仅手动分析与待审浮条（OB-AI-015，v0.58.0，已发布）

- 范围/文件：`omniblock.user.js` 新增 `aiAutoAnalyze` 设置（默认 `false`，随设置快照同步）；`scheduleAuto` 统一拦截自动分析；自动候选改「AI 待审建议」浮条（`#ob-ai-pending`，不再自动弹窗）；AI 面板新增自动开关与本机用量计数（`omniblock:ai-usage:v1`，仅请求/条数/字符，不入同步/导出）；手动分析取消页规则强制。详细范围与状态文案见 [v0.58.0 条目](../changelog/v0.58.0.md)。
- `structure regression`：新增 `test/ai-auto-gate.cjs` 5 项全绿（默认 0 次自动请求、手动免页规则、浮条契约、用量计数与持久化；旧行为失败对照按源码路径推理记录，见该版本条目）；ai-screening 25/25 等全量矩阵通过，页面/控制台错误 0。
- `blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停）；v0.58.0 已随后续发布。
- 安全加固（同轮）：`window.OB` 调试句柄只在显式 `__OB_TEST_HOOKS__` 的测试/探针注入环境挂载，生产页面只有只读 `__OB_RUNTIME_INFO__`；此前恶意页面可改写 AI provider 地址外传本机 Key。Mimosa 深度扫描 125 项逐条分诊：20 个 high 为按设计跨域能力的静态污点告警（真实攻击面即上述句柄暴露，已修复），~90 条 mongo-sort/xss 链核实为误报；细节见 [v0.58.0 条目](../changelog/v0.58.0.md)。
- 既有损坏（非本轮引入）：`test/dev-extension.cjs` 的 loopback AI 桥接用例写入的 `aiGatewayUrl` 在 v0.57.1 直连切换后已从源码移除，该用例结构性过时；修复另立 OB-MAINT-003。
- 用户决策同步：自动候选不打断（并入 OB-AI-015）、名单搜索/筛选（并入 OB-UI-001）、深色模式（OB-UI-003）；否决平台主开关、全局快捷键、新手引导；"从已屏蔽内容提炼规则"立项为 OB-RULE-004。

## 2026-10-27 接手调查与 AI 成本治理规划（无代码改动）

- 用户重启维护，方向：降低 AI API 消费、优化操作体验、升级关键词/正则规则管理；仅源码调查与计划。审计结论（自动分析全开且重访重复计费、规则不可编辑/无计数/无导入导出、面板死代码无分组）由此立项并已全部落地；用户决策同步与否决清单见上一节。

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

v0.63.2 合并发布进行中（见 2026-10-30 条目）。下一项最有价值的验证：发布完成后用修好的桥接做
登录态只读复测（`node test/dev-browser.cjs sync` 后 `node test/maintenance-check.cjs --dedicated-only`
应达 ready、不再 degraded），并核对孤儿分片真实收敛（`EventLog.status().orphanSweeps/orphanShardsDeleted`
与白名单总字符应从 ≈9.1M 回落）；tieba/x `Target.getTargets`
超时与 zhihu 无可探测条目仍为既有另案边界；匿名链路的知乎登录墙/抖音验证码/X 登录墙、贴吧右键证据仍为 `blocked`。
