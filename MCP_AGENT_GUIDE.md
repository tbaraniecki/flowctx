# flowctx MCP — Agent Guide

A guide for an AI agent (or the human wiring one up) to use the **flowctx**
MCP server. The server exposes HTTP(S) traffic captured by the proxy as read-only,
queryable data so an AI can inspect requests/responses while debugging.

You can paste the [**Agent instructions**](#agent-instructions-paste-into-a-system-prompt)
block below straight into an agent's system prompt.

---

## What it is

A **read-only** stdio MCP server over a SQLite database of recorded HTTP exchanges.
Traffic is grouped into **recordings** (capture sessions). Each request in a
recording has a stable, 1-based `orderId` reflecting capture/start order, plus a unique
`id`. It runs as a separate process from the recorder app and never modifies the DB.

## Setup (human)

No build step — the server runs straight from TypeScript source with `tsx`.
Register it with your MCP client; the client launches it on demand:

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

`DB_PATH` defaults to `./requests.db` if omitted. Run `make install` once so deps
exist, and the recorder app must have run at least once (`make start`) so the DB
exists and is migrated.

---

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `list_recordings` | — | `[{ id, name, count, createdAt, stoppedAt }]` |
| `list_requests` | `{ recordingId? \| recordingName?, filters? }` | slim index: `[{ orderId, id, method, url, path, statusCode, contentType, requestKey }]` |
| `get_request` | `{ id, fields? }` | full record (headers + bodies, see caps below), or projected `*BodyFields` when `fields` given |
| `get_facets` | `{ recordingId }` | `{ hosts: string[], contentTypes: string[] }` |
| `search_requests` | `{ recordingId, query, in?, regex? }` | slim rows that contain `query` in body/headers, each with a `matches` array (field + snippet) |
| `diff_requests` | `{ idA, idB }` | `{ added, removed, changed }` dot-path diff of two requests |
| `correlate` | `{ recordingA, recordingB, hosts? }` | per-pair dynamic (changed) fields across two recordings of the same flow + `unpairedA/B` — finds correlation candidates mechanically |

### Identifying a recording for `list_requests`
Supply **exactly one** of:
- `recordingId` — the recording's UUID.
- `recordingName` — the human-readable name shown in the UI.

Recording **names are unique**, so either identifier resolves to exactly one
recording — use whichever the user gives you. Passing neither (or an unknown name)
returns an error.

### `list_requests` filters
`filters` is `{ [filterKey]: string[] }`. If omitted, the server applies **the same
filters the UI has saved for that recording** (they persist across restarts). Pass
`filters: {}` to force *no* filtering. Built-in keys include `domains`, `paths`,
`extension`, `exclude-path`, `exclude-content-type`. Use `get_facets` to discover
valid `hosts`/`contentTypes` values first.

### `get_request` body handling
- `requestBody` / `responseBody` are each capped at **1 MB**. If truncated you'll see
  `requestBodyTruncated: true` / `responseBodyTruncated: true` plus the original length.
- A derived `fileType` is included (from the response `content-type`, else the path
  extension, else `null`).
- **`fields` projection** — pass `fields: ["data.id", "items[0].name", …]` (JSON
  dot/bracket paths) to pull only those leaves out of the JSON bodies. The raw bodies
  are dropped and replaced with `requestBodyFields` / `responseBodyFields`. A big token
  saver — prefer it when you know exactly what you need. Non-JSON bodies can't be
  projected (you'll get a `*BodyNote` instead).

### `search_requests` — find by content
`{ recordingId, query, in?, regex? }`. Searches request/response bodies and header maps
for `query` (substring by default; set `regex: true` to treat it as a JS regex). Narrow
the surface with `in` (any of `requestBody`, `responseBody`, `requestHeaders`,
`responseHeaders`). Returns slim rows (same shape as `list_requests`) plus a `matches`
array per row: `{ field, snippet }` with ±60 chars around each hit. Use this instead of
pulling every request when you're hunting for a value (an id, an auth token, an error
string).

### `diff_requests` — compare two requests
`{ idA, idB }`. Structurally diffs method / path / status, the JSON request & response
bodies, and the header maps (case-insensitive). Returns `{ added, removed, changed }`
where `added` = only in B, `removed` = only in A, `changed` = `{ path, a, b }`, all in
dot-path notation. Capped at 200 diffs (`truncated: true` when exceeded). Handy after
`search_requests` to see what changed between two otherwise-similar calls.

### `correlate` — find dynamic fields across two runs of the same flow
`{ recordingA, recordingB, hosts? }`. The anti-hallucination tool for reverse-engineering
a flow: **record it twice with different input data**, then `correlate` the two recordings.
It pairs each request in A with its counterpart in B by `requestKey` (the normalized
`METHOD HOST /path`, so the same logical call matches even though ids/tokens differ;
repeated calls pair in capture order), then structurally diffs each pair. Fields that
**differ** between the two runs are correlation candidates; fields that match are static
and safe to hardcode.

Returns:
```jsonc
{
  "recordingA": "...", "recordingB": "...",
  "pairsWithDynamicFields": 39,
  "pairs": [
    { "requestKey": "...", "method": "POST", "path": "...", "orderIdA": 166, "orderIdB": 156,
      "idA": "...", "idB": "...",
      "dynamic": [ { "where": "path", "a": ".../orders/item-<guidA>/...", "b": ".../orders/item-<guidB>/..." },
                   { "where": "responseBody.token", "a": "…", "b": "…" } ] } ],
  "unpairedA": [ { "orderId": 12, "requestKey": "...", "path": "..." } ],
  "unpairedB": [ … ]
}
```
Read each `dynamic.where`:
- `path` differs → an id/GUID lives in the **URL** (extract from a prior response, inject into the URL).
- `responseBody.*` differs → a **server-issued** value (token, GUID, decision) — a correlation source.
- `requestBody.*` differs → input data (→ data builder) or an injected correlation **sink**.

`hosts` (substrings, OR-combined) scopes to your app hosts and drops third-party browser
noise (analytics, CDN, browser-update) — **strongly recommended**; get the values from
`get_facets`. Volatile transport headers (date, content-length, `cookie`/`set-cookie`,
trace ids) are filtered automatically. Follow up with `search_requests` on a candidate
value to confirm its producer/consumer, and `get_request({ fields })` for exact paths.

---

## Recommended workflow (important — saves context)

The request bodies in this DB can be huge. **Do not** try to pull every request with
its bodies. Work in two steps:

1. **Orient cheaply.** `list_recordings` → pick a `recordingId`. Then `list_requests`
   to get the slim, ordered index (no bodies). Scan it for the request(s) you care
   about by `orderId`, `path`, `statusCode`, etc.
2. **Drill in.** Call `get_request({ id })` only for the specific request you need to
   read in full — and pass `fields` to project just the JSON leaves you care about.

Use `get_facets` + `filters` on `list_requests` to narrow large recordings instead of
fetching everything. When you're hunting for a request by its *content* (an id, a token,
an error message), reach for `search_requests` rather than scanning the whole index, and
`diff_requests` to compare two requests structurally.

