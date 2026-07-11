import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeBase } from '../api/board'
import { DEMO_BASE, isDemoBase } from '../api/demoBoard'

const KEY = 'dw_boards_v1'

export interface Board {
  id: string
  name: string
  base: string // normalized http://host[:port]
  /** mDNS instance name (= firmware hostname, e.g. "DWG") when added via
   * discovery — identity fallback for firmware that doesn't report a MAC.
   * Also backfilled from /sand_status on newer firmware. */
  hostname?: string
  /** Lowercase STA MAC ("a0:b1:c2:d3:e4:f5") — the table's stable hardware
   * identity (firmware > v0.1.7; from the mDNS TXT record or /sand_status).
   * Preferred over hostname for dedupe and DHCP auto-relocate. */
  mac?: string
}

interface Persisted {
  boards: Board[]
  activeId: string | null
}

interface BoardsStore {
  boards: Board[]
  activeId: string | null
  hydrated: boolean
  hydrate: () => Promise<void>
  addBoard: (name: string, host: string, hostname?: string, mac?: string) => Board
  /** Add (or re-select) the in-app demo table — no hardware needed. */
  addDemoBoard: () => Board
  removeBoard: (id: string) => void
  renameBoard: (id: string, name: string) => void
  /** Point an existing board at a new address (DHCP gave the table a new IP). */
  updateBase: (id: string, host: string, hostname?: string, mac?: string) => void
  /** Backfill identity learned from a live /sand_status poll onto the board
   * with this base — lets manually-added (IP-only) boards gain the stable
   * hardware ID so discovery dedupe and auto-relocate work for them too. */
  noteIdentity: (base: string, mac?: string | null, hostname?: string | null) => void
  setActive: (id: string) => void
  getActive: () => Board | null
  getActiveBase: () => string | null
}

function persist(boards: Board[], activeId: string | null) {
  const data: Persisted = { boards, activeId }
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {})
}

function makeId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export const useBoards = create<BoardsStore>((set, get) => ({
  boards: [],
  activeId: null,
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      if (raw) {
        const data: Persisted = JSON.parse(raw)
        const boards = data.boards || []
        const activeId = data.activeId && boards.some((b) => b.id === data.activeId) ? data.activeId : boards[0]?.id ?? null
        set({ boards, activeId, hydrated: true })
        return
      }
    } catch {
      // ignore
    }
    set({ hydrated: true })
  },

  addBoard: (name, host, hostname, mac) => {
    const board: Board = { id: makeId(), name: name.trim() || host.trim(), base: normalizeBase(host), hostname, mac: mac?.toLowerCase() }
    const boards = [...get().boards, board]
    const activeId = get().activeId ?? board.id
    set({ boards, activeId })
    persist(boards, activeId)
    return board
  },

  addDemoBoard: () => {
    // Reuse the existing demo board if one's already present; never normalize
    // the sentinel base (normalizeBase would turn it into http://demo://…).
    const existing = get().boards.find((b) => isDemoBase(b.base))
    if (existing) {
      get().setActive(existing.id)
      return existing
    }
    const board: Board = { id: makeId(), name: 'Demo Table', base: DEMO_BASE }
    const boards = [...get().boards, board]
    set({ boards, activeId: board.id })
    persist(boards, board.id)
    return board
  },

  removeBoard: (id) => {
    const boards = get().boards.filter((b) => b.id !== id)
    let activeId = get().activeId
    if (activeId === id) activeId = boards[0]?.id ?? null
    set({ boards, activeId })
    persist(boards, activeId)
  },

  renameBoard: (id, name) => {
    const boards = get().boards.map((b) => (b.id === id ? { ...b, name: name.trim() || b.name } : b))
    set({ boards })
    persist(boards, get().activeId)
  },

  updateBase: (id, host, hostname, mac) => {
    const boards = get().boards.map((b) =>
      b.id === id ? { ...b, base: normalizeBase(host), hostname: hostname ?? b.hostname, mac: mac?.toLowerCase() ?? b.mac } : b
    )
    set({ boards })
    persist(boards, get().activeId)
  },

  noteIdentity: (base, mac, hostname) => {
    const m = mac?.toLowerCase()
    const boards = get().boards.map((b) => {
      if (b.base !== base) return b
      if ((!m || b.mac === m) && (!hostname || b.hostname === hostname)) return b
      return { ...b, mac: m ?? b.mac, hostname: hostname ?? b.hostname }
    })
    if (boards.some((b, i) => b !== get().boards[i])) {
      set({ boards })
      persist(boards, get().activeId)
    }
  },

  setActive: (id) => {
    set({ activeId: id })
    persist(get().boards, id)
  },

  getActive: () => {
    const { boards, activeId } = get()
    return boards.find((b) => b.id === activeId) ?? null
  },

  getActiveBase: () => get().getActive()?.base ?? null,
}))
