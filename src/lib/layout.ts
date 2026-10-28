import { Platform, useWindowDimensions } from 'react-native'
import { create } from 'zustand'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { addHingeListener, getHinge, type Hinge } from 'expo-hinge'
import { spacing } from '../theme'

/** The mini player rides in the native tab bar's `bottomAccessory` (iOS 26+).
 * Mirrors react-native-screens' (unexported) isIOS26OrHigher gate. Set false as
 * a kill switch: every platform then uses the in-flow fallback mini player. */
export const NATIVE_ACCESSORY = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26

/** Bottom padding for tab-screen scroll content. On iOS 26 content scrolls
 * under the glass tab bar + accessory; elsewhere the screen's safe area
 * already clears the bar. */
export const SCROLL_BOTTOM_PAD = NATIVE_ACCESSORY ? 160 : spacing.xl

export interface Box { x: number; y: number; width: number; height: number }

// Half fold: the hinge partway open (iPhone Duo, Android foldables). The window
// keeps its size as the device folds, so the hinge is the only signal. Stored
// as one boolean so only a flip re-renders: the angle streams every degree.
const halfFolded = (h: Hinge | null): boolean => h?.status === 'partiallyOpen'

// Set by Screen's onLayouts. Every tab shares one tab bar, so one value serves
// them all. `width` = the content column; `box` = the safe area inside the
// system bars and the rail, in window points (a Screen fills the window).
const measured = create<{ width: number | null; box: Box | null; halfFold: boolean }>(() => ({ width: null, box: null, halfFold: halfFolded(getHinge()) }))
addHingeListener((e) => measured.setState({ halfFold: halfFolded(e.hinge) }))
export const setScreenWidth = (width: number): void => measured.setState({ width })
// Re-reads the hinge too: at import the window (where iOS reports it) may not exist yet.
export const setScreenBox = ({ x, y, width, height }: Box): void => measured.setState({ box: { x, y, width, height }, halfFold: halfFolded(getHinge()) })

/** The window split in two at the fold, one half showing the table (NowPlayingPane):
 *  - side by side: the open iPhone Duo held like a book (951 × 669 pt), or any window
 *    as roomy and wider than tall (iPad in landscape, a big desktop window). The pane
 *    takes the half away from the tab rail, so content stays beside its tab bar
 *    (HIG: controls near the content they affect).
 *  - stacked (`top`): open upright (669 × 951) and HALF FOLDED, like a laptop — the
 *    table on the standing half, the app on the flat one. Fully open upright it
 *    doesn't split: either half would be too short to be worth it.
 * Screen keeps `content`, and so do sheets — nothing covers the table. */
export interface Split {
  side: 'left' | 'right' | 'top'
  /** The pane, in window points: from the edge of Screen's box to the fold's gutter. */
  pane: Box
  /** Screen's half: the rest of its box, past the gutter. */
  content: Box
  /** How far `content` sits in from each edge of Screen's box — Screen's margins. */
  inset: { left: number; right: number; top: number }
}
const SPLIT_MIN = 600 // pt on the short side: the open Duo has 669, Split View windows and folded ≤ 480
// Laptop mode only: kept clear either side of the crease, which bends whatever sits on
// it (side by side the halves meet at the fold — the owner wants no gap there).
// ponytail: a guess, not measured — tune it on the device, or read the fold's own frame
// (its reserved region, react-native-reserved-regions) if it ever has to be exact.
const FOLD_GUTTER = 20
// Laptop mode's standing half (the "screen"), tuned on the device: it ends further above the crease.
const LID_GUTTER = 28

export function useSplit(): Split | null {
  const box = measured((s) => s.box)
  const halfFold = measured((s) => s.halfFold)
  const { width: W, height: H } = useWindowDimensions()
  const statusBar = useSafeAreaInsets().top // the window's own inset: the status bar, not the tab container's top region
  if (!box) return null
  const right = box.x + box.width
  const bottom = box.y + box.height
  const g = FOLD_GUTTER
  if (W > H && H >= SPLIT_MIN) {
    const fold = W / 2
    if (box.x >= fold || right <= fold) return null
    const leftHalf = { x: box.x, y: box.y, width: fold - box.x, height: box.height }
    const rightHalf = { x: fold, y: box.y, width: right - fold, height: box.height }
    // Rail on the right → pane on the left; rail on the left, or none → pane on the right.
    return W - right > box.x
      ? { side: 'left', pane: leftHalf, content: rightHalf, inset: { left: rightHalf.x - box.x, right: 0, top: 0 } }
      : { side: 'right', pane: rightHalf, content: leftHalf, inset: { left: 0, right: right - leftHalf.x - leftHalf.width, top: 0 } }
  }
  if (halfFold && H > W && W >= SPLIT_MIN) {
    const fold = H / 2
    if (box.y >= fold - LID_GUTTER || bottom <= fold + g) return null
    // Up from Screen's box top (it sits lower: the tab container's top region left a
    // dead strip over the table; not side by side, where on iPad that region is the
    // tab bar itself). iOS: to the very top — the Duo's status bar keeps to the top
    // right, and the pane's header leaves that corner free. Android's status bar has
    // icons on the left too: stop under it.
    const top = Platform.OS === 'ios' ? 0 : Math.min(box.y, statusBar)
    return {
      side: 'top',
      pane: { x: box.x, y: top, width: box.width, height: fold - LID_GUTTER - top },
      content: { x: box.x, y: fold + g, width: box.width, height: bottom - fold - g },
      inset: { left: 0, right: 0, top: fold + g - box.y },
    }
  }
  return null
}

/** Width to size a tab screen's content by (grids, heroes): the window minus
 * the side insets — iPhone Duo's 84 pt rail, where the tab bar sits folded or
 * open in landscape (on the left in Split View's left window) — and minus the
 * pane when split. The window's width until the first Screen has laid out; on
 * other iPhones they're equal. */
export function useScreenWidth(): number {
  const w = measured((s) => s.width)
  const { width } = useWindowDimensions()
  return w ?? width
}

/** Thumbnail grid for a container `width` wide (padded by `gap` each side):
 * ~140 pt per column, never fewer than 3 (3 at 375 pt, 6 at 1024 pt).
 * Screens pass useScreenWidth(); grids inside a Sheet pass useSheetWidth().
 * A rectangular table's tiles are wide and short (`rect`): ~190 pt, min 2.
 * Past the minimum the count is even, so iPhone Duo's fold falls between
 * columns, not through one (HIG, Designing for iPhone Duo › Reserved regions). */
export function thumbGrid(width: number, gap: number = spacing.md, rect = false): { cols: number; thumb: number } {
  const inner = width - gap * 2
  const min = rect ? 2 : 3
  const fit = Math.max(min, Math.floor(inner / (rect ? 190 : 140)))
  const cols = fit > min && fit % 2 ? fit - 1 : fit
  return { cols, thumb: Math.floor((inner - gap * (cols - 1)) / cols) }
}
