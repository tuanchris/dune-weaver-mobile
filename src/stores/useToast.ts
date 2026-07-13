import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'error'

interface ToastStore {
  message: string | null
  type: ToastType
  show: (message: string, type?: ToastType) => void
  hide: () => void
}

let hideTimer: ReturnType<typeof setTimeout> | null = null

// Errors stay up long enough to actually read (they carry a what-to-do-next
// sentence); confirmations can flash by.
const DURATION_MS: Record<ToastType, number> = { info: 2600, success: 2600, error: 7000 }

export const useToast = create<ToastStore>((set) => ({
  message: null,
  type: 'info',
  show: (message, type = 'info') => {
    if (hideTimer) clearTimeout(hideTimer)
    set({ message, type })
    hideTimer = setTimeout(() => set({ message: null }), DURATION_MS[type])
  },
  hide: () => {
    if (hideTimer) clearTimeout(hideTimer)
    set({ message: null })
  },
}))

export const toast = {
  info: (m: string) => useToast.getState().show(m, 'info'),
  success: (m: string) => useToast.getState().show(m, 'success'),
  error: (m: string) => useToast.getState().show(m, 'error'),
}
