# OmniBlock 当前维护计划

更新时间：2026-09-11

本文件是 OmniBlock 唯一的活动计划：记录问题、范围、依赖、验收和下一步；当前事实放在
`CURRENT.md`，用户可见变化放在 README/版本 changelog，结束项移入历史索引。

## 使用契约

- 每项计划有稳定 `OB-*` ID；`status` 只能为 `proposed`、`approved`、`in_progress`、`verified`、`deferred`、`blocked` 或 `superseded`。
- `verified` 必须有可追溯证据，`blocked` 必须写原因和下一步；依赖引用本文件 ID 且不得成环。
- 接近 24 KiB 时先拆分职责并更新知识树，不能继续追加历史台账。

## 状态流转

```text
proposed → approved → in_progress → verified
                                ├→ blocked
                                ├→ deferred
                                └→ superseded
```

## 已关闭项

2026-09-11 收尾轮关闭了 11 个积压项（OB-EXT-001 superseded；OB-AI-001/OB-COVERAGE-001/
OB-RULE-001/OB-MAINT-001/OB-REL-001 deferred；OB-AI-002/OB-AI-004/OB-AI-013/OB-PERF-001
blocked；OB-WEIBO-003 verified）。范围、证据、残留与恢复动作见
[2026-09-11 计划收尾归档](plans/2026-09-11-plan-closure.md)；残留的 blocked/partial 事实
仍以 `CURRENT.md` 为准。

## 活动项

### OB-TM-001 — Tampermonkey 移动端适配、API 直连与账户级加密同步

- status: blocked
- priority: P1
- scope: 保持 `omniblock.user.js` 为桌面与平板的共同交付物；优化窄屏/触控设置、内容入口、审核浮层和输入控件；补齐无 hover 设备的控制坞展开、页面内容入口和弹幕入口触控路径；AI 只保留用户直接填写的 OpenAI-compatible API 地址、模型名和设备本地 API Key；在 userscript 内提供账户注册/登录、客户端加密同步和显式“立即同步（合并）”入口，复用独立同步服务协议。
- non-goals: 不继续建设或发布 MV3 安装路径；不保留 AI 主链路的 loopback 网关模式；不加入本地模型；不把 API Key、账户密码、访问令牌或同步口令放入普通设置、导出文件或云端文档；不自动同步、不执行平台举报/官方拉黑/关注/发帖；东京服务器的独立同步部署由 `OB-SYNC-001` 管理，本项不改 Vibeme/V2/KB 既有服务；不删除上一项留下的实验文件。
- dependencies: none
- acceptance: required
  - [x] userscript 的 AI 配置只显示 API 地址、模型名和“设置/更换本机 Key”，旧 gateway 配置不会再触发网关请求；Key 只写入独立 GM 存储，并且不出现在名单导出、提示词导出、同步 state、日志或请求正文。
  - [x] userscript 在普通 Tampermonkey 运行时可以使用 GM 跨源请求直接调用已配置 provider；无 Key、无效 URL、网络错误和 HTTP 错误均给出可理解的失败状态，且不把 Key 写入页面对象。
  - [x] 390px、768px 和触控夹具验证：入口不遮挡安全区，设置面板不横向溢出，AI 配置和同步表单可滚动/提交；面板紧凑按钮组与 AI 审核/反馈浮层按钮在 561px 以上触控宽度被组件级 min-height 压回 26–34px 的缺陷已修复（coarse-pointer 组件规则后置覆盖），product 6/6 通过；真实平板安装未观察到前只记 `blocked`。
  - [x] 无 hover 的 coarse pointer 触控路径：页面入口常驻可见、齿轮单次点按直接进入设置，不依赖 `pointerover`/`mouseover`；原“齿轮首触展开控制坞、二次点按进设置”的手势在触控端 dock 挂载即 `expanded`，已不再适用。
  - [x] userscript 同步客户端复用 `sync/sync-core.js` 的 envelope/CAS/逻辑时钟/墓碑协议；账户密码和同步口令只在按钮调用期间留在内存，token/device id/本地文档单独保存；409 与离线重试可恢复，远端密文可在第二设备解密并合并。
  - [x] 本地 mock、独立 Python 服务、AI/平台/通用回归和文档/隐私门禁通过；未执行平台写入。
  - [ ] 目标平板实际 Tampermonkey 安装、AI provider 和东京线上同步服务分别取得 `real-site verified`，无法取得时明确记录 `blocked`，不以本地夹具替代。
