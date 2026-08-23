export type CapabilityIconKind = 'plugin' | 'document' | 'spreadsheet' | 'presentation' | 'skill' | 'tool' | 'command'

/** Neutral icon registry for file references and non-Slash capability chips and menus. */
export const folderIcon = `
  <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2.8 5.2h5l1.5 1.7h7.9v8.3a1.7 1.7 0 0 1-1.7 1.7h-11a1.7 1.7 0 0 1-1.7-1.7z" />
    <path d="M2.8 7h14.4" />
  </svg>`

export const capabilityIcons: Record<CapabilityIconKind, string> = {
  plugin: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7.4 3.2h5.2a1.2 1.2 0 0 1 1.2 1.2v2.1h.9a2.1 2.1 0 1 1 0 4.2h-.9v2.1a1.2 1.2 0 0 1-1.2 1.2h-2.1v.7a2.1 2.1 0 1 1-4.2 0V14H4.4a1.2 1.2 0 0 1-1.2-1.2V9.9h.8a1.8 1.8 0 1 0 0-3.6h-.8V4.4a1.2 1.2 0 0 1 1.2-1.2h2.1v-.8a1.8 1.8 0 1 1 3.6 0v.8Z" />
    </svg>`,
  document: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5.4 2.8h6.1L15.8 7v10.2H5.4z" />
      <path d="M11.4 2.9V7h4.1" />
      <path d="M7.6 10.2h5" />
      <path d="M7.6 13h4.3" />
    </svg>`,
  spreadsheet: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3.4" y="4" width="13.2" height="12.2" rx="1.5" />
      <path d="M3.4 8h13.2" />
      <path d="M7.8 4v12.2" />
      <path d="M12.2 4v12.2" />
      <path d="M3.4 12h13.2" />
    </svg>`,
  presentation: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 4.2h14" />
      <rect x="4.2" y="4.2" width="11.6" height="8.4" rx="1.2" />
      <path d="M10 12.6v3.2" />
      <path d="m7.2 17 2.8-1.2 2.8 1.2" />
      <path d="M7.1 9.5 9 7.7l1.5 1.3 2.4-2.5" />
    </svg>`,
  skill: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4.2 3.2h4.4A2.4 2.4 0 0 1 11 5.6v11a2.4 2.4 0 0 0-2.4-2.4H4.2V3.2Z" />
      <path d="M11 5.6a2.4 2.4 0 0 1 2.4-2.4h2.4v11.1h-2.4A2.4 2.4 0 0 0 11 16.7" />
    </svg>`,
  tool: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12.8 3.5a4.2 4.2 0 0 0 4 5.5l-7.6 7.6a2.2 2.2 0 0 1-3.1-3.1l7.6-7.6a4.2 4.2 0 0 0-5.5-4" />
    </svg>`,
  command: `
    <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="m5 6 4 4-4 4" />
      <path d="M10.5 14h4.5" />
    </svg>`,
}
