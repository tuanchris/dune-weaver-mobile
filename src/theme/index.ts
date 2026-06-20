// Design tokens mirrored from the Dune Weaver web app (dark-first).
// Values converted from the web app's HSL CSS variables to hex for RN safety.

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
}

const dark: Palette = {
  background: '#1a1a1a', // hsl(0 0% 10%)
  card: '#2e2e2e', // hsl(0 0% 18%)
  cardElevated: '#3a3a3a',
  border: '#525252', // hsl(0 0% 32%)
  foreground: '#f8fafc', // hsl(210 40% 98%)
  mutedForeground: '#94a3b8', // hsl(215 20% 65%)
  primary: '#1d9bf0', // hsl(207 90% 50%)
  primaryForeground: '#ffffff',
  destructive: '#d13434', // hsl(0 63% 51%)
  destructiveForeground: '#ffffff',
  inputBackground: '#474747', // hsl(0 0% 28%)
  success: '#22c55e',
}

const light: Palette = {
  background: '#f7f8fa', // hsl(220 14% 98%)
  card: '#ffffff',
  cardElevated: '#ffffff',
  border: '#e2e8f0', // hsl(214 32% 91%)
  foreground: '#0a0f1c', // hsl(222 84% 5%)
  mutedForeground: '#64748b', // hsl(215 16% 47%)
  primary: '#1d9bf0',
  primaryForeground: '#ffffff',
  destructive: '#ef4444', // hsl(0 84% 60%)
  destructiveForeground: '#ffffff',
  inputBackground: '#f1f5f9',
  success: '#16a34a',
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
  // Plus Jakarta Sans in the web app; default system here unless the font is
  // added. Sizes/weights chosen to match the web app's hierarchy.
  weight: { regular: '400' as const, medium: '500' as const, semibold: '600' as const, bold: '700' as const },
  size: { xs: 11, sm: 13, md: 15, lg: 18, xl: 22, xxl: 28 },
}
