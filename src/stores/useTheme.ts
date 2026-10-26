import { create } from 'zustand'
import { Appearance } from 'react-native'
import { palettes, type Palette, type ThemeMode } from '../theme'

// The app follows the system appearance — no in-app toggle, nothing persisted.
// Read at module load so the first frame already has the right palette.
// Night is the fallback when the OS reports no preference.
const toMode = (scheme: string | null | undefined): ThemeMode => (scheme === 'light' ? 'light' : 'dark')

interface ThemeStore {
  mode: ThemeMode
  colors: Palette
}

const initial = toMode(Appearance.getColorScheme())
export const useTheme = create<ThemeStore>(() => ({ mode: initial, colors: palettes[initial] }))

Appearance.addChangeListener(({ colorScheme }) => {
  const mode = toMode(colorScheme)
  useTheme.setState({ mode, colors: palettes[mode] })
})
