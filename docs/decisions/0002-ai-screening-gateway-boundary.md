# ADR-0002：AI 屏蔽使用本地兼容网关，不在 userscript 内重写路由器

- Status: Accepted
- Date: 2026-09-06
- Scope: OmniBlock AI 智能屏蔽的 provider、凭据、路由和隐私边界

## 背景

AI 屏蔽需要把当前页面的评论/弹幕文本交给模型判断。用户希望同时配置多个免费模型，并在
并发、次数或单 provider 暂时不可用时自动切换；还希望保留规则记忆和后续反馈能力。若把
URL、模型、API Key、重试、配额和冷却都塞进 userscript，会产生三类问题：凭据容易进入浏览器
脚本配置，路由器需要长期维护，且浏览器页面不适合承担跨 provider 的可靠限流。

## 决定

1. OmniBlock 只实现 provider-neutral 的本地 OpenAI 兼容客户端。默认只允许 loopback HTTP
   地址，AI 默认关闭；当前页文本只有在用户启用 AI 并点击或触发本页分析时才发送。
2. 多 provider、模型别名、fallback、重试、并发/预算和 cooldown 由本地网关管理。首选评估
   LiteLLM Proxy：其官方文档明确提供 OpenAI 兼容接口、provider 转换、retry/fallback、
   rate limit、budget 和本地运行路径（[LiteLLM 官方文档](https://docs.litellm.ai/)）。
3. OpenClaw（小龙虾）只作为可选的本地网关适配对象。官方定位包含 self-hosted gateway、
   model provider/failover 和 memory，但它主要面向聊天应用与 coding agent；只有确认其
   本地接口能稳定满足本 ADR 的窄 JSON 分类契约后才接入，不能因为服务器已部署就自动依赖或
   改动 V2。见 [OpenClaw 官方文档](https://docs.openclaw.ai/) 和其
   [model failover 说明](https://docs.openclaw.ai/model-failover)。
4. Portkey 保留为次选评估对象；它的网关文档覆盖 fallback、load balancing、预算和限流，
   但开源网关当前仍需单独评估版本成熟度和部署成本，不能先假定为本项目依赖。见
   [Portkey AI Gateway 文档](https://portkey.ai/docs/product/ai-gateway)。
5. userscript 不保存 provider API Key，不把 key、UID、mid、hash、URL 或 Cookie 发给模型。
   发送给本地网关的最小请求只含规则、临时项目编号、内容类别和截短后的可见文本；模型返回
   的候选先进入本地多选审核，确认后才调用既有身份名单写入路径。
6. “记忆”分为规则记忆、当前页面会话缓存、网关健康状态和可选的匿名反馈统计。第一阶段只
   落地规则与页面会话；身份关联仍遵守现有安全边界：hash 唯一且 UID 正向校验成功可以直接
   关联身份，但这不等于 AI 可以绕过用户确认自动屏蔽。
7. 网关的一键启动采用仓库根目录 `启动网关.cmd` 包装既有 PowerShell 7 `gateway\\start.ps1`；
   userscript 设置页只说明并配置 loopback 地址，不直接启动宿主机进程。这样不需要 Native Messaging、
   注册表、系统服务或开机常驻组件。

## 后果

- 浏览器端实现更小，API Key 和 provider 轮换留在适合承担它们的本地工具中；仓库的 `gateway/` 目录提供
  LiteLLM Docker 配置向导，LiteLLM、
  OpenClaw 或其他兼容网关可以替换，不改变评论/弹幕采集与审核 UI。
- 用户需要额外运行并配置一个本地网关；仓库已提供 LiteLLM 的启动、健康检查和停止路径，以及根目录双击启动包装，
  真实 provider 配置及多 provider 行为仍需单独验证。
- 若未来发现所有候选网关都无法提供必要的隐私、配额或 JSON 契约，才另立 ADR 评估最小本地
  fallback 组件，不在本 ADR 下悄悄造一个第二路由器。

## 验证边界

- 本 ADR 的工具能力来自上述官方资料；本轮 LiteLLM Docker mock 的健康、兼容入口和 fallback 已有本地 smoke 证据，
  但没有真实 provider Key，不能把 mock 结果写成真实模型可用。
- userscript 的本地分类客户端和审核流程由 `OB-AI-001` 的 `structure regression` 测试
  覆盖；实际网关联调、超时、fallback 和多 provider 配额属于后续 `real-site`/本地运行时
  验证，未完成时标记 `blocked`。
