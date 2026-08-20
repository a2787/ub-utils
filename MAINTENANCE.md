# OmniBlock 维护与交接台账

这是 OmniBlock 的长期运行记录。改动 userscript 前必须同时阅读本文件与
`AGENTS.md`。`README.md` 面向安装用户；本文件只记录已证实的事实和未解决的边界。

## 仓库地图

| 路径 | 作用 |
|---|---|
| `omniblock.user.js` | 发布给 Tampermonkey 的 userscript，包含全部平台适配器。 |
| `test/run.cjs` | 通用 UI、存储、设置和 Shadow DOM 的浏览器回归夹具。 |
| `test/state.cjs` | 人工合成的核心状态、身份规范化、导入安全和入口生命周期回归。 |
| `test/quickblock.cjs` | B 站评论计数、菜单、弹窗安全、`mid_hash`、protobuf 与 XHR 过滤回归夹具。 |
| `test/adapters.cjs` | 微博、知乎、贴吧、X、抖音的身份契约回归夹具。 |
| `test/douyin.cjs` | 人工合成的抖音推荐流节点复用、跳过上限和延迟守卫回归。 |
| `test/real-bilibili-probe.cjs` | 隔离、只读的真实 B 站探针，可启用严格断言。 |
| `test/real-platform-probe.cjs` | 其余平台的隔离、只读真实页面探针。 |
| `test/runtime.cjs` | 浏览器测试的公共启动器；自动确定仓库根目录与可用运行时。 |
| `README.md` | 安装、行为、平台限制和面向用户的验证表。 |

## 验证词汇

- **`real-site verified`**：在生产网站的浏览器中观察到结果。
- **`structure regression`**：本地夹具或捕获的 DOM 契约通过。必要但不足以证明线上结构未变。
- **`blocked`**：登录、验证码、限流或数据不可用导致无法继续。

不得把三者合并成一个笼统的通过/失败结论。

## 测试运行时

测试不再依赖固定的仓库绝对路径。它们优先使用已安装的 `playwright-core`，也可通过
`PLAYWRIGHT_CORE_PATH` 指定模块路径；Chrome 可通过 `CHROME_PATH` 指定。未设置时，
运行时会尝试常见 Chrome 路径以及本机 WorkBuddy 的开发依赖回退路径。缺少依赖时应
显式报错，不得改成跳过测试。

## 发布流程

1. 阅读 `AGENTS.md`、`README.md` 和本文件，检查脏工作区。
2. 复现问题，并在修复前或同时补上聚焦回归。
3. 运行 `AGENTS.md` 中的最低验证矩阵。
4. 安装体验变化时更新 README；证据或限制变化时在下方追加有日期的交接记录。
5. 发布前提高 userscript `@version`，运行 `git diff --check`，显式暂存后审阅
   `git diff --cached`。
6. 完成要求的验证后，默认提交本次明确范围内的改动，并把当前分支推送到已配置的
   `origin`，无需逐次请求用户授权；用户明确要求暂停、仅修改或不推送时除外。新增或
   更换远端、创建 GitHub Release、修改 Tampermonkey 更新 URL 等实质不同的发布操作
   仍须另行取得用户明确授权。成功后报告提交、远端分支和更新 URL 的实际发布状态。

生成的 `test/_*` 探针、截图和 JSON 证据默认只留在本地。它们可用于诊断，但不得被
意外提交。

## 交接条目模板

```text
### YYYY-MM-DD - 版本 - 简短范围
改动：<文件与行为>
证据：<real-site verified / structure regression / blocked，附 URL 与状态>
检查：<命令与简短结果>
限制：<精确的剩余风险>
发布：<未提交 | 提交 | 已推送分支>
下一步验证：<一项具体动作>
```

## 当前交接

### 2026-08-20 - v0.10.0 - B 站真实 DOM 修复与验证纪律

**已改变的行为**

- B 站批量按钮只统计已加载评论的作者，不再把推荐视频卡当作人，因此旧的错误
  `34` 计数已消除。
- 已支持当前 `bili-comment-menu` Shadow DOM（`#options > li`）。注入的本地拉黑项
  自身是合法 `li`，只有 UID 已解析时才插入，并可在菜单重绘后恢复。
- 没有可识别用户的举报弹窗不再获得无效的本地拉黑项或无意义的 `(0)` 批量控件。
- 页面级入口名为 `拉黑本页评论用户(N)`，真实弹窗打开时会隐藏；不会虚构普通观众
  无法枚举的点赞用户列表。
