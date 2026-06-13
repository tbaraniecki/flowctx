import type { CapturedRequest } from '../types'

interface Props {
  request: CapturedRequest
  onClose: () => void
  width?: number
}

export function DetailPanel({ request: r, onClose, width }: Props) {
  return (
    <div className="detail-panel" style={width != null ? { width } : undefined}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ color: '#90cdf4', fontSize: 13 }}>Request Detail</strong>
        <button className="btn" onClick={onClose} style={{ padding: '2px 8px', fontSize: 14 }}>×</button>
      </div>

      <Section title="General">
        <Row label="Request ID" value={r.id} />
        {r.orderId != null && <Row label="Order #" value={String(r.orderId)} />}
        {r.recordingId && <Row label="Recording ID" value={r.recordingId} />}
        <Row label="URL" value={r.url} />
        <Row label="Method" value={r.method} />
        <Row label="Status" value={r.statusCode != null ? `${r.statusCode}${r.statusText ? ' ' + r.statusText : ''}` : '—'} />
        <Row label="HTTP Version" value={r.httpVersion} />
        <Row
          label="Timings"
          value={`total: ${r.timings.total}ms  send: ${r.timings.send}ms  wait: ${r.timings.wait}ms  receive: ${r.timings.receive}ms`}
        />
        <Row label="Timestamp" value={new Date(r.timestamp).toLocaleString()} />
      </Section>

      <Section title="Request Headers">
        {Object.entries(r.requestHeaders).length > 0
          ? Object.entries(r.requestHeaders).map(([k, v]) => <Row key={k} label={k} value={v} />)
          : <EmptyNote>No request headers</EmptyNote>
        }
      </Section>

      {r.requestBody != null && r.requestBody !== '' && (
        <Section title="Request Body">
          <BodyDisplay content={r.requestBody} contentType={r.requestHeaders['content-type'] ?? r.requestHeaders['Content-Type']} />
        </Section>
      )}

      {r.responseHeaders && Object.keys(r.responseHeaders).length > 0 && (
        <Section title="Response Headers">
          {Object.entries(r.responseHeaders).map(([k, v]) => <Row key={k} label={k} value={v} />)}
        </Section>
      )}

      {r.responseBody != null && r.responseBody !== '' && (
        <Section title="Response Body">
          <BodyDisplay
            content={r.responseBody}
            contentType={r.responseHeaders?.['content-type'] ?? r.responseHeaders?.['Content-Type']}
          />
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        color: '#718096',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
        marginBottom: 6,
        paddingBottom: 4,
        borderBottom: '1px solid #1e2330',
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 3, fontSize: 11 }}>
      <span style={{ color: '#718096', minWidth: 120, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#e2e8f0', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: '#4a5568', fontSize: 11, fontStyle: 'italic' }}>{children}</div>
  )
}

function BodyDisplay({ content, contentType }: { content: string; contentType?: string }) {
  let display = content
  const isJson = contentType?.includes('json') || (() => {
    try { JSON.parse(content); return true } catch { return false }
  })()

  if (isJson) {
    try {
      display = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      display = content
    }
  }

  return (
    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
      {display}
    </pre>
  )
}
