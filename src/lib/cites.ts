import type { Chunk, Source } from '../types'
import { clip } from './text'

export interface Resolver {
  chunk(id: string): Chunk | undefined
  source(id: string): Source | undefined
  sourceOf(chunkId: string): Source | undefined
  label(chunkId: string): string
  quote(chunkId: string, n?: number): string
}

export function makeResolver(chunks: Chunk[], sources: Source[]): Resolver {
  const cm = new Map(chunks.map((c) => [c.id, c]))
  const sm = new Map(sources.map((s) => [s.id, s]))
  return {
    chunk: (id) => cm.get(id),
    source: (id) => sm.get(id),
    sourceOf: (id) => {
      const c = cm.get(id)
      return c ? sm.get(c.sourceId) : undefined
    },
    label: (id) => {
      const c = cm.get(id)
      const s = c && sm.get(c.sourceId)
      if (!c || !s) return 'Removed source'
      return `${s.title}${c.page ? `, p. ${c.page}` : ''}`
    },
    quote: (id, n = 240) => clip(cm.get(id)?.text ?? '', n),
  }
}

/** Ordered, de-duplicated chunk ids referenced anywhere inside a content tree. */
export function collectCiteIds(content: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    const o = v as Record<string, unknown>
    if (Array.isArray(o.cites)) {
      for (const id of o.cites as string[]) if (!seen.has(id)) (seen.add(id), out.push(id))
    }
    for (const k of Object.keys(o)) if (k !== 'cites') walk(o[k])
  }
  walk(content)
  return out
}

export function numberer(ids: string[]) {
  const m = new Map(ids.map((id, i) => [id, i + 1]))
  return (id: string) => m.get(id) ?? 0
}
