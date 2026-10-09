import { useEffect, useRef } from 'react'
import { api } from '@/lib/api'

// ADD [Claude AI - Opus 5] (2026-10-08 14:05:12): the server pushes a boot id on
// /api/live. A different id after a reconnect means new code is running.
export function useLiveReload(onUpdate: (reason: string) => void) {
  const handler = useRef(onUpdate)
  handler.current = onUpdate

  useEffect(() => {
    let source: EventSource | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let bootId: string | null = null
    let closed = false

    const connect = () => {
      if (closed) return
      source = new EventSource(`/api/live?token=${encodeURIComponent(api.token)}`)

      source.addEventListener('boot', (event) => {
        const id = (event as MessageEvent<string>).data
        if (bootId === null) {
          bootId = id
          return
        }
        if (id !== bootId) {
          bootId = id
          handler.current('The server restarted with new code')
        }
      })

      source.addEventListener('reload', () => handler.current('The page code changed'))

      source.onerror = () => {
        source?.close()
        source = null
        // The server is probably restarting; come back shortly.
        retry = setTimeout(connect, 700)
      }
    }

    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      source?.close()
    }
  }, [])
}
