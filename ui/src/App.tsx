import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  CapturedRequest,
  FilterOptions,
  PluginMeta,
  Recording,
  Facets,
  WsMessage,
} from './types'
import { FilterBar } from './components/FilterBar'
import { RequestTable } from './components/RequestTable'
import { DetailPanel } from './components/DetailPanel'
import { ExportMenu } from './components/ExportMenu'
import { RecordingsList } from './components/RecordingsList'
import { useWebSocket } from './hooks/useWebSocket'
import { passesFilters } from './filterMatch'

const EMPTY_FACETS: Facets = { hosts: [], contentTypes: [] }

export default function App() {
  // ----- view routing -----
  const [openRecordingId, setOpenRecordingId] = useState<string | null>(null)

  // ----- shared state -----
  const [plugins, setPlugins] = useState<PluginMeta>({ exports: [], filters: [] })
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null)

  // ----- detail-view state -----
  const [requests, setRequests] = useState<CapturedRequest[]>([])
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS)
  const [filters, setFilters] = useState<FilterOptions>({})
  const [sortCol, setSortCol] = useState<keyof CapturedRequest>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<CapturedRequest | null>(null)
  const [detailWidth, setDetailWidth] = useState(520)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  // refs for WS callback (avoid stale closures)
  const openRecordingIdRef = useRef(openRecordingId)
  openRecordingIdRef.current = openRecordingId
  const activeRecordingIdRef = useRef(activeRecordingId)
  activeRecordingIdRef.current = activeRecordingId

  // ----- data loading -----
  const refreshRecordings = useCallback(() => {
    return fetch('/api/recordings')
      .then(r => r.json())
      .then((list: Recording[]) => {
        setRecordings(list)
        const active = list.find(r => !r.stoppedAt)
        setActiveRecordingId(active ? active.id : null)
        return list
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetch('/api/plugins').then(r => r.json()).then(setPlugins).catch(console.error)
    refreshRecordings()
  }, [refreshRecordings])

  // load detail-view data whenever the open recording changes
  useEffect(() => {
    if (!openRecordingId) return
    setSelected(null)
    setEditingName(false)
    fetch(`/api/requests?recordingId=${encodeURIComponent(openRecordingId)}`)
      .then(r => r.json())
      .then(setRequests)
      .catch(console.error)
    fetch(`/api/recordings/${encodeURIComponent(openRecordingId)}/facets`)
      .then(r => r.json())
      .then(setFacets)
      .catch(console.error)
    fetch(`/api/recordings/${encodeURIComponent(openRecordingId)}/filters`)
      .then(r => r.json())
      .then((loaded: FilterOptions) => setFilters(loaded ?? {}))
      .catch(() => setFilters({}))
  }, [openRecordingId])

  // ----- live updates -----
  useWebSocket((msg: WsMessage) => {
    if (msg.type === 'request') {
      const req = msg.data
      if (
        req.recordingId === openRecordingIdRef.current &&
        activeRecordingIdRef.current === openRecordingIdRef.current
      ) {
        setRequests(prev => [req, ...prev])
      }
    } else if (msg.type === 'recording-started') {
      setActiveRecordingId(msg.data.id)
      refreshRecordings()
    } else if (msg.type === 'recording-stopped') {
      setActiveRecordingId(prev => (prev === msg.data.id ? null : prev))
      refreshRecordings()
    }
  })

  // ----- recording actions -----
  const handleStart = async () => {
    try {
      const res = await fetch('/api/recordings', { method: 'POST' })
      const rec: Recording = await res.json()
      setActiveRecordingId(rec.id)
      await refreshRecordings()
      setOpenRecordingId(rec.id)
    } catch (e) {
      console.error(e)
    }
  }

  const handleStop = async (id: string) => {
    try {
      await fetch(`/api/recordings/${encodeURIComponent(id)}/stop`, { method: 'POST' })
      setActiveRecordingId(prev => (prev === id ? null : prev))
      await refreshRecordings()
    } catch (e) {
      console.error(e)
    }
  }

  const handleRename = async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        // Surface failures (e.g. 409 duplicate name) instead of failing silently.
        const body = await res.json().catch(() => ({}))
        window.alert(body.error ?? `Rename failed (${res.status})`)
        return
      }
      await refreshRecordings()
    } catch (e) {
      console.error(e)
      window.alert('Rename failed — see console for details.')
    }
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this recording and all its requests?')) return
    try {
      await fetch(`/api/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (openRecordingId === id) setOpenRecordingId(null)
      await refreshRecordings()
    } catch (e) {
      console.error(e)
    }
  }

  // ----- recordings list view -----
  if (!openRecordingId) {
    return (
      <RecordingsList
        recordings={recordings}
        activeRecordingId={activeRecordingId}
        exportPlugins={plugins.exports}
        onStart={handleStart}
        onStop={handleStop}
        onOpen={setOpenRecordingId}
        onRename={handleRename}
        onDelete={handleDelete}
      />
    )
  }

  // ----- detail view -----
  const openRecording = recordings.find(r => r.id === openRecordingId)
  const isActive = activeRecordingId === openRecordingId

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = detailWidth
    const onMove = (ev: MouseEvent) => {
      const next = startWidth + (startX - ev.clientX)
      setDetailWidth(Math.min(900, Math.max(320, next)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const handleFilterChange = (next: FilterOptions) => {
    setFilters(next)
    if (!openRecordingId) return
    fetch(`/api/recordings/${encodeURIComponent(openRecordingId)}/filters`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(console.error)
  }

  const commitName = () => {
    setEditingName(false)
    const name = nameDraft.trim()
    if (openRecordingId && name && name !== openRecording?.name) {
      handleRename(openRecordingId, name)
    }
  }

  const handleSort = (col: keyof CapturedRequest) => {
    if (sortCol === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  // Client-side filtering mirrors the server (RequestStore.query). The server
  // already filters /api/requests; this keeps live-appended WS rows consistent.
  const filtered = requests.filter(req => passesFilters(req, filters, plugins.filters))

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortCol]
    const bv = b[sortCol]
    let cmp: number
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv // numeric columns (e.g. orderId, statusCode) compare numerically
    } else {
      const as = String(av ?? '')
      const bs = String(bv ?? '')
      cmp = as < bs ? -1 : as > bs ? 1 : 0
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="app">
      <div className="toolbar">
        <button className="btn" onClick={() => setOpenRecordingId(null)}>← Back</button>
        {editingName ? (
          <input
            className="filter-input"
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitName()
              else if (e.key === 'Escape') setEditingName(false)
            }}
            onBlur={commitName}
            style={{ width: 260, fontWeight: 600 }}
          />
        ) : (
          <span
            title="Click to rename"
            onClick={() => { setNameDraft(openRecording?.name ?? ''); setEditingName(true) }}
            style={{ fontWeight: 600, fontSize: 14, color: '#90cdf4', whiteSpace: 'nowrap', cursor: 'text' }}
          >
            {openRecording?.name ?? 'Recording'} ✎
          </span>
        )}
        {isActive && <span className="status-2xx" style={{ fontSize: 11 }}>● recording</span>}
        <span className="count-badge">{sorted.length} / {requests.length} requests</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
          {isActive ? (
            <button className="btn btn-danger" onClick={() => handleStop(openRecordingId)}>
              ■ Stop Recording
            </button>
          ) : (
            <button className="btn btn-record" onClick={handleStart}>
              ● Start Recording
            </button>
          )}
          <ExportMenu plugins={plugins.exports} filters={filters} recordingId={openRecordingId} />
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          filterPlugins={plugins.filters}
          facets={facets}
        />
        <RequestTable
          requests={sorted}
          selected={selected}
          onSelect={setSelected}
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
        />
        {selected && (
          <>
            <div className="detail-resizer" onMouseDown={startResize} />
            <DetailPanel
              request={selected}
              onClose={() => setSelected(null)}
              width={detailWidth}
            />
          </>
        )}
      </div>
    </div>
  )
}
