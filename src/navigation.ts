import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs'
import type { RouteProp } from '@react-navigation/native'

/**
 * The bottom-tab routes (wired in App.tsx). Only Settings takes params: `focus`
 * deep-links a single card so another screen can send the user straight to the
 * control they need — the Browse "missing previews" banner uses it to land on
 * (and briefly highlight) "Pattern previews", which sits far down the screen.
 */
export type TabParamList = {
  Browse: undefined
  Playlists: undefined
  Control: undefined
  LEDs: undefined
  Settings: { focus?: 'previews' } | undefined
}

export type TabNav = BottomTabNavigationProp<TabParamList>
export type SettingsRoute = RouteProp<TabParamList, 'Settings'>
