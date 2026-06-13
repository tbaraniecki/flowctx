import type { CapturedRequest } from '../types'

const COLUMNS: { key: keyof CapturedRequest; label: string; width?: number }[] = [
  { key: 'orderId', label: '#', width: 50 },
  { key: 'method', label: 'Method', width: 70 },
  { key: 'statusCode', label: 'Status', width: 60 },
  { key: 'host', label: 'Host', width: 180 },
  { key: 'path', label: 'Path' },
  { key: 'timestamp', label: 'Time', width: 90 },
]

function methodClass(m: string) {
  return `method method-${m.toLowerCase()}`
}

function statusClass(s?: number): string {
  if (!s) return ''
  if (s < 300) return 'status-2xx'
  if (s < 400) return 'status-3xx'
  if (s < 500) return 'status-4xx'
  return 'status-5xx'
}

function shortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

interface Props {
  requests: CapturedRequest[]
  selected: CapturedRequest | null
  onSelect: (r: CapturedRequest) => void
  sortCol: keyof CapturedRequest
  sortDir: 'asc' | 'desc'
  onSort: (col: keyof CapturedRequest) => void
}

export function RequestTable({ requests, selected, onSelect, sortCol, sortDir, onSort }: Props) {
  return (
    <div className="table-wrapper">
      <table>
        <colgroup>
          {COLUMNS.map(col => (
            <col key={col.key} style={col.width ? { width: col.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map(col => (
              <th
                key={col.key}
                onClick={() => onSort(col.key)}
                title={`Sort by ${col.label}`}
              >
                {col.label}
                {sortCol === col.key && (
                  <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} style={{ textAlign: 'center', color: '#4a5568', padding: '24px 12px' }}>
                No requests captured yet
              </td>
            </tr>
          )}
          {requests.map(req => (
            <tr
              key={req.id}
              onClick={() => onSelect(req)}
              style={{ background: selected?.id === req.id ? '#1e2a3a' : undefined }}
            >
              <td style={{ color: '#718096', fontVariantNumeric: 'tabular-nums' }} title={`Order #${req.orderId ?? ''}`}>
                {req.orderId ?? '—'}
              </td>
              <td>
                <span className={methodClass(req.method)}>{req.method}</span>
              </td>
              <td>
                <span className={statusClass(req.statusCode)}>
                  {req.statusCode ?? '—'}
                </span>
              </td>
              <td title={req.host}>{req.host}</td>
              <td title={req.path}>{req.path}</td>
              <td title={req.timestamp}>{shortTime(req.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
