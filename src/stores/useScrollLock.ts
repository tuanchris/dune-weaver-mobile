// A global "a slider is being dragged" flag. PanResponder handlers alone don't
// stop an iOS ScrollView from scrolling in parallel with a slider drag, so the
// reliable fix is to disable the enclosing ScrollView's scroll for the duration
// of the drag. The Slider/ColorWheel lock on grant and unlock on release; any
// ScrollView that contains a slider binds `scrollEnabled={!useScrollLock(...)}`.
// Only one touch drags at a time, so a single boolean is enough.

import { create } from 'zustand'

interface ScrollLockStore {
  locked: boolean
  lock: () => void
  unlock: () => void
}

export const useScrollLock = create<ScrollLockStore>((set) => ({
  locked: false,
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}))