- B 站弹幕发送者以 `bili:dmhash:<mid_hash>` 保存。userscript 从 protobuf 段读取
  `progress`、`mid_hash`、内容，对已存 B 站 UID 做补零 CRC32 映射，并过滤当前
  `XMLHttpRequest(responseType=arraybuffer)` 的 `seg.so` 路径；fetch 保留为兼容兜底。
- 微博适配器识别当前 `article.woo-panel-main` 信息流卡片，并优先选择带名字的作者链接，
  不选空头像链接。

**`real-site verified`**

| 平台 | 日期与会话 | 实际观察到的证据 |
|---|---|---|
| B 站 `https://www.bilibili.com/video/BV1eyYRz2E2v` | 2026-08-20，隔离未登录浏览器 | 解析到 2 位评论作者；左下角可见 `拉黑本页评论用户(2)`；评论菜单顺序为 `复制评论链接 → 加入黑名单 → 本地拉黑 → 举报`；本地拉黑确认框含作者名；`seg.so` 为 `responseType=arraybuffer` 的 XHR。 |
| 微博 `https://weibo.com/` | 2026-08-20，隔离浏览器，虽路由到登录页仍展示公开流 | 从 `article.woo-panel-main`、`/u/<uid>`、user-card 数据解析到 6 张当前卡片和 6 个作者身份。 |

**`structure regression`**

- `node test/run.cjs`：通用 UI 与 Shadow DOM 共 9/9 通过。
- `node test/quickblock.cjs`：B 站共 8/8 通过，覆盖旧的 34 张卡误计数、真实菜单 `li`
  插入、举报弹窗安全、直接 `mid_hash`、XHR 分段过滤和前导零 CRC32。
- `node test/adapters.cjs`：微博、知乎、贴吧、X、抖音身份契约共 5/5 通过。

**`blocked`**

| 平台 | 阻碍 | 后果 |
|---|---|---|
| B 站右侧弹幕列表 | 隔离会话没有暴露可安全匹配 `mid_hash` 的发送者行。 | 已覆盖段解析与过滤；在正常登录会话确认具体行类名前，不得声称行内按钮已真实验证。 |
| 知乎 | 重定向到登录页。 | 不声称真实信息流或菜单可用。 |
| 贴吧 | 百度安全验证。 | 不声称真实帖子或楼中楼可用。 |
| X | 仅有登录页。 | 不声称真实时间线或菜单可用。 |
| 抖音 | 验证码中间页。 | 不声称真实评论、弹幕或推荐流可用。 |

**探针加固**

`test/real-bilibili-probe.cjs --verify-local` 会等待评论身份水合完成后再断言批量入口，
记录交互前状态，并在生产菜单、身份、批量入口、本地确认框或 `ArrayBuffer` 弹幕路径
缺失时以非零状态退出。这避免了把夹具通过误当成真实站点证据。

**下一项验证**

在正常登录的 B 站会话中捕获右侧弹幕列表行结构，确认已解析 `mid_hash` 的行会出现
本地拉黑按钮，然后把脱敏后的结构加入 `test/quickblock.cjs`。

### 2026-08-20 - v0.11.0 - 核心状态、身份与批量事务加固

**范围与改动文件**

- `omniblock.user.js`：统一身份规范化与导入校验；过滤状态改为即时可逆；扫描器观察
  已发现的 open Shadow Root；批量拉黑逐人存储并一次提交；快捷菜单点击时重新解析
  虚拟列表上下文；B 站弹幕撤销后恢复；抖音支持复用视频节点、`skipCap=0`，并在
  延迟结束前复核视频与作者；补齐 `GM_info` / `@connect` 元数据。
- `test/state.cjs`、`test/douyin.cjs`：新增人工合成状态与抖音安全阀夹具。
- `test/quickblock.cjs`：新增菜单复用、逐人批量事务、精确撤销和弹幕恢复断言。
- `test/run.cjs`：生成截图改写到忽略路径，并增加更新元数据和移动视口断言。
- `README.md`、`MAINTENANCE.md`：同步用户可见行为、联网边界、证据与交接。

**`real-site verified`**

