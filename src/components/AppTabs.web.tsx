// Web/desktop tabs: the native tab navigator throws on web, so keep the JS one.
// Same props as AppTabs.tsx (Metro picks this file for web).
import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { MaterialIcons } from '@expo/vector-icons'
import { BrowseScreen } from '../screens/BrowseScreen'
import { PlaylistsScreen } from '../screens/PlaylistsScreen'
import { ControlScreen } from '../screens/ControlScreen'
import { LedScreen } from '../screens/LedScreen'
import { SettingsStack } from '../screens/settings/SettingsStack'
import { useTheme } from '../stores/useTheme'
import type { TabParamList } from '../navigation'
import type { AppTabsProps } from './AppTabs'

const Tab = createBottomTabNavigator<TabParamList>()

const ICONS: Record<keyof TabParamList, keyof typeof MaterialIcons.glyphMap> = {
  Browse: 'grid-view',
  Playlists: 'playlist-play',
  Control: 'tune',
  LEDs: 'lightbulb',
  Settings: 'settings',
}

export function AppTabs({ updateCount }: AppTabsProps): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarIcon: ({ color, size }) => <MaterialIcons name={ICONS[route.name]} size={size} color={color} />,
        // Default badge colour = the theme's notification red (not ember).
        tabBarBadge: route.name === 'Settings' && updateCount > 0 ? updateCount : undefined,
      })}
    >
      <Tab.Screen name="Browse" component={BrowseScreen} />
      <Tab.Screen name="Playlists" component={PlaylistsScreen} />
      <Tab.Screen name="Control" component={ControlScreen} />
      <Tab.Screen name="LEDs" component={LedScreen} />
      <Tab.Screen name="Settings" component={SettingsStack} />
    </Tab.Navigator>
  )
}
