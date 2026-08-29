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
| `test/danmaku-auto.cjs` | 人工合成的 B 站/抖音关键词与正则自动弹幕规则、身份入库、总开关和当前视频隔离回归。 |
| `test/comment-manager.cjs` | 人工合成的三平台统一评论管理器、作者去重、搜索、多选和楼操作回归夹具。 |
| `test/work-block.cjs` | 人工合成的抖音、微博、B 站作品作用域、作者/评论/子评论/弹幕去重、一次事务和撤销回归。 |
| `test/adapters.cjs` | 微博、知乎、贴吧、X、抖音的身份契约回归夹具。 |
| `test/douyin.cjs` | 人工合成的抖音推荐流节点复用、跳过上限和延迟守卫回归。 |
| `test/real-bilibili-probe.cjs` | 隔离、只读的真实 B 站探针，可启用严格断言。 |
| `test/real-douyin-probe.cjs` | 抖音登录态只读探针：连接用户调试浏览器，临时标签页注入内存存储；支持复用专用当前标签页和双视频切换断言。 |
| `test/real-platform-probe.cjs` | 其余平台的隔离、只读真实页面探针。 |
| `test/weibo-replay.cjs` | 基于真实微博虚拟列表契约的本地回放和平台反复回写压力回归；支持 `--git-ref=` 做旧版可失败性复核。 |
| `test/weibo-dom-capture.cjs` | 连接专用 9222 Chrome 的微博 DOM/布局只读捕获器；只接受显式 target，不读取 Cookie 或平台写入控件。 |
| `test/dev-browser.cjs` | 以非默认 profile 和固定 9222 端口幂等启动/复用专用调试 Chrome。 |
| `test/build-dev-extension.cjs` | 从当前 userscript 生成忽略目录中的本地 MV3 开发扩展；不进入发布物。 |
| `test/dev-extension.cjs` | 用临时隔离 profile 打开多平台新文档，验证开发扩展自动加载和 GM 存储桥接。 |
| `test/installed-browser-probe.cjs` | 连接已安装的专用浏览器，只读打开两个新页面核对运行版本/构建和控制坞；不注入源码。 |
| `test/real-login-probe.cjs` | 专用 Chrome 登录态只读探针；导航前注入当前工作区源码、内存 GM 存储和性能诊断，支持运行时 `--url=`、专用窗口 `--current` 和同文档重复注入压力对照。 |
| `test/maintenance-check.cjs` | 顺序执行静态门禁、完整结构矩阵、作品级回归、微博回放和当前源码注入的三平台真站探针。 |
| `test/discover.cjs` | 真实探针的目标发现器：从平台公开入口页选出只读目标并提供脱敏形式。 |
| `test/runtime.cjs` | 浏览器测试的公共启动器；自动确定仓库根目录与可用运行时。 |
| `README.md` | 安装、行为、平台限制和面向用户的验证表。 |
| `CHANGELOG.md` | 按版本维护的用户可见更新日志，也是 GitHub Release 说明基线。 |

## 验证词汇

- **`real-site verified`**：在生产网站的浏览器中观察到结果。
- **`structure regression`**：本地夹具或捕获的 DOM 契约通过。必要但不足以证明线上结构未变。
- **`blocked`**：登录、验证码、限流或数据不可用导致无法继续。

不得把三者合并成一个笼统的通过/失败结论。

## 测试运行时

测试不再依赖固定的仓库绝对路径。它们优先使用已安装的 `playwright-core`，也可通过
`PLAYWRIGHT_CORE_PATH` 指定模块路径；普通页面回归的浏览器可通过 `CHROME_PATH` 指定。
`test/dev-extension.cjs` 默认优先使用可用的 Edge/Chromium，因为当前 Google Chrome 版本会
忽略自动化命令行加载解压扩展的开关；可用 `OMNIBLOCK_EXTENSION_BROWSER_PATH` 显式指定兼容浏览器。
专用 Chrome 的长期运行不是命令行注入：先用 `test/dev-browser.cjs ensure` 启动固定非默认 profile，
再在 `chrome://extensions` 一次性加载 `test/_dev-extension`。缺少依赖时应显式报错，不得改成跳过测试。

## 发布流程

1. 阅读 `AGENTS.md`、`README.md` 和本文件，检查脏工作区。
2. 复现问题，并在修复前或同时补上聚焦回归。
3. 运行 `AGENTS.md` 中的最低验证矩阵。
4. 安装体验变化时更新 README；每个版本更新 `CHANGELOG.md`；证据或限制变化时在下方
   追加有日期的交接记录。
5. 发布前提高 userscript `@version`，确认 changelog 与行为一致，运行 `git diff --check`，
   显式暂存后审阅 `git diff --cached`。
6. 完成要求的验证后，提交明确范围内的改动并推送当前分支；随后创建与 `@version`
   一致的 `vX.Y.Z` tag、推送 tag，并以 changelog 当前版本和三类证据边界创建 GitHub
   Release。用户明确要求暂停、仅修改、不推送或不发布时除外。
7. GitHub Release 是固定 tag、默认不覆盖的版本快照和更新说明；raw `master` 仍是
   Tampermonkey 的移动自动更新地址。新增或更换远端、修改更新 URL、覆盖既有
   tag/Release 必须另行授权。
   发布成功后报告提交、远端分支、tag、Release URL 和 raw 更新状态。

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

### 2026-08-29 - 0.45.0 已发布 - 发布证据回写

**发布结果**

