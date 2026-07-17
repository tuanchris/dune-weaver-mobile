// Design tokens — the "table from above, at night" direction.
// Warm basalt/sand palette grounded in the physical table (sand, walnut,
// lamplight) instead of the old neutral-gray + stock-blue web mirror.
// Render/spec: see the design-direction artifact (dw-design-language memory).

export type ThemeMode = 'dark' | 'light'

export interface Palette {
  background: string
  card: string
  cardElevated: string
  border: string
  foreground: string
  mutedForeground: string
  primary: string
  primaryForeground: string
  destructive: string
  destructiveForeground: string
  inputBackground: string
  success: string
  /** Things that are actually happening on the table right now (progress
   * fills, the live ball, connect pulse). Distinct from `primary` so "go do
   * this" (sand) never reads the same as "this is running" (patina). */
  live: string
}

// Night — default. Basalt ground, walnut cards, lit-sand ink, dune accent.
const dark: Palette = {
  background: '#171310',
  card: '#211C17',
  cardElevated: '#2B241D',
  border: '#352D23',
  foreground: '#F2EAD9',
  mutedForeground: '#A08F77',
  primary: '#D9B98A',
  primaryForeground: '#221A0F',
  destructive: '#D97A66',
  destructiveForeground: '#221A0F',
  inputBackground: '#2B241D',
  success: '#8FBF7F',
  live: '#7BC4B0',
}

// Day — fine-sand paper, not an inversion; accent deepened to hold AA contrast.
const light: Palette = {
  background: '#F5EFE6',
  card: '#FDFAF4',
  cardElevated: '#EDE4D4',
  border: '#E2D6C2',
  foreground: '#292219',
  mutedForeground: '#8A7A63',
  primary: '#A87F45',
  primaryForeground: '#FFF9EE',
  destructive: '#BC5843',
  destructiveForeground: '#FFF9EE',
  inputBackground: '#EDE4D4',
  success: '#5E9950',
  live: '#35836F',
}

export const palettes: Record<ThemeMode, Palette> = { dark, light }

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
}

export const font = {
  weight: { regular: '400' as const, medium: '500' as const, semibold: '600' as const, bold: '700' as const },
  size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 },
  // Three roles (loaded in App.tsx via expo-font; body text stays the system
  // face so controls keep the native feel):
  //  - display: screen titles, pattern names, the state word. Use sparingly.
  //  - mono:    telemetry — elapsed/%, feed rate, θ/ρ, IPs, versions, logs.
  family: {
    display: 'BricolageGrotesque_700Bold',
    displaySemi: 'BricolageGrotesque_600SemiBold',
    mono: 'IBMPlexMono_400Regular',
    monoMedium: 'IBMPlexMono_500Medium',
  },
}
