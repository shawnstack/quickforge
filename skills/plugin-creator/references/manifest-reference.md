# plugin.json reference

Source of truth: `server/plugins/manifest.mjs` and `server/plugins/ui-schema.mjs`.
If this document and the code disagree, the code wins.

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | `/^[a-z0-9][a-z0-9_-]{0,63}$/`. The directory name is irrelevant; this is the identity. |
| `displayName` | string | no | Falls back to `title`, then `name`. |
| `version` | string | no | Free-form; `0.0.0` default. |
| `description` | string | no | One line, shown on the plugins page. |
| `apiVersion` | number | no | `1` or `2`. Omitted ⇒ `2`. `2` is required for `contributes.ui`. |
| `quickforgeVersion` | string | no | Advertised range, e.g. `>=2.3.4`. Advisory only today. |
| `enabledByDefault` | boolean | no | Only strict `true` counts. New third-party plugins should be `false`. |
| `main` | string | no | Entry module, default `index.mjs`. Must stay inside the plugin dir. |
| `permissions` | string[] \| object | no | Normalised to a flat string list. `ui:*` entries are enforced for UI actions; see below. |
| `contributes` | object | no | `tools`, `skills`, `commands`, `settings`, `ui`. |

## permissions

`permissions` accepts an array or an object (object keys become `key:value`
strings). UI actions are gated on these exact strings:

| Slot | Required permission |
|---|---|
| `composer.actions` | `ui:composer` |
| `session.header` | `ui:session` |
| `sidebar.footer` | `ui:sidebar` |

A permission is only meaningful if the plugin also declares the matching slot —
the registry derives its effective `ui:*` set from the slots you contribute, so
declaring `ui:composer` without a `composer.actions` slot does nothing.

## contributes.tools

```jsonc
"tools": [
  { "name": "summarise", "label": "Summarise", "description": "…",
    "parameters": { "type": "object", "properties": { "text": { "type": "string" } } } }
]
```

- `name`: `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`, exposed to the agent as
  `plugin__<plugin>__<tool>`.
- `parameters`: JSON Schema (object). Defaults to an empty object schema.
- The handler lives in `index.mjs` under `tools[name](params, toolContext)` and
  gets a 2-minute budget plus an `AbortSignal` via `toolContext.signal`.
- Plugin tools always require approval in the default access mode.

## contributes.skills / contributes.commands

A relative path (string) or list of `{ path }` entries pointing at directories
inside the plugin. Same traversal checks as `main`. Skills must contain
`SKILL.md`; commands are markdown files.

## contributes.settings

Free-form object exposed to the plugin as `context.config`. It is stored in
`plugins.json` under the plugin name. There is no host-rendered settings form
yet, so prefer reading `context.config` with sane defaults.

## contributes.ui (apiVersion 2)

```jsonc
"ui": {
  "slots": { "composer.actions": [ /* nodes */ ] },
  "actions": ["greet"],
  "panels": [{ "id": "hello", "title": "Hello panel", "entry": "panel/index.html", "width": 420 }]
}
```

| Field | Notes |
|---|---|
| `slots` | Object keyed by slot name. Unknown slot ⇒ manifest rejected. Max 8 slots. |
| `actions` | Action names `handle()` may receive. `/^[a-z0-9][a-z0-9_.-]{0,63}$/`, max 32. An undeclared action is a 400 before your code runs. |
| `panels` | Max 4. `id` `/^[a-z0-9][a-z0-9_-]{0,31}$/`. `entry` must stay inside the plugin dir. `width` clamped to 280–900, default 420. |

UI changes are treated like permission changes: the manifest's `ui` block is
hashed (`uiDigest`) so an edit is visible, not silent.

## Runtime context

`createPlugin(context)` receives:

| Member | Description |
|---|---|
| `context.plugin` | `{ name, displayName, version, dir }` |
| `context.config` | The stored `contributes.settings`-derived config object |
| `context.projectContext` | `{ id, workspaceRoot }` when a project is active |

The plugin instance may return:

| Member | Called when |
|---|---|
| `tools` | An agent invokes one of the declared tools |
| `ui.getSlots(slotName, props)` | Cold load / plugin reload, per declared slot. Budget **2 s**, then the static manifest nodes are used |
| `ui.handle(action, payload, info)` | A user clicks a contribution; `info = { slot, props, kv, plugin }`. Budget **5 s**, then 504 |
| `dispose()` | Plugin disabled, reloaded, or the catalog refreshes |

## Failure behaviour

- `index.mjs` throwing during `createPlugin` ⇒ plugin status `error`, previous
  instance kept if there was one, the rest of the catalog still loads.
- `getSlots` throwing or exceeding 2 s ⇒ static manifest nodes are kept.
- `handle` throwing ⇒ 500 + audit entry; `handle` exceeding 5 s ⇒ 504.
- Invalid node output from `getSlots`/`handle` ⇒ that slot update is dropped.
