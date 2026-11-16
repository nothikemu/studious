import { jaccard, termPhrase, topSentences, type Analysis, type SentRec } from '../lib/analysis'
import { uid } from '../lib/ids'
import { pickDiverse, rankSentences } from '../lib/qa'
import { capitalize, clip, mulberry32, shuffle, stem } from '../lib/text'
import type {
  Block,
  DeckContent,
  DocContent,
  FlashContent,
  GlossaryContent,
  MapContent,
  MapNode,
  QuizContent,
  QuizQ,
  TableContent,
} from '../types'

export interface GenCtx {
  title: string
  chunkIds?: Set<string> // optional focus scope
  seed?: number
}

const blk = (kind: Block['kind'], text: string, cites: string[] = []): Block => ({ id: uid('b'), kind, text, cites: [...new Set(cites)] })

interface Group {
  key: string
  heading: string
  chunkIds: Set<string>
  sourceId: string
  order: number
}

function groups(a: Analysis, scope?: Set<string>): Group[] {
  const gs: Group[] = []
  const map = new Map<string, Group>()
  for (const c of a.chunks) {
    if (scope && !scope.has(c.id)) continue
    const srcTitle = a.sourceById.get(c.sourceId)?.title ?? 'Source'
    const heading = c.heading ?? `Main points — ${srcTitle}`
    const key = `${c.sourceId}|${heading}`
    let g = map.get(key)
    if (!g) {
      g = { key, heading, chunkIds: new Set(), sourceId: c.sourceId, order: gs.length }
      map.set(key, g)
      gs.push(g)
    }
    g.chunkIds.add(c.id)
  }
  return gs
}

function byDocOrder(a: Analysis, ss: SentRec[]): SentRec[] {
  const idx = new Map(a.chunks.map((c, i) => [c.id, i]))
  return ss.slice().sort((x, y) => (idx.get(x.chunkId)! - idx.get(y.chunkId)!) || x.id.localeCompare(y.id, undefined, { numeric: true }))
}

/** Consecutive sentences from the same passage share a block, so every citation sits next to what it supports. */
function citedParagraphs(sents: SentRec[]): Block[] {
  const out: Block[] = []
  let cur: { text: string[]; chunkId: string } | null = null
  const flush = () => cur && out.push(blk('p', cur.text.join(' '), [cur.chunkId]))
  for (const s of sents) {
    if (cur && cur.chunkId === s.chunkId) cur.text.push(s.text)
    else (flush(), (cur = { text: [s.text], chunkId: s.chunkId }))
  }
  flush()
  return out
}

// ---------------------------------------------------------------- Guide / Notes
export function genGuide(a: Analysis, ctx: GenCtx): DocContent {
  const blocks: Block[] = []
  const overview = byDocOrder(a, topSentences(a, { chunkIds: ctx.chunkIds, n: 3 }))
  if (overview.length) {
    blocks.push(blk('h2', 'Overview'))
    blocks.push(...citedParagraphs(overview))
  }
  const gs = groups(a, ctx.chunkIds)
  for (const g of gs) {
    const top = byDocOrder(a, topSentences(a, { chunkIds: g.chunkIds, n: 4 }))
    if (!top.length) continue
    blocks.push(blk('h2', g.heading))
    blocks.push(...citedParagraphs(top))
  }
  const defs = a.defs.filter((d) => !ctx.chunkIds || ctx.chunkIds.has(d.chunkId)).slice(0, 10)
  if (defs.length) {
    blocks.push(blk('h2', 'Key terms'))
    for (const d of defs) blocks.push(blk('li', `${d.term} — ${d.definition}`, [d.chunkId]))
  }
  const qs = a.terms.filter((t) => !ctx.chunkIds || t.chunkIds.some((c) => ctx.chunkIds!.has(c))).slice(0, 5)
  if (qs.length) {
    blocks.push(blk('h2', 'Check yourself'))
    for (const t of qs) blocks.push(blk('li', `Explain “${t.term}” in your own words, then check the source.`, t.chunkIds.slice(0, 1)))
  }
  return { blocks }
}

