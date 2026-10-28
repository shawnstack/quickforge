# Three complete plugins

Copy these as starting points. All three validate against
`scripts/validate-plugin.mjs` unchanged.

## 1. Pure declarative UI (no tools)

`plugin.json`

```json
{
  "name": "hello-ui",
  "displayName": "Hello UI",
  "version": "0.1.0",
  "apiVersion": 2,
  "enabledByDefault": false,
  "permissions": ["ui:composer"],
  "contributes": {
    "ui": {
      "slots": {
        "composer.actions": [
          { "type": "button", "label": "Hello", "icon": "sparkles",
            "variant": "ghost", "onClick": { "action": "greet" } }
        ]
      },
      "actions": ["greet"]
    }
  }
}
```

`index.mjs`

```js
export function createPlugin(context) {
  let greeted = 0
  const node = () => ({
    type: 'button',
    label: greeted > 0 ? `Hello ×${greeted}` : 'Hello',
    icon: 'sparkles',
    variant: 'ghost',
    onClick: { action: 'greet' },
  })

  return {
    ui: {
      getSlots(slotName) {
        return slotName === 'composer.actions' ? [node()] : undefined
      },
      async handle(action) {
        if (action !== 'greet') return {}
        greeted += 1
        return {
          slots: { 'composer.actions': [node()] },
          state: { greeted },
          toast: { level: 'success', message: `Hello from ${context.plugin.displayName}` },
        }
      },
    },
  }
}
```

No `index.mjs` at all also works — the static nodes in the manifest render and
clicking them returns `{}`. That is the smallest possible plugin.

## 2. Declarative UI + an agent tool

`plugin.json`

```json
{
  "name": "word-count",
  "displayName": "Word count",
  "version": "0.1.0",
  "apiVersion": 2,
  "permissions": ["ui:session"],
  "contributes": {
    "tools": [
      { "name": "count_words", "label": "Count words",
        "description": "Counts whitespace-separated words in the given text.",
        "parameters": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] } }
    ],
    "ui": {
      "slots": {
        "session.header": [
          { "type": "badge", "label": "$state.last", "tone": "neutral" }
        ]
      },
      "actions": ["refresh"]
    }
  }
}
```

`index.mjs`

```js
export function createPlugin() {
  let last = '—'

  return {
    tools: {
      async count_words({ text }) {
        const count = String(text || '').trim().split(/\s+/).filter(Boolean).length
        last = String(count)
        return { content: String(count), details: { count } }
      },
    },
    ui: {
      getSlots() {
        return [{ type: 'badge', label: last, tone: 'neutral' }]
      },
      async handle() {
        return { slots: { 'session.header': [{ type: 'badge', label: last, tone: 'neutral' }] } }
      },
    },
  }
}
```

Note the `$state.last` payload reference in the manifest is a convenience; the
`getSlots` override is what actually drives the value. Both paths are valid.

## 3. Sandboxed panel with KV persistence

`plugin.json`

```json
{
  "name": "counter-panel",
  "displayName": "Counter panel",
  "version": "0.1.0",
  "apiVersion": 2,
  "permissions": [],
  "contributes": {
    "ui": {
      "slots": {},
      "actions": [],
      "panels": [{ "id": "counter", "title": "Counter", "entry": "panel/index.html", "width": 420 }]
    }
  }
}
```

`panel/index.html`

```html
<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Counter</title>
<style>body{font:13px system-ui;margin:0;padding:16px}</style></head>
<body>
  <button id="bump">Bump</button> <output id="count">0</output>
  <script>
    let seq = 0
    const pending = new Map()
    const call = (method, ...args) => new Promise((resolve, reject) => {
      const id = String(++seq)
      pending.set(id, { resolve, reject })
      parent.postMessage({ type: 'qf:call', id, method, args }, '*')
      setTimeout(() => { if (pending.delete(id)) reject(new Error('timeout')) }, 5000)
    })

    addEventListener('message', (event) => {
      const data = event.data
      if (!data || data.type !== 'qf:result') return
      const entry = pending.get(data.id)
      if (!entry) return
      pending.delete(data.id)
      data.ok ? entry.resolve(data.data) : entry.reject(new Error(data.error))
    })

    const out = document.getElementById('count')
    call('kv.get', 'count').then((value) => { out.textContent = String(value || 0) })

    document.getElementById('bump').onclick = async () => {
      const next = Number(out.textContent || 0) + 1
      out.textContent = String(next)
      await call('kv.set', 'count', next)
      await call('notify', 'info', `Count is ${next}`)
    }
  </script>
</body>
</html>
```

Open it from **Settings → Plugins** (the panel appears as a chip on the plugin
card). No host code, no build step, no npm dependency.

## Choosing between 1 and 3

- If the interaction is "a button that does something", use slots. It inherits
  the app's design language for free and works on mobile.
- If the interaction needs charts, canvas, a rich editor, or any framework, use a
  panel. It is isolated and cannot break the host, and it also cannot look native.
- Mixing both is normal: a slot button that opens a panel, or a panel that
  exposes its result through `kv` for a badge.
