import { create } from 'zustand'
import { loadAiConfig, saveAiConfig } from './ai/config'
import type { AiConfig } from './types'

export type Route =
  | { name: 'library' }
  | { name: 'notebook'; id: string }
  | { name: 'review'; id?: string; item?: string }
  | { name: 'progress'; id: string }

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const item = new URLSearchParams(query).get('item') ?? undefined
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'n' && parts[1]) {
    if (parts[2] === 'review') return { name: 'review', id: parts[1], item }
    if (parts[2] === 'progress') return { name: 'progress', id: parts[1] }
    return { name: 'notebook', id: parts[1] }
  }
  if (parts[0] === 'review') return { name: 'review' }
  return { name: 'library' }
}

export function go(path: string) {
  location.hash = path
}

export type Theme = 'system' | 'light' | 'dark'
export type MobileTab = 'sources' | 'chat' | 'studio'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error' | 'success'
}

interface UI {
  route: Route
  theme: Theme
  setTheme: (t: Theme) => void
  ai: AiConfig
  setAi: (c: AiConfig) => void
  mobileTab: MobileTab
  setMobileTab: (t: MobileTab) => void
  reader: { sourceId: string; chunkId?: string; quote?: string; nonce: number } | null
  openReader: (sourceId: string, chunkId?: string, quote?: string) => void
  closeReader: () => void
  studioItemId: string | null
  openItem: (id: string | null) => void
  searchOpen: boolean
  setSearchOpen: (b: boolean) => void
  settingsOpen: boolean
  setSettingsOpen: (b: boolean) => void
  leftOpen: boolean
  rightOpen: boolean
  rightWide: boolean
  toggleLeft: () => void
  toggleRight: () => void
  setRightWide: (b: boolean) => void
  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: number) => void
}

const savedTheme = (): Theme => {
  try {
    const t = localStorage.getItem('studious.theme')
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

let toastId = 1

export const useUI = create<UI>((set, get) => ({
  route: parseHash(typeof location !== 'undefined' ? location.hash : ''),
  theme: savedTheme(),
  setTheme: (t) => {
    try {
      localStorage.setItem('studious.theme', t)
    } catch {
      /* ignore */
    }
    set({ theme: t })
  },
  ai: loadAiConfig(),
  setAi: (c) => {
    saveAiConfig(c)
    set({ ai: c })
  },
  mobileTab: 'chat',
  setMobileTab: (t) => set({ mobileTab: t }),
  reader: null,
  openReader: (sourceId, chunkId, quote) => set({ reader: { sourceId, chunkId, quote, nonce: Date.now() }, leftOpen: true, mobileTab: 'sources' }),
  closeReader: () => set({ reader: null }),
  studioItemId: null,
  openItem: (id) => set({ studioItemId: id, rightOpen: true, ...(id ? { mobileTab: 'studio' as const } : {}) }),
  searchOpen: false,
  setSearchOpen: (b) => set({ searchOpen: b }),
  settingsOpen: false,
  setSettingsOpen: (b) => set({ settingsOpen: b }),
  leftOpen: true,
  rightOpen: true,
  rightWide: false,
  toggleLeft: () => set({ leftOpen: !get().leftOpen }),
  toggleRight: () => set({ rightOpen: !get().rightOpen }),
  setRightWide: (b) => set({ rightWide: b }),
  toasts: [],
  toast: (text, tone = 'info') => {
    const id = toastId++
    set({ toasts: [...get().toasts, { id, text, tone }] })
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 8000 : 4000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    useUI.setState({ route: parseHash(location.hash), reader: null, studioItemId: null })
  })
}
