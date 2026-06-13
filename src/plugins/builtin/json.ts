import type { ExportPlugin, CapturedRequest, ExportContext } from '../../types.js'

export class JsonExportPlugin implements ExportPlugin {
  id = 'export-json'; name = 'JSON'; type = 'export' as const
  fileExtension = 'json'; mimeType = 'application/json'

  async export(entries: CapturedRequest[], ctx: ExportContext): Promise<string> {
    return JSON.stringify({ recording: ctx.recording, entries }, null, 2)
  }
}
