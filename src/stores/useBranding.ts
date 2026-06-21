import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'dw_branding_v1'

export const DEFAULT_BRAND = 'Dune Weaver'

interface Persisted {
  name: string
  logoUri: string | null
}

interface BrandingStore {
  /** Custom app name; empty falls back to DEFAULT_BRAND at render. */
  name: string
  /** file:// of a user-chosen logo in document storage, or null for the bundled icon. */
  logoUri: string | null
  setName: (name: string) => void
  setLogo: (uri: string | null) => void
  hydrate: () => Promise<void>
}

export const useBranding = create<BrandingStore>((set, get) => {
  const save = () => {
    const { name, logoUri } = get()
    AsyncStorage.setItem(KEY, JSON.stringify({ name, logoUri } satisfies Persisted)).catch(() => {})
  }
  return {
    name: '',
    logoUri: null,
    setName: (name) => {
      set({ name })
      save()
    },
    setLogo: (logoUri) => {
      set({ logoUri })
      save()
    },
    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY)
        if (raw) {
          const d: Partial<Persisted> = JSON.parse(raw)
          set({ name: d.name ?? '', logoUri: d.logoUri ?? null })
        }
      } catch {
        // keep defaults
      }
    },
  }
})

/** The brand name to display (custom if set, else the default). */
export function brandName(name: string): string {
  return name.trim() || DEFAULT_BRAND
}
