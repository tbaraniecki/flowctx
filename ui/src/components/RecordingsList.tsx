import { useState } from 'react'
import type { Recording, ExportPluginMeta } from '../types'
import { ExportMenu } from './ExportMenu'

interface Props {
  recordings: Recording[]
  activeRecordingId: string | null
  exportPlugins: ExportPluginMeta[]
  onStart: () => void
  onStop: (id: string) => void
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function RecordingsList({
  recordings,
  activeRecordingId,
  exportPlugins,
  onStart,
  onStop,
  onOpen,
  onRename,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (r: Recording) => {
    setEditingId(r.id)
    setEditValue(r.name)
  }

  const commitEdit = (id: string) => {
    const name = editValue.trim()
    if (name) onRename(id, name)
    setEditingId(null)
  }

  return (
    <div className="app">
      <div className="toolbar">
        <span style={{ fontWeight: 600, fontSize: 14, color: '#90cdf4', whiteSpace: 'nowrap' }}>
          flowctx
        </span>
        <span className="count-badge">{recordings.length} recordings</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
          {activeRecordingId ? (
            <button className="btn btn-danger" onClick={() => onStop(activeRecordingId)}>
              ■ Stop Recording
            </button>
          ) : (
            <button className="btn btn-record" onClick={onStart}>
              ● Start Recording
            </button>
          )}
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          <colgroup>
            <col />
            <col style={{ width: 180 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 320 }} />
          </colgroup>
          <thead>
            <tr>
              <th>Name</th>
              <th>Created</th>
              <th>Requests</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {recordings.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: '#4a5568', padding: '24px 12px' }}>
                  No recordings yet — click "Start Recording" to begin
                </td>
              </tr>
            )}
            {recordings.map(r => {
              const active = r.id === activeRecordingId
              return (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td title={r.name}>
                    {editingId === r.id ? (
                      <input
                        className="filter-input"
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitEdit(r.id)
                          else if (e.key === 'Escape') setEditingId(null)
                        }}
                        onBlur={() => commitEdit(r.id)}
                        style={{ width: '90%' }}
                      />
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span>{r.name}</span>
                        <span
                          title="Recording ID — pass to the MCP server as recordingId"
                          style={{ fontFamily: 'monospace', fontSize: 10, color: '#718096', userSelect: 'all' }}
                        >
                          {r.id}
                        </span>
                      </div>
                    )}
                  </td>
                  <td title={r.createdAt}>{fmtDate(r.createdAt)}</td>
                  <td>{r.count ?? 0}</td>
                  <td>
                    {active ? (
                      <span className="status-2xx">● active</span>
                    ) : (
                      <span style={{ color: '#718096' }}>stopped</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn" onClick={() => onOpen(r.id)}>Open</button>
                      <button className="btn" onClick={() => startEdit(r)}>Rename</button>
                      <ExportMenu plugins={exportPlugins} filters={{}} recordingId={r.id} />
                      <button className="btn btn-danger" onClick={() => onDelete(r.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
