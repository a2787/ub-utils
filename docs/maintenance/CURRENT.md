# OmniBlock 当前维护状态

更新时间：2026-10-27
状态来源：v0.57.4（撤销右键接管）为当前公开版本；无 hover 控制坞、弹幕点按入口、移动/触控布局、AI 直连、客户端加密同步和独立服务已完成本地回归。东京独立同步服务已部署并取得 HTTPS health 证据；平板线 2026-09-12 起封存待重启，维护重心回到电脑。上一轮 MV3 方案已标记 superseded。历史见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

> 2026-09-13 仓库事故（已修复）：`E:\pluginforchrome\.git` 的对象库与 `refs/` 于当日丢失（`objects/pack` 只剩孤立 `.idx`、
> 无 `.pack`；`git fsck` 对全部 ref 报 invalid sha1 pointer；工作区文件自始至终无损失）。经用户同意后从远端重建：重新克隆
> `git@github.com:a2787/ub-utils.git` 并把校验通过的 `.git` 植入原位，对象库、`refs/heads/master`（`a3a769f`）与
> v0.55.0~v0.57.2 全部 tag 恢复，`git fsck` 无错误；损坏的 `.git` 与孤立索引已备份到
> `%TEMP%\omniblock-broken-git-20260913\`（未删除，可继续排查根因）。唯一无法恢复的是未推送提交 `c025d8b`（v0.57.3），
> 其代码内容完整保留在工作区，并已随本轮提交 `b83003a` 落库。

## 当前版本

- 当前 userscript：`0.58.0`（当前公开版本）
- 构建：`0.58.0-ai-manual-first`
- 当前公开版本/功能提交：`0.58.0` / `b0f0f7a`
- 最近验证的源码快照：`b0f0f7a`（AI 手动优先 `ceadc77` + 页面句柄安全门禁 `b0f0f7a`；策略与文档提交在其后）
- 当前候选源码 SHA-256：`fdf5928742caee1556ad3aec412b6c3e52a3f3529fafe0f9e52935fe85a99b29`
- 发布状态：v0.58.0 功能提交已推送到 `origin/master`（头 `8306017`，含安全策略），`v0.58.0` tag 与 GitHub Release（Latest）已创建，raw 更新地址已服务 `0.58.0` / `0.58.0-ai-manual-first`；`v0.57.4`/`v0.57.2`/`v0.57.1`/`v0.57.0` tag/Release 保持不变；未执行平台写入。
- 当前公开 tag/Release：[v0.58.0](https://github.com/a2787/ub-utils/releases/tag/v0.58.0)。

## 2026-10-27 AI 默认仅手动分析与待审浮条（OB-AI-015，v0.58.0 本地候选未发布）

- 范围/文件：`omniblock.user.js` 新增 `aiAutoAnalyze` 设置（默认 `false`，随设置快照同步）；`scheduleAuto`
  统一拦截自动分析（页面加载/路由/内容信号/页面可见全部自动触发点）；`analyzePage` 取消页规则强制；
  自动候选改「AI 待审建议」浮条（`#ob-ai-pending`，不再自动弹窗，点击进同一套多选审核）；AI 面板新增自动开关、
  本机用量计数（`omniblock:ai-usage:v1`，仅请求/条数/字符，不入同步/导出）与"本地名单/关键词已先行处理 N 条"
  提示；状态文案同步。`@version` 0.57.4→0.58.0，构建 `0.58.0-ai-manual-first`。
- `structure regression`：新增 `test/ai-auto-gate.cjs` 5 项全绿（默认 0 次自动请求、手动免页规则、浮条契约、
  用量计数与持久化）；ai-screening 25/25、content-ai 12/12、ai-platforms 7/7、ai-prompt-system 13/13、
  ai-prompt-eval 5/5、ai-fact-integration 4/4、content-coverage 6/6、ai-batch 2/2、ai-autoload 3/3、
  ai-bridge、ai-watchdog、ai-context、run 20/20、quickblock 38/38、danmaku-auto 8/8、userscript-product 7/7；
  页面/控制台错误 0。旧行为失败对照未实跑（写入保护钩子拒绝以 shell 换入旧源码），按源码路径推理记录：
  旧 `start()` 固定 `scheduleAuto(1400)`、`analyzePage('')` 直接报"请先填写本页面附加规则"、自动候选直接
  `showReview`，见 [v0.58.0 条目](../changelog/v0.58.0.md)。
