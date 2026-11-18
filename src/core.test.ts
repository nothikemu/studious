import { beforeEach, describe, expect, it } from 'vitest'
import { offlineAnswer } from './ai/chat'
import { parseCited } from './ai/chat'
import { SAMPLE_SOURCES } from './data/sample'
import { db, exportNotebookJson, importNotebookJson } from './db'
import { analyze } from './lib/analysis'
import { makeResolver, collectCiteIds } from './lib/cites'
import { itemToMarkdown, flashcardsAnki, tableCsv } from './lib/export'
import { addSource } from './lib/ingest'
import { layoutTree } from './lib/mindmap'
import { buildRetriever } from './lib/search'
import { applyRating, buildQueue, clampToExam, DEFAULT_PREFS, newCard, preview } from './lib/srs'
import { chunkText, detectStructure, locateQuote, splitSentences } from './lib/text'
import { createNotebook, generateStudio, questionToCard } from './studio/generate'
import { genFlashcards, genGlossary, genGuide, genMindMap, genQuiz, genTable } from './studio/offline'
import type { Chunk, ChatMessage, Source } from './types'

function corpus() {
  const sources: Source[] = SAMPLE_SOURCES.map((s, i) => ({ id: `s${i}`, notebookId: 'n', title: s.title, kind: 'sample', text: s.text, enabled: true, addedAt: 0, wordCount: 1 }))
  const chunks = sources.flatMap((s) => chunkText(s.text, { sourceId: s.id, notebookId: 'n', idPrefix: s.id }))
  return { sources, chunks, a: analyze(chunks, sources), r: buildRetriever(chunks) }
}

describe('text & chunking', () => {
  it('splits sentences without breaking on abbreviations', () => {
    const s = splitSentences('Dr. Smith measured it, e.g. at 5 Hz. The result held. Next step follows.')
    expect(s.map((x) => x.text)).toEqual(['Dr. Smith measured it, e.g. at 5 Hz.', 'The result held.', 'Next step follows.'])
  })
  it('chunk offsets point at the exact source text', () => {
    const { sources, chunks } = corpus()
    for (const c of chunks) {
      const src = sources.find((s) => s.id === c.sourceId)!
      expect(src.text.slice(c.start, c.end).replace(/\s+/g, ' ')).toBe(c.text.replace(/\s+/g, ' '))
    }
  })
  it('detects markdown and plain headings', () => {
    const b = detectStructure('# Title\n\nSome words here.\n\nPlain Heading\n\nMore words follow here.')
    expect(b.filter((x) => x.type === 'heading').map((x) => x.text)).toEqual(['Title', 'Plain Heading'])
  })
  it('tracks the nearest heading on chunks', () => {
    const { chunks } = corpus()
    expect(chunks.find((c) => c.text.includes('rubisco fixes'))?.heading).toBe('The Calvin cycle')
  })
})

describe('quote location', () => {
  it('finds a cited sentence across soft line wraps, and refuses paraphrases', () => {
    const t = 'Intro line.\n\nThe enzyme rubisco fixes carbon\ndioxide by attaching it to RuBP. Another sentence.'
    const m = locateQuote(t, 'The enzyme rubisco fixes carbon dioxide by attaching it to RuBP.', 0, t.length)!
    expect(t.slice(m.start, m.end)).toBe('The enzyme rubisco fixes carbon\ndioxide by attaching it to RuBP.')
    expect(locateQuote(t, 'Rubisco is an enzyme that grabs CO2 and ties it to a sugar.', 0, t.length)).toBeNull()
    expect(locateQuote(t, 'The enzyme rubisco fixes carbon dioxide by attaching it to RuBP. Totally different tail.', 0, t.length)).not.toBeNull() // falls back to first sentence
  })
})

