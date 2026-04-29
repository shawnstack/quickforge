# 速构 QuickForge AI Chat

速构 QuickForge is a React + Vite + Tailwind CSS chat app using shadcn-style UI primitives and pi-mono's web chat components.

## Features

- ChatGPT-like layout with saved conversation list, streamable chat panel, and custom-model-only settings.
- `@mariozechner/pi-web-ui`, `@mariozechner/pi-agent-core`, and `@mariozechner/pi-ai` for chat, persistence, model calls, and API-key prompts.
- Local Node server that stores API configuration, API keys, selected model, and chat history in local JSON files.
- Bottom-bar YOLO mode that grants the agent local workspace tools for listing/reading/searching/editing files and running commands.
- Custom providers for OpenAI-compatible `/v1/chat/completions` APIs and Anthropic Messages APIs.
- Default Anthropic-over-LiteLLM profile:
  - Base URL: `http://localhost:4000/v1`
  - Model ID: `anthropic/claude-sonnet-4`
  - API: OpenAI-compatible `/v1/chat/completions`

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts the local file-storage API server and Vite on the fixed web port `5176`, then opens the browser.

On Windows, you can also double-click:

```text
dev-quickforge.bat
```

## Local app mode

On Windows, double-click:

```text
start-quickforge.bat
```

Or run manually:

```bash
npm run build
npm start
```

`npm start` serves the built web app from the local Node server and opens:

```text
http://localhost:5176
```

Local data is stored outside the repository in the user's home directory:

- Windows: `%USERPROFILE%\\.quickforge\\storage`
- macOS/Linux: `~/.quickforge/storage`

You can override the data directory with:

```bash
QUICKFORGE_DATA_DIR=/path/to/data npm start
```

Legacy `FASTCODE_DATA_DIR` is still accepted for existing setups. On startup, QuickForge automatically migrates existing data from the old platform-specific `QuickForge` or `FastCode` data folders into `~/.quickforge` without overwriting newer files.

Storage files:

- `custom-providers.json`: custom model/provider configuration
- `provider-keys.json`: API keys
- `settings.json`: selected active model, YOLO mode, and app settings
- `sessions.json`: full chat history
- `sessions-metadata.json`: conversation list metadata

On first run with the local server available, existing browser IndexedDB data for the same origin is copied into the local files without overwriting existing file data.

## YOLO local tools

The bottom bar has a YOLO mode switch. When YOLO is off, the agent has no local workspace tools. When YOLO is on, the agent can call local tools through the Node server:

- `list_dir`
- `read_file`
- `grep_files`
- `write_file`
- `edit_file`
- `run_command`

Tools are restricted to the workspace root, which defaults to the project directory. Override it with:

```bash
QUICKFORGE_WORKSPACE_DIR=/path/to/workspace npm start
```

Legacy `FASTCODE_WORKSPACE_DIR` is still accepted.

YOLO mode runs without per-tool confirmations, so only enable it for trusted models and trusted workspaces.

## Verification

```bash
npm run lint
npm run build
```

## Notes

The local server only listens on `127.0.0.1` by default. API keys are stored locally on disk, not in git and not on a remote server. Treat the local data directory as sensitive because API keys are stored in JSON files.