- `blocked`：真实站点验证未执行（2026-09-12 起实页验证暂停，本轮未请求授权）；v0.58.0 未发布。
- 安全加固（同候选内，2026-10-27）：`window.OB` 调试句柄不再无条件暴露给页面脚本——此前恶意页面可改写
  AI provider 地址把本机 Key 发往第三方、篡改名单或外传页面内容；现在只有显式 `__OB_TEST_HOOKS__` 的
  测试/探针注入环境（document-start 时设置）才挂载，生产页面只有只读 `__OB_RUNTIME_INFO__`。全部测试
  夹具/探针/开发扩展构建器已同步声明钩子。Mimosa 深度扫描 125 项逐条分诊：20 个 high 为按设计跨域能力的
  静态污点告警（真实攻击面即上述句柄暴露，已修复）；~55 条 mongo-sort-injection 与 ~35 条 xss 链核实为
  误报（15 处 innerHTML 全为静态模板、动态内容全走 textContent；server.py 为参数化 SQL）；6 条跨文件
  疑似污点指向参数化 SQL 与 mock transport，不成立。分诊细节见 [v0.58.0 条目](../changelog/v0.58.0.md)。
- 既有损坏（非本轮引入）：`test/dev-extension.cjs` 的 loopback AI 桥接用例写入的 `aiGatewayUrl` 在
  v0.57.1 直连切换后已从源码移除，该用例结构性过时；修复另立 OB-MAINT-003。
- 依赖自动分析路径的既有测试 shim 已显式 `aiAutoAnalyze: true`；用户决策同步进计划：采纳"自动候选不打断"
  （并入本项）、名单搜索/筛选（并入 OB-UI-001）、深色模式（新 OB-UI-003）；否决平台主开关、全局快捷键、
  新手引导；"从已屏蔽内容提炼规则"立项为 OB-RULE-004（proposed）。

## 2026-10-27 接手调查与 AI 成本治理规划（无代码改动）

- 用户重启维护，方向：降低 AI API 消费、优化操作体验、升级关键词/正则规则管理。本轮仅源码调查与计划，
  未改 `omniblock.user.js`，未运行平台探针，无新增 `real-site verified` 证据。
- 调查结论（源码审计，非行为断言）：AI 默认关闭（`aiEnabled:false`），但启用后即全自动——`start()` 末尾
  `scheduleAuto(1400)` 起批，路由变化、DOM 新评论/弹幕、seg.so 内容信号、页面重新可见都会再次触发；每批最多
  80 条 / 48,000 字符、串行请求；已分析记录集合 `autoAnalyzedRecordIds` 仅存活于当前页面会话，重访同页重新计费；
  事实核查开启时每批追加第二次 AI 请求；手动「分析本页」要求先填写页面附加规则，无"仅手动"模式。关键词/正则
  规则仅 B站/抖音，支持增删与启停，不可编辑、无每条命中计数、无规则级导入导出；设置面板残留已失去挂载点的
  自动规则死代码与指向失效的文案；面板单列长滚动、无分组导航，「反馈与日志」置于最前。
- 计划更新：新增 OB-AI-015（AI 自动分析独立开关与成本计数，P1）、OB-RULE-003（关键词/正则规则管理升级，P1）、
  OB-AI-016（已分析持久缓存与自动批量上限，P2）、OB-UI-001（设置面板信息架构与操作一致性，P2），均 proposed；
  OB-RULE-001、OB-REL-001、OB-CTX-001、OB-MAINT-002 四个 verified 项移入
  [2026-10-27 计划收尾归档](plans/2026-10-27-plan-closure.md)。实施顺序待用户确认，默认按两个 P1 先行。

## 2026-09-13 撤销接管右键的本地拉黑菜单（OB-CTX-001，v0.57.4，已公开发布）

- 完整日期条目（范围/改动/证据/发布状态）已移入 [2026-09-13 移出存档](plans/2026-09-13-current-dated-archive.md)；当前公开版本与发布状态以本页"当前版本"区为准。

## 2026-09-12 自动弹幕正则安全边界与 CI（OB-RULE-001，v0.57.2，已发布）

