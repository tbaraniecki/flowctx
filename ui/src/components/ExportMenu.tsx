import { useState, useEffect, useRef } from 'react'
import type { ExportPluginMeta, FilterOptions } from '../types'

interface Props {
  plugins: ExportPluginMeta[]
  filters: FilterOptions
  recordingId: string
}

export function ExportMenu({ plugins, filters, recordingId }: Props) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Position the menu with fixed coordinates anchored to the button, so it
  // escapes the table's `overflow:auto` clipping (otherwise the next row hides it).
  const toggle = () => {
    setOpen(o => {
      const next = !o
      if (next && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect()
        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
      }
      return next
    })
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const exportWith = (pluginId: string) => {
    const params = new URLSearchParams()
    params.set('recordingId', recordingId)
    for (const [key, vals] of Object.entries(filters)) {
      if (vals?.length) params.set(key, vals.join(','))
    }
    window.location.href = `/api/export/${pluginId}?${params.toString()}`
    setOpen(false)
  }

  if (plugins.length === 0) return null

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button ref={buttonRef} className="btn" onClick={toggle}>
        Export ▾
      </button>
      {open && menuPos && (
        <div style={{
          position: 'fixed',
          top: menuPos.top,
          right: menuPos.right,
          background: '#1e2330',
          border: '1px solid #2d3748',
          borderRadius: 4,
          zIndex: 100,
          minWidth: 160,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}>
          {plugins.map(p => (
            <button
              key={p.id}
              className="btn"
              style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0 }}
              onClick={() => exportWith(p.id)}
            >
              {p.name}
              <span style={{ color: '#4a5568', marginLeft: 4 }}>.{p.fileExtension}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
