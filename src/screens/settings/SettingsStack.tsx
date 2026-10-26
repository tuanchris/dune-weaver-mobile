// The Settings tab is a stack: a short list of rows (SettingsScreen) that each
// open one page, like iOS Settings. Headers are our own (Screen's `back` row),
// not the native nav bar, so safe areas and the iOS 26 tab accessory behave
// exactly as on every other tab. Re-tapping the Settings tab pops to the list
// (the tab navigators' default). Works under both the native tabs and the web
// JS tabs (native-stack has a web implementation).
import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { isDemoBase } from '../../api/demoBoard'
import { SettingsScreen } from '../SettingsScreen'
import { PlaybackSettings } from './PlaybackSettings'
import { HomingSettings } from './HomingSettings'
import { LedStripSettings } from './LedStripSettings'
import { PatternsSettings } from './PatternsSettings'
import { BrandingSettings } from './BrandingSettings'
import { SettingsPage, useActiveBase } from './SettingsPage'
import { StillSands } from '../../components/StillSands'
import { WifiCard } from '../../components/WifiCard'
import { SecurityCard } from '../../components/SecurityCard'
import { DiagnosticsCard } from '../../components/DiagnosticsCard'
import { FirmwareCard, AppVersionCard } from '../../components/UpdatesCard'
import type { SettingsStackParamList } from '../../navigation'

const Stack = createNativeStackNavigator<SettingsStackParamList>()

function StillSandsPage(): React.JSX.Element {
  const base = useActiveBase()
  return <SettingsPage title="Still Sands" table gated>{base ? <StillSands base={base} /> : null}</SettingsPage>
}

function WifiPage(): React.JSX.Element {
  const base = useActiveBase()
  return <SettingsPage title="Wi-Fi" table gated><WifiCard base={base} /></SettingsPage>
}

function PasswordPage(): React.JSX.Element {
  const base = useActiveBase()
  // The demo table has no lock to manage (the list hides its row too).
  return <SettingsPage title="Password" table gated>{base && !isDemoBase(base) ? <SecurityCard base={base} /> : null}</SettingsPage>
}

// Not gated: an update stops the running table itself, after saying so.
function FirmwarePage(): React.JSX.Element {
  const base = useActiveBase()
  return <SettingsPage title="Firmware" table>{base ? <FirmwareCard base={base} /> : null}</SettingsPage>
}

function DiagnosticsPage(): React.JSX.Element {
  const base = useActiveBase()
  return <SettingsPage title="Diagnostics"><DiagnosticsCard base={base} /></SettingsPage>
}

function AboutPage(): React.JSX.Element {
  return <SettingsPage title="About"><AppVersionCard /></SettingsPage>
}

export function SettingsStack(): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SettingsHome" component={SettingsScreen} />
      <Stack.Screen name="Playback" component={PlaybackSettings} />
      <Stack.Screen name="StillSands" component={StillSandsPage} />
      <Stack.Screen name="Homing" component={HomingSettings} />
      <Stack.Screen name="LedStrip" component={LedStripSettings} />
      <Stack.Screen name="Wifi" component={WifiPage} />
      <Stack.Screen name="Password" component={PasswordPage} />
      <Stack.Screen name="Firmware" component={FirmwarePage} />
      <Stack.Screen name="Patterns" component={PatternsSettings} />
      <Stack.Screen name="Branding" component={BrandingSettings} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsPage} />
      <Stack.Screen name="About" component={AboutPage} />
    </Stack.Navigator>
  )
}
