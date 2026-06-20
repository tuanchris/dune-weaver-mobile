import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { palettes, type Palette, type ThemeMode } from '../theme'

const KEY = 'dw_theme_mode'

interface ThemeStore {
  mode: ThemeMode
  colors: Palette
  setMode: (m: ThemeMode) => void
  toggle: () => void
  hydrate: () => Promise<void>
}

export const useTheme = create<ThemeStore>((set, get) => ({
  mode: 'dark',
  colors: palettes.dark,
  setMode: (mode) => {
    set({ mode, colors: palettes[mode] })
    AsyncStorage.setItem(KEY, mode).catch(() => {})
  },
  toggle: () => get().setMode(get().mode === 'dark' ? 'light' : 'dark'),
  hydrate: async () => {
    try {
      const saved = (await AsyncStorage.getItem(KEY)) as ThemeMode | null
      if (saved === 'dark' || saved === 'light') set({ mode: saved, colors: palettes[saved] })
    } catch {
      // keep default
    }
  },
}))
