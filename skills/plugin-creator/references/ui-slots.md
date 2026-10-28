# UI slots, node DSL and the action protocol

Source of truth: `server/plugins/ui-schema.mjs`. The host renders only what is
listed here; anything else is stripped or dropped.

## Slots

| Slot | Where it renders | Required permission | Props visible to the plugin |
|---|---|---|---|
| `composer.actions` | Composer control row, next to the “+” button | `ui:composer` | `sessionId`, `isStreaming` |
| `session.header` | Right side of the conversation header, before “⋯” | `ui:session` | `projectId`, `title` |
| `sidebar.footer` | Above the sidebar's Settings row | `ui:sidebar` | — (empty in the first release) |

Props are the **only** host data a contribution sees. There is no API to read
the conversation, the draft text, or other plugins' state.

Cold load (`GET /api/plugins/ui`) calls `getSlots(slotName, {})` with **empty
props** — the server has no session to take them from. Render a prop-independent
default there and let `handle` return the prop-aware nodes, otherwise the first
paint and the post-click paint will disagree.

A slot must be declared in `contributes.ui.slots`. Declaring it is what grants
the matching `ui:*` permission; you cannot appear in a slot you did not declare,
and `getSlots` cannot fill one you did not declare.

## Node DSL

```jsonc
{ "type": "button", "label": "Greet", "icon": "sparkles",
  "onClick": { "action": "greet", "payload": { "id": "$slot.sessionId" } } }
```

### Types and their allowed attributes

| `type` | Attributes |
|---|---|
| `button` | `label`, `icon`, `variant`, `disabled`, `onClick`, `key` |
| `icon-button` | `label` (used as aria-label/title), `icon`, `variant`, `disabled`, `onClick`, `key` |
| `text` | `text`, `key` |
| `badge` | `label`, `tone`, `key` |
| `icon` | `icon`, `tone`, `key` |
| `divider` | `key` |
| `hstack` / `vstack` / `list` | `children`, `key` |
| `input` | `value`, `placeholder`, `disabled`, `onChange`, `key` |
| `select` | `value`, `options`, `disabled`, `onChange`, `key` |
| `toggle` | `label`, `checked`, `disabled`, `onChange`, `key` |
| `link` | `label`, `open` (https only), `key` |

- `variant`: `default` | `ghost` | `danger`.
- `tone`: `neutral` | `accent` | `success` | `warning` | `danger`. Only two visual
  weights exist in the design language; `success`/`warning`/`accent` collapse to
  the accent colour, `danger` uses the destructive colour.
- `icon`: a name from a closed set — `puzzle`, `sparkles`, `star`, `zap`,
  `languages`, `play`, `settings`, `info`, `check`, `arrow`, `wand`, `link`.
  Unknown names render nothing (no error).
- `options`: max 32 `{ value, label }` pairs.

### Never allowed

`style`, `className`, `class`, `css`, `html`, `innerHTML`,
`dangerouslySetInnerHTML`, `ref`, `onMount`, `props`. These are stripped and
reported as warnings — the host decides how things look.

### Limits (exceeding these drops the whole slot contribution)

| Limit | Value |
|---|---|
| Nodes per slot (top level) | 20 |
| Nodes per slot (including children) | 200 |
| Tree depth | 6 |
| Slots per plugin | 8 |
| Serialised slot size | 64 KB |
| Action payload size | 8 KB |
| Label length | 64 |
| Text length | 2000 |

## Dynamic values

Only inside an event payload, and only these two roots:

```jsonc
"payload": { "id": "$slot.sessionId", "count": "$state.count" }
```

- `$slot.<key>` → a slot prop.
- `$state.<key>` → the plugin's KV state.

Anything starting with `$` that does not match is dropped rather than shown as
literal text. There is no expression evaluation, no function calls, no ternary.

## Action protocol

Clicking a contribution sends:

```jsonc
POST /api/plugins/<plugin>/ui
{ "slot": "composer.actions", "action": "greet", "payload": { }, "props": { } }
```

`handle(action, payload, info)` returns:

```jsonc
{
  "state": { "greeted": 3 },                          // merged into plugin KV
  "slots": { "composer.actions": [ /* nodes */ ] },   // replaces this plugin's nodes in that slot
  "toast": { "level": "success", "message": "Hello" } // floating feedback, auto-dismiss 5s
}
```

All three are optional. Gates, in order:

1. Authenticated app client (local or LAN-authorized) — otherwise 403.
2. Action declared in `contributes.ui.actions` — otherwise 400.
3. Slot declared by the plugin — otherwise 400.
4. Matching `ui:*` permission — otherwise 403.
5. Fewer than 4 concurrent actions for this plugin — otherwise 429.
6. Finish within 5 s — otherwise 504.

Every outcome is written to the plugin audit log, visible on the plugins page.

## Sandboxed panels (L2)

```jsonc
"panels": [{ "id": "hello", "title": "Hello panel", "entry": "panel/index.html", "width": 420 }]
```

The host renders `<iframe sandbox="allow-scripts">` — deliberately **without**
`allow-same-origin`. Consequences you must design around:

- `window.origin` is `null`; `localStorage` is not the host's.
- `fetch('/api/...')` is blocked (CORS, `Origin: null`). Do not try.
- Your assets come from `/api/plugins/<plugin>/assets/<entry>`; only
  `html/js/mjs/css/json/svg/png/jpg/jpeg/webp/woff2` are served.
- Bring your own framework and styles inside the frame — that is the whole point.

### Bridge

```js
const id = String(++seq)
parent.postMessage({ type: 'qf:call', id, method: 'kv.get', args: ['count'] }, '*')
```

Result:

```js
{ type: 'qf:result', id, ok: true, data: 3 }
{ type: 'qf:result', id, ok: false, error: 'bridge timeout' }
```

Methods:

| Method | Args | Returns |
|---|---|---|
| `kv.get` | `key` | stored value or `undefined` |
| `kv.set` | `key`, `value` | `true` (8 KB per value, 64 KB per plugin) |
| `notify` | `level`, `message` | `true` (host toast) |
| `callTool` | `toolName`, `args` | the tool result, or an error string |

`callTool` is restricted twice:

1. `toolName` must be **this plugin's own** tool (`plugin__<plugin>__<tool>`).
   Workspace tools, MCP tools and other plugins are rejected before the call
   leaves the frame.
2. The host then calls `POST /api/tools/:name`, which requires full-access mode
   for direct plugin-tool execution. In the default access mode you get a 403
   with the host's own wording — a panel never has more privilege than the UI.

Tool calls get the server's 2-minute budget; every other method gets 5 s.

Limits: 4 concurrent calls per panel. `targetOrigin` must be `'*'` (the frame has
no origin to match); the host verifies `event.source` instead.
