# OmniBlock 当前维护状态

更新时间：2026-10-28
状态来源：v0.63.0（OB-UI-003 自建界面深色模式）为当前公开版本；v0.60.0（OB-UI-001 设置面板信息架构）、v0.61.0（OB-AI-016 AI 已分析持久缓存与自动批量上限）与 v0.62.0（OB-RULE-004 已屏蔽内容样本库与规则提炼）已于 2026-10-28 同轮公开发布。东京独立同步服务已部署并取得 HTTPS health 证据；平板线 2026-09-12 起封存待重启，维护重心回到电脑。历史见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

> 2026-09-13 仓库事故（已修复）：`E:\pluginforchrome\.git` 对象库与 `refs/` 丢失（工作区无损失），经用户同意从远端重建，v0.55.0~v0.57.2 全部 tag 恢复；唯一无法恢复的未推送提交 `c025d8b`（v0.57.3）的代码内容已随提交 `b83003a` 落库。细节见当时交接与 [v0.57.3 条目](../changelog/v0.57.3.md)。

## 当前版本

- 当前 userscript：`0.63.0`（当前公开版本，已公开发布）
- 构建：`0.63.0-dark-mode`
- 当前公开版本/功能提交：`0.63.0` / `d808e82faa95a9a3b333a2a463a5562b23ed7c28`
- 最近验证的源码快照：`d808e82faa95a9a3b333a2a463a5562b23ed7c28`（v0.63.0 功能提交）
- 当前候选源码 SHA-256：`97d9d02b28d9fa0188e2d1242a69e964c19f96c78b975aeffbc9d74586f9763d`（即 v0.63.0 发布快照）
- 发布状态：v0.63.0 为最新公开版本；`v0.60.0`~`v0.63.0` 四个 tag 与 GitHub Release 均已创建，raw 更新地址已服务 `0.63.0`，发布回写提交 `6c9ef66` 仅改文档不改变功能 tag；未执行平台写入。
- 当前公开 tag/Release：[v0.63.0](https://github.com/a2787/ub-utils/releases/tag/v0.63.0)。

## 2026-10-29 仓库卫生完善（审计修复，无用户可见行为）

- 事实更正（按规则不改写 2026-10-28 条目原文）：该条目与 PLAN OB-MAINT-004 scope 中「临时探针脚本未提交/未入库」的表述不准确——一次性 CDP 诊断探针 `_probe_diag4.cjs` 实际已被提交 `b3fdbb1` 连带入库（`git add -A` + 白名单 reset 漏列第 4 个同名变体所致）。本轮已 `git rm --cached` 解除跟踪（本地文件保留），并以 `.gitignore` 新增 `.mimosa/` 运行时子目录与根级锚定 `/_probe_diag*.cjs`、`/_probe_features.cjs` 兜底；已跟踪的 `.mimosa/security-policy.json` 扫描基线不受影响。
- `scripts/commit-pending.cjs` 修复：多行提交信息改写 `.git/OB_MSG` 后 `git commit -F`（execFileSync 绕过 cmd.exe，附「消息不含字面 \n」断言）——b3fdbb1/446daa1 主题行含字面 `\n` 的缺陷由 `JSON.stringify` + cmd.exe 路径导致，已入库提交不改写；暂存改显式路径数组 + 暂存区断言，移除 `git add -A` 与事后 reset。
- 新增通用提交工具 `scripts/commit-worktree.cjs`（消息文件路径 + `--dry-run`；add -A 后 reset 上述噪声路径、`git commit -F` 消息文件、push origin master；本轮任务明确授权该工具保留 add -A + reset 形态，所有 git 调用绕过 shell，忽略规则同步兜底）。
- 边界：`omniblock.user.js` 零改动（SHA-256 `97d9d02b…763d` 前后一致）；本轮仅仓库工具与维护文档，无用户可见行为，无 CHANGELOG 条目；`structure regression`：`node --check`（两个脚本）、docs-check、`git diff --check` 通过。

## 2026-10-28 专用登录态实装验证（v0.60.0~v0.63.0 实装回写）

- `real-site verified`：2026-10-28，用户专用 Chrome 登录态（browser-harness profile，CDP 9222）开发扩展 `0.63.0`/`0.63.0-dark-mode` 实装，runtime 在真实页面确认：脱敏 `bilibili.com/page/...`（首页形态）AI content 记录 8 条、`byKind={"content":8}`、withIdentity=8/8、gearCount=1。基线 `node test/maintenance-check.cjs --dedicated-only`（完整运行约 25 分钟）：41 个检查节全部执行，40 项本地门禁通过（docs governance/userscript syntax/run/quickblock/adapters/performance 等含 `RESULT: … PASSED`），整体 `RESULT: MAINTENANCE SELF-CHECK FAILED`（exit 1）——唯一失败项为 dedicated Chrome login-state real-site probe（exit 1）；legacy dev-browser sync 单独记 `blocked`（退出码 2）。
- 登录态基线读取（页面世界，按平台）：`bilibili.com/page/...` content=8（verified；bridge degraded/ready-timeout → AI/存储链路记 failed、内容页导航 blocked）；`douyin.com/jingxuan/...` content=49、withIdentity=0/49（verified 内容读取；页面命中登录/安全验证文案门禁，导航 blocked）；weibo 页面加载但 content=0、gate=login-or-security（failed；2026-09-12 曾同 profile 读到 6 条，本轮会话不可用或门禁变化；同日更早的 OB-MAINT-004 专用会话曾读到 6 条，见 [PLAN](PLAN.md)）；`zhihu.com/hot/...` 加载成功但 content=0（failed，导航 blocked）；tieba/x 两条均 `CDP timeout: Target.getTargets`（浏览器级 CDP 对这两个目标超时，与 2026-09-12 记录的故障一致，未取得任何页面证据）。四达平台（bilibili/douyin/weibo/zhihu）桥接均 degraded/ready-timeout（8 attempts/8 rejections）。
- 分步实装（临时探针 `node _probe_features.cjs`，未入库；存储桩与 test/adapters.cjs shim 同构）：A（v0.60.0）真实视频页（脱敏 `bilibili.com/video/...`）设置面板导航恰 5 个分组且顺序 [屏蔽与名单, 规则, 备份与同步, 更新与关于, 日志诊断]、末位 `data-ob-nav-target=ob-group-logs`；名单搜索输入『合成名单A』后列表 3→1 行、计数「显示 1 / 共 3」、清空恢复 3 行；「最近本地屏蔽操作」区块（#ob-recent-actions）存在。B（v0.61.0）AI 面板存在「自动分析新内容」(#ob-ai-auto) 与「自动分析只看评论」(#ob-ai-auto-comments-only) 两开关且默认 checked=false/false，状态栏 #ob-ai-status 含「自动分析已关闭」文案；探针全程惰性传输桩记录出页请求 0 次（未触碰分析按钮，未消耗配额，xhrCalls=0）。C（v0.62.0）先确认脚本使用测试存储桩（`__OB_RUNTIME_GUARD__` 由探针实例持有 duplicate=0、GM 桩已读 `omniblock:data:v1` reads=12）后，在真实评论区条目执行快捷拉黑链路：`.ob-quick` 点击→自建确认浮层 `.ob-ok`→isBlocked=true、桩内名单含该身份、RuleSamples +1（GM 键 `omniblock:rule-samples:v1`）、最近操作 +1；再用设置面板「最近本地屏蔽操作」撤销按钮恢复：isBlocked=false、最近操作回 0、桩内名单移除该身份、计数「显示 3 / 共 3」；全程未点击平台举报/拉黑等官方写入控件。D（v0.63.0）CDP `Emulation.setEmulatedMedia colorScheme=dark` 后设置面板 `.ob-box` 计算背景 rgb(28,32,48)、相对亮度 0.015<0.25、color-scheme=dark；切回 light 恢复 rgb(255,255,255)、亮度 1.000、color-scheme=normal。
- 全轮边界：未读取/导出 Cookie；探针标签页已关闭（CDP 目标列表仅剩用户原有标签页）；git 跟踪文件零改动（仅新增未跟踪临时探针脚本 `_probe_features.cjs`/`_probe_diag*.cjs`，未提交）。
- `blocked`：专用扩展桥接 degraded/ready-timeout（历轮既有，诊断见 2026-09-12 条目）；匿名链路知乎登录墙、抖音验证码、X 登录墙、贴吧。新功能逐版本回写见 v0.60.0~v0.63.0 条目「实装验证」节。`structure regression`：本轮测试层修复（OB-MAINT-004，见上节）。

## 2026-10-28 探针发现共享化（OB-MAINT-004，测试层）

- 新增 test/content-discovery.cjs；discover.cjs 与 dedicated-browser.cjs 内容发现改用同一实现；real-platform-probe.cjs 修复恒定退出 0。夹具 9/9：旧浅层复刻 0 目标→新实现发现 /video/、/question/ 各 1；omniblock.user.js SHA-256 不变；real-bilibili-probe --verify-local、docs-check、maintenance-check 本地全套通过。`blocked`：--dedicated-only 专用链路 6 平台桥接 degraded/ready-timeout，签名同 2026-09-12 已知故障，专项另立。

## 2026-10-27 dev-extension 遗留用例重构与扫描噪声治理（OB-MAINT-003，无用户可见行为）

- `test/dev-extension.cjs`：v0.57.1 直连切换后结构性失效的 loopback AI 网关/事实核查往返用例降级为直连拒绝断言——在开发扩展内恢复直连往返需改 build-dev-extension.cjs 桥接协议（设备 Key 入存储白名单、放行 Authorization 头、service worker 增加 direct-ai 处理器；direct-ai 取回现属正式扩展 `extension/service-worker-extra.js` 产品路径），超出维护非目标。现断言：配置合法 loopback provider 后 analyzePage 因缺设备 Key 有界失败、零 provider 请求离开页面、`setApiKey` 被桥接存储白名单丢弃，并新增“内嵌源码无 aiGatewayUrl”形态守卫；三层白名单静态断言与页面加载/存储共享/伪造消息/有界降级用例全部保留，降级原因写入测试头注释。
- `structure regression`：重构前基线 9 过 2 失败（两个失效往返，`mode: direct`、0 请求）；重构后 dev-extension 11/11、product-extension 3/3、`node --check` 通过；`omniblock.user.js` SHA-256 前后一致（`97d9d02b…763d`），页面/控制台错误 0。`blocked`：实页验证暂停（2026-09-12 起）；本项为测试与文档治理，无用户可见行为，无 CHANGELOG 条目。
- Mimosa 扫描噪声治理：封存深度扫描 + `.mimosa/security-policy.json` 基线流程写入 `docs/MAINTENANCE_WORKFLOW.md` §5。已知限制：门禁内置扫描器对约 1MB 单文件 `omniblock.user.js` 多次 ETIMEDOUT（证据：`.mimosa/finding-ledger/v1/events/*` 中 `scanner_failed…ETIMEDOUT`、`runStatus: inconclusive`），原生钩子已于 2026-10-27 以 `mimosa git-gate uninstall` 卸载；恢复命令：`node "C:/Users/et4vr/.zcode/cli/plugins/cache/zcode-plugins-official/mimosa/1.0.4/payload/dist/cli.js" git-gate install`。inconclusive 结果不得写成通过。

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

v0.60.0~v0.63.0 已于 2026-10-28 公开发布，并在专用登录态完成实装验证（v0.60 五分组/名单搜索/最近操作与撤销、
v0.61 自动分析默认关闭 0 请求、v0.62 快捷拉黑→样本→撤销链路、v0.63 深色双向断言，见 2026-10-28 条目；
v0.61 重访同页 0 重复请求与上限提示、v0.62 AI 归纳真实 provider 请求形态仍未验证）。下一项最有价值的验证：
专用 Chrome 桥接 degraded/ready-timeout 唤醒/重试专项（先试重启专用 Chrome，再按 2026-09-12 诊断修
`test/dedicated-browser.cjs`），恢复后复跑 `node test/maintenance-check.cjs --dedicated-only` 六平台基线
（当前 tieba/x 仍 `Target.getTargets` 超时、weibo 基线本轮 content=0）；匿名链路的知乎登录墙/抖音验证码/
X 登录墙、贴吧右键证据仍为 `blocked`。
