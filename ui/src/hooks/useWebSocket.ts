import { useEffect, useRef } from 'react'
import type { WsMessage } from '../types'

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    let ws: WebSocket | null = null
    let closed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    function connect() {
      if (closed) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`)

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsMessage
          if (msg && typeof msg.type === 'string') onMessageRef.current(msg)
        } catch {
          // ignore parse errors
        }
      }

      ws.onclose = () => {
        if (!closed) {
          reconnectTimer = setTimeout(connect, 2000)
        }
      }

      ws.onerror = () => {
        ws?.close()
      }
    }

    connect()

    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [])
}
