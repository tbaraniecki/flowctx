import Database from 'better-sqlite3'
import { v4 as uuidv4 } from 'uuid'
import type { CapturedRequest, FilterOptions, FilterPlugin, Recording } from '../types.js'
import { migrate } from './migrate.js'
import { requestKey } from '../requestKey.js'

export class RequestStore {
  private db: Database.Database

  constructor(dbPath = 'requests.db', options: { readonly?: boolean } = {}) {
    if (options.readonly) {
      // A readonly connection cannot migrate; it assumes the app server (the
      // writer) has already migrated and established WAL mode.
      this.db = new Database(dbPath, { readonly: true })
    } else {
      this.db = new Database(dbPath)
      // Establish WAL mode before migrating so separate reader processes (e.g.
      // the MCP server) can read concurrently with this writer.
      this.db.pragma('journal_mode = WAL')
      migrate(this.db)
    }
  }

  insert(req: CapturedRequest, recordingId?: string): void {
    const resolvedRecordingId = recordingId ?? req.recordingId ?? null

    // order_id reflects request *initiation* order (the proxy's monotonic
    // sequence, assigned at request start). Preserve an existing row's value on
    // re-insert (INSERT OR REPLACE); otherwise take the captured orderId. Fall
    // back to completion-order MAX+1 only when no orderId was supplied (e.g.
    // direct inserts in tests).
    const orderRow = this.db
      .prepare(
        `SELECT COALESCE(
           (SELECT order_id FROM requests WHERE id = @id),
           @order_id,
           (SELECT COALESCE(MAX(order_id), 0) + 1 FROM requests WHERE recording_id = @recording_id)
         ) AS order_id`
      )
      .get({ id: req.id, recording_id: resolvedRecordingId, order_id: req.orderId ?? null }) as {
      order_id: number
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO requests
        (id, timestamp, method, host, path, url, http_version, request_headers, request_body,
         status_code, status_text, response_headers, response_body, timings, recording_id, order_id)
      VALUES
        (@id, @timestamp, @method, @host, @path, @url, @http_version, @request_headers, @request_body,
         @status_code, @status_text, @response_headers, @response_body, @timings, @recording_id, @order_id)
    `)
    stmt.run({
      id: req.id,
      timestamp: req.timestamp,
      method: req.method,
      host: req.host,
      path: req.path,
      url: req.url,
      http_version: req.httpVersion,
      request_headers: JSON.stringify(req.requestHeaders),
      request_body: req.requestBody ?? null,
      status_code: req.statusCode ?? null,
      status_text: req.statusText ?? null,
      response_headers: req.responseHeaders ? JSON.stringify(req.responseHeaders) : null,
      response_body: req.responseBody ?? null,
      timings: JSON.stringify(req.timings),
      recording_id: resolvedRecordingId,
      order_id: orderRow.order_id,
    })
  }

  private rowToRequest(row: any): CapturedRequest {
    return {
      id: row.id,
      timestamp: row.timestamp,
      method: row.method,
      host: row.host,
      path: row.path,
      url: row.url,
      httpVersion: row.http_version,
      requestHeaders: JSON.parse(row.request_headers),
      requestBody: row.request_body ?? undefined,
      statusCode: row.status_code ?? undefined,
      statusText: row.status_text ?? undefined,
      responseHeaders: row.response_headers ? JSON.parse(row.response_headers) : undefined,
      responseBody: row.response_body ?? undefined,
      timings: JSON.parse(row.timings),
      recordingId: row.recording_id ?? undefined,
      orderId: row.order_id ?? undefined,
    }
  }

  query(filters: FilterOptions, filterPlugins: FilterPlugin[], recordingId?: string): CapturedRequest[] {
    const rows = recordingId
      ? this.db
          .prepare('SELECT * FROM requests WHERE recording_id = ? ORDER BY timestamp ASC')
          .all(recordingId) as any[]
      : this.db.prepare('SELECT * FROM requests ORDER BY timestamp ASC').all() as any[]

    let entries: CapturedRequest[] = rows.map(row => this.rowToRequest(row))

    for (const [key, values] of Object.entries(filters)) {
      if (!values || values.length === 0) continue

      if (key === 'domains') {
        entries = entries.filter(req => values.some(d => req.host.includes(d)))
      } else if (key === 'paths') {
        entries = entries.filter(req => values.some(p => req.path.startsWith(p)))
      } else {
        const plugin = filterPlugins.find(fp => fp.filterKey === key)
        if (plugin) {
          if (plugin.mode === 'exclude') {
            entries = entries.filter(req => !plugin.match(req, values))
          } else {
            entries = entries.filter(req => plugin.match(req, values))
          }
        }
      }
    }

    return entries
  }

  // Full-text-ish search over a recording's request/response bodies and headers.
  // Substring mode (default) prefilters in SQL via LIKE over only the named
  // columns; regex mode loads all the recording's rows and lets the handler
  // scan. Either way the MCP handler refines hits into snippets.
  search(
    recordingId: string,
    opts: {
      query: string
      in?: ('requestBody' | 'responseBody' | 'requestHeaders' | 'responseHeaders')[]
      regex?: boolean
    }
  ): CapturedRequest[] {
    if (opts.regex) {
      const rows = this.db
        .prepare('SELECT * FROM requests WHERE recording_id = ? ORDER BY order_id ASC, timestamp ASC')
        .all(recordingId) as any[]
      return rows.map(row => this.rowToRequest(row))
    }

    const fieldToColumn: Record<string, string> = {
      requestBody: 'request_body',
      responseBody: 'response_body',
      requestHeaders: 'request_headers',
      responseHeaders: 'response_headers',
    }
    const fields = opts.in && opts.in.length > 0 ? opts.in : (Object.keys(fieldToColumn) as typeof opts.in)!
    const columns = fields.map(f => fieldToColumn[f])

    // Escape LIKE wildcards (and the escape char itself) so the query is a
    // literal substring. ESCAPE '\' below makes '\' the escape character.
    const escaped = opts.query.replace(/[\\%_]/g, ch => `\\${ch}`)
    const likeParam = `%${escaped}%`

    const where = columns.map(c => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')
    const sql = `SELECT * FROM requests WHERE recording_id = ? AND (${where}) ORDER BY order_id ASC, timestamp ASC`
    const rows = this.db.prepare(sql).all(recordingId, ...columns.map(() => likeParam)) as any[]
    return rows.map(row => this.rowToRequest(row))
  }

  getById(id: string): CapturedRequest | undefined {
    const row = this.db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as any
    if (!row) return undefined
    return this.rowToRequest(row)
  }

  listSlim(recordingId: string): {
    id: string
    orderId?: number
    method: string
    url: string
    path: string
    statusCode?: number
    contentType?: string
    requestKey: string
  }[] {
    const rows = this.db
      .prepare(
        'SELECT id, order_id, method, url, path, status_code, host, response_headers FROM requests WHERE recording_id = ? ORDER BY order_id ASC, timestamp ASC'
      )
      .all(recordingId) as any[]

    return rows.map(row => {
      let contentType: string | undefined
      if (row.response_headers) {
        try {
          const headers = JSON.parse(row.response_headers) as Record<string, string>
          for (const [key, value] of Object.entries(headers)) {
            if (key.toLowerCase() === 'content-type' && typeof value === 'string') {
              contentType = value
              break
            }
          }
        } catch {
          // ignore malformed headers
        }
      }
      return {
        id: row.id,
        orderId: row.order_id ?? undefined,
        method: row.method,
        url: row.url,
        path: row.path,
        statusCode: row.status_code ?? undefined,
        contentType,
        requestKey: requestKey(row.method, row.host, row.path),
      }
    })
  }

  createRecording(name: string): Recording {
    const recording: Recording = {
      id: uuidv4(),
      // Names are unique; if the requested one is taken (e.g. two recordings
      // started in the same second share the default date-time name), suffix it.
      name: this.uniqueName(name),
      createdAt: new Date().toISOString(),
      stoppedAt: undefined,
    }
    this.db
      .prepare('INSERT INTO recordings (id, name, created_at, stopped_at) VALUES (?, ?, ?, ?)')
      .run(recording.id, recording.name, recording.createdAt, null)
    return recording
  }

  // Return `name` if free, else the first available `name (2)`, `name (3)`, …
  private uniqueName(name: string): string {
    if (!this.getRecordingByName(name)) return name
    for (let n = 2; ; n++) {
      const candidate = `${name} (${n})`
      if (!this.getRecordingByName(candidate)) return candidate
    }
  }

  listRecordings(): (Recording & { count: number })[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.name, r.created_at, r.stopped_at, COUNT(req.id) as count
         FROM recordings r
         LEFT JOIN requests req ON req.recording_id = r.id
         GROUP BY r.id
         ORDER BY r.created_at ASC`
      )
      .all() as any[]
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      stoppedAt: row.stopped_at ?? undefined,
      count: row.count,
    }))
  }

  getRecording(id: string): Recording | undefined {
    const row = this.db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as any
    if (!row) return undefined
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      stoppedAt: row.stopped_at ?? undefined,
    }
  }

  // Resolve a recording by its (unique) name — a stable identifier the MCP
  // server can use interchangeably with the id.
  getRecordingByName(name: string): Recording | undefined {
    const row = this.db
      .prepare('SELECT * FROM recordings WHERE name = ?')
      .get(name) as any
    if (!row) return undefined
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      stoppedAt: row.stopped_at ?? undefined,
    }
  }

  renameRecording(id: string, name: string): void {
    this.db.prepare('UPDATE recordings SET name = ? WHERE id = ?').run(name, id)
  }

  stopRecording(id: string): void {
    this.db
      .prepare('UPDATE recordings SET stopped_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id)
  }

  deleteRecording(id: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM requests WHERE recording_id = ?').run(id)
      this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id)
    })
    tx()
  }

  facets(recordingId: string): { hosts: string[]; contentTypes: string[] } {
    const hostRows = this.db
      .prepare('SELECT DISTINCT host FROM requests WHERE recording_id = ? AND host IS NOT NULL ORDER BY host ASC')
      .all(recordingId) as any[]
    const hosts = hostRows.map(row => row.host as string)

    const headerRows = this.db
      .prepare('SELECT response_headers FROM requests WHERE recording_id = ? AND response_headers IS NOT NULL')
      .all(recordingId) as any[]
    const contentTypeSet = new Set<string>()
    for (const row of headerRows) {
      let headers: Record<string, string>
      try {
        headers = JSON.parse(row.response_headers)
      } catch {
        continue
      }
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'content-type' && typeof value === 'string') {
          contentTypeSet.add(value)
        }
      }
    }
    const contentTypes = Array.from(contentTypeSet).sort()

    return { hosts, contentTypes }
  }

  getFilterState(recordingId: string): FilterOptions {
    const row = this.db
      .prepare('SELECT filters FROM filter_state WHERE recording_id = ?')
      .get(recordingId) as { filters: string } | undefined
    if (!row) return {}
    try {
      return JSON.parse(row.filters) as FilterOptions
    } catch {
      return {}
    }
  }

  setFilterState(recordingId: string, filters: FilterOptions): void {
    this.db
      .prepare(
        `INSERT INTO filter_state (recording_id, filters) VALUES (?, ?)
         ON CONFLICT(recording_id) DO UPDATE SET filters = excluded.filters`
      )
      .run(recordingId, JSON.stringify(filters))
  }

  clear(): void {
    this.db.exec('DELETE FROM requests')
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM requests').get() as { count: number }
    return row.count
  }
}
