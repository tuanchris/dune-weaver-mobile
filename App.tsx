import React, { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { View } from 'react-native'
import { NavigationContainer, DefaultTheme, DarkTheme, type Theme } from '@react-navigation/native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'

import { BrowseScreen } from './src/screens/BrowseScreen'
import { PlaylistsScreen } from './src/screens/PlaylistsScreen'
import { ControlScreen } from './src/screens/ControlScreen'
import { LedScreen } from './src/screens/LedScreen'
import { SettingsScreen } from './src/screens/SettingsScreen'
import { NowPlayingBar } from './src/components/NowPlayingBar'
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

const Tab = createBottomTabNavigator()

const ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  Browse: 'grid-view',
  Playlists: 'playlist-play',
  Control: 'tune',
  LEDs: 'lightbulb',
  Settings: 'settings',
}

export default function App() {
  const hydrateBoards = useBoards((s) => s.hydrate)
  const hydrateTheme = useTheme((s) => s.hydrate)
  const hydrateLibrary = useLibrary((s) => s.hydrate)
  const hydratePrefs = usePrefs((s) => s.hydrate)
  const hydrateBranding = useBranding((s) => s.hydrate)
  const hydratePreviews = usePreviews((s) => s.hydrate)
  const hydrated = useBoards((s) => s.hydrated)
  const boards = useBoards((s) => s.boards)
  const activeId = useBoards((s) => s.activeId)
  const setBase = useStatus((s) => s.setBase)
  const colors = useTheme((s) => s.colors)
  const mode = useTheme((s) => s.mode)

  // Follow the active table to a new IP when DHCP moves it (mDNS re-scan).
  useAutoRelocate()

  // Update-available dot on the Settings tab: a newer app in the store, or a
  // newer firmware release than what the active table reports.
  const appLatest = useUpdates((s) => s.appLatest)
  const fwLatest = useUpdates((s) => s.fwLatest)
  const tableFw = useStatus((s) => s.status?.fw ?? null)
  const updateDot = appUpdateAvailable(appLatest) || fwUpdateAvailable(fwLatest, tableFw)

  // Hydrate persisted state on launch.
  useEffect(() => {
    hydrateTheme()
    hydrateBoards()
    hydrateLibrary()
    hydratePrefs()
    hydrateBranding()
    hydratePreviews()
    useUpdates.getState().check() // best-effort; silently stays unknown offline
  }, [hydrateTheme, hydrateBoards, hydrateLibrary, hydratePrefs, hydrateBranding, hydratePreviews])

  // Point the status poller at the active board whenever it changes, and read
  // the on-table pattern manifest once for that board (heavy SD read — we don't
  // want it on every screen mount). Switching tables forces a fresh read.
  useEffect(() => {
    const base = useBoards.getState().getActiveBase()
    setBase(base)
    useLibrary.getState().loadTable(base, true)
    // Keep the table's clock correct so Still Sands fires on schedule: push the
    // device time/timezone if they differ (best-effort, once per active board).
    if (base) syncClock(base)
  }, [activeId, boards, setBase])

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

  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      {boards.length === 0 ? (
        <Onboarding />
      ) : (
        <NavigationContainer theme={navTheme}>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarActiveTintColor: colors.primary,
              tabBarInactiveTintColor: colors.mutedForeground,
              tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
              tabBarIcon: ({ color, size }) => (
                <View>
                  <MaterialIcons name={ICONS[route.name]} size={size} color={color} />
                  {route.name === 'Settings' && updateDot ? (
                    <View style={{ position: 'absolute', top: -1, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.destructive }} />
                  ) : null}
                </View>
              ),
            })}
          >
            <Tab.Screen name="Browse" component={BrowseScreen} />
            <Tab.Screen name="Playlists" component={PlaylistsScreen} />
            <Tab.Screen name="Control" component={ControlScreen} />
            <Tab.Screen name="LEDs" component={LedScreen} />
            <Tab.Screen name="Settings" component={SettingsScreen} />
          </Tab.Navigator>
          <NowPlayingBar />
        </NavigationContainer>
      )}
      <Toaster />
      <PreviewGenerator />
    </SafeAreaProvider>
  )
}
