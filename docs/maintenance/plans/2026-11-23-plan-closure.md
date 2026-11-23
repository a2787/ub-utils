# 2026-11-23 Personal 2.0 计划收尾

v0.64.0 已公开发布：commit `b9a7e3e`，tag `v0.64.0`，GitHub Release
<https://github.com/a2787/ub-utils/releases/tag/v0.64.0>，tag 路径 raw 已核验。
以下两项完成实现、验证、文档同步和发布，从活动计划移出。

### OB-UI-004 — Personal 2.0 一键屏蔽核心动线

- status: verified
- priority: P0
- scope: 快捷/作者入口默认直提；批量、弹幕、UID 候选保持确认；`bili:dmhash` 从共享 `.ob-quick` 进入也必须派生 `danmaku` 确认；按设置撤销停留时长可撤销；“撤销上一次”与最近操作兜底；直提提示最多 3 次/打开设置停止。
- non-goals: 不改控制坞收起态/透明度/齿轮；不做新手引导、平台总开关、全局快捷键；不改低调脚本名/@namespace/@updateURL/@downloadURL；不执行平台举报/官方拉黑/关注/发帖。
- dependencies: none
- acceptance: required
  - [x] 快捷/作者入口无确认直提、名单写入、撤销恢复；批量/弹幕/UID 保留确认；`bili:dmhash` 仍弹确认（QB-NC-1/2）。
  - [x] 直提提示最多 3 次、打开设置后停止（QB-NC-3）；撤销上一次与设置 IA 可用；更新检查终态（含 GM 菜单）可见（run E6/I2、quickblock UNDO-LAST）。
  - [x] B站/微博真站门禁与列表/关注流命中记录：2026-11-23 B站公开视频页主/子评论直提、整楼隐藏撤销、楼作者批量通过（隔离探针 exit 0）；微博公开详情页回复行直提隐藏撤销通过；B站列表/关注流未取得带作者目标、微博顶层 spacer 当页缺失，均按 `blocked` 保留；专用 Chrome B站/微博/抖音入口与 bridge ready，知乎无条目、贴吧/X CDP 超时。
- evidence: `structure regression`：quickblock 44/44（含 QB-NC-1/2/3、HEALTH-1/2、UNDO-LAST）、adapters 28/28、run 22/22、state 9/9、rule-manager 5/5、ui-settings 16/16、dark-mode 18/18、degraded-storage 15/15；`real-site verified`：B站主/子评论与整楼、微博回复行、专用 Chrome 三平台入口；发布前全量清单 37 项通过，`v0.64.0` tag/Release/raw 已核验。
- next: 无；列表/关注流与微博虚拟 spacer 留待有可测真实结构时另立计划补验。
- updated: 2026-11-23
- supersedes: none

### OB-MAINT-005 — Health、日志瘦身、测试/CI、文档与发布链

- status: verified
- priority: P0
- scope: Health 聚合存储/备份/日志失败并可见；事件日志 7 天/5 千条/2 MiB；备份读取 detailed API 不覆盖坏数据；设置信息架构与更新检查终态可见；README/docs 减负；CI 差集、code-health 与通用 release 脚本。
- non-goals: 不改 `omniblock:data:v1` schema；不删除名单/备份/撤销；不做全量重写；不新增 npm 依赖；不把 AI 默认开启。
- dependencies: OB-UI-004
- acceptance: required
  - [x] 存储降级/写入失败可见；日志 7 天/5 千条/2 MiB；备份坏数据不覆盖；HEALTH-1/2 通过（quickblock 套件）。
  - [x] CI 保留现有 22 项并补 4 个核心测试 + 7 个本地 headless AI 套件 + code-health；`gateway-smoke` 需 Docker，记 `blocked`。
  - [x] README 9.2 KiB（≤20）、docs-check 通过、usage 拆分与知识树/工作流路由完成；release dry-run 已验证。
  - [x] code-health 基线锁定空 catch 114 / 总行数 23500 / CSS 120000 字符；AI-20 计时阈值改为 600ms。
  - [x] 发布前真站证据按标签记录：`real-site verified`（B站主/子评论与整楼、微博回复行、专用 Chrome B站/微博/抖音入口）；`blocked`（B站列表/关注流、微博顶层 spacer、知乎入口、贴吧/X CDP 超时、gateway-smoke Docker）。
- evidence: `structure regression`：quickblock 44/44、adapters 28/28、run 22/22、state 9/9、rule-manager 5/5、ui-settings 16/16、dark-mode 18/18、rule-samples 10/10、ai-screening 25/25、ai-auto-gate/ai-batch/ai-bridge/ai-context/ai-eval/ai-fact-integration/ai-retrieval 均 exit 0、weibo-replay 13/13、degraded-storage 15/15；`real-site verified`：2026-11-23 B站/微博隔离探针与专用 Chrome 三平台入口读取；code-health 114/22702/116407；README 9,186 B；发布前全量清单 37 项通过，`v0.64.0` tag/Release/raw 已核验。计划与复核台账见 `2026-11-23-personal-2.0-program-plan.md`。
- next: 无；`gateway-smoke` 启动 Docker 后另立补跑项。
- updated: 2026-11-23
- supersedes: none