describe('grounded answers', () => {
  const { a, r } = corpus()
  const ask = (q: string, history: ChatMessage[] = []) => offlineAnswer({ query: q, history, a, retriever: r, cfg: { provider: 'offline', apiKey: '', model: '', baseUrl: '' }, prefs: DEFAULT_PREFS, titleOf: () => '' })
  it('answers from sources and cites a real chunk for every segment', () => {
    const out = ask('What does rubisco do?')
    expect(out.notFound).toBeFalsy()
    const ids = new Set(a.chunks.map((c) => c.id))
    expect(out.segments!.length).toBeGreaterThan(0)
    for (const s of out.segments!) {
      expect(s.cites.length).toBeGreaterThan(0)
      s.cites.forEach((c) => expect(ids.has(c)).toBe(true))
    }
    expect(out.segments!.map((s) => s.text).join(' ')).toMatch(/rubisco/i)
  })
  it('summarises across every source instead of echoing a keyword match', () => {
    const out = ask('Summarize my sources')
    expect(out.notFound).toBeFalsy()
    expect(out.segments!.length).toBeGreaterThanOrEqual(4)
    const srcs = new Set(out.segments!.map((s) => a.chunkById.get(s.cites[0])!.sourceId))
    expect(srcs.size).toBe(2)
    expect(out.segments!.every((s) => !/→/.test(s.text))).toBe(true) // equations aren't takeaways
  })
  it('never offers a verb phrase as a follow-up topic', () => {
    const out = ask('What is glycolysis?')
    for (const f of out.followUps ?? []) expect(f).not.toMatch(/occurs|takes place|converted|rocks form|drives/i)
  })
  it('refuses to guess when the sources do not cover the question', () => {
    expect(ask('Who won the 1998 world cup final?').notFound).toBe(true)
    expect(ask('How do quantum computers factor primes?').notFound).toBe(true)
  })
  it('uses the previous question for a pronoun follow-up', () => {
    const first: ChatMessage = { id: '1', notebookId: 'n', role: 'user', text: 'What is glycolysis?', at: 1 }
    const out = ask('Where does it occur?', [first, { id: '2', notebookId: 'n', role: 'user', text: 'Where does it occur?', at: 2 }])
    expect(out.notFound).toBeFalsy()
    expect(out.segments!.map((s) => s.text).join(' ')).toMatch(/cytoplasm/i)
  })
  it('parses numbered citations from a model reply and drops unknown numbers', () => {
    const map = new Map([[1, 'c1'], [2, 'c2']])
    const segs = parseCited('Rubisco fixes CO2 [1]. It happens in the stroma [2][9]. Trailing claim.', map)
    expect(segs[0]).toEqual({ text: 'Rubisco fixes CO2', cites: ['c1'] })
    expect(segs[1].cites).toEqual(['c2'])
    expect(segs[2].cites).toEqual([])
  })
})