| 平台 | 日期与会话 | URL 与确切结果 |
|---|---|---|
| B 站 | 2026-08-20，隔离未登录浏览器 | `https://www.bilibili.com/video/BV1eyYRz2E2v`：v0.11.0 解析 2 位评论作者；`拉黑本页评论用户(2)` 可见；当前 `bili-comment-menu` 顺序为 `复制评论链接 → 加入黑名单 → 本地拉黑 → 举报`；确认框含具体用户名；捕获 `seg.so` 的 `XMLHttpRequest(responseType=arraybuffer)`。 |
| 微博 | 2026-08-20，隔离未登录公开流 | `https://weibo.com/` 最终路由到公开流登录外壳；当前 `article.woo-panel-main` 候选 6 个，按 `/u/<uid>` / `usercard` 成功解析身份 6/6。 |

**`structure regression`**

- `node test/run.cjs`：11/11，通过通用 UI、Shadow DOM、更新元数据和 390px 移动视口。
- `node test/state.cjs`：6/6，通过状态可逆、晚加载 Shadow DOM、入口生命周期、虚拟列表、身份规范化与纯文本渲染。
- `node test/quickblock.cjs`：11/11，通过 B 站当前捕获结构、逐人批量单次提交、精确撤销、`mid_hash` 与 XHR。
- `node test/adapters.cjs`：5/5，通过五个平台人工合成身份契约。
- `node test/douyin.cjs`：2/2，通过节点复用、无限上限、延迟复核与昵称纯文本渲染。

**`blocked`**

| 平台/范围 | 原因 | 未能声称的结果 |
|---|---|---|
| B 站右侧弹幕列表 | 隔离未登录页没有可安全匹配的发送者行。 | 不声称行内按钮已经过真实页面验证。 |
| 知乎 | `https://www.zhihu.com/hot` 重定向到登录页。 | 不声称真实信息流或菜单可用。 |
| 贴吧 | `https://tieba.baidu.com/f?kw=python` 返回百度安全验证。 | 不声称真实帖子或楼中楼可用。 |
| X | `https://x.com/home` 仅返回登录页。 | 不声称真实时间线或菜单可用。 |
| 抖音 | `https://www.douyin.com/` 标题为“验证码中间页”，没有候选内容。 | 不声称真实评论、弹幕或推荐流可用。 |

**检查、限制与发布**

- 静态门禁：`node --check omniblock.user.js` 与 `git diff --check` 均通过。
- 当前限制：各平台仍只处理 open Shadow DOM；旧版姓名身份会保留在备份中但新适配器不再生成或匹配；真实登录态限制如上表。
- 版本/发布状态：源码已提高为 `0.11.0`；当前未提交、未推送，远端 `origin/master` 仍为 v0.10.0。
- 下一项最有价值的验证：在正常登录的 B 站只读会话中捕获右侧弹幕列表行的脱敏结构，确认 `mid_hash` 到行的匹配与入口位置。

### 2026-08-20 - v0.11.0 - 微博、抖音与贴吧适配器安全边界复核

**范围与改动文件**

- `omniblock.user.js`：扫描器开始观察身份与虚拟列表复用相关属性；抖音评论、搜索卡、
  个人作品列表和推荐流改用本地参考实现的明确契约，遮罩只在文本变化时更新；微博把
  帖子作者与评论作者载体分开，评论只归属自身行且不能回退到提及用户或外层微博；贴吧
  不再把 `.j_lzl_container` / `.lzl_cnt` 楼中楼集合当成单条回复。
- `test/adapters.cjs`：人工合成夹具扩展到 11 项，新增微博评论/搜索、抖音评论兜底/
  搜索/个人页，以及贴吧楼中楼集合拒绝断言。
- `test/douyin.cjs`：验证 `skipCap=0`、复用节点重判、延迟期间作者复核、纯文本昵称和
  遮罩不自激扫描。
- `README.md`、`MAINTENANCE.md`：收紧覆盖承诺并记录最新真实站点证据。

**参考基线**

- 本地 `vendor/Pynseq-Weibo`：v2.4.2，提交 `8021ffe`，2026-08-19。
- 本地 `vendor/Pynseq-Douyin`：v1.6.0，提交 `d829b39`，2026-08-17。
- 这些参考只支持 `structure regression` 选择器契约，不等同于 OmniBlock 已在真实登录页验证。

**`real-site verified`**

