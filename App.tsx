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
import { syncClock } from './src/lib/clock'

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
  const hydrated = useBoards((s) => s.hydrated)
  const boards = useBoards((s) => s.boards)
  const activeId = useBoards((s) => s.activeId)
  const setBase = useStatus((s) => s.setBase)
  const colors = useTheme((s) => s.colors)
  const mode = useTheme((s) => s.mode)

  // Hydrate persisted state on launch.
  useEffect(() => {
    hydrateTheme()
    hydrateBoards()
    hydrateLibrary()
    hydratePrefs()
    hydrateBranding()
  }, [hydrateTheme, hydrateBoards, hydrateLibrary, hydratePrefs, hydrateBranding])

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
              tabBarIcon: ({ color, size }) => <MaterialIcons name={ICONS[route.name]} size={size} color={color} />,
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
