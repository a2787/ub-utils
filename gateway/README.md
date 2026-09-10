# OmniBlock 本地 AI 网关

这个目录提供 OmniBlock AI 智能屏蔽所需的本地网关运行层。网关使用官方 LiteLLM Proxy
Docker 镜像，不在 userscript 里重复实现 provider 路由、重试、fallback、限流和 cooldown。
配置依据为 [LiteLLM Config.yaml 文档](https://docs.litellm.ai/docs/proxy/configs)、
[Router 文档](https://docs.litellm.ai/docs/routing) 和 [Fallback 文档](https://docs.litellm.ai/docs/proxy/reliability)。

Windows 请使用 PowerShell 7 的 `pwsh` 运行 `.ps1` 文件；旧版 `powershell` 可能按系统代码页解析
UTF-8 脚本而报语法错误。

插件只连接：

```text
http://127.0.0.1:4000/v1/chat/completions
```

provider 的 URL、模型和 API Key 只保存在本机 `gateway\runtime\`，不会写入插件源码、
Git 提交或浏览器页面。`runtime` 目录由 Git 忽略；不要把其中的文件复制到公开位置。

## 可选的事实核查 broker

v0.54.0 的事实核查是独立的 loopback-only 只读 sidecar，不是 LiteLLM 模型网关，也不是搜索引擎。
插件默认关闭；只有在设置里选择 `shadow` 或 `canary` 后，才会向下面的本机地址发送脱敏后的事实 claim：

```text
http://127.0.0.1:4001/v1/fact-check
```

broker 默认读取 `gateway\runtime\fact-sources.local.json`。该文件处于 Git 忽略目录，默认不存在，
因此没有来源时会返回 `not_checked`。需要配置时，复制 [`fact-sources.example.json`](fact-sources.example.json)
到上述本机路径，再只填入自己允许访问的来源。来源 endpoint 必须是 HTTPS（本机测试地址除外），
不能带账号、密码、query 或 hash；每个来源还要声明 `official`、`licensed` 或 `local` 等级和 JSON 字段映射。
不要把 Cookie、Token、API Key 或真实页面抓取包放入来源配置。

手动启动和检查：

```powershell
node .\gateway\scripts\fact-retrieval.cjs --port=4001 --sources=gateway\runtime\fact-sources.local.json
Invoke-RestMethod http://127.0.0.1:4001/health
```

服务只绑定 `127.0.0.1`，请求最多 8 条 ordinal claim；插件不把 UID、hash、页面 URL 或整页正文发给
broker，broker 也只返回有限来源元数据。没有结果、来源冲突、来源过期、读取失败或摘要不足时，
插件仍按未核查处理。该 sidecar 没有登记为系统服务，停止它不会影响普通 AI 网关或本地名单。

## 第一次配置

本机需要 Docker Desktop，并且 Docker Desktop 的 Linux 引擎可以正常运行。执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\gateway\setup.ps1
```

向导会逐个询问：

- provider 本地标识
- API Base URL（填写 provider 的 base URL，通常以 `/v1` 结尾）
- 上游模型名
- 可选的 LiteLLM model reference；留空时使用 `openai/<上游模型名>`，适合 OpenAI 兼容 API
- 如果模型名以 `deepseek-v4` 开头，向导会询问 thinking mode；`disabled` 会通过 LiteLLM 的 `extra_body`
  关闭 V4 思考输出，适合本插件要求快速返回窄 JSON 的筛选请求，默认值为 `disabled`
- `primary` 或 `fallback` 角色
- API Key（输入时不会回显；本地模型可以留空）
- 可选 RPM、TPM 和路由权重

至少配置一个 `primary`。多个 `primary` 共享 `omni-default` 模型组，由 LiteLLM 负责路由；
配置为 `fallback` 的 provider 会生成单独的 fallback 模型组，在主组失败后接管。

如需非交互配置，也可以复制 [config.example.json](config.example.json) 到本地后按同样字段填写，
然后执行：

```powershell
node .\gateway\scripts\render-config.cjs `
  --input .\gateway\providers.local.json `
  --output-dir .\gateway\runtime
```

示例文件中的 URL 和 Key 是占位符，不能直接用于请求。

非交互配置可以在 provider 上增加可选字段 `thinkingMode`，值只能是 `disabled` 或 `enabled`。例如
DeepSeek V4 使用 `"thinkingMode": "disabled"` 时，渲染器会生成 LiteLLM 的
`extra_body.thinking.type`，避免插件的窄 JSON 请求在思考输出上耗尽 20 秒客户端时限；不填写时保持上游默认行为。

## 启动、检查和停止

配置完成后，日常启动可以直接双击仓库根目录的 [`启动网关.cmd`](../启动网关.cmd)。它只负责调用下面已有的
PowerShell 7 启动脚本，不包含 API Key，不安装服务、不修改注册表，也不会把网关绑定到局域网。窗口会保留
启动结果，便于直接看到 Docker 或健康检查错误；网关成功启动后可以关闭这个窗口，容器仍会继续运行。

如果系统没有 `pwsh.exe`，双击文件会明确提示安装 PowerShell 7；不要改用 Windows PowerShell 5 的
`powershell.exe`，UTF-8 中文脚本可能再次触发解析错误。

也可以在 PowerShell 7 中执行：

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\gateway\start.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\gateway\health.ps1
pwsh -NoProfile -ExecutionPolicy Bypass -File .\gateway\stop.ps1
```

`start.ps1` 会重新校验本地配置、重新生成 LiteLLM 配置，并在 Docker Desktop 已安装但未启动
时尝试启动它。容器只绑定到 `127.0.0.1`，不向局域网公开。

启动后，在插件设置中填写：

```text
本地网关地址：http://127.0.0.1:4000/v1/chat/completions
路由/模型名：omni-default
```

然后再开启「启用 AI 智能屏蔽」。插件仍然会先展示候选，只有用户确认后才写入本地名单。

## 路由行为

默认生成以下边界：

- `simple-shuffle`：同一模型组内按 LiteLLM 的部署路由策略分配请求
- `num_retries=1`：单个请求的有限重试
- `request_timeout=18`：上游请求超时边界，与插件的 20 秒客户端超时留出余量
- `allowed_fails=2`、`cooldown_time=60`：连续失败的 deployment 进入短暂 cooldown
- `fallbacks`：如果配置了 fallback provider，主模型组失败后切换到 fallback 模型组
- `drop_params=true`：兼容能力较弱的免费模型可以忽略不支持的可选参数

RPM、TPM 和权重是可选项。没有填限制时，LiteLLM 仍会在 deployment 间路由，但不会凭空知道
上游平台的免费额度；实际额度应按 provider 的规则填写，不能把它当作平台保证。

## 安全边界

- 不配置 `master_key`：插件的窄桥接不会发送网关 API Key；安全边界由 loopback 绑定和本机权限承担。
- 不要把 `runtime\provider-secrets.env`、`runtime\providers.local.json` 或生成的 YAML 上传到 Git。
- 不要在 LiteLLM 的 debug 日志中长期记录评论正文；排查时也只保留必要的错误信息。
- 网关只负责转发和路由，不负责决定是否屏蔽；屏蔽决定仍由插件的审核流程和现有名单链路完成。
- 当前插件只向网关发送 B 站或抖音当前页已观察到的截断文本；不发送 UID、sec_uid、弹幕 hash、Cookie
  或本地名单。抖音弹幕缓存按当前活动视频会话隔离，身份无法确认的内容只能作为不可执行的文本候选。
- 插件设置页不能直接启动宿主机进程；“一键启动”由根目录包装文件完成，避免引入 Native Messaging、注册表
  或系统级常驻组件。

真实 provider 的调用需要用户自行填入对应配置。本目录的 smoke 测试只使用人工合成的本地 mock
provider，不会访问真实平台或真实 API。
