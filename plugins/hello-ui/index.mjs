// Reference implementation of a declarative UI plugin (apiVersion 2).
//
// Everything a plugin can do here is bounded by contributes.ui: it may render
// whitelisted primitives into declared slots and answer declared actions. It
// never touches the DOM, never ships React, and never sees host state beyond the
// slot props it asked for.

export function createPlugin(context) {
  let greeted = 0

  const buttonNode = () => ({
    type: 'button',
    label: greeted > 0 ? `Hello ×${greeted}` : 'Hello',
    icon: 'sparkles',
    variant: 'ghost',
    onClick: { action: 'greet' },
  })

  return {
    ui: {
      // Optional: the manifest already carries static nodes. Returning nodes
      // here lets the button reflect runtime state.
      getSlots(slotName) {
        if (slotName !== 'composer.actions') return undefined
        return [buttonNode()]
      },

      async handle(action, payload, info) {
        if (action !== 'greet') return {}
        greeted += 1
        return {
          slots: { 'composer.actions': [buttonNode()] },
          state: { greeted },
          toast: {
            level: 'success',
            message: `Hello from ${context.plugin.displayName} (${info.slot})`,
          },
        }
      },
    },
  }
}
