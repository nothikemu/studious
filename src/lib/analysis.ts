import type { Chunk, Source } from '../types'
import { capitalize, clip, contentTerms, splitSentences, stem, STOP, tokenize } from './text'

export interface SentRec {
  id: string
  chunkId: string
  sourceId: string
  heading?: string
  text: string
  score: number
  terms: string[] // stemmed content terms
}

export interface Term {
  term: string // display form
  key: string // normalized
  score: number
  count: number
  chunkIds: string[]
  nounish: boolean // usually follows a determiner/preposition => likely a noun phrase, safe to quiz on
}

export interface Def {
  term: string
  lead: string // leading article, e.g. "the"
  plural: boolean
  definition: string
  sentence: string
  chunkId: string
  sourceId: string
}

export interface Formula {
  text: string
  chunkId: string
  sourceId: string
}

export interface Analysis {
  chunks: Chunk[]
  sources: Source[]
  sents: SentRec[]
  terms: Term[]
  defs: Def[]
  formulas: Formula[]
  chunkById: Map<string, Chunk>
  sourceById: Map<string, Source>
}

const DEF_RES: RegExp[] = [
  // "Photosynthesis is the process by which ..."  (verb captured as group 2)
  /^((?:the |an? )?[A-Z][A-Za-z0-9\-’' ()/]{1,48}?)\s+(is|are|refers to|is defined as|are defined as|describes|means|denotes|is called|are called)\s+(?:the |an? |one of the )?(.{18,})$/,
  // "Term: definition"
  /^((?:the |an? )?[A-Z][A-Za-z0-9\-’' ()/]{1,40}):\s+()(.{18,})$/,
  // "Term — definition"
  /^((?:the |an? )?[A-Z][A-Za-z0-9\-’' ()/]{1,40})\s[—–-]\s()(.{18,})$/,
]
const KNOWN_AS = /^(.{12,}?)\s+(?:is|are)\s+(?:known as|called|termed|referred to as)\s+(the |an? )?([A-Za-z][A-Za-z\- ]{2,38}?)[.,;]?$/

const BAD_TERM_START = /^(this|that|these|those|it|there|here|which|what|when|where|who|how|one|some|many|most|each|every|another|such|in|on|at|for|by|with|if|as|overall|general|main|first|second|final|next|other|both|all|any)\b/i
const BAD_DEF_START = /^(known|called|termed|referred|split|used|found|made|given|being|seen|shown|considered|said|based|located|situated|produced|generated|released|not|also|often|usually|typically)\b/i

function plausibleTerm(t: string): boolean {
  const words = t.trim().split(/\s+/)
  if (words.length > 4 || words.length === 0) return false
  if (BAD_TERM_START.test(t)) return false
  if (STOP.has(words[0].toLowerCase()) && words.length === 1) return false
  if (/\b\w+ing\b/.test(words.slice(0, -1).join(' ')) && words.length > 2) return false // "The fluid surrounding the …"
  return true
}

function plausibleDef(d: string): boolean {
  if (BAD_DEF_START.test(d)) return false
  if (/[→=]/.test(d) || /^[A-Z0-9]{2,}\d/.test(d) || /^\d/.test(d)) return false
  if (/^\w+(ed|en)\s+(by|in|during|into|to|from|at|on|as)\b/i.test(d)) return false
  return true
}

function pickDefinition(sentence: string): { term: string; lead: string; plural: boolean; definition: string } | null {
  const s = sentence.trim()
  const k = KNOWN_AS.exec(s)
  if (k && plausibleTerm(k[3]) && plausibleDef(k[1])) return { term: k[3].trim(), lead: (k[2] ?? '').trim().toLowerCase(), plural: false, definition: k[1].trim() }
  for (const re of DEF_RES) {
    const m = re.exec(s)
    if (!m) continue
    const lead = /^(the|an?)\s+/i.exec(m[1])?.[1]?.toLowerCase() ?? ''
    const term = m[1].replace(/^(the|an?)\s+/i, '').replace(/\s*\(.*?\)\s*$/, '').trim()
    if (term && plausibleTerm(term) && plausibleDef(m[3])) {
      return { term, lead, plural: /^(are|were)/.test(m[2] ?? ''), definition: m[3].trim() }
    }
  }
  return null
}

const DET = new Set('the a an of in by each this these those its their from into across within between'.split(' '))

const GENERIC = new Set(
  'stage rate limit level process type form part result number set way system build thing kind case lot amount point group role effect factor step series state change increase decrease'.split(' ').map(stem),
)

const FORMULA_RE = /^[^.!?]{0,60}[A-Za-z0-9)\]]\s*(?:=|→|->|⟶)\s*[^=\n]{2,80}$/

export function analyze(chunks: Chunk[], sources: Source[]): Analysis {
  const chunkById = new Map(chunks.map((c) => [c.id, c]))
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const N = Math.max(1, chunks.length)

  // --- n-gram counts ---------------------------------------------------------
  const surface = new Map<string, Map<string, number>>() // key -> surface -> count
  const tf = new Map<string, number>()
  const detStart = new Map<string, number>()
  const dfSet = new Map<string, Set<string>>()
  const sents: SentRec[] = []

  const addGram = (words: string[], orig: string[], initial: boolean, afterDet: boolean, chunkId: string) => {
    const key = words.map((w) => stem(w)).join(' ')
    if (afterDet) detStart.set(key, (detStart.get(key) ?? 0) + 1)
    const o = orig.slice()
    if (initial && !/^[A-Z0-9]{2,}$/.test(o[0])) o[0] = o[0].toLowerCase()
    const disp = o.join(' ')
    tf.set(key, (tf.get(key) ?? 0) + 1)
    if (!dfSet.has(key)) dfSet.set(key, new Set())
    dfSet.get(key)!.add(chunkId)
    const m = surface.get(key) ?? new Map()
    m.set(disp, (m.get(disp) ?? 0) + 1)
    surface.set(key, m)
  }

  for (const c of chunks) {
    const ss = splitSentences(c.text)
    ss.forEach((s, i) => {
      const toks = s.text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*|[,.;:()]/gu) ?? []
      // phrases = maximal runs of non-stopword tokens
      let run: { lw: string; orig: string; idx: number }[] = []
      const endRun = () => {
        for (let n = 1; n <= 3; n++)
          for (let i2 = 0; i2 + n <= run.length; i2++) {
            const part = run.slice(i2, i2 + n)
            addGram(part.map((r) => r.lw), part.map((r) => r.orig), part[0].idx === 0, DET.has((toks[part[0].idx - 1] ?? '').toLowerCase()), c.id)
          }
        run = []
      }
      toks.forEach((t, idx) => {
        const lw = t.toLowerCase()
        const digitGroups = (lw.match(/\d+/g) ?? []).length
        if (/^[,.;:()]$/.test(t) || STOP.has(lw) || lw.length < 3 || /^\d/.test(lw) || digitGroups >= 2) endRun()
        else run.push({ lw, orig: t, idx })
      })
      endRun()
      sents.push({
        id: `${c.id}#${i}`,
        chunkId: c.id,
        sourceId: c.sourceId,
        heading: c.heading,
        text: s.text,
        score: 0,
        terms: contentTerms(s.text).map(stem),
      })
    })
  }

  // --- score terms -----------------------------------------------------------
  const headingWords = new Set(chunks.flatMap((c) => (c.heading ? contentTerms(c.heading).map(stem) : [])))
  const raw: Term[] = []
  for (const [key, count] of tf) {
    const words = key.split(' ')
    const df = dfSet.get(key)!.size
    if (count < 2 && !(words.length === 1 && headingWords.has(key))) continue
    if (words.length === 1 && (key.length < 4 || GENERIC.has(key))) continue
    const idf = Math.log(1 + N / df)
    const lenBoost = words.length === 1 ? 1 : words.length === 2 ? 1.5 : 1.7
    const hBoost = words.some((w) => headingWords.has(w)) ? 1.4 : 1
    const nounish = (detStart.get(key) ?? 0) / count >= 0.25 || words.some((w) => headingWords.has(w))
    const sf = surface.get(key)!
    const display = [...sf.entries()].sort((a, b) => b[1] - a[1])[0][0]
    raw.push({ term: display, key, count, nounish, score: count * idf * lenBoost * hBoost * (nounish ? 1 : 0.25), chunkIds: [...dfSet.get(key)!] })
  }
  raw.sort((a, b) => b.score - a.score)
  // drop unigrams that are almost always part of a kept longer phrase
  const multi = raw.filter((t) => t.key.includes(' ')).slice(0, 80)
  const kept: Term[] = []
  for (const t of raw) {
    if (!t.key.includes(' ')) {
      const dominated = multi.some((k) => k.key.split(' ').includes(t.key) && k.count >= t.count * 0.4)
      if (dominated) continue
    }
    kept.push(t)
    if (kept.length >= 120) break
  }
  const terms = kept

  // --- definitions & formulas -----------------------------------------------
  const defs: Def[] = []
  const seenDef = new Set<string>()
  const formulas: Formula[] = []
  for (const sr of sents) {
    const d = pickDefinition(sr.text)
    if (d && d.definition.length <= 280) {
      const k = stem(d.term)
      if (!seenDef.has(k)) {
        seenDef.add(k)
        defs.push({ term: capitalize(d.term), lead: d.lead, plural: d.plural, definition: clip(d.definition.replace(/[.]+$/, ''), 260), sentence: sr.text, chunkId: sr.chunkId, sourceId: sr.sourceId })
      }
    }
  }
  for (const c of chunks) {
    for (const line of c.text.split('\n')) {
      const l = line.trim()
      if (l.length < 40 && FORMULA_RE.test(l) && /[=→]/.test(l) && !/\b(is|are|was|were)\b/i.test(l)) {
        formulas.push({ text: l, chunkId: c.id, sourceId: c.sourceId })
      }
    }
  }

  // --- sentence centrality ---------------------------------------------------
  const defSentences = new Set(defs.map((d) => d.sentence))
  const termWeight = new Map(terms.slice(0, 60).map((t) => [t.key, t.score]))
  for (const sr of sents) {
    let sc = 0
    const seen = new Set<string>()
    const toks = tokenize(sr.text).filter((t) => !STOP.has(t))
    for (let i = 0; i < toks.length; i++) {
      for (let n = 1; n <= 3 && i + n <= toks.length; n++) {
        const key = toks.slice(i, i + n).map(stem).join(' ')
        if (termWeight.has(key) && !seen.has(key)) {
          seen.add(key)
          sc += termWeight.get(key)!
        }
      }
    }
    const len = sr.text.length
    const lenPenalty = len < 40 ? 0.3 : len > 320 ? 0.55 : 1
    sr.score = (sc / Math.sqrt(Math.max(8, toks.length))) * lenPenalty
    if (/^(for example|for instance|e\.g\.)/i.test(sr.text)) sr.score *= 0.7
    if (/^(both|this|these|those|it|they|its|their|such|each|another|the latter|the former|however|thus|therefore|also)\b/i.test(sr.text)) sr.score *= 0.35
    if (defSentences.has(sr.text)) sr.score *= 1.35
    if (/[→=]|\d[A-Z]|[A-Z]\d/.test(sr.text)) sr.score *= 0.4
    if (!/[.!?”"')]$/.test(sr.text)) sr.score *= 0.6
  }

  return { chunks, sources, sents, terms, defs, formulas, chunkById, sourceById }
}

export function topSentences(a: Analysis, opts: { chunkIds?: Set<string>; sourceId?: string; n: number; minLen?: number }): SentRec[] {
  const pool = a.sents.filter(
    (s) => (!opts.chunkIds || opts.chunkIds.has(s.chunkId)) && (!opts.sourceId || s.sourceId === opts.sourceId) && s.text.length >= (opts.minLen ?? 40),
  )
  const sorted = pool.slice().sort((x, y) => y.score - x.score)
  const out: SentRec[] = []
  for (const s of sorted) {
    // skip near-duplicates
    if (out.some((o) => jaccard(o.terms, s.terms) > 0.6)) continue
    out.push(s)
    if (out.length >= opts.n) break
  }
  return out
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a)
  const B = new Set(b)
  if (!A.size || !B.size) return 0
  let i = 0
  for (const x of A) if (B.has(x)) i++
  return i / (A.size + B.size - i)
}

export function sentencesContaining(a: Analysis, termKey: string): SentRec[] {
  const words = termKey.split(' ')
  return a.sents.filter((s) => words.every((w) => s.terms.includes(w)))
}

/** Display form of a term inside a sentence: lowercase common nouns, keep proper nouns and acronyms. */
export function termPhrase(a: Analysis, term: string): string {
  if (/^[A-Z0-9]{2,}/.test(term) && term === term.toUpperCase()) return term
  const lower = term.toLowerCase()
  if (term !== lower && corpus(a).includes(lower)) return lower
  const first = term.split(' ')[0]
  if (/^[A-Z][a-z]+$/.test(first) && /(tion|sis|ism|ity|ment|ysis|ar|ive|ic|al|ous|ing|ed|ase|ide|ics)$/.test(first.toLowerCase()) && !/[A-Z]/.test(term.slice(1))) return lower
  return term
}

const corpusCache = new WeakMap<Analysis, string>()
function corpus(a: Analysis): string {
  let c = corpusCache.get(a)
  if (!c) {
    c = a.chunks.map((x) => x.text).join('\n')
    corpusCache.set(a, c)
  }
  return c
}
