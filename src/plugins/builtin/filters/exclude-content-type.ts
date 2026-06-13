import type { FilterPlugin, CapturedRequest } from '../../../types.js'

export class ExcludeContentTypeFilterPlugin implements FilterPlugin {
  id = 'filter-exclude-content-type'; name = 'Exclude Content-Type'; type = 'filter' as const
  filterKey = 'excludeContentTypes'; mode = 'exclude' as const; facetKey = 'contentTypes'
  match(req: CapturedRequest, values: string[]): boolean {
    const headers = req.responseHeaders ?? {}
    const key = Object.keys(headers).find(k => k.toLowerCase() === 'content-type')
    if (!key) return false
    const contentType = headers[key].toLowerCase()
    return values.some(v => contentType.includes(v.toLowerCase()))
  }
  ui = { label: 'Exclude content-type', placeholder: 'image/png', inputType: 'checkbox' as const }
}
