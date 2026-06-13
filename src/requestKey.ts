// Stable, cross-recording request key.
//
// WHY this is stable across recordings: `requestKey` is a pure function of
// (method, host, path) that erases the per-recording-variable parts of a path —
// ids, numeric segments, long hashes, opaque tokens, and the entire query
// string. The same logical endpoint therefore collapses to the same key in
// every recording, which lets us align/diff requests across sessions WITHOUT
// relying on orderId (which is recording-local and shifts as traffic varies).
//
// TODO: hosts that differ between environments (e.g. staging vs prod) would
// produce different keys for the same logical endpoint. Supporting that would
// need an optional host-alias map; not handled yet.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_RE = /^[0-9a-f]+$/i
const DIGITS_RE = /^\d+$/

function placeholderFor(segment: string): string {
  if (UUID_RE.test(segment)) return ':uuid'
  if (DIGITS_RE.test(segment)) return ':num'
  if (segment.length >= 16 && HEX_RE.test(segment)) return ':hex'
  if (segment.length >= 24 && /\d/.test(segment) && /[a-z]/i.test(segment)) return ':token'
  return segment
}

// Drop the query string, then replace variable-looking path segments with
// placeholders. Preserves a leading slash.
export function normalizePath(path: string): string {
  const noQuery = path.split('?')[0]
  const segments = noQuery.split('/').map(seg => (seg === '' ? seg : placeholderFor(seg)))
  return segments.join('/')
}

export function requestKey(method: string, host: string, path: string): string {
  return `${method.toUpperCase()} ${host}${normalizePath(path)}`
}