**Reverse-engineering a whole flow?** Have the human record it **twice with different
data**, then call `correlate({ recordingA, recordingB, hosts })` — it tells you which
fields are dynamic (must be correlated) vs. static in one shot, instead of you guessing
from a single capture.

---

## Round-tripping from exported files

Exports embed the same identifiers this server uses, so if the user hands you a file
exported from the UI you can jump straight back into the live DB:

- **HAR** — `log._recordingId` / `log._recordingName` name the source recording; each
  `entry` carries `_requestId` and `_orderId`. These are HAR 1.2 custom (`_`-prefixed)
  fields, ignored by normal HAR viewers. To read a request in full, call
  `get_request({ id: entry._requestId })`.
- **CSV** — columns include `id` (request id), `orderId`, and `recordingId`.
- **JSON** — `{ recording: { id, name }, entries: [...] }` where each entry is the full
  record (with `id` and `orderId`).

So: read `_recordingId` (or `recordingId`) → `list_requests` for context, and any
`_requestId`/`id` → `get_request` for the full exchange.

---

## Agent instructions (paste into a system prompt)

> You have access to the **flowctx** MCP server, which holds recorded
> HTTP(S) traffic in read-only "recordings". Use it to inspect requests and
> responses when debugging API behavior.
>
> Workflow — always go from cheap/broad to expensive/specific:
> 1. Call `list_recordings` to see capture sessions; choose the relevant
>    `recordingId` (ask the user if ambiguous). You may instead pass
>    `recordingName` to `list_requests` when the user gives you a name and not an
>    id — names are unique, so either resolves to exactly one recording.
> 2. Call `list_requests({ recordingId })` to get a slim, ordered index (no bodies).
>    Each entry has `orderId` (1-based capture/start order), `id`, `method`, `url`, `path`,
>    `statusCode`, `contentType`. Scan this to locate the request(s) of interest.
>    - To narrow a large recording, first call `get_facets({ recordingId })` to see
>      available `hosts`/`contentTypes`, then pass `filters` to `list_requests`
>      (e.g. `{ domains: ["api.example.com"], "exclude-content-type": ["image/"] }`).
>      Omitting `filters` reuses the filters the human set in the UI.
>    - To find a request by its *content* (an id, an auth token, an error string),
>      use `search_requests({ recordingId, query })` instead of scanning the index;
>      it returns matching rows with a snippet around each hit.
> 3. Only then call `get_request({ id })` for the full record (headers + bodies) of
>    a specific request. Bodies are capped at 1 MB; check `*Truncated` flags. Pass
>    `fields: ["data.id", …]` to project only the JSON leaves you need (saves tokens).
>    Use `diff_requests({ idA, idB })` to compare two requests structurally.
>
> To reverse-engineer a flow's dynamic vs. static fields, ask for two recordings of the
> same flow run with different data and call `correlate({ recordingA, recordingB, hosts })`;
> the `pairs[].dynamic` fields are your correlation candidates.
>
> Never bulk-fetch full requests. Reference requests by `orderId` when talking to the
> user (e.g. "request #42"). The data is read-only — you cannot modify or replay it.

