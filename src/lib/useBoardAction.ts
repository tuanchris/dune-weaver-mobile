import { useState } from 'react'
import { useStatus } from '../stores/useStatus'
import { toast } from '../stores/useToast'

/**
 * Run a board command with consistent UX: flips a `busy` flag, toasts on success,
 * then re-polls status after a short delay so the UI reflects the new state.
 * Failures surface a generic error toast. `setBusy` is exposed so screens that
 * also drive other async work (e.g. saving a playlist) can share one busy flag.
 */
export function useBoardAction(refreshDelay = 400) {
  const refresh = useStatus((s) => s.refresh)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<void>, successMsg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(successMsg)
      setTimeout(refresh, refreshDelay)
    } catch {
      toast.error('Action failed')
    } finally {
      setBusy(false)
    }
  }

  return { busy, setBusy, act }
}
