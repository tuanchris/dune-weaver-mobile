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
   * discovery — the stable identity used to re-find the table after a DHCP
   * address change. Absent on manually-added boards. */
  hostname?: string
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
  addBoard: (name: string, host: string, hostname?: string) => Board
  /** Add (or re-select) the in-app demo table — no hardware needed. */
  addDemoBoard: () => Board
  removeBoard: (id: string) => void
  renameBoard: (id: string, name: string) => void
  /** Point an existing board at a new address (DHCP gave the table a new IP). */
  updateBase: (id: string, host: string, hostname?: string) => void
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

  addBoard: (name, host, hostname) => {
    const board: Board = { id: makeId(), name: name.trim() || host.trim(), base: normalizeBase(host), hostname }
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

  updateBase: (id, host, hostname) => {
    const boards = get().boards.map((b) =>
      b.id === id ? { ...b, base: normalizeBase(host), hostname: hostname ?? b.hostname } : b
    )
    set({ boards })
    persist(boards, get().activeId)
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
