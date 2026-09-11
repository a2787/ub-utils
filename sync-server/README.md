# OmniBlock 独立同步服务

这是 OmniBlock 的可部署同步服务，不属于 Vibeme/V2/KB，也不复用它们的数据库。
服务端只保存：

- 账户名、密码派生值和随机账户 ID；
- 有效访问令牌的哈希与过期时间；
- 当前客户端加密 envelope、revision 和更新时间。

名单、规则、AI 提示词、反馈和设置先在扩展端按记录建立逻辑时钟，再使用同步口令通过
PBKDF2-SHA-256 派生 AES-256-GCM 密钥。服务器只做 opaque blob 保存和 CAS（compare-and-set），
不知道同步口令，也不能解密正文。API Key、登录令牌、运行日志和本地快照从同步包中排除。

## 本地启动

本实现只依赖 Python 3 标准库：

```powershell
python sync-server/server.py --db .\sync-server\omniblock-sync.sqlite3 --host 127.0.0.1 --port 8787
```

`--db` 是这个服务自己的 SQLite 文件，不能指向其他项目数据库。默认只绑定 loopback；非
loopback 监听必须显式加 `--allow-public-bind`，不建议直接把 Python HTTP 服务暴露到公网。

正式使用时应在东京服务器上建立独立目录和独立系统账户，让本进程继续绑定
`127.0.0.1:8787`，由已有 HTTPS 反向代理提供外部域名。当前 userscript 通过 Tampermonkey 的
`GM_xmlhttpRequest` 发出同步请求，通常不依赖页面 CORS；若部署同时允许普通 `fetch` 或管理页面访问，
再为实际页面的精确 `Origin` 重复传入 `--allow-origin <exact-origin>`，不要使用 `*`。

仓库附带的 `omniblock-sync.service` 和 `omniblock-sync-tunnel.service` 是东京服务器的独立部署模板。
前者只监听 loopback 并把数据写入 `/opt/omniblock-sync/data/omniblock-sync.sqlite3`；后者在当前没有固定
域名/命名 Cloudflare Tunnel 的情况下提供临时 HTTPS 验证入口。Quick Tunnel 进程重启后可能得到新的
`trycloudflare.com` 地址，因此不能把它当作长期稳定域名；长期运行应改用用户自己的 HTTPS 域名或已认证的
Cloudflare Named Tunnel，并保持后端目录、数据库和服务单元不变。

## 与扩展对应的接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/healthz` | 只读健康检查 |
| POST | `/v1/auth/register` | 注册账户；不返回令牌 |
| POST | `/v1/auth/login` | 登录并返回短期访问令牌 |
| GET | `/v1/sync/state` | 读取当前 revision 和加密 envelope；空账户返回 404 |
| PUT | `/v1/sync/state` | 带 `baseRevision` 写入新的加密 envelope；并发时返回 409 |

服务端不会做云端解密合并。客户端遇到 409 会重新读取、解密、按设备逻辑时钟和墓碑合并，
再以新的 base revision 重试。这样同步口令始终只出现在设备内存中。

## 上线前门禁

当前东京机已按附带 systemd 模板部署独立服务和独立 SQLite 数据库，并通过 Cloudflare Quick Tunnel
取得 HTTPS health 证据；这不是固定域名，隧道进程重启后可能更换地址。长期使用前仍需要切换到用户自己的
HTTPS 域名或已认证的 Cloudflare Named Tunnel，并补齐备份/恢复策略、限流、账户删除/导出政策、SQLite
备份保护和线上密文读回门禁。当前部署没有修改 Vibeme/V2/KB 的数据库或既有网关服务。
