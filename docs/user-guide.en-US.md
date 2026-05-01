# QuickForge User Guide

QuickForge is a local-first AI chat application with regular chats, project chats, model management, and YOLO-mode local workspace tools.

This guide is organized by feature priority:

- **P0: Required setup** — required before you can start chatting.
- **P1: Core features** — common daily workflows.
- **P2: Advanced features** — project tools, YOLO mode, and proxy settings.
- **P3: Troubleshooting and maintenance** — FAQ, local data, and safety tips.

## Table of Contents

- [P0: Required Setup](#p0-required-setup)
  - [1. Start QuickForge](#1-start-quickforge)
  - [2. Configure Your First Model](#2-configure-your-first-model)
  - [3. Start Your First Regular Chat](#3-start-your-first-regular-chat)
- [P1: Core Features](#p1-core-features)
  - [4. Model Management](#4-model-management)
  - [5. Conversation Management](#5-conversation-management)
  - [6. Project Chats](#6-project-chats)
- [P2: Advanced Features](#p2-advanced-features)
  - [7. YOLO Mode and Local Tools](#7-yolo-mode-and-local-tools)
  - [8. Workspace Tool Examples](#8-workspace-tool-examples)
  - [9. Proxy Settings](#9-proxy-settings)
- [P3: Troubleshooting and Maintenance](#p3-troubleshooting-and-maintenance)
  - [10. FAQ](#10-faq)
  - [11. Local Storage Location](#11-local-storage-location)
  - [12. Security Recommendations](#12-security-recommendations)

---

## P0: Required Setup

### 1. Start QuickForge

Install dependencies and start QuickForge from the project directory:

```bash
npm install
npm run dev
```

Development mode starts both the local Node.js service and the Vite frontend. The default address is:

```text
http://127.0.0.1:5176
```

Production mode:

```bash
npm run build
npm start
```

On Windows, you can also double-click:

- `dev-quickforge.bat` for development mode
- `start-quickforge.bat` for production mode

> QuickForge depends on the local service for settings, API keys, conversations, and project configuration. If the page says the local service is unavailable, make sure the start command is still running.

### 2. Configure Your First Model

When you open QuickForge for the first time and no model has been configured yet, the chat area shows a model setup guide instead of a default model.

Recommended flow:

1. Click **Add model** in the chat area.
2. Fill in the provider settings.
3. Add at least one model ID.
4. Save.
5. Close the settings dialog. QuickForge will automatically select the first available model and open the chat UI.

Common fields:

| Field | Description |
|---|---|
| Provider name | A display name, such as LiteLLM, OpenRouter, or DeepSeek |
| Protocol type | Use OpenAI Compatible for most providers |
| Base URL | API endpoint, usually ending with `/v1` |
| API Key | Provider API key; can be empty for local proxies or Ollama |
| Model ID | Model identifier, such as `anthropic/claude-sonnet-4` |
| Context Window | Context length |
| Max Tokens | Maximum output tokens per response |
| Reasoning / Thinking model | Enable this if the model supports reasoning/thinking |

#### LiteLLM example

```text
Provider name: LiteLLM
Protocol type: OpenAI Compatible
Base URL: http://localhost:4000/v1
Model ID: anthropic/claude-sonnet-4
API Key: optional, depending on your LiteLLM configuration
```

If you use LiteLLM, you can also click **Use LiteLLM example** from the first-run setup screen to quickly create this configuration.

#### OpenRouter example

```text
Provider name: OpenRouter
Protocol type: OpenAI Compatible
Base URL: https://openrouter.ai/api/v1
Model ID: anthropic/claude-3.5-sonnet
API Key: your OpenRouter API key
```

#### DeepSeek example

```text
Provider name: DeepSeek
Protocol type: OpenAI Compatible
Base URL: https://api.deepseek.com/v1
Model ID: deepseek-chat
API Key: your DeepSeek API key
```

For DeepSeek V4 or other thinking models, enable **Reasoning / Thinking model** only if the model supports it.

#### Ollama example

```text
Provider name: Ollama
Protocol type: OpenAI Compatible
Base URL: http://localhost:11434/v1
Model ID: qwen2.5-coder:7b
API Key: empty
```

> Provider model IDs may change over time. Always verify them in the provider console or documentation.

### 3. Start Your First Regular Chat

After configuring a model, you will see the normal chat UI.

Common actions:

- Type a question or task in the bottom input box.
- Click send to start generation.
- Stop generation while it is running.
- Copy assistant responses from the action below each assistant message.
- Regular chats are not attached to a project and cannot use local workspace tools.

---

## P1: Core Features

### 4. Model Management

Click **Settings** in the top-right corner to manage models.

You can:

- Add a new provider.
- Add multiple models under one provider.
- Edit provider name, Base URL, protocol, and API key.
- Delete unused providers.
- Switch models from the model selector near the chat input.

Model selection rules:

- QuickForge only shows custom models that you configured.
- If a previously selected model still exists, QuickForge restores it on startup.
- If the saved model no longer exists, QuickForge selects the first configured model.
- If no model is configured, QuickForge shows the first-run model setup guide.

#### Reasoning / Thinking models

If a model supports reasoning or thinking mode, such as some DeepSeek, Qwen, or OpenRouter models, enable **Reasoning / Thinking model**.

Recommendations:

- Keep it disabled if you are unsure.
- Enable it only when the provider documentation confirms support.
- When enabled, QuickForge uses thinking settings better suited for reasoning models.

### 5. Conversation Management

The left sidebar shows projects and conversations.

You can:

- **Start a regular chat** from the new chat action.
- **Open a previous conversation** from the conversation list.
- **Rename conversations**.
- **Delete conversations**. This cannot be undone.
- **Copy assistant responses** using the action below assistant messages.
- **Rollback** from a user message to remove the later context.
- **Fork** from an assistant message to create a new conversation from that point.

Rollback and fork are useful when you want to:

- Try a different prompt.
- Regenerate from an earlier point.
- Keep the original conversation while exploring a new direction.

### 6. Project Chats

A project chat is attached to a local project directory. It enables workspace tools when YOLO mode is on.

Flow:

1. Click **Add project** in the sidebar.
2. Select or enter a local project directory.
3. Start a project chat under that project.
4. Enable YOLO in the project chat to let the model access files inside the project directory.

Regular chats vs project chats:

| Type | Attached to project | Local tools available |
|---|---:|---:|
| Regular chat | No | No |
| Project chat | Yes | Yes, when YOLO is enabled |

> Even with YOLO enabled, tool access is restricted to the attached project directory.

---

## P2: Advanced Features

### 7. YOLO Mode and Local Tools

YOLO mode grants the model direct access to the local project workspace. It is only useful in project chats.

Where to enable it:

- Use the **YOLO** button near the bottom input box in a project chat.

When enabled, the model can call these tools:

| Tool | Description |
|---|---|
| `list_dir` | List files and folders in the project |
| `read_file` | Read text files inside the project |
| `grep_files` | Search project files by text or regex |
| `write_file` | Create or overwrite files |
| `edit_file` | Edit files by exact text replacement |
| `run_command` | Run shell commands in the project directory |

Risk notes:

- YOLO mode does not ask for confirmation on every tool call.
- The model may modify files, overwrite files, or run commands.
- Enable it only for trusted models and trusted workspaces.
- Commit your work to Git or make a backup before large changes.

### 8. Workspace Tool Examples

These prompts work well in project chats with YOLO enabled.

#### Inspect project structure

```text
Inspect this project's directory structure and summarize the main modules.
```

#### Search for a function or keyword

```text
Search for every usage of saveActiveModel and explain the call chain.
```

#### Modify files

```text
Make the first-run no-model prompt friendlier and keep Chinese and English text consistent.
```

#### Build and fix errors

```text
Run npm run build. If there are errors, find the cause and fix them.
```

#### Safer workflow

Ask the model to plan before editing:

```text
Do not modify files yet. Read the relevant code first, explain your plan, and wait for my confirmation before applying changes.
```

### 9. Proxy Settings

The settings dialog includes proxy configuration.

In many setups, the local QuickForge service is enough for app storage and you may not need a proxy. You may need CORS Proxy when:

- The browser hits CORS restrictions while calling an LLM provider directly.
- A provider must be accessed through a forwarding proxy.
- A specific provider requires a compatibility proxy.

Proxy URL example:

```text
http://localhost:3001
```

The proxy must support this forwarding format:

```text
<proxy-url>/?url=<target-url>
```

---

## P3: Troubleshooting and Maintenance

### 10. FAQ

#### The page says “Local QuickForge service unavailable”

This usually means the local service is not running or the port is blocked.

Try:

1. Make sure `npm run dev` or `npm start` is still running.
2. Check the terminal for errors.
3. Confirm the URL is `http://127.0.0.1:5176` or your configured port.
4. If the port is already in use, change environment variables and restart.

#### No models are available

Reason: no custom model has been saved yet.

Fix:

1. Click **Add model** or **Settings**.
2. Add a provider, Base URL, and at least one Model ID.
3. Save and close the settings dialog.

#### API key does not work

Check:

- The API key is saved under the correct provider.
- The Base URL is correct.
- The Model ID belongs to that provider.
- Your provider account has permission and quota.

#### Model returns 401 / 403 / 404

Common meanings:

| Status code | Possible cause |
|---|---|
| 401 | API key is missing or invalid |
| 403 | No permission, insufficient quota, or model unavailable |
| 404 | Base URL or Model ID is incorrect |

#### Local tools do not work

Check:

1. You are in a project chat.
2. A project directory is attached.
3. YOLO mode is enabled.
4. The requested path is inside the project directory.

#### YOLO is enabled but files still cannot be read or written

Possible causes:

- The current chat is not a project chat.
- The project directory no longer exists or is inaccessible.
- The file path is outside the project root.
- The operating system denies access.

#### Project directory switch failed

Try:

- Make sure the directory still exists.
- Make sure the current user has access.
- Remove the old project and add it again.

### 11. Local Storage Location

QuickForge stores data in local JSON files.

Default path:

```text
~/.quickforge/storage/
```

On Windows, this is usually:

```text
%USERPROFILE%\.quickforge\storage\
```

Main files:

| File | Contents |
|---|---|
| `custom-providers.json` | Custom provider and model configuration |
| `provider-keys.json` | API keys |
| `settings.json` | Active model, YOLO state, language, and preferences |
| `sessions.json` | Full conversation data |
| `sessions-metadata.json` | Conversation list metadata |

You can change the data directory with:

```text
QUICKFORGE_DATA_DIR=/path/to/data
```

### 12. Security Recommendations

- API keys are stored on this machine. Protect your local account and data directory.
- Do not upload `~/.quickforge/storage/` to a public repository.
- Commit your work to Git before enabling YOLO on important projects.
- Do not enable YOLO for untrusted models.
- Before letting the model run commands, ask it to explain what the command does.
- For large edits, ask the model to propose a plan first, then confirm before execution.

---

## Recommended First-Time Path

If you are new to QuickForge, follow this order:

1. Start QuickForge.
2. Add your first model.
3. Try a regular chat.
4. Add a project directory.
5. Start a project chat.
6. Enable YOLO in a trusted project.
7. Ask the model to read, edit, build, and debug your project.
