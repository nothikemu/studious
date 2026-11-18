import { topSentences, type Analysis } from '../lib/analysis'
import { uid } from '../lib/ids'
import { pickDiverse, rankSentences } from '../lib/qa'
import type { Retriever } from '../lib/search'
import { capitalize, contentTerms, stem } from '../lib/text'
import type { AiConfig, ChatMessage, ChatSegment, NotebookPrefs } from '../types'
import { buildContext, callLLM } from './llm'
import { isRemote } from './config'

export type Answer = Pick<ChatMessage, 'text' | 'segments' | 'notFound' | 'mode' | 'followUps'>

const ANAPHORA = /\b(it|its|this|that|these|those|they|them|their|he|she|more|also|why|how come|what about|and)\b/i

export interface AnswerInput {
  query: string
  history: ChatMessage[]
  a: Analysis
  retriever: Retriever
  cfg: AiConfig
  prefs: NotebookPrefs
  titleOf: (sourceId: string) => string
}

export async function answerQuestion(inp: AnswerInput): Promise<Answer> {
  if (isRemote(inp.cfg)) {
    try {
      return await remoteAnswer(inp)
    } catch (e) {
      const fallback = offlineAnswer(inp)
      return { ...fallback, text: `Couldn’t reach the model (${(e as Error).message}). Showing the offline, quoted answer instead.` }
    }
  }
  return offlineAnswer(inp)
}

function effectiveQuery(q: string, history: ChatMessage[]): string {
  const terms = contentTerms(q)
  if (terms.length >= 3 && !/^(and|also|why|how|what about)\b/i.test(q.trim())) return q
  if (!ANAPHORA.test(q) && terms.length >= 2) return q
  const prev = [...history].reverse().find((m) => m.role === 'user' && m.text)
  return prev ? `${prev.text} ${q}` : q
}

export function offlineAnswer({ query, history, a, retriever }: AnswerInput): Answer {
  const q = effectiveQuery(query, history.slice(0, -1))
  const wantsSummary = /\b(summar\w*|overview|main (points|ideas)|tl;?dr|key (points|takeaways))\b/i.test(query)
  const wantsCompare = /\b(compare|difference|differ|versus|vs\.?|contrast|similar)/i.test(query)
  const wantsDefine = /^\s*(define|what (is|are|does)|who (is|are)|meaning of)\b/i.test(query)

  if (!a.chunks.length) return { notFound: true, mode: 'offline', text: 'There are no active sources yet. Add or enable a source to ask questions.' }

  const FILLER = /^(summar\w*|overview|main|points?|ideas?|key|takeaways?|sources?|notebook|materials?|texts?|documents?|notes?|everything|all|these|this|those|tell|give|short|brief|quick|bullet|whole)$/
  if (wantsSummary && contentTerms(query).filter((t) => !FILLER.test(t)).length === 0) {
    // round-robin across sources so every active source is represented
    const bySource = a.sources.map((src) => topSentences(a, { sourceId: src.id, n: 3 }))
    const top = Array.from({ length: 3 }, (_, i) => bySource.map((l) => l[i])).flat().filter(Boolean).slice(0, 6)
    const ordered = orderByDoc(a, top.map((s) => ({ text: s.text, cites: [s.chunkId] })))
    return { mode: 'offline', segments: ordered, followUps: followUps(a, q, new Set(top.map((t) => t.chunkId))) }
  }

  const hits = retriever.search(q, 6)
  const coverage = retriever.coverage(q, hits)
  if (!hits.length || coverage < 0.5) return { notFound: true, mode: 'offline' }

  const maxScore = hits[0].score || 1
  const boost = new Map(hits.map((h) => [h.chunk.id, h.score / maxScore]))
  const scope = new Set(hits.map((h) => h.chunk.id))
  const ranked = rankSentences(a, q, { scope, chunkBoost: boost, defBias: wantsDefine }).filter((r) => r.matched >= Math.max(1, r.total * 0.34))
  if (!ranked.length) return { notFound: true, mode: 'offline' }

  let picked
  if (wantsCompare) {
    const bySrc = new Map<string, typeof ranked>()
    for (const r of ranked) bySrc.set(r.s.sourceId, [...(bySrc.get(r.s.sourceId) ?? []), r])
    picked = [...bySrc.values()].flatMap((rs) => pickDiverse(rs, 2))
  } else {
    picked = pickDiverse(ranked, wantsDefine ? 3 : 4)
  }
  const segs = orderByDoc(a, picked.map((r) => ({ text: r.s.text, cites: [r.s.chunkId] })))
  return { mode: 'offline', segments: segs, followUps: followUps(a, q, scope) }
}

