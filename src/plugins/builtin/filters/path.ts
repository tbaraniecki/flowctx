import type { FilterPlugin, CapturedRequest } from '../../../types.js'

export class PathFilterPlugin implements FilterPlugin {
  id = 'filter-path'; name = 'Path'; type = 'filter' as const; filterKey = 'paths'
  match(req: CapturedRequest, values: string[]): boolean {
    return values.some(p => req.path.startsWith(p))
  }
  ui = { label: 'Paths', placeholder: '/api/v1' }
}
