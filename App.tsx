import React, { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { AppState, View } from 'react-native'
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import { BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque'
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono'

import { AppTabs } from './src/components/AppTabs'
import { NowPlayingSheet } from './src/components/NowPlayingBar'
import { Toaster } from './src/components/Toaster'
import { Onboarding } from './src/components/Onboarding'
import { PreviewGenerator } from './src/components/PreviewGenerator'
import { useBoards } from './src/stores/useBoards'
import { useStatus } from './src/stores/useStatus'
import { useTheme } from './src/stores/useTheme'
import { useLibrary } from './src/stores/useLibrary'
import { usePrefs } from './src/stores/usePrefs'
import { useBranding } from './src/stores/useBranding'
import { usePreviews } from './src/stores/usePreviews'
import { useUpdates, appUpdateAvailable, fwUpdateAvailable } from './src/stores/useUpdates'
import { syncClock } from './src/lib/clock'
import { useAutoRelocate } from './src/lib/relocate'
import { useTableLogSync } from './src/lib/tableLogSync'
import { useFavoritesPlaylistSync } from './src/lib/favoritesPlaylist'
import { useCatalogRefreshOnIdle } from './src/lib/catalogRefresh'
import { initAppLog } from './src/stores/useAppLog'

export default function App() {
  // Display + telemetry faces (body text stays the system font). Gate render on
  // this alongside hydration — Android silently drops unknown fontFamily names.
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  })
  const hydrateBoards = useBoards((s) => s.hydrate)
  const hydrateLibrary = useLibrary((s) => s.hydrate)
  const hydratePrefs = usePrefs((s) => s.hydrate)
  const hydrateBranding = useBranding((s) => s.hydrate)
  const hydratePreviews = usePreviews((s) => s.hydrate)
  const hydrated = useBoards((s) => s.hydrated)
  const boards = useBoards((s) => s.boards)
  // The active board's base URL. A stable string selector: it does NOT change
  // when the poller backfills MAC/hostname onto the board (noteIdentity), so the
  // launch effect below fires ONCE instead of a second full burst ~1s in.
  const activeBase = useBoards((s) => s.getActiveBase())
  const setBase = useStatus((s) => s.setBase)
  const colors = useTheme((s) => s.colors)
  const mode = useTheme((s) => s.mode)

  // Follow the active table to a new IP when DHCP moves it (mDNS re-scan).
  useAutoRelocate()

  // NOTE: preview-bundle sync is MANUAL only (Settings → "Sync previews from
  // table"). It used to run automatically once per table per session; the owner
  // wants it explicit so the app never reads the card's bundle on its own.
  useTableLogSync()
  useFavoritesPlaylistSync()
  useCatalogRefreshOnIdle()

  // Count badge on the Settings tab: a newer app in the store, and/or a newer
  // firmware release than what the active table reports (0–2).
  const appLatest = useUpdates((s) => s.appLatest)
  const fwLatest = useUpdates((s) => s.fwLatest)
  const tableFw = useStatus((s) => s.status?.fw ?? null)
  const updateCount = Number(appUpdateAvailable(appLatest)) + Number(fwUpdateAvailable(fwLatest, tableFw))

  // Hydrate persisted state on launch.
  useEffect(() => {
    void initAppLog() // diagnostics ring buffer + uncaught-error hook
    hydrateBoards()
    hydrateLibrary()
    hydratePrefs()
    hydrateBranding()
    hydratePreviews()
    useUpdates.getState().check() // best-effort; silently stays unknown offline
  }, [hydrateBoards, hydrateLibrary, hydratePrefs, hydrateBranding, hydratePreviews])

  // Point the status poller at the active board whenever it changes, and select
  // that board's on-table view (patterns + playlists) from the persisted cache.
  // loadTable is now stale-while-revalidate: it shows the cached catalog and
  // only hits the board on the first-ever load — a heavy SD read no longer runs
  // on every launch (pull-to-refresh in Browse re-reads on demand).
  useEffect(() => {
    setBase(activeBase)
    useLibrary.getState().loadTable(activeBase)
    useLibrary.getState().loadPlaylists(activeBase)
    // Keep the table's clock correct so Still Sands fires on schedule: push the
    // device time/timezone if they differ (best-effort, once per active board).
    if (activeBase) syncClock(activeBase)
  }, [activeBase, setBase])

  // Pause the 1 Hz status poll while the app is backgrounded (no point hitting
  // the board when nothing's on screen), and snap back with an immediate poll on
  // foreground so the UI is fresh instead of waiting up to a second.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') useStatus.getState().resume()
      else useStatus.getState().suspend()
    })
    return () => sub.remove()
  }, [])

  // `notification` deliberately stays the base theme's red: it colours the
  // Settings update badge, and ember means destructive/error only.
  const navTheme: Theme = {
    ...(mode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(mode === 'dark' ? DarkTheme : DefaultTheme).colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.foreground,
      border: colors.border,
    },
  }

  if (!hydrated || !fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {boards.length === 0 ? (
        <Onboarding />
      ) : (
        <NavigationContainer theme={navTheme}>
          <AppTabs updateCount={updateCount} />
          {/* The expanded player sheet, mounted once (the mini player lives in the tabs). */}
          <NowPlayingSheet />
        </NavigationContainer>
      )}
      <Toaster />
      <PreviewGenerator />
    </SafeAreaProvider>
  )
}
