import { requireOptionalNativeModule } from 'expo-modules-core'

/** Android only (null on iOS, web and older builds): see lib/syncService.ts. */
export const SyncServiceNative = requireOptionalNativeModule<{
  start(text: string): void
  update(text: string, percent: number): void
  stop(): void
}>('SyncService')
