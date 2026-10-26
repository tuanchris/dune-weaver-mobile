// Native tab bar (iOS + Android) from react-navigation's UNSTABLE native tabs.
// It throws on web, so the desktop/web build uses AppTabs.web.tsx (JS tabs).
import React, { useEffect, useState } from 'react'
import { Platform, type ImageSourcePropType } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { createNativeBottomTabNavigator, type NativeBottomTabIcon } from '@react-navigation/bottom-tabs/unstable'
import { BrowseScreen } from '../screens/BrowseScreen'
import { PlaylistsScreen } from '../screens/PlaylistsScreen'
import { ControlScreen } from '../screens/ControlScreen'
import { LedScreen } from '../screens/LedScreen'
import { SettingsStack } from '../screens/settings/SettingsStack'
import { MiniPlayer } from './NowPlayingBar'
import { NATIVE_ACCESSORY } from '../lib/layout'
import { useTheme } from '../stores/useTheme'
import { useStatus } from '../stores/useStatus'
import { isActive } from '../api/status'
import type { TabParamList } from '../navigation'

type TabName = keyof TabParamList
const Tab = createNativeBottomTabNavigator<TabParamList>()

const SF: Record<TabName, NativeBottomTabIcon> = {
  Browse: { type: 'sfSymbol', name: 'square.grid.2x2.fill' },
  Playlists: { type: 'sfSymbol', name: 'music.note.list' },
  Control: { type: 'sfSymbol', name: 'slider.horizontal.3' },
  LEDs: { type: 'sfSymbol', name: 'lightbulb.fill' },
  Settings: { type: 'sfSymbol', name: 'gearshape.fill' },
}
const MATERIAL: Record<TabName, keyof typeof MaterialIcons.glyphMap> = {
  Browse: 'grid-view',
  Playlists: 'playlist-play',
  Control: 'tune',
  LEDs: 'lightbulb',
  Settings: 'settings',
}

// Android tab icons must be images: rasterize the same Material glyphs once
// (the bar tints them natively, so the source colour doesn't matter).
function useAndroidIcons(): Partial<Record<TabName, ImageSourcePropType>> {
  const [icons, setIcons] = useState<Partial<Record<TabName, ImageSourcePropType>>>({})
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const names = Object.keys(MATERIAL) as TabName[]
    const ink = useTheme.getState().colors.foreground
    Promise.all(names.map((n) => MaterialIcons.getImageSource(MATERIAL[n], 24, ink)))
      .then((srcs) => setIcons(Object.fromEntries(names.flatMap((n, i) => (srcs[i] ? [[n, srcs[i]]] : [])))))
      .catch(() => {})
  }, [])
  return icons
}

export interface AppTabsProps {
  /** Pending updates (app + firmware), shown as a count badge on Settings. */
  updateCount: number
}

export function AppTabs({ updateCount }: AppTabsProps): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const playing = useStatus((s) => isActive(s.status)) // boolean: re-renders only on flips
  const androidIcons = useAndroidIcons()
  return (
    <Tab.Navigator
      screenOptions={({ route }) => {
        const img = androidIcons[route.name]
        return {
          lazy: true, // native default is false: mounting all 5 would fire every screen's load in the launch burst
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.mutedForeground, // Android + iOS ≤ 18; iOS 26 uses the system colour
          tabBarLabelVisibilityMode: 'labeled', // Android: with 5 items 'auto' hides unselected labels
          tabBarIcon: Platform.OS === 'ios' ? SF[route.name] : img ? { type: 'image', source: img } : undefined,
          // A count, not '': an empty badge draws nothing on iOS. Colour = the theme's notification red.
          tabBarBadge: route.name === 'Settings' && updateCount > 0 ? updateCount : undefined,
          // undefined (not a null-returning fn) removes the glass capsule when nothing plays.
          bottomAccessory: NATIVE_ACCESSORY && playing ? ({ placement }) => <MiniPlayer placement={placement} /> : undefined,
        }
      }}
    >
      <Tab.Screen name="Browse" component={BrowseScreen} />
      <Tab.Screen name="Playlists" component={PlaylistsScreen} />
      <Tab.Screen name="Control" component={ControlScreen} />
      <Tab.Screen name="LEDs" component={LedScreen} />
      <Tab.Screen name="Settings" component={SettingsStack} />
    </Tab.Navigator>
  )
}
