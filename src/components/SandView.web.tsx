// Web / desktop: no sand preview yet (react-native-webview is native-only), so
// Browse's preview stays the Fast player. ponytail: an <iframe> of the same page
// would bring it to the desktop app, with the clears served over http.
import type React from 'react'
import { sandTable, type SandTable } from '../lib/tableSize'

export const SAND = false
export const SAND_KEY = ''
export { sandTable, type SandTable }
export interface SandState { f: number; playing: boolean; phase: 'loading' | 'clearing' | 'simulating' | 'ready' }
export interface SandHandle { play(): void; pause(): void; seek(f: number): void; speed(x: number): void }
export const SandView = (_props: { name: string; table: SandTable; size: number; onState?: (s: SandState) => void; still?: number; onStill?: (dataUrl: string) => void; onError: (message: string) => void; ref?: React.Ref<SandHandle> }): null => null
