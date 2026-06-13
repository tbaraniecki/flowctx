import { defineConfig, loadEnv, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

// Resolve paths relative to this config file (ui/) so it works regardless of cwd.
const uiRoot = dirname(fileURLToPath(import.meta.url))
// .env lives at the repo root, one level up from ui/.
const repoRoot = dirname(uiRoot)

// `make start` brings the vite UI up in ~100ms but the server (tsx watch) has to
// transpile before it binds UI_PORT, so an early /ws connection — a stale browser
// tab, or the freshly-opened one — can reach the proxy before the server is ready
// and produce a one-off `ws proxy error: ECONNREFUSED` stack trace. It is
// harmless: the UI's WebSocket client (ui/src/hooks/useWebSocket.ts) reconnects
// every 2s and succeeds once the server is up. Filter just that transient line so
// it doesn't look like a real failure; every other proxy/error message passes
// through untouched.
const logger = createLogger()
const baseError = logger.error
logger.error = (msg, opts) => {
  if (typeof msg === 'string' && msg.includes('ws proxy error') && msg.includes('ECONNREFUSED')) return
  baseError(msg, opts)
}

export default defineConfig(({ mode }) => {
  // Load all vars (no prefix filter) from the repo-root .env; an already-set
  // process.env (e.g. exported by `make start`) wins. Keeps the UI dev port and
  // its /api+/ws proxy target in sync with the server's UI_PORT.
  const env = { ...loadEnv(mode, repoRoot, ''), ...process.env }
  const uiPort = Number(env.VITE_PORT ?? 5173)
  const serverPort = Number(env.UI_PORT ?? 3000)

  return {
    plugins: [react()],
    root: uiRoot,
    build: { outDir: 'dist' },
    customLogger: logger,
    server: {
      port: uiPort,
      proxy: {
        '/api': `http://localhost:${serverPort}`,
        '/ws': { target: `ws://localhost:${serverPort}`, ws: true },
      },
    },
  }
})
