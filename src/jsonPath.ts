// Dot-path projection helpers for pulling specific JSON fields out of bodies.
// Pure, no-throw utilities so callers can request only the fields they need
// (a big token saver versus shipping a whole capped body).

// Split a dot-path into segments, expanding array indices. Supports `a.b.c`,
// `a.b[0].c`, and `a[2]`. Numeric indices become numbers; keys stay strings.
function parsePath(path: string): (string | number)[] {
  const segments: (string | number)[] = []
  for (const part of path.split('.')) {
    if (part === '') continue
    let rest = part
    // Pull any leading key before the first bracket.
    const bracket = rest.indexOf('[')
    const key = bracket === -1 ? rest : rest.slice(0, bracket)
    if (key !== '') segments.push(key)
    if (bracket === -1) continue
    rest = rest.slice(bracket)
    const re = /\[(\d+)\]/g
    let m: RegExpExecArray | null
    while ((m = re.exec(rest)) !== null) {
      segments.push(Number(m[1]))
    }
  }
  return segments
}

// Walk a dot-path (with array index support) over `obj`. Returns `undefined`
// if any segment is missing. Never throws.
export function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj
  for (const segment of parsePath(path)) {
    if (current == null) return undefined
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
    } else {
      if (typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[segment]
    }
  }
  return current
}

// Resolve each input path against `obj`, keyed by the original path string.
// Keys whose resolved value is `undefined` are omitted.
export function projectPaths(obj: unknown, paths: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const path of paths) {
    const value = getPath(obj, path)
    if (value !== undefined) out[path] = value
  }
  return out
}
