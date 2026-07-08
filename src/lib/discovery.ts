// mDNS / Bonjour discovery of Dune Weaver tables on the local network.
// The FluidNC firmware advertises `_http._tcp` with TXT `api=sandtable/1`,
// `model=dune-weaver` (hostname typically `fluidnc.local`). We browse that
// service type, keep only entries that look like a table, and build a base URL.
//
// Requires the native react-native-zeroconf module → only works in a dev/standalone
// build, never in stock Expo Go. The require is guarded so the JS bundle still
// loads (with `available === false`) if the native side is missing.

import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeBase } from '../api/board'

let Zeroconf: any = null
try {
  Zeroconf = require('react-native-zeroconf').default
} catch {
  Zeroconf = null
}

export interface DiscoveredTable {
  key: string
  name: string
  host: string
  address: string
  port: number
  base: string
}

const SCAN_TIMEOUT_MS = 12000

// Use the embedded DNSSD (jmDNS/Bonjour) engine rather than Android's NsdManager
// (the library default). NsdManager frequently discovers nothing and drops TXT
// records; DNSSD is consistent cross-device but needs CHANGE_WIFI_MULTICAST_STATE
// (declared in the manifest) so it can hold a multicast lock. No-op on iOS.
const IMPL = 'DNSSD'

const isIPv4 = (a: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a)

/** Does a resolved service look like a Dune Weaver table? */
function looksLikeTable(service: any): boolean {
  const txt = service?.txt ?? {}
  const model = String(txt.model ?? '').toLowerCase()
  const api = String(txt.api ?? '').toLowerCase()
  if (model === 'dune-weaver' || api.includes('sandtable')) return true
  // Fallback for platforms that don't surface TXT reliably: match the firmware's
  // default hostname / service name.
  const hay = `${service?.name ?? ''} ${service?.host ?? ''}`.toLowerCase()
  return /fluidnc|dune[-\s]?weaver|sand[-\s]?table/.test(hay)
}

function toTable(service: any): DiscoveredTable | null {
  const address: string | undefined = (service.addresses || []).find(isIPv4) || service.host
  if (!address) return null
  const port = typeof service.port === 'number' && service.port > 0 ? service.port : 80
  const base = normalizeBase(port === 80 ? address : `${address}:${port}`)
  const key = service.fullName || service.name || base
  return { key, name: service.name || address, host: service.host || '', address, port, base }
}

/**
 * One-shot scan, no hook: browse for tables for `timeoutMs`, then resolve with
 * whatever was found. Used by the auto-relocate flow when a saved table stops
 * answering (DHCP moved it). Resolves [] when the zeroconf native module is
 * unavailable (Expo Go).
 */
export function scanOnce(timeoutMs = 8000): Promise<DiscoveredTable[]> {
  return new Promise((resolve) => {
    if (!Zeroconf) {
      resolve([])
      return
    }
    const zc = new Zeroconf()
    const found = new Map<string, DiscoveredTable>()
    zc.on('resolved', (service: any) => {
      if (!looksLikeTable(service)) return
      const t = toTable(service)
      if (t) found.set(t.key, t)
    })
    zc.on('error', () => {})
    try {
      zc.scan('http', 'tcp', 'local.', IMPL)
    } catch {
      resolve([])
      return
    }
    setTimeout(() => {
      try {
        zc.stop(IMPL)
        zc.removeDeviceListeners?.()
      } catch {
        // ignore
      }
      resolve([...found.values()])
    }, timeoutMs)
  })
}

export function useDiscovery() {
  const available = !!Zeroconf
  const [scanning, setScanning] = useState(false)
  const [tables, setTables] = useState<DiscoveredTable[]>([])

  const zcRef = useRef<any>(null)
  const mapRef = useRef<Map<string, DiscoveredTable>>(new Map())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setScanning(false)
    try {
      zcRef.current?.stop(IMPL)
    } catch {
      // ignore
    }
  }, [])

  const start = useCallback(() => {
    if (!Zeroconf) return
    let zc = zcRef.current
    if (!zc) {
      zc = new Zeroconf()
      zcRef.current = zc
      zc.on('resolved', (service: any) => {
        if (!looksLikeTable(service)) return
        const t = toTable(service)
        if (!t) return
        mapRef.current.set(t.key, t)
        setTables([...mapRef.current.values()])
      })
      zc.on('remove', (name: string) => {
        for (const [k, v] of mapRef.current) {
          if (k === name || v.name === name) mapRef.current.delete(k)
        }
        setTables([...mapRef.current.values()])
      })
      zc.on('error', () => {})
    }
    mapRef.current.clear()
    setTables([])
    setScanning(true)
    try {
      zc.scan('http', 'tcp', 'local.', IMPL)
    } catch {
      setScanning(false)
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(stop, SCAN_TIMEOUT_MS)
  }, [stop])

  // Tear down the scan + listeners on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      try {
        zcRef.current?.stop(IMPL)
        zcRef.current?.removeDeviceListeners?.()
      } catch {
        // ignore
      }
    },
    []
  )

  return { available, scanning, tables, start, stop }
}
