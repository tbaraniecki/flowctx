# flowctx

**A local, browser-based devtools "Network tab" that you own — capture HTTP(S)
traffic from any app on your Mac, keep it across sessions, filter it, and feed it
to your tools (or an AI).**

When you debug an API, the browser DevTools Network tab is great until you close
the tab and it's gone. flowctx is a small macOS dev tool that records
HTTP(S) traffic through a local man-in-the-middle proxy and keeps it in a SQLite
database, so you can come back to a capture later, search it, filter it, and
export it.

It gives you:

- **Persistent capture** — every request/response (with timing breakdown) is
  stored locally in SQLite, grouped into named **recordings** (capture sessions)
  you can revisit, rename, and delete.
- **A real-time browser UI** (React + Vite) — requests stream in live over a
  WebSocket while you browse; filter by domain, path, or file extension, inspect
  headers/bodies, and sort.
- **Extensible export & filtering via plugins** — built-in HAR / JSON / CSV
  export and domain/path/extension filters; add your own format or filter by
  dropping a single file in `./plugins/` (auto-discovered, no registration).
- **An MCP server** — exposes the captured traffic to an AI client (Claude
  Desktop, Claude Code, …) as read-only, queryable data, so you can ask an agent
  to dig through what your app actually sent and received. See
  [`MCP_AGENT_GUIDE.md`](./MCP_AGENT_GUIDE.md).

**Who it's for:** developers debugging API integrations, reverse-engineering an
undocumented endpoint, or capturing a reproducible trace of what an app does on
the wire — all on their own machine.

It is a **local development tool**: traffic is recorded only after you explicitly
start a recording in a separate, isolated Chrome profile that you point at the
proxy. Nothing is captured from your normal browser, and nothing leaves your
machine. Because it uses a MITM proxy with a CA you trust on your own system,
only use it on your own machine and your own traffic.

Technical summary: intercepts HTTP/HTTPS via a MITM proxy, stores requests in
SQLite, and serves a React browser UI for inspection and export. macOS only;
TypeScript end to end, no Python runtime dependency.

## Quick Start

```bash
make install    # Install npm dependencies
make setup      # Trust mitmproxy certificate (one-time, requires sudo)
make start      # Start proxy + UI server, open the UI in Chrome (unproxied)
make record     # Open a proxied Chrome (fresh profile) to capture traffic
```

Then:
1. `make start` launches the proxy + UI server and opens the UI in Chrome at `http://localhost:5173` (unproxied — the UI's own requests aren't recorded)
2. With `make start` still running, run `make record` to open a separate Chrome with proxy `127.0.0.1:8080` preconfigured (fresh `~/.flowctx/chrome-profile`)
3. Browse in the recording window — requests appear in the UI in real-time
4. Filter by domain, path, file extension (all extensible)
5. Export as HAR, JSON, CSV, or custom formats

## Architecture

```
flowctx/
├── src/
│   ├── index.ts              # Main entry point: wires proxy + server
│   ├── types.ts              # CapturedRequest, Plugin interfaces
│   ├── proxy/
│   │   ├── index.ts          # ProxyServer (http-mitm-proxy wrapper)
│   │   └── cert.ts           # Certificate generation + macOS keychain trust
│   ├── storage/
│   │   └── index.ts          # SQLite store (better-sqlite3)
│   ├── server/
│   │   └── index.ts          # Express API + WebSocket
│   └── plugins/
│       ├── types.ts          # Plugin interface definitions
│       ├── registry.ts       # PluginRegistry (loads built-ins + ./plugins/)
│       └── builtin/
│           ├── har.ts        # HAR 1.2 export
│           ├── json.ts       # JSON export
│           ├── csv.ts        # CSV export
│           └── filters/
│               ├── domain.ts # Filter by host substring
│               ├── path.ts   # Filter by path prefix
│               └── extension.ts # Filter by file extension
├── ui/
│   ├── index.html
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx           # Main React component
│       ├── hooks/
│       │   └── useWebSocket.ts
│       └── components/
│           ├── FilterBar.tsx
│           ├── RequestTable.tsx
│           ├── DetailPanel.tsx
│           └── ExportMenu.tsx
├── package.json
├── tsconfig.json
└── Makefile
```

