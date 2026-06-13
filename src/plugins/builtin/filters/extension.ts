import type { FilterPlugin, CapturedRequest } from '../../../types.js'
import path from 'path'

export class ExtensionFilterPlugin implements FilterPlugin {
  id = 'filter-extension'; name = 'File Extension'; type = 'filter' as const; filterKey = 'extensions'
  match(req: CapturedRequest, values: string[]): boolean {
    const ext = path.extname(req.path).toLowerCase()
    return values.some(v => {
      const normalized = v.startsWith('.') ? v.toLowerCase() : `.${v.toLowerCase()}`
      return ext === normalized
    })
  }
  ui = { label: 'Extensions', placeholder: '.js, .css' }
}