---

## Example tool-call sequence

```jsonc
// 1. What recordings exist?
list_recordings()
// → [{ "id": "a1b2…", "name": "2026-06-11 14:02", "count": 486, … }]

// 2. Get the ordered index for that recording (by id — or by name if that's all
//    you have, e.g. list_requests({ "recordingName": "2026-06-11 14:02" })).
list_requests({ "recordingId": "a1b2…" })
// → [{ "orderId": 1, "id": "f9…", "method": "GET",  "path": "/api/login",  "statusCode": 200, "contentType": "application/json" },
//    { "orderId": 2, "id": "c3…", "method": "POST", "path": "/api/orders", "statusCode": 500, "contentType": "application/json" }, … ]

// 3. The 500 looks interesting — pull it in full.
get_request({ "id": "c3…" })
// → { "orderId": 2, "method": "POST", "url": "https://…/api/orders",
//     "requestHeaders": {…}, "requestBody": "{…}",
//     "statusCode": 500, "responseHeaders": {…}, "responseBody": "{…}",
//     "fileType": "application/json", "responseBodyTruncated": false }

// Optional: narrow a noisy recording before step 3.
get_facets({ "recordingId": "a1b2…" })
list_requests({ "recordingId": "a1b2…", "filters": { "domains": ["api.example.com"] } })

// Reverse-engineering a flow: record it twice, then find the dynamic fields in one call.
correlate({ "recordingA": "checkout run A", "recordingB": "checkout run B", "hosts": ["example.com"] })
// → { "pairsWithDynamicFields": 39,
//     "pairs": [ { "path": "/api/orders/<id>/status", "orderIdA": 40, "orderIdB": 44,
//                  "dynamic": [ { "where": "responseBody.orderId", "a": "…", "b": "…" } ] } ], … }
```
