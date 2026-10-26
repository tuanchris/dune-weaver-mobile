import type { NavigationProp, NavigatorScreenParams } from '@react-navigation/native'

/**
 * Settings is a stack inside its tab (screens/settings/SettingsStack.tsx): a
 * root list of rows, each opening one page. Other screens deep-link a page
 * with `navigate('Settings', { screen, initial: false })` — `initial: false`
 * keeps the root list underneath, so Back always lands on it.
 */
export type SettingsStackParamList = {
  SettingsHome: undefined
  // Saved on the table (locks while it draws, except Firmware).
  Playback: undefined
  StillSands: undefined
  Homing: undefined
  LedStrip: undefined
  Wifi: undefined
  Password: undefined
  Firmware: undefined
  // On this phone.
  Patterns: undefined
  Branding: undefined
  Diagnostics: undefined
  About: undefined
}

/** The bottom-tab routes (wired in AppTabs.tsx / AppTabs.web.tsx). */
export type TabParamList = {
  Browse: undefined
  Playlists: undefined
  Control: undefined
  LEDs: undefined
  Settings: NavigatorScreenParams<SettingsStackParamList> | undefined
}

// Navigator-agnostic: the same types serve the native tabs and the web JS tabs.
export type TabNav = NavigationProp<TabParamList>
export type SettingsNav = NavigationProp<SettingsStackParamList>
