import { useState } from 'react'
import { useStatus } from '../stores/useStatus'
import { toast } from '../stores/useToast'
import { userMessage } from './errors'

/**
 * Run a board command with consistent UX: flips a `busy` flag, toasts on success,
 * then re-polls status after a short delay so the UI reflects the new state.
 * Failures toast a human explanation — pass `doing` (a verb phrase like
 * "home the table") so it reads "Couldn't home the table — …". `setBusy` is
 * exposed so screens that also drive other async work (e.g. saving a playlist)
 * can share one busy flag.
 */
export function useBoardAction(refreshDelay = 400) {
  const refresh = useStatus((s) => s.refresh)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<void>, successMsg: string, doing = 'complete that action') => {
    setBusy(true)
    try {
      await fn()
      toast.success(successMsg)
      setTimeout(refresh, refreshDelay)
    } catch (e) {
      toast.error(userMessage(e, doing))
    } finally {
      setBusy(false)
    }
  }

  return { busy, setBusy, act }
}
