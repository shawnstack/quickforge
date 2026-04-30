# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ Supported |

## Reporting a Vulnerability

QuickForge is a local-first application. API keys and chat history are stored only on your local disk.

If you discover a security vulnerability, please open an issue on GitHub rather than disclosing it publicly. We'll respond as quickly as possible.

## Security Considerations for Users

- **API keys** are stored in `~/.quickforge/storage/provider-keys.json` — treat this file as sensitive.
- **YOLO mode** runs without per-tool confirmations. Only enable it for trusted models and workspaces.
- The local server listens on `127.0.0.1` by default and is not exposed to the network.