## How it Works

### Request Flow
1. **Proxy** (`port 8080`): Intercepts HTTP/HTTPS traffic via `http-mitm-proxy`
2. **Storage**: Each request is persisted to SQLite with timing breakdown (send/wait/receive/total)
3. **WebSocket**: New requests broadcast to all connected browsers in real-time
4. **UI Filters**: Applied client-side against the full request list
5. **Export**: Serialized via registered ExportPlugins

### Timing Breakdown
Each request includes millisecond-precision timings:
- `send`: Time to send request body
- `wait`: Time waiting for server response (TTFB)
- `receive`: Time to download response body
- `total`: Sum of all three

Exported in HAR format as `startedDateTime` + `timings` object per entry.

### Multi-Value Filters
All filters are **AND-combined** (request must match all active filters). Within each filter dimension, values are **OR-combined**:

```
Filter: domains=[api.example.com, cdn.example.com], extensions=[.js, .css]
→ Matches: (host contains "api.example.com" OR "cdn.example.com") AND (ext is .js OR .css)
```

## Plugin System

### Creating an Export Plugin

Drop a file in `./plugins/my-plugin.ts`:

```typescript
import { ExportPlugin } from '../src/plugins/types'

export default {
  id: 'export-postman',
  name: 'Postman',
  type: 'export',
  fileExtension: 'json',
  mimeType: 'application/json',

  async export(entries, filters) {
    // Transform entries to Postman collection format
    return JSON.stringify({
      info: { name: 'Recorded Requests' },
      item: entries.map(req => ({
        name: req.host + req.path,
        request: {
          method: req.method,
          url: req.url,
          header: Object.entries(req.requestHeaders || {}).map(([key, value]) => ({
            key,
            value,
          })),
          body: req.requestBody ? { raw: req.requestBody } : undefined,
        },
      })),
    })
  },
} as ExportPlugin
```

**Auto-discovered on startup** — no registration needed.

### Creating a Filter Plugin

Drop a file in `./plugins/filter-custom.ts`:

```typescript
import { FilterPlugin } from '../src/plugins/types'

export default {
  id: 'filter-status',
  name: 'Status Code',
  type: 'filter',
  filterKey: 'statusCodes',

  match(request, values) {
    if (!request.statusCode) return false
    return values.includes(String(request.statusCode))
  },

  ui: {
    label: 'Status Codes',
    placeholder: '200, 404, 500...',
  },
} as FilterPlugin
```

**Auto-discovered on startup** — appears in FilterBar UI immediately.

## API Endpoints

- `GET /api/plugins` — List all registered plugins (metadata only)
- `GET /api/requests?domains=api.example&paths=/api&extensions=.js` — Fetch requests with filters
- `GET /api/export/:pluginId` — Download export file (query string applies filters)
- `DELETE /api/requests` — Clear all recorded requests
- `WS /ws` — WebSocket for real-time request broadcast

## Filtering on the Server

Filters are applied server-side before export, client-side for UI sorting. Query params:
- `?domains=api.example,cdn.example` — comma-separated, matches host substring
- `?paths=/api,/v2` — comma-separated, matches path prefix
- `?extensions=.js,.css` — comma-separated, matches file extension
- Custom filters added via FilterPlugin use `filterKey` in query string

## Development

### Rebuild on file change
```bash
npm run dev:server   # tsx watch src/index.ts
npm run dev:ui       # vite --config ui/vite.config.ts
npm run dev          # both concurrently
```

### Type checking
```bash
npx tsc --noEmit
```

## Configuration

Certificate is generated on first `make setup` and stored in `~/.mitmproxy/`. On macOS, it's automatically added to the system keychain to avoid browser warnings.

Database file: `./requests.db` (SQLite, auto-created)

