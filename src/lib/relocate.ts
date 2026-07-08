// Follow a table across DHCP address changes: when the active board stops
// answering for a while, run a one-shot mDNS scan and — if a discovered table
// has the same identity — silently repoint the saved board at its new address.
//
// Identity is the stored mDNS hostname (captured when the board was added via
// discovery), falling back to the display name for boards saved before the
// hostname field existed. Manually-named boards without a hostname simply
// never auto-relocate, which is the safe default.

import { useEffect, useRef } from 'react'
import { scanOnce } from './discovery'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { isDemoBase } from '../api/demoBoard'
import { toast } from '../stores/useToast'

/** How long the board must be unreachable before the first scan. */
const OFFLINE_BEFORE_SCAN_MS = 12_000
/** Re-scan interval while it stays unreachable. */
const SCAN_RETRY_MS = 60_000

export function useAutoRelocate(): void {
  const status = useStatus((s) => s.status)
  const base = useStatus((s) => s.base)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const offline = !!base && !isDemoBase(base) && (status === null || status.connected === false)

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
    if (!offline) {
      clear()
      return
    }

    const run = async () => {
      timerRef.current = null
      const active = useBoards.getState().getActive()
      if (!active || isDemoBase(active.base)) return
      const ident = (active.hostname ?? active.name).trim().toLowerCase()
      if (!ident) return
      const found = await scanOnce()
      // Re-check the world after the scan: still offline, same active board.
      const s = useStatus.getState()
      const stillOffline = s.status === null || s.status.connected === false
      const stillActive = useBoards.getState().activeId === active.id
      const match = found.find((t) => t.name.trim().toLowerCase() === ident && t.base !== active.base)
      if (stillOffline && stillActive && match) {
        useBoards.getState().updateBase(active.id, match.base, match.name)
        toast.success(`${active.name} moved — reconnected at ${match.address}`)
        return
      }
      // No luck; if we're still offline, try again later.
      if (stillOffline && stillActive) timerRef.current = setTimeout(run, SCAN_RETRY_MS)
    }

    if (!timerRef.current) timerRef.current = setTimeout(run, OFFLINE_BEFORE_SCAN_MS)
    return clear
  }, [offline])
}
