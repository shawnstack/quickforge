import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __QUICKFORGE_SERVER_PORT__: JSON.stringify(process.env.QUICKFORGE_SERVER_PORT || process.env.FASTCODE_SERVER_PORT || ''),
  },
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.QUICKFORGE_SERVER_PORT || process.env.FASTCODE_SERVER_PORT || 32176}`,
        changeOrigin: true,
        configure: (proxy) => {
          // Disable timeout on SSE responses to prevent Vite proxy from killing long connections
          proxy.on('proxyRes', (proxyRes, _req, res) => {
            if (proxyRes.headers['content-type'] === 'text/event-stream') {
              res.setTimeout(0)
            }
          })
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React core — stable, large, rarely updated
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')) {
            return 'react-vendor'
          }
          // Lit — web component runtime
          if (id.includes('node_modules/lit/') || id.includes('node_modules/lit-html/') ||
              id.includes('node_modules/@lit/') || id.includes('node_modules/lit-element/')) {
            return 'lit-vendor'
          }
          // Icons — large, rarely changes
          if (id.includes('node_modules/lucide-react/')) {
            return 'icons'
          }
          // Heavy optional UI/runtime dependencies
          if (id.includes('node_modules/monaco-editor/') || id.includes('node_modules/@monaco-editor/')) {
            return 'monaco'
          }
          if (id.includes('node_modules/@xterm/')) {
            return 'xterm'
          }
          if (id.includes('node_modules/@earendil-works/pi-web-ui/')) {
            return 'pi-web-ui'
          }
          if (id.includes('node_modules/@earendil-works/pi-agent-core/')) {
            return 'pi-agent-core'
          }
          if (id.includes('node_modules/@earendil-works/pi-ai/')) {
            return 'pi-ai'
          }
          // pi-ai dynamic provider chunks support
          if (id.includes('node_modules/@mariozechner/')) {
            // Keep provider-specific splits the SDK already does via dynamic import
            return
          }
          // CSS utilities
          if (id.includes('node_modules/clsx/') || id.includes('node_modules/class-variance-authority/') ||
              id.includes('node_modules/tailwind-merge/')) {
            return 'css-utils'
          }
          // Let everything else use default chunking
        },
      },
    },
  },
})