export function genNotes(a: Analysis, ctx: GenCtx): DocContent {
  const blocks: Block[] = []
  for (const g of groups(a, ctx.chunkIds)) {
    const top = byDocOrder(a, topSentences(a, { chunkIds: g.chunkIds, n: 4, minLen: 30 }))
    if (!top.length) continue
    blocks.push(blk('h2', g.heading))
    for (const s of top) blocks.push(blk('li', clip(s.text, 170), [s.chunkId]))
  }
  const keyTerms = a.terms.slice(0, 8)
  if (keyTerms.length) blocks.push(blk('h2', 'Cues'), blk('p', keyTerms.map((t) => t.term).join(' · '), keyTerms.flatMap((t) => t.chunkIds.slice(0, 1))))
  return { blocks }
}

// ---------------------------------------------------------------- Flashcards
export function genFlashcards(a: Analysis, ctx: GenCtx, count = 20): FlashContent {
  const cards: FlashContent['cards'] = []
  const used = new Set<string>()
  const inScope = (chunkId: string) => !ctx.chunkIds || ctx.chunkIds.has(chunkId)
  const termRank = new Map(a.terms.map((t, i) => [t.key, i]))
  const defs = a.defs
    .filter((d) => inScope(d.chunkId))
    .sort((x, y) => (termRank.get(stem(x.term)) ?? 999) - (termRank.get(stem(y.term)) ?? 999))
  for (const d of defs) {
    if (cards.length >= Math.ceil(count * 0.65)) break
    used.add(stem(d.term))
    cards.push({ id: uid('f'), front: `What ${d.plural ? 'are' : 'is'} ${d.lead ? d.lead + ' ' : ''}${termPhrase(a, d.term)}?`, back: d.sentence, cites: [d.chunkId] })
  }
  // cloze cards from the most central sentences that contain a key term
  const pool = topSentences(a, { chunkIds: ctx.chunkIds, n: count * 3, minLen: 50 })
  for (const s of pool) {
    if (cards.length >= count) break
    const t = a.terms.find((t) => t.nounish && !used.has(t.key) && s.terms.includes(t.key.split(' ')[0]) && new RegExp(`\\b${escapeRe(t.term)}`, 'i').test(s.text))
    if (!t) continue
    const blanked = s.text.replace(new RegExp(`\\b${escapeRe(t.term)}\\w*`, 'i'), '_____')
    if (blanked === s.text) continue
    used.add(t.key)
    cards.push({ id: uid('f'), front: blanked, back: `${t.term}\n\n${s.text}`, cites: [s.chunkId] })
  }
  return { cards }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------------------------------------------------------------- Quiz
export type Difficulty = 'easy' | 'medium' | 'hard' | 'mixed'

export function genQuiz(a: Analysis, ctx: GenCtx, count = 10, difficulty: Difficulty = 'mixed'): QuizContent {
  const rand = mulberry32(ctx.seed ?? 42)
  const inScope = (id: string) => !ctx.chunkIds || ctx.chunkIds.has(id)
  const defs = a.defs.filter((d) => inScope(d.chunkId))
  const termRank = new Map(a.terms.map((t, i) => [t.key, i]))
  const rank = (term: string) => termRank.get(stem(term)) ?? 999
  const questions: QuizQ[] = []
  const usedTerms = new Set<string>()

  const termPool = [
    ...new Set([
      ...defs.map((d) => d.term),
      ...a.terms.slice(0, 40).filter((t) => t.nounish && (t.key.includes(' ') || t.term.length >= 8)).map((t) => capitalize(t.term)),
    ]),
  ]
  const distractors = (correct: string, n: number, sameSource?: string): string[] => {
    const wc = correct.split(' ').length
    const cand = termPool.filter((t) => stem(t) !== stem(correct) && !stem(t).includes(stem(correct)) && !stem(correct).includes(stem(t)))
    const score = (t: string) => Math.abs(t.split(' ').length - wc) + rand() * 1.5 - (sameSource && defs.find((d) => d.term === t)?.sourceId === sameSource ? 1 : 0)
    return cand.sort((x, y) => score(x) - score(y)).slice(0, n)
  }

  const kinds: Array<'easy' | 'medium' | 'hard'> =
    difficulty === 'mixed' ? ['easy', 'medium', 'hard', 'medium', 'easy', 'hard', 'medium'] : [difficulty]

  const defsByRank = defs.slice().sort((x, y) => rank(x.term) - rank(y.term))
  let ki = 0
  let di = 0
  const clozePool = topSentences(a, { chunkIds: ctx.chunkIds, n: count * 4, minLen: 50 })
  let ci = 0
  let guard = 0
  while (questions.length < count && guard++ < count * 12) {
    const kind = kinds[ki++ % kinds.length]
    if (kind === 'medium') {
      // cloze
      let made = false
      while (ci < clozePool.length && !made) {
        const s = clozePool[ci++]
        const t = a.terms
            .filter((t) => t.nounish && !usedTerms.has(t.key) && new RegExp(`\\b${escapeRe(t.term)}`, 'i').test(s.text) && t.term.split(' ').length <= 3)
          .sort((x, y) => y.key.split(' ').length - x.key.split(' ').length)[0]
        if (!t) continue
        const m = new RegExp(`\\b${escapeRe(t.term)}\\w*`, 'i').exec(s.text)!
        const correct = capitalize(m[0]) === m[0] ? m[0] : m[0]
        const ds = distractors(t.term, 3, s.sourceId)
        if (ds.length < 3) continue
        const opts = shuffle([correct, ...ds.map((d) => (m[0][0] === m[0][0].toLowerCase() ? d.charAt(0).toLowerCase() + d.slice(1) : d))], rand)
        questions.push({
          id: uid('q'),
          prompt: `Fill in the blank: ${s.text.replace(m[0], '_____')}`,
          options: opts,
          answer: opts.indexOf(correct),
          explanation: s.text,
          cites: [s.chunkId],
          difficulty: 'medium',
        })
        usedTerms.add(t.key)
        made = true
      }
      if (made) continue
    }
    // definition-based (easy: term from description, hard: description from term)
    const d = defsByRank[di++]
    if (!d) {
      if (di > defsByRank.length + 2) break
      continue
    }
    if (usedTerms.has(stem(d.term))) continue
    const wantHard = kind === 'hard'
    if (wantHard) {
      const others = shuffle(defs.filter((o) => o !== d && stem(o.term) !== stem(d.term)), rand)
        .sort((x, y) => Math.abs(x.definition.length - d.definition.length) - Math.abs(y.definition.length - d.definition.length))
        .slice(0, 3)
      if (others.length < 3) continue
      const opts = shuffle([d.definition, ...others.map((o) => o.definition)].map((x) => clip(x, 150)), rand)
      questions.push({
        id: uid('q'),
        prompt: `Which description best fits “${d.term}”?`,
        options: opts,
        answer: opts.indexOf(clip(d.definition, 150)),
        explanation: d.sentence,
        cites: [d.chunkId],
        difficulty: 'hard',
      })
    } else {
      const ds = distractors(d.term, 3, d.sourceId)
      if (ds.length < 3) continue
      const opts = shuffle([d.term, ...ds], rand)
      questions.push({
        id: uid('q'),
        prompt: `Which term is described here? “${clip(d.definition, 200)}”`,
        options: opts,
        answer: opts.indexOf(d.term),
        explanation: d.sentence,
        cites: [d.chunkId],
        difficulty: 'easy',
      })
    }
    usedTerms.add(stem(d.term))
  }
  return { questions }
}

// ---------------------------------------------------------------- Mind map
export function genMindMap(a: Analysis, ctx: GenCtx): MapContent {
  const root: MapNode = { id: uid('n'), label: ctx.title, cites: [], children: [] }
  const gs = groups(a, ctx.chunkIds)
  const hasRealHeadings = a.chunks.some((c) => c.heading)
  const usedTerms = new Set<string>()
  const termsIn = (ids: Set<string>, n: number) => {
    const out = a.terms.filter((t) => t.nounish && !usedTerms.has(t.key) && t.chunkIds.some((c) => ids.has(c))).slice(0, n)
    out.forEach((t) => usedTerms.add(t.key))
    return out
  }

  const makeBranch = (label: string, ids: Set<string>): MapNode | null => {
    const kids: MapNode[] = []
    for (const t of termsIn(ids, 4)) {
      const sent = a.sents
        .filter((s) => ids.has(s.chunkId) && s.terms.includes(t.key.split(' ')[0]) && new RegExp(`\\b${escapeRe(t.term)}`, 'i').test(s.text))
        .sort((x, y) => y.score - x.score)[0]
      const leaf: MapNode[] = sent ? [{ id: uid('n'), label: clip(sent.text, 120), cites: [sent.chunkId], children: [] }] : []
      kids.push({ id: uid('n'), label: capitalize(t.term), cites: sent ? [sent.chunkId] : t.chunkIds.slice(0, 1), children: leaf })
    }
    if (!kids.length) return null
    return { id: uid('n'), label, cites: [...ids].slice(0, 1), children: kids }
  }

  if (hasRealHeadings) {
    for (const g of gs.slice(0, 10)) {
      const b = makeBranch(g.heading, g.chunkIds)
      if (b) root.children.push(b)
    }
  } else {
    const top = a.terms.filter((t) => t.nounish).slice(0, 6)
    for (const t of top) {
      const ids = new Set(t.chunkIds)
      const b = makeBranch(capitalize(t.term), ids)
      if (b) root.children.push(b)
    }
  }
  return { root }
}

// ---------------------------------------------------------------- Deck
export function genDeck(a: Analysis, ctx: GenCtx): DeckContent {
  const slides: DeckContent['slides'] = []
  const nSources = new Set(a.chunks.filter((c) => !ctx.chunkIds || ctx.chunkIds.has(c.id)).map((c) => c.sourceId)).size
  slides.push({ id: uid('s'), title: ctx.title, bullets: [{ text: `Built from ${nSources} source${nSources === 1 ? '' : 's'}`, cites: [] }], notes: 'Title slide.' })
  const gs = groups(a, ctx.chunkIds).filter((g) => topSentences(a, { chunkIds: g.chunkIds, n: 1 }).length)
  if (gs.length > 2) {
    slides.push({ id: uid('s'), title: 'Agenda', bullets: gs.slice(0, 8).map((g) => ({ text: g.heading, cites: [...g.chunkIds].slice(0, 1) })) })
  }
  for (const g of gs.slice(0, 10)) {
    const top = byDocOrder(a, topSentences(a, { chunkIds: g.chunkIds, n: 4, minLen: 30 }))
    slides.push({
      id: uid('s'),
      title: g.heading,
      bullets: top.map((s) => ({ text: clip(s.text, 130), cites: [s.chunkId] })),
      notes: top.map((s) => s.text).join(' '),
    })
  }
  const defs = a.defs.filter((d) => !ctx.chunkIds || ctx.chunkIds.has(d.chunkId)).slice(0, 6)
  if (defs.length) {
    slides.push({ id: uid('s'), title: 'Key terms', bullets: defs.map((d) => ({ text: `${d.term}: ${clip(d.definition, 100)}`, cites: [d.chunkId] })) })
  }
  const take = topSentences(a, { chunkIds: ctx.chunkIds, n: 3 })
  if (take.length) slides.push({ id: uid('s'), title: 'Key takeaways', bullets: take.map((s) => ({ text: clip(s.text, 130), cites: [s.chunkId] })) })
  return { slides }
}

// ---------------------------------------------------------------- Table
export interface TableParams {
  columns: string[]
  rowMode: 'sources' | 'terms'
  rowCount?: number
}

export const DEFAULT_TABLE_COLUMNS: Record<TableParams['rowMode'], string[]> = {
  sources: ['Core idea', 'Key terms', 'Definition', 'Example'],
  terms: ['Definition', 'Context'],
}

export function genTable(a: Analysis, ctx: GenCtx, p: TableParams): TableContent {
  const columns = p.columns.map((name) => ({ id: uid('c'), name }))
  const rows: TableContent['rows'] = []
  const cell = (colName: string, scope: Set<string>, subject?: string) => {
    const n = colName.trim().toLowerCase()
    const scopedSents = (set: Set<string>) => a.sents.filter((s) => set.has(s.chunkId))
    if (/^(core idea|main idea|summary|overview|purpose|key idea)$/.test(n) && !subject) {
      const s = topSentences(a, { chunkIds: scope, n: 1 })[0]
      return s ? { text: clip(s.text, 220), cites: [s.chunkId] } : empty()
    }
    if (/^key terms?$/.test(n) && !subject) {
      const ts = a.terms.filter((t) => t.chunkIds.some((c) => scope.has(c))).slice(0, 5)
      return ts.length ? { text: ts.map((t) => capitalize(t.term)).join(', '), cites: ts.flatMap((t) => t.chunkIds.filter((c) => scope.has(c)).slice(0, 1)).slice(0, 3) } : empty()
    }
    if (/^definitions?$/.test(n)) {
      const d = subject
        ? a.defs.find((d) => stem(d.term) === stem(subject))
        : a.defs.find((d) => scope.has(d.chunkId))
      if (d) return { text: clip(`${d.term}: ${d.definition}`, 240), cites: [d.chunkId] }
    }
    if (/^(context|where)/.test(n) && subject) {
      const t = a.terms.find((t) => t.term.toLowerCase() === subject.toLowerCase())
      const c = t && a.chunkById.get(t.chunkIds[0])
      if (c) return { text: `${a.sourceById.get(c.sourceId)?.title ?? ''}${c.heading ? ` › ${c.heading}` : ''}`, cites: [c.id] }
    }
    const query = `${subject ?? ''} ${colName}`
    const must = subject ? subject.split(/\s+/).map(stem) : undefined
    let ranked = rankSentences(a, query, { scope, mustContain: must })
    if (!ranked.length && must) ranked = rankSentences(a, query, { scope })
    void scopedSents
    const best = ranked[0]
    if (!best || best.matched < Math.max(1, best.total * 0.5)) return empty()
    return { text: clip(best.s.text, 240), cites: [best.s.chunkId] }
  }
  const empty = () => ({ text: '— not found in sources', cites: [] as string[] })

  if (p.rowMode === 'sources') {
    const bySource = new Map<string, Set<string>>()
    for (const c of a.chunks) {
      if (ctx.chunkIds && !ctx.chunkIds.has(c.id)) continue
      if (!bySource.has(c.sourceId)) bySource.set(c.sourceId, new Set())
      bySource.get(c.sourceId)!.add(c.id)
    }
    for (const [sid, scope] of bySource) {
      const row = { id: uid('r'), label: a.sourceById.get(sid)?.title ?? 'Source', sourceId: sid, cells: {} as Record<string, { text: string; cites: string[] }> }
      for (const col of columns) row.cells[col.id] = cell(col.name, scope)
      rows.push(row)
    }
  } else {
    const all = new Set(a.chunks.filter((c) => !ctx.chunkIds || ctx.chunkIds.has(c.id)).map((c) => c.id))
    for (const t of a.terms.slice(0, p.rowCount ?? 8)) {
      const row = { id: uid('r'), label: capitalize(t.term), cells: {} as Record<string, { text: string; cites: string[] }> }
      for (const col of columns) row.cells[col.id] = cell(col.name, all, t.term)
      rows.push(row)
    }
  }
  return { columns, rows }
}

// ---------------------------------------------------------------- Glossary
export function genGlossary(a: Analysis, ctx: GenCtx): GlossaryContent {
  const inScope = (id: string) => !ctx.chunkIds || ctx.chunkIds.has(id)
  const entries: GlossaryContent['entries'] = []
  const seen = new Set<string>()
  for (const d of a.defs.filter((d) => inScope(d.chunkId))) {
    seen.add(stem(d.term))
    entries.push({ id: uid('g'), term: d.term, definition: capitalize(d.definition) + (/[.!?]$/.test(d.definition) ? '' : '.'), cites: [d.chunkId], kind: 'term' })
  }
  for (const t of a.terms.filter((t) => t.nounish).slice(0, 40)) {
    if (entries.length >= 40) break
    if (seen.has(t.key) || t.key.split(' ').length > 2) continue
    if ([...seen].some((k) => k.includes(t.key) || t.key.includes(k))) continue
    const inDefs = a.defs.some((d) => d.sentence.toLowerCase().includes(t.term.toLowerCase()))
    if (!(t.key.includes(' ') || inDefs) || t.count < 2) continue
    const best = rankSentences(a, t.term, { scope: ctx.chunkIds, mustContain: t.key.split(' ') })[0]
    if (!best) continue
    seen.add(t.key)
    entries.push({ id: uid('g'), term: capitalize(t.term), definition: clip(best.s.text, 240), cites: [best.s.chunkId], kind: 'term' })
  }
  for (const f of a.formulas.filter((f) => inScope(f.chunkId))) {
    entries.push({ id: uid('g'), term: f.text.split(/=|→/)[0].trim().slice(0, 40) || 'Formula', definition: f.text, cites: [f.chunkId], kind: 'formula' })
  }
  entries.sort((x, y) => (x.kind === y.kind ? x.term.localeCompare(y.term) : x.kind === 'term' ? -1 : 1))
  return { entries }
}

export { pickDiverse, jaccard }
