export interface CapturedRequest {
  id: string
  timestamp: string // ISO 8601
  method: string
  host: string
  path: string
  url: string
  httpVersion: string
  requestHeaders: Record<string, string>
  requestBody?: string
  statusCode?: number
  statusText?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  timings: {
    send: number
    wait: number
    receive: number
    total: number
  }
  recordingId?: string
  orderId?: number
}

export interface Recording {
  id: string
  name: string
  createdAt: string // ISO 8601
  stoppedAt?: string // ISO 8601
}

export interface FilterOptions {
  domains?: string[]
  paths?: string[]
  [key: string]: string[] | undefined // extensible for plugin-defined filters
}

export interface ExportContext {
  filters: FilterOptions
  recording: { id: string; name: string }
}

export interface ExportPlugin {
  id: string
  name: string
  type: 'export'
  fileExtension: string
  mimeType: string
  export(entries: CapturedRequest[], ctx: ExportContext): Promise<string | Buffer>
}

export interface FilterPlugin {
  id: string
  name: string
  type: 'filter'
  filterKey: string // key used in FilterOptions, e.g. "extensions"
  mode?: 'include' | 'exclude' // default 'include'; 'exclude' drops matching requests
  facetKey?: string // names the facet supplying checkbox values, e.g. 'hosts' or 'contentTypes'
  match(request: CapturedRequest, values: string[]): boolean
  ui: {
    label: string
    placeholder: string
    inputType?: 'tags' | 'checkbox' // default 'tags'
  }
}

export type Plugin = ExportPlugin | FilterPlugin