| 平台 | 日期与会话 | URL 与确切结果 |
|---|---|---|
| B 站 | 2026-08-20，隔离未登录浏览器 | `https://www.bilibili.com/video/BV1eyYRz2E2v`：严格探针再次解析 2 位评论作者；`拉黑本页评论用户(2)` 可见；当前菜单身份、确认框和 `seg.so` 的 `XMLHttpRequest(responseType=arraybuffer)` 均通过。 |
| 微博 | 2026-08-20，隔离未登录公开流 | `https://weibo.com/` 最终进入公开流登录外壳；6 个候选卡片按 `/u/<uid>` / `usercard` 解析身份 6/6。 |
| 贴吧 | 2026-08-20，隔离未登录浏览器 | `https://tieba.baidu.com/f?kw=python` 正常加载公开主题列表；8 个真实候选中 6 个解析出 `tieba:uid`，2 个无可靠身份的候选没有生成身份。 |

**`structure regression`**

- `node test/run.cjs`：11/11，通过通用 UI、Shadow DOM、更新元数据和移动视口。
- `node test/state.cjs`：6/6，通过状态可逆、晚加载 Shadow DOM、入口生命周期、虚拟列表、身份规范化与纯文本渲染。
- `node test/quickblock.cjs`：11/11，通过 B 站批量事务、菜单复用、精确撤销、`mid_hash` 与 XHR。
- `node test/adapters.cjs`：11/11，通过五个平台的人工合成身份、作者归属和集合边界契约。
- `node test/douyin.cjs`：2/2，通过节点复用、无限上限、延迟复核、纯文本昵称；旧实现的遮罩突变计数为 105，新断言要求不超过 12。

**`blocked`**

| 平台/范围 | 原因 | 未能声称的结果 |
|---|---|---|
| B 站右侧弹幕列表 | 隔离未登录页仍没有可安全匹配的发送者行。 | 不声称行内按钮已在真实页面验证。 |
| 微博评论/原生菜单 | 公开流没有提供可交互的登录态评论上下文。 | `.card-review[comment_id]` 的作者隔离目前只是 `structure regression`。 |
| 知乎 | `https://www.zhihu.com/hot` 重定向到登录页。 | 不声称真实信息流或菜单可用。 |
| 贴吧帖子/楼中楼 | 本轮入口只暴露主题列表，没有可靠的单回复结构。 | 不声称主楼层或楼中楼已真实验证；集合容器保持不扫描。 |
| X | `https://x.com/home` 只返回登录页。 | 不声称真实时间线或菜单可用。 |
| 抖音 | `https://www.douyin.com/` 标题仍为“验证码中间页”。 | 不声称真实评论、搜索、个人作品、弹幕或推荐流可用。 |

**检查、限制与发布**

- 静态门禁：`node --check omniblock.user.js` 与 `git diff --check` 通过。
- 当前限制：仅处理 open Shadow DOM；旧版姓名身份只保留导入兼容；贴吧楼中楼在取得
  可靠单回复结构前不会扫描；其余真实登录态限制如上表。
- 版本/发布状态：源码为 `0.11.0`；未提交、未推送，`origin/master` 仍为 v0.10.0。
- 下一项最有价值的验证：在正常登录的微博只读会话中捕获一条包含 `@提及` 的评论，
  验证本地拉黑评论作者只隐藏该评论行，并将脱敏结构加入 `test/adapters.cjs`。

### 2026-08-21 - v0.11.1 - 评论与弹幕无提示、零占位隐藏

**范围与改动文件**

- `omniblock.user.js`：评论和可识别弹幕固定使用可逆的 `display:none`，不再受灰条模式
  影响；B站根评论按真实 `BILI-COMMENT-THREAD-RENDERER` 隐藏完整线程，楼中楼只隐藏
  自身；B站弹幕列表行增加跨 Shadow DOM 的内联隐藏与恢复。帖子、动态、搜索卡等其他
  内容仍保留灰条/完全消失设置。userscript 版本提高为 `0.11.1`。
- `test/state.cjs`、`test/quickblock.cjs`：人工合成夹具改用已捕获的 B站 thread/renderer
  层级，断言评论高度为 0、无 `.ob-bar`、相邻行补位、楼中楼边界正确且撤销可恢复。
- `test/adapters.cjs`：人工合成的微博、知乎、贴吧、X、抖音评论/弹幕契约新增无提示、
  零占位断言；贴吧正文节点必须提升到完整楼层容器。