- 范围/文件：`omniblock.user.js` 保存入口拒绝明显灾难性回溯正则（嵌套可变重复 `(a+)+` 类、量词分组分支首字符重叠 `(a|aa)+` 类），错误文案可理解；已存规则不回删；`DanmakuRules.status()` 编译计数；`.github/workflows/maintenance.yml` + 锁定依赖 `package.json`/`package-lock.json` 把 22 项本地回归搬进 CI（明确排除真实站点探针）。
- `structure regression`：自动弹幕 8/8（新增 AUTO-REGEX-SAFETY，旧行为上失败后转通过）；quickblock 38/38、适配器 28/28、通用 20/20；维护总检本地项通过。
- `real-site verified`：2026-09-12，用户专用 Chrome 登录态只读探针（扩展桥接部分就绪）：脱敏页面形式 `bilibili.com/page/...` 读到 8 条作品内容；`douyin.com/jingxuan/...` 登录态读到 48 条作品内容（首次取得抖音登录态真实读取，匿名探针此前被验证码阻断）；`weibo.com/page/...` 读到 6 条内容、6 个身份。三条均为内容读取证据，不含评论/弹幕展开与 AI/存储链路。
- `blocked`：专用 Chrome 批量补采仍被桥接故障阻断——B站/抖音/微博/知乎的 AI/存储链路报"桥接未就绪"，tieba/x 报 `Target.getTargets` 超时；换片隔离、B站分页/动态 UID、微博点赞列表、贴吧旧版楼层、抖音性能基线均未覆盖。故障定位：MV3 service worker 休眠后 attach 竞态（`Session with given id not found`），手动重载扩展可临时恢复，需要专门一轮修 `test/dedicated-browser.cjs` 的唤醒/重试。
- `blocked`：商汤 provider 评估与事实检索真实来源——本地配置无任何商汤凭据、事实来源只有 example 配置，等用户提供。
- `structure regression`：CI `maintenance` 工作流转绿（run 34628105864）：22 项本地回归 + 门禁在 ubuntu-latest + 系统 Chrome + 锁定依赖通过，真实站点探针排除在外；迭代修了 checkout 浅克隆、方向键采样、弹幕按钮对中三个测试脆弱点。
- v0.57.3 追加：AI 设置新增「测试连接」（`max_tokens=1` 最小请求即时验证 provider 配置，成功显示延迟、失败给可理解原因），直连批量请求 429/5xx/超时/网络抖动自动重试一次（1.5s 退避，取消与 4xx 不重试）；ai-screening 25 项全绿（AI-24 重试用例旧行为失败后转通过）、userscript product 全绿。适配任意 OpenAI-compatible provider：用户确认将填写官方 DeepSeek API，无需 provider 专项评估。
- 用户决策（2026-09-12）：① OB-AI-001 商汤评估作废（直连 provider 无关，见归档追记）；② 因用户备考使用专注插件（自动关闭社交/娱乐页面），所有实页验证（登录态补采、换片隔离、B站分页/动态 UID、微博点赞列表、贴吧旧版、抖音探针/基线）暂缓，待条件允许恢复；本轮完善只用本地夹具与 mock provider。


## 2026-09-11 Tampermonkey 移动端适配、API 直连与账户同步（OB-TM-001，v0.57.1 已发布，平板线 2026-09-12 封存）

