# 速构 QuickForge

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-blue" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green" />
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" />
  <img alt="React" src="https://img.shields.io/badge/react-19-61DAFB?logo=react" />
  <img alt="Vite" src="https://img.shields.io/badge/vite-8-646CFF?logo=vite" />
</p>

AI chat application with YOLO-mode local workspace tools — the agent can read, write, and edit files in your project, plus run shell commands.

Built with React 19, Vite 8, Tailwind CSS 4, and shadcn-style UI primitives. Uses `@mariozechner/pi-web-ui` for chat components and `@mariozechner/pi-ai` for model orchestration. All data stays local in `~/.quickforge/storage/`.

---

## Features

- **ChatGPT-like UI** — collapsible conversation list, streaming responses, model settings.
- **Local-first** — all API keys, settings, and chat history stored in local JSON files. No cloud, no telemetry.
- **YOLO mode** — grant the agent access to your workspace: list files, read/write/edit, grep, and run commands.
- **Multi-provider** — OpenAI-compatible `/v1/chat/completions` and Anthropic Messages API. Bring your own endpoint.
- **Local service storage only** — the local Node.js service is the single storage backend; browser caches are not used for app data.

## Quick Start

```bash
# Install
npm install

# Development (server + Vite, port 5176)
npm run dev

# Production
npm run build
npm start
```

Open [http://localhost:5176](http://localhost:5176).

### Windows

Double-click `dev-quickforge.bat` for development, or `start-quickforge.bat` for production mode.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 4 |
| UI | shadcn-style primitives, Lucide icons |
| Chat engine | `@mariozechner/pi-web-ui`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai` |
| Server | Node.js (ESM), plain `http` module |
| Storage | Local JSON files at `~/.quickforge/storage/` |

## Project Structure

```
├── bin/quickforge.mjs     # CLI entry point
├── server/index.mjs       # Local API + storage server
├── src/                   # React frontend
├── public/                # Static assets
├── index.html             # HTML entry
├── vite.config.ts         # Vite + Tailwind config
└── package.json
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `QUICKFORGE_DATA_DIR` | `~/.quickforge` | Data storage directory |
| `QUICKFORGE_WORKSPACE_DIR` | project root | Workspace for YOLO tools |
| `QUICKFORGE_HOST` | `127.0.0.1` | Server bind address |
| `QUICKFORGE_PORT` | `32176` (dev) / `5176` (prod) | Server port |
| `QUICKFORGE_VITE_PORT` | `5176` | Vite dev server port |
| `QUICKFORGE_MAX_BODY_BYTES` | `52428800` (50MB) | Max request body size |

### Storage Files

Located at `~/.quickforge/storage/` (or `%USERPROFILE%\.quickforge\storage` on Windows):

- `custom-providers.json` — custom model/provider configs
- `provider-keys.json` — API keys
- `settings.json` — active model, YOLO mode, app preferences
- `sessions.json` — full chat history
- `sessions-metadata.json` — conversation list metadata

### Default Model

Comes pre-configured for a LiteLLM proxy:

- **Base URL**: `http://localhost:4000/v1`
- **Model**: `anthropic/claude-sonnet-4`
- **API**: OpenAI-compatible `/v1/chat/completions`

Change providers and models in the Settings panel.

## YOLO Mode

Toggle YOLO from the bottom bar. When enabled, the agent gains these local tools:

| Tool | Description |
|---|---|
| `list_dir` | List directory contents |
| `read_file` | Read file contents |
| `grep_files` | Search files by text/regex |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace text in a file |
| `run_command` | Execute shell commands |

All tools are restricted to the workspace root. YOLO runs **without per-tool confirmations** — only enable it for trusted models and workspaces.

## Verification

```bash
npm run lint
npm run build
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and PR guidelines.

## License

[MIT](LICENSE)