- `test/real-bilibili-probe.cjs`：严格模式会等待菜单水合，在隔离内存名单中执行一次
  本地拉黑并撤销；不触发平台官方拉黑或其他站内写操作。
- `README.md`、`MAINTENANCE.md`：同步用户可见行为、真实证据、限制和发布状态。

**`real-site verified`**

- 2026-08-21，隔离未登录浏览器，
  `https://www.bilibili.com/video/BV1eyYRz2E2v`：v0.11.1 解析到 2 位评论作者；本地拉黑
  第一条根评论后，真实 `BILI-COMMENT-THREAD-RENDERER` 高度从 417px 变为 0，
  `.ob-bar` 数量为 0，下一线程相对共同容器上移 417px；撤销后评论恢复。当前菜单仍为
  `复制评论链接 → 加入黑名单 → 本地拉黑 → 举报`，并捕获到 `seg.so` 的
  `XMLHttpRequest(responseType=arraybuffer)`。
- 2026-08-21，隔离未登录公开流，`https://weibo.com/` 最终路由到
  `https://weibo.com/newlogin?...`，当前公开流 6 个候选解析身份 6/6；这只确认公开卡片
  身份路径仍有效，不代表微博评论无痕隐藏已在生产页验证。

**`structure regression`**

- `node test/run.cjs`：11/11，通过通用 UI、Shadow DOM、更新元数据和移动视口。
- `node test/state.cjs`：6/6，通过根评论完整线程、楼中楼边界、零间距、后加载内容、
  总开关恢复和 X 虚拟条目恢复。
- `node test/quickblock.cjs`：11/11，通过 B站完整评论线程、菜单复用、批量事务、弹幕
  列表零占位、撤销和 XHR 数据段过滤。
- `node test/adapters.cjs`：14/14，通过五个平台身份契约及评论/弹幕无提示隐藏。
- `node test/douyin.cjs`：2/2，通过推荐流节点复用、无限上限和延迟复核。
- `node --check omniblock.user.js`、`node --check test/real-bilibili-probe.cjs` 与
  `git diff --check`：均通过。

**`blocked`**

| 平台/范围 | 2026-08-21 阻碍 | 未能声称的结果 |
|---|---|---|
| B站右侧弹幕列表 | 隔离页仍未返回可安全匹配发送者的列表行。 | 列表行零占位隐藏和 `mid_hash` 过滤目前只有 `structure regression`；不能声称列表入口已在生产页验证。 |
| 微博评论 | 未登录公开流没有可交互评论上下文。 | 不声称评论无痕隐藏已真实验证。 |
| 知乎 | `https://www.zhihu.com/hot` 跳转登录页。 | 不声称真实评论或信息流可用。 |
| 贴吧 | `https://tieba.baidu.com/f?kw=python` 返回“百度安全验证”。 | 不声称真实楼层或楼中楼无痕隐藏已验证。 |
| X | `https://x.com/home` 只显示登录页。 | X 条目零占位策略只有 `structure regression`，真实虚拟列表仍需复核。 |
| 抖音 | `https://www.douyin.com/` 标题为“验证码中间页”。 | 不声称真实评论、弹幕或推荐流可用。 |

**检查、限制与发布**

- 当前限制：B站已经缓存进播放器的弹幕需等待下一段加载或刷新后才会被数据段过滤；
  仅处理 open Shadow DOM；拿不到规范身份的条目保持原样。X 的虚拟列表改为零占位后尚无
  真实登录态证据。
- 版本/发布状态：源码为 `0.11.1`；功能提交
  `3df669a700b2173a569762352e18d58ecefe9ded` 已提交并推送到 `origin/master`，现有
  GitHub raw `master` 更新 URL 已提供 v0.11.1。工作区中既有的
  `.workbuddy/memory/2026-08-20.md` 和三张 `test/shot-*.png` 脏改动未暂存、未回退。
- 下一项最有价值的验证：在能返回发送者列表行的隔离 B站视频页复核 `mid_hash` 到行的
  匹配，确认点击本地拉黑后该真实弹幕行高度为 0，并把脱敏结构加入 `test/quickblock.cjs`。

### 2026-08-21 - v0.12.0 - B站楼中楼与独立弹幕屏蔽工具

**范围与改动文件**

- `omniblock.user.js`：B站评论适配器接入生产页实际的
  `bili-comment-reply-renderer`，楼中楼使用自身 `member.mid` 并只隐藏自身；页面批量入口
  改为「拉黑已加载评论作者(N)」，统计当前已加载的根评论与楼中楼作者并按 UID 去重。