- 功能发布提交为 `17c6c45fe169da3943bd64544155eb5e6056514d`，已推送到 `origin/master`。
- 注释 tag `v0.45.0` 已推送；tag 解引用后的提交与功能发布提交一致。
- GitHub Release 已创建且不是草稿：[OmniBlock 0.45.0](https://github.com/a2787/ub-utils/releases/tag/v0.45.0)。
- 只读核对 GitHub raw master 已返回 `@version 0.45.0` 和
  `0.45.0-persistent-runtime-floating-dock-log-aggregation-performance-resource-bounds`，Tampermonkey 更新出口已移动到本版本。

**证据与限制**

- **`real-site verified`**：发布前的当前 0.45.0 源码在专用 Chrome 隔离、只读真实 `bilibili.com/video/...` 页完成评论、楼操作、
  评论管理器、弹幕管理器、浮动弹幕以及屏蔽/恢复闭环；专用持久扩展的跨平台新页面自动加载链路也已在版本提升前用直接页面级 CDP 核对。
- **`structure regression`**：本地完整矩阵和持久扩展隔离回归均通过，详见本条目下方的 0.45.0 发布收口记录。
- **`blocked`**：源码提升后专用 Chrome 的开发扩展仍需在 `chrome://extensions` 手动刷新才能核对 0.45.0 无注入标记；抖音公开视频入口验证码、
  微博详情页 spacer 条件和一次 B 站导航竞态仍未被改写成通过。

**下一步验证**

用户在 Tampermonkey 中更新到 0.45.0 后，刷新目标平台页面并查看齿轮上的版本/构建标识；维护者继续开发时先运行
`node test/dev-browser.cjs build`，再在专用扩展页手动刷新 `test/_dev-extension`。

### 2026-08-29 - 0.45.0 - 全插件性能与资源效率发布收口

**范围**

本轮将抖音视频页高 CPU 和空闲日志快速增长的修复，以及前一轮的持久开发扩展、控制坞、平台分列、作品级
屏蔽和详细日志能力，统一收口为 0.45.0 发布候选。重点覆盖通用扫描器、MutationObserver 生命周期、Shadow DOM
遍历、弹幕/评论增量收集、缓存边界、日志聚合、页面可见性和专用浏览器自动加载链路。

**改动**

- `omniblock.user.js`：@version/RUNTIME_BUILD 提升到 0.45.0；保留共享页面生命周期、增量脏节点扫描、活动播放器缓存、
  有界评论/弹幕索引和被动日志聚合等性能边界。
- `test/installed-browser-probe.cjs`：改用项目其他登录态探针已经验证可用的直接页面级 CDP，避免 Chrome 148 浏览器级
  `connectOverCDP` handshake 超时把已安装扩展误判为不存在；探针仍只打开两个新页面，禁止源码注入和平台写操作。
- `README.md`、`CHANGELOG.md`：将当前用户可见内容更新到 0.45.0，并明确持久扩展刷新、真实站点证据和外部阻断边界。
- `MAINTENANCE.md`、`.gitignore` 及 `test/` 下相关回归/探针：同步性能、扩展、真实站点和发布维护链路；`test/_*` 生成物继续忽略。

**证据**

- **`structure regression`**：`node test/run.cjs` 16/16、`node test/state.cjs` 7/7、`node test/quickblock.cjs` 33/33、
  `node test/danmaku-auto.cjs` 6/6、`node test/comment-manager.cjs` 3/3、`node test/work-block.cjs` 3/3、
  `node test/performance.cjs` 6/6、`node test/adapters.cjs` 21/21、`node test/douyin.cjs` 2/2、
  `node test/weibo-replay.cjs` 11/11、`node test/dev-extension.cjs` 3/3；userscript 和探针语法检查通过。
- **`real-site verified`**：2026-08-29，专用 Chrome 的隔离、未读取登录态的真实 `bilibili.com/video/...` 页面注入当前
  0.45.0 源码；运行时版本/构建/标记一致，发现 2 个评论渲染器和 2 位评论作者，评论菜单出现「🚫 本地拉黑」与
  「🧵 屏蔽该楼回复」，评论管理器读取 2 行，弹幕管理器读取 100 个文案组/95 位发送者，浮动弹幕发现 27 条；
  单条、批量、主评论楼操作和撤销均完成。
- **`real-site verified`**：2026-08-29，在源码版本提升前，直接页面级 CDP 的无注入持久扩展探针在专用 Chrome 的
  B 站视频页、抖音入口页和微博入口页各打开两个新页面；六个新页面均自动加载 `persistent-dev-extension`，齿轮和控制坞
  初始均为 collapsed。该证据证明一次性安装后的跨平台自动加载链路；由于随后磁盘源码提升到 0.45.0，不能把这批 0.44.0
  快照标记写成当前 0.45.0 已安装证据。
- **`blocked`**：源码提升后重新运行 B 站持久探针，两个新页面仍加载旧 0.44.0 开发扩展快照；需要用户在
  `chrome://extensions` 手动点击开发扩展刷新按钮后，才能完成 0.45.0 无注入核对。维护总门禁另一次 B 站导航遇到执行
  上下文销毁；抖音公开入口停在验证码中间页，微博公开入口没有可安全验证的独立楼中楼作者和活动顶层虚拟列表 spacer，
  因此没有伪造当前候选的抖音 CPU 数字、微博 spacer 通过或 B 站持久 0.45.0 通过。

**检查**

- `node --check omniblock.user.js`：PASS。
- 本地完整矩阵及 `git diff --check`：通过；总维护门禁的本地项目全部通过，真实站点阻断按下述证据保留。
- 当前源码真实 B 站隔离探针：`node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool --verify-floating-danmaku`：PASS，
  运行时 0.45.0，页面与身份标识已脱敏。
- 持久扩展探针：源码提升前的 0.44.0 快照跨 B 站/抖音/微博通过；源码提升后的 0.45.0 核对为 `blocked`，原因是需手动刷新扩展。

**限制**

专用 Chrome 的扩展管理页不允许自动化工具替用户点击刷新；不通过 CDP 绕过。0.45.0 发布后，用户更新 Tampermonkey
即可使用正式 userscript；维护者若要继续使用持久开发扩展，必须先重新构建并在扩展页刷新，再打开新页面。抖音视频解码、
平台自身弹幕渲染和公开入口验证码不属于本脚本可控范围；微博管理器仍只承诺当前路由安全观察到的评论，作品级入口不承诺
平台接口意义上的绝对全量。

**版本/发布状态**

工作区源码已经提升为 `@version 0.45.0`，构建为
`0.45.0-persistent-runtime-floating-dock-log-aggregation-performance-resource-bounds`；当前条目等待显式暂存审阅、
提交、推送 `master`、创建 `v0.45.0` tag 和 GitHub Release。完成后在本条目上方追加实际提交哈希、远端分支、tag 和
Release URL 回写。

**下一步验证**

发布前完成隐私门禁和暂存差异审阅；发布后核对远端 master、v0.45.0 tag、GitHub Release，以及 raw master 中的 0.45.0
userscript 内容。

### 2026-08-29 - 0.44.0 未发布候选 - 全插件性能与资源效率专项收口

**范围**

针对抖音视频页持续高 CPU，以及日志在无操作时快速增长的问题，本轮把优化范围从单个平台热路径扩大到整个
userscript：审计观察器、定时任务、Shadow DOM 遍历、虚拟列表、弹幕收集、评论缓存、日志写入、设置变化和页面
可见性生命周期，并重新检查了 B 站、抖音、微博和通用模块之间的边界。目标是同时降低空闲消耗、避免无界缓存和
DOM 引用滞留、保持用户操作链可追溯，并让页面从后台恢复后仍能补齐必要状态。

**调研与设计依据**

本轮查阅并采用了以下公开资料中的通用原则：Chrome 的脚本示例明确提醒 MutationObserver 有性能成本，应只观察
相关变化；[Chrome MutationObserver 示例](https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-on-every-tab?authuser=117)、
[MDN MutationObserver.observe](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/observe?from=20423)。
页面不可见时暂停非必要工作，恢复时再同步；依据 [MDN Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)。
长任务应拆分或让出主线程；依据 [web.dev Optimize long tasks](https://web.dev/articles/optimize-long-tasks)、
[MDN Prioritized Task Scheduling](https://developer.mozilla.org/en-US/docs/Web/API/Prioritized_Task_Scheduling_API)。
跨 Shadow DOM 遍历必须把开放 ShadowRoot 作为明确边界；依据 [MDN Using shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)。
成熟扩展实现也采用帧调度/有界观察与增量处理，例如 [uBlock contentscript](https://github.com/gorhill/uBlock/blob/master/src/js/contentscript.js)、
[uBlock DOM inspector](https://github.com/gorhill/uBlock/blob/master/src/js/scriptlets/dom-inspector.js) 和
[Dark Reader dynamic theme](https://github.com/darkreader/darkreader/blob/main/src/inject/dynamic-theme/modify-css.ts)。

据此形成三层方案：P1 先消除无条件和重复工作，P2 再缩小观察/扫描范围并复用稳定元数据，P3 最后用上限、可见性
和回归计数把长期运行边界固定下来。没有把 `requestIdleCallback` 当作唯一依赖，因为它在部分浏览器/忙碌页面上
可能长期推迟；低频一次性 timeout、页面可见性和脏标记组合更适合本脚本的兼容范围。

**已落实**

- P1 生命周期与调度：增加共享页面可见性生命周期和一次性 timeout 循环；隐藏标签页断开主观察器并暂停非必要循环，
  回到前台再补全扫描；关闭设置时对快捷/批量入口同步清理，避免 inactive loop 无法唤醒造成入口残留或重建。
- P1 观察与扫描：主扫描器共用一个 MutationObserver，按新增子树、相关祖先和非样式属性变化建立 dirty 集合；
  首轮/路由变化才做全量扫描，后续只处理脏节点；同一次开放 Shadow DOM 遍历复用多个选择器；被屏蔽容器清理只遍历
  已登记集合，不再反复深扫整页。
- P2 平台热路径：抖音活动播放器根节点和视频会话键缓存到稳定边界，弹幕自动规则仅处理当前会话已观察节点；
  B 站弹幕列表按内容建立 progress 索引和 CRC/例外缓存；作者、快速入口、批量入口、作品入口和评论相关循环均改为
  活动置脏后低频合并刷新；微博虚拟列表只在相关变化时触发布局同步。
- P2 评论与日志：统一评论管理器、微博评论缓存和批量入口缓存只保存元数据，不持有虚拟列表 DOM 引用，并设置
  20,000/5,000 等明确上限；document-start 后在 DOMContentLoaded 使首轮缓存失效，补发现后续 Shadow DOM 评论；
  用户操作/屏蔽/恢复/状态转移/错误仍逐条记录，DOM 与扫描等被动热路径改为 10 秒窗口聚合，日志关闭时跳过摘要构造。
- P3 可观测边界：增加性能边界回归，直接断言无关 DOM 不唤起抖音深扫、弹幕按批处理、隐藏页暂停消费变化，以及重复
  批量刷新不会反复收集评论；保留日志脱敏、30 天/单日 50,000 条/约 16 MB 原有上限，并对评论记录上限给出明确提示。
- 结构审视结论：保留单 userscript 的闭包模块边界。当前文件虽较大，但拆分会改变 document-start 顺序、GM 桥接、
  运行锁和平台注入边界；在没有打包产物、加载顺序和跨平台回归证据前不做形式上的拆文件重构，先用共享基础设施收敛
  热路径和生命周期。

**改动文件**

核心为 `omniblock.user.js`；验证与维护链路包括 `test/performance.cjs`、`test/state.cjs`、`test/run.cjs`、
`test/comment-manager.cjs`、`test/quickblock.cjs`、`test/danmaku-auto.cjs`、`test/maintenance-check.cjs`、
`test/build-dev-extension.cjs`、`test/dev-extension.cjs` 及相关真实探针；用户可见说明同步到 `README.md` 和
`CHANGELOG.md`。持久化开发扩展已从当前源码重新生成到被忽略的 `test/_dev-extension`，不属于发布物。

**证据**

- **`structure regression`**：全量本地矩阵中，通用 UI 16/16、核心状态 7/7、B 站 33/33、自动弹幕 6/6、统一评论
  管理器 3/3、作品级屏蔽 3/3、性能边界 6/6、持久化开发扩展 3/3、跨平台适配 21/21、抖音推荐流 2/2、微博回放
  11/11 均通过；userscript 语法检查、各新增测试语法检查和 `git diff --check` 通过。性能边界回归明确覆盖了无关
  DOM、抖音自动规则扫描、弹幕增量批处理、隐藏页暂停、评论缓存命中、启动入口不建立 body 轮询和不使用独立
  `setInterval`。
- **`real-site verified`（源码注入，不是持久扩展验收）**：2026-08-29，专用 Chrome 的隔离只读新页，登录状态未读取，
  脱敏页面形式为 `bilibili.com/video/...`；当前候选源码版本/构建与机器标记一致，真实页发现 2 个评论渲染器、3 个
  可识别评论用户和 1 个可识别子评论，评论菜单出现本地拉黑与屏蔽该楼回复入口；评论管理器读取 3 行并完成搜索、
  全选、加载和屏蔽/恢复回放，楼操作收集 7 位作者，控制坞从 collapsed 悬停展开为 expanded。该证据证明当前源码在
  B 站真实 DOM 上的入口链路，但页面仍是探针临时注入，不能替代无注入持久开发扩展验证，也没有提供修复后 CPU 数字。
- **`blocked`**：本轮 `node test/maintenance-check.cjs` 尚未形成完整三平台性能验收：抖音公开入口停在验证码中间页，
  未发现可测视频；微博虽然发现了可识别评论并完成了只读本地入口回放，但当前页面没有活动顶层虚拟列表 spacer，
  无法验证虚拟列表布局指标。探针输出中的页面标识只留在当轮终端诊断，不写入仓库文档或发布物。
- **`blocked`**：旧构建的专用 Chrome 诊断仍只能作为问题定位证据：此前在脱敏的抖音精选页观察到脚本任务约 4.51 秒/
  10 秒、主要采样落在重复 `querySelectorAllDeep` 递归；它确认旧热路径和用户报告，但不能代表当前候选性能。候选
  需要在固定专用 Chrome 的持久开发扩展重新加载后，用无注入新页面复测。

**当前限制**

性能边界回归证明代码路径的增量/暂停/缓存契约，不证明平台今天仍使用相同 DOM。抖音视频解码、平台弹幕渲染和其他
网页脚本的 CPU 不属于 OmniBlock；线上指标必须在当前候选运行标识下单独采集。开放 ShadowRoot 之外、跨 iframe 和
平台私有 Worker 不在本脚本可控范围。日志聚合降低了被动事件写放大，但不保存完整原始 DOM/正文；详细用户操作仍逐条
保留，且日志写入失败不能影响屏蔽主链路。

**版本/发布状态**

工作区仍是未发布候选：`@version 0.44.0`，构建为
`0.44.0-persistent-runtime-floating-dock-log-aggregation-performance-resource-bounds`；当前源码和测试改动尚未提交、
推送、创建 tag 或 GitHub Release。固定专用 Chrome 当前仍需人工在 `chrome://extensions` 打开开发者模式并加载
`E:\pluginforchrome\test\_dev-extension`；浏览器自动化不绕过该页面的安全策略。完成加载并刷新/新建页面后，下一项
最有价值的验证是执行 `node test/installed-browser-probe.cjs --url=https://www.bilibili.com/...`，再用同一方式检查
抖音和微博的候选运行标识与静置性能；候选通过用户确认后才进入发布收口。

### 2026-08-29 - 0.44.0 未发布候选 - 抖音视频页高 CPU 热路径修复

**范围**

用户反馈：打开抖音视频界面后专用浏览器持续高强度占用 CPU，其他网站没有同样现象。
本轮在 2026-08-29 连接专用 Chrome 做只读运行时诊断，脱敏页面形式为 `douyin.com/jingxuan?...`，
登录状态未读取（诊断不依赖登录身份，也未读取 Cookie）。10 秒性能指标显示 renderer 的 `TaskDuration`
增加约 4.55 秒，其中 `ScriptDuration` 约 4.51 秒，`LayoutDuration` 约 0.003 秒；日志只增加 1 条，
因此主因不是上一轮日志写入，而是抖音适配器的 JavaScript 热路径。

**根因**

CPU profile 的主要调用链是 `activeVideoRoot → isInActiveDanmakuRoot → applyDouyinAutoDanmaku →
collectDanmaku → collectRecords → refresh`。`activeVideoRoot()` 每次都会通过 `querySelectorAllDeep(document, ...)`
递归遍历页面；旧逻辑在每条弹幕处理时重复调用它，即形成“每条弹幕 × 多次整页深遍历”。当前页只读观察到 31 个
弹幕身份候选节点，profile 中扩展脚本采样主要落在递归 `collect`，与该调用链相符。日志聚合已经降低了落盘增长，
但不能解决这个计算问题。

**改动**

- `omniblock.user.js`：活动播放器根节点只在同一 JavaScript turn 内计算一次并复用；视频会话键支持复用已确认的根节点；
  `collectDanmaku()` 把根节点和会话键传给逐项自动规则处理；没有启用抖音自动规则时先走快速返回，不再逐条计算活动根节点。
  下一轮 JavaScript turn 会清掉缓存，播放器切换仍会重新读取 DOM。
- `test/danmaku-auto.cjs`：加入抖音热路径诊断计数，分别验证自动规则关闭/开启时根节点调用和计算次数不会随 5 条弹幕重复增长。
- `README.md`、`CHANGELOG.md`：记录抖音 CPU 热路径修复的用户可见边界。

**证据**

- **`real-site verified`（仅诊断）**：2026-08-29，专用 Chrome、只读、登录状态未读取，`douyin.com/jingxuan?...`；
  旧构建静置 10 秒的脚本任务约 4.51 秒、布局约 0.003 秒，CPU profile 共 3326 个采样，其中大量采样在
  `querySelectorAllDeep` 的递归 `collect`，并沿着上述抖音弹幕收集调用链进入。该证据确认用户报告现象和代码热路径，
  不代表修复后的新构建已经在线生效。
- **`structure regression`**：`node test/danmaku-auto.cjs` 通过 6/6，新增性能回归通过；通用 UI 16/16、B站 33/33、
  核心状态 7/7、跨平台适配 21/21、评论管理 3/3、作品级屏蔽 3/3、抖音推荐流 2/2、微博回放 11/11、
  持久开发扩展 3/3 均通过；维护门禁、userscript/测试语法检查和 `git diff --check` 通过。
- **`blocked`**：当前专用 Chrome 页面仍运行修复前的已安装构建；需要在 `chrome://extensions` 重新加载开发扩展，
  再刷新抖音页面，才能进行修复后 10 秒 CPU 对照。本轮没有把旧页面的性能数字当作修复后的线上结果。

**当前限制**

- 本轮修复的是 OmniBlock 自身重复深遍历；抖音网页播放器、视频解码和平台脚本的 CPU 仍由浏览器/平台负责，不能把所有 renderer CPU 都归因于插件。
- 活动根节点缓存只跨同一 JavaScript turn，不跨异步任务，优先保证播放器切换和动态弹幕作用域不会长期使用旧节点。
- 当前候选仍保留日志的 30 天、单日 50,000 条和约 16 MB 上限；日志聚合与 CPU 修复是两个独立问题。

**版本/发布状态**

工作区仍是未发布候选：`@version 0.44.0`，构建为 `0.44.0-persistent-runtime-floating-dock-log-aggregation-douyin-cpu-hotpath`；
修复已生成到本地 `test/_dev-extension`，尚未提交、推送、创建 tag 或 GitHub Release。安装并刷新后，最有价值的下一项验证是
在同一个抖音页面静置 10 秒，再读取 Performance 指标和日志计数，确认脚本时间显著下降且日志仍按窗口摘要增长。

### 2026-08-29 - 0.44.0 未发布候选 - 反馈日志被动遥测聚合

**范围**

用户反馈：专用浏览器的 B 站页面在没有人工操作时仍以每秒数条的速度增加日志，担心长期占用内存。
本轮先在已安装旧构建的真实 B 站页面做只读测量：静置 10 秒新增 29 条事件，其中 15 条为
`dom.mutation.batch`、14 条为 `scanner.scan`，错误数为 0。根因是 B 站页面自身持续产生 DOM 变化，
而当前日志把每个观察批次和每次扫描都作为独立事件落盘；它不是已确认的对象泄漏，但会造成不必要的日志增长、
整片日志重复序列化和跨标签页缓存压力。

本轮将被动遥测改为 10 秒窗口聚合：用户操作、屏蔽/恢复、设置、状态转移、存储变化和错误仍逐条记录；
DOM 变化、扫描和逐项扫描只保留窗口计数、节点/类型分布、扫描耗时、选择器统计和少量安全样本。

**改动文件**

- `omniblock.user.js`：增加被动日志桶和 10 秒聚合刷新；DOM observer 不再保留整批 MutationRecord 摘要，
  扫描/逐项扫描改写为汇总事件；日志清空、导出、日期刷新会先处理待聚合事件；当前构建标识更新为
  `0.44.0-persistent-runtime-floating-dock-log-aggregation`。
- `test/run.cjs`：增加被动事件聚合、DOM 汇总不携带原始 `records` 数组、选择器统计和脱敏导出回归。
- `README.md`、`CHANGELOG.md`：记录高频日志的聚合策略和仍保留的详细用户操作日志边界。

**证据**

- **`structure regression`**：`node test/run.cjs` 通过 16/16；新增 E3 聚合断言通过；
  `node test/quickblock.cjs` 33/33、`node test/state.cjs` 7/7、`node test/adapters.cjs` 21/21；
  `node test/dev-extension.cjs` 使用隔离临时 profile 通过 3/3。
- **`structure regression`**：`node --check omniblock.user.js`、`node --check test/run.cjs` 和
  `git diff --check` 通过；事件导出仍完成字段级脱敏，测试中的合成正文、身份和 URL 没有进入导出结果。
- **`blocked`**：当前专用浏览器里的已安装扩展仍需在 `chrome://extensions` 刷新，才能把本轮聚合构建加载到已打开页面；
  本轮没有重新操作用户页面做优化后的 10 秒线上增量对照。此前的 B 站/抖音真实平台功能门禁仍按各自探针状态记录，
  不因本地日志回归通过而升级。

**当前限制**

- 被动事件不再逐条保存每一个 DOM 观察批次，而是每 10 秒写一条窗口摘要；若反馈问题需要完整原始 DOM 或正文，
  仍不能从本地日志恢复，必须通过单独的只读复现或临时诊断夹具获取。
- 日志仍保留最近 30 天、每天最多 50,000 条、总大小最多约 16 MB；聚合降低增长和写放大，但不替代用户定期导出重要诊断。
- 多标签页共享 GM/扩展存储仍是最后写入者优先；本轮未扩大为跨标签页事件序列合并。

**版本/发布状态**

工作区仍是未发布候选：`@version 0.44.0`，构建为 `0.44.0-persistent-runtime-floating-dock-log-aggregation`；
未提交、未推送、未创建 tag 或 GitHub Release。安装当前构建后，最有价值的下一项验证是静置 B 站和抖音页面
10 秒以上，确认日志按窗口增长且用户操作仍逐条可见。

### 2026-08-29 - 0.44.0 未发布候选 - 持久开发运行时与右下角控制坞

**范围**

本轮在上一条未发布候选的基础上，先审视完整 userscript 的运行时边界，再补齐专用浏览器的持久加载方式，
最后统一处理 B 站/抖音及其他页面级入口的右下角控制坞。源码仍保留已发布 `@version 0.44.0`，本轮只生成
候选构建，不提高用户可见版本，也不发布。

**结构审视与决策**

- `omniblock.user.js` 约 10,000 行，仍是单文件 userscript，但存储、事件日志、通用扫描器、平台适配器、
  评论/弹幕管理器和设置 UI 已由闭包/窄接口分隔。当前没有证据表明整文件拆分能降低本轮风险；直接拆分会同时改变
  userscript 打包顺序、Shadow DOM 作用域和多个平台的闭包共享，因此本轮不做无回归依据的全面重构。
- 发现并处理的运行时边界：同文档运行锁避免重复扫描器/观察器/定时器/UI；开发扩展先恢复 GM 存储快照再启动 userscript，
  避免新页面先用默认设置覆盖持久名单；开发扩展匹配覆盖 B 站/抖音子域及 `m.weibo.cn`，不只覆盖首页。
- 保留的专业风险：平台 DOM、Shadow DOM、虚拟列表和弹幕会话都是外部结构；每个平台仍独立使用自己的适配器和探针。
  现有 `setInterval` 是文档生命周期内的适配器轮询，硬导航时由浏览器销毁；SPA 切换由扫描器路由检测处理，运行锁只
  保护同文档重复执行。跨标签页名单仍是 GM 的最后写入者生效，没有引入未经需求授权的云端冲突合并。

**改动文件**

- `omniblock.user.js`：开发扩展异步存储启动栅栏；统一 `FloatingDock` 状态机；页面入口默认收起、悬停/聚焦展开、
  action hold、面板 hold、关闭后自动收起、淡入/滑入动画和 `prefers-reduced-motion`；修正 `aria-expanded` 只表达设置面板状态，
  `data-ob-dock-state` 单独表达控制坞状态。
- `test/build-dev-extension.cjs`：生成本地忽略的 MV3 开发扩展，桥接 `chrome.storage`/只读跨域请求，镜像平台匹配边界。
- `test/dev-browser.cjs`：固定专用 Chrome profile 启动/复用和一次性手动加载指引；不再把 Chrome 不支持的命令行扩展开关当成成功条件。
- `test/dev-extension.cjs`：Edge/Chromium 临时 profile 的 B 站主域、B 站空间子域和抖音新文档自动加载回归。
- `test/installed-browser-probe.cjs`：显式 URL 的已安装运行时双新页只读探针，无 `addInitScript`/源码注入路径。
- `test/run.cjs`：控制坞收起、展开、入口联动、交互保持、自动收起和设置面板关闭回归；更新总数为 16 项。
- `test/real-bilibili-probe.cjs`、`test/real-douyin-probe.cjs`：真实页面探针适配控制坞默认收起和脚本自身悬停展开路径。
- `test/maintenance-check.cjs`、`README.md`、`CHANGELOG.md`：纳入持久运行时、结构回归和本轮候选边界。

**证据**

- **`structure regression`**：`node test/run.cjs` 通过 16/16，无页面错误；`node test/dev-extension.cjs` 使用
  `msedge.exe` 的隔离临时 profile 通过 3/3，验证 B 站主域、B 站空间子域和抖音新文档都自动加载当前构建，且第二页共享
  第一页写入的本地设置。源码/新增探针语法检查通过。
- **`blocked`**：同一机器的 Google Chrome 148 自动化启动即使只使用 `--load-extension`，`chrome://extensions` 仍显示没有用户扩展，
  目标页面没有扩展桥接标记；因此没有把 Chrome 命令行启动结果写成自动加载通过。专用 Chrome 的一次性手动加载尚未在本轮打开，
  `installed-browser-probe.cjs` 也未运行，需下一轮在用户授权后验证。
- **`blocked`**：本轮 `node test/real-bilibili-probe.cjs --verify-local` 因真实页面导航销毁执行上下文而未完成；
  `node test/real-platform-probe.cjs douyin --verify-local` 真实公开入口停在验证码中间页，未发现可验证视频。抖音探针代码已更新，
  但没有把隔离页面的 `blocked` 改写为线上 UI 通过。

**检查命令与结果**

```text
node --check omniblock.user.js                         PASS
node --check test/run.cjs                              PASS
node --check test/installed-browser-probe.cjs          PASS
node --check test/dev-browser.cjs                      PASS
node --check test/dev-extension.cjs                    PASS
node test/run.cjs                                      PASS 16/16
node test/dev-extension.cjs                            PASS 3/3 (Edge/Chromium)
node test/real-bilibili-probe.cjs --verify-local       blocked: navigation destroyed execution context
node test/real-platform-probe.cjs douyin --verify-local blocked: CAPTCHA interstitial
```

**当前限制**

- 仍需用户在固定专用 Chrome profile 中一次性加载开发扩展，并用显式目标运行 `installed-browser-probe.cjs`；
  该动作必须使用本轮用户授权的登录态只读会话，不能由维护者读取 Cookie 或代替用户登录。
- Edge/Chromium 的自动扩展回归只证明扩展加载、桥接和脚本结构，不证明 B 站/抖音真实 DOM 当前仍然稳定；真实平台证据仍按平台分别记录。
- 控制坞只管理脚本自己的页面级入口，不隐藏模态面板；打开模态面板时通过 hold 保持展开。平台页面自身的原生弹窗仍由各适配器的
  遮挡判断控制，入口可能因没有可靠用户、页面切换或原生弹窗而消失。

**发布**

工作区仍是未发布候选：`@version 0.44.0`，构建 `0.44.0-persistent-runtime-floating-dock`；未提交、未推送、未创建 tag 或 GitHub Release。

**下一步验证**

用户明确允许后，在固定专用 Chrome profile 完成一次性开发扩展加载；打开 B 站视频和抖音视频的全新页面，运行
`node test/installed-browser-probe.cjs --url=...` 做无注入版本核对，再由用户检查控制坞遮挡、悬停展开、移入入口、打开/关闭面板后的收起行为。

### 2026-08-28 - 0.44.0 未发布候选 - 平台分列、作品级屏蔽与详细事件日志

**范围**

本轮在已发布 `0.44.0` 的源码基础上增加三项候选升级：设置页屏蔽名单按平台分列且每列独立滚动；
抖音视频、微博帖子和 B 站动态详情页提供作品级本地屏蔽；设置页提供默认开启、按日分片的详细运行日志和反馈导出。
候选保留 `@version 0.44.0`，通过新的运行时构建标识与已发布源码区分。

**改动文件**

- `omniblock.user.js`：平台列布局；`EventLog` 本地事件流、字段脱敏、按日分片、30 天/单日 50,000 事件/总计约 16 MB 上限、导出和清理；
  扫描器、设置、评论管理、楼操作、弹幕管理、批量操作、存储和作品操作的事件记录；公共作品确认/一次事务/精确撤销；
  抖音作品评论/弹幕安全滚动，微博卡片作用域和回复展开，B 站动态作者/当前 DOM/当前弹幕会话收集。
- `test/run.cjs`：新增平台列、列内独立滚动、事件流记录和导出二次脱敏断言。
- `test/work-block.cjs`：人工合成三平台作品作用域回归，验证不跨作品收集、作者/主评论/子评论/弹幕分段去重、一次写入与撤销。
- `test/real-platform-probe.cjs`、`test/real-bilibili-probe.cjs`：只读记录作品作用域 API/入口状态；微博详情页探针增加入口数量一致性检查。
- `test/maintenance-check.cjs`：纳入作品级回归、B 站探针和新测试文件隐私门禁。
- `README.md`、`CHANGELOG.md`、`MAINTENANCE.md`：记录候选行为、日志容量/隐私策略、验证证据和未发布边界。

**证据**

- **`real-site verified`**：2026-08-28，隔离、未登录的真实微博详情页 `weibo.com/...` 注入构建
  `0.44.0-platform-work-log-columns`；运行时解析出 1 个带可靠作者的作品作用域，并在页面中注入 1 个「屏蔽作品」入口。
  本轮只观察页面和脚本自身入口，没有点击微博举报、官方拉黑、关注或发帖等写入控件，也没有提交真实名单。
- **`structure regression`**：`node test/work-block.cjs` 通过 3/3；三个人工合成页面分别验证抖音、微博、B 站的作者、主评论、子评论和弹幕
  作用域、跨作品隔离、一次事务和撤销。`node test/run.cjs` 通过 15/15，含平台列/独立滚动和日志 DOM/扫描/脱敏导出；
  `node test/quickblock.cjs` 33/33、`node test/adapters.cjs` 21/21、`node test/comment-manager.cjs` 3/3、`node test/state.cjs` 7/7、
  `node test/danmaku-auto.cjs` 5/5、`node test/douyin.cjs` 2/2、`node test/weibo-replay.cjs` 11/11；源码、受影响探针/测试语法检查，
  `git diff --check` 和公开页面隐私门禁通过。
- **`blocked`**：`node test/real-platform-probe.cjs douyin --verify-local` 的未登录公开入口停在验证码中间页，未发现可测视频作用域；
  B 站隔离探针本轮只发现 `bilibili.com/video/...`，不是 `/opus/...` 动态详情页，不能将视频页评论证据扩写为动态作品级线上验收；
  微博探针实际详情页没有带可测活动顶层 spacer，因此既有虚拟列表专项仍报告 blocked。真实平台的作品级“加载全部”也没有被声称为平台接口意义上的绝对全量。

**当前限制**

- “屏蔽作品”只会写入可靠解析到的身份键；未知身份、未加载内容和没有明确作用域的内容不会猜测。确认框中的“部分”和“无可靠身份”必须保留给用户判断。
- 抖音与微博的评论/回复收集依赖当前 DOM、明确展开控件和安全滚动；B 站动态评论/子评论只读当前 DOM，动态视频弹幕只读当前页面已建立的弹幕会话。
- 日志为了诊断结构和状态保留计数、阶段、标签和选择器统计；字段级脱敏会去掉身份键、正文、地址、原始 HTML、请求头、Cookie/Token 和堆栈。
  设置页仅显示当天最近 800 条，导出 JSON 才包含保留范围内当天的全部事件；写入失败只进入内存待写队列，不阻断屏蔽主链路。

**检查命令**

```powershell
node --check omniblock.user.js
node --check test/run.cjs
node --check test/work-block.cjs
node --check test/real-platform-probe.cjs
node --check test/real-bilibili-probe.cjs
node --check test/maintenance-check.cjs
node test/run.cjs
node test/work-block.cjs
node test/state.cjs
node test/quickblock.cjs
node test/comment-manager.cjs
node test/adapters.cjs
node test/danmaku-auto.cjs
node test/douyin.cjs
node test/weibo-replay.cjs
node test/real-bilibili-probe.cjs --verify-local
node test/real-platform-probe.cjs douyin --verify-local
node test/real-platform-probe.cjs weibo --verify-local
node test/maintenance-check.cjs
git diff --check
```

**发布**

工作区仍为未发布候选：`@version 0.44.0`，构建 `0.44.0-platform-work-log-columns`；本轮未提交、未推送、未创建 tag 或 GitHub Release。

**下一步验证**

在用户本人授权并操作的专用浏览器中，分别打开一个抖音视频、一个微博帖子和一个 B 站动态视频详情页，只点击脚本自身的作品入口，
确认收集计数、部分提示、确认/取消和撤销；平台官方写入控件仍不得点击。若无法取得稳定 B 站动态页，继续保持 blocked，不把现有视频页证据升级。

### 2026-08-28 - 0.44.0 - B站主评论楼操作读取完整子评论分页

**范围**

修复 B站主评论菜单中的「🧵 屏蔽该楼回复」只读取当前子评论页的问题。楼操作继续使用只读的
`x/v2/reply/reply` 接口，但不再拿请求的 `ps=20` 直接与当前返回条数比较；现在优先根据接口返回的
`page.num`、实际 `page.size` 和 `page.count` 判断是否还有后续页，再把各页记录与当前 DOM 记录按可靠 UID 合并。

**改动文件**

- `omniblock.user.js`：新增统一的子评论分页状态判断；`fetchAllCommentAuthors` 与 `loadThread` 均按接口实际页大小继续读取，
  保留 15 页安全上限，并在提前空页或达到上限时保留 `partial` 状态。
- `test/quickblock.cjs`：新增 `QB-L-PAGE` 回归。人工合成 B站接口在请求 `ps=20` 时实际返回每页 10 条、总数 25 条，
  验证楼操作读取第 1/2/3 页的全部身份、一次屏蔽以及完整撤销。
- `README.md`、`CHANGELOG.md`、`MAINTENANCE.md`：记录新构建标识、用户可见的分页行为、证据边界和安全限制。

**证据**

- **`real-site verified`**：2026-08-28，在隔离、只读的真实 B站视频页 `bilibili.com/video/...` 中注入构建
  `0.44.0-bili-comment-thread-pagination`。真实页实际出现 B站评论菜单和「🧵 屏蔽该楼回复」入口；楼操作确认后一次写入 5 个可靠作者身份，
  根评论保持可见，撤销后全部恢复。未读取 Cookie，未点击举报、官方拉黑、关注或其他平台写入控件。当天版本提升前的同一功能候选还在真实页观察到
  7 条当前可读取子回复并完成 4 个作者身份的楼操作闭环；这两项均不等同于多页分页验收。
- **`structure regression`**：`node test/quickblock.cjs` 通过 33/33；`QB-L-PAGE` 明确要求访问第 1/2/3 页，且 25 个合成作者
  全部进入屏蔽结果并在撤销后恢复。完整本地矩阵也通过：`node test/run.cjs` 14/14、`node test/state.cjs` 7/7、
  `node test/comment-manager.cjs` 3/3、`node test/adapters.cjs` 21/21、`node test/douyin.cjs` 2/2、
  `node test/weibo-replay.cjs` 11/11、`node test/danmaku-auto.cjs` 5/5；`node --check omniblock.user.js`、
  `node --check test/quickblock.cjs`、`git diff --check` 和公开隐私门禁均通过。
- **`blocked`**：本轮没有获得可在真实站点稳定复核 20 条以上分页楼中楼的公开目标；后续公开评论接口请求受到平台风险控制，返回
  `-352`，且严格探针的一次真实页面没有稳定渲染可复核的子评论 DOM，所以多页场景的自动线上验收仍然阻断。用户随后在真实分页楼中楼页面手工确认当前候选无问题；
  由于该页面的脱敏 URL、登录状态和精确计数未记录，不能把这条反馈扩写成自动探针数字，也不能用单楼观察替代多页证据。

**限制**

分页最多读取 15 页；接口失败、总数仍提示有内容但返回空页、或达到安全上限时，确认文案会显示“部分”，并保留已成功读取的作者。
如果接口不提供可用的 `page.count`，代码只能退回请求页大小作为结束依据；当前修复针对的是 B站返回实际 `page.size` 小于请求 `ps` 的情况。
身份仍只接受可靠 UID，不会为了覆盖未加载页面而猜测作者身份。

**发布**

本次发布构建为 `0.44.0-bili-comment-thread-pagination`，userscript `@version` 为 `0.44.0`；功能提交 `5d13111` 已推送到
`origin/master`，`v0.44.0` tag 已创建并推送，GitHub Release：<https://github.com/a2787/ub-utils/releases/tag/v0.44.0>。
上一项自动规则例外修复已包含在本次发布历史中，提交为 `ed121eb`；已发布的 `v0.43.0` 保留不变。

**下一步验证**

发布后在用户自己的 Tampermonkey 中更新到 `0.44.0` 并刷新 B站页面，确认齿轮显示
`0.44.0-bili-comment-thread-pagination`；本轮用户已经在真实分页楼中楼页面确认候选无问题，后续若需要可再补采一份带脱敏 URL、登录状态和精确计数的多页探针证据。

### 2026-08-28 - 0.43.0 未发布候选 - 自动规则例外与误命中恢复

**范围**

承接前一条弹幕管理器候选，修复“自动规则命中的发送者无法恢复”的逻辑缺口。自动规则命中的行现在提供「恢复并例外」：
按平台保存当前可靠身份键，移除当前人物的关联屏蔽身份，并让后续自动扫描跳过该身份；规则继续对其他发送者生效。
设置面板新增每个平台的“自动规则例外”列表，可用「恢复规则」删除例外。用户手动再次拉黑时会清掉对应例外。

**改动文件**

- `omniblock.user.js`：增加 B站/抖音分平台例外设置与规范化 API；自动扫描、seg.so/原生弹幕列表、浮动弹幕和抖音节点均检查例外；
  两个弹幕管理器对自动命中显示「恢复并例外」，设置面板提供例外删除；手动拉黑会清除例外。
- `test/danmaku-auto.cjs`：增加 B站例外跳过、删除例外后重新命中、抖音管理器恢复并例外、删除例外后节点重新隐藏和设置面板删除例外回归。
- `README.md`、`CHANGELOG.md`：记录例外行为、身份边界和未发布候选构建标识。

**证据**

- **`real-site verified`**：2026-08-28，在用户授权的专用持久 Chrome 会话中，将当前源码注入脱敏 B站视频页
  `bilibili.com/video/...`；登录状态未读取且本次动作不依赖登录，未读取 Cookie。管理器实际保留 7 个文案组，临时关键词命中其中
  1 组后显示灰色 `blocked` 行和「恢复并例外」；点击后该组变为 `active`、灰色消失并记录 1 条 B站规则例外。随后删除该例外，
  同一行再次变为灰色并恢复「恢复并例外」，证明规则仍然启用。临时规则/例外/名单只存在该页面的内存 GM stub，未点击举报、官方拉黑、
  关注或其他平台写入控件。
- **`structure regression`**：`node test/danmaku-auto.cjs` 通过 5/5；覆盖 B站例外跳过、删除例外后重新命中，抖音管理器“恢复并例外”
  及设置面板例外删除；完整本地矩阵 `node test/run.cjs` 14/14、`node test/state.cjs` 7/7、`node test/comment-manager.cjs` 3/3、
  `node test/adapters.cjs` 21/21、`node test/douyin.cjs` 2/2、`node test/weibo-replay.cjs` 11/11、`node test/quickblock.cjs` 32/32
  通过；`node --check omniblock.user.js`、受影响测试语法检查和 `git diff --check` 通过。
- **`blocked`**：`node test/real-douyin-probe.cjs --current --verify-auto-danmaku --duration=5` 注入新构建后仍未发现带可靠身份的弹幕节点
  （0 个可用节点）；`node test/real-platform-probe.cjs douyin --verify-local` 的公开入口停在验证码中间页。抖音专用页面因此只确认新构建运行和
  管理器为空，尚不能声明线上自动规则例外闭环。B站公开隔离探针本轮已加载并确认新构建，但其场景未执行自动例外交互，自动例外的真站证据来自上面的
  专用 B站页面操作。

**限制**

B站原生弹幕侧栏按文案定位；同一文案对应多个发送者且无法逐行可靠区分时，自动规则仍以“只要存在未例外候选就隐藏整行”的安全策略处理，
自有弹幕管理器和 seg.so 单条消息链仍可按可靠 hash 区分。例外是本机设置的一部分，会随本机 JSON/快照导出；删除例外后，当前已观察消息会重新
受规则控制，但没有可靠身份的抖音弹幕仍不会写入例外或名单。

**发布**

候选构建为 `0.43.0-bili-douyin-danmaku-manager-exception`，userscript `@version` 仍为 `0.43.0`；未提交、未推送、未打 tag、未创建 Release，
已发布 `v0.43.0` 不受本轮工作区改动影响。

**下一步验证**

在专用 Chrome 的抖音页面出现可靠自动命中行后，补做一次「恢复并例外」和删除例外的真实页面观察；当前 B站闭环已完成，抖音仍受数据不可用阻断。

### 2026-08-28 - 0.43.0 未发布候选 - 弹幕管理器保留已屏蔽记录

**范围**

承接当前工作区的 B站/抖音自动弹幕规则候选，本轮只调整两个弹幕管理器的可见状态：已经在本地名单中的、且属于当前视频
本轮已观察记录的发送者不再从管理器消失，而是以灰色行保留；行内提供「取消屏蔽」，并从全选、勾选和批量屏蔽候选中排除。
B站文案组若只有部分发送者已屏蔽，会明确显示部分状态；自动规则仍在生效时不允许通过管理器误以为已解除后继续被规则隐藏。

**改动文件**

- `omniblock.user.js`：增加已屏蔽弹幕记录的管理器状态、灰色样式、取消屏蔽入口和关联人物身份键整体移除；B站保留完整/部分状态，
  抖音保留已屏蔽发送者并排除批量选择。
- `test/quickblock.cjs`：更新“全部已屏蔽”回归，验证 B站 6 个文案组仍显示、灰显行可取消，且关联 UID/hash 一并撤销；更新 PAKKU 兼容场景的计数。
- `test/danmaku-auto.cjs`：增加抖音已屏蔽发送者灰显、取消屏蔽和恢复 active 状态回归。
- `README.md`、`CHANGELOG.md`：记录候选行为、自动规则限制和未发布边界。

**证据**

- **`real-site verified`**：2026-08-28，在专用 Chrome 当前会话的脱敏 B站视频页 `bilibili.com/video/...` 中注入当前源码；运行时
  版本为 `0.43.0`，构建为 `0.43.0-bili-douyin-danmaku-manager-unblock`。管理器实际显示 7 个文案组，1 行为 `blocked` 灰显，
  复选框禁用并出现「取消屏蔽」；点击后该行变为 `active`，灰色状态消失并恢复单条操作入口。演示身份只写入该页面的内存 GM stub，
  未读取 Cookie，未点击举报、官方拉黑、关注或其他平台写入控件。
- **`structure regression`**：`node test/quickblock.cjs` 32/32；`node test/danmaku-auto.cjs` 5/5；`node test/run.cjs` 14/14；
  `node test/state.cjs` 7/7；`node test/comment-manager.cjs` 3/3；`node test/adapters.cjs` 21/21；`node test/douyin.cjs` 2/2；
  `node test/weibo-replay.cjs` 11/11。`node --check omniblock.user.js`、三个受影响测试脚本的 `node --check` 和 `git diff --check` 通过。
- **`blocked`**：`node test/real-bilibili-probe.cjs --verify-local` 发现公开目标后因页面导航销毁执行上下文而未完成探针；
  `node test/real-platform-probe.cjs douyin --verify-local` 的公开入口停在验证码中间页；专用 Chrome 的抖音当前视频没有带可靠身份的
  弹幕节点，`node test/real-douyin-probe.cjs --current --verify-auto-danmaku --duration=5` 因此报告无可用目标。上述阻断不改写为功能失败，
  也不替代 B站本轮已完成的真实页面灰显/取消屏蔽观察。

**限制**

B站管理器展示的是当前视频已经加载或观察到的文案组；未加载、未匹配或没有可靠身份的弹幕仍不会被猜测加入。B站自动规则命中的
弹幕可能同时处于临时自动屏蔽状态，停用规则前不能承诺管理器按钮会解除后续自动隐藏。抖音当前页无可靠身份弹幕时管理器自然为空，
这不证明平台所有弹幕都已读取。当前候选仍未改变原生 B站弹幕列表的隐藏策略。

**发布**

候选仍为 `@version 0.43.0`，未提交、未推送、未打 tag、未创建 Release；已发布 `v0.43.0` 不受本轮工作区改动影响。

**下一步验证**

用户在专用 Chrome 中查看当前 B站灰显行和抖音最新构建；若确认候选行为，再单独决定是否提升公开版本号并进入提交/发布流程。

### 2026-08-28 - 0.43.0 未发布候选 - B站与抖音关键词/正则自动屏蔽弹幕

**范围**

本轮按已批准方案先实现自动弹幕规则：设置面板分别管理 B站和抖音的关键词/正则表达式，命中后只执行本地
弹幕屏蔽。B站复用现有 `seg.so`/PAKKU 兼容链，保存 `mid_hash`，仅在候选唯一且公开用户卡片正向校验成功时
关联 UID；没有复制 PAKKU 的去重主体。抖音只观察当前播放器已出现的节点，可靠身份才写入本地名单，无身份命中
只隐藏当前节点。抖音弹幕去重作为第二阶段，B站去重不在本项目中重复实现。候选仍为 `@version 0.43.0`，不消耗
新版本号、不覆盖已发布的 `v0.43.0`。

**改动文件**

- `omniblock.user.js`：新增分平台规则存储、关键词/正则匹配、B站 protobuf/PAKKU/XHR/fetch 过滤接入、唯一 UID
  正向校验、抖音当前播放器范围和跨视频会话隔离；总开关关闭时不再过滤自动 hash。未可靠解析身份时不伪造身份。
- `test/danmaku-auto.cjs`：人工合成 B站 `seg.so` protobuf 和抖音播放器 DOM，覆盖规则去重、正则、自动隐藏、hash 入库、
  唯一 UID 关联、总开关恢复、当前播放器切换和旧节点隔离。
- `test/quickblock.cjs`：补充 PAKKU 先安装场景下自动规则只过滤命中文案、保存 hash、保留其他响应链的回归。
- `test/real-bilibili-probe.cjs`、`test/real-douyin-probe.cjs`：增加 `--verify-auto-danmaku`，从真实页面当前已出现的
  弹幕生成临时匹配片段，使用内存名单验证命中/隐藏/身份入库/恢复；不记录正文或 UID，不点击平台写入控件。
- `test/maintenance-check.cjs`、`README.md`、`MAINTENANCE.md`：纳入自动规则门禁、候选版本边界、PAKKU 兼容约束和
  未加载弹幕限制。

**证据**

- **`structure regression`**：`node test/danmaku-auto.cjs` 当前通过 4/4；覆盖 B站关键词和正则经过现有过滤链、
  hash 只在唯一正向校验时补 UID、关闭总开关保持原始响应、抖音命中身份批量入库以及旧视频节点不串入新视频。
- **`structure regression`**：`node test/quickblock.cjs` 当前通过 32/32；PAKKU 先安装夹具中自动规则只处理命中文案，
  未命中的弹幕和既有 PAKKU 链保持可用。
- **`real-site verified`**：2026-08-28，在用户已登录的专用持久 Chrome（固定 `127.0.0.1:9222`）的脱敏 B站视频页
  `bilibili.com/video/...` 中注入当前候选，源码 SHA-256 为
  `04b6b0daf862fe324ca4c4a1caf35a3ff339d105917a722b40bb05c26363e3b3`。自动规则实际命中 1 条当前弹幕，
  过滤并隐藏节点、保存新的 `mid_hash`，恢复规则后节点恢复；唯一 UID 解析器计数前后均为 `1`，自动隐藏节点
  未带人工快捷拉黑标记。B站弹幕工具的单条、批量和撤销断言也通过；探针只使用内存名单 stub，未读取 Cookie，
  未点击举报、官方拉黑、关注或其他平台写入控件。
- **`real-site verified`**：2026-08-28，在同一专用 Chrome 的脱敏抖音精选/视频页 `douyin.com/jingxuan?...` 中
  注入同一候选（源码 SHA-256 同上），自动规则实际完成“临时规则添加 → 命中 → 隐藏 → 可靠发送者身份入本地名单
  → 删除规则并恢复”闭环；带换片哨兵的组合探针中，真实视频会话键变化，旧管理器关闭，旧视频哨兵未出现在新管理器，
  `120` 次稳定性采样的 CDP 心跳错误为 `0`，弹幕最低 `2` 条、评论最低 `13` 条，最终分别为 `11` 和 `165` 条，
  最大单次响应延迟 `1236ms`。当前页的弹幕/评论管理器搜索、多选、单条入口和撤销同轮通过；探针不读取 Cookie，不点击举报、
  官方拉黑、关注或其他平台写入控件。
- **`blocked`**：`node test/maintenance-check.cjs` 的默认公开隔离探针仍报告抖音验证码中间页，以及微博当前发现页没有
  可测的活动顶层 spacer；命令最终输出 `RESULT: MAINTENANCE SELF-CHECK BLOCKED`。这两个阻断不替代也不推翻上面的
  已登录专用 Chrome 证据；本轮没有把它们写成真实功能失败。

**检查**

已通过 userscript、quickblock、adapters、weibo-replay、real-site probe 的语法检查；`node test/run.cjs` 14/14、
`node test/state.cjs` 7/7、`node test/quickblock.cjs` 32/32、`node test/danmaku-auto.cjs` 4/4、
`node test/comment-manager.cjs` 3/3、`node test/adapters.cjs` 21/21、`node test/douyin.cjs` 2/2、
`node test/weibo-replay.cjs` 11/11，`git diff --check` 通过；隐私扫描无具体页面/账号命中。默认维护自检中的
公开抖音/微博探针仍按下方 `blocked` 记录，不能与已登录专用 Chrome 证据混写。

**限制**

B站自动过滤依赖当前视频可取得的 `seg.so`/`list.so` 弹幕段；抖音自动过滤依赖当前播放器已经出现的弹幕节点，
不调用私有接口、不主动跳转时间轴，不保证未加载内容立即全量匹配。B站 `mid_hash` 的唯一候选反查仍会受碰撞、
不存在账号、卡片请求失败或 64 个查询上限影响；这些情况只保留 hash。规则删除不会自动删除已写入名单。PAKKU 的
去重和 B站原生弹幕设置由各自扩展/平台继续负责。

**发布**

候选尚未提升版本号、未推送、未打 tag、未创建 Release；在真实验证和用户确认前不得发布 `0.44.0`。上一轮抖音
评论入口清理已在本轮开始前单独本地提交为 `5be1114`，不再以未提交代码留在工作区与本候选混合。

**下一步验证**

先让用户在专用 Chrome 中查看当前候选的运行版本/构建并确认实际体验；确认前保持 `0.43.0` 候选，不推送、
不打 tag、不创建 Release。抖音去重第二阶段另行规划，不与本候选合并。

### 2026-08-27 - 0.43.0 未发布候选 - 清理已迁移评论 Modal 的旧批量条

**范围**

抖音评论区已经由右下角统一多选评论管理器接管，但评论侧栏同时带有平台 Modal 语义，旧版通用 Modal 扫描器
仍会在其顶部插入红色「拉黑全部」条，造成重复入口和内容遮挡。本轮只清理已经接入统一评论管理器的评论承载层；
其他用户列表 Modal 的通用批量入口不变。候选保持 `@version 0.43.0`，没有消耗新版本号。

**改动文件**

- `omniblock.user.js`：为抖音、B站、微博评论管理器增加 `isScope` 契约；通用 Modal 扫描命中评论承载层时，
  删除历史或新注入的 `data-ob-kind="modal"` 批量条及标记，不影响非评论 Modal。构建标识为
  `0.43.0-douyin-comment-modal-manager-cleanup`。
- `test/adapters.cjs`：抖音评论侧栏增加“旧 Modal 批量条数量为 0”的回归；改动前旧行为为 1 个批量条并使
  20/21 通过，改动后要求 21/21。
- `test/real-douyin-probe.cjs`：真实登录态只读探针记录评论 Modal 是否存在及旧批量条数量，并在评论侧栏可确认时
  将非零数量记为阻塞。
- `README.md`：标明未发布候选的入口变化和版本边界。

**证据**

- **`structure regression`**：`node test/adapters.cjs` 改动前为 `PASS: 20 / FAIL: 1`，失败结果为
  `commentModalBulkCount: 1`；当前候选为 `PASS: 21 / FAIL: 0`。其余适配器断言同时通过。
- **`real-site verified`**：2026-08-27，在用户已登录的专用持久 Chrome（固定 `127.0.0.1:9222`）的脱敏抖音视频页
  `douyin.com/jingxuan?...` 中直接注入当前候选，源码 SHA-256 为
  `a60d06ff18b60f9ef47562ab1a81c8b90bc37bf11092c9724f7221581a198cb2`。评论承载层已捕获，评论 DOM/记录各为
  10，旧 `data-ob-kind="modal"` 批量条为 `0`；统一评论管理器保持打开，搜索和多选可用。连续 10 秒采样 18 次，
  心跳错误 `0`，评论数量从最低 20 增至最终 151，最大单次 CDP 响应延迟 149ms。探针只使用内存名单 stub，未读取
  Cookie，未点击举报、官方拉黑、关注或其他平台写入控件。
- **`blocked`**：2026-08-27，隔离公开探针 `node test/real-platform-probe.cjs douyin --verify-local` 被抖音验证码
  中间页拦截，候选数和带身份条目数均为 `0`；因此该探针不作为本候选的真实行为通过证据。

**检查**

`node --check omniblock.user.js`、`node --check test/adapters.cjs`、`node --check test/real-douyin-probe.cjs`、
`node test/comment-manager.cjs`（3/3）、`node test/quickblock.cjs`（32/32）、`node test/adapters.cjs`（21/21）、
`node test/state.cjs`（7/7）、`node test/run.cjs`（14/14）、`node test/douyin.cjs`（2/2）、
`node test/weibo-replay.cjs`（11/11）和 `git diff --check` 均通过。专用登录态探针
`node test/real-douyin-probe.cjs --current --duration=10` 返回 `blocked: []`。

**限制**

真实站点证据覆盖本次专用 Chrome 中可见的评论侧栏；平台未来若改变侧栏根节点 ID，`isScope` 会安全地保留旧条
而不会误删其他 Modal，但需要捕获新结构后再适配。未迁移到统一管理器的平台或非评论用户列表 Modal 仍保留原有
「拉黑全部」入口。

**发布**

该候选在 2026-08-28 开始自动规则工作前已单独本地提交为 `5be1114`，未推送、未打 tag、未创建 Release；已发布的
`v0.43.0` 不受影响。原始候选阶段的“未提交”状态是当时记录，不与当前自动规则候选混合。

**下一步验证**

用户确认专用 Chrome 中只保留新的右下角多选评论入口后，再将候选版本提升为 `0.44.0`，同步 changelog 并按发布门禁
提交、推送和创建 Release。

### 2026-08-27 - 0.43.0 - 抖音弹幕跨视频会话隔离

**范围**

用户反馈：在抖音精选/推荐流刷到下一个视频后，弹幕屏蔽管理器仍显示上一个甚至更早视频的发送者。复现确认：
当前管理器只用 `location.pathname + location.search` 作为缓存会话键；同一路由复用播放器时 URL 不变，旧记录因此
持续累积。时间轴扫描还可能在视频切换后继续写回旧会话。

**改动文件**

- `omniblock.user.js`：抖音适配器从已捕获的播放器容器 `basePlayerContainer` 读取 `video_<id>`，将其与路由组成
  视频会话键；管理器按视频键清空记录、选中项、搜索和扫描状态，并把弹幕收集范围限制到当前播放器。时间轴扫描
  增加会话代际与取消保护：切视频后旧扫描不再恢复旧播放器时间、不再继续把旧弹幕写入新视频；渲染同时防止已关闭的旧
  管理器节点被异步回调再次写入。工作区 `RUNTIME_BUILD` 和 `@version` 已提升为
  `0.43.0-douyin-danmaku-video-session-guard` / `0.43.0`。
- `test/adapters.cjs`：抖音弹幕夹具增加“URL 不变、播放器 `video_<id>` 变化、旧层移除并挂载新层”的回归；旧实现
  在该断言上显示旧记录并失败，新实现要求只显示新视频发送者。
- `test/real-douyin-probe.cjs`：增加 `--current` 复用专用 Chrome 当前抖音标签页和
  `--verify-video-switch` 双视频断言；探针在管理器滚动后重新选择仍连接的当前弹幕节点，避免把平台回收造成的旧节点
  当成插件故障。
- `README.md`、`CHANGELOG.md`：补充精选/推荐流换视频时弹幕观察缓存隔离的用户可见说明、验证边界和发布信息。

**证据**

- **`structure regression`**：改动前运行 `node test/adapters.cjs` 为 20 项通过、1 项失败；失败项的实际夹具结果为
  同一路由切换后仍显示旧弹幕 2 条。改动后同一命令为 21/21，断言管理器只显示新视频的 1 条记录，旧作者键均不在
  新面板中；`node --check omniblock.user.js` 与 `git diff --check` 通过。
- **`real-site verified`**：2026-08-27，在用户已登录的专用持久 Chrome 当前抖音标签页中直接注入版本元数据提升前的工作区候选，脱敏
  页面形式为 `douyin.com/jingxuan?...`。该候选与 `0.43.0` 的行为代码相同，仅版本/构建标识不同；真实点击“下一个视频”后，
  初始视频会话键和下一视频会话键不同；初始管理器 12 行，切换后旧管理器关闭，新管理器 12 行，旧视频身份 12 个全部不再
  出现，新视频记录存在。换片完成后继续采样 10 秒、20 次，CDP 心跳错误 0、最大单次响应延迟 25ms。该候选源码 SHA-256 为
  `dbdbf87cdd10e55510e71b1090a4868a6ea2b4939d3e0afe8d901125adbe373c`；名单仅使用探针内存 stub，未读取 Cookie 或触发平台
  写入控件。
- **`real-site verified`**：2026-08-27，在同一专用 Chrome 的抖音视频页不切换视频连续采样 30 秒、55 次，版本元数据提升前候选
  运行期间心跳错误 0，最少观察到 11 条弹幕和 10 条评论，最终分别为 20 条和 172 条，最大单次响应 224ms；这项只证明该次
  真实页面会话的稳定性，不外推到其他视频或未加载的弹幕。
- **`blocked`**：版本提升为 `0.43.0` 后在专用 Chrome 的两次精确短探针中均未渲染出带发送者身份的弹幕，无法重新执行双视频断言；
  同日重复运行 90 秒真实探针时，抖音动态渲染还出现过换片后短暂 4 次弹幕/评论节点为空。探针没有记录 CDP 超时或脚本
  异常；这些结果不改写为 `0.43.0` 的长时无缺口通过，也不否定已经通过的行为隔离断言。

**检查**

已运行 userscript、评论管理器、适配器、微博回放和抖音真实探针的 `node --check`；本地完整矩阵为
`node test/comment-manager.cjs` 3/3、`node test/quickblock.cjs` 32/32、`node test/adapters.cjs` 21/21、
`node test/state.cjs` 7/7、`node test/run.cjs` 14/14、`node test/douyin.cjs` 2/2、`node test/weibo-replay.cjs` 11/11，
均通过。`git diff --check` 退出码 0；仓库要求的 `node test/real-platform-probe.cjs douyin --verify-local` 在公开
未登录页停在验证码中间页，按规则记为 `blocked`。版本元数据提升前专用 Chrome 的
`node test/real-douyin-probe.cjs --current --verify-video-switch --duration=10`（双视频断言通过）和
`node test/real-douyin-probe.cjs --current --duration=30`（基线通过）已记录；提升到 `0.43.0` 后的精确短探针因无身份
弹幕记为 `blocked`。

**限制**

视频标识优先使用当前真站捕获到的播放器 `video_<id>` class；如果未来平台同时移除路由和播放器标识，脚本会退回
路由键并保持安全的当前 DOM 观察范围，不能在没有可靠身份时猜测视频归属。

**发布**

`0.43.0` 已发布：功能提交 `8c8eb23` 已推送到 `origin/master`，`v0.43.0` tag 已创建并推送，GitHub Release：
<https://github.com/a2787/ub-utils/releases/tag/v0.43.0>。既有 `v0.42.0` tag 和 Release 保留，未覆盖。

**下一步验证**

发布后的下一项最有价值验证是用户在自己的 Tampermonkey 中更新到 `0.43.0`、刷新抖音页面，再实际滚动精选/推荐流并
打开弹幕管理器，核对齿轮上的版本和构建标识。

### 2026-08-27 - 0.42.0 - 三平台评论管理器、屏蔽该楼回复与运行时防重复

**范围**

按已批准的升级方案，统一 B 站、抖音、微博的评论屏蔽入口，并增加只写本地名单的「🧵 屏蔽该楼回复」操作。
本轮不改变现有名单格式，不调用平台举报、官方拉黑、关注、发帖等写入控件；当前源码和发布版本均为 `0.42.0`。

**改动文件**

- `omniblock.user.js`：新增统一 `CommentRecord` 归一化、按作者去重的全窗评论管理器、搜索/筛选全选/一次提交/撤销，
  以及三平台主评论的楼操作。B 站管理器复用公开根评论和子回复读取；抖音、微博只读取当前页面可确认的 DOM、展开控件
  和安全滚动结果，并在接口或页面结构不足时标记部分。微博虚拟列表观察器继续隔离脚本自有 UI、记录自身写回并避免
  自激整列表重排；B 站只读评论 API 请求显式不携带登录 Cookie；同一文档内重复执行源码时由运行锁拒绝第二套扫描器、
  观察器、定时器和 UI，源码更新仍以刷新/新文档为生效边界。
- `test/comment-manager.cjs`：新增三平台统一管理器、作者合并、搜索、多选、一次持久化提交、撤销和主/子评论楼操作回归。
- `test/quickblock.cjs`、`test/adapters.cjs`、`test/state.cjs`：更新 B 站、抖音菜单唯一性、微博层级边界和通用状态断言。
- `test/real-bilibili-probe.cjs`、`test/real-douyin-probe.cjs`、`test/real-login-probe.cjs`：增加统一管理器、自动读取、
  搜索、多选、楼操作和源码注入标识检查；登录态探针继续使用内存名单 stub。抖音探针的 `--duration=<秒>` 现在真正控制
  连续稳定性采样，并输出经过脱敏的采样数量、心跳错误和延迟；微博登录态探针增加 `--verify-reply-modal`，覆盖真实楼中楼
  portal 中的回复归属、主/子评论入口边界以及本地屏蔽/撤销；并增加 `--observe-empty-feed` 和脱敏热搜面板指标，
  用于区分“热搜榜页没有帖子卡片”和“无限流帖子页没有内容”；`--repeat-inject=<n>` 用于验证同一文档的重复注入
  不会叠加运行时。
- `test/maintenance-check.cjs`：把统一管理器语法与回归纳入维护门禁。
- `README.md`：记录 `0.42.0` 的用户可见行为、真实验证表和限制；`CHANGELOG.md`：新增本版本的用户可见变更、
  三类证据边界和发布说明。

**证据**

- **`real-site verified`**：2026-08-27，在公开、未登录的隔离浏览器 `bilibili.com/video/...` 中直接注入当前源码
  `0.42.0`（源码 SHA-256 为 `5135c28f53294c64d0ca404d0b8224e48c5c013bc3ad1f05a18fee716ec03e60`）。真实页观察到
  管理器 3 行，搜索、全选、刷新和面板保持打开均成功；当前页面第一条评论菜单恰有一个「本地拉黑」和一个
  「屏蔽该楼回复」。楼操作在内存名单中一次写入 5 个身份键并成功撤销；弹幕管理器观察到 58 个文案组、54 位发送者，
  8 条悬浮弹幕完成单条/批量屏蔽与撤销，脚本错误 0。管理器状态仍如实显示部分提示，因此这不是“已读取 B 站全量评论”的证据。
- **`real-site verified`**：2026-08-27，在用户已登录的专用持久 Chrome（固定 `127.0.0.1:9222`，直接注入当前 `0.42.0` 源码）
  的脱敏微博热门帖子流 `weibo.com/hot/list/...` 连续滚动 90 秒：帖子/回收行从 6 增至 11，跟踪 10 个内容，负向滚动 0、
  视觉跳变 0、心跳错误 0，p95 响应 6ms；热搜面板与数据持续存在。运行时标识与源码 SHA-256 为
  `5135c28f53294c64d0ca404d0b8224e48c5c013bc3ad1f05a18fee716ec03e60`，构建为
  `0.42.0-comment-manager-thread-runtime-guard`。
- **`real-site verified`**：2026-08-27，前一候选在同一用户已登录专用 Chrome 的脱敏微博用户页 `weibo.com/u/...` 中，先展开页内
  评论后观察到 9 个评论列表、9 个主评论和 9 个虚拟行；管理器从当前路由缓存显示 26 行，搜索/全选成功，9 个主评论
  有楼操作、回复为 0 个楼操作，执行与撤销成功。该次探针同样运行在前一候选 `49051dc3a41c7d193e5112d8651db49fb89ac6aaee6cf18a92041d7858df56e1`；
  该结果只覆盖已实际捕获的用户页结构，不外推到未打开的楼中楼弹窗变体。
- **`real-site verified`**：2026-08-27，前一候选在同一用户已登录专用 Chrome 中直接注入（SHA-256 为
  `eaa580456e92e25a61a04f63c8a07b40ff4c00e34d9abe0501b4bb6d7084270d`），分别复核脱敏微博用户页和帖子详情页的真实楼中楼
  portal。用户页实际识别 5 条回复、5 个回复本地按钮、1 个主评论楼按钮且回复没有楼按钮；详情页识别 2 条回复、2 个回复
  本地按钮、1 个主评论楼按钮且回复没有楼按钮。两页均验证回复归属、主评论保持可见、本地屏蔽确认、隐藏、撤销和恢复；每页
  连续 90 秒心跳错误 0，p95 延迟分别为 5ms 和 4ms。该证据只覆盖本轮实际打开的两种 portal，不外推到其他微博弹窗变体。
- **`real-site verified`**：2026-08-27，在用户已登录的专用持久 Chrome 的抖音视频弹窗中直接注入当前 `0.42.0` 源码
  （SHA-256 为 `5135c28f53294c64d0ca404d0b8224e48c5c013bc3ad1f05a18fee716ec03e60`）。真实页观察到 1 条带发送者身份的弹幕、
  10 条评论 DOM 和 10 条可识别记录；评论批量入口在右下角 `right:14px; bottom:106px`，齿轮在 `right:14px; bottom:14px`，
  弹幕入口在 `bottom:62px`。评论/弹幕管理器的搜索、全选、加载入口、批量屏蔽/撤销和单条弹幕本地屏蔽均成功，脚本错误 0。
  探针连续运行 90 秒、采样 166 次，心跳错误 0，评论从 20 增至 257，弹幕从 3 增至 10，最大单次响应延迟 227ms。
- **`real-site verified`**：2026-08-27 的上一候选抖音入口回放保留为历史证据：实际点击精选入口视频后，管理器连续 90 秒
  采样 164 次、心跳错误 0，评论从 18 条以上增长到 244 条；当前版本新增的运行时防重复锁不改变该平台路径。
- **`real-site verified`**：2026-08-27，在同一用户已登录专用 Chrome 的脱敏微博首页 `weibo.com/` 进行 90.18 秒无限流只读
  滚动；采样 1793 次，负向滚动 0 次、视觉跳回 0 次、残余补位 0、心跳错误 0，实际帖子/回收行数量在 6 到 15 之间变化，
  未发现空白行或整页消失。该证据验证了当前可渲染首页的持续加载稳定性，不外推到没有渲染内容的热门榜单路由。
- **`real-site verified`**：2026-08-27，在同一专用 Chrome 对用户提供的脱敏热门榜单 URL 做同路由 A/B。无候选基线和直接
  注入当前源码的候选均持续显示热搜面板与热搜数据，30 秒内 `查看完整热搜榜单` 始终存在；候选心跳错误 0、p95 延迟 3ms，
  无候选心跳 p95 为 3ms。两组均为 0 个 `article` 和 0 个虚拟回收行，证明该 URL 当前渲染的是热搜榜面板而不是帖子无限流，
  不能用帖子卡片数量判定该页被插件拦截；候选页也没有出现页面无响应。
- **`real-site verified`**：2026-08-27，在同一专用 Chrome 的实际脱敏热门榜单帖子流 `weibo.com/hot/list/...` 上，
  直接注入当前 `0.42.0` 源码连续滚动 90 秒：帖子/回收行从 6 增至 11，跟踪 10 个内容，负向滚动 0、视觉跳变 0、
  心跳错误 0，p95 延迟 6ms；热搜面板和热搜数据均保持存在。当前源码 SHA-256 为
  `5135c28f53294c64d0ca404d0b8224e48c5c013bc3ad1f05a18fee716ec03e60`，运行构建为
  `0.42.0-comment-manager-thread-runtime-guard`。这项证据说明单次正常注入不会阻断该热门帖子流的加载。
- **`structure regression`**：`node test/comment-manager.cjs` 3/3、`node test/quickblock.cjs` 32/32、
  `node test/adapters.cjs` 21/21、`node test/state.cjs` 7/7、`node test/run.cjs` 14/14、`node test/douyin.cjs` 2/2、
  `node test/weibo-replay.cjs` 11/11；覆盖作者去重、示例文本/数量/层级、搜索、多选一次提交、撤销、B 站无手动展开时的
  根评论/子回复读取契约、抖音入口去重、微博虚拟行复用和管理器 UI 隔离。
- **`structure regression`**：同文档重复执行断言已纳入 `node test/run.cjs` 的 K 项；第二次执行只增加运行锁的重复计数，
  不再创建第二个齿轮、扫描器、观察器或定时器。
- **`blocked`**：对该热门榜单 URL 的“帖子无限流滚动跳回”指标仍然不适用，因为两组 A/B 都没有帖子卡片和虚拟回收行；这不再
  被解释为插件导致热搜榜加载失败。隔离抖音探针仍可能在公开入口遇到验证码中间页；B 站公开页的根评论分页也曾因接口读取
  失败而返回部分；微博和抖音楼操作在没有稳定全量接口时同样按设计标记部分。

**检查**

文档更新后已复跑完整本地阶段：`node --check`（userscript、评论管理器和真实探针）、`node test/comment-manager.cjs`
3/3、`node test/quickblock.cjs` 32/32、`node test/adapters.cjs` 21/21、`node test/state.cjs` 7/7、
`node test/run.cjs` 14/14、`node test/douyin.cjs` 2/2、`node test/weibo-replay.cjs` 11/11，均通过。
`git diff --check` 退出码 0；公开隐私扫描没有命中具体微博/B站页面或账号标识。`node test/maintenance-check.cjs`
的本地阶段全部通过，真实站点阶段按下方两项缺口以 `blocked` 退出。专用登录态探针只操作脚本自身 UI，名单写入均为
内存 stub，没有读取 Cookie 或导出页面私密数据。

**限制**

- 统一管理器的全量语义受平台数据源限制：B 站受公开分页读取结果与安全上限约束；抖音没有稳定公开的楼中楼全量接口；
  微博只有当前路由内真实观察到的 DOM/展开结果。部分加载必须持续显示，不能当作全量完成。
- 本轮已在专用 Chrome 的抖音精选视频评论弹窗中验证从入口点击进入和连续稳定性，也已在微博真实用户页、帖子详情页楼中楼
  portal 中完成独立操作验收；微博其他未实际打开的 portal 变体仍不外推。用户提供的 `/hot/weibo/...` 当前是热搜榜页，
  A/B 已证明候选不会让该热搜面板消失，但它不代表另一条“热门推荐”帖子无限流路由；两者需分开验证。抖音直接 `/video/...`
  路由尚未由站点入口暴露出可独立确认的链接，本轮不把精选 Modal 的结果写成直达详情路由的证据。
- 当前发布源码为 `@version 0.42.0`；用户主浏览器仍由用户自行更新和刷新，专用 Chrome 继续作为只读回归入口。

**发布**

本轮真实站点和本地门禁已完成，按用户要求发布 `0.42.0`。功能实现提交为
`05216b3`；`master`、`v0.42.0` tag 和 GitHub Release 均以本轮发布收口结果为准，固定 Release 地址为
`https://github.com/a2787/ub-utils/releases/tag/v0.42.0`。热门榜单 URL 的热搜面板 A/B 仍只证明该路由当前是榜单
面板而不是帖子流；实际 `weibo.com/hot/list/...` 帖子流的 90 秒滚动探针已通过。

**下一步验证**

发布后最有价值的动作是用户在自己的 Tampermonkey 中更新到 `0.42.0`、刷新目标页面并核对齿轮的版本/构建标识；专用
Chrome 继续保留为只读回归入口。若要继续追查用户所说的另一条热门推荐路由，最有价值的是在专用 Chrome 打开实际出现
帖子卡片的页面；当前给出的 `/hot/weibo/...` 已确认是热搜榜页。所有运行时页面仍只点击脚本自身 UI。

### 2026-08-26 - v0.41.0 候选 - 微博无限流整帖补位与滚动稳定性

**范围**

用户反馈：微博热门/推荐无限流页面向下加载一两页后继续滚动时，页面会先上跳一两帧又回到原位；随机本地拉黑
帖子作者后，帖子虽然消失，原位置却没有被后续帖子补上。专用 Chrome 的旧运行时确认了第一类问题的直接原因：
作者按钮插入微博 `vue-recycle-scroller` 的布局树，按钮的 `childList` 变化又被全局扫描器当成虚拟行结构变化，
触发整列表同步。第二类问题的直接原因是帖子卡片被隐藏后，平台保留了外层 `item-view` 的物理位置；旧路径只
隐藏卡片，没有把原高度从回收列表和直接内容层的累计位移中扣除。另一个会放大问题的路径是 CSSOM 会把高精度
`px` 规范化为短小数；脚本若拿写入前的字符串和规范化后的值比较，就会把自己的写回当作新平台基线，持续重复
减去隐藏高度，最终造成空白和页面无响应。

**改动文件**

- `omniblock.user.js`：版本/构建更新为 `0.41.0` / `0.41.0-weibo-feed-recycler-portal`；微博虚拟帖子卡片的作者
  入口改为 `body` 下的独立 fixed portal，按作者链接视口坐标定位，物理卡片复用时重新读取当前身份；整帖作者
  命中时记录虚拟行种类与原高度，把隐藏高度从列表 spacer 扣除并在直接内容层补位，撤销后恢复全部状态。详情页
  虚拟评论判定改为检查虚拟列表 wrapper 的详情结构，避免把无限流帖子内预览评论当成详情页顶层评论；扫描器
  忽略脚本自身 UI 的纯 `childList` 变化，普通无限流结构不会启动虚拟补位协调；列表/内容层写回记录 CSSOM 实际值，
  避免自激重排。
- `test/weibo-replay.cjs`：新增人工合成的热门无限流帖子卡片/预览评论夹具、整帖屏蔽后平台反复回写回归，以及
  80 行、100 次作者节点复用压力；继续覆盖详情页直接内容层补位、回收行再激活、内容层重绘、用户主页嵌套评论
  和长期平台回写。
- `test/real-login-probe.cjs`：增加 `--scenario=feed`、`--disable-quick-block`、`--target-id=` 和固定桌面视口；
  热门流探针没有帖子卡片/回收行时硬记 `blocked`，不再把导航壳误报为通过；重用专用标签页时先经过新 document，
  确保探针执行的是当前工作区源码；导航完成后移除本轮 `addScriptToEvaluateOnNewDocument`，避免同一标签页
  重复测试时叠加初始化脚本。
- `README.md`、`CHANGELOG.md`：补充用户可见行为、验证边界和 v0.41.0 发布说明。

**证据**

- **`real-site verified`**：2026-08-26，用户已登录的专用持久 Chrome 中直接注入当前工作区 `0.41.0` 候选，
  在脱敏形式 `weibo.com/...` 的热门/推荐无限流页面实际完成整帖本地屏蔽：初始页面渲染 7 张帖子和 7 个回收行，
  点击脚本自己的作者入口后目标帖子高度为 0，下一条内容立即接到目标原位置。继续动态加载并滚动 90 秒，完成
  1,422 次 100ms 采样、90 次滚动，最多观察到 17 张帖子；视口内卡片自然间距峰值 8px，未屏蔽活动空行峰值 0，
  审计错误 0，页面始终可响应。候选无滚动基线心跳 10 次，p95 7ms、错误 0；运行标识和源码 SHA-256 为
  `d507f008b5a401ed68d8a79e3356e79f20a7eee5b7f432bb3746e3ccf5043cab`。名单仅写入探针内存 stub，结束时已撤销；
  未读取 Cookie，也未点击微博举报、官方拉黑、关注或发帖控件。
- **`structure regression`**：`node test/weibo-replay.cjs` 11/11；旧版对照
  `node test/weibo-replay.cjs --git-ref=v0.40.0` 为 8 项通过、3 项失败，旧版失败项包含行内作者入口、整帖屏蔽
  不补位和 80 行复用触发虚拟同步。通用 UI 13/13、状态 7/7、B站 32/32、抖音 2/2、跨平台适配器 21/21；
  `node --check omniblock.user.js`、探针/回放语法检查和 `git diff --check` 通过。
- **`blocked`**：`node test/real-platform-probe.cjs weibo --verify-local` 自动发现的公开详情页虽然加载评论，但没有
  带可测 spacer 的活动顶层虚拟评论；`node test/maintenance-check.cjs` 的抖音子探针被验证码中间页拦截。两项不覆盖
  本轮已在专用登录态完成的热门流测试，也没有被改写成通过。

**限制**

- 本轮已在实际渲染帖子的登录态热门流中验证作者入口、整帖补位和长时间回收；详情页与用户主页的真实结论仍不外推
  到微博其他未捕获的虚拟列表变体。若平台更换回收器结构，需要重新捕获并补回放。
- `body` portal 依赖作者链接在当前视口内可测；物理行回收或作者身份暂时不可解析时会隐藏/重建入口，不猜测身份。
- `0.41.0` 已完成候选验证并提交，实现提交为
  `fa978f0f39e03374029912b9f1c2a3dc037b236c`；本次发布边界使用 `v0.41.0` tag 和同版本 GitHub Release。
  候选没有安装到用户主浏览器，专用浏览器中的直接注入也不改变 Tampermonkey 已安装版本。

**下一步验证**

发布后继续保留专用 Chrome 作为后续微博结构变化的只读回归入口，主浏览器由用户自行更新和最终体验验收。

### 2026-08-26 - v0.40.0 - 微博详情页回收行立即补位

**范围**

用户在已安装 v0.39.0 的微博帖子详情页展开全部评论后，屏蔽主评论的位置仍留白；用户主页页内评论展开路径
已能正常补位。专用 Chrome 只读复现确认：详情页的物理 `vue-recycle-scroller__item-view` 重新激活时，微博会
清掉直接内容层的本地 `translateY`，而 v0.39.0 的观察器把外层行回写按平台静默窗口延后，或者没有观察到只发生在
内容层的重绘。因此 spacer 的总高度已经缩短，但后续内容层在绘制窗口内回到原位，表现为主评论位置空白。

**改动文件**

- `omniblock.user.js`：版本/构建更新为 `0.40.0` / `0.40.0-weibo-detail-recycler-immediate-sync`；详情页虚拟
  列表观察器只订阅直接虚拟行、直接内容层的 `style` 和列表成员变化；平台行/内容重写在同一观察回调内立即
  同步，脚本自身的内容层写回可识别并忽略。
- `test/weibo-replay.cjs`：新增详情页物理行回收再激活、内容层单独重绘回归；当前源码 8/8，通过 `--git-ref=v0.38.0`
  对照确认旧版在新增详情断言上失败。
- `README.md`、`CHANGELOG.md`：更新当前候选版本、详情页即时补位行为和证据边界。

**证据**

- **`real-site verified`**：当前源码在专用持久 Chrome 的登录态微博帖子详情页直接注入，90 秒只读滚动探针中目标
  主评论保持隐藏，后续内容层连续补位；源码 SHA-256 为
  `4cb1a305e855c03f18d582f038d887ee6cbf1931bd21cede39f5894319323265`，采样 1802 次，活动空行峰值 0、可见间隙
  峰值 0，CDP 心跳 p95 4ms、错误 0，立即重同步计数 34。探针不读取 Cookie，不点击微博举报、官方拉黑、关注或
  发帖控件。
- **`structure regression`**：`node test/weibo-replay.cjs` 当前候选 8/8；`node test/weibo-replay.cjs --git-ref=v0.38.0`
  结果为 6 项通过、2 项新增详情回收断言失败；`node test/run.cjs` 13/13、`node test/state.cjs` 7/7、
  `node test/quickblock.cjs` 32/32、`node test/douyin.cjs` 2/2、`node test/adapters.cjs` 21/21。
- **`blocked`**：`node test/real-platform-probe.cjs weibo --verify-local` 若未发现活动顶层虚拟评论 spacer，仅将该隔离探针
  子条件记录为 blocked，不扩大为真实详情页 spacer 已通过。

**限制**

- 详情页适配仍依赖已捕获的 `woo-panel-main` 与虚拟行直接内容层 `wbpro-list > item1` 结构；其他微博虚拟列表变体
  需要重新捕获。平台坚持恢复 spacer 原始基线时，末尾可能仍有少量可滚动余量，但本轮修复针对评论中间空洞。
- 本次专用 Chrome 验收使用直接注入临时标签页；刷新或关闭会失去内存存储和注入代码，主浏览器不会因此自动更新。

**检查与发布状态**

- 版本元数据更新后的专用详情页 90 秒回归已经完成：`sourceHash` 与 0.40.0 构建标识一致，
  `maxVisibleGap=0`、`maxUnblockedEmptyRows=0`、CDP 心跳 p95 4ms、无心跳错误；观察器记录 34 次立即重同步，
  没有产生自激心跳超时。
- 用户已在专用 Chrome 保留页面中确认 v0.40.0 无问题；提交
  `46849119394b2595f7ec2281e490769c797b2422` 已推送到 `origin/master`，`v0.40.0` tag 已创建并推送，
  GitHub Release：<https://github.com/a2787/ub-utils/releases/tag/v0.40.0>。

**下一步验证**

完成发布后，继续保留专用 Chrome 作为后续微博结构变化的只读回归入口；若微博改动虚拟列表结构，先重新捕获结构，
再补充回放断言和新的真实站点证据，不把本次结果外推到未捕获的列表变体。

### 2026-08-26 - v0.39.0 候选 - 微博详情页顶层评论与用户主页补位路径合并

**范围**

用户反馈：v0.38.0 在用户主页帖子自带的页内评论展开场景可以正常补位，但帖子详情页点击“展开全部评论”后，
屏蔽顶层评论仍留下空白，说明两个场景没有共用同一条虚拟列表路径。专用 Chrome 现场复现显示，详情页顶层评论的
真实结构是 `vue-recycle-scroller__item-view > wbpro-scroller-item > wbpro-list > item1`；v0.38.0 的结构保护只允许
评论直接挂在虚拟行或直接内容层下，因此把详情页顶层评论误判为用户主页式嵌套评论，`virtualSyncs` 为 0，后续行保留
原始位置形成空洞。

**改动文件**

- `omniblock.user.js`：在 `woo-panel-main` 详情面板中识别内容层直接子级 `wbpro-list > item1` 为顶层虚拟评论，继续拒绝
  用户主页帖子内容层更深处的同名列表接管外层帖子；版本/构建更新为 `0.39.0` /
  `0.39.0-weibo-detail-list-virtual-spacer`。
- `test/weibo-replay.cjs`：新增基于专用 Chrome 详情结构脱敏的顶层 `wbpro-list > item1` 回放；旧 v0.38.0 在该断言上失败，
  当前详情页和用户主页保护共同通过，回放总数由 6/6 增为 7/7。
- `README.md`、`CHANGELOG.md`：补充详情页和用户主页使用不同安全判定的用户可见说明与候选验证边界。

**证据**

- **`real-site verified`**：2026-08-26 在用户确认登录的专用持久 Chrome 中直接注入当前 v0.39.0 源码，打开脱敏形式
  `weibo.com/...` 详情页并用内存名单屏蔽一条顶层评论。源码 SHA-256 为
  `7cdac45ab6f4c25769ebcf06026f6ab29ed9582211e83b81a50102a96773dff7`；90 秒完成 1805 次采样，目标行保持隐藏，
  后续内容层连续补位，可见间隙峰值 0、未屏蔽活动空行峰值 0，CDP 心跳 p95 5ms，无登录/验证码拦截或超时。未读取
  Cookie，未点击微博举报、官方拉黑、关注或发帖控件。
- **`structure regression`**：`node test/weibo-replay.cjs` 7/7、`node test/adapters.cjs` 21/21；通用 UI 13/13、状态 7/7、
  B 站 32/32、抖音 2/2、语法检查通过。旧版对照 `node test/weibo-replay.cjs --git-ref=v0.38.0` 在新增详情页断言上失败，
  证明测试能捕获本次“详情页未补位”缺陷。
- **`blocked`**：同日 v0.39.0 用户主页登录态探针没有可解析的评论目标；隔离公开微博探针没有发现可测的活动顶层虚拟评论
  spacer。它们没有被改写为线上通过。

**限制**

- 详情页补位依赖本轮真实捕获的 `woo-panel-main` + 虚拟行内容层直接子级 `wbpro-list > item1` 结构；微博其他页面若
  使用不同的详情容器或虚拟列表层级，仍需重新捕获后再加适配。
- 用户主页嵌套评论仍只折叠评论自身，避免移动外层帖子；本轮 v0.39.0 用户主页探针因没有可解析评论目标而记为
  `blocked`，该路径的上一轮真实站点证据和本轮人工结构回放仍保留，但不扩大线上声称范围。
- 当前候选尚未提交、推送、打 tag 或创建 Release；不会自动更新主浏览器。专用 Chrome 中应保留直接注入的候选标签页，
  刷新或关闭会使内存 stub 和注入代码消失。

**下一步最有价值的验证**

用户在专用 Chrome 的保留详情页中关闭设置面板，展开评论并点击一条“本地拉黑”，观察该评论下方内容是否立即补位且
等待数秒后不闪回；随后再回到用户主页页内评论展开场景确认整条帖子和下方帖子不移动。用户确认后再提交、推送、打 tag
和创建 v0.39.0 Release。

### 2026-08-26 - v0.38.0 候选 - 微博用户主页嵌套评论保护

**范围**

用户反馈微博用户主页中，点击帖子自带的页内评论展开入口后，本地屏蔽主评论会闪动并影响下方帖子。
复现确认：这类评论位于整条帖子 `vue-recycle-scroller__item-view > wbpro-scroller-item` 更深处的普通
`wbpro-list > item1`，并不是独立的评论虚拟行；旧逻辑只要找到最近的 `item-view` 就会把整帖加入虚拟补位，
从而移动帖子内容、和微博回收器互相写回。`0.38.0` 只允许评论直接挂在虚拟行或其直接内容层下时参与虚拟补位，
嵌套评论仍由普通评论隐藏/折叠路径处理，不再移动外层帖子。

**改动文件**

- `omniblock.user.js`：新增 `virtualCommentRowOf` 结构判别；用户主页深层 `wbpro-list` 评论不注册为外层帖子的
  虚拟补位行；增加诊断计数 `weiboNestedVirtualRowsIgnored`；`@version`/`RUNTIME_BUILD` 为 `0.38.0` /
  `0.38.0-weibo-nested-comment-guard-douyin-manager`。
- `test/weibo-replay.cjs`：把用户主页帖子内嵌套评论作为独立人工合成契约，断言屏蔽后整帖和下方帖子外层位置不变、
  内容层不继承旧位移、物理行复用和撤销不留空洞；将顶层回放等待改为“目标补偿值或明确超时”，消除并行浏览器负载造成的
  固定 sleep 假失败；旧版对照入口更新为 `--git-ref=v0.37.0`。
- `README.md`、`CHANGELOG.md`：同步用户主页页内评论行为、版本和验证边界。

**证据**

- **`real-site verified`**：2026-08-26 在用户确认登录的专用持久 Chrome 中，直接注入当前工作区源码（版本
  `0.38.0`、构建 `0.38.0-weibo-nested-comment-guard-douyin-manager`、源码 SHA-256
  `60f6aace1307dd21ba2516f4aea95ab5c56ac8b1d3cccd28c2975ac399b6ceb3`），打开脱敏形式 `weibo.com/u/...`，
  通过帖子页内入口展开评论。90 秒内评论列表展开为 11 个列表/11 条根评论/11 个虚拟行，内存名单命中的目标评论
  保持隐藏；CDP 心跳无错误、p95 约 5ms、可见空白回收行峰值 0、可见间隙峰值 0，嵌套虚拟行忽略计数 1396，
  页面没有出现无响应。探针未读取 Cookie，也未点击微博举报、官方拉黑、关注或发帖控件。
- **`real-site verified`**：同日专用 Chrome 详情页 90 秒直接注入同一源码；目标评论保持隐藏，CDP 心跳无错误、p95
  约 5ms、长任务最大约 285ms、可见空白回收行峰值 0、可见间隙峰值 0，未观察到回收补位回弹；未触碰微博平台写入控件。
- **`structure regression`**：`node test/weibo-replay.cjs` 串行连续 3 次均为 6/6，`node test/adapters.cjs` 为 21/21；
  通用 UI 13/13、状态 7/7、B站 32/32、抖音 2/2、语法检查和 `git diff --check` 均通过。旧版
  `node test/weibo-replay.cjs --git-ref=v0.37.0` 在新增用户主页断言上失败，证明旧逻辑会把嵌套评论当作整帖虚拟行并留下
  下方内容层位移。
- **`blocked`**：本轮隔离公开微博探针成功加载并验证了评论/楼中楼入口，但发现的详情页没有带可测的活动直接顶层
  虚拟评论行，因此 spacer 子检查按规则记为 `blocked`；同次维护总检查中的隔离抖音仍停在验证码中间页。
  这些结果不替代专用登录态验证，也不被写成线上通过。

**限制**

- 用户主页页内评论的补位判定依赖本轮真实捕获的“评论位于帖子回收行更深层普通列表”结构；其他微博页面若把评论直接
  交给独立虚拟行，仍按直接子层规则处理，新的 DOM 变体需要重新捕获。
- 登录态由用户本人完成，探针只读页面并使用内存名单 stub，不证明账号身份，也不污染真实名单。

**版本/发布状态**

- `v0.38.0` 已发布：提交 `0c94669` 已推送到 `origin/master`，`v0.38.0` tag 已创建并推送，GitHub Release：
  <https://github.com/a2787/ub-utils/releases/tag/v0.38.0>。既有 `v0.37.0` 及更早版本保留，未覆盖。
- `node test/maintenance-check.cjs` 的本地阶段通过；其最终汇总为 `MAINTENANCE SELF-CHECK BLOCKED`，原因仅为上一条所述的
  隔离平台边界，不是源码结构回归失败。

**下一步最有价值的验证**

用户在 Tampermonkey 中更新到 `0.38.0`，确认齿轮上的运行标识为
`0.38.0-weibo-nested-comment-guard-douyin-manager`，刷新微博用户主页并再次点击页内评论展开，屏蔽一条主评论，
观察该帖及下方帖子是否保持稳定。

### 2026-08-26 - v0.37.0 - 微博虚拟列表直接内容层补位与验证闭环

**范围**

用户已安装过 `0.36.0`，本轮修复其后的微博虚拟评论空白、频闪、评论整体消失和页面无响应路径，版本提升为
`0.37.0`。根因是脚本持续改写微博回收器控制的外层 `transform` 与列表 spacer；平台回写后又触发脚本协调，
物理行复用还可能留下过期的屏蔽状态。正常补位现在只移动虚拟行的直接内容层，平台 spacer 单独回写只更新基线，
并在撤销时保留待处理同步直到内容层恢复。

**改动文件**

- `omniblock.user.js`：直接内容层位移、平台 spacer 基线接受、120ms 平台静默窗口、过期物理行状态清理和撤销同步保护；
  `@version`/`RUNTIME_BUILD` 为 `0.37.0`。
- `test/weibo-replay.cjs`：直接内容层补位、96 行持续回写、列表/评论内部 style 隔离、弹窗撤销和物理行复用回归。
- `test/adapters.cjs`：微博弹窗回复撤销等待完整同步并确认内容层恢复。
- `test/real-login-probe.cjs`：固定 9222 专用 Chrome、源码 hash/构建标识、心跳、长任务、活动空行和视觉间隙监测。
- `test/real-platform-probe.cjs`：接受内容层补位且 spacer 保持平台基线的真实页面断言。
- `test/weibo-dom-capture.cjs`：专用 Chrome 的微博结构与布局只读捕获工具。
- `README.md`、`CHANGELOG.md`：同步用户可见行为、验证边界和版本号。

**证据**

- **`real-site verified`**：2026-08-26 在用户确认登录的专用持久 Chrome 中直接注入当前 `0.37.0` 候选；两个实际有评论的
  `weibo.com/...` 详情页各验证虚拟评论路径 90 秒。两组均无 CDP 心跳错误，未屏蔽活动虚拟行零高度采样为 0，
  屏蔽目标保持隐藏；未读取 Cookie，也未点击微博举报、官方拉黑、关注或发帖控件。
- **`structure regression`**：`node test/weibo-replay.cjs` 6/6、`node test/adapters.cjs` 21/21；覆盖直接内容层补位、
  平台 spacer 连续回写、脚本自身写回隔离、弹窗回复撤销、96 行长期回写和物理行复用。
- **`blocked`**：个人主页目标本轮没有可解析评论候选；隔离公开探针还被环境 `ERR_NETWORK_ACCESS_DENIED` 阻断。
  这两项均未被写成线上通过。

**检查**

- 已通过：`node --check omniblock.user.js` 及全部探针/回归脚本语法、通用 UI 13/13、状态 7/7、B站快捷/弹幕 32/32、
  抖音 2/2、跨平台适配器 21/21、微博回放 6/6、`git diff --check` 和公开页面隐私扫描。
- 已通过：旧版可失败性复核 `node test/weibo-replay.cjs --git-ref=v0.36.0` 在直接内容层与物理行复用断言上失败 2 项，
  证明当前回归能够捕获旧行为。
- 已通过：当前 `0.37.0` 源码 hash/构建标识一致的专用登录态详情页探针，两页各 90 秒；心跳 p95 分别为 4ms、3ms，
  未屏蔽活动虚拟行零高度峰值均为 0，未发现 CDP 超时。
- `node test/maintenance-check.cjs` 的本地阶段通过；隔离抖音验证码页和微博公开探针受环境网络/登录态限制，按规则汇总为
  `blocked`，不是结构回归失败。

**限制**

- 正常补位依赖当前捕获到的微博 `vue-recycle-scroller` 直接内容层结构；不同虚拟列表变体仍需新的 DOM 捕获。
- 平台若坚持恢复自己的 spacer 原始基线，末尾可能保留少量可滚动余量；评论中间的空洞由内容层补位消除。
- 登录态由用户本人完成，探针只读页面并使用内存名单 stub，不证明账号身份，也不污染真实名单。

**版本/发布状态**

- `v0.37.0` 已发布：提交 `915c333` 已推送到 `origin/master`，`v0.37.0` tag 已创建并推送，GitHub Release：
  <https://github.com/a2787/ub-utils/releases/tag/v0.37.0>。既有 `v0.35.0`、`v0.36.0` 不覆盖。

**下一步最有价值的验证**

用户在 Tampermonkey 中更新到 `0.37.0`，刷新微博详情页，确认齿轮上的运行标识为
`0.37.0-weibo-virtual-content-offset-douyin-manager`，再观察本地屏蔽评论后的补位和长时间滚动。

### 2026-08-25 - v0.36.0 - 已安装用户更新号修订

**范围**

用户已安装过 `0.35.0`，同号发布无法被 Tampermonkey 识别为更新。本轮只把已经验证的实现重新编号为
`0.36.0`，同步 `@version`、`RUNTIME_BUILD` 和用户可见文档；不改变微博适配、屏蔽逻辑或 UI。同时将登录态
探针的隐藏确认改为最多 3 秒轮询，避免微博虚拟列表首轮扫描较慢造成验证工具误报。

**证据**

- **`real-site verified`**：行为代码沿用 2026-08-25 专用 Chrome 三组各 90 秒登录态只读探针结果；本轮
  没有平台代码变化，也没有读取 Cookie 或点击微博举报、官方拉黑、关注或发帖控件。
- **`structure regression`**：版本号修订后重新通过 userscript 语法、通用 UI、状态、B 站、跨平台适配器、
  抖音和微博回放检查；运行时版本标识应为 `0.36.0`，构建标识应为
  `0.36.0-weibo-virtual-spacer-douyin-manager`。
- **`blocked`**：隔离网络探针仍受环境 `ERR_NETWORK_ACCESS_DENIED` 限制；这不表示专用 Chrome 登录态验证失败。

**发布状态**

`v0.36.0` 已替代已安装的 `0.35.0`。提交 `fcb29a8` 已推送到 `origin/master`，`v0.36.0` tag 已创建并推送，
GitHub Release 已发布：<https://github.com/a2787/ub-utils/releases/tag/v0.36.0>。既有 `v0.35.0` tag 和 Release
均保留，未覆盖历史版本。

**下一步最有价值的验证**

用户在 Tampermonkey 中确认脚本更新到 `0.36.0`，刷新微博页面并核对齿轮显示的版本与构建标识。

### 2026-08-25 - v0.35.0 候选 - 专用浏览器闭环与微博自激重排修复

**范围**

本轮把登录态调试从主浏览器临时远程调试切换到固定的专用持久 Chrome，并修复微博虚拟列表在存在屏蔽行时由全局
`style` 观察、整列表布局读取和脚本自身样式回写形成的持续重排路径。当前候选通过直接 CDP 注入工作区源码验证，
不需要 Tampermonkey 安装或提高版本号。

**改动文件**

- `test/dev-browser.cjs`：使用 `C:\Users\et4vr\.browser-harness-chrome-profile` 和 `127.0.0.1:9222`，
  端口已有浏览器时直接复用，未运行时幂等启动；不连接用户主浏览器。
- `test/real-login-probe.cjs`：只读打开运行时提供的脱敏微博目标，注入当前源码和内存 GM stub，记录源码 hash、
  构建标识、CDP 心跳、页面性能计数、长任务和渲染进程 CPU；登录/验证码时保留标签页并返回 `blocked`。
- `omniblock.user.js`：微博改用按列表的专用观察器，只观察列表 spacer 和虚拟行自身 style；缓存行高，忽略脚本自身
  写回；平台改写 spacer 时用缓存高度立即纠正，完整行协调仍按列表 100ms 节流，并在无屏蔽工作后清理观察器。
- `test/weibo-replay.cjs`：增加 96 行、1 个屏蔽行的持续回写和评论内部 style 隔离回归，并保留旧 v0.34.0
  可失败性复核。
- `test/real-platform-probe.cjs`：增加 spacer 700ms 稳定采样、节点尺寸诊断和当前工作区注入标识检查。
- `test/maintenance-check.cjs`：将网络/登录/验证码导致的探针非零退出按 `blocked` 汇总，保留已加载页面错误的失败门禁。
- `README.md`、`CHANGELOG.md`：同步候选验证边界和不再以每次试验消耗版本号的维护流程。

**证据**

- **`structure regression`**：`node test/weibo-replay.cjs` 5/5、`node test/adapters.cjs` 21/21、`node test/run.cjs`
  13/13、`node test/state.cjs` 7/7；`node test/weibo-replay.cjs --git-ref=4b5fdca` 旧 v0.34.0 在新回归中
  4/5 项失败，持续屏蔽列表产生 36,765 次布局读取、静止窗口仍产生 9,120 次延迟读取，且未补偿 spacer；
  当前候选允许一次停止后的最终同步，之后 500ms 计数静止。
- **`real-site verified`**：2026-08-25 隔离未登录公开微博详情页注入当前工作区源码，顶层虚拟评论隐藏 63px 后
  `item-wrapper` 的 `min-height` 从 1329px 稳定缩至 1266px，700ms 采样无回弹，撤销恢复；探针未点击微博
  举报、官方拉黑、关注或发帖控件。
- **`real-site verified`**：2026-08-25 用户确认已登录的专用持久 Chrome 中，运行
  `node test/real-login-probe.cjs weibo --current --duration=90 --scenario=all`；基线、空名单、内存名单屏蔽
  三组均完整运行 90 秒，候选源码 hash/版本/构建标识一致，无登录/验证码拦截、CDP 心跳错误或页面无响应；
  空名单解析出评论目标，内存名单屏蔽目标保持隐藏。该探针未读取 Cookie，也未点击微博举报、官方拉黑、关注或发帖控件。
- **`blocked`**：同日初次探针输出的“登录页/候选未注入”由探针自身缺陷造成：基线模板正则丢失反斜杠、探针
  返回值受模板首换行的 ASI 影响、GM shim 对象少一个闭合括号；修正后已由上述长时探针复验，不再把该历史
  输出当作页面登录拦截证据。

**检查**

- 已通过：`node --check omniblock.user.js`、`node --check test/dev-browser.cjs`、`node --check test/real-login-probe.cjs`、
  `node --check test/weibo-replay.cjs`、`node --check test/real-platform-probe.cjs`、`git diff --check`（最终差异仍需重跑）。
- 专用工具基础检查已通过：`node test/dev-browser.cjs status`/`ensure` 返回固定 9222 和专用 profile，`ensure`
  复用已有浏览器（`launched: false`）；长时探针记录当前工作区源码 hash，并完成三组 90 秒验证。

**限制**

- 登录态由用户本人确认，探针不读取 Cookie，因此不能独立证明账号身份；本轮只证明专用 profile 中页面未出现登录/验证码
  拦截、候选源码确实注入并持续运行。微博其他虚拟列表变体仍需新的 DOM 捕获。
- 专用 profile 不复制主浏览器 Cookie；若登录态失效，由用户本人在专用窗口重新登录。

**版本/发布状态**

- v0.35.0 已发布；由于用户已安装过该版本，本轮以 v0.36.0 作为可识别更新重新发布同一实现。

**下一步最有价值的验证**

用户更新到 v0.36.0 后，核对齿轮上的版本和构建标识，再刷新微博页面做最终用户侧体验确认。

### 2026-08-25 - v0.35.0 候选 - 微博虚拟列表 spacer 补位

**范围**

本轮修复微博评论本地屏蔽后的虚拟列表尾部空白，并处理由同一适配器引入的页面卡顿路径。历史版本已经能把被屏蔽行的
`translateY` 调回连续位置，但没有同步缩短同一个 `vue-recycle-scroller__item-wrapper` 的
`min-height`；微博仍按旧总高度布局，因此评论区尾部留下与被隐藏行等高的空白。当前补丁在
屏蔽期间记录列表原始尺寸，按同列表中实际隐藏虚拟行的累计高度扣减 `min-height` 或显式
`height`，并在微博反复回写 spacer 时重新应用补偿；撤销时只恢复仍属于脚本补偿的尺寸，避免
覆盖平台新的合法基线。另一个根因是扫描器对每个未命中的普通虚拟评论也立即扫描整个列表，
再叠加微博持续回写 `style`，会把普通评论页拖入高频布局读取；现在只对有本地屏蔽行的列表排队，
并按列表/动画帧合并同步。

**改动文件**

- `omniblock.user.js`：新增虚拟列表尺寸状态、累计隐藏行高度补偿、平台 spacer 回写观察和撤销恢复；
  增加有屏蔽行才排队的虚拟列表同步；版本为 v0.35.0，构建标识为
  `0.35.0-weibo-virtual-spacer-douyin-manager`。
- `test/weibo-replay.cjs`：人工合成的真实 DOM 契约加入 `item-wrapper` 的 `min-height`，压力回写
  同时覆盖 transform/spacer，并断言隐藏后尺寸减少、撤销后恢复；加入无屏蔽行的高频样式回写性能
  断言。
- `test/real-platform-probe.cjs`：真实微博只读探针增加顶层虚拟评论 spacer 的单条隐藏/撤销断言；
  不点击微博平台举报、官方拉黑、关注或发帖控件。
- `README.md`、`CHANGELOG.md`：同步用户可见行为、根因和证据边界。

**证据**

- **`real-site verified`**：2026-08-25 隔离未登录浏览器打开公开微博详情页（脱敏形式
  `weibo.com/...`），使用 v0.35.0 当前源码实际观察到：顶层虚拟评论隐藏 63px 行后，所属
  `item-wrapper` 高度从 1568px 减至 1505px，撤销后尺寸和目标评论恢复；楼中楼独立隐藏时根评论
  从 191px 减至 139px，撤销恢复。探针无页面错误，也没有触碰平台写入控件。
- **`structure regression`**：`node test/weibo-replay.cjs` 4/4、`node test/adapters.cjs` 21/21；
  `node test/weibo-replay.cjs --git-ref=4b5fdca` 的旧 v0.34.0 源码在 spacer 和性能断言上失败，
  无屏蔽列表路径产生 1872 次布局读取，说明旧实现既没有处理容器总高，也没有隔离普通列表扫描。
- **`blocked`**：2026-08-25 用户已打开实际 Chrome 的远程调试并提供微博标签页；已定位脱敏的
  `weibo.com/...` 页面，但页面级 `Page.getFrameTree`、`DOM.getDocument`、`Runtime.evaluate`
  在刷新前后均超时，无法读取齿轮构建标识或确认当前安装版本。没有读取 Cookie、用户名单或原始
  页面文本，也没有点击微博举报、官方拉黑、关注或发帖控件。

**检查**

- 已通过：`node --check omniblock.user.js`、`node --check test/real-platform-probe.cjs`、
  `node --check test/weibo-replay.cjs`、`git diff --check`、`node test/weibo-replay.cjs`（4/4）、
  `node test/adapters.cjs`。
- 已通过：`node test/real-platform-probe.cjs weibo --verify-local --url=...`；输出 `errors:[]`，
  顶层 spacer 和楼中楼本地隐藏/撤销断言均通过。
- 已完成：通用 UI 13/13、状态 7/7、B 站快捷/弹幕 32/32、抖音推荐流 2/2、跨平台适配器 21/21、
  微博回放 4/4；`node test/maintenance-check.cjs` 的本地阶段全部通过，最终整体仅因其默认隔离
  抖音/微博入口遭遇 `ERR_NETWORK_ACCESS_DENIED` 而按规则记为 `blocked`。最终隐私门禁已运行且无
  具体页面标识命中；用户若授权，可再用 browser-harness 在本人当前登录页确认 v0.35.0 构建标识与实际补位。

**限制**

- 当前修复针对真实捕获的 `vue-recycle-scroller__item-wrapper`，只在列表明确提供可测的
  `min-height` 或 inline `height` 时接管尺寸；其他虚拟列表实现、canvas 或不接受 inline 尺寸的
  容器仍需新的 DOM 捕获。
- 隔离探针验证的是公开未登录页面；用户当前登录态可能有不同的回收窗口和已屏蔽名单，不能在未
  授权前替代复核。

**版本/发布状态**

- v0.35.0 已提交为本地提交 `8e00092`，尚未推送、创建 tag 或 GitHub Release；遵守本轮新
  AGENTS.md 的发布红线，等待登录态复核和用户明确发布决定。

**下一项最有价值的验证**

候选安装到用户 Chrome 后，先刷新同一微博标签页并确认齿轮上的
`0.35.0-weibo-virtual-spacer-douyin-manager`；如果页面再次卡住，先保留标签页并通知维护者，
不要把旧版本的卡顿归因到候选。构建标识确认后，再在用户明确回复“可登录验证”时只读观察一条
根评论和一条楼中楼的补位；整个过程不点击微博举报/官方拉黑等平台写入控件。

### 2026-08-24 - v0.34.0 候选 - 抖音管理器布局、搜索与尽量加载

**范围**

本轮只继续抖音视频页的评论/弹幕本地屏蔽管理器；微博补位问题仍按用户要求暂停，没有修改微博适配器。
评论入口、弹幕入口和设置齿轮现在共用右下固定列，从下到上为设置、弹幕、评论，避免评论入口遮挡播放器。

**改动文件**

- `omniblock.user.js`：版本提升到 v0.34.0；增加抖音评论管理器搜索、可靠作者记录跨虚拟行回收的保留、
  评论容器只读滚动尽量加载；增加抖音弹幕搜索和用户主动触发的播放器时间轴扫描，扫描后恢复原播放位置
  与播放状态。没有调用抖音私有接口或平台写入控件。
- `test/adapters.cjs`：人工合成抖音评论滚动懒加载和时间轴弹幕渲染，覆盖三按钮位置、评论搜索/尽量加载、
  弹幕搜索/扫描恢复及原有批量屏蔽。
- `test/real-douyin-probe.cjs`：登录态只读探针增加两个管理器的按钮位置、搜索控件和评论尽量加载控件检查；
  不点击抖音举报、官方拉黑、关注或发帖控件。
- `README.md`、`CHANGELOG.md`：同步右下布局、搜索、尽量加载行为和证据边界。

**证据**

- **`structure regression`**：本轮人工合成夹具覆盖抖音管理器布局、评论搜索与虚拟滚动、弹幕搜索与时间轴
  扫描/播放状态恢复；`node test/adapters.cjs` 21/21、`node test/run.cjs` 13/13、`node test/state.cjs`
  7/7、`node test/quickblock.cjs` 32/32、`node test/douyin.cjs` 2/2、`node test/weibo-replay.cjs` 3/3，
  且 userscript 与两个探针均通过 `node --check`。
- **`real-site verified`**：2026-08-23 用户已登录调试浏览器的临时只读标签页曾确认抖音真实弹幕悬停入口、
  单条屏蔽/撤销和评论 portal 的 `role="tooltip"` 结构；这项历史证据不外推为本轮新增搜索或尽量加载已验证。
- **`blocked`**：2026-08-24 默认隔离抖音页面实际停在「验证码中间页」，候选数 0；第一次维护自检还受到
  执行环境 `ERR_NETWORK_ACCESS_DENIED` 影响，受控网络重跑后确认仍是验证码阻断。微博隔离探针本轮虽能
  观察到 9 条评论和本地撤销补位，但维护自检总体仍因抖音阻断而返回 `RESULT: MAINTENANCE SELF-CHECK BLOCKED`。
  本轮未取得用户对登录态调试浏览器的显式验证授权，故不运行该登录态探针，也不把本地夹具通过写成真站验收。

**限制**

- 抖音没有可安全依赖的公开“导出全部评论/全部弹幕”页面接口。本轮的评论尽量加载通过只读滚动当前可识别
  的评论容器触发懒加载；弹幕尽量加载通过用户主动点击后按视频时长逐点 seek 触发网页渲染。平台虚拟回收、
  尚未渲染或未暴露可靠身份的数据仍不会被猜测，长视频扫描也可能需要较长时间。
- 评论管理器打开时会先展开明确回复入口，再自动尝试滚动；弹幕时间轴扫描不是自动动作，必须由用户点击按钮，
  且结束后不会改变原播放位置和播放/暂停状态。
- 微博空白/补位问题本轮没有修改或重新声称修复。

**检查**

- `node --check omniblock.user.js`、`node --check test/adapters.cjs`、`node --check test/real-douyin-probe.cjs`：通过。
- `node test/maintenance-check.cjs`：本地结构矩阵通过；隔离抖音因验证码阻断，最终为 `RESULT: MAINTENANCE SELF-CHECK BLOCKED`。
- `node test/real-platform-probe.cjs douyin --verify-local`：页面标题为「验证码中间页」、候选 0，按 `blocked` 记录。
- `git diff --check`：通过（仅报告工作区换行即将转换的警告）；隐私门禁在暂存前重跑。

**版本/发布状态**

- userscript `@version` 为 `0.34.0`，构建标识为 `0.34.0-douyin-manager-layout-search-loader`。
- 完整本地矩阵已完成；功能与测试改动已提交为 `05403b2` 并推送到 `master`。因新增抖音路径当前没有
  本轮 `real-site verified`，不创建 v0.34.0 tag/Release。

**下一项最有价值的验证**

用户若希望确认线上新增路径，应在同一轮显式授权使用本人专用调试浏览器完成只读验证；验证码由用户本人通过后，
保持当前页面和调试端口不变，再运行 `node test/real-douyin-probe.cjs`，只观察两个管理器的入口、搜索和加载控件。

### 2026-08-24 - v0.33.0 候选 - 抖音视频弹幕多选管理器

**范围**

暂停微博补位问题，不修改微博适配器。本轮把 B 站已有的“左下评论批量入口 + 右下弹幕管理器”能力
对齐到抖音视频页：左下继续使用已有的抖音评论管理器，右下新增当前视频弹幕发送者多选管理器。

**改动文件**

- `omniblock.user.js`：版本提升到 v0.33.0，新增抖音视频弹幕发送者收集、同身份去重、搜索/全选/
  批量本地屏蔽的右下入口与弹窗；切换视频时清空观察列表。未读取抖音私有接口，不触发平台写入。
- `test/adapters.cjs`：人工合成的抖音视频夹具加入重复发送者弹幕，覆盖右下入口计数、去重、全选、
  批量屏蔽与撤销；原有评论 portal 单条入口和评论管理器展开/批量仍在同一断言中。
- `test/real-douyin-probe.cjs`：登录态只读探针加入抖音弹幕管理器的打开、批量、内存名单撤销检查。
- `test/maintenance-check.cjs`：维护自检现在同时运行抖音和微博的隔离真实页探针，遇到验证码分别记录
  `blocked`，不再只检查微博。
- `README.md`、`CHANGELOG.md`：同步抖音两个管理器的用户行为、证据边界和 v0.33.0 候选状态。

**证据**

- `real-site verified`（2026-08-24，隔离未登录、自动发现的脱敏
  `bilibili.com/video/...` 页面，注入 v0.33.0 源码）：左下评论批量入口和右下弹幕管理器均可见；
  实际列出 27 个文案组、26 位发送者，完成单组/批量屏蔽与撤销，另完成 10 条悬浮弹幕的本地入口
  交互。只写入探针内存存储，没有触碰平台写入控件。
- `structure regression`：抖音评论 portal、评论管理器和视频弹幕管理器回归已通过；当前结果为
  `node test/adapters.cjs` 21/21、`node test/run.cjs` 13/13、`node test/quickblock.cjs` 32/32、
  `node test/douyin.cjs` 2/2。
- `blocked`：2026-08-24 抖音隔离探针停在“验证码中间页”，候选数为 0；登录态只读探针连接
  `127.0.0.1:9222` 被拒绝。因此 v0.33.0 的两个抖音新管理器没有本轮真站结果，不能把夹具通过
  当作线上验收。

**限制**

- 抖音弹幕管理器只显示当前视频页面已经出现且带可靠 `data-danmaku-user-id` 的发送者；未加载、
  没有身份属性或尚未出现的弹幕不会被猜测为可屏蔽对象。
- 右下入口和左下评论管理器受“批量拉黑入口”设置控制；切换视频会丢弃上一视频的观察列表，但
  已经写入本地名单的身份不会丢失。
- 微博问题按用户要求暂停；本轮没有修改微博算法，也没有把微博结果写成已修复。

**版本/发布状态**

- userscript `@version` 为 `0.33.0`，构建标识为 `0.33.0-douyin-danmaku-manager`。
- 本轮验证后提交并推送源码；因抖音新入口仍为 `blocked`，不创建 v0.33.0 tag/Release。

**下一项最有价值的验证**

在用户本人已登录的专用调试浏览器中打开抖音视频并完成验证码后，保持同一调试端口运行
`node test/real-douyin-probe.cjs`；只读确认右下弹幕管理器和左下评论管理器，不点击抖音举报、官方
拉黑、关注或发帖控件。

### 2026-08-24 - v0.32.0 候选 - 微博虚拟行连续性修复

**范围**

针对当前用户 Chrome 精确微博页仍然空白的失败复现继续追查。v0.31.0 已经安装并显示
`0.31.0-weibo-virtual-row`，但当前页面的顶层评论位于虚拟回收行中：被屏蔽行之后的活动行
使用约 `-20000px` 的 `transform`，且位置在只读时间线中保持不变。上一版只按绝对值上限识别
约百万像素异常，漏掉了这个接近阈值的真实形状。

**改动文件**

- `omniblock.user.js`：版本提升到 v0.32.0，构建标识改为 `0.32.0-weibo-continuity`；
  以相邻活动行的连续性识别异常基线，同时保留科学计数法和长列表绝对位置处理。
- `test/weibo-replay.cjs`：顶层夹具加入真实捕获的 `data-index` 跳号和近 `-20000px` 初始/回写，
  并交替覆盖科学计数法回写；已推送的 v0.31.0 在该夹具上可失败。
- `README.md`、`CHANGELOG.md`：同步当前真实失败证据、修复边界和 v0.32.0 候选状态。

**证据**

- `real-site verified`（2026-08-24，当前用户 Chrome，登录状态未读取，脱敏页面
  `weibo.com/...`）：齿轮显示 v0.31.0 构建；当前只读 DOM 有 17 个虚拟行，被屏蔽行处于
  `translateY(164px)` 且内容高度为 0，后续活动行从约 `-20019px` 起排列，250ms 间隔连续观察
  未发生回到正常位置的跳变。评论区空白的用户报告已在旧运行代码上复现。
- `structure regression`：工作区 v0.32.0 运行 `node test/weibo-replay.cjs` 的 3 项断言通过；
  已推送 v0.31.0（`--git-ref=f5a692d`）在同一近阈值顶层夹具上失败，后续活动行仍为约
  `-20019px`。
- `blocked`：当前用户 Chrome 仍是 v0.31.0，无法在不先让用户脚本自替换的前提下把 v0.32.0
  注入该精确登录态页面；本轮不声称线上修复后结果，也不把隔离回放当作精确页面验收。

**检查**

- `node --check omniblock.user.js`、`node --check test/weibo-replay.cjs`：通过。
- `node test/weibo-replay.cjs`：v0.32.0，3/3 通过。
- `node test/weibo-replay.cjs --git-ref=f5a692d`：按预期失败 1 项，证明回归能抓住已推送 v0.31.0 的缺陷。

**版本/发布状态**

- 工作区 userscript 已提升到 `@version 0.32.0`，构建标识为 `0.32.0-weibo-continuity`。
- 已完成本地聚焦复现后再跑完整矩阵；精确登录态页面仍待用户更新后只读核对构建标识，因此本轮
  只提交并推送源码，不创建 v0.32.0 tag/Release。

**下一项最有价值的验证**

在同一 Chrome 会话安装并刷新到 `0.32.0-weibo-continuity` 后，只读核对齿轮构建标识；随后在该
微博详情页屏蔽一条评论，确认其后评论保持连续可见，并滚动触发虚拟行回收。若出现验证码或页面
再次卡顿，保留当前标签页并通知我，不切换浏览器。

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
| B 站 `bilibili.com/video/...` | 2026-08-20，隔离未登录浏览器 | 解析到 2 位评论作者；左下角可见 `拉黑本页评论用户(2)`；评论菜单顺序为 `复制评论链接 → 加入黑名单 → 本地拉黑 → 举报`；本地拉黑确认框含作者名；`seg.so` 为 `responseType=arraybuffer` 的 XHR。 |
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
| B 站 | 2026-08-20，隔离未登录浏览器 | `bilibili.com/video/...`：v0.11.0 解析 2 位评论作者；`拉黑本页评论用户(2)` 可见；当前 `bili-comment-menu` 顺序为 `复制评论链接 → 加入黑名单 → 本地拉黑 → 举报`；确认框含具体用户名；捕获 `seg.so` 的 `XMLHttpRequest(responseType=arraybuffer)`。 |
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
| B 站 | 2026-08-20，隔离未登录浏览器 | `bilibili.com/video/...`：严格探针再次解析 2 位评论作者；`拉黑本页评论用户(2)` 可见；当前菜单身份、确认框和 `seg.so` 的 `XMLHttpRequest(responseType=arraybuffer)` 均通过。 |
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
  `bilibili.com/video/...`：v0.11.1 解析到 2 位评论作者；本地拉黑
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
  `bilibili.com/video/...`：生产页返回 2 个
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

- 2026-08-21 后续访问另一个 `bilibili.com/video/...` 详情页时，两个回复容器
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

### 2026-08-21 - v0.12.1 - B站弹幕入口常驻与 PAKKU 兼容

**范围与改动文件**

- `omniblock.user.js`：B站视频页在尚未取得弹幕数据时也显示「弹幕屏蔽(0)」，管理面板
  提供读取中、空数据、失败状态和「重新读取」。脚本从播放器公开状态、已观察到的
  `seg.so` URL 或公开视频元数据解析当前 `cid`，主动只读获取首段；SPA 换视频/分 P 时
  清空索引并丢弃过期异步结果，重复段按发送者、进度和内容去重。
- `omniblock.user.js`：兼容 PAKKU 公开的 `pakku_open` / `pakku_send` /
  `pakku_load_callback` 契约；PAKKU 伪造的 ArrayBuffer 在交给播放器回调前先应用本地
  `mid_hash` 黑名单。身份仍保存为规范的 `bili:dmhash:<hash>`，没有新增身份前缀。
- `test/quickblock.cjs`：新增零数据常驻入口，以及 PAKKU 先于/后于 OmniBlock 注入的人工
  合成回归。夹具依据 `xmcp/pakku.js` 提交
  `2cb6f52aba70d6b685aaff9a1c03aabec7f299b2` 的 `pakkujs/content_script/xhr_hook.ts`，
  不标作真实扩展验证。
- `README.md`：同步入口、主动读取、重试、PAKKU 兼容行为和证据边界。userscript 版本提高
  为 `0.12.1`。

**问题复现与 `structure regression`**

- 修复前在聚焦夹具中让 PAKKU 等价包装器截走首个 `seg.so` XHR：v0.12.0 原有 15 项
  通过，但新增断言单独失败；`#ob-dm-tool` 存在却为 `display:none`，文本为空且发送者为 0。
- 修复后 `node test/quickblock.cjs` 为 19/19：零数据时入口、全屏蔽空状态与重试边界正确；PAKKU
  后注入时主动读取 3 位发送者并过滤其伪造响应；PAKKU 先注入时同样先过滤黑名单，
  单条、勾选批量、撤销、XHR 过滤和响应式布局继续通过。
- PAKKU 的公开源码确认它在 `document_start` 的 MAIN world 同时改写 XHR 与 fetch，
  并自行请求 `seg.so`；因此用户报告与其请求接管机制一致，但源码审阅本身不等于用户
  浏览器中的真实共存验证。

**`real-site verified`**

- 2026-08-21，隔离未登录浏览器，
  `bilibili.com/video/...`：v0.12.1 页面资源中同时观察到主动
  `fetch` 的 `/x/v2/dm/web/seg.so` 和播放器 `XMLHttpRequest(arraybuffer)` 的
  `/x/v2/dm/wbi/web/seg.so`；工具去重列出 7 位发送者。单条屏蔽、两人勾选批量、人物
  独立存储和两次撤销均成功，未触发 B站官方拉黑或其他站内写操作。
- 同轮严格探针继续识别 2 条根评论、4 条楼中楼和 6 位已加载评论作者；根评论本地拉黑
  后完整线程高度从 417px 变为 0、无恢复条、下一线程补位 417px，撤销后恢复。

**检查、限制与发布**

- `node --check omniblock.user.js`、`node --check test/quickblock.cjs`、`git diff --check`：通过。
- `node test/run.cjs`：11/11；`node test/state.cjs`：6/6；
  `node test/quickblock.cjs`：19/19；`node test/adapters.cjs`：14/14，均通过。
- `node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool`：通过，结果如上。
- `blocked`：隔离真实站点探针没有安装 PAKKU 扩展，因此不能把真实扩展共存写成
  `real-site verified`；目前证据为 PAKKU 当前公开源码对应的双顺序 `structure regression`。
- 当前限制：主动兜底先读取当前视频首段，后续段仍随播放器请求累积；已经进入播放器缓存
  的移动弹幕无法追溯移除，更新后需刷新页面。关闭设置中的「本地拉黑入口」仍会按设计
  隐藏弹幕工具。
- 版本/发布：源码为 `0.12.1`；本条与功能提交按仓库默认流程推送到 `origin/master`，
  GitHub raw `master` 更新 URL 随后提供 v0.12.1。既有 `.workbuddy` 与三张测试截图不纳入提交。
- 下一项最有价值的验证：用户在已安装 PAKKU 的原报告视频刷新后，确认右下角立即出现
  「弹幕屏蔽(N)」，并观察屏蔽一位发送者后其后续移动弹幕不再出现。

### 2026-08-21 - v0.13.0 - 弹幕文案组、微博评论入口与 GitHub Release

**范围与改动文件**

- `omniblock.user.js`：B站弹幕管理器按规范化文案聚合，单组和勾选批量均展开、去重组内
  全部 `mid_hash` 后逐人保存；设置名单明确展示弹幕 hash、持续过滤作用及昵称/UID 不可用
  的限制，不从不可逆 hash 反向猜测 UID。原生弹幕列表行预留右侧按钮空间。userscript
  版本提高为 `0.13.0`。
- `omniblock.user.js`：微博当前详情页捕获的 `.wbpro-list > .item1` 根评论增加常驻本地
  拉黑入口；批量统计同时收集发帖人、根评论和已展开回复作者。评论作者严格来自自身作者
  槽，集合、提及用户和外层发帖人不能冒充该评论作者。
- `test/quickblock.cjs`、`test/adapters.cjs`：新增重复弹幕两 hash、组选中展开、名单身份说明、
  原生列表布局，以及微博详情评论单条/批量人工夹具。微博 `item1` 基于当日真实捕获，
  `item2` 来自仓库内固定提交的 Pynseq-Weibo 参考结构，后者不标作真实站点验证。
- `test/real-bilibili-probe.cjs`、`test/real-platform-probe.cjs`：真实探针按文案组内全部 hash
  验证；微博探针支持安全 `--url=` 和隔离内存中的单条评论拉黑/撤销。
- `README.md`、`AGENTS.md`、`MAINTENANCE.md`、`CHANGELOG.md`：同步用户行为、逐平台验证
  规则，以及默认 tag + GitHub Release 发布流程。

**问题复现**

- 修复前原有基线为 `node test/quickblock.cjs` 19/19、`node test/adapters.cjs` 14/14。
  加入用户报告对应断言后，旧实现的 B站结果为 15 通过/5 失败：相同文案仍显示 6 条发送者
  行而非 5 个文案组，单击只保存一个 hash，选中重复文案得到 3 行而非 2 组，名单没有
  hash 作用说明，原生列表行没有操作区属性。微博结果为 14 通过/1 失败：当前
  `item1/item2` 均未被完整选中，详情页只收集发帖人，评论常驻入口为 0。
- 安全边界复核时先只更新断言，当前实现由 20/20 变为 19/20：一个弹幕 hash 因 CRC32
  与已加载评论 UID 相同而被错误合并为该评论作者；移除反向身份推测后恢复 20/20。

**`real-site verified`**

- 2026-08-21，隔离未登录浏览器，
  `bilibili.com/video/...`：v0.13.0 一轮真实首段产生 6 个文案组、
  7 位发送者，其中首组包含 2 个 hash。单击该组后两人均命中名单并可一次撤销；勾选前
  两组后展开为 3 位发送者，三个人物独立存储并可整体撤销。另一轮为 7 组/7 人，也完成
  单组和两组事务。两轮均未触发平台官方拉黑或其他站内写操作。
- 2026-08-21，隔离未登录浏览器，
  一个公开 `weibo.com/...` 详情页：v0.13.0 识别 6/6 条已加载根评论并插入 6 个
  常驻入口；批量入口显示已加载微博/评论作者 7 人。隔离内存中拉黑一条根评论后，该行
  无占位隐藏、微博正文保持可见，撤销后评论恢复；没有触发关注、举报或官方拉黑。
- 2026-08-21 发布前最终复核同一 B站 URL：严格探针识别 2 条根评论、4 条楼中楼、6 位
  评论作者和 7 组/7 位弹幕发送者；评论零占位隐藏、弹幕单组及两组批量屏蔽均命中，且
  撤销恢复。该轮 `node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool`
  无错误退出。

**`structure regression`**

- `node test/run.cjs`：11/11；`node test/state.cjs`：6/6；
  `node test/douyin.cjs`：2/2。
- `node test/quickblock.cjs`：20/20，覆盖重复文案单组两人、选中两组展开为三人、逐人事务、
  不反向猜测 UID 的 hash 身份边界、名单说明、原生列表布局和 PAKKU 双注入顺序。
- `node test/adapters.cjs`：15/15，新增微博根评论/楼中楼作者隔离、常驻入口、三人批量计数、
  单条零占位隐藏和正文保留。
- `node --check` 对 userscript 和四个受影响测试脚本均通过；`git diff --check` 通过。

**`blocked`**

- 同一严格命令早前两次都完成弹幕组事务，但评论区只保留 `BILI-COMMENTS-SPINNER`，
  没有下发评论组件，因此当时按 `blocked` 记录；发布前最终复核已完整成功。这里保留
  早前失败事实，用于说明生产评论数据仍可能间歇不可用。
- B站生产页原生弹幕面板仍为 0 条可安全识别发送者行，因此行内按钮防重叠只有
  `structure regression`。隔离会话未安装真实 PAKKU，真实扩展共存同样未确认。
- 微博真实详情页没有展开的 `.item2` 楼中楼；该路径目前只有仓库内参考结构回归。

**限制与发布**

- B站 `mid_hash` 本身不含可靠用户名或 UID，CRC32 相同也不足以证明反向身份，因此名单
  只保留 hash 并明确说明限制；同一 hash 的后续弹幕仍会被过滤。已进入播放器缓存的弹幕
  仍需下一数据段或刷新后完全消失。
- 版本/发布状态：源码为 `0.13.0`；功能提交
  `f6b3853b032bc9399cc2a2bf111bcf6f5f557cdf` 已推送到 `origin/master`；注释标签
  `v0.13.0` 指向该提交并已推送；GitHub Release 已发布：
  `https://github.com/a2787/ub-utils/releases/tag/v0.13.0`。raw `master` 更新 URL 继续提供
  v0.13.0。既有 `.workbuddy` 和三张 `test/shot-*.png` 脏改动未纳入发布。
- 下一项最有价值的验证：在用户已安装 PAKKU 的原报告视频中，选择一个真实重复文案组，
  确认一次操作拉黑其全部发送者，并在刷新后观察这些 hash 的后续移动弹幕均不再出现。

### 2026-08-21 - v0.14.0 - B站弹幕 UID 候选与 GPLv3

**范围与改动文件**

- `omniblock.user.js`：弹幕文案组新增 `UID?` 候选查询。按 PAKKU 的 GPLv3 CRC32 反查
  算法搜索 1–10 位数字 UID，再通过不携带登录 Cookie 的 B站用户卡片请求剔除不存在账号；
  所有结果均标作「可能发送者」，不会自动写入 UID。用户打开候选主页核对并确认后，
  `bili:dmhash:<hash>` 与 `bili:uid:<uid>` 才合并到同一人物，后续同时覆盖弹幕和评论。
- `test/quickblock.cjs`、`test/run.cjs`、`test/real-bilibili-probe.cjs`：新增候选计算、碰撞
  多候选逐一校验、查询不改名单、人工关联及撤销、联网权限和真实页面匿名请求断言。
- `README.md`、`CHANGELOG.md`：同步用户可见流程、隐私边界、CRC32 限制和版本说明。
- `LICENSE`、`THIRD_PARTY_NOTICES.md`：项目从本版本起改用 `GPL-3.0-only`，记录 PAKKU
  固定源码提交与改写范围，并保留 Pynseq-Weibo、Pynseq-Douyin 的完整 MIT 声明。

**问题复现与方案边界**

- 修复前原有 `node test/quickblock.cjs` 20 项均通过；加入用户报告对应的 `QB-U` 后，旧版
  因没有 UID 查询入口而单独失败。v0.13.0 只能保存 `mid_hash`，因此只屏蔽同一 hash 的
  后续弹幕，不能据此隐藏该发送者以 UID 标识的评论。
- 当前普通弹幕协议的 `mid_hash` 是 `CRC32(String(uid))`，计算中没有视频 `cid` 或随机盐，
  因而在协议不变时同一 UID 跨视频得到同一 hash；这不代表反向关系唯一。CRC32 只有
  32 位，可能有多个数字 UID 碰撞，所以账号存在性校验也不能把候选证明为真实发送者。
- 查询、只按 hash 拉黑或未确认候选都不会创建 `bili:uid`。只有用户人工确认后才建立
  UID/hash 关联；该决定避免把不可逆身份伪装成已知 UID，也避免误伤碰撞账号的评论。

**`real-site verified`**

- 2026-08-21，隔离未登录浏览器，
  `bilibili.com/video/...`：真实首段列出 7 组弹幕和 7 位 hash 发送者；
  首个尝试的真实 hash 得到数字候选，3 次匿名用户卡片请求筛得 1 个仍存在账号，页面明确
  显示「可能发送者」。在隔离内存名单中确认后 UID/hash 同时命中，撤销后同时恢复。
- 同一轮继续识别 2 条根评论、4 条楼中楼和 6 位评论作者；弹幕单组、两组批量，以及评论
  无占位隐藏与撤销均通过。探针没有触发 B站官方拉黑、举报或其他站内写操作。

**`structure regression`**

- `node test/run.cjs`：11/11；`node test/state.cjs`：6/6；
  `node test/quickblock.cjs`：22/22；`node test/adapters.cjs`：15/15；
  `node test/douyin.cjs`：2/2，均通过。
- `node --check omniblock.user.js`、`node --check test/quickblock.cjs`、
  `node --check test/real-bilibili-probe.cjs`、`node --check test/run.cjs` 和
  `git diff --check`：均通过。
- `QB-U/QB-V` 覆盖单候选人工确认、CRC32 多候选逐个账号校验、无效账号剔除、查询不写
  UID、UID/hash 同人物存储、名单昵称/UID/hash 展示和整体撤销。PAKKU 算法夹具基于
  `xmcp/pakku.js` 提交 `2cb6f52aba70d6b685aaff9a1c03aabec7f299b2`，不标作真实扩展验证。

**`blocked`、限制与发布**

- 发布前一轮 `node test/real-bilibili-probe.cjs --verify-local --verify-danmaku-tool`
  中，弹幕工具单条/批量事务通过，但评论区只返回 `BILI-COMMENTS-SPINNER` 且没有评论
  组件，因此该轮评论验证按 `blocked` 记录；随后完整重试成功。这说明 B站评论数据仍
  可能间歇不下发。
- 反查只搜索 1–10 位数字 UID；超过 10 位的账号无法找到。CRC32 碰撞无法自动消除，账号
  主页与昵称也不足以由程序证明弹幕归属，所以本功能只能提供候选并要求人工确认。
- 隔离真实站点探针没有安装 PAKKU，真实扩展共存仍为 `blocked`；现有证据是 PAKKU 公开
  XHR 契约的双注入顺序 `structure regression`。B站未来若改变 `mid_hash` 协议，跨视频
  稳定性与反查均需重新验证。
- 用户卡片请求仅在主动点击 `UID?` 后发出，使用 `GM_xmlhttpRequest` 的匿名模式，不发送
  本地名单或原始浏览数据；B站仍能看到正常网络请求的 IP 和被查询 UID。
- 版本/发布状态：userscript 为 `0.14.0`，许可证为 `GPL-3.0-only`；此前已经发布的版本
  仍保留其发布时的 MIT 许可。功能提交
  `de751c8c766277534640735582f7cc73a1719c94` 已推送到 `origin/master`；注释标签
  `v0.14.0` 指向该提交并已推送；GitHub Release 已发布：
  `https://github.com/a2787/ub-utils/releases/tag/v0.14.0`。raw `master` 更新 URL 继续提供
  v0.14.0。既有 `.workbuddy` 与三张 `test/shot-*.png` 脏改动不纳入发布。
- 下一项最有价值的验证：用户在已安装 PAKKU 的浏览器中，对熟悉的弹幕发送者查询候选，
  人工核对主页后确认，并验证其后续弹幕与同 UID 评论在刷新后都完全消失。

### 2026-08-22 - v0.15.0 - 悬停弹幕举报入口、微博楼中楼与公开隐私门禁

**范围**

B站播放器悬停弹幕的原生举报菜单入口；微博旧版/懒加载楼中楼入口、被隐藏行包装层
收起、根评论标签解析、用户列表弹窗单人批量；公开产物中的页面标识清理。

**改动文件**

- `omniblock.user.js`：
  - 新增 `bilibiliFloatingDanmakuRow` / `bilibiliFloatingDanmakuIdentity` 与 `floatingDanmaku`
    记忆体。`pointerover/mouseenter/mousedown` 只在命中“可读出文案的浮动弹幕行”时更新
    身份：唯一则记住 5 秒，歧义或无法解析立即 `forget()`；指针移到原生菜单等非弹幕节点时
    保留上一次身份，避免菜单打开瞬间身份丢失。`tryInject` 遇到 B站「举报」锚点时，只在
    存在新鲜唯一身份时注入 `🚫 B站弹幕发送者`。
  - `resolveFloatingDanmakuHashes`（弹幕模块内）改为按显示粒度 ±1 秒聚合候选，取代原来的
    毫秒精确匹配。旧行为会把同一秒内同文案的不同发送者判为唯一身份。
  - 微博：评论选择器新增 `[node-type="reply_list"]`、`.list_ul`、`.WB_reply` 下的 `.item2`；
    `commentActionMount` 为这些行提供行内操作槽兜底；评论作者解析改为 `COMMENT_AUTHOR_GROUPS`
    按优先级逐组判定（先带昵称的作者链接，再头像链接兜底），修复根评论标签为空。
  - `collapseBlockedWrappers` + `.ob-blocked-wrapper`：被隐藏行“只包含该行、无自身文本”的
    祖先包装层同时收掉高度与内外边距，`unmark` 时逐层还原。
  - 弹窗批量：`users.length < 2` 改为 `!users.length`（单人也可批量）；隐藏后复用的弹窗先
    移除上一次控件（`btn` 可能已被前端重绘删除，故加空值保护）。
  - `@version` 0.14.0 → 0.15.0。
- `test/quickblock.cjs`：新增 QB-X（唯一 hash 注入、拉黑、撤销）与 QB-Y（同秒同文案歧义
  不注入，并断言解析器在 -1 与 12000ms 两种输入下都返回 2 个候选）。
- `test/adapters.cjs`：微博夹具补充旧版 `node-type="reply_list"` 行与点赞弹窗；断言 3 个行内
  入口、批量计数 4、包装层收起、单人弹窗批量在撤销前判定成功且撤销后恢复。
- `test/real-bilibili-probe.cjs`：删除内置默认 BV URL，缺少 `--url=` 时 `exit 2`。
- `AGENTS.md`：新增公开产物页面标识禁令与「公开隐私门禁」检查命令。
- `README.md`、`CHANGELOG.md`：同步新入口、微博行为、测试计数与证据边界。

**证据**

- `structure regression`：`node test/quickblock.cjs` 24/24；`node test/adapters.cjs` 16/16；
  `node test/run.cjs` 11/11；`node test/state.cjs` 6/6；`node test/douyin.cjs` 2/2；
  `node --check omniblock.user.js` 与 `git diff --check` 通过。
- `blocked`：本轮未获得可用于只读探针的真实 B站/微博页面 URL（探针已按新规则要求显式
  `--url=`），因此悬停弹幕举报入口、微博旧版楼中楼入口、包装层收起和弹窗单人批量都
  没有在生产站点观察过。不得据本轮结果声称这些能力 `real-site verified`。
- 旧断言可失败性：QB-Y 在修复前确实失败（菜单里注入了上一条弹幕的 `bili:dmhash`）；
  微博标签断言在修复前因 `labels[0]` 为空而失败。两项均已在修复后转绿。

**限制**

- 悬停入口依赖“文案 + 显示秒”唯一匹配。同一秒内多人发送相同文案时不提供入口，只能用
  右下角工具按文案分组批量处理；这是刻意的身份纪律，不是缺陷。
- 悬停身份有 5 秒有效期。若原生菜单打开较慢或中途指向了另一条弹幕，需要重新悬停。
- 微博楼中楼入口的操作槽兜底（`.con > .info`、`.info` 等）来自本地参考结构，真实旧版
  前端可能仍有变体；点赞弹窗的用户锚点集合同理。
- `collapseBlockedWrappers` 只在包装层没有其他有意义子元素和自身文本时生效，因此某些把
  评论与操作栏混在同一层的前端变体仍可能残留少量间距。

**版本/发布状态**

- userscript `@version` 为 `0.15.0`，许可证仍为 `GPL-3.0-only`。
- 功能提交 `996ef9a21d5c92457f91ba51d739edf3ad5c43d5` 已推送到 `origin/master`；注释标签
  `v0.15.0` 指向该提交并已推送；GitHub Release：
  `https://github.com/a2787/ub-utils/releases/tag/v0.15.0`。
- raw `master` 更新 URL 现提供 v0.15.0。既有 `.workbuddy/memory/2026-08-20.md` 与三张
  `test/shot-*.png` 脏改动按规则未纳入发布。

**下一项最有价值的验证**

用户在真实 B站视频页悬停一条只出现一次的弹幕并打开原生举报菜单，确认菜单内出现
「🚫 B站弹幕发送者」且拉黑后该发送者后续弹幕消失；随后在一条真实微博详情页展开楼中楼，
确认每条回复都有「本地拉黑」，屏蔽后不留空白。

### 2026-08-22 - v0.16.0 - 真站验证纠正浮动弹幕与微博楼中楼实现

**范围**

按用户要求把真实站点验证改为每轮默认动作，并用真站证据推翻/修正 v0.15.0 的两处实现：
B站播放器浮动弹幕入口、微博楼中楼行内入口。

**被真站推翻的旧实现（重要）**

- v0.15.0 依赖 `.bpx-player-dm-multiple .dm-info-row`、`[data-dmid]` 等选择器，并假设
  悬停弹幕会触发 B站原生弹幕「举报」菜单，再向菜单注入一项。2026-08-22 真站捕获显示：
  当前浮动弹幕是 `.bpx-player-row-dm-wrap > .bili-danmaku-x-dm-rotate > .bili-danmaku-x-dm`，
  上述旧选择器在线上页面全部为 0 个；弹幕层与旋转层的 CSS 均写死 `pointer-events: none`，
  因此弹幕永远不进入 `:hover`，`elementFromPoint` 返回的是 `video-container-v1`。逐条悬停
  12 条弹幕、真实点击暂停后重试，`.bpx-player-dm-tip` 始终不可见（未登录会话）。
  旧选择器已删除，不保留为“兜底”。
- v0.15.0 假设楼中楼是 `.item2 > .item2in > .con2 > .info > .opt`。真站结构是
  `.item2 > .con2 > .info > .opt`，没有 `.item2in`，因此大部分回复行拿不到挂载点
  （真站上一次只有 3/6 行有入口）。

**改动文件**

- `omniblock.user.js`（`@version` 0.15.0 → 0.16.0）：
  - 新增 `#ob-dm-pick` 浮层与 `setupFloatingDmPick()`：在播放器容器上监听
    `pointermove`/`mousemove`，用 `floatingDmAtPoint()` 对 `.bili-danmaku-x-dm` 做矩形命中
    （重叠时取面积最小者），`floatingDmIdentityFor()` 用文案 + 当前播放进度（±1s，必要时
    回退到整条文案）收敛唯一 `mid_hash`，仅当唯一且该 hash 在 `dmSenders` 中时显示浮层。
    命中后同时 `floatingDanmaku.remember(info)`，让登录用户可见的原生「举报」菜单复用同一身份。
    指针离开弹幕保留 900ms，便于移到浮层上点击。
  - 删除基于旧选择器的 `bilibiliFloatingDanmakuRow/Identity` 与全局 pointer 监听。
  - 微博 `commentActionMount` 改为按候选序列逐个尝试（新增 `.con2 > .info > .opt`、
    `.con1 > .info > .opt` 等），不再按行类型只认单一路径。
  - 新增 `window.__omniblockFloatingDmProbe(x, y)` 供回归断言坐标命中契约。
- `test/discover.cjs`（新增）：真实探针目标发现器，从 `bilibili.com` / `weibo.com` 公开入口
  取候选并提供 `redactTarget()` 脱敏形式。仓库因此不再需要保存任何具体验证页标识。
- `test/real-bilibili-probe.cjs`：目标改为自动发现（仍支持 `--url=`）；新增
  `--verify-floating-danmaku`，会先预检挑出真的会渲染弹幕的视频，再滚回播放器、按视口交集
  坐标悬停，断言 `pointer-events:none`、浮层出现、写入 `bili:dmhash:` 与撤销。报告输出
  脱敏 `target`，具体 URL 只留在本地 `localTarget`。
- `test/real-platform-probe.cjs`：微博目标自动发现并预检「展开后确有可识别楼中楼」的详情页；
  新增根/回复行分别统计、展开行守卫，以及“选择与根评论作者不同的回复”后断言根评论仍可见
  且高度只减少。
- `test/quickblock.cjs`：QB-X/QB-Y 重写为真实结构夹具（`.bili-danmaku-x-dm` +
  `pointer-events:none`），用真实鼠标移动触发坐标命中；QB-X 额外断言原生菜单复用同一 hash，
  QB-Y 断言歧义时不出浮层且 `__omniblockFloatingDmProbe` 返回空身份。
- `test/adapters.cjs`：微博夹具改为真站层级（楼中楼无 `.item2in`），并新增「共 N 条回复」
  展开行不获得入口的断言。
- `AGENTS.md`：新增「真实站点验证是默认动作」小节——改动平台适配必须同轮跑真站探针，
  探针自动发现目标，发现失败才记 `blocked`；新选择器必须先经真站捕获确认，被真站证伪的
  旧选择器必须删除而不是留作兜底；最低验证矩阵中的真站探针由“生产可访问时”改为必跑。
- `README.md`、`CHANGELOG.md`：同步用户可见行为、验证表与命令。

**证据**

- `real-site verified`（2026-08-22，隔离未登录会话，目标由探针自动发现）：
  - B站 `bilibili.com/video/...`：`rendered=10`、`pointerEventsNone=true`、`candidates=10`、
    悬停第 2 条即 `pickShown=true`；确认框显示 `bili:dmhash:` 键，拉黑写入并撤销恢复。
    同轮 `commentRendererCount=2`、`commentUserCount=3`、`拉黑已加载评论作者(3)`、
    线程 249px → 0 且 `barCount=0`、撤销恢复；弹幕工具 `groupCount=100`、`senderCount=102`，
    单组与两组批量均 `blocked`/`restored` 通过，`batchSeparate=true`。
  - 微博 `weibo.com/...`：展开楼中楼后 `identifiedRootCount=19`/`rootButtonCount=19`、
    `identifiedReplyCount=6`/`replyButtonCount=6`、`expandRowsWithButton=0`；拉黑一条
    `sameAuthorAsRoot=false` 的楼中楼后该行隐藏、根评论 162px → 110px 且保持可见、
    正文可见，撤销恢复。探针只移动鼠标、滚动、暂停播放和点击脚本自身 UI。
- `structure regression`：`node test/run.cjs` 11/11、`node test/state.cjs` 6/6、
  `node test/quickblock.cjs` 24/24、`node test/adapters.cjs` 16/16、`node test/douyin.cjs` 2/2；
  `node --check` 覆盖 userscript 与全部测试/探针文件，`git diff --check` 通过。
- 旧断言可失败性：QB-X 在改回旧实现（依赖原生菜单注入）时失败；微博 adapters 夹具改为真站
  层级后，旧 `commentActionMount` 拿不到 `.con2 > .info > .opt`，行内入口数从 3 掉到 2。
- `blocked`：知乎重定向到 `zhihu.com/signin`；贴吧落在「百度安全验证」滑块页（因此贴吧
  由此前的 `real-site verified` 降级为本轮 `blocked` + 既有 `structure regression`）；
  X 未登录只有登录页；抖音首页无可解析条目。未登录会话既看不到微博点赞/转发用户列表弹窗，
  也不会弹出 B站自带弹幕操作条，这两条路径仍只有夹具证据。

**限制**

- 坐标命中依赖弹幕节点的布局矩形。B站若把浮动弹幕改成 canvas 渲染，这条入口会整体失效，
  需要重新捕获结构。
- 唯一性判定仍是「文案（+ 播放进度 ±1s）」。同文案多发送者时刻意不提供单条入口，
  只能用右下角工具按文案分组批量处理。
- 弹幕矩形随播放滚动，指针停在原地也可能因弹幕移开而失效；浮层保留 900ms 后自动消失。
- 真站探针为无头会话，与真实浏览器（尤其安装了 PAKKU 时）仍可能有差异。

**版本/发布状态**

- userscript `@version` 为 `0.16.0`，许可证仍为 `GPL-3.0-only`。
- 功能提交 `e9630d45a29cbaa2d9d61f1047740d4d64a7e21a` 已推送到 `origin/master`；注释标签
  `v0.16.0` 指向该提交并已推送；GitHub Release：
  `https://github.com/a2787/ub-utils/releases/tag/v0.16.0`。
- 既有 `.workbuddy/memory/2026-08-20.md` 与三张 `test/shot-*.png` 脏改动按规则未纳入发布。

**下一项最有价值的验证**

用户在自己已登录、装有 PAKKU 的浏览器里，把鼠标移到一条弹幕上确认浮层出现并拉黑，
刷新后确认该发送者弹幕不再出现；再打开一条微博详情页的点赞用户列表，确认弹窗批量入口
可用（该路径目前仍只有夹具证据）。

### 2026-08-22 - v0.16.0 发布收尾 - 探针证据纪律修复

**范围**

完成 v0.16.0 的推送、tag 与 Release，并在发布前复跑全矩阵。复跑暴露两个探针缺陷（都在
探针侧，不影响已发布的 userscript 行为），一并修掉。

**改动文件**

- `test/real-bilibili-probe.cjs`：批量入口快照此前最多等 8 轮 × 750ms，且不记录当时的
  已识别作者数。B站评论按需加载较慢时，快照会落在「作者数为 0」的中间态，而脚本在
  `n === 0` 时按设计隐藏 FAB，于是探针把正常行为报成
  `验证失败：已加载评论作者批量入口未出现`（2026-08-22 首轮复跑即命中）。现在快照等到
  16 轮、作者数为 0 时主动把评论区滚回视口，并输出 `userCount` 便于定位。
- `test/real-platform-probe.cjs`：知乎/贴吧/X/抖音即使停在登录页或安全验证页也返回空
  `errors`，等于把「无法验证」静默记成通过——违反本文件的证据规则。现在按脚本就绪、
  适配器匹配、页面加载、登录/验证拦截、条目数、身份数逐级判定，落不到证据时显式写
  `blocked：…`；有条目但零身份仍算验证失败。

**证据**

- `real-site verified`（2026-08-22，隔离未登录会话，目标由 `test/discover.cjs` 自动发现）：
  - B站 `bilibili.com/video/...`：`bulkBeforeInteraction` 为
    `🚫 拉黑已加载评论作者(3)`、`visible=true`、`userCount=3`；浮动弹幕 `rendered=19`、
    `pointerEventsNone=true`、坐标命中 1 次即 `pickShown=true`、写入 `bili:dmhash:` 后撤销
    恢复；评论零占位隐藏（`barCount=0`）并恢复；弹幕工具 `groupCount=100`、
    `senderCount=99`，单组与批量事务均通过；`errors` 为空。
  - 微博 `weibo.com/...`：两轮分别为根评论 17/17、楼中楼 4/4 与根评论 18/18、楼中楼 2/2
    全部挂上行内入口，`expandRowsWithButton=0`；拉黑一条与根评论作者不同的楼中楼后该行
    隐藏、根评论 110px → 63px 且保持可见，撤销恢复；`errors` 为空。
- `blocked`（2026-08-22 同轮，修复后如实上报）：知乎重定向到 `zhihu.com/signin`；贴吧落在
  「百度安全验证」滑块页；X 首页零可解析条目；抖音落在「验证码中间页」。此前这四项错误地
  显示为无错误。
- `structure regression`：`node test/run.cjs` 11/11、`node test/state.cjs` 6/6、
  `node test/quickblock.cjs` 24/24、`node test/adapters.cjs` 16/16、`node test/douyin.cjs` 2/2；
  `node --check` 覆盖 userscript 与全部探针文件，`git diff --check` 通过。

**限制**

- 本轮修复只提升探针的诚实度与稳定性，没有改变任何用户可见行为，因此不提升
  `@version`（仍为 `0.16.0`）。
- 批量入口快照仍受 B站评论加载速度影响：极端情况下 16 轮内评论仍未渲染，探针会如实报错，
  需要重跑而不是放宽断言。
- 四个受限平台在未登录会话下只能得到 `blocked`；它们的能力仍只有夹具证据。

**版本/发布状态**

- 探针修复提交 `65c1ce93b5b33b167df067d32f32a43659bdad87` 已推送到 `origin/master`，
  排在 tag `v0.16.0` 之后；不提升版本号，因此不单独发 Release。
- v0.16.0 发布链路已完成：tag `v0.16.0` → 提交 `e9630d4`，Release
  `https://github.com/a2787/ub-utils/releases/tag/v0.16.0`，raw `master` 更新 URL 现提供
  v0.16.0。

**下一项最有价值的验证**

用户在自己已登录、装有 PAKKU 的浏览器里确认弹幕浮层与微博点赞弹窗批量入口；这两条路径
在未登录无头会话里始终不可达。

### 2026-08-22 - 工作区清理 - 移除长期脏改动

**范围**

按用户要求清掉从 v0.12 起每轮都要在交接里复述一遍的四个脏文件。它们与当前工作无关，
只是持续占用注意力。此后 `git status --short` 在干净仓库上应为空。

**改动文件**

- `.gitignore`：新增 `test/shot-*.png` 与 `.workbuddy/`。
- `test/shot-1-load.png`、`test/shot-2-after-block.png`、`test/shot-3-settings.png`：
  从版本控制移除并从磁盘删除。这三张是 2026-08-20 提交 `54e25c2` 留下的一次性产物，
  全仓无任何代码或文档引用（`rg` 在源码、测试与文档中命中 0 处）；`test/run.cjs` 现在只写
  已忽略的 `test/_shot_*.png`，因此需要时可用 `node test/run.cjs` 重新生成截图。
- `.workbuddy/memory/2026-08-20.md`：从版本控制移除，文件移到工作区外的
  `%USERPROFILE%\.workbuddy\archive\pluginforchrome\2026-08-20.md`（未删除，仅归档）。
  `AGENTS.md` 本来就禁止提交 `.workbuddy/`，此前却仍被跟踪，属于矛盾状态。
  注意 `test/runtime.cjs` 读取的是 `%USERPROFILE%\.workbuddy\binaries\...` 下的
  playwright-core，与仓库内这个目录无关，删除不影响测试运行时。

**证据**

- `structure regression`（清理后复跑）：`node test/run.cjs` 11/11、`node test/state.cjs` 6/6、
  `node test/quickblock.cjs` 24/24、`node test/adapters.cjs` 16/16、`node test/douyin.cjs` 2/2；
  `node --check omniblock.user.js`、`git diff --check`、`git diff --cached --check` 通过。
  复跑后 `test/_shot_*.png` 照常生成，确认截图链路未被破坏。
- 本轮不涉及平台适配、入口注入或隐藏行为改动，因此不需要真站探针；`@version` 保持
  `0.16.0`，用户可见行为不变。

**限制**

- 三张截图的历史版本仍留在 git 历史里（未改写历史），只是不再出现在工作树中。
- 归档后的工作日志不再随仓库同步；需要时在
  `%USERPROFILE%\.workbuddy\archive\pluginforchrome\` 下查看。

**版本/发布状态**

见本条目的提交记录；不发新版本。

**下一项最有价值的验证**

同上一条：在已登录、装有 PAKKU 的真实浏览器里确认弹幕浮层与微博点赞弹窗批量入口。

### 2026-08-23 - v0.17.0 工作区 - 本地快照与未来同步边界

**范围与改动文件**

- `omniblock.user.js`：保留主名单键 `omniblock:data:v1` 不变，新增独立的
  `omniblock:backup:v1` 快照环；默认保留最近 5 份，支持关闭、状态查询和恢复上一份。
  快照格式为 `omniblock.snapshot` schema 1。新增 `registerBackupSink` provider 边界，
  当前没有注册网络 provider，也不会上传名单。
- `test/state.cjs`、`test/run.cjs`：新增快照协议、恢复/上限/关闭开关和设置控件回归。
- `README.md`、`CHANGELOG.md`：说明本地快照行为和浏览器配置整体丢失时仍需导出 JSON 的限制。

**证据**

- `structure regression`：`node test/state.cjs` 7/7、`node test/run.cjs` 11/11；覆盖
  独立键、schema/format、最近状态恢复、5 份上限、关闭后不再写入和 provider 只接收快照。
- `structure regression`：`node --check omniblock.user.js`、`node --check test/state.cjs`、
  `git diff --check` 通过。
- 本地备份不触发真实站点或网络请求；本条不把夹具结果写成 `real-site verified`。

**限制**

- 快照与主名单都位于当前 Tampermonkey/浏览器配置，不能替代导出到下载目录或其他设备。
- 云同步尚未实现；未来 provider 必须自行处理认证、加密、冲突和网络，不能复用当前本地
  隐私承诺来暗示已上传。

**版本/发布状态**

- userscript `@version` 已提高到 `0.17.0`；本条记录创建时本轮改动尚未提交、推送、打 tag 或创建 Release。
- 工作区另有前一轮 B 站/微博未收尾改动和一次性诊断产物，均未被覆盖或纳入本条范围。

**下一项最有价值的验证**

先把 B 站右侧弹幕列表回归夹具切换到真实捕获层级并恢复 quickblock 全部通过，再继续其
按钮几何和正式真站探针收尾。

### 2026-08-23 - v0.17.0 - 本地快照协议复核

**范围与改动文件**

- `omniblock.user.js`：内部 `omniblock.snapshot` schema 1 继续使用独立的
  `omniblock:backup:v1`；手动 JSON 导出保持旧版 `{version, exportedAt, persons, settings}`
  兼容格式。显式恢复在执行前建立可回退检查点；当自动快照关闭或一次写入未进入快照环时，
  「恢复上一份」改为选择最近仍然有效的状态。未知 `format/schema` 会被拒绝。
- `omniblock.user.js`：`registerBackupSink(name, {onSnapshot})` 只接收规范化深拷贝；同名
  provider 替换后，旧注销句柄不会误删新注册项；跨标签页主名单变更也会通知 provider。
  当前仍没有注册网络 provider、上传请求或新增连接权限。
- `test/state.cjs`：补充导出兼容、关闭开关后的恢复、同名 provider 生命周期回归。

**证据**

- `structure regression`：`node test/state.cjs` 7/7、`node test/run.cjs` 11/11、
  `node test/adapters.cjs` 17/17、`node test/douyin.cjs` 2/2。
- `state.cjs` 的人工合成跨标签页回调也确认 provider 收到 `external-change` 快照；这仍是
  `structure regression`，不代表云端传输已存在。
- `structure regression`：`node --check omniblock.user.js` 与 `git diff --check` 通过。
- 本地快照路径不访问真实平台；本条没有 `real-site verified` 声明。

**限制**

- 快照和主名单都位于当前 Tampermonkey/浏览器配置；浏览器配置整体丢失时仍须显式导出
  JSON 到下载目录或其他设备。
- 云同步尚未实现；未来 provider 仍需自行处理认证、加密、冲突、远端拉取和用户同意，
  不能把当前本地 callback 当成已上传证据。
- 工作区此前的 B 站弹幕布局夹具仍有 QB-O（移动横向溢出）和 QB-Z（悬停探针未命中）
  两项失败，未纳入本次本地备份范围。

**版本/发布状态**

- userscript `@version` 为 `0.17.0`；提交 `b0c2291ff71be7532cdb3e632ccce510de499d69` 已推送到 `origin/master`，tag `v0.17.0` 与 GitHub Release 已创建：<https://github.com/a2787/ub-utils/releases/tag/v0.17.0>。后续平台差异仍在工作区未提交。

**下一项最有价值的验证**

在隔离 Tampermonkey 配置中重启浏览器后确认 `omniblock:backup:v1` 可跨页面读取，再单独
处理既有 B 站 QB-O/QB-Z 回归，避免把平台布局问题与本地快照证据混在一起。

### 2026-08-23 - v0.18.0 - 微博回复弹窗与 B 站弹幕入口收尾

**范围**

本轮承接上一轮未收尾的三项用户问题：微博「共 N 条回复」展开弹窗缺少回复入口；B 站
弹幕原生举报操作条缺少本地入口且播放器浮层不跟随；B 站右侧弹幕列表部分行没有按钮。
没有回退 v0.17.0 的本地快照协议，也没有新增云端传输。

**改动文件**

- `omniblock.user.js`：微博弹窗的真实捕获层级与回复作者直连路径；B 站举报菜单短文本叶子
  的即时补扫；浮动弹幕坐标入口的逐帧跟随；右侧 `.bpx-player-dm-wrap` 虚拟列表识别、
  唯一/歧义身份分流、按显示时间按需读取 6 分钟 `seg.so`、外层 `li` 隐藏和禁用读取状态。
  userscript `@version` 提升到 `0.18.0`。
- `test/quickblock.cjs`：人工合成真实 B 站列表/浮动结构、分段路由、歧义整组入口、响应式
  与悬停几何回归（26 项）。
- `test/adapters.cjs`：人工合成真实捕获的微博展开弹窗与独立回复隐藏/撤销回归（17 项）。
- `test/real-bilibili-probe.cjs`：按当前真实列表选择器统计，并在浮动弹幕采样前暂停视频。
- `test/real-platform-probe.cjs`：只选择作者不同于根评论的回复做独立隐藏断言；同作者或无
  回复目标明确记为 `blocked`，并输出展开回复数量。
- `AGENTS.md`：补充进度更新的事实性要求；README、CHANGELOG、MAINTENANCE 同步本轮行为和证据。

**证据**

- `real-site verified`（2026-08-23，隔离、未登录、只读会话；目标由探针自动发现）：
  - B站脱敏页面 `bilibili.com/video/...`：浮动弹幕渲染 3 条，3/3 为
    `pointer-events:none`，坐标命中成功并完成 hash 拉黑/撤销；评论作者 4 位；弹幕工具
    26 组、18 位发送者，单组与批量拉黑/撤销成功。
  - 微博脱敏页面 `weibo.com/...`：28 条评论中 27 条解析身份；21 条根评论与 6 条作者
    不同于根评论的已加载楼中楼均挂载入口；拉黑一条回复后其高度收起、根评论 110px →
    63px 且保持可见，撤销恢复。
- `structure regression`：`node test/quickblock.cjs` 26/26、`node test/adapters.cjs`
  17/17、`node test/run.cjs` 11/11、`node test/state.cjs` 7/7、`node test/douyin.cjs` 2/2；
  `node --check omniblock.user.js`、相关测试/探针语法检查和 `git diff --check` 通过。微博
  展开弹窗、B站列表行、无语义举报项和跟随定位均只由人工合成/捕获结构回归覆盖。
- `blocked`：本轮 B站真实会话未展开右侧弹幕列表（`danmakuRowCount=0`），未登录也看不到
  原生弹幕举报操作条；微博虽然展开了 1 个楼中楼，但没有可安全确认是「共 N 条回复」
  弹窗的目标，点赞/转发用户列表弹窗同样不可达。因此这三条路径不能写成线上验证。

**当前限制**

- 普通弹幕段不直接提供 UID；反查仍限 1–10 位数字，CRC32 碰撞必须人工核对，不能把
  `mid_hash` 伪装成数字 UID。
- 列表行匹配依赖当前捕获的 `.dm-info-dm[title]`、显示秒和 `seg.so` 分段协议；B站改为
  canvas 或更换层级时需重新真实捕获。已进播放器缓存的弹幕可能要下一段或刷新后才完全消失。
- 云同步未实现；本轮只保留本地快照 provider 边界。评估过的 `browser-use/browser-use`
  是可辅助登录态探索的 MIT Python 浏览器代理，但本机未安装、未用于本轮验证，也不能替代
  隔离只读 Playwright 探针。

**接管复核（2026-08-23，主 Agent）**

- 发布交付子 Agent 因上游 API 错误中断，未执行任何提交、推送或 Release 动作。
- 主 Agent 复跑最低验证矩阵：`quickblock.cjs` 26/26、`adapters.cjs` 17/17、`run.cjs`
  11/11、`state.cjs` 7/7、`douyin.cjs` 2/2，`node --check omniblock.user.js` 与
  `git diff --check` 通过，隐私门禁 `rg` 无命中。
- 微博真站探针在自动发现目标上首轮失败：根评论容器塌缩为 0 高度且
  `connected:false`、`restored:false`（失败证据如实记录）；同一暂存代码立即重跑，
  全部断言通过（根评论收起后保持可见、撤销恢复）。判定为探针偶发而非代码回归；
  后续复现时须按失败证据排查，不得以重跑通过掩盖首轮失败。

**版本/发布状态**

- v0.18.0 已发布（2026-08-23）：提交 `4725f8b` 已推送 `master`，tag `v0.18.0` 与
  GitHub Release https://github.com/a2787/ub-utils/releases/tag/v0.18.0 创建成功。
  Release 说明与 CHANGELOG 0.18.0 一致并区分三类证据标签；匿名 API 复核为公开、
  非草稿、非预发布。raw `master` 更新 URL 现指向 0.18.0。
- 交付过程记录：发布子 Agent 两次因上游 API 错误中断，未执行任何 git 或发布动作；
  主 Agent 接管完成 Release 创建，认证令牌从 Windows 凭据管理器在进程内读取，未落盘、
  未写入日志或文档。

**下一项最有价值的验证**

在已登录、允许安全只读浏览的真实 B站视频中展开右侧弹幕列表并打开一条原生举报操作条，
确认行内「本地拉黑」与举报项入口都能出现；在真实微博详情页实际打开「共 N 条回复」弹窗，
逐条确认回复入口和独立隐藏。两项仍不得点击平台官方写入控件。

### 2026-08-23 - v0.19.0 工作区 - B站批量精细化与弹幕 UID 免二次确认

**范围**

承接用户提出的两项 B站升级：弹幕哈希识别到唯一 UID 时去掉二次确认直接屏蔽本人；批量
拉黑支持“加载全部评论与子评论”和“只拉黑晚于某时间点的发言”。本轮未改微博/抖音适配器。

**改动文件**

- `omniblock.user.js`：新增 B站 `x/v2/reply/main` + `x/v2/reply/reply` 只读整区抓取
  （根 60 页/子 400 根×15 页上限，任一页失败记 partial 并提示“部分分页未取全”）；左下角
  批量入口先弹范围/时间面板（仅已加载 / 加载全部；不限/最近 1/6/24 小时/3/7 天/自定义，
  缺 ctime 记录跳过）；面板自身不再被 1.2s 弹窗扫描误关（排除 `#ob-bulk-scope`，并清理
  Escape 监听器）；弹幕 UID 唯一候选免二次确认直接合并 hash/UID，多候选保留人工确认。
- `test/quickblock.cjs`：新增真实 CRC32 碰撞对（`86821`/`14740600`）夹具；QB-U 改为断言
  唯一候选直接落库、QB-W 断言多候选仍确认且取消不写入；新增 QB-AA（面板跨周期扫描 +
  已加载模式原路径事务）和 QB-AB（全量抓取 + 时间筛选跳过缺时间记录）。
- `test/real-bilibili-probe.cjs`：`--verify-local` 现在同时验证批量范围面板与评论 API
  契约；`--verify-danmaku-uid` 改为双路径断言（唯一免确认 / 碰撞确认）。
- `AGENTS.md`、`README.md`、`CHANGELOG.md`、`.gitignore`：同步登录态探针纪律、用户可见
  行为、0.19.0 更新说明与诊断产物忽略规则。

**证据**

- `real-site verified`（2026-08-23，隔离未登录会话，目标自动发现或 `--url=` 指定，页面
  脱敏为 `bilibili.com/video/...`）：
  - 批量范围面板可打开并跨过 1.2s 周期扫描；「仅当前已加载」在真实页面完成 2 位评论作者
    拉黑/撤销（`blocked:true, restored:true`）。
  - 评论 API 契约：`x/v2/reply/main` 匿名 code 0、3 条根评论含 mid/ctime、cursor 结束；
    `x/v2/reply/reply` code 0、1 条子回复含 mid/ctime。
  - 弹幕 UID 双路径：唯一候选（1 个候选）按钮为「拉黑本人」、`confirm:false`、
    `linked:true`、hash/UID 均屏蔽并撤销；碰撞候选（2 个候选）按钮为「确认并拉黑」、
    确认框显示、确认后合并并撤销。弹幕工具 26 组/30 位发送者单组与批量事务通过；浮动
    弹幕 11 条全部 `pointer-events:none`，坐标命中拉黑/撤销成功。
- `structure regression`：`node test/quickblock.cjs` 29/29、`node test/run.cjs` 11/11、
  `node test/adapters.cjs` 17/17、`node test/state.cjs` 7/7、`node test/douyin.cjs` 2/2；
  `node --check` 全部通过、`git diff --check` 通过。
- `blocked`：右侧弹幕列表在隔离会话仍未展开（`danmakuRowCount=0`）；完整“加载全部”分页
  翻页只由人工合成接口夹具覆盖，未在超长评论视频上跑完一轮；未登录看不到原生弹幕举报
  操作条。微博/抖音本轮无适配改动，v0.18.0 的微博真站证据仍有效，抖音仍未做登录态复核。

**限制**

- 整区抓取的上限（根 60 页、子 400 根×15 页）意味着超大评论区也可能未取全，面板会用
  “部分分页未取全”如实提示。
- UID 反查仍只覆盖 1–10 位数字；CRC32 碰撞无法自动消除，多候选必须人工核对，绝不静默
  拉黑。
- 用户已登录的调试浏览器在线且有 B站/微博/抖音页面，本轮未在其中执行脚本 UI
  写入，也未读取 Cookie。

**版本/发布状态**

- userscript `@version` 提高为 `0.19.0`；本条记录创建时改动尚未提交、推送、打 tag 或
  创建 Release。

**下一项最有价值的验证**

在已登录的真实 B站视频页用调试端口只读会话展开右侧弹幕列表，确认行内「本地拉黑」与
原生举报项入口；随后在用户已打开的抖音视频评论页做抖音适配器的登录态只读复核。

### 2026-08-23 - v0.20.0 工作区 - 抖音弹幕屏蔽完善

**范围**

承接上一轮交接的“抖音登录态只读复核”遗留项，完善抖音网页弹幕屏蔽：弹幕悬停跟随式
拉黑入口、作者弹幕按当前视频作者 sec_uid 映射、无身份弹幕不误隐藏。未改微博/B站
适配行为。

**改动文件**

- `omniblock.user.js`：抖音弹幕节点（真实捕获 `data-danmu-id` + `data-danmaku-user-id`）
  上挂载 `.ob-dy-dm-block` 跟随浮层（弹幕层 `pointer-events:none` 但节点自身可交互；
  按钮挂节点内部随 transform 移动，指针移出节点即收起）；`data-is-danmu-author=true`
  的作者弹幕额外绑定 `[data-e2e="video-avatar"]` 的 sec_uid；通用固定悬浮按钮对抖音
  弹幕改为抑制，避免双按钮；新增 `suppressGenericHover` 适配器钩子。
- `test/adapters.cjs`：douyin-danmaku 夹具改为真实属性；新增 douyin-danmaku-author
  身份契约和 douyin-danmaku-ui 闭环（悬停按钮、点击拉黑、隐藏、撤销、作者映射、
  无身份边界），19 项全部通过。
- `test/real-douyin-probe.cjs`（新增）：登录态只读探针，连接用户调试浏览器
  `127.0.0.1:9222`，开临时标签页注入内存 GM 存储的 userscript，只操作脚本自身 UI，
  不读取 Cookie、不点平台写入控件，结束后关闭标签页。
- `.gitignore`、`README.md`、`CHANGELOG.md`、`MAINTENANCE.md`：同步诊断产物忽略规则、
  用户可见行为、0.20.0 更新说明与本交接。

**证据**

- `real-site verified`（2026-08-23，用户已登录调试浏览器，临时只读标签页，页面脱敏为
  `douyin.com/...?...`，写入仅限内存 stub，标签页已关闭）：真实弹幕节点
  `data-danmu-id`/`data-danmaku-user-id` 存在；悬停出现节点内「🚫 拉黑」按钮，确认框
  含正确 `douyin:uid`；拉黑后该弹幕隐藏、撤销恢复。
- `structure regression`：`node test/adapters.cjs` 19/19、`node test/quickblock.cjs`
  29/29、`node test/run.cjs` 11/11、`node test/state.cjs` 7/7、
  `node test/douyin.cjs` 2/2；`node --check` 与 `git diff --check` 通过。
- `blocked`：隔离未登录 `douyin.com` 首页为「验证码中间页」；本轮视频
  `data-is-danmu-author=true` 弹幕数量为 0，作者弹幕映射只有人工合成夹具证据。

**限制**

- 抖音弹幕只提供数字 uid，不提供昵称；拉黑后名单显示 `douyin:uid:<数字>`，隐藏不依赖
  昵称解析。
- 作者弹幕映射依赖当前页面 `[data-e2e="video-avatar"]`；该锚点变化时需重新真实捕获。
- 登录态探针的临时标签页会短暂占用用户浏览器，但所有名单写入都在内存 stub，关闭标签页
  即消失；未触碰用户真实 Tampermonkey 存储。

**版本/发布状态**

- userscript `@version` 提高为 `0.20.0`；本条记录创建时改动尚未提交、推送、打 tag 或
  创建 Release。

**下一项最有价值的验证**

在播放中且作者发了弹幕的抖音视频上复跑 `node test/real-douyin-probe.cjs`，确认作者弹幕
映射的真站路径；随后处理 B站右侧弹幕列表登录态展开与原生举报操作条复核。

### 2026-08-24 - v0.21.0 工作区 - B站与微博帖子作者快捷入口

**范围**

为 B站视频/动态详情页和微博正文/旧版信息流补充作者级「本地拉黑作者」入口。入口只在作者
身份可可靠解析时出现；点击仍只写入本地名单，不触发平台官方拉黑、举报或关注。

**改动文件**

- `omniblock.user.js`：新增 `.ob-bili-author-block`；视频页使用真站捕获的 `.up-name` 空间链接，
  动态详情页使用 `__INITIAL_STATE__.detail.module_author.mid`，并修复作者中心容器挂载；新增
  `.ob-weibo-author-block`，覆盖 `article.woo-panel-main > header` 与旧版 `.card-wrap .card-feed`
  作者行。
- `test/quickblock.cjs`：新增人工合成 B站视频作者/动态作者入口闭环断言，31 项全部通过。
- `test/adapters.cjs`：新增人工合成微博正文与旧版信息流作者入口闭环断言，20 项全部通过。
- `README.md`、`CHANGELOG.md`：同步用户可见行为、证据边界与版本说明。

**证据**

- `real-site verified`（2026-08-24，隔离未登录会话，脱敏页面 `weibo.com/...`）：真实详情页显示
  「本地拉黑作者」；22 条评论中 17 条根评论、5 条楼中楼，21 条解析出身份、26 个行内入口可见。
- `structure regression`：`node test/quickblock.cjs` 31/31、`node test/adapters.cjs` 20/20；
  `node --check omniblock.user.js`、`git diff --check` 通过。人工合成夹具覆盖 B站视频/动态作者和
  微博正文/旧版信息流作者入口的挂载、确认、规范 UID 写入、隐藏/撤销。
- `blocked`：本轮 B站隔离未登录公开视频页虽成功发现并加载播放器，但未加载真实评论组件
  （`commentRendererCount=0`，`quickButtonCount=0`），批量入口与评论作者入口无法验证；探针还
  记录了页面 `appendChild` 错误。微博本次选中的回复能打开确认框并隐藏，但虚拟列表在撤销阶段
  回收根评论，未完成根评论保持可见与撤销恢复；完整回复事务不能替代作者入口的真实证据。

**限制**

- B站动态作者入口依赖 `__INITIAL_STATE__.detail.module_author.mid`；页面状态缺失或 mid 不可靠时
  不注入。B站视频入口依赖 `.up-name` 空间链接，需随真站结构变化重新捕获。
- 微博正文/旧版信息流作者入口只使用作者行的 UID，不把正文提及用户或评论作者当作帖子作者。

**版本/发布状态**

- userscript `@version` 提高为 `0.21.0`；完成本轮验证后再提交、推送、创建 `v0.21.0` tag 和
  同版本 GitHub Release。

**下一项最有价值的验证**

在隔离未登录且能加载评论的公开 B站视频页复跑 `node test/real-bilibili-probe.cjs --verify-local`，
并单独观察视频作者 `.up-name` 入口；随后在真实动态详情页复核 `module_author.mid` 作者入口。

### 2026-08-24 - v0.23.0 工作区 - B站视频页加载回归修复

**范围**

修复用户报告的 B站视频页图片、评论区和弹幕加载异常。诊断重点是页面渲染冲突与 PAKKU/
其他 XHR 包装器共存，不改变官方举报、拉黑或关注行为。

**复现与改动**

- `real-site verified`：2026-08-24，在用户当前 Chrome 的 `bilibili.com/video/...` 页面，登录状态
  未读取且没有执行账号操作；旧版 v0.22.0 页面可实际观察到播放器能播放，但主内容在评论区位置
  变为空白、右侧推荐图片停在灰色占位，B站脚本报 `HierarchyRequestError`，随后评论组件数量为 0。
  该页同时观察到插件作者按钮是 `.up-detail-top` 的直接子节点，以及 PAKKU/字幕扩展存在公开的
  XHR 包装链；没有发现插件名单产生的隐藏节点。
- `omniblock.user.js`：B站视频/动态作者按钮改为 `body` 下的独立 fixed 门户，随作者锚点定位，
  不再插入 Vue 管理的作者容器；检测到 `pakku_open/pakku_send` 时只桥接弹幕回调，不再覆盖
  普通 XHR 的 `open/send`。
- `test/quickblock.cjs`：加入普通 fetch、XHR、1x1 PNG 请求回归；作者入口改断言门户挂载且
  Vue 作者容器不被插入。夹具来源为此前捕获的 B站结构与人工合成网络响应。
- `README.md`、`CHANGELOG.md`：同步门户挂载、普通资源链路和本轮限制。

**证据**

- `real-site verified`：2026-08-24，隔离、未登录、自动发现的脱敏 `bilibili.com/video/...` 页，
  注入当前 v0.23.0 源码后 `errors=[]`；观察到 2 条根评论、2 个楼中楼容器、4 位评论作者、
  批量入口可见，播放器 `readyState=4`，弹幕 fetch/XHR 两条路径均到达页面，且有 2 个子评论
  renderer。
- `structure regression`：`node test/quickblock.cjs` 32/32；普通 fetch、XHR、图片和作者门户
  断言通过，原有 B站评论、弹幕、批量、UID 候选和 PAKKU 先安装夹具继续通过；`node --check
  omniblock.user.js` 与 `git diff --check` 通过。
- `blocked`：用户当前 Chrome 仍安装 v0.22.0，本轮未在该已安装 PAKKU/字幕扩展的会话里安装
  v0.23.0 后复核；发布后需要更新脚本并刷新原页面。未进行登录态功能测试，也未读取 Cookie。

**当前限制**

- B站作者门户依赖作者锚点的可见矩形；页面大幅改版或作者行离开视口时按钮会隐藏或贴到视口边缘，
  身份无法可靠解析时不注入。
- PAKKU 公开契约的人工夹具已通过，但真实用户扩展组合要在 v0.23.0 安装后复核；普通资源
  不再进入 OmniBlock 的弹幕 XHR 过滤分支。

**版本/发布状态**

- userscript `@version` 为 `0.23.0`；功能提交 `8fcb9be5051094db613fa043bc7a21fdcdc6fdca`
  已推送到 `origin/master`，`v0.23.0` tag 已创建并推送；GitHub Release 已发布：
  `https://github.com/a2787/ub-utils/releases/tag/v0.23.0`。本次交接状态修订提交会继续追加到
  `master`，不改写已发布 tag 或 Release。

**下一项最有价值的验证**

在用户安装 v0.23.0 后刷新原 B站视频页，确认评论、右侧推荐图片和弹幕都恢复；随后在同一会话
只读观察 PAKKU/字幕扩展共存时的弹幕本地过滤。若仍有问题，优先记录新的页面错误和关键请求状态。

### 2026-08-24 - v0.22.0 工作区 - 抖音评论工具、微博无空洞收缩与设置分组

**范围**

承接用户对抖音弹幕按钮可点击性、抖音评论漏屏蔽/缺少单条入口、微博评论空洞和设置面板可读性的反馈。
本轮不调用抖音私有接口，不触发平台举报、拉黑、关注或发帖。

**改动文件**

- `omniblock.user.js`：抖音弹幕按钮改为文字左侧略微重叠；评论“三个点”上下文可跨 portal
  复用到「举报评论」旁的本地入口；新增自动展开明确回复语义控件的抖音评论管理器和批量选择；
  微博被隐藏行的只包裹虚拟容器同步收缩；设置名单按平台分组并显示/悬停查看屏蔽依据。
- `test/adapters.cjs`：新增抖音按钮几何位置、评论 portal 菜单、自动展开管理器和微博后续虚拟
  回复补位断言；共 21 项通过。夹具为人工合成或此前记录的 DOM 契约，不等价于真站验收。
- `test/run.cjs`：新增设置平台分组与屏蔽依据提示断言；共 12 项通过。
- `README.md`、`CHANGELOG.md`：同步安装用户行为、限制和证据边界。

**证据**

- `real-site verified`：2026-08-24，隔离未登录只读浏览器，自动发现的脱敏 `weibo.com/...`
  公开详情页；实际本地屏蔽一条楼中楼后观察到 `hidden=true`、正文保持可见、根评论保持可见，
  根评论位置从 191 上移到 139，撤销后恢复。该探针没有触碰微博官方写入控件。
- `structure regression`：`node test/adapters.cjs` 21/21、`node test/run.cjs` 12/12、
  `node test/quickblock.cjs` 31/31、`node test/state.cjs` 7/7、`node test/douyin.cjs` 2/2；
  `node --check omniblock.user.js`、三个测试脚本语法检查和 `git diff --check` 通过。
- `blocked`：2026-08-24 默认隔离抖音探针打开 `https://www.douyin.com/` 后停在“验证码中间页”，
  `candidateCount=0`、`identityCount=0`；本轮没有用户授权运行登录态探针，所以抖音新评论入口、
  评论管理器和左侧按钮位置不声称已在真实登录页验证。

**限制**

- 抖音管理器只点击可见且文本明确包含展开/查看/更多/共 N 条回复语义的控件，最多尝试 80 个；
  虚拟/懒加载内容、没有明确控件的评论仍不会被猜成全量。
- 微博不同前端版本的虚拟包装层可能不同；本轮线上只覆盖未登录公开详情页的一条普通回复，
  展开弹窗、更深层回复和其他包装变体由结构回归覆盖。
- 本轮没有获取登录凭证、Cookie 或用户浏览数据；抖音登录态验证仍需用户当轮显式授权。

**版本/发布状态**

- userscript `@version` 提高为 `0.22.0`；已完成验证，按仓库既有授权流程提交、推送、创建
  `v0.22.0` tag 和同版本 GitHub Release。

**下一项最有价值的验证**

在用户当轮明确授权的专用登录浏览器 profile 中，只读打开抖音评论页，确认 portal「举报评论」旁
的本地入口、管理器自动展开和左侧弹幕按钮位置；不授权时继续以本轮 `blocked` 记录为准。

### 2026-08-24 - v0.24.0 工作区 - 抖音评论入口与微博虚拟包装器补位

**范围与复现**

- 当前用户浏览器的抖音精选评论页只读捕获到 23 条评论、23 条可靠作者链接；旧实现已有批量
  统计，但打开真实“三个点”后，`data-e2e="video-comment-more-report"` 是
  `role="tooltip"` 下的普通 `div`，没有生成本地入口。页面评论承载层为
  `#relatedVideoCard.LookModalFrameFast`，旧的通用 `Modal` 判定还会错误隐藏页面批量入口。
- 当前用户浏览器的微博页本轮只读观察到根评论/楼中楼入口和普通回复收缩；用户所说的具体空洞
  场景尚未在该会话执行本地写入，因此不能把它写成已解决。

**改动文件**

- `omniblock.user.js`：把当前捕获的 tooltip/`semi-tooltip-wrapper` 纳入菜单根与菜单项判定；
  抖音实际评论承载层不再被 `Modal` 类名误判为遮挡弹窗；微博安全包装器增加零高度、内联固定
  高度/内边距覆盖和撤销恢复。
- `test/adapters.cjs`：抖音夹具改为 `role="tooltip"` 举报项并加入
  `#relatedVideoCard.LookModalFrameFast`；微博弹窗夹具加入带内联 `!important` 固定高度的虚拟行，
  断言包装器归零和撤销恢复。夹具分别标明为真实 DOM 捕获外壳与人工合成固定样式。
- `README.md`、`CHANGELOG.md`：同步入口行为、补位边界和验证状态。

**证据**

- `real-site verified`：2026-08-24，当前用户浏览器只读捕获抖音评论 portal 的
  `role="tooltip"` 举报项、`#relatedVideoCard.LookModalFrameFast` 评论承载层，以及微博页面
  回复/根评论的实际可见结构；没有点击平台写入控件，也没有读取 Cookie。
- `real-site verified`：2026-08-24，隔离微博公开详情页的本地内存名单探针观察到一条作者不同于
  根评论的楼中楼隐藏后根评论从 139px 上移至 87px，撤销恢复；这只覆盖该页面结构。
- `structure regression`：`node test/adapters.cjs` 21/21、`node test/run.cjs` 12/12、
  `node test/state.cjs` 7/7、`node test/quickblock.cjs` 32/32、`node test/douyin.cjs` 2/2；
  `node --check omniblock.user.js` 与 `git diff --check` 通过。抖音 tooltip/详情侧栏和微博固定
  高度虚拟包装器的回归断言均通过。
- `blocked`：v0.24.0 尚未安装到当前用户 Chrome 会话；默认抖音真实探针仍被验证码中间页拦截，
  用户报告的微博具体空洞页面尚未由用户打开并配合只读复核。本轮未在用户真实名单中写入身份。

**当前限制**

- 微博仅在脚本能确认包装器只包含被隐藏评论时强制零高度；canvas、绝对定位或不接受高度变化
  的虚拟列表仍需真实页面复核。
- 抖音评论管理器仍只展开可见且带明确回复语义的控件，最多尝试 80 个；未加载或没有可靠
  `sec_uid` 的评论不会被猜测成可屏蔽用户。

**版本/发布状态**

- userscript `@version` 为 `0.24.0`；功能提交 `45689326e6fdb6e8fc31f7dc696b8f2e6d1a458a`
  已提交并推送 `origin/master`，`v0.24.0` tag 已创建并推送；GitHub Release 已发布：
  `https://github.com/a2787/ub-utils/releases/tag/v0.24.0`。当前用户会话复核仍是发布后的下一步，
  不把它倒写成已完成证据。

**下一项最有价值的验证**

用户更新到 v0.24.0 后，在当前抖音评论侧栏打开任一条评论的“三个点”，确认「举报评论」右侧
出现「🚫 本地拉黑」且左下角出现「🚫 抖音评论屏蔽(N)」；随后打开用户报告的微博原帖，分别在根评论
和楼中楼点一次插件自己的「本地拉黑」，由维护者只读观察被隐藏行及其下方评论是否立即补位。

### 2026-08-24 - v0.25.0 工作区 - 抖音 tooltip 去重与微博虚拟行补位

**范围与复现**

- 当前用户 Chrome 的抖音页面只读捕获到 23 条评论。模拟悬停打开真实评论“三个点”后，
  `role="tooltip"` 的层级为 tooltip wrapper → `semi-tooltip-content` →
  `[data-e2e="video-comment-more-report"]`；旧扫描器会对多个文字层重复注入「本地拉黑」，
  当前实时页面可观察到同一 tooltip 出现 2 个重复入口，用户报告为 3 个。
- 当前用户 Chrome 的微博页面只读复现了空洞：被屏蔽的
  `.vue-recycle-scroller__item-view` 高度为 0，但下一行仍保留 `translateY(191px)`，
  因此后续评论没有补到原位置。本轮没有在用户真实名单中新增身份。

**改动文件**

- `omniblock.user.js`：抖音 tooltip 只扫描真实举报叶子项；新增虚拟行原始高度记录、后续
  `translateY` 偏移补偿和撤销恢复，并限制在微博安全顶层评论行上。
- `test/adapters.cjs`：新增抖音 tooltip 本地入口数量必须为 1 的回归；将微博弹窗夹具改为
  绝对定位 `translateY` 虚拟行，断言后续行上移且撤销后恢复。
- `README.md`、`CHANGELOG.md`：同步用户行为、验证标签和当前限制。

**证据**

- `real-site verified`：2026-08-24 当前用户 Chrome 只读实际捕获抖音 23 条评论、真实 tooltip
  举报项和微博虚拟列表的 191px 空洞结构；没有点击平台举报、官方拉黑或其他写入控件，
  没有读取 Cookie。v0.25.0 隔离微博公开详情页实际观察到楼中楼隐藏后根评论从 139px 上移到
  87px，撤销恢复。
- `structure regression`：`node test/adapters.cjs` 21/21、`node test/run.cjs` 12/12、
  `node test/state.cjs` 7/7、`node test/quickblock.cjs` 32/32、`node test/douyin.cjs` 2/2；
  `node --check omniblock.user.js` 和 `git diff --check` 通过。
- `blocked`：默认隔离抖音探针在验证码中间页，无法观察评论入口；当前用户会话尚未刷新到
  v0.25.0，因此抖音重复入口和微博具体空洞的修复结果仍待安装后复核。

**当前限制**

- 微博仅对可识别的 `vue-recycle-scroller__item-view` 绝对定位行做偏移补偿，并且要求该行
  自身只包含被隐藏评论；其他虚拟列表实现、canvas 或固定不接受变换的容器仍可能需要新捕获。
- 抖音菜单入口的线上结构已捕获，但默认隔离探针仍被验证码拦截；不能把结构回归写成隔离真站
  行为验证。

**版本/发布状态**

- 当前源码 `@version` 为 `0.25.0`；提交 `179ab94` 已推送 `origin/master`，`v0.25.0` tag
  已创建并推送；GitHub Release 已发布：
  `https://github.com/a2787/ub-utils/releases/tag/v0.25.0`。

**下一项最有价值的验证**

用户更新到 v0.25.0 并刷新当前两个页面后，先在抖音任一评论的“三个点”菜单确认只剩一个
「🚫 本地拉黑」，再在微博报告页面对一条未被屏蔽的根评论或楼中楼使用插件入口，观察下方评论
是否立即补位；如出现验证码，先由用户通过后继续同一标签页的只读复核。

### 2026-08-24 - v0.26.0 工作区 - 抖音事件路径去重与微博回写补位

**范围与复现**

- 当前用户 Chrome 的抖音页面在 v0.25.0 下只读复现了同一评论 tooltip 出现 3 个「本地拉黑」：
  一个在 `semi-tooltip-content`，另两个在 tooltip/portal 外层。根因是 `pointerover` 事件路径把
  带“举报评论”文本的父容器也传给了通用注入器。
- 当前用户 Chrome 的微博页面连续只读采样确认隐藏虚拟行高度为 0，后续行位置由脚本设置为补位后的
  `!important` transform；本轮代码同时覆盖页面后续重排把 `style` 写回原值的路径。没有点击平台举报、
  官方拉黑、关注或发帖，也没有读取 Cookie 或把用户名单写入验证日志。

**改动文件**

- `omniblock.user.js`：抖音 portal 注入限定真实举报叶子，并在周期扫描时清理同一 tooltip 的多余入口；
  微博记录已应用的 transform，监听虚拟行 `style` 回写并立即重新补位。
- `test/adapters.cjs`：新增抖音完整 pointerover 事件路径去重断言；新增微博虚拟行被平台恢复原 transform
  后再次补位的回归断言。
- `README.md`、`CHANGELOG.md`：同步 v0.26.0 用户行为、限制和验证边界。

**证据**

- `real-site verified`：2026-08-24 当前用户 Chrome 只读实际捕获抖音菜单 3 个重复脚本入口及微博虚拟
  列表空洞/补位结构；这些是 v0.25.0 的问题复现，不把它们写成 v0.26.0 已在用户页修复。
- `structure regression`：`node test/adapters.cjs` 21/21、`node test/run.cjs` 12/12、`node test/state.cjs`
  7/7、`node test/quickblock.cjs` 32/32、`node test/douyin.cjs` 2/2；`node --check omniblock.user.js`
  和 `git diff --check` 通过。
- `real-site verified`：2026-08-24 默认隔离未登录微博探针自动发现 `weibo.com/...` 公开详情页，观察到
  9 条评论、9 条可识别身份、0 个重复入口；只读本地屏蔽楼中楼后根评论仍可见，位置从 110 上移到 63，
  撤销恢复。当前用户 Chrome 的抖音 3 个重复入口和微博空洞/补位回写属于 v0.25.0 问题复现，不把它们写成
  v0.26.0 已在用户页完成验证。
- `blocked`：v0.26.0 尚未安装到当前用户 Chrome 会话；默认隔离抖音探针若停在验证码中间页，只能记录为
  blocked，不能替代当前用户会话复核。

**当前限制**

- 微博只对可识别的绝对定位 `vue-recycle-scroller__item-view`，且虚拟行自身只包含被隐藏评论的情况做
  补位；其他虚拟列表实现仍需新的真实 DOM 捕获。

**版本/发布状态**

- 当前源码 `@version` 为 `0.26.0`；完整矩阵、隐私门禁和暂存差异审阅已通过。功能提交为
  `1719a7eed44ebe4a318faa53b93e51d5a9a8bbf0`，已推送 `origin/master`；`v0.26.0` tag 已创建并推送，
  GitHub Release 已发布：`https://github.com/a2787/ub-utils/releases/tag/v0.26.0`。

**下一项最有价值的验证**

- 发布后用户更新到 v0.26.0 并刷新当前抖音与微博页面：抖音打开一个“三个点”菜单确认只有 1 个本地入口；
  微博在同一报告页面观察被屏蔽评论下方内容是否稳定补位，不再出现一两秒一次的回弹。若出现验证码，先由
  用户通过后继续同一浏览器会话的只读检查。

### 2026-08-24 - v0.27.0 工作区 - 微博 style 反馈循环与整段空白

**范围与复现**

- 用户在 v0.26.0 页面报告：本地拉黑一条微博评论后页面明显卡顿，并且该评论以下的评论全部变成空白。
- 本轮对当前用户页面做了只读读取；页面评估连续超时，结合 v0.26.0 新增的全局 `style` 观察和无条件整页
  `schedule()`，确认代码存在反馈循环风险：脚本补位/折叠产生 `style` 变化，观察器再次整页扫描，扫描又
  产生更多折叠与补位变化。没有点击微博官方举报、拉黑、关注或发帖。

**改动文件**

- `omniblock.user.js`：微博纯 `style` 变化只定向调用虚拟行补位；只有节点新增或身份属性变化才触发整页扫描；
  对相同 `transform` 写入增加幂等判断。
- `test/adapters.cjs`：新增虚拟行回写后的 style 变化次数上限断言。
- `README.md`、`CHANGELOG.md`：更新 v0.27.0 用户行为、限制和验证状态。

**证据**

- `real-site verified`：2026-08-24 隔离未登录微博公开详情页探针无页面错误；展开 2 个楼中楼并进行脚本本地
  屏蔽后，根评论仍可见，位置从 279 上移到 227，撤销恢复。
- `structure regression`：适配器回归 21/21；新增 style 变化次数上限断言，且 `node --check omniblock.user.js`
  和 `git diff --check` 通过。完整矩阵需在本轮最终交接中补录。
- `blocked`：v0.27.0 尚未安装到当前用户 Chrome，会话页面的卡顿/空白最终修复结果待更新后复核。

**当前限制**

- 微博仍只对可识别的绝对定位 `vue-recycle-scroller__item-view`，且虚拟行自身只包含被隐藏评论的情况做补位。

**版本/发布状态**

- 当前源码 `@version` 为 `0.27.0`；完整矩阵、隐私门禁和暂存差异审阅已通过。功能提交为
  `506d83617511987d0fbe5af70819055c665736cc`，已推送 `origin/master`；`v0.27.0` tag 已创建并推送，
  GitHub Release 已发布：`https://github.com/a2787/ub-utils/releases/tag/v0.27.0`。

**下一项最有价值的验证**

- 发布后用户更新到 v0.27.0 并刷新当前微博页面，屏蔽一条评论后观察页面是否恢复流畅，且该评论下方内容是否
  继续显示并稳定补位；若仍卡顿，应先保留页面并通知我，不要切换浏览器。

### 2026-08-24 - v0.28.0 工作区 - 微博非活动虚拟行整段空白

**范围与复现**

- 当前用户 Chrome 的微博详情页在 v0.27.0 下可读复现：第一个被本地屏蔽的虚拟行处于
  平台回收状态（原始 `translateY(-9999px); opacity:0`），后续多行被脚本改写为约
  `translateY(-1.00014e+06px) !important`，页面从该处向下全部空白；现场读取正常、未触发
  验证码，也没有点击微博举报、官方拉黑、关注或发帖。
- 根因是补位函数把非活动回收行当成可见行写入补偿 transform；`!important` 又阻止微博虚拟
  列表在滚动复用时重新接管这些节点。

**改动文件**

- `omniblock.user.js`：识别 `opacity:0`/不可见的微博回收行；该类行保留平台 transform，
  并清除旧的本地补位状态；只对活动行应用后续评论补位。
- `test/adapters.cjs`：扩展人工合成的微博回复弹窗夹具，加入两个非活动回收行，并断言旧版
  会改写它们、新版保持原始 transform。
- `README.md`、`CHANGELOG.md`：同步 v0.28.0 的用户可见行为和验证边界。

**证据**

- `real-site verified`：2026-08-24 当前用户 Chrome 实际观察到上述负一百万像素 transform、
  非活动行的原始回收样式和向下空白；这是 v0.27.0 的失败复现，不是 v0.28.0 修复后验收。
- `structure regression`：`node test/adapters.cjs` 21/21；旧 v0.27.0 源码在新增夹具上为 20/21
  并失败 `recycledRowUntouched`，当前源码通过；微博隔离探针 `node test/real-platform-probe.cjs
  weibo --verify-local` 发现目标、无页面错误，局部屏蔽与撤销通过。
- `blocked`：当前用户 Chrome 尚未安装 v0.28.0，精确页面的修复后结果不能提前宣称。

**检查**

- `node --check omniblock.user.js`：通过。
- `node test/run.cjs`：12/12；`node test/state.cjs`：7/7；`node test/quickblock.cjs`：32/32。
- `node test/adapters.cjs`：21/21；`node test/douyin.cjs`：2/2；无页面错误。
- `node test/real-platform-probe.cjs weibo --verify-local`：`version 0.28.0`，自动发现目标、
  `loaded:true`、`errors:[]`，局部屏蔽后隐藏/补位/撤销通过。
- `git diff --check`：通过；隐私门禁 `rg`：无具体页面或账号标识命中。

**当前限制**

- 微博仍只对可识别的绝对定位 `vue-recycle-scroller__item-view`，且虚拟行自身只包含被隐藏评论的
  情况做补位；其他虚拟列表实现仍需新的真实 DOM 捕获。

**版本/发布状态**

- 源码已提升到 `@version 0.28.0`；功能提交 `c4ebb869f8dff55ab13f6718d86ffb52adcd23c9`、
  文档提交 `d2d982c702f57088931eb58e7a5d94b3a19569d1` 已推送 `origin/master`；`v0.28.0` tag
  已创建并推送，GitHub Release 已发布：
  `https://github.com/a2787/ub-utils/releases/tag/v0.28.0`。

**下一项最有价值的验证**

- 发布后用户在同一 Chrome 会话更新到 v0.28.0 并刷新当前微博详情页，确认屏蔽一条评论后页面不卡顿、
  下方评论继续显示；再滚动使回收行重新活动，确认微博能接管原始 transform。若出现验证码或页面再次
  卡顿，保留当前标签页并通知我，不要切换浏览器。

### 2026-08-24 - v0.31.0 候选 - 顶层微博虚拟评论与维护闭环

**范围**

在上一条 v0.30.0 维护门禁候选基础上，使用当前源码自行回放用户 Chrome 捕获的第二种微博结构：
顶层评论本身位于 `.vue-recycle-scroller__item-view > .wbpro-scroller-item > .item1`，平台会把
后续活动行写成 `translateY(-1.0001e+06px) !important`。本轮修复微博屏蔽一条评论后下方全部空白，
并把完整自检命令接到源码回放和隔离真站探针，不再以用户先安装候选脚本作为开发验证前提。

**改动文件**

- `omniblock.user.js`：版本提升到 v0.31.0；新增顶层虚拟评论选择器；支持科学计数法 `translateY`；
  异常活动行按前一条活动行和真实高度重建安全基线，平台反复回写时保持补位，撤销恢复。
- `test/weibo-replay.cjs`：新增用户 Chrome 顶层评论虚拟列表回放，覆盖异常科学计数法、平台回写、
  非活动回收行和撤销；旧 v0.28.0 同一回放可失败。
- `test/real-platform-probe.cjs`：微博屏蔽后按身份重新定位仍在页面中的行，避免平台正常替换 DOM
  节点时把旧节点误记为根评论消失。
- `test/maintenance-check.cjs`：维护者单命令顺序执行静态门禁、完整结构矩阵、回放和当前源码真站探针。
- `README.md`、`CHANGELOG.md`：同步顶层虚拟评论补位行为、维护命令和证据边界。

**证据**

- `structure regression`：当前 v0.31.0 源码运行 `node test/weibo-replay.cjs` 的 3 项回放/压力断言
  全部通过；v0.28.0 源码在同一夹具上 3 项均失败，继续产生约负一百万像素的活动行位置。
- `real-site verified`：2026-08-24 隔离未登录浏览器注入当前 v0.31.0 源码到自动发现的脱敏
  `weibo.com/...` 详情页，加载 21 条评论、20 个身份、23 个行内入口；只读屏蔽一条楼中楼后，
  所属根评论从 139 上移到 87，撤销恢复，探针 `errors:[]`。该结果不替代用户登录态精确页面验收。
- `real-site verified`：同一轮探针修正为按身份查找平台替换后的新 DOM 节点；之前的“根节点断开”
  是旧引用诊断误报，不再作为当前源码失败证据。
- `blocked`：当前用户 Chrome 精确微博页仍运行 v0.29.0，齿轮没有 v0.31.0 构建标识；在用户页面
  安装并刷新前，不声称登录态精确页面已验收，也不创建 v0.31.0 tag/Release。

**检查**

- 本轮必须运行 `node test/maintenance-check.cjs`；它从工作区源码读取版本并执行 `node --check`、
  通用/状态/B站/跨平台/抖音回归、微博回放和隔离真站探针，另行运行 `git diff --check` 与隐私门禁。
- 当前用户浏览器只用于最终环境复核；开发修复和回归不再依赖用户手动安装 Tampermonkey 候选版本。

**版本/发布状态**

- 工作区 userscript `@version` 提升到 `0.31.0`，构建标识为 `0.31.0-weibo-virtual-row`；候选尚未
  创建 v0.31.0 tag/Release。
- v0.30.0 维护门禁候选仍保留下一条历史记录；v0.29.0 正式发布事实不改写。

**下一项最有价值的验证**

完成当前候选的提交和推送后，若用户愿意在同一 Chrome 安装并刷新，先核对齿轮的 v0.31.0 构建标识，
再观察精确微博页屏蔽单条评论、滚动回收和撤销；若出现验证码或页面再次卡顿，保留标签页并通知我，
不切换浏览器。

### 2026-08-24 - v0.30.0 候选 - 当前运行源码维护门禁

**范围**

本轮先处理用户指出的维护流程缺口，不改微博补位算法：当前用户 Chrome 页面只能通过脚本自身
“已是最新 (v0.29.0)”确认 Tampermonkey 元数据，页面没有办法证明正在运行的源码就是本轮工作区
内容。v0.30.0 候选新增版本、构建和机器标记的页面契约，作为后续真实页面验收的前置门槛。

**改动文件**

- `omniblock.user.js`：新增 `RUNTIME_BUILD`、`window.OB.runtime`；齿轮和设置面板显示运行版本、
  构建标识，并设置 `data-ob-version`、`data-ob-build`、`data-ob-runtime`。
- `test/run.cjs`：新增源码版本、构建标识、运行时对象、齿轮属性和设置面板的互相一致性断言。
- `test/weibo-replay.cjs`：新增基于真实虚拟列表层级的本地回放；模拟临时超大行高、平台每 45ms
  回写后续 `transform`、非活动回收行和撤销，且可用 `--git-ref=v0.28.0` 验证旧版确实失败。
- `test/maintenance-check.cjs`：新增单命令维护自检，顺序执行静态门禁、完整结构矩阵、回放压力和
  当前源码注入的微博真实页面探针。
- `README.md`、`CHANGELOG.md`：说明更新后必须在当前页面核对构建标识，不能只看“已是最新”。

**证据**

- `real-site verified`（2026-08-24，用户当前 Chrome，登录状态未读取，页面脱敏为
  `weibo.com/...`）：脚本自身检查更新返回“已是最新 (v0.29.0)”；旧页面的 `#ob-gear` 没有
  `data-ob-version`、`data-ob-build`、`data-ob-runtime`，设置面板也没有运行构建行。这是维护门禁
  缺失的真实复现，不是 v0.30.0 已安装证据。
- `structure regression`：通用浏览器回归要求当前源码的 `@version`、`RUNTIME_BUILD`、
  `window.OB.runtime`、齿轮属性和设置面板文本一致；当前源码运行 `node test/weibo-replay.cjs`
  通过两项回放/压力断言，v0.28.0 源码在同一回放中因约负一百万像素位移失败两项断言。
- `real-site verified`：2026-08-24 隔离浏览器将当前源码注入自动发现的脱敏 `weibo.com/...` 详情页，
  发现 22 条评论、22 个身份、22 个行内入口；只读本地屏蔽楼中楼后根评论保持可见并从 110 上移到
  63，撤销恢复。该结果证明当前源码在隔离真站路径可运行，不替代用户登录态页面验收。
- `blocked`：v0.30.0 候选尚未安装到当前用户 Chrome，当前精确微博页面仍运行 v0.29.0；在用户
  更新并刷新前，不验收微博修复，也不创建 v0.30.0 tag/Release。

**新的强制维护流程**

1. 从工作区源码读取 `@version` 与 `RUNTIME_BUILD`，先运行本地矩阵。
2. 将候选源码送到 Tampermonkey 更新页；用户在安装页确认一次更新（用户脚本不能运行时自替换）。
3. 在同一用户 Chrome 页面刷新后，只读检查齿轮的三个 `data-ob-*` 属性和 `window.OB.runtime`，
   必须与候选源码完全一致。
4. 标识一致后，才运行该平台的真实只读探针并记录页面结果；不一致或页面卡住就保持
   `blocked`，保留当前标签页请求用户协助。
5. 精确页面验收通过后，才创建与 userscript 版本一致的 tag 和 GitHub Release。

**检查**

- 本条改动完成后必须运行 `node test/maintenance-check.cjs`（其内含 `node --check`、完整结构矩阵、
  回放和微博隔离真站探针），再运行 `git diff --check` 和暂存前隐私门禁；不得把候选尚未安装写成
  用户登录态页面已验收。

**版本/发布状态**

- 工作区 userscript `@version` 提升到 `0.30.0`；当前仍是候选，未创建 v0.30.0 tag/Release。
- v0.29.0 的正式发布事实保留在下一条历史交接中；本条只记录维护门禁候选。

**下一项最有价值的验证**

完成本地矩阵后，在当前用户 Chrome 的脚本更新页安装 v0.30.0 候选并刷新原微博标签页，确认齿轮
报告的版本与构建标识一致；随后再继续微博真实页面复现。

### 2026-08-24 - v0.29.0 工作区 - 微博登录态首轮高度异常

**范围与复现**

- 当前用户 Chrome 已确认安装 `v0.28.0`（脚本自身“检查更新”显示已是最新），刷新精确微博详情页后，
  第 2 个活动评论行被隐藏，但第 3 行及以下仍出现约 `-1.0001e+06px !important`，评论区继续空白。
- 隔离未注入脚本的同一公开详情页给出平台基线：前 5 行 transform 为 `0/102/165/356/419`，
  被屏蔽行内容高度约 `191px`。隔离内存调试版使用当前修复源时捕获 `height=191`，后续行变为
  `165/228`，因此问题集中在用户登录态首轮测量缓存，而非微博原始位置。

**改动文件**

- `omniblock.user.js`：新增安全虚拟行高度测量，优先直接内容层，限制最大有效高度；限制无效的
  transform 差值不能作为隐藏行高度。
- `test/adapters.cjs`：把被屏蔽虚拟行的 item-view 临时高度设为 `1,000,100px`，内容层仍为正常
  高度；断言新代码补位和撤销恢复，旧 v0.28.0 在同一夹具上失败。
- `README.md`、`CHANGELOG.md`：同步 v0.29.0 用户行为、限制和验证边界。

**证据**

- `real-site verified`：隔离未注入脚本页面确认微博真实基线；隔离内存调试版确认 v0.29 代码读取
  `191px` 并将后续行补到正确位置；当前用户 Chrome 确认 v0.28.0 仍复现负一百万像素问题。
- `structure regression`：`node test/adapters.cjs` 21/21；旧 v0.28.0 源码在新增临时高度夹具上
  为 20/21 并失败 `nextRestored`，当前源码通过。
- `blocked`：当前用户 Chrome 尚未安装 v0.29.0，精确页面的修复后结果不能提前宣称。

**检查**

- `node --check omniblock.user.js`：通过。
- `node test/run.cjs`：12/12；`node test/state.cjs`：7/7；`node test/quickblock.cjs`：32/32。
- `node test/adapters.cjs`：21/21；`node test/douyin.cjs`：2/2；无页面错误。
- `node test/real-platform-probe.cjs weibo --verify-local`：`version 0.29.0`，自动发现目标、
  `loaded:true`、`errors:[]`，局部屏蔽后隐藏/补位/撤销通过。
- `git diff --check`：通过；隐私门禁 `rg`：无具体页面或账号标识命中。

**当前限制**

- 微博仍只对可识别的绝对定位 `vue-recycle-scroller__item-view`，且虚拟行自身只包含被隐藏评论的
  情况做补位；其他虚拟列表实现仍需新的真实 DOM 捕获。

**版本/发布状态**

- 源码已提升到 `@version 0.29.0`；功能提交 `fa3676227b72b7e6a2b1f680da14ee3fe41ef4bd`、
  文档提交 `cd11661b6c2e5900d8d321abd20fc06b13a7114b` 已推送 `origin/master`；`v0.29.0` tag
  已创建并推送，GitHub Release 已发布：
  `https://github.com/a2787/ub-utils/releases/tag/v0.29.0`。

**下一项最有价值的验证**

- 发布后在同一 Chrome 会话更新到 v0.29.0，刷新当前微博详情页，确认页面不再卡顿、隐藏行下方评论
  立即补位，并滚动验证微博虚拟列表仍能接管回收行。
