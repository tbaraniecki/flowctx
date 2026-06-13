export interface CapturedRequest {
  id: string
  recordingId?: string
  orderId?: number
  timestamp: string
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
  timings: { send: number; wait: number; receive: number; total: number }
}

export interface FilterOptions {
  [key: string]: string[] | undefined
}

export interface Recording {
  id: string
  name: string
  createdAt: string
  stoppedAt?: string
  count?: number
}

export interface Facets {
  hosts: string[]
  contentTypes: string[]
}

export interface ExportPluginMeta {
  id: string
  name: string
  fileExtension: string
}

export type FilterMode = 'include' | 'exclude'
export type FilterInputType = 'tags' | 'checkbox'
export type FacetKey = 'hosts' | 'contentTypes'

export interface FilterPluginMeta {
  id: string
  name: string
  filterKey: string
  mode: FilterMode
  facetKey?: FacetKey
  ui: { label: string; placeholder: string; inputType: FilterInputType }
}

export interface PluginMeta {
  exports: ExportPluginMeta[]
  filters: FilterPluginMeta[]
}

export type WsMessage =
  | { type: 'request'; data: CapturedRequest }
  | { type: 'recording-started'; data: Recording }
  | { type: 'recording-stopped'; data: Recording }
