# OmniBlock 当前维护状态

更新时间：2026-09-07
状态来源：0.48.0 AI 多平台候选；公开版本仍为 0.46.2；历史过程见 [HISTORY_INDEX.md](HISTORY_INDEX.md)。

## 当前版本

- 当前 userscript：`0.48.0`（本地候选）
- 构建：`0.48.0-ai-batched-content-cleanup`
- 当前公开版本：`0.46.2`
- 当前公开功能提交：`acd3b0a47ef56f9a0c662ded8efdb8332aedfff4`
- 最近验证的源码快照：`acd3b0a47ef56f9a0c662ded8efdb8332aedfff4`
- 当前候选源码 SHA-256：`ccb79efbce877ed95c9b2387f3979a57047dd169bbd46e8280f02be6287f76ad`
- 发布状态：0.48.0 尚未提交、push、创建 tag 或 Release；公开的 0.46.2 仍保留原 tag/Release。
- 当前公开 tag/Release：[`v0.46.2`](https://github.com/a2787/ub-utils/releases/tag/v0.46.2)。

## 本轮已落实

- 开发扩展桥使用构建期随机 HMAC、来源/序列校验、存储和只读 URL 白名单；页面不再获得 `window.GM_*`，ready 最多 8 次后降级。
- `RuntimeResources`、freeze/resume/BFCache/pagehide 边界和共享 SPA route 信号已落地；扫描器、循环、订阅和抖音播放器观察器有统一 teardown。
- MutationObserver 回调只排队新增子树；下一帧按 8ms/32 根预算处理，超过 128 根合并为全量请求。三个无效启动补扫已移除。
- B站/微博作者、快速菜单、作品和批量入口改为活动信号触发的一次性防抖；非当前平台不创建活动作者循环。
- EventLog 缓存日期分片字符数；Store/EventLog 与可选诊断分别报告 persist/flush、mutation、扫描和微博布局耗时。
- 设置页显示主名单人物、身份和序列化体积，并在 2 MiB/3 MiB 区间提供软预警；不自动删数据，也不增加人数硬限制。
- 通用生命周期、共享 MutationObserver、脏节点/Shadow DOM 遍历复用；后台暂停非必要工作，恢复前台补同步，一次性 timeout 避免重入。
- 抖音活动播放器/视频会话缓存，自动弹幕规则按当前观察节点处理，避免逐条弹幕递归深扫。
- 抖音弹幕管理器关闭时取消进行中的时间轴扫描，并恢复关闭前播放头与播放状态，避免面板消失后继续拖动播放器。
- B站弹幕 progress/CRC/例外索引、评论管理器和微博评论缓存设置数量上限，只保存必要元数据。
- 被动 DOM/扫描日志改为 10 秒窗口聚合；用户操作、屏蔽/恢复、状态转移和错误仍逐条记录。
- 启动运行锁提前到异步扩展存储恢复栅栏之前建立，持久化失败会返回明确失败状态并抑制备份/provider 的成功后置流程；设置页会提示上次主名单未确认落盘。
- 事件日志达到单日上限时一次性裁剪最近事件；抖音自动弹幕热路径复用已得到的规则匹配结果，通用条目处理也只计算一次屏蔽判定。
- Store 增加惰性 key→人物身份索引；批量导入/作品级批量屏蔽复用索引，外部标签页变化遇到未确认本地写入时报告冲突并保留当前内存状态。
- 评论管理器和楼中楼读取增加页面/面板 generation 与 AbortController 会话边界；关闭、SPA 路由切换或节点回收后的旧结果只安全丢弃，不重新渲染或提交名单。
- 贴吧登录态现代详情页仅增加已捕获的 `.pb-comment-item` + Vue `userInfo.id` 数字身份路径；不透明 `home/main?id` 和首页 `.thread-card` 作者不被猜测。

## 2026-09-06 AI 智能屏蔽第一阶段（OB-AI-001）

- `structure regression`：AI 7/7；gateway mock smoke 通过；run20/20、state9/9、B站36/36、自动弹幕7/7、评论3/3、作品3/3、性能8/8、适配28/28、微博13/13、扩展5/5，均无错误。
- `real-site verified`：2026-09-06 专用 Chrome 的 `bilibili.com/video/...` 显示 0.47.0 AI 区块，AI 关闭未发请求。启用后官方 DeepSeek V4 Flash 经本机 LiteLLM 完成 45/80 条样本及页面附加规则分析，显示“本轮分析完成”；登录状态未判定，未读 Cookie、未点平台写入，未确认候选。隔离只读探针退出码 0：2 根/3 子/5 菜单，3 个子菜单有入口，主评论隐藏/恢复 1 次；根评论分页 partial。
- `blocked`：商汤未配置；多 provider fallback、额度、cooldown 和记忆未联调。未关闭 DeepSeek V4 thinking 时曾超 20 秒，现由 `thinkingMode=disabled` 解决；本地 mock 已验证 429 fallback。OpenClaw 未接入，V2 未改。

## 2026-09-06 AI 多平台采集与一键网关启动（OB-AI-002）

- 范围：保留 B站 AI 评论/弹幕统一采集，新增抖音当前页面已观察评论/弹幕采集、活动视频会话隔离和根目录双击启动文件；不自动展开/滚动、不调用抖音私有接口、不引入 Native Messaging，不改 V2。
- `structure regression`：`node --check omniblock.user.js`、`node test/ai-screening.cjs` 8/8、`node test/ai-platforms.cjs` 5/5、`node test/gateway-smoke.cjs` 完整 Docker smoke、`node test/run.cjs` 20/20、`node test/state.cjs` 9/9、`node test/quickblock.cjs` 36/36、`node test/danmaku-auto.cjs` 7/7、`node test/comment-manager.cjs` 3/3、`node test/work-block.cjs` 3/3、`node test/performance.cjs` 8/8、`node test/dev-extension.cjs` 5/5、`node test/adapters.cjs` 28/28、`node test/douyin.cjs` 2/2 均通过，控制台/页面错误为 0。网关 mock 验证健康、OpenAI 兼容入口、429 fallback、Key/YAML 分离；静态门禁和 2026-09-07 直接运行 `cmd.exe /c "启动网关.cmd"` 均确认包装器只调用 PowerShell 7、不含凭据，且健康检查通过。
- `real-site verified`：2026-09-06 匿名隔离 B站只读探针实际加载 `bilibili.com/video/...` 候选 0.48.0；观察到 2 个根评论、4 个子评论、6 个评论菜单，4 个子评论身份解析成功，评论管理器 6 行，弹幕管理器 23 组/21 个发送者，浮动弹幕 2 条，评论/楼/弹幕入口隐藏恢复通过，错误为 0；根评论分页仍为 partial。未点击平台写入控件，未读取 Cookie。
- `real-site verified`：2026-09-06 同一专用 Chrome 的开发扩展刷新后，新建 B站页面实际运行 `0.48.0-ai-batched-content-cleanup`；设置页出现 AI 区块、loopback 状态和 `启动网关.cmd` 说明，已有开启设置触发实际审核框（80 条单批、62 条候选），本轮关闭审核框，未确认候选或点击平台写入控件。
- `real-site verified`：2026-09-07 用户授权的专用 Chrome 抖音登录态实际运行 0.48.0；当前视频观察到 15 条带发送者身份弹幕、10 条评论，评论/弹幕管理器搜索与批量确认撤销、弹幕悬浮入口和自动规则隐藏恢复均通过，页面错误为 0；未点平台写入控件。
- `blocked`：2026-09-07 同 URL 换片发生真实视频会话键变化，但换片后页面虽有 30 个弹幕 DOM 节点，管理器暂时无可稳定读取的新行，跨视频隔离线上证据仍 blocked；匿名入口验证码阻断保留，未以此判定代码失败。
- 候选边界：本轮没有执行商汤“日日新”配置、真实免费额度耗尽、长期 quota/cooldown 或真实 provider fallback 联调；官方 DeepSeek 的历史联调属于 OB-AI-001，不升级为本项商汤证据。未公开发布。

## 2026-09-07 AI 分析 watchdog、全量分批、抖音正文清洗与超时预算（OB-AI-003~007）

- `structure regression`：watchdog 1/1、探针清理 1/1、抖音 AI 6/6、全量分批 2/2、开发扩展 5/5、桥接降级失败 1/1；userscript 与 service worker 60 秒预算断言通过，页面/控制台错误为 0。
- `real-site verified`：2026-09-07 用户授权专用 Chrome 抖音登录态刷新候选扩展后，当前页观察到 245 条内容；“分析本页”进入 4 批并完成 245/245，审核态 8 条候选，桥接为 `ready`，网关收到 4 次 POST 且均为 HTTP 200，`lastError` 为空，控件尾缀命中 0；未点平台写入控件。
- `blocked`：抖音验证码；换片新行不足；商汤未联调。2026-09-07 Docker engine 已恢复（Model Runner 关闭）；health/models 200、compose healthy；目录保留，数据卷未动。

## 2026-08-29 文档治理重组（本轮）

- 范围：把维护流程、当前事实、版本说明和历史台账拆成知识树；活动文档增加 UTF-8 大小预算、链接和版本门禁，原台账移入只读归档。
- `structure regression`：`node test/docs-check.cjs` 通过；`maintenance-check` 本地部分通过，综合仅因既有真实站点条件 `blocked`，未改 userscript 功能、版本号或发布物。
- 关闭状态：文档重组已本地提交 `a9b531c0c527d7b101492646868065b093f9f164`，未推送远端。

## 2026-08-30 维护控制平面与 0.46.0 候选收口

- 范围：建立唯一活动计划、运行时架构地图和 ADR，并将源码快照、文档预算与发布授权纳入机器门禁；同时完成签名开发桥、teardown、分帧扫描、空轮询清理和性能归因。
- `structure regression`：当时矩阵 116/116、控制台和页面错误均为 0；综合维护检查仅保留抖音验证码与微博顶层虚拟列表样本不足两项 `blocked`。
- 当前计划见 [PLAN.md](PLAN.md)，运行时边界见 [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)；专用 Chrome 已可用于登录态只读验证。

## 2026-09-04 完整审计与真实页面复核

- 范围：只读审查架构、生命周期、扫描、存储、日志、桥接和平台适配，再按真站捕获实施受限核心与贴吧评论修复；不改 `@version`、tag 或 Release。
- 初始矩阵为 116/116、控制台和页面错误为 0；B站、抖音、微博、知乎、贴吧新文档均自动加载候选标记，但平台功能结论仍以各自探针为准。
- `real-site verified`：B站评论、微博正文/楼中楼、抖音精选结构、贴吧首页结构均取得样本；微博顶层 spacer、贴吧 opaque 首页作者、抖音作者入口和知乎/X 登录状态分别保留为 `blocked` 或不纳入支持。
- 发布边界：当前仍只有本地候选，未创建 `v0.46.0` tag、未 push、未创建 GitHub Release；本轮没有执行外部写入。

## 2026-09-04 审计后修复与登录态复核

- `structure regression`：中间检查通过 userscript 语法、文档门禁、通用 UI/运行器 20 项、核心状态 8 项、B站 33 项、自动弹幕 6 项、统一评论管理器 3 项、作品级 3 项、性能边界 8 项、持久扩展 4 项、跨平台适配器 22 项、抖音推荐流 2 项和微博回放 11 项；合计 120 项，控制台与页面错误为 0；最终 121 项见下方收口条目。
- `structure regression`：新增回归覆盖异步扩展恢复期间的重复注入、主名单写入失败返回/备份抑制、设置失败提示和单日日志上限裁剪；新增人工合成贴吧现代 Vue 评论项只接受数字 `userInfo.id`。
- `structure regression`：B站真站探针在评论管理器开闭导致 renderer 可能被回收时重新获取仍连接的目标，并对楼回复确认框进行有界等待；自动发现与显式详情页均完成整楼隐藏/撤销闭环。
- `real-site verified`：2026-09-04 用户本人登录后的专用 Chrome 中，候选源码在 `tieba.baidu.com/p/...` 新隔离标签实际运行；1 个 `.pb-comment-item` 被适配器选中，身份来源为 `dom-vue`，解析出规范 `tieba:uid`，写入测试存储桩后该评论零占位隐藏，页面无登录拦截。没有读取 Cookie，也没有点击贴吧举报、拉黑、关注或发帖控件。
- `real-site verified`：2026-09-04 同一专用 Chrome 的 B站、抖音、微博、知乎、贴吧登录态页面均能显示正常内容并读取运行时；本轮只对贴吧现代评论路径应用平台代码，其他平台不因未捕获新结构而改选择器。
- `blocked`：抖音仍缺少可归属于当前候选的静置/播放/换片 CPU 基线；贴吧首页 `.thread-card` 没有可靠数字作者身份；微博顶层虚拟列表 spacer 和 B站根评论分页仍缺少可测样本。X 按用户要求暂不纳入本轮。

## 2026-09-04 会话边界、身份索引与候选收口

- `structure regression`：本轮最终本地矩阵 121/121：通用 UI/运行器 20、核心状态 9、B站快速屏蔽 33、自动弹幕 6、统一评论管理器 3、作品级屏蔽 3、性能边界 8、持久扩展 4、跨平台适配 22、抖音推荐流 2、微博回放 11；`node --check omniblock.user.js` 通过。
- `real-site verified`：2026-09-04 候选源码在用户授权登录态的抖音详情页只读探针观察到 3 条带身份弹幕、6 条评论、3 行管理器记录，弹幕/评论本地隐藏与恢复通过；播放/暂停阶段的页面 renderer 总量已采样，见下方证据。该探针未读取 Cookie，也未点击平台写入控件。
- `real-site verified`：2026-09-04 候选源码在 B站真实视频页观察到 2 个根评论渲染器、2 个评论菜单和 2 行管理器记录；公开接口返回 3 条根评论和 1 条子回复，本地楼层/整楼隐藏与恢复通过，同楼 5 位作者一次写入后撤销。根评论分页仍部分加载。
- `real-site verified`：2026-09-04 用户授权登录态微博真实页的管理器保留 23 行，可搜索、全选并显示 3 个根楼入口；SPA 路由切换期间旧楼读取安全取消 1 次，未提交名单。贴吧详情页实际选中 1 个 `.pb-comment-item`，来源 `dom-vue`，数字 Vue ID 经过测试存储桩隐藏且无登录拦截。
- `real-site verified`：2026-09-04 开发扩展在专用 Chrome 的 `chrome://extensions` 刷新后，B站、抖音、微博、知乎各打开两个新页面均显示当前候选运行标记；这些无源码注入页面只证明持久加载，不扩大平台功能结论。
- `structure regression`：`node test/maintenance-check.cjs` 的静态门禁、全部本地矩阵、B站隔离探针和微博回放均通过；命令最终以退出码 2 返回 `RESULT: MAINTENANCE SELF-CHECK BLOCKED`，仅汇总抖音验证码与微博 spacer 两项外部阻断。
- `blocked`：抖音换片后平台回收旧节点且没有稳定新评论目标，换片断言未通过；公开隔离入口仍可能停在验证码。微博楼目标在确认前被平台重渲染回收，顶层虚拟列表 spacer 无可测样本；B站匿名管理器根评论分页报告部分加载；知乎热门/详情本轮没有可用评论样本；贴吧首页作者仍只有不透明 portrait 参数。X 按用户要求排除。

## 2026-09-04 微博详情快速滚动收口（OB-WEIBO-002）

- 范围：只调整 `.woo-panel-main` 详情虚拟评论列表的补位累计顺序；当微博回收器快速滚动时临时重排物理行，候选按当前 `translateY` 空间顺序累计隐藏高度，超大/无效基线仍沿用原异常修复路径。没有新增运行模式、诊断模式或其他平台选择器。
- `structure regression`：`node test/weibo-replay.cjs` 当前候选 12/12；将源码切回 `50f2a51` 之前的旧行为运行同一回放时，新“多条隐藏 + 物理行重排 + 快速滚动”断言失败，观测到最大 72px 重叠、288px 空白。
- `real-site verified`：2026-09-04 用户授权登录态专用 Chrome 的 `weibo.com/...` 详情页，在测试存储桩中临时屏蔽 3 条当前评论后进行只读快速上下滚轮；候选源码运行标识与工作区 hash 一致，18 个虚拟行可读，候选采样的活动内容最大重叠约 0.33px，未出现旧版约百像素级的活动内容重叠。测试身份仅保存在本轮内存桩中，未写入真实名单，也未点击平台举报、拉黑、关注或发帖控件。
- 用户体验：用户在该候选标签页连续测试后要求继续收口，未报告主要问题；该反馈与上述真实只读采样共同作为本项收口依据。
- 当前限制：虚拟化导致未挂载占位行之间可能存在正常空间，验收以可见活动评论的重叠/异常空洞和用户滚轮体验为准。候选仍未创建 `v0.46.0` tag、未 push、未创建 GitHub Release。
- 本地提交：源码与人工合成回归为 `50f2a518108b6e54780d3f67d2971a82c5b7cf39`；文档同步提交随后完成。继续观察微博回收器结构变化，若再次出现真实滚动异常另立计划。

## 2026-09-04 微博作品级评论读取候选（OB-WEIBO-003）

- 范围：在不改变屏蔽语义、身份键或运行模式的前提下，把详情页同级评论 wrapper 纳入作品 scope；对 `.vue-recycle-scroller.page-mode.direction-vertical` 采用有限分段读取，并在滚动中保留规范化评论快照；折叠楼中楼只点击当前作品内可确认的回复入口，关闭弹窗后恢复原滚动位置。
- `structure regression`：`node test/work-block.cjs` 3/3；微博人工合成夹具同时验证 page-mode 第二页身份进入名单、相邻作品不被并入，以及带作者链接的回复文本不会导航离开作品页。`node test/adapters.cjs` 28/28，userscript 语法通过。
- `real-site verified`：2026-09-04 用户授权登录态专用 Chrome 的 `weibo.com/...` 详情页候选注入后，作品弹窗一次读取到作品作者 1、主评论作者 49、子评论作者 23–24；确认提交后当前已挂载评论行全部进入隐藏状态，页面 URL 保持不变。读取仍明确标记 `partial`，不把页面显示的评论总数当作已识别用户总数；测试名单仅在本轮内存桩中。
- 当前状态：候选源码尚未提交，等待用户在专用浏览器体验“折叠楼中楼覆盖、提交后滚动残留与页面稳定性”；未创建 `v0.46.0` tag，未 push，未创建 GitHub Release。

## 2026-09-05 微博楼中楼滚动锁回归修复（OB-WEIBO-003）

- 范围：修复作品级读取程序化关闭微博楼中楼后遗留 `html`/`body` 滚动锁的问题；每次打开回复入口前保存页面内联 style，确认本次弹窗已移除后恢复原状态，不改变评论选择器、身份键或平台写入行为。
- `structure regression`：人工合成微博回复控件会设置 `html { overflow: auto hidden; margin-right: 15px; }` 并在关闭时只移除弹窗；`node test/work-block.cjs` 3/3 通过，新增断言要求弹窗数为 0、滚动锁不再为 hidden、页面 style 恢复，旧实现会在该夹具留下滚动锁。
- `real-site verified`：2026-09-05 用户授权登录态专用 Chrome 的 `weibo.com/...` 详情页候选源码中，作品读取展开并关闭真实楼中楼后 `woo-modal-main=0`、`html` 恢复为 `overflow: auto`；提交后 URL 未改变，脚本内存名单写入后 `window.scrollBy` 能从 0 移动到 500。未点击微博举报、官方拉黑、关注或发帖控件。
- 同轮检查：`node test/adapters.cjs` 28/28、`node test/run.cjs` 20/20、`node test/quickblock.cjs` 33/33、`node test/danmaku-auto.cjs` 7/7、`node test/installed-browser-probe.cjs --url=https://weibo.com/...` 两个新页面自动加载当前候选；B站真实只读综合探针功能闭环通过，抖音换片目标不稳定仍记为 `blocked`。
- 当前状态：工作区候选源码哈希为 `272e0f3deafd813c536809bebdff80d0da16f9ee9c3b16535125f09148805f57`，尚未提交；仍需用户在专用浏览器实际体验后再收尾，未创建 `v0.46.0` tag，未 push，未创建 GitHub Release。

## 2026-09-05 微博虚拟行复用与滚动锁异常清理候选（OB-WEIBO-003）

- `structure regression`：新增微博回放断言；已有名单命中身份的视口物理行在滚动帧内重新判定，`node test/weibo-replay.cjs` 13/13、无页面错误。
- `structure regression`：新增作品级延迟楼中楼夹具；弹窗首次挂载晚于旧轮询窗口时仍会关闭并恢复文档滚动样式，`node test/work-block.cjs` 3/3、无页面错误。
- `real-site verified`：2026-09-05 用户授权登录态专用 Chrome 的 `weibo.com/...` 候选页刷新扩展后，作品级屏蔽提交并在多个滚动位置复测；每个位置等待约 300ms 后可见主评论行均为 0，已命中虚拟行进入隐藏路径，页面滚动可继续。滚动中仍会保留微博自己的评论计数、输入框、排序栏和“已加载全部评论”外壳；这些不属于可执行屏蔽评论行。测试身份随后全部移除，名单恢复为 0。
- `real-site verified`：2026-09-05 专用 Chrome 复核知乎评论弹窗（16 条）、“本地拉黑”和“拉黑全部(16)”取消闭环；贴吧现代菜单延迟点击仍识别 Vue 数字身份，批量入口 3 人确认后取消且滚动保留；B站评论/子评论/批量、弹幕工具与悬浮入口及楼层隐藏恢复可见。
- `structure regression`：快捷入口按点击时当前 DOM 优先、portal 断链才回退快照；`node test/quickblock.cjs` 33/33，修复虚拟列表复用菜单的过期身份。
- `real-site verified`：2026-09-05 微博作品读取取消后立即关闭，`html/body` 样式恢复、焦点回到 `BODY`；方向键和脚本滚动均可继续。评论管理器搜索命中 1/66 后批量取消、作者快捷入口取消均未留下本地隐藏。
- 当前状态：0.46.2 B站版本已发布；当前用户 Chrome 的后置安装仍受浏览器安全策略阻断，需安装版本后刷新页面再观察。

## 2026-09-05 跨平台通用悬浮入口移除候选（OB-UI-001）

- 范围：删除跨平台通用 `.ob-block-btn` body 浮层和 document 级 `mouseover` 注入；保留微博「本地拉黑」/「屏蔽该楼回复」、各平台作者/作品/菜单/批量入口及抖音弹幕专用悬浮入口。
- 原因：通用入口在微博与专用评论按钮重复，脱离评论节点的浮层还会随鼠标/滚动反复清理并闪动。
- 代码状态：已移除通用注入和 CSS；`showHoverButton` 仍只控制抖音弹幕专用入口，设置文案和身份提示已收窄。候选源码 SHA-256：`d7be1300786d5a22ee35c4720ae7b10913dae6fb4311d23e495be89ba8257145`。
- 当前证据：`structure regression`：`node test/adapters.cjs` 28/28，微博悬停路径通用按钮为 0、专用按钮保留，抖音弹幕专用入口通过；其余受影响回归（run20/quick33/weibo13/work3/danmaku7/perf8）通过。`real-site verified`：2026-09-05 用户授权登录态专用 Chrome 的 `weibo.com/...` 详情页刷新候选后实际悬停评论行，通用按钮 0，保留 21 个「本地拉黑」和 17 个「屏蔽该楼回复」；用户随后体验悬停、滚动及专用按钮并明确确认无问题，未点击平台写入控件。`blocked`：同轮探针无可测顶层虚拟列表 spacer，与本入口无关。功能提交为 `75ba0f7`，发布快照为 `ba8628e`，已随 `v0.46.0` 发布。
- 浏览器状态：专用 Chrome 只保留一个 `weibo.com/...` 测试标签；本轮未点击平台写入控件，测试浮层和设置面板已清理。

## 汇总证据

### `structure regression`

- 当前 0.48.0 候选的 AI（B站 8/8、抖音 5/5）、通用、状态、B站、弹幕、评论管理器、作品级、性能、开发扩展、适配器、微博回放回归分别按命令记录；
  不用“全绿”替代各项数字。语法、docs check 和 diff check 作为同轮门禁。

### `real-site verified`

- 2026-09-06 匿名隔离 B站探针和专用 Chrome 新页面均实际加载 0.48.0 候选；真实 B站结构结果与 AI 设置/审核框观察见上方 OB-AI-002 条目。
- 其他平台的日期、页面形式、样本量和用户体验保留在各自 dated 条目；B站匿名评论分页仍只按当轮实际样本记证据。

### `blocked`

- 抖音匿名入口验证码阻断线上 AI 采集验证；本机 LiteLLM mock 已通过；官方 DeepSeek 已完成历史本地页面联调，商汤、额度、cooldown 和记忆未联调。平台限制不变。

## 常用命令

```powershell
node test/docs-check.cjs
node test/maintenance-check.cjs
node test/ai-screening.cjs
node test/ai-platforms.cjs
node test/gateway-smoke.cjs
node test/dev-browser.cjs build
node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...
```

专用 Chrome 当前已加载本地 0.48.0 候选；本轮未执行平台写入。
公开的 0.46.2 tag 与 Release 保持不变；0.48.0 未提交、未 push、未创建 tag/Release。

## 下一项最有价值的验证

下一项最有价值的验证是，在专用 Chrome 以当前已加载视频为起点重放一次稳定换片并取得新管理器行；在此之前保留跨视频隔离 `blocked`，不把匿名验证码页当作平台通过，也不公开发布。
