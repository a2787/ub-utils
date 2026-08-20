# OmniBlock 维护与交接台账

这是 OmniBlock 的长期运行记录。改动 userscript 前必须同时阅读本文件与
`AGENTS.md`。`README.md` 面向安装用户；本文件只记录已证实的事实和未解决的边界。

## 仓库地图

| 路径 | 作用 |
|---|---|
| `omniblock.user.js` | 发布给 Tampermonkey 的 userscript，包含全部平台适配器。 |
| `test/run.cjs` | 通用 UI、存储、设置和 Shadow DOM 的浏览器回归夹具。 |
| `test/quickblock.cjs` | B 站评论计数、菜单、弹窗安全、`mid_hash`、protobuf 与 XHR 过滤回归夹具。 |
| `test/adapters.cjs` | 微博、知乎、贴吧、X、抖音的身份契约回归夹具。 |
| `test/real-bilibili-probe.cjs` | 隔离、只读的真实 B 站探针，可启用严格断言。 |
| `test/real-platform-probe.cjs` | 其余平台的隔离、只读真实页面探针。 |
| `test/runtime.cjs` | 浏览器测试的公共启动器；自动确定仓库根目录与可用运行时。 |
| `README.md` | 安装、行为、平台限制和面向用户的验证表。 |

## 验证词汇

- **真实站点已验证**：在生产网站的浏览器中观察到结果。
- **结构回归已验证**：本地夹具或捕获的 DOM 契约通过。必要但不足以证明线上结构未变。
- **受阻**：登录、验证码、限流或数据不可用导致无法继续。

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
6. 仅在用户授权后推送，并报告提交、分支和 Tampermonkey 更新 URL 是否已经指向该提交。

生成的 `test/_*` 探针、截图和 JSON 证据默认只留在本地。它们可用于诊断，但不得被
意外提交。

## 交接条目模板

```text
### YYYY-MM-DD - 版本 - 简短范围
改动：<文件与行为>
证据：<真实站点已验证 / 结构回归已验证 / 受阻，附 URL 与状态>
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

**真实站点已验证**

| 平台 | 日期与会话 | 实际观察到的证据 |
|---|---|---|
| B 站 `https://www.bilibili.com/video/BV1eyYRz2E2v` | 2026-08-20，隔离未登录浏览器 | 解析到 2 位评论作者；左下角可见 `拉黑本页评论用户(2)`；评论菜单顺序为 `复制评论链接 → 加入黑名单 → 本地拉黑 → 举报`；本地拉黑确认框含作者名；`seg.so` 为 `responseType=arraybuffer` 的 XHR。 |
| 微博 `https://weibo.com/` | 2026-08-20，隔离浏览器，虽路由到登录页仍展示公开流 | 从 `article.woo-panel-main`、`/u/<uid>`、user-card 数据解析到 6 张当前卡片和 6 个作者身份。 |

**结构回归已验证**

- `node test/run.cjs`：通用 UI 与 Shadow DOM 共 9/9 通过。
- `node test/quickblock.cjs`：B 站共 8/8 通过，覆盖旧的 34 张卡误计数、真实菜单 `li`
  插入、举报弹窗安全、直接 `mid_hash`、XHR 分段过滤和前导零 CRC32。
- `node test/adapters.cjs`：微博、知乎、贴吧、X、抖音身份契约共 5/5 通过。

**真实验证受阻**

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
缺失时以非零状态退出。这避免了把夹具全绿误当成真实站点通过。

**下一项验证**

在正常登录的 B 站会话中捕获右侧弹幕列表行结构，确认已解析 `mid_hash` 的行会出现
本地拉黑按钮，然后把脱敏后的结构加入 `test/quickblock.cjs`。
