import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import path from 'path'
import { fileURLToPath } from 'url'
import type { RequestStore } from '../storage/index.js'
import type { FilterOptions } from '../types.js'
import type { RecordingController } from '../proxy/lifecycle.js'
import { registry } from '../plugins/registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Parse query-string filters (comma-separated values), excluding control keys.
function parseFilters(query: Record<string, unknown>): FilterOptions {
  const filters: FilterOptions = {}
  for (const [key, val] of Object.entries(query)) {
    if (key === 'recordingId') continue
    if (typeof val === 'string' && val) {
      filters[key] = val.split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  return filters
}

// Make a recording name safe to use as a download filename.
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_. ]/g, '_').trim() || 'export'
}

export function createAppServer(store: RequestStore, controller: RecordingController) {
  const app = express()
  app.use(express.json())

  // Serve built UI (production) or proxy to vite dev server
  const uiDist = path.join(__dirname, '../../ui/dist')
  app.use(express.static(uiDist))

  // REST: get plugin metadata (what filters/exports are available)
  app.get('/api/plugins', (_req, res) => {
    res.json(registry.getMetadata())
  })

  // REST: list recordings
  app.get('/api/recordings', (_req, res) => {
    res.json(store.listRecordings())
  })

  // REST: start a new recording (controller creates it + launches the browser).
  // controller.start() invokes onStarted, which broadcasts recording-started, so
  // we do not broadcast inline here to avoid sending the message twice.
  app.post('/api/recordings', (_req, res) => {
    const rec = controller.start()
    res.json(rec)
  })

  // REST: rename a recording
  app.patch('/api/recordings/:id', (req, res) => {
    const { name } = req.body ?? {}
    if (typeof name !== 'string' || !name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    if (!store.getRecording(req.params.id)) {
      res.status(404).json({ error: 'Recording not found' })
      return
    }
    // Names are unique. Reject a clash with a different recording up front so the
    // client gets a clean 409 rather than a raw SQLite constraint error.
    const clash = store.getRecordingByName(name)
    if (clash && clash.id !== req.params.id) {
      res.status(409).json({ error: 'A recording with that name already exists' })
      return
    }
    store.renameRecording(req.params.id, name)
    res.json(store.getRecording(req.params.id))
  })

  // REST: stop the active recording (controller's onStopped broadcasts)
  app.post('/api/recordings/:id/stop', (_req, res) => {
    controller.stop()
    res.json({ ok: true })
  })

  // REST: delete a recording and its requests
  app.delete('/api/recordings/:id', (req, res) => {
    store.deleteRecording(req.params.id)
    res.json({ ok: true })
  })

  // REST: distinct hosts + content-types for a recording
  app.get('/api/recordings/:id/facets', (req, res) => {
    res.json(store.facets(req.params.id))
  })

  // REST: persisted filter selections for a recording
  app.get('/api/recordings/:id/filters', (req, res) => {
    res.json(store.getFilterState(req.params.id))
  })

  app.put('/api/recordings/:id/filters', (req, res) => {
    const body = req.body
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'filters must be an object' })
      return
    }
    store.setFilterState(req.params.id, body)
    res.json({ ok: true })
  })

  // REST: get requests with optional filtering, scoped to a recording
  app.get('/api/requests', (req, res) => {
    const filters = parseFilters(req.query as Record<string, unknown>)
    const recordingId = typeof req.query.recordingId === 'string' ? req.query.recordingId : undefined
    const filterPlugins = registry.getFilterPlugins()
    res.json(store.query(filters, filterPlugins, recordingId))
  })

  // REST: export with a given plugin, scoped + named to a recording
  app.get('/api/export/:pluginId', async (req, res) => {
    const plugin = registry.getPlugin(req.params.pluginId)
    if (!plugin || plugin.type !== 'export') {
      res.status(404).json({ error: 'Export plugin not found' })
      return
    }

    const recordingId = typeof req.query.recordingId === 'string' ? req.query.recordingId : undefined
    const recording = recordingId ? store.getRecording(recordingId) : undefined
    if (!recording) {
      res.status(404).json({ error: 'Recording not found' })
      return
    }

    const filters = parseFilters(req.query as Record<string, unknown>)
    const filterPlugins = registry.getFilterPlugins()
    const entries = store.query(filters, filterPlugins, recording.id)
    const result = await plugin.export(entries, {
      filters,
      recording: { id: recording.id, name: recording.name },
    })

    const filename = `${sanitizeFilename(recording.name)}.${plugin.fileExtension}`
    res.setHeader('Content-Type', plugin.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(result)
  })

  // REST: clear all requests
  app.delete('/api/requests', (_req, res) => {
    store.clear()
    res.json({ ok: true })
  })

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(uiDist, 'index.html'))
  })

  const httpServer = createServer(app)
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

  function broadcast(data: unknown) {
    const msg = JSON.stringify(data)
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    })
  }

  // Recording lifecycle => WS events. Start is also broadcast from the POST
  // route; onStarted covers any other start path, onStopped covers browser-exit
  // and UI Stop (the controller invokes onStopped, the route does not).
  controller.onStarted(rec => broadcast({ type: 'recording-started', data: rec }))
  controller.onStopped(rec => broadcast({ type: 'recording-stopped', data: rec }))

  return { httpServer, broadcast }
}
