import { Platform } from 'react-native'
import { spacing } from '../theme'

/** The mini player rides in the native tab bar's `bottomAccessory` (iOS 26+).
 * Mirrors react-native-screens' (unexported) isIOS26OrHigher gate. Set false as
 * a kill switch: every platform then uses the in-flow fallback mini player. */
export const NATIVE_ACCESSORY = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26

/** Bottom padding for tab-screen scroll content. On iOS 26 content scrolls
 * under the glass tab bar + accessory; elsewhere the screen's safe area
 * already clears the bar. */
export const SCROLL_BOTTOM_PAD = NATIVE_ACCESSORY ? 160 : spacing.xl

/** Thumbnail grid for a container `width` wide (padded by `gap` each side):
 * ~140 pt per column, never fewer than 3 (3 at 375 pt, 7 at 1024 pt).
 * Screens pass the window width; grids inside a Sheet pass useSheetWidth(). */
export function thumbGrid(width: number, gap: number = spacing.md): { cols: number; thumb: number } {
  const inner = width - gap * 2
  const cols = Math.max(3, Math.floor(inner / 140))
  return { cols, thumb: Math.floor((inner - gap * (cols - 1)) / cols) }
}
