# 2026-10-30 从 CURRENT.md 移出的 2026-10-27 日期条目存档

本文件是 `docs/maintenance/CURRENT.md` 在 2026-10-30 回写轮（v0.63.2 发布后）为守住 24 KiB 活动文档
预算、回写 0.63.1 专用 Chrome 实装实测与 2026-10-29 数据事故抢救条目而移出的 2026-10-27 日期条目
原文，按当时的记录逐字保留，不追加新的当前状态；条目内相对链接保留移动前的形态。当前事实、
最近证据与限制仍以 [CURRENT.md](../CURRENT.md) 为准；本节日期段的入口见
[HISTORY_INDEX.md](../HISTORY_INDEX.md)。

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

