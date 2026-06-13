import type { ExportPlugin, CapturedRequest, ExportContext } from '../../types.js'

export class HarExportPlugin implements ExportPlugin {
  id = 'export-har'; name = 'HAR'; type = 'export' as const
  fileExtension = 'har'; mimeType = 'application/json'

  async export(entries: CapturedRequest[], ctx: ExportContext): Promise<string> {
    const harEntries = entries.map(req => ({
      // Custom (`_`-prefixed) fields per HAR 1.2: ignored by HAR viewers, but let
      // an AI map an entry back to MCP `get_request({ id })` / `list_requests`.
      _requestId: req.id,
      _orderId: req.orderId,
      startedDateTime: req.timestamp,
      time: req.timings.total,
      request: {
        method: req.method,
        url: req.url,
        httpVersion: req.httpVersion,
        headers: Object.entries(req.requestHeaders).map(([name, value]) => ({ name, value })),
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: req.requestBody ? Buffer.byteLength(req.requestBody) : 0,
        ...(req.requestBody ? { postData: { mimeType: req.requestHeaders['content-type'] || '', text: req.requestBody } } : {}),
      },
      response: {
        status: req.statusCode ?? 0,
        statusText: req.statusText ?? '',
        httpVersion: req.httpVersion,
        headers: Object.entries(req.responseHeaders ?? {}).map(([name, value]) => ({ name, value })),
        cookies: [],
        content: {
          size: req.responseBody ? Buffer.byteLength(req.responseBody) : 0,
          mimeType: req.responseHeaders?.['content-type'] ?? '',
          text: req.responseBody ?? '',
        },
        redirectURL: req.responseHeaders?.['location'] ?? '',
        headersSize: -1,
        bodySize: req.responseBody ? Buffer.byteLength(req.responseBody) : -1,
      },
      cache: {},
      timings: req.timings,
    }))

    return JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'flowctx', version: '0.1.0' },
        // Custom fields identifying the source recording for AI round-tripping.
        _recordingId: ctx.recording.id,
        _recordingName: ctx.recording.name,
        entries: harEntries,
      },
    }, null, 2)
  }
}
