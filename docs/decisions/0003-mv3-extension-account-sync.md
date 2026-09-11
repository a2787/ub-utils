# ADR-0003：统一 userscript、API 直连与账户级加密同步

日期：2026-09-11
状态：superseded（原 MV3 方案）；本文件保留决策变更记录

## 结论

上一轮把平板目标解释为“需要独立安装 MV3 扩展”，因此提出了正式扩展、service worker 和双 AI 传输模式。
实际目标设备的 Edge 以 Tampermonkey userscript 为可用安装路径，本轮撤回该交付假设：电脑与平板都使用
同一个 `omniblock.user.js`，不把 `extension/` 作为用户安装入口。

## 当前替代决策

1. userscript 是电脑与平板共同交付物。窄屏安全区、触控目标、设置表单、审核浮层和内容管理器在 userscript
   内适配；上一轮 `extension/` 文件暂保留为未采用实验产物，不参与当前版本验收。
2. AI 只保留 `direct` 模式。用户填写 OpenAI-compatible API 地址和模型名，并把 API Key 写入本机独立 GM
   存储；Tampermonkey 的 `GM_xmlhttpRequest` 直接发送请求，Key 只进入 `Authorization` 头，不同步、不导出。
   不加入本地模型；本机 loopback 网关只作为历史兼容/评测路径，不是当前主链路。
3. 账户同步继续采用独立服务和客户端加密。名单/规范身份、可同步设置、提示词个性化和反馈账本使用设备级逻辑时钟、
   墓碑和确定性合并，并用 `baseRevision` CAS 写回；服务端只保存 AES-GCM opaque envelope。API Key、密码、同步口令、
   访问令牌、日志、备份和自动快照不同步。
4. 同步默认由用户点击“立即同步（合并）”触发；网络失败和 CAS 冲突有界重试且保留本地状态。
   正式服务独立放在 `sync-server/`，不复用 Vibeme/V2/KB 数据库。

## 原方案为何收回

- 独立 MV3 扩展和扩展 service worker：目标平板无法方便安装，继续建设会造成第二套安装/维护路径。
- 把电脑上的 loopback 网关暴露给平板：依赖电脑在线、需要额外网络穿透，且扩大网关暴露面。
- 在脚本包或扩展包内放 provider Key 或同步 Key：脚本容易复制，云端也不应持有可直接调用的凭据。
- 服务器端解密并合并名单：服务端会看到最敏感的用户数据，并使东京服务器成为单点信任；客户端合并虽需处理口令，
  但可保持服务端 opaque。
- 直接复用 Vibeme/V2/KB 的数据库：所有权、备份和发布边界不同，故障会互相放大。

## 分阶段落地

- 当前：userscript 直连、移动/触控夹具、同步 mock、独立 Python 服务和受影响回归标记为 `structure regression`。
- 下一步：用户在电脑和目标平板的 Tampermonkey 中安装同一候选脚本，分别配置 provider/Key，再做只读页面、触控和
  显式同步验证；设备或真实服务不可用时标记为 `blocked`，不从桌面夹具推导。
- 线上：只有在独立确认 DB 路径、HTTPS 反向代理、CORS origin、备份、限流、账户删除和凭据方案后，才在东京服务器
  创建独立实例并做只读健康/密文读回；本 ADR 不授权部署或生产 schema 变更。

## 回滚

电脑可继续保留原 Tampermonkey 数据和脚本；候选 userscript 出现问题时停用候选、恢复旧脚本即可，不需要修改平台
数据。同步错误只停止本轮云端写入，不删除本地名单；退出账户只清除本机令牌，不删除服务器账户或云端密文。