describe('studio modules (offline)', () => {
  const { a, chunks } = corpus()
  const ctx = { title: 'T' }
  const valid = new Set(chunks.map((c) => c.id))
  const allCitesValid = (x: unknown) => collectCiteIds(x).every((id) => valid.has(id))

  it('flashcards are definition and cloze cards with valid citations', () => {
    const f = genFlashcards(a, ctx, 14)
    expect(f.cards.length).toBeGreaterThanOrEqual(10)
    expect(allCitesValid(f)).toBe(true)
    expect(f.cards.some((c) => c.front.startsWith('What are mitochondria'))).toBe(true)
    expect(f.cards.some((c) => c.front.includes('_____'))).toBe(true)
    expect(new Set(f.cards.map((c) => c.front)).size).toBe(f.cards.length)
  })
  it('quiz questions have 4 distinct options and the answer is the correct one', () => {
    const q = genQuiz(a, ctx, 10, 'mixed')
    expect(q.questions.length).toBeGreaterThanOrEqual(6)
    for (const x of q.questions) {
      expect(new Set(x.options).size).toBe(x.options.length)
      expect(x.options.length).toBe(4)
      expect(x.answer).toBeGreaterThanOrEqual(0)
      expect(x.explanation.length).toBeGreaterThan(10)
    }
    expect(allCitesValid(q)).toBe(true)
    for (const d of ['easy', 'medium', 'hard'] as const) expect(genQuiz(a, ctx, 4, d).questions.every((x) => x.difficulty === d)).toBe(true)
  })
  it('guide, glossary, map and table are non-empty and grounded', () => {
    expect(genGuide(a, ctx).blocks.length).toBeGreaterThan(8)
    const g = genGlossary(a, ctx)
    expect(g.entries.some((e) => e.term === 'Calvin cycle')).toBe(true)
    expect(g.entries.find((e) => e.term === 'Chloroplast')!.definition).not.toMatch(/^A chloroplast is/)
    expect(genMindMap(a, ctx).root.children.length).toBeGreaterThan(4)
    const t = genTable(a, ctx, { columns: ['Core idea', 'Definition', 'Quantum chromodynamics'], rowMode: 'sources' })
    expect(t.rows.length).toBe(2)
    const qcd = t.columns[2].id
    expect(t.rows.every((r) => r.cells[qcd].cites.length === 0 && /not found/.test(r.cells[qcd].text))).toBe(true) // honest about gaps
    ;[genGuide(a, ctx), g, genMindMap(a, ctx), t].forEach((x) => expect(allCitesValid(x)).toBe(true))
  })
  it('cloze blanks are noun phrases, not verb fragments', () => {
    const tiny = (() => {
      const text = 'Igneous rocks form when magma cools and solidifies. Sedimentary rocks form from compacted sediments. Metamorphic rocks form when existing rock is changed by heat and pressure. The rock cycle links all three types of rock.'
      const src: Source = { id: 's', notebookId: 'n', title: 'Rocks', kind: 'paste', text, enabled: true, addedAt: 0, wordCount: 30 }
      const ch = chunkText(text, { sourceId: 's', notebookId: 'n', idPrefix: 's' })
      return analyze(ch, [src])
    })()
    const f = genFlashcards(tiny, { title: 'T' }, 10)
    for (const c of f.cards) expect(c.back).not.toMatch(/^rocks form/i)
  })
  it('focus scoping restricts material to matching passages', () => {
    const hits = new Set(buildRetriever(chunks).search('fermentation lactate ethanol', 3).map((h) => h.chunk.id))
    const f = genFlashcards(a, { title: 'T', chunkIds: hits }, 6)
    expect(f.cards.every((c) => c.cites.every((id) => hits.has(id)))).toBe(true)
  })
  it('mind map layout is collision-free per column', () => {
    const { nodes } = layoutTree(genMindMap(a, ctx).root, new Set())
    const byDepth = new Map<number, typeof nodes>()
    nodes.forEach((n) => byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]))
    for (const col of byDepth.values()) {
      const s = col.slice().sort((x, y) => x.y - y.y)
      for (let i = 1; i < s.length; i++) expect(s[i].y).toBeGreaterThanOrEqual(s[i - 1].y + s[i - 1].h - 0.01)
    }
  })
})