function orderByDoc(a: Analysis, segs: ChatSegment[]): ChatSegment[] {
  const idx = new Map(a.chunks.map((c, i) => [c.id, i]))
  return segs.slice().sort((x, y) => (idx.get(x.cites[0]) ?? 0) - (idx.get(y.cites[0]) ?? 0))
}

function followUps(a: Analysis, q: string, scope: Set<string>): string[] {
  const qs = new Set(contentTerms(q).map(stem))
  const cand = a.terms.filter((t) => t.nounish && !qs.has(t.key) && t.chunkIds.some((c) => scope.has(c)) && t.term.length > 3).slice(0, 3)
  return cand.map((t, i) => (i === 0 ? `Tell me more about “${t.term}”.` : i === 1 ? `How does “${t.term}” relate to this?` : `Give an example involving “${t.term}”.`))
}

// ------------------------------------------------------------------ remote
const SYSTEM = `You are a study assistant. Answer ONLY using the numbered source excerpts provided.
Rules:
- Every factual sentence must end with one or more citation markers like [1] or [2][5] naming the excerpt(s) that support it.
- If the excerpts do not contain the answer, reply with exactly: NOT_IN_SOURCES
- Never use outside knowledge. Do not invent citations.
- Be concise and clear. Match the learner's level.
- After the answer, add a final line: FOLLOWUPS: question one | question two | question three`

async function remoteAnswer(inp: AnswerInput): Promise<Answer> {
  const { a, cfg, history, prefs, titleOf } = inp
  const q = effectiveQuery(inp.query, history.slice(0, -1))
  const hits = inp.retriever.search(q, 10)
  const chunks = (hits.length ? hits.map((h) => h.chunk) : a.chunks.slice(0, 8))
  const ctx = buildContext(chunks, titleOf, 40_000)
  const convo = history
    .slice(-7, -1)
    .map((m) => `${m.role === 'user' ? 'Learner' : 'Assistant'}: ${m.text ?? (m.segments ?? []).map((s) => s.text).join(' ')}`)
    .join('\n')
  const user = `Learner level: ${prefs.level}\n\nSOURCE EXCERPTS\n${ctx.text}\n\n${convo ? `CONVERSATION SO FAR\n${convo}\n\n` : ''}QUESTION\n${inp.query}`
  const raw = (await callLLM(cfg, SYSTEM, user, 4096)).trim()
  if (/^NOT_IN_SOURCES/i.test(raw)) return { notFound: true, mode: 'llm' }
  const [body, fu] = raw.split(/\n?FOLLOWUPS:/i)
  const segments = parseCited(body.trim(), ctx.byNumber)
  const grounded = segments.some((s) => s.cites.length)
  if (!grounded) return { notFound: true, mode: 'llm' }
  const followUps = fu?.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 3)
  return { mode: 'llm', segments, followUps }
}

export function parseCited(text: string, byNumber: Map<number, string>): ChatSegment[] {
  const out: ChatSegment[] = []
  const re = /((?:\s*\[\d+(?:\s*,\s*\d+)*\])+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const chunkText = text.slice(last, m.index).trim()
    const nums = [...m[1].matchAll(/\d+/g)].map((x) => Number(x[0]))
    const cites = [...new Set(nums.map((n) => byNumber.get(n)).filter(Boolean) as string[])]
    if (chunkText) out.push({ text: chunkText, cites })
    else if (out.length) out[out.length - 1].cites = [...new Set([...out[out.length - 1].cites, ...cites])]
    last = m.index + m[0].length
  }
  const tail = text.slice(last).trim()
  if (tail) out.push({ text: tail, cites: [] })
  return out
}

export function userMessage(notebookId: string, text: string): ChatMessage {
  return { id: uid('m'), notebookId, role: 'user', text: capitalize(text.trim()), at: Date.now() }
}
