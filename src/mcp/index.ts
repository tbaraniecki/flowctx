import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { RequestStore } from '../storage/index.js'
import { loadPlugins, registry } from '../plugins/registry.js'
import { projectPaths } from '../jsonPath.js'
import { requestKey } from '../requestKey.js'
import type { CapturedRequest } from '../types.js'

const BODY_CAP = 1024 * 1024 // 1 MB per body

// Find a header value case-insensitively.
function headerValue(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target && typeof value === 'string') return value
  }
  return undefined
}

// Derive a file type from the response content-type, else the path extension.
function deriveFileType(req: CapturedRequest): string | null {
  const contentType = headerValue(req.responseHeaders, 'content-type')
  if (contentType) return contentType.split(';')[0].trim()
  const lastSegment = req.path.split('/').pop() ?? ''
  const cleanSegment = lastSegment.split('?')[0]
  const dot = cleanSegment.lastIndexOf('.')
  if (dot > 0 && dot < cleanSegment.length - 1) return cleanSegment.slice(dot + 1)
  return null
}

function ok(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
}

function fail(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] }
}

// Cap on the total number of diffs reported by diff_requests.
const MAX_DIFFS = 200

// Build a ±60-char snippet around [start, end) in `text`, clamping to bounds and
// marking truncation with an ellipsis.
function snippetAround(text: string, start: number, end: number): string {
  const PAD = 60
  const from = Math.max(0, start - PAD)
  const to = Math.min(text.length, end + PAD)
  const prefix = from > 0 ? '…' : ''
  const suffix = to < text.length ? '…' : ''
  return `${prefix}${text.slice(from, to)}${suffix}`
}

// Recursively enumerate leaf-path differences between two JSON-ish values into
// added (only in b) / removed (only in a) / changed. Distinct from getPath
// (which reads ONE known path); this enumerates leaves.
function diffValues(
  a: unknown,
  b: unknown,
  prefix: string,
  out: { added: string[]; removed: string[]; changed: { path: string; a: unknown; b: unknown }[] }
): void {
  const aMissing = a === undefined
  const bMissing = b === undefined
  if (aMissing && bMissing) return
  if (aMissing) {
    out.added.push(prefix)
    return
  }
  if (bMissing) {
    out.removed.push(prefix)
    return
  }

  const aObj = a !== null && typeof a === 'object'
  const bObj = b !== null && typeof b === 'object'

  if (aObj && bObj) {
    const aRec = a as Record<string, unknown>
    const bRec = b as Record<string, unknown>
    const keys = new Set([...Object.keys(aRec), ...Object.keys(bRec)])
    for (const key of keys) {
      const path = prefix ? `${prefix}.${key}` : key
      diffValues(aRec[key], bRec[key], path, out)
    }
    return
  }

  // At least one side is a primitive (or object-vs-primitive mismatch).
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    out.changed.push({ path: prefix, a, b })
  }
}

// Structural diff of two captured requests: method/path/status, JSON bodies, and
// header maps (case-insensitive). Shared by diff_requests and correlate.
function computeDiff(a: CapturedRequest, b: CapturedRequest) {
  const out = {
    added: [] as string[],
    removed: [] as string[],
    changed: [] as { path: string; a: unknown; b: unknown }[],
  }

  for (const field of ['method', 'path', 'statusCode'] as const) {
    if (a[field] !== b[field]) out.changed.push({ path: field, a: a[field], b: b[field] })
  }

  // JSON bodies: parse when possible, else fall back to whole-string compare.
  const diffBody = (raw1: string | undefined, raw2: string | undefined, prefix: string) => {
    let parsed = false
    let v1: unknown
    let v2: unknown
    try {
      v1 = raw1 === undefined ? undefined : JSON.parse(raw1)
      v2 = raw2 === undefined ? undefined : JSON.parse(raw2)
      parsed = true
    } catch {
      parsed = false
    }
    if (parsed) {
      diffValues(v1, v2, prefix, out)
    } else if (raw1 !== raw2) {
      out.changed.push({ path: prefix, a: raw1, b: raw2 })
    }
  }
  diffBody(a.requestBody, b.requestBody, 'requestBody')
  diffBody(a.responseBody, b.responseBody, 'responseBody')

  // Header maps: case-insensitive over the union of lower-cased keys.
  const diffHeaders = (
    h1: Record<string, string> | undefined,
    h2: Record<string, string> | undefined,
    prefix: string
  ) => {
    const keys = new Set<string>()
    for (const k of Object.keys(h1 ?? {})) keys.add(k.toLowerCase())
    for (const k of Object.keys(h2 ?? {})) keys.add(k.toLowerCase())
    for (const k of keys) {
      const va = headerValue(h1, k)
      const vb = headerValue(h2, k)
      const path = `${prefix}.${k}`
      if (va === vb) continue
      if (va === undefined) out.added.push(path)
      else if (vb === undefined) out.removed.push(path)
      else out.changed.push({ path, a: va, b: vb })
    }
  }
  diffHeaders(a.requestHeaders, b.requestHeaders, 'requestHeaders')
  diffHeaders(a.responseHeaders, b.responseHeaders, 'responseHeaders')

  return out
}

