import React from 'react'
import { Image, StyleSheet, Text, TextInput, View } from 'react-native'
import { useBranding, DEFAULT_BRAND } from '../../stores/useBranding'
import { useTheme } from '../../stores/useTheme'
import { toast } from '../../stores/useToast'
import { pickLogo, clearLogo } from '../../lib/branding'
import { Button, Card } from '../../components/ui'
import { SettingsPage } from './SettingsPage'
import { radius, spacing, font } from '../../theme'

/** App branding (custom name + logo), stored on this device only. */
export function BrandingSettings(): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const brand = useBranding((s) => s.name)
  const setBrandName = useBranding((s) => s.setName)
  const brandLogo = useBranding((s) => s.logoUri)
  const setBrandLogo = useBranding((s) => s.setLogo)

  const chooseLogo = async () => {
    try {
      const uri = await pickLogo()
      if (uri) {
        setBrandLogo(uri)
        toast.success('Logo updated')
      }
    } catch (e) {
      toast.error((e as Error).message || 'Could not load that image')
    }
  }
  const removeLogo = () => {
    clearLogo()
    setBrandLogo(null)
  }

  return (
    <SettingsPage title="Branding">
      <Card>
        <View style={styles.brandRow}>
          <Image source={brandLogo ? { uri: brandLogo } : require('../../../assets/dw-logo.png')} style={[styles.preview, { borderColor: colors.border }]} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Button title={brandLogo ? 'Change logo' : 'Choose logo'} icon="image" variant="secondary" onPress={chooseLogo} />
            {brandLogo ? <Button title="Remove logo" icon="close" variant="secondary" onPress={removeLogo} /> : null}
          </View>
        </View>
        <Text style={[styles.label, { color: colors.foreground }]}>App name</Text>
        <TextInput
          value={brand}
          onChangeText={setBrandName}
          placeholder={DEFAULT_BRAND}
          placeholderTextColor={colors.mutedForeground}
          style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
        />
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: spacing.sm }}>
          Shown in the app header and welcome screen. Stored on this device only.
        </Text>
      </Card>
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  preview: { width: 64, height: 64, borderRadius: 14, borderWidth: 1 },
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginTop: spacing.lg, marginBottom: spacing.sm },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 46, fontSize: font.size.md },
})
