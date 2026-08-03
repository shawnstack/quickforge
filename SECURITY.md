# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ Supported |

## Reporting a Vulnerability

QuickForge is a local-first application. API keys and chat history are stored only on your local disk.

If you discover a security vulnerability, please open an issue on GitHub rather than disclosing it publicly. We'll respond as quickly as possible.

## Security Considerations for Users

- QuickForge 的 CLI/生产服务在启用局域网分享时会监听配置的远程地址（当前默认 `0.0.0.0:5176`）；SDK 和 Desktop 默认仍使用 `127.0.0.1`。不要把 `5176` 直接映射到公网。
- 远程完整访问必须在本机设置中显式开启并配置强密码。优先通过 Tailscale、WireGuard 等可信 VPN 访问；手机 App 仅允许 `.ts.net` MagicDNS 完整域名和 Tailscale `100.64.0.0/10` 地址。
- 远程客户端即使完成 LAN 密码认证，也不能启动终端、重启服务、弹出目录选择器或打开服务端电脑上的资源管理器/IDE。
- **API keys** are stored in `~/.quickforge/storage/provider-keys.json` — treat this file as sensitive.
- **YOLO mode** runs without per-tool confirmations. Only enable it for trusted models and workspaces.
- SDK 与 Desktop 默认监听 `127.0.0.1`；CLI/生产服务的远程监听行为以上述 LAN 配置说明为准。