// Header names that change every run for transport reasons, not correlation —
// dropped from correlate's candidate list. Auth/cookie/csrf headers are kept.
const VOLATILE_HEADERS = new Set([
  'date',
  'content-length',
  // Cookies are carried automatically by k6's CookieJar, not hand-correlated in
  // scenarios (CSRF comes from an HTML meta tag), and the jar is mostly analytics
  // noise — drop it so real body/token correlation surfaces.
  'cookie',
  'set-cookie',
  'etag',
  'last-modified',
  'expires',
  'age',
  'x-runtime',
  'x-request-id',
  'x-amzn-trace-id',
  'cf-ray',
  'x-served-by',
  'report-to',
  'nel',
])

// True for diff paths that are noise rather than correlation signal.
function isVolatilePath(path: string): boolean {
  const m = /^(?:requestHeaders|responseHeaders)\.(.+)$/.exec(path)
  if (m) return VOLATILE_HEADERS.has(m[1].toLowerCase())
  return false
}

// Compact a diff value for display so correlate output stays small.
function truncValue(v: unknown): unknown {
  if (v === undefined) return undefined
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 120 ? `${s.slice(0, 120)}…` : s
}

async function main() {
  // The MCP server is a separate, read-only process running concurrently with
  // the app server (the writer). It never migrates.
  const store = new RequestStore(process.env.DB_PATH ?? 'requests.db', { readonly: true })

  // Needed so registry.getFilterPlugins() can resolve plugin-defined filters.
  await loadPlugins()

  const server = new McpServer({ name: 'flowctx', version: '0.1.0' })

  server.registerTool(
    'list_recordings',
    {
      description:
        'List all recordings (id, name, request count, timestamps). Use this first to pick a ' +
        'recording. You can then call list_requests with either its recordingId or its ' +
        'recordingName (names are unique).',
    },
    async () => {
      try {
        return ok(store.listRecordings())
      } catch (e) {
        return fail(`Failed to list recordings: ${(e as Error).message}`)
      }
    }
  )

  server.registerTool(
    'list_requests',
    {
      description:
        'Slim index of requests for a recording (order first; no bodies, no full headers). ' +
        'Identify the recording by recordingId OR recordingName (names are unique) — ' +
        'supply exactly one. ' +
        'Defaults to the same filters the UI persisted for the recording unless filters are provided.',
      inputSchema: {
        recordingId: z.string().optional(),
        recordingName: z.string().optional(),
        filters: z.record(z.string(), z.array(z.string())).optional(),
      },
    },
    async ({ recordingId, recordingName, filters }) => {
      try {
        // Resolve name -> id up front so every downstream call uses one id.
        let id = recordingId
        if (!id && recordingName) {
          const rec = store.getRecordingByName(recordingName)
          if (!rec) return fail(`No recording found with name "${recordingName}"`)
          id = rec.id
        }
        if (!id) return fail('Provide recordingId or recordingName')

        const f = filters ?? store.getFilterState(id)
        if (f && Object.keys(f).length > 0) {
          const entries = store.query(f, registry.getFilterPlugins(), id)
          const slim = entries
            .map(req => ({
              orderId: req.orderId,
              id: req.id,
              method: req.method,
              url: req.url,
              path: req.path,
              statusCode: req.statusCode,
              contentType: headerValue(req.responseHeaders, 'content-type'),
              requestKey: requestKey(req.method, req.host, req.path),
            }))
            .sort((a, b) => (a.orderId ?? 0) - (b.orderId ?? 0))
          return ok(slim)
        }
        return ok(store.listSlim(id))
      } catch (e) {
        return fail(`Failed to list requests: ${(e as Error).message}`)
      }
    }
  )

  server.registerTool(
    'get_request',
    {
      description:
        'Full record for a single request by id, including headers and bodies (bodies capped at 1 MB). ' +
        'Use list_requests to find the id. Pass `fields` (dot-paths, e.g. ["data.id", "items[0].name"]) ' +
        'to project only those values out of JSON bodies instead of returning the raw bodies — a big token saver.',
      inputSchema: { id: z.string(), fields: z.array(z.string()).optional() },
    },
    async ({ id, fields }) => {
      try {
        const req = store.getById(id)
        if (!req) return fail(`No request found with id ${id}`)

        const result: Record<string, unknown> = {
          ...req,
          fileType: deriveFileType(req),
        }

        if (fields && fields.length > 0) {
          // Projection path: pull only the requested fields out of JSON bodies
          // and drop the raw bodies to save tokens.
          if (req.requestBody) {
            try {
              const parsed = JSON.parse(req.requestBody)
              result.requestBodyFields = projectPaths(parsed, fields)
              delete result.requestBody
            } catch {
              // Non-JSON body can't be projected; drop it so a large raw body
              // doesn't slip through uncapped.
              delete result.requestBody
              result.requestBodyNote = 'body is not JSON; fields projection skipped'
            }
          }
          if (req.responseBody) {
            try {
              const parsed = JSON.parse(req.responseBody)
              result.responseBodyFields = projectPaths(parsed, fields)
              delete result.responseBody
            } catch {
              // Non-JSON body can't be projected; drop it so a large raw body
              // doesn't slip through uncapped.
              delete result.responseBody
              result.responseBodyNote = 'body is not JSON; fields projection skipped'
            }
          }
        } else {
          if (req.requestBody && req.requestBody.length > BODY_CAP) {
            result.requestBody = req.requestBody.slice(0, BODY_CAP)
            result.requestBodyTruncated = true
            result.requestBodyOriginalLength = req.requestBody.length
          }
          if (req.responseBody && req.responseBody.length > BODY_CAP) {
            result.responseBody = req.responseBody.slice(0, BODY_CAP)
            result.responseBodyTruncated = true
            result.responseBodyOriginalLength = req.responseBody.length
          }
        }

        return ok(result)
      } catch (e) {
        return fail(`Failed to get request: ${(e as Error).message}`)
      }
    }
  )

  server.registerTool(
    'get_facets',
    {
      description:
        'Distinct hosts and content-types for a recording. Use this to discover available filter values.',
      inputSchema: { recordingId: z.string() },
    },
    async ({ recordingId }) => {
      try {
        return ok(store.facets(recordingId))
      } catch (e) {
        return fail(`Failed to get facets: ${(e as Error).message}`)
      }
    }
  )

  server.registerTool(
    'search_requests',
    {
      description:
        'Find requests in a recording whose body or headers contain `query` (substring, or a regex ' +
        'when `regex:true`). Returns slim rows plus a `matches` array describing which field matched ' +
        'and a snippet around the hit. Use this to locate a request by its content (e.g. an auth token) ' +
        'without reading every request.',
      inputSchema: {
        recordingId: z.string(),
        query: z.string(),
        in: z
          .array(z.enum(['requestBody', 'responseBody', 'requestHeaders', 'responseHeaders']))
          .optional(),
        regex: z.boolean().optional(),
      },
    },
    async ({ recordingId, query, in: fieldsOpt, regex }) => {
      try {
        const fields =
          fieldsOpt && fieldsOpt.length > 0
            ? fieldsOpt
            : (['requestBody', 'responseBody', 'requestHeaders', 'responseHeaders'] as const)

        let re: RegExp | undefined
        if (regex) {
          try {
            re = new RegExp(query)
          } catch (e) {
            return fail(`Invalid regex: ${(e as Error).message}`)
          }
        }
        const lowerQuery = query.toLowerCase()

        const candidates = store.search(recordingId, { query, in: fieldsOpt, regex })

        // Raw text for a searched field: bodies are the raw string; header maps
        // are searched as their JSON-stringified text (matching how rows store them).
        const fieldText = (req: CapturedRequest, field: string): string | undefined => {
          switch (field) {
            case 'requestBody':
              return req.requestBody
            case 'responseBody':
              return req.responseBody
            case 'requestHeaders':
              return req.requestHeaders ? JSON.stringify(req.requestHeaders) : undefined
            case 'responseHeaders':
              return req.responseHeaders ? JSON.stringify(req.responseHeaders) : undefined
            default:
              return undefined
          }
        }

        const results = []
        for (const req of candidates) {
          const matches: { field: string; snippet: string }[] = []
          for (const field of fields) {
            const text = fieldText(req, field)
            if (!text) continue
            if (re) {
              re.lastIndex = 0
              const m = re.exec(text)
              if (m) matches.push({ field, snippet: snippetAround(text, m.index, m.index + m[0].length) })
            } else {
              const idx = text.toLowerCase().indexOf(lowerQuery)
              if (idx !== -1) matches.push({ field, snippet: snippetAround(text, idx, idx + query.length) })
            }
          }
          if (matches.length === 0) continue // drop LIKE false-positives / regex non-matches
          results.push({
            orderId: req.orderId,
            id: req.id,
            method: req.method,
            url: req.url,
            path: req.path,
            statusCode: req.statusCode,
            contentType: headerValue(req.responseHeaders, 'content-type'),
            requestKey: requestKey(req.method, req.host, req.path),
            matches,
          })
        }
        results.sort((a, b) => (a.orderId ?? 0) - (b.orderId ?? 0))
        return ok(results)
      } catch (e) {
        return fail(`Failed to search requests: ${(e as Error).message}`)
      }
    }
  )

  server.registerTool(
    'diff_requests',
    {
      description:
        'Structurally diff two requests (by id). Compares method / path / status, the JSON request & ' +
        'response bodies, and the header maps (case-insensitive). Returns `{ added, removed, changed }` ' +
        'with dot-path notation. Use after search_requests / list_requests to see what changed between ' +
        'two calls.',
      inputSchema: { idA: z.string(), idB: z.string() },
    },
    async ({ idA, idB }) => {
      try {
        const a = store.getById(idA)
        const b = store.getById(idB)
        if (!a) return fail(`No request found with id ${idA}`)
        if (!b) return fail(`No request found with id ${idB}`)

        const out = computeDiff(a, b)

        const total = out.added.length + out.removed.length + out.changed.length
        if (total > MAX_DIFFS) {
          // Truncate across the three buckets in order, keeping a stable cap.
          let budget = MAX_DIFFS
          const added = out.added.slice(0, budget)
          budget -= added.length
          const removed = out.removed.slice(0, budget)
          budget -= removed.length
          const changed = out.changed.slice(0, budget)
          return ok({ added, removed, changed, truncated: true })
        }
        return ok(out)
      } catch (e) {
        return fail(`Failed to diff requests: ${(e as Error).message}`)
      }
    }
  )

  server.registerTool(
    'correlate',
    {
      description:
        'Find correlated (dynamic) fields across two recordings of the SAME flow. Pairs each request ' +
        'in A with its counterpart in B by requestKey (the normalized METHOD HOST /path — repeated ' +
        'calls pair in order), then structurally diffs each pair. Fields that DIFFER between the two ' +
        'runs are correlation candidates (server-issued ids, tokens, GUIDs); fields that match are ' +
        'static and safe to hardcode-from-config. Volatile transport headers (date, content-length, ' +
        'trace ids, …) are filtered out. Returns per-pair dynamic fields plus unpaired requests. ' +
        'Identify each recording by id OR name. This is the anti-hallucination starting point for ' +
        'reverse-engineering a flow: record it twice with different data, then call correlate. ' +
        'Pass `hosts` (substrings, OR-combined) to scope to your app hosts and drop third-party ' +
        'browser noise (analytics, CDN, browser-update traffic) — strongly recommended.',
      inputSchema: {
        recordingA: z.string(),
        recordingB: z.string(),
        hosts: z.array(z.string()).optional(),
      },
    },
    async ({ recordingA, recordingB, hosts }) => {
      try {
        // Resolve a recording reference that may be an id or a (unique) name.
        const recordings = store.listRecordings()
        const resolve = (ref: string): { id: string; name: string } | undefined => {
          const byId = recordings.find(r => r.id === ref)
          if (byId) return { id: byId.id, name: byId.name }
          const byName = store.getRecordingByName(ref)
          if (byName) return { id: byName.id, name: byName.name }
          return undefined
        }
        const ra = resolve(recordingA)
        if (!ra) return fail(`No recording found with id or name "${recordingA}"`)
        const rb = resolve(recordingB)
        if (!rb) return fail(`No recording found with id or name "${recordingB}"`)

        // Optionally scope to app hosts (substring match on the request's host),
        // dropping third-party browser noise before pairing.
        const hostOf = (url: string): string => {
          try {
            return new URL(url).host
          } catch {
            return ''
          }
        }
        const scope = (rows: ReturnType<typeof store.listSlim>) =>
          hosts && hosts.length > 0
            ? rows.filter(r => {
                const h = hostOf(r.url)
                return hosts.some(want => h.includes(want))
              })
            : rows

        const slimA = scope(store.listSlim(ra.id))
        const slimB = scope(store.listSlim(rb.id))

        // Bucket B's requests by requestKey, preserving order, so the nth A call
        // with a given key pairs with the nth B call (handles repeated polls).
        const bByKey = new Map<string, typeof slimB>()
        for (const row of slimB) {
          const list = bByKey.get(row.requestKey) ?? []
          list.push(row)
          bByKey.set(row.requestKey, list)
        }

        const cursor = new Map<string, number>()
        const pairs: unknown[] = []
        const unpairedA: unknown[] = []

        for (const aRow of slimA) {
          const list = bByKey.get(aRow.requestKey)
          const idx = cursor.get(aRow.requestKey) ?? 0
          if (!list || idx >= list.length) {
            unpairedA.push({ orderId: aRow.orderId, requestKey: aRow.requestKey, path: aRow.path })
            continue
          }
          const bRow = list[idx]
          cursor.set(aRow.requestKey, idx + 1)

          const fa = store.getById(aRow.id)
          const fb = store.getById(bRow.id)
          if (!fa || !fb) continue

          const d = computeDiff(fa, fb)
          const dynamic: { where: string; a?: unknown; b?: unknown }[] = []
          for (const c of d.changed) {
            if (isVolatilePath(c.path)) continue
            dynamic.push({ where: c.path, a: truncValue(c.a), b: truncValue(c.b) })
          }
          for (const p of d.added) {
            if (isVolatilePath(p)) continue
            dynamic.push({ where: p, b: '<present in B only>' })
          }
          for (const p of d.removed) {
            if (isVolatilePath(p)) continue
            dynamic.push({ where: p, a: '<present in A only>' })
          }
          if (dynamic.length === 0) continue // identical pair = fully static, skip

          pairs.push({
            requestKey: aRow.requestKey,
            method: aRow.method,
            path: aRow.path,
            orderIdA: aRow.orderId,
            orderIdB: bRow.orderId,
            idA: aRow.id,
            idB: bRow.id,
            dynamic,
          })
        }

        // Requests present in B but never matched by an A request.
        const unpairedB: unknown[] = []
        for (const [key, list] of bByKey) {
          const used = cursor.get(key) ?? 0
          for (let i = used; i < list.length; i++) {
            unpairedB.push({ orderId: list[i].orderId, requestKey: key, path: list[i].path })
          }
        }

        return ok({
          recordingA: ra.name,
          recordingB: rb.name,
          pairsWithDynamicFields: pairs.length,
          pairs,
          unpairedA,
          unpairedB,
        })
      } catch (e) {
        return fail(`Failed to correlate recordings: ${(e as Error).message}`)
      }
    }
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  // stdout is reserved for the MCP protocol; log only to stderr.
  console.error(err)
  process.exit(1)
})
