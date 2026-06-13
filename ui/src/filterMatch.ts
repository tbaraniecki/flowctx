import type { CapturedRequest, FilterOptions, FilterPluginMeta } from './types'

/**
 * Mirror of the server-side match logic (src/plugins/builtin/filters/*) and
 * RequestStore.query. Keyed on filterKey since the browser only has plugin
 * metadata, not the server's `match` functions.
 *
 * Returns true if the request MATCHES the given filter values for this key.
 * The caller applies include/exclude semantics via the plugin `mode`.
 */
export function matchFilter(key: string, req: CapturedRequest, values: string[]): boolean {
  switch (key) {
    case 'domains':
      return values.some(d => req.host.includes(d))
    case 'paths':
      return values.some(p => req.path.startsWith(p))
    case 'extensions': {
      const dot = req.path.lastIndexOf('.')
      const slash = req.path.lastIndexOf('/')
      const ext = dot > slash ? req.path.slice(dot).toLowerCase() : ''
      return values.some(v => {
        const normalized = v.startsWith('.') ? v.toLowerCase() : `.${v.toLowerCase()}`
        return ext === normalized
      })
    }
    case 'excludePaths':
      return values.some(v => req.path.includes(v))
    case 'excludeContentTypes': {
      const headers = req.responseHeaders ?? {}
      const ctKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-type')
      if (!ctKey) return false
      const contentType = headers[ctKey].toLowerCase()
      return values.some(v => contentType.includes(v.toLowerCase()))
    }
    default:
      // Unknown plugin filterKey: no client-side match info, keep the row.
      return true
  }
}

/**
 * Apply all active filters to a single request, mirroring RequestStore.query.
 * include mode: keep if match; exclude mode: drop if match.
 */
export function passesFilters(
  req: CapturedRequest,
  filters: FilterOptions,
  filterPlugins: FilterPluginMeta[],
): boolean {
  for (const [key, values] of Object.entries(filters)) {
    if (!values || values.length === 0) continue
    const plugin = filterPlugins.find(fp => fp.filterKey === key)
    const isExclude = plugin?.mode === 'exclude'
    const matched = matchFilter(key, req, values)
    if (isExclude) {
      if (matched) return false
    } else {
      if (!matched) return false
    }
  }
  return true
}
