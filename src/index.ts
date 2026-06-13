import { ProxyServer } from './proxy/index.js'
import { RecordingController } from './proxy/lifecycle.js'
import { RequestStore } from './storage/index.js'
import { createAppServer } from './server/index.js'
import { loadPlugins } from './plugins/registry.js'
import { exec } from 'child_process'

const PROXY_PORT = parseInt(process.env.PROXY_PORT ?? '8080')
const UI_PORT = parseInt(process.env.UI_PORT ?? '3000')

async function main() {
  await loadPlugins()

  const store = new RequestStore(process.env.DB_PATH ?? 'requests.db')
  const proxy = new ProxyServer(PROXY_PORT)
  const controller = new RecordingController(store, {
    proxyPort: PROXY_PORT,
    // order_id restarts at 1 for each recording.
    resetCapture: () => proxy.resetOrder(),
  })

  // S3 owns createAppServer; assumed new signature: (store, controller).
  // The controller is passed so S3's /api/recordings* routes can drive
  // start()/stop()/getActive() and wire onStarted/onStopped to WS broadcasts.
  const { httpServer, broadcast } = createAppServer(store, controller)

  // S3 will typically register these inside createAppServer; we also register
  // here as a sane default so start/stop is broadcast even before S3 lands.
  controller.onStarted((rec) => broadcast({ type: 'recording-started', data: rec }))
  controller.onStopped((rec) => broadcast({ type: 'recording-stopped', data: rec }))

  // A2 safety net: only persist/broadcast while a recording is active. Tag each
  // captured request with the active recording id; drop it entirely otherwise.
  // This guarantees capture correctness no matter how the browser was launched.
  proxy.on('request', (req) => {
    const activeId = controller.getActive()
    if (!activeId) return // no active recording: drop the request
    req.recordingId = activeId
    store.insert(req, activeId)
    broadcast({ type: 'request', data: req })
  })

  await proxy.start()
  console.log(`Proxy listening on :${PROXY_PORT}`)

  httpServer.listen(UI_PORT, () => {
    console.log(`UI at ${process.env.OPEN_URL ?? `http://localhost:${UI_PORT}`}`)
    openUiChrome()
  })

  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    controller.stop()
    proxy.stop()
    httpServer.close()
    process.exit(0)
  })
}

// Chrome showing the React UI: opens in the user's normal Chrome, unproxied, so
// the dashboard loads directly and its own requests are not recorded.
function openUiChrome() {
  const url = process.env.OPEN_URL ?? `http://localhost:${UI_PORT}`
  exec(`open -a "Google Chrome" "${url}"`)
}

main().catch(console.error)
