# OmniBlock 当前维护状态

更新时间：2026-09-13
状态来源：v0.57.2 为公开版本，v0.57.4（撤销右键接管）是当前本地候选；无 hover 控制坞、弹幕点按入口、移动/触控布局、AI 直连、客户端加密同步和独立服务已完成本地回归。东京独立同步服务已部署并取得 HTTPS health 证据；平板线 2026-09-12 起封存待重启，维护重心回到电脑。上一轮 MV3 方案已标记 superseded。历史见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

> 2026-09-13 仓库事故（已修复）：`E:\pluginforchrome\.git` 的对象库与 `refs/` 于当日丢失（`objects/pack` 只剩孤立 `.idx`、
> 无 `.pack`；`git fsck` 对全部 ref 报 invalid sha1 pointer；工作区文件自始至终无损失）。经用户同意后从远端重建：重新克隆
> `git@github.com:a2787/ub-utils.git` 并把校验通过的 `.git` 植入原位，对象库、`refs/heads/master`（`a3a769f`）与
> v0.55.0~v0.57.2 全部 tag 恢复，`git fsck` 无错误；损坏的 `.git` 与孤立索引已备份到
> `%TEMP%\omniblock-broken-git-20260913\`（未删除，可继续排查根因）。唯一无法恢复的是未推送提交 `c025d8b`（v0.57.3），
> 其代码内容完整保留在工作区，并已随本轮提交 `b83003a` 落库。

## 当前版本

- 当前 userscript：`0.57.4`（本轮候选，未公开发布）
- 构建：`0.57.4-native-context-menu`
- 当前公开版本/功能提交：`0.57.2` / `693728aa36fac28aab74c9c80cffc953d4ebb1dc`
- 最近验证的源码快照：`b83003a56b901796cacf25da369dc6642bca4428`
- 当前候选源码 SHA-256：`caacf22786c3722e6a8939338993ee26e1b9d2fdcdeb5feeaf44a33ac784223d`
- 发布状态：v0.57.2 功能提交 `693728a` 已推送到 `origin/master`，`v0.57.2` tag 与 GitHub Release（Latest）已创建，raw 更新地址已服务 `0.57.2`；`v0.57.1`/`v0.57.0` tag/Release 保持不变；未执行平台写入。
- 当前公开 tag/Release：[v0.57.2](https://github.com/a2787/ub-utils/releases/tag/v0.57.2)。

## 2026-09-13 撤销接管右键的本地拉黑菜单（OB-CTX-001，v0.57.4，本地候选）

- 范围/文件：删除"命中评论/帖子条目时接管右键并弹出自建菜单「🚫 拉黑此用户」"的整套实现——`document` 级 `contextmenu`
  捕获监听、`buildContextMenu`、仅供该监听使用的 `findItem`、`#ob-ctx` 样式与引导"试右键"的提示文案（`omniblock.user.js`）。
  平台原生右键菜单、页面上下文操作与此前被 `preventDefault` 掉的功能全部交还页面。
- `structure regression`：`node test/run.cjs` 20/20（C 用例改为断言右键不再被接管且身份仍可解析，旧源码上以
  `{"defaultPrevented":true,"ctxShown":true}` 失败后转通过）；`node test/adapters.cjs` 28/28（贴吧嵌套正文目标与 B站
  Shadow DOM 两处右键用例同样在旧源码上失败后转通过，六平台其余 26 项保持通过）；`quickblock` 38/38、
  `userscript-product` 7/7；页面/控制台错误 0。`run.cjs` D 用例仍覆盖完整拉黑链路：点开"更多"挂载评论菜单 →
  原生菜单旁快捷入口 → 确认气泡 → `bili:uid:333` 进名单且评论隐藏。
- `structure regression`：与 CI 同一组本地矩阵 21/22 脚本退出 0（state、comment-manager、danmaku-auto、work-block、
  performance、weibo-replay、douyin、sync、sync-server、ai-platforms、content-ai、content-coverage、ai-autoload、
  ai-watchdog、probe-hygiene、ai-prompt-system、ai-prompt-eval 等）。
- `real-site verified`：2026-09-13 用户授权恢复实页验证。隔离匿名只读探针 `--verify-local`：脱敏页面形式 `bilibili.com/video/...` 实际命中 2 个评论 renderer、派发 2 次 `contextmenu`，`prevented=0`、`menu=0`；`weibo.com/...` 实际派发 7 次，`prevented=0`、`menu=0`。登录态专用 Chrome（开发扩展 `0.57.4-native-context-menu`，源码 SHA-256 `caacf227…`）：知乎/抖音/X 在扩展活跃（`ob=true`、`#ob-gear`=1、`runtime=0.57.4`）下 `ctxShown=false`、`ctxDefaultPrevented=false`，右键保持原生。新增 `test/dedicated-rightclick-probe.cjs` 用浏览器级 WS + 单次 `Target.attachToTarget` 绕开 Chrome 148 浏览器级 `Target.getTargets` 偶发卡死（页面级 WS 在本机构建上整体不可响应）。
- `blocked`：贴吧在 CDP 驱动下渲染进程卡死（反爬/重资源使 `Runtime.evaluate` 与 `Page.captureScreenshot` 均超时并连带卡死后续会话），无法读取右键状态；属环境限制而非产品回归，需用户在真实登录浏览器手动确认。右键接管本是覆盖全部平台的单一 `document` 级监听，已在 B站/微博/知乎/抖音/X 五平台（扩展均确认活跃）验证移除。
- `structure regression`：`node test/ai-screening.cjs` 25/25 断言通过并退出 0；AI-24 预期 mock HTTP 429 被单独归档为 expected console event，未知 console/page error 仍会使测试失败。
- `blocked`：`node test/dev-browser.cjs sync` 已读到当前 `0.57.4-native-context-menu` 与右键目标，但专用扩展 bridge 在刷新前后均为 `degraded/ready-timeout`，因此不能把专用浏览器完整 AI/存储链路写成 ready；这不是右键证据失败。
- 提交与门禁：产品行为提交为 `b83003a56b901796cacf25da369dc6642bca4428`；本轮接手审计未修改
  `omniblock.user.js`，验证脚本/文档差异与工作区状态须以 `git status --short` 实时核对；`git fsck` 无错误。
  `node --check omniblock.user.js` 通过，`node test/docs-check.cjs` 与 `git diff --check` 均通过。本轮**未 push、未创建
  tag/Release、未部署**，公开发布仍待当轮授权。
- 计划收尾：OB-CTX-001 已转 verified，证据与验收见 [PLAN.md](PLAN.md)；旧日期条目已移至
  [移出存档](plans/2026-09-13-current-dated-archive.md)。

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
v0.57.2 tag 与 Release 已创建并作为当前公开版本；v0.57.4 仍是本地候选，未 push/tag/Release；v0.46.2 的历史 tag/Release 保持不变。0.48.0、0.49.0 和 0.51.1 仍是已推送但没有独立公开 Release 的历史候选。

## 下一项最有价值的验证

`OB-MAINT-002` 的本地门禁与交接提交已完成（维护提交 `bd7ec3b`）；探针只有在命中真实条目、当前版本/build 且事件状态可读时才给出 verified。贴吧真实右键证据仍为 `blocked`，若用户后续明确授权登录态验证，再使用专用 Chrome 手动/只读探针补齐；v0.57.4 的 push/tag/Release 仍需当轮明确授权。
