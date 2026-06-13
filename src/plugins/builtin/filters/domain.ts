import type { FilterPlugin, CapturedRequest } from '../../../types.js'

export class DomainFilterPlugin implements FilterPlugin {
  id = 'filter-domain'; name = 'Domain'; type = 'filter' as const; filterKey = 'domains'
  facetKey = 'hosts'
  match(req: CapturedRequest, values: string[]): boolean {
    return values.some(d => req.host.includes(d))
  }
  ui = { label: 'Domains', placeholder: 'api.example.com', inputType: 'checkbox' as const }
}
