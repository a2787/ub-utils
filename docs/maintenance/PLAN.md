# OmniBlock 当前维护计划

更新时间：2026-09-04

本文件是 OmniBlock 唯一的活动计划。它记录当前要解决的问题、范围、依赖、验收条件和
下一步动作；当前事实放在 `CURRENT.md`，用户可见变化放在 README/版本 changelog，已经
结束的计划移入历史索引，不在这里无限累积。

## 使用契约

- 每项计划必须有稳定的 `OB-*` ID；代码、测试、ADR 和交接记录引用该 ID，而不是依赖对话中的临时称呼。
- `status` 只能使用 `proposed`、`approved`、`in_progress`、`verified`、`deferred`、`blocked`、`superseded`。
- `verified` 必须有可追溯证据；`blocked` 必须写明阻断原因和下一步，不能当作通过。
- 依赖必须引用本文件已有 ID，不能形成循环；被替代的计划保留原文并链接新的决定。
- 活动计划接近 24 KiB 时先拆分职责并更新知识树，不能把历史台账继续追加到本文件。

## 状态流转

```text
proposed → approved → in_progress → verified
                                ├→ blocked
                                ├→ deferred
                                └→ superseded
```

## 活动项

### OB-CORE-001 — 单一运行路径的正确性与低开销治理

- status: verified
- priority: P0
- scope: 已证实的启动去重竞态、持久化成功语义、事件日志写放大、热路径重复判定等通用核心路径；保持一个运行模式，诊断详细记录继续由插件内开关控制。扫描时间片与可取消异步任务等尚未实施的优化留在后续性能计划，不在本项冒充完成。
- non-goals: 不新增“第一资源模式”/“低资源模式”或独立“诊断模式”；除独立的 OB-TIEBA-001 外不改变平台选择器、身份规则或屏蔽效果；不处理 X 平台；不执行公开发布、push 或部署。
- dependencies: none
- acceptance: required
  - [x] 启动守卫在异步初始化期间也能原子地阻止重复实例。
  - [x] 持久化失败不会继续宣称成功或触发成功后置流程，并有回归断言。
  - [x] 日志/扫描热路径不引入额外常驻轮询；现有本地矩阵保持通过。
  - [x] 修改前后均有 `node --check`、受影响测试和 `git diff --check` 证据。
  - [x] 每个平台行为变更仍须同轮真实浏览器验证；没有现场结构证据时只做通用核心修复。
- evidence: 2026-09-04 `node test/run.cjs` 20/20、`node test/state.cjs` 9/9、`node test/performance.cjs` 8/8、`node test/adapters.cjs` 22/22 及其余本地矩阵通过；用户授权专用 Chrome 登录态页面均 `readyState=complete` 且运行时可读；X 明确排除。
- next: 启动守卫、持久化失败语义、日志裁剪、抖音规则重复计算、异步任务取消和身份索引缓存均已分项落地；深扫描时间片仍须先取得可归因线上基线，不在本项扩大范围。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/run.cjs; test/state.cjs; test/performance.cjs

### OB-TIEBA-001 — 现代详情评论身份路径

- status: verified
- priority: P1
- scope: 为登录态真站已捕获的 `.pb-comment-item` 增加 Vue `userInfo.id` 数字身份解析和自身容器隐藏；保留旧版 `data-field` 路径。
- non-goals: 不读取或保存 Cookie；不把 `home/main?id` 的 opaque portrait 当作 UID；不猜测首页 `.thread-card` 作者或未加载楼中楼；不处理 X 平台。
- dependencies: OB-CORE-001
- acceptance: required
  - [x] 新增人工合成结构回归，数字 `userInfo.id` 可解析，集合容器不被误选。
  - [x] 旧版 `data-field`、楼中楼集合防护和现有跨平台矩阵保持通过。
  - [x] 2026-09-04 用户授权登录态专用 Chrome 的 `tieba.baidu.com/p/...` 真实详情页选中 1 个 `.pb-comment-item`，来源 `dom-vue`，测试存储桩写入后零占位隐藏。
  - [x] 选择器来自本轮真实 DOM 捕获，未新增首页 `.thread-card` 猜测兜底。
- evidence: `structure regression`：`node test/adapters.cjs` 22/22；`real-site verified`：2026-09-04 登录态贴吧详情页 1 个现代评论项解析/隐藏通过；页面无登录拦截。
- next: 取得第二个现代详情页或可展开楼中楼样本后，复核虚拟回收和多评论项边界；此前不扩展首页帖子作者。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/adapters.cjs

### OB-LIFE-001 — 评论/楼操作异步会话边界