describe('FSRS scheduling', () => {
  const base = newCard({ id: 'c', notebookId: 'n', front: 'q', back: 'a', cites: [], origin: 'manual' }, new Date('2026-01-01T09:00:00Z'))
  const now = new Date('2026-01-01T09:00:00Z')
  it('previews increasing intervals Again < Hard < Good < Easy', () => {
    const p = preview(base, DEFAULT_PREFS, now)
    expect(p[1].due.getTime()).toBeLessThan(p[3].due.getTime())
    expect(p[3].due.getTime()).toBeLessThan(p[4].due.getTime())
  })
  it('records the review and keeps a lapse closer than a success', () => {
    const good = applyRating(base, 3, DEFAULT_PREFS, now)
    const again = applyRating(base, 1, DEFAULT_PREFS, now)
    expect(good.log.wasNew).toBe(true)
    expect(again.card.due).toBeLessThan(good.card.due)
  })
  it('clamps due dates to the day before an exam', () => {
    const prefs = { ...DEFAULT_PREFS, examDate: '2026-01-10' }
    const far = new Date('2026-03-01T00:00:00Z')
    const c = clampToExam(far, prefs, now)
    expect(c.getTime()).toBeLessThan(new Date('2026-01-10T09:00:00').getTime())
    expect(clampToExam(far, DEFAULT_PREFS, now)).toEqual(far)
  })
  it('caps new cards per day but always serves due cards', () => {
    const cards = Array.from({ length: 30 }, (_, i) => newCard({ id: `c${i}`, notebookId: 'n', front: 'q', back: 'a', cites: [], origin: 'manual' }, now))
    expect(buildQueue(cards, 0, 10).length).toBe(10)
    expect(buildQueue(cards, 8, 10).length).toBe(2)
    const reviewed = applyRating(cards[0], 3, DEFAULT_PREFS, new Date(Date.now() - 5 * 86_400_000)).card
    expect(buildQueue([reviewed, ...cards.slice(1)], 10, 10).map((c) => c.id)).toContain('c0')
  })
})

describe('persistence & generation (IndexedDB)', () => {
  beforeEach(async () => {
    await Promise.all([db.notebooks, db.sources, db.chunks, db.messages, db.items, db.cards, db.reviews, db.attempts].map((t) => t.clear()))
  })
  const offline = { provider: 'offline' as const, apiKey: '', model: '', baseUrl: '' }

  it('ingests, generates flashcards + cards, and rejects empty scopes', async () => {
    const nb = await createNotebook('Bio')
    for (const s of SAMPLE_SOURCES) await addSource(nb, s.title, { text: s.text, kind: 'text' })
    const { item } = await generateStudio(nb, 'flashcards', { count: 10 }, offline)
    expect(await db.cards.where('itemId').equals(item.id).count()).toBe((item.content as any).cards.length)
    await expect(generateStudio(nb, 'quiz', { focus: 'zebra migration patterns' }, offline)).rejects.toThrow(/Nothing in your sources matches/)
    await db.sources.toCollection().modify({ enabled: false })
    await expect(generateStudio(nb, 'guide', {}, offline)).rejects.toThrow(/at least one source/)
  })

  it('turns a missed quiz question into one review card (idempotent)', async () => {
    const nb = await createNotebook('Bio')
    const q = { id: 'q1', prompt: 'Which term?', options: ['a', 'b', 'c', 'd'], answer: 1, explanation: 'Because.', cites: ['x'], difficulty: 'easy' as const }
    await questionToCard(nb, q)
    await questionToCard(nb, q)
    const cards = await db.cards.where('notebookId').equals(nb).toArray()
    expect(cards).toHaveLength(1)
    expect(cards[0].back).toContain('b')
  })

  it('round-trips a notebook through JSON backup, restoring dates', async () => {
    const nb = await createNotebook('Bio')
    for (const s of SAMPLE_SOURCES) await addSource(nb, s.title, { text: s.text, kind: 'text' })
    await generateStudio(nb, 'flashcards', { count: 8 }, offline)
    const dump = JSON.parse(JSON.stringify(await exportNotebookJson(nb)))
    await Promise.all([db.notebooks, db.sources, db.chunks, db.items, db.cards].map((t) => t.clear()))
    const id = await importNotebookJson(dump)
    expect(id).toBe(nb)
    const card = (await db.cards.toArray())[0]
    expect(card.fsrs.due instanceof Date).toBe(true)
    expect(await db.chunks.count()).toBe(dump.chunks.length)
    await expect(importNotebookJson({ nope: 1 })).rejects.toThrow()
  })
})