- evidence: `structure regression`：v0.57.1 userscript product 6/6（含 768px 审核浮层触控目标断言，旧行为 26/32px 上失败）；同步核心 7/7；Python 服务 5/5；通用 20/20、状态 9/9、B站 38/38、自动弹幕 7/7、评论管理器 3/3、作品级 3/3、性能 8/8、适配器 28/28、内容 AI 11/11、内容覆盖 6/6；页面/控制台错误为 0。维护总检本地项通过。
- evidence: `real-site verified`：2026-09-11 匿名隔离只读会话加载 v0.57.1 B站候选，脱敏页面形式 `bilibili.com/video/...`；控制坞、统一内容入口、评论/回复和只读 AI 内容均有现场结果，页面/控制台错误为 0，但触控操作未在真实平板执行。`blocked`：目标平板真实触控/provider 与双设备同步结果尚未完成，抖音匿名探针停在验证码中间页。独立同步服务的线上部署与互测由 `OB-SYNC-001` 追踪。
- next: v0.57.1 已经用户当轮授权发布（push/tag/Release 完成，raw 更新地址已服务 0.57.1）；剩余动作：用户在目标平板 Edge 的 Tampermonkey 更新到 v0.57.1 并实测无 hover 入口、44px 触控目标与 AI provider，回填 `real-site verified` 或 `blocked`。取得设备结果前不把本地夹具升级为 `real-site verified`。
- updated: 2026-09-11
- supersedes: OB-EXT-001

### OB-SYNC-001 — 东京独立同步服务上线与双设备互测

- status: blocked
- priority: P1
- scope: 在东京服务器建立独立 `omniblock-sync` 运行目录、独立 SQLite 数据库和独立 systemd 服务；通过独立 HTTPS 隧道提供 userscript 所需的 `/healthz`、账户认证和 opaque-CAS 同步接口；使用同一账户与同步口令完成电脑、平板两端的显式合并验证。
- non-goals: 不修改 Vibeme/V2/KB 的数据库、代码、网关路由或现有隧道；不上传 API Key、浏览器登录态、运行日志或明文名单；不启用后台自动同步；当前服务器没有可用的固定域名时不伪称为稳定生产域名，临时隧道若发生重启需重新取得 endpoint，固定域名/命名隧道另行处理。
- dependencies: OB-TM-001
- acceptance: required
  - [x] 东京服务器只新增独立服务目录、独立数据库和独立服务单元，health 可从公网 HTTPS 访问；auth/CAS 等待真实账户流程。
  - [ ] 服务器端只看到账户认证元数据和客户端加密 envelope；远端读回不得出现人工合成明文、API Key 或同步口令。
  - [ ] 电脑与平板使用同一账户、同一同步口令，分别点击“立即同步（合并）”后，名单/可同步设置/提示词/反馈能够确定性合并，删除墓碑不复活。
  - [ ] 线上健康、密文读回、冲突重试和双设备结果记录为 `real-site verified`；网络/设备/登录条件阻断时如实记为 `blocked`。
- evidence: `structure regression`：本地 sync-core 7/7、Python 服务 5/5；`real-site verified`：2026-09-11 独立服务 loopback 与 HTTPS Quick Tunnel health 返回 200，源码 SHA-256 一致；真实账户与双设备互测待本项完成。
- next: 等待用户动作：先在电脑或平板注册同步账户并点击“立即同步（合并）”，再在另一台设备登录同一账户、输入同一同步口令并再次合并；完成后把健康、密文读回与合并结果记为 `real-site verified`，隧道重启更换地址时两台设备同步更新。
- updated: 2026-09-11
- supersedes: none

## 关闭规则

计划项只有在实现、验证、文档同步和交接事实全部完成后才可标记 `verified`。如果平台、登录、验证码、
导航竞态或扩展安装阻断了验证，保留 `blocked`，同时记录恢复动作；不要为了让计划看起来完整而降低证据等级。
