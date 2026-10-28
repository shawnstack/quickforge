---
name: plugin-creator
description: Create, modify, or validate a QuickForge plugin (plugin.json manifest, contributes.ui slots, plugin tools, sandboxed panels). Use when the user wants to add a plugin, make a plugin show buttons or panels in the UI, expose a tool to the agent through a plugin, or debug a plugin that is not loading.
---

# Plugin Creator

QuickForge plugins live in a directory with a `plugin.json`. They can contribute
agent tools, skills, slash commands, and — since plugin `apiVersion: 2` —
declarative UI. This skill walks you from "what should it do" to a validated,
loadable plugin.

Read `references/manifest-reference.md` for the full field list, `references/ui-slots.md`
for the UI node DSL, and `references/examples.md` for three complete plugins.

## Step 0: pick the right extension point

Do not reach for a plugin when something simpler already exists.

| The user wants… | Use |
|---|---|
| A reusable procedure, prompt, or checklist | A **skill** (`skill-creator`), not a plugin |
| To expose an external service's tools | **MCP** server config, not a plugin |
| A slash command | `~/.quickforge/commands` or `contributes.commands` |
| A button / badge in the chat UI | **plugin + `contributes.ui.slots`** |
| A custom mini-app inside the app | **plugin + `contributes.ui.panels`** (sandboxed iframe) |
| A new agent tool | plugin + `contributes.tools` + `index.mjs` |

A plugin is the right answer when the user needs *code* (a tool handler), *UI
contributions*, or wants to ship several of these together as one installable
unit.

## Step 1: capture intent

Ask only what you cannot infer:

- Where should it appear? (`composer.actions`, `session.header`, `sidebar.footer`)
- What should clicking it do? (a tool call, a state change, opening a panel)
- Does it need to persist anything between sessions? (`ctx.kv`)
- Who is it for? Built-in / self-hosted plugin vs. something the user will zip
  and share. Shared plugins must stick to declarative UI; never assume they may
  ship arbitrary host code.
- Which directory? Default `~/.quickforge/plugins/<name>` for personal plugins,
  `plugins/<name>` for built-ins shipped with the repo.

## Step 2: scaffold

```bash
node skills/plugin-creator/scripts/scaffold-plugin.mjs <targetDir> --name <name> --template ui|tool|panel
```

Templates:

- `ui` — a declarative slot button, no tools (smallest possible plugin).
- `tool` — one agent tool, no UI.
- `panel` — a sandboxed iframe panel plus the `kv` bridge example.

The scaffold writes `plugin.json`, `index.mjs`, and (for `panel`) `panel/index.html`.

## Step 3: respect the UI contract

The single most important rule: **a plugin inserts into fixed slots; it never
rewrites host UI.**

- No `style`, `className`, `html`, `dangerouslySetInnerHTML` — they are stripped.
- No custom React components, no CSS injection, no selector patches.
- Only the node `type`s in `references/ui-slots.md` render. An unknown type is
  dropped, not rendered as a fallback.
- Visuals come from the host. A plugin chooses *which primitive*, not how it
  looks. The one exception is a sandboxed panel, which owns its own visuals
  inside the iframe.
- Behaviour changes (intercepting sends, rewriting messages) are **not** a UI
  contribution. Say so explicitly and point at server-side hooks instead.

## Step 4: write the code

```js
export function createPlugin(context) {
  return {
    tools: { /* optional: { name(params, toolContext) {} } */ },
    ui: {
      getSlots(slotName, props) { /* optional: return nodes for a declared slot */ },
      async handle(action, payload, info) { /* return { slots?, state?, toast? } */ },
    },
    async dispose() {},
  }
}
```

Rules that matter:

- `handle` runs on the **server**, in the host process. It must finish in
  **5 seconds** or the action is aborted with 504.
- `action` names must appear in `contributes.ui.actions`; anything else is
  rejected before your code runs.
- A slot must be declared in `contributes.ui.slots` before `getSlots` can fill
  it. Contributing to an undeclared slot is impossible by design — that is what
  makes the `ui:*` permission mapping meaningful.
- `state` returned from `handle` is merged into the plugin's KV (64 KB total,
  8 KB per value). Do not use it as a database.
- Throw normally; the host turns it into an audited 500 and keeps the last
  rendered UI.

## Step 5: validate before reloading

```bash
node skills/plugin-creator/scripts/validate-plugin.mjs <pluginDir>
```

It runs the real manifest normaliser (the same code the server uses), prints the
declared permissions, slots, actions and panels, and exits non-zero on any
schema error. Fix everything it reports before touching the app.

## Step 6: enable and verify

1. Restart or open **Settings → Plugins → Reload plugins**.
2. Enable the plugin (new plugins are off unless `enabledByDefault: true`).
3. Check the plugin card shows the expected UI slots/actions/panels.
4. Click the contribution. Watch for:
   - the button renders but nothing happens → action not in
     `contributes.ui.actions`, or missing `ui:*` permission (403);
   - nothing renders at all → slot not declared, or `status: error` on the card;
   - "plugin is not loaded" → `index.mjs` threw during `createPlugin`.
5. Settings → Plugins shows recent calls in the audit log; a rejected action
   tells you which gate it hit.

## Common mistakes

| Symptom | Cause |
|---|---|
| Contribution never appears | Slot not in `contributes.ui.slots`, or plugin disabled, or `apiVersion: 1` |
| Button renders, click does nothing | Action missing from `contributes.ui.actions` |
| 403 on click | Missing `ui:composer` / `ui:session` / `ui:sidebar` in `permissions` |
| 400 "unknown UI slot" | Slot name typo; only the three documented slots exist |
| Styling ignored | `style`/`className` are stripped by design — use `variant`/`tone` |
| Panel blank | `entry` path wrong, or file extension not whitelisted (html/js/css/json/svg/png/jpg/webp/woff2) |
| Panel fetch fails silently | Expected: the iframe has an opaque origin. Use `kv.*` / `notify` through the bridge |
| Tool missing from the agent | Plugin disabled, or `contributes.tools[].name` invalid |

## What not to promise

Do not tell the user a plugin can: restyle existing UI, replace host components,
run code in the renderer, use npm packages inside a declarative slot, or read the
conversation beyond the slot props it asked for. If the request needs those,
the honest answer is "that is not an extension point — here is the closest
thing".
