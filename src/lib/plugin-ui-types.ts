// Types shared by the plugin UI client, the slot renderer and the plugins page.
// Kept dependency-free so both the client store and presentational components
// can import it without pulling anything else in.

export type PluginUiNodeType =
  | 'button'
  | 'icon-button'
  | 'text'
  | 'badge'
  | 'icon'
  | 'divider'
  | 'hstack'
  | 'vstack'
  | 'list'
  | 'input'
  | 'select'
  | 'toggle'
  | 'link'

export type PluginUiEvent = {
  action: string
  payload?: Record<string, unknown>
}

export type PluginUiOption = {
  value: string
  label: string
}

export type PluginUiNode = {
  type: PluginUiNodeType | string
  key?: string
  label?: string
  text?: string
  icon?: string
  variant?: 'default' | 'ghost' | 'danger'
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  disabled?: boolean
  checked?: boolean
  value?: string
  placeholder?: string
  options?: PluginUiOption[]
  open?: string
  onClick?: PluginUiEvent
  onChange?: PluginUiEvent
  children?: PluginUiNode[]
}

export type PluginUiSlotName = 'composer.actions' | 'session.header' | 'sidebar.footer'

export type PluginUiSlotEntry = {
  plugin: string
  nodes: PluginUiNode[]
}

export type PluginUiPanel = {
  id: string
  title: string
  width: number
  url: string
}

export type PluginUiPlugin = {
  name: string
  actions: string[]
  permissions: string[]
  panels: PluginUiPanel[]
  state: Record<string, unknown>
}

export type PluginUiSnapshot = {
  slots: Partial<Record<PluginUiSlotName, PluginUiSlotEntry[]>>
  plugins: PluginUiPlugin[]
}

export type PluginUiToastLevel = 'info' | 'success' | 'warning' | 'error'

export type PluginUiActionResponse = {
  state?: Record<string, unknown>
  slots?: Partial<Record<PluginUiSlotName, PluginUiNode[]>>
  toast?: { level: PluginUiToastLevel; message: string }
}

export type PluginUiToast = {
  id: string
  level: PluginUiToastLevel
  message: string
}

/** Slot props are the only host data a plugin contribution can read. */
export type PluginUiSlotProps = Record<string, unknown>