## MCP server

A standalone stdio [MCP](https://modelcontextprotocol.io) server exposes the
recorded-request database to an AI client (Claude Desktop, Claude Code, etc.). It
runs as a **separate, read-only process** alongside the app server: the writer
opens the DB in WAL mode so the MCP reader can query concurrently without
blocking capture.

**No build step.** The server runs straight from source with `tsx` — the same
`requests.db` that `make start` populates. Just register it with your MCP client
(e.g. Claude Desktop / Claude Code config); the client launches it on demand:

```json
{
  "mcpServers": {
    "flowctx": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/flowctx/src/mcp/index.ts"],
      "env": { "DB_PATH": "/ABSOLUTE/PATH/TO/flowctx/requests.db" }
    }
  }
}
```

`DB_PATH` defaults to `./requests.db` if omitted. (`npm run mcp` runs the same
entry with `--env-file-if-exists=.env`.) See [`MCP_AGENT_GUIDE.md`](./MCP_AGENT_GUIDE.md)
for the full agent-facing guide.

### Tools

- **`list_recordings`** (no args) — every recording with id, name, request count,
  and timestamps. Start here to pick a `recordingId`.
- **`list_requests`** `{ recordingId? | recordingName?, filters? }` — slim request
  index (order first; no bodies, no full headers; each row carries a `requestKey`).
  Identify the recording by `recordingId` **or** `recordingName` (names are unique) —
  supply exactly one. Defaults to the filters the UI persisted for the recording
  unless `filters` are supplied.
- **`get_request`** `{ id, fields? }` — full record for one request, including headers
  and bodies (each body capped at 1 MB, with a `*Truncated` flag + original length
  when cut) and a derived `fileType`. Pass `fields` (JSON dot-paths, e.g.
  `["data.id", "items[0].name"]`) to project just those values out of JSON bodies
  instead of returning the raw bodies — a big token saver.
- **`get_facets`** `{ recordingId }` — distinct hosts and content-types, so the AI
  knows which filter values are available.
- **`search_requests`** `{ recordingId, query, in?, regex? }` — find requests whose
  body or headers contain `query` (substring, or a regex when `regex: true`).
  Returns slim rows plus a `matches` array (which field matched + a snippet around
  the hit). Use it to locate a request by its content (e.g. an auth token) without
  reading every request. Narrow with `in: ["requestBody"|"responseBody"|"requestHeaders"|"responseHeaders"]`.
- **`diff_requests`** `{ idA, idB }` — structurally diff two requests: method / path /
  status, the JSON request & response bodies, and the header maps (case-insensitive).
  Returns `{ added, removed, changed }` in dot-path notation.

Typical workflow: `list_recordings` → `list_requests` (or `search_requests` to find
the id) → `get_request` by id; `diff_requests` to compare two.

### Exported identifiers (round-tripping)

Every export embeds the recording and request identifiers so another tool — or an
AI via the MCP server — can map an exported entry back to the live DB:

- **HAR** — `log._recordingId` / `log._recordingName`, and per entry `_requestId` /
  `_orderId` (HAR 1.2 custom `_`-prefixed fields, ignored by normal HAR viewers).
- **JSON** — `{ recording: { id, name }, entries: [...] }`; each entry carries `id`
  and `orderId`.
- **CSV** — `id,timestamp,method,host,path,statusCode,totalMs,orderId,recordingId`
  (`orderId`/`recordingId` appended so existing positional parsers keep working).

Feed a HAR `_requestId` (or CSV `id`) straight into `get_request({ id })`.

## Limitations & Future

- **macOS only** (tested on Intel/Apple Silicon) — `./src/proxy/cert.ts` uses `sudo security` for keychain
- **Certificate-based HTTPS** — Only works if certificate is trusted; custom CA required for client certificates in requests
- **No request filtering on proxy** — All traffic is recorded; filtering is UI/export-time only
- **No request/response modification** — Pure recording tool (could add via plugin pattern)

## License

MIT