- 范围/文件：`omniblock.user.js` 窄屏/触控、无 hover 控制坞、弹幕点按入口、设备直连 API、GM Key、账户注册/登录与客户端加密同步；`sync/`、`sync-server/` 提供协议/服务回归。`extension/` MV3 实验不属于交付路径。
- `structure regression`：v0.57.1 发布时 product 6/6；通用 20/20、B站 38/38、适配器 28/28、同步核心 7/7、Python 服务 5/5 等受影响回归通过。
- `real-site verified`：2026-09-11，匿名隔离只读会话，脱敏页面形式 `bilibili.com/video/...`；候选 `0.57.1`（源码 SHA-256 `2efe63df…`）实际加载，观察到 2 个评论 renderer、1 条作品内容、2 条评论、77 条弹幕（AI 记录 80 条，79 带身份），内容弹窗 4 个标签，本地拉黑注入与撤销恢复通过，页面/控制台错误 0；不覆盖平板触控与线上同步。
- `real-site verified`：2026-09-11，匿名隔离只读会话，脱敏页面形式 `weibo.com/...`；同一候选实际加载并观察到 1 条帖子内容、53 条评论 AI 记录（48 带身份），平台评论 28 条（13 根行、15 回复行），本地拉黑/撤销恢复通过，页面/控制台错误 0；spacer 未出现，仍记 `blocked`。
- `real-site verified`：2026-09-11，东京机独立 `omniblock-sync` 服务 loopback 与 HTTPS Quick Tunnel `/healthz` 均返回 200；部署源码 SHA-256 与本地 `sync-server/server.py` 一致。
- `blocked`：平板实机触控、真实 provider 与双设备加密合并未取得设备结果，2026-09-12 起随平板线封存待重启；抖音匿名探针停在验证码中间页；Quick Tunnel 无固定域名，重启可能换址。
- 发布状态：v0.57.1 已发布（tag/Release 在 GitHub）；当前 Latest 已由 v0.57.2 接替；未执行平台写入。
- 触控入口手势：入口常驻可见 + 齿轮单次点按进设置；旧两段式手势在触控端 dock 挂载即 expanded，不可满足，已退休。
- 平板 561px+ 触控宽度下紧凑按钮被组件级 min-height 压回 26–34px 的缺陷已在 v0.57.1 内修复（coarse-pointer 组件规则后置覆盖恢复 44px）。
- 计划收尾：2026-09-11 关闭 11 个积压项，2026-09-12 重新启用并完成 OB-RULE-001；终态见 [收尾归档](plans/2026-09-11-plan-closure.md)。

## 2026-09-11 东京独立同步服务首次部署（OB-SYNC-001，deferred，随平板线封存）

- 范围：东京机新增独立 `/opt/omniblock-sync`（server.py、独立 SQLite、systemd 服务、独立 Quick Tunnel）；未改 Vibeme/V2/KB 数据库、代码、网关路由或既有隧道。
- `structure regression`：本地 sync-core 7/7、Python 服务 5/5；服务启用 loopback、独立数据目录、最小权限、不记录请求内容。
- `real-site verified`：2026-09-11，东京机本地 `/healthz` 与独立 HTTPS Quick Tunnel `/healthz` 均返回 200；部署源码与本地 SHA-256 一致。
- `blocked`：真实账户注册/登录、第一台写入、第二台解密合并与墓碑读回未执行；稳定 HTTPS 域名未配置。
- 当前限制：Quick Tunnel 重启可能换址，需两台设备同步更新；API Key、密码、同步口令、令牌和日志不进入服务端同步文档。
- 下一步：随平板线封存；重启时按 [封存记录](plans/2026-09-12-tablet-track-sealed.md) 先单设备注册/合并，再双设备互测。

## 2026-09-11 上一轮 MV3 方案收回（OB-EXT-001，superseded）

- 平板 Edge 的实际安装路径确认以 Tampermonkey userscript 为准，因此不再把 `extension/`、正式 MV3、service worker 或扩展 options 作为本版本交付物；相关源码（含 `--product` 构建分支与 `test/product-extension.cjs`）已归档提交进仓库，未删除，保留复用可能。

## 2026-09-10 作品语境感知的 AI 屏蔽与紧凑协议收口（OB-AI-014，v0.56.0，已发布）

