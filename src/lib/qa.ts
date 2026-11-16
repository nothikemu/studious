import { jaccard, type Analysis, type SentRec } from './analysis'
import { contentTerms, stem } from './text'

const dfCache = new WeakMap<Analysis, Map<string, number>>()

function sentDf(a: Analysis): Map<string, number> {
  let m = dfCache.get(a)
  if (!m) {
    m = new Map()
    for (const s of a.sents) for (const t of new Set(s.terms)) m.set(t, (m.get(t) ?? 0) + 1)
    dfCache.set(a, m)
  }
  return m
}

export interface Ranked {
  s: SentRec
  score: number
  matched: number
  total: number
}

export function rankSentences(
  a: Analysis,
  query: string,
  opts: { scope?: Set<string>; chunkBoost?: Map<string, number>; defBias?: boolean; mustContain?: string[] } = {},
): Ranked[] {
  const q = [...new Set(contentTerms(query).map(stem))]
  if (!q.length) return []
  const df = sentDf(a)
  const N = Math.max(1, a.sents.length)
  const idf = (t: string) => Math.log(1 + N / (1 + (df.get(t) ?? 0)))
  const maxCentral = Math.max(1e-9, ...a.sents.map((s) => s.score))
  const defTerms = opts.defBias ? new Set(a.defs.map((d) => `${d.chunkId}|${d.sentence}`)) : null
  const out: Ranked[] = []
  for (const s of a.sents) {
    if (opts.scope && !opts.scope.has(s.chunkId)) continue
    if (opts.mustContain && !opts.mustContain.every((w) => s.terms.includes(w))) continue
    let sc = 0
    let matched = 0
    for (const t of q) {
      if (s.terms.includes(t)) {
        sc += idf(t)
        matched++
      } else if (t.length >= 5 && s.terms.some((x) => x.length >= 5 && x.slice(0, 5) === t.slice(0, 5))) {
        sc += idf(t) * 0.6
        matched += 0.6
      }
    }
    if (matched === 0) continue
    sc *= 1 + (opts.chunkBoost?.get(s.chunkId) ?? 0)
    if (defTerms?.has(`${s.chunkId}|${s.text}`)) sc *= 1.5
    sc += 0.25 * (s.score / maxCentral)
    if (s.text.length < 35) sc *= 0.5
    out.push({ s, score: sc, matched, total: q.length })
  }
  return out.sort((x, y) => y.score - x.score)
}

export function pickDiverse(ranked: Ranked[], n: number, maxPerChunk = 2): Ranked[] {
  const out: Ranked[] = []
  const perChunk = new Map<string, number>()
  for (const r of ranked) {
    if ((perChunk.get(r.s.chunkId) ?? 0) >= maxPerChunk) continue
    if (out.some((o) => jaccard(o.s.terms, r.s.terms) > 0.55)) continue
    out.push(r)
    perChunk.set(r.s.chunkId, (perChunk.get(r.s.chunkId) ?? 0) + 1)
    if (out.length >= n) break
  }
  return out
}
