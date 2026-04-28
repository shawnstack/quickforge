# Fastcode AI Chat

React + Vite + Tailwind CSS chat app using shadcn-style UI primitives and pi-mono's web chat components.

## Features

- ChatGPT-like layout with saved conversation list, streamable chat panel, and pi-mono provider/model settings.
- `@mariozechner/pi-web-ui`, `@mariozechner/pi-agent-core`, and `@mariozechner/pi-ai` for chat, persistence, model calls, and API-key prompts.
- Frontend-direct provider/API key settings saved in IndexedDB.
- pi-mono native `Custom Providers` UI for Ollama, LM Studio, vLLM, OpenAI-compatible APIs, Anthropic-compatible APIs, and other configured providers.
- Default Anthropic-over-LiteLLM profile:
  - Base URL: `http://localhost:4000/v1`
  - Model ID: `anthropic/claude-sonnet-4`
  - API: OpenAI-compatible `/v1/chat/completions`

## Development

```bash
npm install
npm run dev
```

Open the URL printed by Vite, then use the settings button to configure provider keys, custom providers, and proxy settings.

## Verification

```bash
npm run lint
npm run build
```

## Notes

This app stores API keys in browser storage for local or internal use. Do not expose this frontend-direct mode as a public production service without adding a backend proxy.
