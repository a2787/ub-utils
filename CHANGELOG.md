# 更新日志

本文件只保留当前版本摘要和稳定入口；完整版本条目见 [docs/changelog/INDEX.md](docs/changelog/INDEX.md)。

## v0.49.0 - 统一内容屏蔽标签弹窗与抖音一键 AI 分析 - 2026-09-07（本地候选，未公开发布）

- B站和抖音各自把评论/弹幕入口合并为一个「内容屏蔽（评论/弹幕）」按钮，弹窗内提供「屏蔽评论」「屏蔽弹幕」「AI 屏蔽」三个标签；AI 配置和分析入口从设置页迁移到第三个标签。
- 抖音 AI 标签页的「加载并分析本页」一次点击依次加载评论、扫描当前视频弹幕时间轴，再把实际观察到的全部记录按批送入 AI，并直接进入原有人工审核框。
- 加载/分析进度可见且可取消；修复播放器播放状态 class 变化误判为换片、导致一键任务停在加载态的问题。仍不调用抖音私有接口、不执行平台写入、不自动确认候选。
- 匿名隔离 B站视频页已实际观察到统一入口、3 个标签、评论/弹幕管理器和浮动弹幕本地屏蔽/撤销；抖音匿名入口仍被验证码阻断。
- 专用 Chrome 登录态真实只读验证完成：`douyin.com/video/...` 当前会话最终分析 365 条记录，弹幕时间轴 55/55，5 批完成 365/365，进入 28 条候选审核，错误为 0。

