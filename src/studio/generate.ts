import { buildContext } from '../ai/llm'
import { isRemote } from '../ai/config'
import { db } from '../db'
import { analyze } from '../lib/analysis'
import { uid } from '../lib/ids'
import { buildRetriever } from '../lib/search'
import { newCard, DEFAULT_PREFS } from '../lib/srs'
import type { AiConfig, Block, ChatSegment, FlashContent, GlossaryContent, QuizQ, StudioItem, StudioKind, TableContent } from '../types'
import { STUDIO_META } from './meta'
import {
  DEFAULT_TABLE_COLUMNS,
  genDeck,
  genFlashcards,
  genGlossary,
  genGuide,
  genMindMap,
  genNotes,
  genQuiz,
  genTable,
  type Difficulty,
} from './offline'
import { remoteGenerate } from './remote'

export interface GenParams {
  count?: number
  difficulty?: Difficulty | 'adaptive'
  focus?: string
  columns?: string[]
  rowMode?: 'sources' | 'terms'
  sourceIds?: string[]
}

export interface GenResult {
  item: StudioItem
  note?: string
}

export async function adaptiveDifficulty(notebookId: string): Promise<Difficulty> {
  const recent = (await db.attempts.where('notebookId').equals(notebookId).sortBy('at')).slice(-30)
  if (recent.length < 5) return 'mixed'
  const acc = recent.filter((a) => a.correct).length / recent.length
  return acc < 0.55 ? 'easy' : acc < 0.8 ? 'mixed' : 'hard'
}

export async function generateStudio(notebookId: string, kind: StudioKind, params: GenParams, cfg: AiConfig): Promise<GenResult> {
  const nb = await db.notebooks.get(notebookId)
  if (!nb) throw new Error('Notebook not found.')
  const allSources = (await db.sources.where('notebookId').equals(notebookId).toArray()).filter((s) => s.enabled && (!params.sourceIds || params.sourceIds.includes(s.id)))
  if (!allSources.length) throw new Error('Turn on at least one source first.')
  const ids = new Set(allSources.map((s) => s.id))
  const chunks = (await db.chunks.where('notebookId').equals(notebookId).toArray()).filter((c) => ids.has(c.sourceId)).sort((a, b) => (a.sourceId === b.sourceId ? a.index - b.index : ids.size ? [...ids].indexOf(a.sourceId) - [...ids].indexOf(b.sourceId) : 0))
  if (!chunks.length) throw new Error('These sources have no readable text yet.')

  let scope: Set<string> | undefined
  const focus = params.focus?.trim()
  if (focus) {
    const hits = buildRetriever(chunks).search(focus, 10)
    if (!hits.length) throw new Error(`Nothing in your sources matches “${focus}”. Try a different focus.`)
    scope = new Set(hits.map((h) => h.chunk.id))
  }
  const scoped = scope ? chunks.filter((c) => scope!.has(c.id)) : chunks
  const a = analyze(scoped, allSources)
  const ctx = { title: nb.title, chunkIds: scope, seed: Date.now() % 100000 }
  const difficulty = params.difficulty === 'adaptive' ? await adaptiveDifficulty(notebookId) : (params.difficulty ?? 'mixed')
  const tableParams = {
    rowMode: params.rowMode ?? 'sources',
    columns: params.columns?.length ? params.columns : DEFAULT_TABLE_COLUMNS[params.rowMode ?? 'sources'],
    rowCount: 8,
  }

  let content: unknown
  let mode: 'offline' | 'llm' = 'offline'
  let note: string | undefined
  if (isRemote(cfg)) {
    try {
      const titleOf = (sid: string) => a.sourceById.get(sid)?.title ?? 'Source'
      const lc = buildContext(scoped, titleOf)
      content = await remoteGenerate(kind, lc, cfg, nb.prefs, { ...params, ...tableParams, difficulty }, nb.title)
      mode = 'llm'
    } catch (e) {
      note = `Model unavailable (${(e as Error).message}) — generated offline instead.`
    }
  }
  if (!content) {
    switch (kind) {
      case 'guide': content = genGuide(a, ctx); break
      case 'notes': content = genNotes(a, ctx); break
      case 'flashcards': content = genFlashcards(a, ctx, params.count ?? 20); break
      case 'quiz': content = genQuiz(a, ctx, params.count ?? 10, difficulty as Difficulty); break
      case 'mindmap': content = genMindMap(a, ctx); break
      case 'deck': content = genDeck(a, ctx); break
      case 'table': content = genTable(a, ctx, tableParams); break
      case 'glossary': content = genGlossary(a, ctx); break
    }
  }
  assertUseful(kind, content, focus)

  const now = Date.now()
  const label = STUDIO_META[kind].label
  const item: StudioItem = {
    id: uid('i_'),
    notebookId,
    kind,
    title: focus ? `${label} — ${focus}` : label,
    createdAt: now,
    updatedAt: now,
    mode,
    sourceIds: [...ids],
    params: { ...params, difficulty },
    content,
  }
  await db.transaction('rw', [db.items, db.cards, db.notebooks], async () => {
    await db.items.add(item)
    if (kind === 'flashcards') {
      const fc = content as FlashContent
      fc.cards.forEach((c) => (c.cardId = uid('c_')))
      await db.items.update(item.id, { content: fc })
      await db.cards.bulkAdd(fc.cards.map((c) => newCard({ id: c.cardId!, notebookId, itemId: item.id, front: c.front, back: c.back, cites: c.cites, origin: 'flashcards' })))
    }
    await db.notebooks.update(notebookId, { updatedAt: now })
  })
  return { item, note }
}

