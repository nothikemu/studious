import { createContext, useContext } from 'react'
import type { Resolver } from '../lib/cites'
import type { ChatMessage, Chunk, Notebook, Source, StudioItem } from '../types'

export interface NbData {
  notebook: Notebook
  sources: Source[]
  chunks: Chunk[]
  items: StudioItem[]
  messages: ChatMessage[]
  resolver: Resolver
}
export const NbCtx = createContext<NbData>(null as unknown as NbData)
export const useNb = () => useContext(NbCtx)