详细用户变化、验证标签、限制和发布边界：[v0.49.0 完整条目](docs/changelog/v0.49.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.49.0-content-manager-tabs`，仅保留在本地，未 push、未创建 tag/Release；真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.48.0 - AI 多平台采集与一键网关启动 - 2026-09-07（已推送候选，未公开发布）

- 保留 B站 AI 评论/弹幕采集与人工审核，并接入抖音当前页面已观察到的评论和弹幕；身份无法确认的抖音弹幕只读展示，不提供可执行屏蔽。
- 抖音弹幕正文按活动视频会话隔离，同 URL 换片会清理旧 AI 记录；普通弹幕属性变化不会触发重复模型请求，不自动展开/滚动或调用私有接口。
- 根目录新增 [`启动网关.cmd`](启动网关.cmd)，双击即可调用 PowerShell 7 的 `gateway\start.ps1`；不包含 API Key，不修改系统服务/注册表，设置页同步显示说明。
- B站/抖音发往 loopback 网关的请求继续只含规则、临时项目编号、类型和截短正文，候选须人工确认后才写入现有名单。
- 修复本地网关 18 秒请求加 1 次重试超过客户端约 20 秒预算的问题；userscript 与持久开发扩展桥统一留出 60 秒请求上限，同时保留无回调 watchdog。
- AI 现在把当前已观察内容按每批最多 80 条顺序送入网关并合并结果，不再只分析前 80 条；设置页显示批次进度。抖音评论/弹幕 AI 正文会清理末尾“喜欢/举报/回复/分享/展开 N 条回复”等控件词，同时保留正文自身出现的同名词；GM/XHR 桥接无回调时仍会在有限时间内报错。持久开发扩展降级时会快速报告桥接不可用，loopback 地址有效但请求失败时不再附加误导性的地址提示；窄 AI POST 由 service worker 发起，抖音真实探针结束时会清理 document-start 测试注入。

详细用户变化、验证标签、限制和发布边界：[v0.48.0 完整条目](docs/changelog/v0.48.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.48.0-ai-batched-content-cleanup`，源码已推送至 `origin/master` 的 `be6e653`，未创建 tag/Release；真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.47.0 - AI 智能屏蔽第一阶段 - 2026-09-06（历史本地候选，未公开发布）

- 设置面板新增默认关闭的「启用 AI 智能屏蔽」；支持自然语言预设规则、本页面附加规则和「分析本页」入口。
- 第一阶段只分析 B 站当前页已观察到的评论/弹幕；AI 命中结果先进入可多选的本地审核框，确认后才复用现有名单写入链路。
- 只向用户配置的 loopback OpenAI 兼容网关发送截断正文、内容类型、临时项目编号和规则，不发送 UID、弹幕 hash、URL、Cookie 或 API Key；无可靠身份的候选不可执行。
- provider 多配置、自动切换、限流、cooldown 和记忆由外部 LiteLLM/OpenClaw 等网关负责，userscript 不重复实现 router。
- 仓库已附带 LiteLLM Docker 网关向导；DeepSeek V4 可由向导将 thinking mode 设为 `disabled`，本地人工 mock 的健康、兼容入口和 429 fallback
  已通过，官方 DeepSeek provider 已完成本地真实页面联调；商汤 provider、额度和记忆仍为 `blocked`；本候选未 push、未创建 tag/Release。

详细用户变化、验证标签和限制：[v0.47.0 完整条目](docs/changelog/v0.47.0.md)。

发布状态：当前公开版本仍为 [OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)；候选构建为
`0.47.0-ai-screening-phase1`，源码/真实站点边界见[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.46.2 - B站子评论菜单与楼回复入口修复 - 2026-09-05（已发布）

- 将 B站主评论菜单中的楼操作显示为四字短文案「🧵 屏蔽回复」，保持菜单单行；完整功能语义保留在 title/aria-label「屏蔽该楼回复」。
- 识别真实 `BILI-COMMENT-ACTION-BUTTONS-RENDERER` 内的 `#more`/更多图标触发器，使子评论三点菜单打开后能及时补扫并插入「🚫 本地拉黑」。
- 子评论只插入本地拉黑，不插入只适用于主评论的楼回复入口；弹幕举报的 `mid_hash` 安全边界和评论 `bili:uid` 解析保持不变。

详细用户变化、验证标签和限制：[v0.46.2 完整条目](docs/changelog/v0.46.2.md)。

发布状态：`v0.46.2` tag 与 GitHub Release 已创建并推送至 `origin`；当前公开版本为
[OmniBlock v0.46.2](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)。构建为
`0.46.2-bili-subcomment-menu-layout`；当前源码版本/构建和真实站点边界见
[当前维护状态](docs/maintenance/CURRENT.md)。

## v0.46.1 - B站评论举报菜单本地入口回归修复 - 2026-09-05（历史本地候选，未公开发布）

- 修复 B站视频评论菜单中「硬核会员举报」被误判为弹幕举报，导致没有浮动弹幕身份时提前返回、本地入口不再插入的问题。
- 评论菜单继续按当前评论节点解析规范 `bili:uid`；只有非评论菜单的 B站弹幕举报仍要求唯一、未过期的 `mid_hash` 身份。
- 新增人工合成回归覆盖“仅有硬核会员举报”的 `bili-comment-menu`，避免后续菜单文案变体再次绕过本地入口。

详细用户变化、验证标签和限制：[v0.46.1 完整条目](docs/changelog/v0.46.1.md)。

发布状态：`v0.46.1` 仅为本地候选，未 push、未创建 tag 或 GitHub Release；当前公开版本仍为
[OmniBlock 0.46.0](https://github.com/a2787/ub-utils/releases/tag/v0.46.0)。候选构建为
`0.46.1-bili-comment-menu-report`；当前源码版本/构建和未完成的真实站点边界见
[当前维护状态](docs/maintenance/CURRENT.md)。

## 历史版本

上一候选版本 [v0.46.1](docs/changelog/v0.46.1.md)，上一公开版本 [v0.46.0](docs/changelog/v0.46.0.md)；更早条目已移至
[变更日志索引](docs/changelog/INDEX.md) 和只读归档；旧条目中的候选/发布状态只代表当时事实。
