import { callLLM, extractJson, type LlmContext } from '../ai/llm'
import { uid } from '../lib/ids'
import type {
  AiConfig,
  Block,
  DeckContent,
  DocContent,
  FlashContent,
  GlossaryContent,
  MapContent,
  MapNode,
  NotebookPrefs,
  QuizContent,
  StudioKind,
  TableContent,
} from '../types'

const SYS = `You create study materials strictly from numbered source excerpts.
- Use only information in the excerpts; never add outside facts.
- Each item carries "cites": an array of excerpt numbers (integers) that support it. Items without valid cites will be discarded.
- Reply with a single JSON object and nothing else.`

const SPEC: Record<StudioKind, (p: any) => string> = {
  guide: () =>
    `Write a comprehensive study guide. JSON: {"blocks":[{"kind":"h2"|"h3"|"p"|"li","text":string,"cites":[int]}]}. Include: Overview, one section per major topic (explanatory paragraphs), Key terms (li "Term — definition"), and a "Check yourself" list of open questions.`,
  notes: () =>
    `Write concise structured lecture-style notes. JSON: {"blocks":[{"kind":"h2"|"h3"|"p"|"li","text":string,"cites":[int]}]}. Use headings with short bullet points (li). End with an h2 "Summary" and a p.`,
  flashcards: (p) =>
    `Create ${p.count ?? 20} high-quality flashcards (one atomic fact per card; mix definitions, cause/effect, and application). JSON: {"cards":[{"front":string,"back":string,"cites":[int]}]}.`,
  quiz: (p) =>
    `Create ${p.count ?? 10} multiple-choice questions with 4 options each and plausible distractors. Difficulty: ${p.difficulty ?? 'mixed'}. JSON: {"questions":[{"prompt":string,"options":[string,string,string,string],"answer":int(0-3),"explanation":string,"difficulty":"easy"|"medium"|"hard","cites":[int]}]}. Each explanation must say why the answer is right using the excerpt.`,
  mindmap: () =>
    `Create a mind map with the central topic as root, 4-8 branches, and 2-5 children per branch (depth up to 3). JSON: {"root":{"label":string,"cites":[int],"children":[{"label":string,"cites":[int],"children":[...]}]}}. Labels must be short (max 8 words).`,
  deck: () =>
    `Create a slide deck of 8-12 slides: title, agenda, content slides, key takeaways. JSON: {"slides":[{"title":string,"bullets":[{"text":string,"cites":[int]}],"notes":string}]}. Max 5 bullets per slide, each under 20 words.`,
  table: (p) =>
    `Build a comparison/extraction table. Rows: ${p.rowMode === 'terms' ? 'key concepts/terms' : 'one row per source document (use the source title as label)'}. Columns: ${JSON.stringify(p.columns)}. For each cell give a short answer from the excerpts or the exact text "— not found in sources" with empty cites. JSON: {"rows":[{"label":string,"cells":[{"text":string,"cites":[int]}]}]} where cells are in column order.`,
  glossary: () =>
    `Extract a glossary of definitions, concepts and formulas. JSON: {"entries":[{"term":string,"definition":string,"kind":"term"|"formula","cites":[int]}]}. Sort alphabetically; formulas last.`,
}

export async function remoteGenerate(kind: StudioKind, ctx: LlmContext, cfg: AiConfig, prefs: NotebookPrefs, params: any, title: string): Promise<unknown> {
  const user = `Notebook: ${title}\nLearner level: ${prefs.level}\n${params.focus ? `Focus: ${params.focus}\n` : ''}\nTASK\n${SPEC[kind](params)}\n\nSOURCE EXCERPTS\n${ctx.text}`
  const raw = await callLLM(cfg, SYS, user, 8000)
  const j = extractJson(raw)
  return normalize(kind, j, ctx, params)
}

function normalize(kind: StudioKind, j: any, ctx: LlmContext, params: any): unknown {
  const cites = (arr: unknown): string[] => [...new Set(((Array.isArray(arr) ? arr : []) as unknown[]).map((n) => ctx.byNumber.get(Number(n))).filter(Boolean) as string[])]
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  switch (kind) {
    case 'guide':
    case 'notes': {
      const blocks: Block[] = (j.blocks ?? [])
        .map((b: any): Block => ({ id: uid('b'), kind: ['h2', 'h3', 'p', 'li'].includes(b.kind) ? b.kind : 'p', text: str(b.text), cites: cites(b.cites) }))
        .filter((b: Block) => b.text && (b.kind.startsWith('h') || b.cites.length))
      need(blocks.length >= 3, 'guide')
      return { blocks } satisfies DocContent
    }
    case 'flashcards': {
      const cards = (j.cards ?? [])
        .map((c: any) => ({ id: uid('f'), front: str(c.front), back: str(c.back), cites: cites(c.cites) }))
        .filter((c: any) => c.front && c.back && c.cites.length)
      need(cards.length >= 3, 'flashcards')
      return { cards } satisfies FlashContent
    }
    case 'quiz': {
      const questions = (j.questions ?? [])
        .map((q: any) => ({
          id: uid('q'),
          prompt: str(q.prompt),
          options: Array.isArray(q.options) ? q.options.map(str) : [],
          answer: Number(q.answer),
          explanation: str(q.explanation),
          difficulty: ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
          cites: cites(q.cites),
        }))
        .filter((q: any) => q.prompt && q.options.length >= 3 && q.answer >= 0 && q.answer < q.options.length && q.cites.length)
      need(questions.length >= 3, 'quiz')
      return { questions } satisfies QuizContent
    }
    case 'mindmap': {
      const conv = (n: any, depth: number): MapNode => ({
        id: uid('n'),
        label: str(n.label) || '…',
        cites: cites(n.cites),
        children: depth < 3 ? (n.children ?? []).map((c: any) => conv(c, depth + 1)) : [],
      })
      need(j.root?.children?.length, 'mind map')
      return { root: conv(j.root, 0) } satisfies MapContent
    }
    case 'deck': {
      const slides = (j.slides ?? []).map((s: any) => ({
        id: uid('s'),
        title: str(s.title),
        notes: str(s.notes),
        bullets: (s.bullets ?? []).map((b: any) => ({ text: str(typeof b === 'string' ? b : b.text), cites: cites(b.cites) })).filter((b: any) => b.text),
      }))
      need(slides.length >= 3, 'deck')
      return { slides } satisfies DeckContent
    }
    case 'table': {
      const columns = (params.columns as string[]).map((name) => ({ id: uid('c'), name }))
      const rows = (j.rows ?? []).map((r: any) => ({
        id: uid('r'),
        label: str(r.label),
        cells: Object.fromEntries(columns.map((c, i) => [c.id, { text: str(r.cells?.[i]?.text) || '— not found in sources', cites: cites(r.cells?.[i]?.cites) }])),
      }))
      need(rows.length, 'table')
      return { columns, rows } satisfies TableContent
    }
    case 'glossary': {
      const entries = (j.entries ?? [])
        .map((e: any) => ({ id: uid('g'), term: str(e.term), definition: str(e.definition), kind: e.kind === 'formula' ? 'formula' : 'term', cites: cites(e.cites) }))
        .filter((e: any) => e.term && e.definition && e.cites.length)
      need(entries.length >= 3, 'glossary')
      return { entries } satisfies GlossaryContent
    }
  }
}

function need(ok: unknown, what: string) {
  if (!ok) throw new Error(`The model returned an unusable ${what}.`)
}
