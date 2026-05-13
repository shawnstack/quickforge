/**
 * Clipboard API polyfill for non-secure contexts (HTTP).
 *
 * navigator.clipboard is only available in secure contexts (HTTPS / localhost).
 * This polyfill provides a fallback using document.execCommand('copy') so that
 * all code paths — including third-party web components like
 * `<copy-button>` from `@mariozechner/mini-lit` — work even over plain HTTP.
 */

function fallbackWriteText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()

    try {
      const success = document.execCommand('copy')
      if (success) {
        resolve()
      } else {
        reject(new Error('execCommand("copy") returned false'))
      }
    } catch (err) {
      reject(err)
    } finally {
      textarea.remove()
    }
  })
}

export function applyClipboardPolyfill(): void {
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: fallbackWriteText,
        // Minimal stub for other clipboard methods that may be called elsewhere
        readText: () => Promise.reject(new Error('Clipboard read is not available in non-secure contexts')),
        read: () => Promise.reject(new Error('Clipboard read is not available in non-secure contexts')),
        write: () => Promise.reject(new Error('Clipboard write is not available in non-secure contexts')),
      },
      configurable: true,
      enumerable: true,
      writable: false,
    })
  }
}