function assertUseful(kind: StudioKind, c: any, focus?: string) {
  const empty =
    (kind === 'guide' || kind === 'notes') ? !c.blocks?.length
    : kind === 'flashcards' ? !c.cards?.length
    : kind === 'quiz' ? !c.questions?.length
    : kind === 'mindmap' ? !c.root?.children?.length
    : kind === 'deck' ? (c.slides?.length ?? 0) < 2
    : kind === 'table' ? !c.rows?.length
    : !c.entries?.length
  if (empty) {
    throw new Error(
      `Not enough material to build ${STUDIO_META[kind].noun === 'table' ? 'a table' : 'a ' + STUDIO_META[kind].noun}${focus ? ` about “${focus}”` : ''}. Add a longer source, or broaden the focus.`,
    )
  }
}

export async function saveToNotes(notebookId: string, heading: string, segments: ChatSegment[]) {
  const now = Date.now()
  let item = (await db.items.where('notebookId').equals(notebookId).filter((i) => i.kind === 'notes' && i.params.manual === true).first()) as StudioItem<{ blocks: Block[] }> | undefined
  const blocks: Block[] = [
    { id: uid('b'), kind: 'h3', text: heading, cites: [] },
    ...segments.map((s) => ({ id: uid('b'), kind: 'p' as const, text: s.text, cites: s.cites })),
  ]
  if (!item) {
    item = { id: uid('i_'), notebookId, kind: 'notes', title: 'My notes', createdAt: now, updatedAt: now, mode: 'offline', sourceIds: [], params: { manual: true }, content: { blocks } }
    await db.items.add(item)
  } else {
    await db.items.update(item.id, { content: { blocks: [...item.content.blocks, ...blocks] }, updatedAt: now })
  }
  return item.id
}

/** Closes the loop: a missed quiz question becomes a scheduled card that points at the source passage. */
export async function questionToCard(notebookId: string, q: QuizQ, itemId?: string) {
  const exists = await db.cards.where('notebookId').equals(notebookId).filter((c) => c.origin === 'quiz' && c.front === q.prompt).first()
  if (exists) return exists.id
  const card = newCard({
    id: uid('c_'),
    notebookId,
    itemId,
    front: q.prompt,
    back: `${q.options[q.answer]}\n\n${q.explanation}`,
    cites: q.cites,
    origin: 'quiz',
  })
  await db.cards.add(card)
  return card.id
}

export async function createNotebook(title: string): Promise<string> {
  const id = uid('nb_')
  const now = Date.now()
  await db.notebooks.add({ id, title: title.trim() || 'Untitled notebook', createdAt: now, updatedAt: now, lastOpenedAt: now, prefs: { ...DEFAULT_PREFS } })
  return id
}

export async function addTableColumn(itemId: string, name: string) {
  const item = (await db.items.get(itemId)) as StudioItem<TableContent> | undefined
  if (!item) throw new Error('Table not found.')
  const ids = new Set(item.sourceIds)
  const sources = (await db.sources.where('notebookId').equals(item.notebookId).toArray()).filter((s) => ids.has(s.id))
  const chunks = (await db.chunks.where('notebookId').equals(item.notebookId).toArray()).filter((c) => ids.has(c.sourceId))
  const a = analyze(chunks, sources)
  const rowMode = (item.params.rowMode as 'sources' | 'terms') ?? 'sources'
  const fresh = genTable(a, { title: '' }, { columns: [name], rowMode, rowCount: item.content.rows.length })
  const col = { id: uid('c'), name }
  const rows = item.content.rows.map((r) => {
    const match = fresh.rows.find((f) => (r.sourceId ? f.sourceId === r.sourceId : f.label === r.label))
    const cell = match ? Object.values(match.cells)[0] : { text: '— not found in sources', cites: [] }
    return { ...r, cells: { ...r.cells, [col.id]: cell } }
  })
  await db.items.update(itemId, { content: { columns: [...item.content.columns, col], rows }, updatedAt: Date.now() })
}

export async function glossaryToCards(notebookId: string, itemId: string, entries: GlossaryContent['entries']) {
  const existing = new Set((await db.cards.where('notebookId').equals(notebookId).toArray()).map((c) => c.front))
  const fresh = entries
    .filter((e) => e.kind === 'term')
    .map((e) => ({ front: `What is ${e.term}?`, back: e.definition, cites: e.cites }))
    .filter((c) => !existing.has(c.front))
  await db.cards.bulkAdd(fresh.map((c) => newCard({ id: uid('c_'), notebookId, itemId, front: c.front, back: c.back, cites: c.cites, origin: 'manual' })))
  return fresh.length
}