- status: verified
- priority: P1
- scope: 评论管理器、楼中楼读取和作品读取完成后回调的会话校验；页面关闭、路由切换或面板重开时丢弃旧结果。
- non-goals: 不改变任何平台选择器、身份来源或平台请求协议；不把平台写入操作交给脚本；不新增运行模式。
- dependencies: OB-CORE-001
- acceptance: required
  - [x] 关闭或切换路由后，旧评论/楼操作不会重新渲染或提交名单。
  - [x] 旧异步结果只记录安全的取消原因，不保存页面节点或原始内容。
  - [x] B站、抖音、微博本地管理器回归保持通过，并在登录态真实页面完成只读入口核对；微博真实楼目标因平台重渲染无法确认时保持取消，不扩大为通过。
- evidence: `structure regression`：`node test/comment-manager.cjs` 3/3，覆盖管理器关闭、SPA 路由切换、AbortSignal 和取消诊断；`real-site verified`：2026-09-04 抖音详情页管理器 3 行且本地隐藏/恢复通过，微博登录态管理器 23 行/搜索/全选/3 个根楼入口可读，并观察到 1 次路由切换取消；B站当前真实探针管理器 2 行且本地楼层/整楼隐藏与恢复通过。微博实际楼目标被平台回收，确认动作按 `blocked` 保留。
- next: 若后续平台提供稳定楼目标，再复核真实确认动作；当前不修改选择器、不增加运行模式。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/run.cjs; test/comment-manager.cjs

### OB-STORE-001 — 名单身份索引与并发合并

- status: verified
- priority: P1
- scope: Store 内部身份到人物的索引、批量导入/批量屏蔽的重复遍历，以及跨标签页变化的安全合并。
- non-goals: 不改变 v1 导入导出格式、身份规范化规则或用户可见名单语义；不引入云端同步；不执行远程写入。
- dependencies: OB-CORE-001
- acceptance: required
  - [x] 批量添加和导入不再为每个组重复构建完整身份集合。
  - [x] 重复身份仍只归属一个人物，合并结果与现有回归一致。
  - [x] 外部标签页变化不会静默覆盖尚未确认落盘的本地内存变更；冲突有可观测结果。
- evidence: `structure regression`：2026-09-04 `node test/state.cjs` 9/9，人工合成批量身份索引命中/惰性重建、重复身份归属和主名单写入失败后的跨标签页冲突保护均通过；索引只存在于 Store 内存，不改变 v1 导入导出格式。
- next: 观察真实长名单下的 `identityIndex.rebuilds/lookups` 指标；任何跨标签页三方合并或格式变化另立 ADR，不在本项静默扩展。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/state.cjs; test/performance.cjs

### OB-WEIBO-002 — 详情页虚拟评论滚动稳定性

- status: verified
- priority: P1
- scope: 微博帖子详情页 `.woo-panel-main` 的虚拟评论列表；在连续屏蔽多条主评论/楼主评论并快速滚轮时，以当前回收器的空间位置作为补位基线，避免物理行临时重排导致内容层重叠或空白；补充人工合成快速滚动回归和用户授权专用浏览器复测。
- non-goals: 不新增运行模式或独立诊断模式；不降低屏蔽效果；不改用户主页嵌套评论、微博选择器/身份来源、其他平台或 X；不执行平台写入；不在用户确认前收尾、版本发布或公开推送。
- dependencies: OB-CORE-001, OB-LIFE-001
- acceptance: required
  - [x] 人工合成的多条隐藏 + 物理行重排/快速滚动回归在旧行为上失败，在候选行为上无可见内容重叠或异常空白。
  - [x] 既有 `node test/weibo-replay.cjs` 与跨平台矩阵保持通过，身份键、回收占位和撤销恢复语义不变。
  - [x] 2026-09-04 用户授权登录态专用 Chrome 的 `weibo.com/...` 详情页复现问题：快速上下滚轮期间捕获到物理行 DOM 顺序与空间顺序不一致，出现最大约 195px 重叠、345px 空白；候选修复后同一详情页采样活动内容最大重叠约 0.33px，用户体验后未报告主要问题并要求继续收口。
  - [x] 用户确认候选体验无主要问题后，同步 CURRENT/README/版本 changelog 并创建本地提交；push、tag、Release 仍未执行且仍需另行授权。
- evidence: `structure regression`：`node test/weibo-replay.cjs` 当前候选 12/12，旧行为同一回放失败；`real-site verified`：2026-09-04 用户授权登录态专用 Chrome 的微博详情页只读多条临时屏蔽/快速滚轮采样，候选活动内容最大重叠约 0.33px。
- next: 继续观察微博回收器结构变化；若再次出现真实滚动异常，另立计划并先重新捕获当前 DOM，不扩大本项范围。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/weibo-replay.cjs

