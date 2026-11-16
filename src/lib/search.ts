import MiniSearch from 'minisearch'
import type { Chunk } from '../types'
import { contentTerms, stem } from './text'

export interface Hit {
  chunk: Chunk
  score: number
}

export interface Retriever {
  search(query: string, k?: number): Hit[]
  /** Fraction (0..1) of query content-terms that appear in the best hits. */
  coverage(query: string, hits: Hit[]): number
  df(term: string): number
  size: number
}

export function buildRetriever(chunks: Chunk[]): Retriever {
  const ms = new MiniSearch<Chunk>({
    fields: ['text', 'heading'],
    storeFields: [],
    idField: 'id',
    processTerm: (t) => {
      const lower = t.toLowerCase()
      return lower.length < 2 ? null : stem(lower)
    },
    searchOptions: { boost: { heading: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'OR' },
  })
  ms.addAll(chunks.map((c) => ({ ...c, heading: c.heading ?? '' })))
  const byId = new Map(chunks.map((c) => [c.id, c]))
  const dfMap = new Map<string, number>()
  for (const c of chunks) for (const t of new Set(contentTerms(c.text).map(stem))) dfMap.set(t, (dfMap.get(t) ?? 0) + 1)

  return {
    size: chunks.length,
    df: (t) => dfMap.get(stem(t)) ?? 0,
    search(query, k = 6) {
      const terms = contentTerms(query)
      if (!terms.length) return []
      const res = ms.search(terms.join(' '))
      return res
        .slice(0, k)
        .map((r) => ({ chunk: byId.get(r.id as string)!, score: r.score }))
        .filter((h) => h.chunk)
    },
    coverage(query, hits) {
      const terms = [...new Set(contentTerms(query).map(stem))]
      if (!terms.length) return 0
      const hay = hits
        .slice(0, 4)
        .map((h) => contentTerms(h.chunk.text).map(stem))
        .flat()
      const set = new Set(hay)
      const found = terms.filter((t) => set.has(t) || [...set].some((h) => h.length >= 5 && t.length >= 5 && h.slice(0, 5) === t.slice(0, 5)))
      return found.length / terms.length
    },
  }
}