- `omniblock.user.js`：从已拦截的 `seg.so` / `list.so` 数据建立当前视频弹幕发送者索引，
  新增固定「弹幕屏蔽(N)」入口、搜索、单条屏蔽、勾选批量、分页和撤销；不依赖原生移动
  弹幕举报菜单或右侧弹幕列表。SPA 切换视频时清空会话索引，最多保留 5000 位发送者。
- `test/state.cjs`、`test/quickblock.cjs`：人工合成夹具改用捕获的真实楼中楼标签；新增菜单
  拉黑、批量计数、弹幕单条/批量事务及 1280px/390px 布局断言。
- `test/real-bilibili-probe.cjs`：支持 `--url=`、楼中楼安全展开、脱敏组件诊断、
  `--verify-sub-comment` 和 `--verify-danmaku-tool`；所有动作只修改隔离内存名单并撤销。
- `README.md`、`MAINTENANCE.md`：同步 v0.12.0 用户行为、验证证据与限制。

**`real-site verified`**

- 2026-08-21，隔离未登录浏览器，
  `https://www.bilibili.com/video/BV1eyYRz2E2v`：生产页返回 2 个
  `BILI-COMMENT-RENDERER` 和 4 个 `BILI-COMMENT-REPLY-RENDERER`，6 个组件均解析出
  独立身份，批量入口显示 `拉黑已加载评论作者(6)`。对子评论执行本地拉黑后，名单命中、
  该回复高度变为 0、根线程保持可见；撤销后回复恢复。
- 同一 URL 和会话捕获 `XMLHttpRequest(responseType=arraybuffer)` 的真实 `seg.so`；
  「弹幕屏蔽」工具当前页列出 7 位已捕获发送者。单条屏蔽与两人勾选批量均写入独立
  `bili:dmhash` 人物记录，确认命中后撤销恢复；未触发任何 B站官方拉黑或站内写操作。
- 同一 URL 的原有根评论严格路径继续通过：完整线程高度从 296px 变为 0，无恢复条，
  下一线程相对共同容器上移 296px，撤销后恢复。

**`structure regression`**

- `node test/run.cjs`：11/11，通过通用 UI、Shadow DOM、更新元数据和移动视口。
- `node test/state.cjs`：6/6，通过根评论与真实标签楼中楼的边界、隐藏和恢复。
- `node test/quickblock.cjs`：15/15，通过楼中楼菜单/计数、批量事务、弹幕工具、响应式
  布局、右侧列表兜底与 XHR 数据段过滤。
- `node test/adapters.cjs`：14/14；`node test/douyin.cjs`：2/2，均通过。
- `node --check omniblock.user.js`、`node --check test/quickblock.cjs`、
  `node --check test/real-bilibili-probe.cjs` 和 `git diff --check`：均通过。

**`blocked` 与限制**

- 2026-08-21 后续访问 `https://www.bilibili.com/video/BV1kS8H6VERt` 时，两个回复容器
  仅显示“共 1 条回复”，有限重试 12 次仍未下发单条楼中楼组件；该轮楼中楼严格探针按
  `blocked` 记录。相同会话的真实弹幕工具仍列出 100 位发送者并完成单条/批量撤销。
- 两个生产 URL 的原生弹幕面板容器均未返回可安全匹配发送者的列表行；原生移动弹幕
  举报菜单和行内入口仍未验证。独立弹幕工具不依赖该结构。
- 弹幕工具只列出当前视频已经收到的数据段，每页 100 位；已进入播放器缓存的移动弹幕
  不能追溯移除，需等待下一数据段或刷新后由过滤器完全消失。

**版本与发布**

- 源码已提高为 `0.12.0`。本条交接将与功能代码一同提交并推送到 `origin/master`；推送
  后现有 GitHub raw `master` 更新 URL 提供 v0.12.0。
- 工作区中既有的 `.workbuddy/memory/2026-08-20.md` 与三张 `test/shot-*.png` 脏改动
  未暂存、未回退；生成的 `_shot_*.png` 诊断截图保持忽略。
- 下一项最有价值的验证：安装 v0.12.0 后，在用户最初报告的视频上确认右下角弹幕工具
  能列出发送者，并复核刷新前后已缓存弹幕的消失时点。