### OB-RULE-001 — 自动规则正则安全边界

- status: proposed
- priority: P2
- scope: 自动弹幕正则的灾难性回溯风险识别、失败提示和热路径编译缓存。
- non-goals: 不删除用户规则；不改变关键词规则；不为规避风险而关闭自动屏蔽。
- dependencies: OB-CORE-001
- acceptance: required
  - [ ] 明显高风险表达式在保存前被拒绝并给出可理解原因。
  - [ ] 合法表达式只编译一次，匹配过程不重复构造 RegExp。
  - [ ] B站/抖音自动弹幕本地夹具和已授权真实页面只读探针保持通过。
- evidence: pending；先补充人工合成的高风险/合法表达式回归。
- next: 设计保守启发式并评估对现有规则兼容性，必要时先以 warning 方式落地。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/danmaku-auto.cjs; test/state.cjs

### OB-PERF-001 — 可归因的性能预算

- status: in_progress
- priority: P2
- scope: 抖音高频 DOM、深层扫描、虚拟列表、B 站弹幕和日志/存储写入的测量与优化。
- non-goals: 不凭单次主观 CPU 观察修改多个平台的行为。
- dependencies: none
- acceptance: required
  - [x] 能分别报告 mutation、扫描、布局、日志和存储耗时。
  - [x] 有可重复的可见/隐藏/换片场景本地基线和回归阈值。
  - [x] 真实页面无法访问时保留 blocked，不用夹具数字替代。
  - [ ] 取得可归属于当前构建的抖音真实静置、播放和换片基线。
- evidence: `structure regression`：性能边界 8/8；2026-09-04 用户授权登录态抖音详情页只读探针识别 3 条带身份弹幕、6 条评论和 3 行管理器，弹幕/评论本地隐藏与恢复通过，稳定性采样 10 次、心跳错误 0、最大延迟 4ms；播放 4.025 秒 renderer/page 总量为 TaskDuration 0.482075 秒、ThreadTime 0.477392 秒、ScriptDuration 0.095069 秒、LayoutDuration 0.006822 秒、RecalcStyleDuration 0.041989 秒，暂停 4.012 秒分别为 0.345100、0.352478、0.038331、0、0.033411 秒。该指标是页面 renderer 总量，不是插件独占 CPU。换片场景在平台回收旧节点后没有稳定的新目标，按 `blocked` 记录。
- next: 保留播放/暂停数据作为当前候选的页面总量基线；取得稳定换片目标后再补采切换窗口。只有在获得可归因插件指标后，才考虑深扫描时间片或进一步缓存优化；若入口再次验证码阻断，维持 `blocked`。
- updated: 2026-09-04
- supersedes: none
- files: omniblock.user.js; test/performance.cjs; test/real-platform-probe.cjs

### OB-MAINT-001 — 重复路径清理与受控模块化

- status: deferred
- priority: P3
- scope: 已证实不可达的兼容代码、重复测试夹具以及最终 userscript 构建边界。
- non-goals: 不为了“文件变小”而一次性重写全部平台适配器。
- dependencies: OB-PERF-001
- acceptance: required
  - [ ] 每个删除项有调用方审计和替代路径回归。
  - [ ] 若拆分源码，生成产物与元数据、执行顺序和行为保持可比对。
  - [ ] 模块化带来的构建复杂度不高于它解决的维护成本。
- evidence: pending
- next: 等抖音真实基线解除 blocked 后，先做调用方审计；没有明确收益时维持单文件发布物。
- updated: 2026-08-30
- supersedes: none

### OB-REL-001 — CI 与公开发布准备

- status: deferred
- priority: P3
- scope: 本地命令入口、CI status check、源码/构建 hash、版本/tag/Release 一致性。
- non-goals: 不在未获当前任务明确授权时 push、覆盖 tag 或公开发布。
- dependencies: OB-PERF-001
- acceptance: required
  - [ ] 获得 CI/CD 配置修改授权后，CI 可运行不依赖维护者机器上的隐含路径或未锁定依赖。
  - [x] 候选说明分别列出 real-site verified、structure regression 和 blocked。
  - [x] Release 门禁只接受明确授权和可追溯的构建产物。
- evidence: 本地完整矩阵、源码 hash 和发布边界已落地；当前任务未授权修改 CI/CD、push、tag 或 Release。
- next: 用户明确授权 CI/CD 修改时再新增最小工作流；公开发布需另获当轮 push/tag/Release 授权。
- updated: 2026-08-30
- supersedes: none

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
