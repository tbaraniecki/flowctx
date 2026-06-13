import type { ExportPlugin, CapturedRequest, ExportContext } from '../../types.js'

export class CsvExportPlugin implements ExportPlugin {
  id = 'export-csv'; name = 'CSV'; type = 'export' as const
  fileExtension = 'csv'; mimeType = 'text/csv'

  async export(entries: CapturedRequest[], ctx: ExportContext): Promise<string> {
    // orderId + recordingId are appended (not inserted) so existing positional
    // parsers of the original columns keep working.
    const header = 'id,timestamp,method,host,path,statusCode,totalMs,orderId,recordingId'
    const rows = entries.map(r =>
      [
        r.id,
        r.timestamp,
        r.method,
        r.host,
        `"${r.path}"`,
        r.statusCode ?? '',
        r.timings.total,
        r.orderId ?? '',
        ctx.recording.id,
      ].join(',')
    )
    return [header, ...rows].join('\n')
  }
}