describe('exports', () => {
  it('markdown export numbers footnotes and quotes the source', async () => {
    const { sources, chunks, a } = corpus()
    const content = genGuide(a, { title: 'T' })
    const md = itemToMarkdown({ id: 'i', notebookId: 'n', kind: 'guide', title: 'Study guide', createdAt: 0, updatedAt: 0, mode: 'offline', sourceIds: [], params: {}, content }, makeResolver(chunks as Chunk[], sources), 'Bio')
    expect(md).toMatch(/^# Study guide/)
    expect(md).toMatch(/\[\^1\]: Photosynthesis — lecture notes/)
    expect(md).toMatch(/\[\^1\]/)
  })
  it('anki and csv exports escape awkward text', () => {
    expect(flashcardsAnki({ cards: [{ id: '1', front: 'a\tb', back: 'x\ny', cites: [] }] })).toBe('a b\tx<br>y')
    const csv = tableCsv({ columns: [{ id: 'c', name: 'Col "q"' }], rows: [{ id: 'r', label: 'R,1', cells: { c: { text: 'He said "hi"', cites: [] } } }] })
    expect(csv).toBe('"","Col ""q"""\n"R,1","He said ""hi"""')
  })
})

describe('reasoning-model output and NVIDIA preset', () => {
  const nv = { provider: 'nvidia' as const, apiKey: 'nvapi-test', model: 'some/model', baseUrl: '' }
  const real = globalThis.fetch
  it('strips <think> blocks, calls the NIM endpoint with a bearer key', async () => {
    let seen: any
    globalThis.fetch = (async (u: any, init: any) => {
      seen = { u: String(u), h: init.headers, b: JSON.parse(init.body) }
      return new Response(JSON.stringify({ choices: [{ message: { content: '<think>let me {think} first</think>\n{"ok":true}' } }] }), { status: 200 })
    }) as any
    const { callLLM, extractJson } = await import('./ai/llm')
    const out = await callLLM(nv, 'sys', 'user', 100)
    expect(out).toBe('{"ok":true}')
    expect(extractJson(out)).toEqual({ ok: true })
    expect(seen.u).toBe('https://integrate.api.nvidia.com/v1/chat/completions')
    expect(seen.h.authorization).toBe('Bearer nvapi-test')
    expect(seen.b.model).toBe('some/model')
    globalThis.fetch = real
  })
  it('OpenRouter: right endpoint, bearer key, attribution headers, reasoning stripped', async () => {
    let seen: any
    globalThis.fetch = (async (u: any, init: any) => {
      seen = { u: String(u), h: init.headers }
      return new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>hello' } }] }), { status: 200 })
    }) as any
    const { callLLM } = await import('./ai/llm')
    const out = await callLLM({ provider: 'openrouter', apiKey: 'sk-or-test', model: 'vendor/model:free', baseUrl: '' }, 's', 'u')
    expect(out).toBe('hello')
    expect(seen.u).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(seen.h.authorization).toBe('Bearer sk-or-test')
    expect(seen.h['X-Title']).toBe('Studious')
    globalThis.fetch = real
  })
  it('cleans pasted keys and base URLs, and explains a 401 without leaking the key', async () => {
    const { cleanKey, cleanBase, callLLM } = await import('./ai/llm')
    expect(cleanKey('  "Bearer sk-or-v1-abc123"\n')).toBe('sk-or-v1-abc123')
    expect(cleanKey('Authorization: Bearer sk-or-v1-abc')).toBe('sk-or-v1-abc')
    expect(cleanBase('openrouter.ai/api/v1/chat/completions', 'x')).toBe('https://openrouter.ai/api/v1')
    expect(cleanBase('http://openrouter.ai/api/v1/', 'x')).toBe('https://openrouter.ai/api/v1')
    expect(cleanBase('', 'https://d')).toBe('https://d')
    let auth = ''
    globalThis.fetch = (async (_u: any, init: any) => { auth = init.headers.authorization; return new Response(JSON.stringify({ error: { message: 'Missing Authentication header' } }), { status: 401 }) }) as any
    const err = await callLLM({ provider: 'openrouter', apiKey: 'Bearer nvapi-WRONGKEYabcdefghij', model: 'm', baseUrl: '' }, 's', 'u').catch((e) => e as Error)
    expect(auth).toBe('Bearer nvapi-WRONGKEYabcdefghij') // single Bearer, no duplication
    expect((err as Error).message).toMatch(/401: Missing Authentication header/)
    expect((err as Error).message).toMatch(/doesn’t look like a openrouter key.*sk-or-/)
    expect((err as Error).message).not.toContain('WRONGKEYabcdefghij')
    globalThis.fetch = real
  })
  it('handles an unterminated think block and explains CORS failures', async () => {
    const { stripThinking, callLLM } = await import('./ai/llm')
    expect(stripThinking('reasoning without opener</think>Answer [1].')).toBe('Answer [1].')
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch') }) as any
    await expect(callLLM(nv, 's', 'u')).rejects.toThrow(/integrate\.api\.nvidia\.com.*CORS/)
    globalThis.fetch = real
  })
  it('requires a model id before treating the engine as remote', async () => {
    const { isRemote } = await import('./ai/config')
    expect(isRemote({ ...nv, model: '' })).toBe(false)
    expect(isRemote(nv)).toBe(true)
  })
})

describe('optional model path (mocked API)', () => {
  const cfg = { provider: 'anthropic' as const, apiKey: 'test-key', model: 'm', baseUrl: '' }
  const realFetch = globalThis.fetch
  const reply = (text: string) => (globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body)
    reply.last = body
    return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 })
  }) as any)
  reply.last = null as any

  beforeEach(async () => {
    await Promise.all([db.notebooks, db.sources, db.chunks, db.messages, db.items, db.cards, db.reviews, db.attempts].map((t) => t.clear()))
  })
  const setup = async () => {
    const nb = await createNotebook('Bio')
    for (const s of SAMPLE_SOURCES) await addSource(nb, s.title, { text: s.text, kind: 'text' })
    return nb
  }

  it('keeps cited items, drops invented citations, and sends the key only as a header', async () => {
    const nb = await setup()
    reply('```json\n{"cards":[{"front":"What does rubisco do?","back":"Fixes CO2.","cites":[1]},{"front":"Made up","back":"Nope","cites":[999]},{"front":"No cite","back":"x","cites":[]},{"front":"A","back":"B","cites":[2]},{"front":"C","back":"D","cites":[3]}]}\n```')
    const { item, note } = await generateStudio(nb, 'flashcards', { count: 5 }, cfg)
    expect(note).toBeUndefined()
    expect(item.mode).toBe('llm')
    const cards = (item.content as any).cards
    expect(cards.map((c: any) => c.front)).toEqual(['What does rubisco do?', 'A', 'C'])
    const ids = new Set((await db.chunks.toArray()).map((c) => c.id))
    expect(cards.every((c: any) => c.cites.every((id: string) => ids.has(id)))).toBe(true)
    expect(JSON.stringify(reply.last)).not.toContain('test-key')
    expect(reply.last.system).toMatch(/only/i)
    globalThis.fetch = realFetch
  })

  it('falls back to offline generation with a visible note when the model fails', async () => {
    const nb = await setup()
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })) as any
    const { item, note } = await generateStudio(nb, 'glossary', {}, cfg)
    expect(item.mode).toBe('offline')
    expect(note).toMatch(/401|bad key/)
    expect((item.content as any).entries.length).toBeGreaterThan(5)
    globalThis.fetch = realFetch
  })

  it('rejects unusable model output instead of saving an empty item', async () => {
    const nb = await setup()
    reply('{"cards":[{"front":"x","back":"y","cites":[]}]}')
    const { item, note } = await generateStudio(nb, 'flashcards', { count: 5 }, cfg)
    expect(item.mode).toBe('offline') // fell back
    expect(note).toMatch(/unusable/)
    globalThis.fetch = realFetch
  })
})