- 范围：B站视频详情页的作品标题/简介、分 P、真实评论父级与弹幕进度进入脱敏 `WorkContext/LocalContext`；`contextSchemaVersion=2` 紧凑线协议；候选默认确认到当前作品 `ScopedBlocks`，全局屏蔽仍需显式选择。
- `structure regression`：上下文契约 CTX-1..9 与受影响 AI/平台/通用/性能回归通过；评测输入增长 `16.95%`、聚合 p95 比值 `1.0014`。
- `real-site verified`：2026-09-10，匿名隔离只读会话，脱敏页面形式 `bilibili.com/video/...`；动态页 99 条记录全部带作品语境；AI mock 确认 2 条弹幕候选只入当前作品作用域，平台写入 0 次；字幕/音频/画面语义保持 `blocked`（远期预留封存）。
- `blocked`：真实内容长期精度无标注集证据；根评论分页仍可能 partial。
- 发布状态：功能提交 `3f94c1bb` 已推送，`v0.56.0` tag 与 [GitHub Release](https://github.com/a2787/ub-utils/releases/tag/v0.56.0) 已创建。详细设计与数据见 [实施方案](plans/2026-09-10-ob-ai-014.md) 与 [v0.56.0 changelog](../changelog/v0.56.0.md)。

## 已发布历史摘要

- v0.54.0 独立 AI 评测与受控事实核查：细节、数据集哈希和真实站点证据见 [v0.54.0 changelog](../changelog/v0.54.0.md)。
- v0.53.1 B 站 AI 后台屏蔽生命周期与 UID 缓存：细节和回滚见 [v0.53.1 changelog](../changelog/v0.53.1.md)。

## 已发布历史路由（详情见版本条目）

- v0.53.0 的事实核查门禁、v0.52.0 的提示词反馈、v0.51.x 的增量 AI/平台入口等历史证据已移入对应 changelog 和历史索引；当前只继承“未核查不等于虚假、候选必须人工确认、平台不写入”的边界。

## 历史事实路由

- 2026-09-08 至 2026-09-09 的 AI 型号、提示词、桥接和反馈证据已归档在对应版本条目；当前运行边界见本页“当前边界摘要”。

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

- 已发布 v0.56.0 基线回归为覆盖 6/6、规则 8/8、提示词 13/13、评测 5/5、内容 AI 12/12、AI screening 23 项、AI 多平台 7/7、自动弹幕 7/7、quickblock 38/38、适配器 28/28、运行器 20/20、扩展 8/8；本轮浏览器回归无页面/控制台错误。
- `node --check omniblock.user.js`、各探针语法检查、docs check 和 diff check 是同轮门禁；历史 AI、网关、生命周期与其他平台结果保留在各自 dated 条目。

### `real-site verified`

- `real-site verified`：2026-09-09 维护总检自动发现 `bilibili.com/video/...` 页面实际读到 1 条作品内容、3 条评论、210 条弹幕，四标签和 3 行评论管理器可见；公开评论 API 返回 3 条根评论、20 条楼中楼回复。`real-site verified`：同轮自动发现 `weibo.com/...` 详情页实际读到 1 条帖子内容、12 条评论 AI 记录，页面评论行 12 条（6 根、6 回复，其中 6 条回复可识别），评论/AI 两标签和 AI 面板可见。其他平台日期、页面形式和样本量保留在各自 dated 条目。

### `blocked`

- 匿名入口的知乎登录墙、贴吧滑块、X 登录墙、抖音验证码、微博 spacer、B站根评论分页和动态 UID 仍按 `blocked`/`partial` 记录；专用 Chrome 不再沿用匿名结论。本轮专用登录态探针只读，未读取凭证或执行平台写入。

## 常用命令

```powershell
node test/docs-check.cjs
node test/maintenance-check.cjs
node test/userscript-product.cjs
node test/ai-screening.cjs
node test/ai-platforms.cjs
node test/content-ai.cjs
node test/ai-autoload.cjs
node test/sync.cjs
node test/sync-server.cjs
node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool --verify-floating-danmaku --verify-auto-danmaku
node test/real-platform-probe.cjs <platform> --verify-local
node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
```

固定专用 Chrome 的 profile 由 `dev-browser sync` 自动核对/刷新；2026-09-13 v0.57.4 右键只读证据见顶部 OB-CTX-001 条目，未执行平台写入。
v0.57.4 tag 与 Release 已创建并作为当前公开版本；v0.57.2/v0.57.1/v0.57.0 的历史 tag/Release 保持不变；v0.46.2 的历史 tag/Release 保持不变。0.48.0、0.49.0 和 0.51.1 仍是已推送但没有独立公开 Release 的历史候选。

## 下一项最有价值的验证

v0.58.0 已公开发布（含 OB-AI-015 与页面句柄安全门禁）；维护重心按已确认顺序推进 **OB-RULE-003（关键词/正则
规则管理升级）**，随后 OB-UI-001 → OB-AI-016 → OB-RULE-004 → OB-UI-003 → OB-MAINT-003。实页验证（新默认值
页面加载 0 次自动 AI 请求、待审浮条交互）待用户恢复授权后用隔离匿名探针 + 专用登录态探针补齐；历史遗留：
贴吧右键证据仍为 `blocked`，专用 bridge 的 `degraded/ready-timeout` 仍需另立专项处理。
