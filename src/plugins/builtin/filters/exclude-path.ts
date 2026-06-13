import type { FilterPlugin, CapturedRequest } from '../../../types.js'

export class ExcludePathFilterPlugin implements FilterPlugin {
  id = 'filter-exclude-path'; name = 'Exclude Path'; type = 'filter' as const
  filterKey = 'excludePaths'; mode = 'exclude' as const
  match(req: CapturedRequest, values: string[]): boolean {
    return values.some(v => req.path.includes(v))
  }
  ui = { label: 'Exclude path contains', placeholder: '/analytics', inputType: 'tags' as const }
}
