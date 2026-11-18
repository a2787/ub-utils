# 2026-11-18 从 CURRENT.md 移出的早期日期条目存档

本文件是 `docs/maintenance/CURRENT.md` 在 2026-11-18 文档容量治理轮为守住 24 KiB 活动文档预算移出的
较早日期条目原文（2026-09-06 至 2026-10-29），措辞逐字保留；仅按新目录位置修正相对链接路径。
当前页只保留 2026-11-18 与 2026-10-30 最近条目，更多历史见 [HISTORY_INDEX.md](../HISTORY_INDEX.md)。
本归档不追加当前状态；当前事实与限制仍以 [CURRENT.md](../CURRENT.md) 为准。

> 2026-09-13 仓库事故（已修复）：`E:\pluginforchrome\.git` 对象库与 `refs/` 丢失（工作区无损失），经用户同意从远端重建，v0.55.0~v0.57.2 全部 tag 恢复；唯一无法恢复的未推送提交 `c025d8b`（v0.57.3）的代码内容已随提交 `b83003a` 落库。细节见当时交接与 [v0.57.3 条目](../../changelog/v0.57.3.md)。

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

- OB-MAINT-003、OB-UI-003、OB-RULE-004、v0.60.0/v0.61.0 事实路由、OB-RULE-003、OB-AI-015 与接手调查的原始日期条目逐字保存在 [2026-10-30 移出存档](2026-10-30-current-dated-archive.md)；各版本用户可见事实以对应版本 changelog（v0.58.0~v0.63.0）与 [PLAN 收尾归档](2026-10-27-plan-closure.md) 为准。Mimosa 原生钩子当前为卸载状态，恢复命令 `node "C:/Users/et4vr/.zcode/cli/plugins/cache/zcode-plugins-official/mimosa/1.0.4/payload/dist/cli.js" git-gate install`（详见存档 OB-MAINT-003 条目）。
## 2026-09-13 撤销接管右键的本地拉黑菜单（OB-CTX-001，v0.57.4，已公开发布）

- 完整日期条目（范围/改动/证据/发布状态）已移入 [2026-09-13 移出存档](2026-09-13-current-dated-archive.md)；当前公开版本与发布状态以本页"当前版本"区为准。

## 2026-09-11 上一轮 MV3 方案收回（OB-EXT-001，superseded）

- 平板 Edge 的实际安装路径确认以 Tampermonkey userscript 为准，因此不再把 `extension/`、正式 MV3、service worker 或扩展 options 作为本版本交付物；相关源码（含 `--product` 构建分支与 `test/product-extension.cjs`）已归档提交进仓库，未删除，保留复用可能。

## 已发布历史路由（详情见版本条目与 [HISTORY_INDEX.md](../HISTORY_INDEX.md)）

- v0.54.0（独立 AI 评测）、v0.53.1（B站 AI 后台生命周期）、v0.53.0、v0.52.0、v0.51.x 与 2026-09-08/09 的 AI 型号、提示词、桥接和反馈证据均已移入对应版本 changelog 与历史索引；当前只继承“未核查不等于虚假、候选必须人工确认、平台不写入”的边界。

## 2026-09-06 至 2026-09-08 日期条目（已移出活动正文以守住 24 KiB 预算）

- OB-AI-001、OB-AI-002、OB-AI-003、OB-AI-003~007、OB-BILI-001、OB-RULE-002 的原始范围、改动文件、
  证据与当时发布状态逐字保存在 [2026-09-13 移出存档](2026-09-13-current-dated-archive.md)；
  本节只保留仍影响当前版本的边界。
- 仍然生效的边界：B站根评论分页长期为 partial，不能由样本推导全量；抖音匿名入口验证码、知乎登录墙与
  微博 spacer 未被推翻；商汤 provider 与多 provider fallback 从未联调（商汤评估已作废）；抖音一键加载、
  评论/弹幕会话隔离的详细证据在版本条目中，本页不重复。以上项目前仍按未验证处理。


## 2026-11-18 v0.63.3 发布轮工作区状态（逐字移入）

- 工作区状态：本轮回写时仍有未提交文档改动（README/CHANGELOG/MAINTENANCE/PLAN/INDEX/HISTORY_INDEX 六改 + 两新增），非干净。
