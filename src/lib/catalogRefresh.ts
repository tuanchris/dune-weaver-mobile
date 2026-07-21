// Runs the on-table catalog reads (pattern manifest + playlist listing) that
// useLibrary defers while the table is mid-pattern. loadTable/loadPlaylists
// skip the board read when the table is busy (their read would contend with the
// status poll and the running job on the single-threaded server); this rides
// the status poll and re-runs them the moment the table goes idle — a first
// load lands, and a pull-to-refresh made mid-pattern (which recorded a forced
// retry) refreshes then. SWR keeps it cheap: for a board that's already cached
// and had no forced refresh queued, the idle re-run is a no-op.

import { useEffect } from 'react'
import { isBusy } from '../api/status'
import { useStatus } from '../stores/useStatus'
import { useLibrary, consumeDeferredForce } from '../stores/useLibrary'

export function useCatalogRefreshOnIdle() {
  useEffect(() => {
    return useStatus.subscribe((s, prev) => {
      const base = s.base
      if (!base || !s.status?.connected) return
      // Fire on the transition into idle (also the first connected poll, and a
      // switch onto an already-idle board), not on every idle poll.
      const idleNow = !isBusy(s.status)
      const wasBusy = isBusy(prev.status) || prev.base !== base || prev.status?.connected !== true
      if (!idleNow || !wasBusy) return
      const force = consumeDeferredForce(base)
      const lib = useLibrary.getState()
      void lib.loadTable(base, force)
      void lib.loadPlaylists(base, force)
    })
  }, [])
}
