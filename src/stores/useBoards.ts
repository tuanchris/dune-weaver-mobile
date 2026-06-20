import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { normalizeBase } from '../api/board'

const KEY = 'dw_boards_v1'

export interface Board {
  id: string
  name: string
  base: string // normalized http://host[:port]
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
  addBoard: (name: string, host: string) => Board
  removeBoard: (id: string) => void
  renameBoard: (id: string, name: string) => void
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

  addBoard: (name, host) => {
    const board: Board = { id: makeId(), name: name.trim() || host.trim(), base: normalizeBase(host) }
    const boards = [...get().boards, board]
    const activeId = get().activeId ?? board.id
    set({ boards, activeId })
    persist(boards, activeId)
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
