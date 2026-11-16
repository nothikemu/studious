import type { Chunk, PageRange } from '../types'

export const STOP = new Set(
  `a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself also may might must shall however thus therefore et al etc eg ie via per vs one two three four five first second many much new used use using uses within without across among often generally typically usually called known well like make made makes can't don't doesn't isn't aren't`.split(
    /\s+/,
  ),
)

const ABBR = /(?:\b(?:e\.g|i\.e|etc|vs|fig|eq|dr|mr|mrs|ms|prof|st|no|approx|cf|al|inc|ltd|sec|ch|vol|pp)|\b[A-Z])\.$/i

export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).map((t) => t.replace(/['’]s$/, ''))
}

/** Very light stemmer so "photosynthetic"/"photosynthesis" and plurals line up. */
export function stem(w: string): string {
  let t = w.toLowerCase()
  if (t.length <= 4) return t
  t = t.replace(/(ies)$/, 'y').replace(/(sses)$/, 'ss').replace(/(ing|ed|es|s)$/, '')
  if (t.length > 7) t = t.slice(0, 7)
  return t
}

export function contentTerms(s: string): string[] {
  return tokenize(s).filter((t) => !STOP.has(t) && t.length > 2 && !/^\d+$/.test(t))
}

export interface Sentence {
  text: string
  start: number
  end: number
}

export function splitSentences(text: string, offset = 0): Sentence[] {
  const out: Sentence[] = []
  const re = /[^\n]+/g
  let line: RegExpExecArray | null
  // sentences never span hard line breaks that are blank-line separated; we work per paragraph line.
  while ((line = re.exec(text))) {
    const s = line[0]
    let from = 0
    const boundary = /([.!?]+["”’')\]]*)(\s+)(?=[A-Z0-9"“‘(\[])/g
    let m: RegExpExecArray | null
    while ((m = boundary.exec(s))) {
      const endIdx = m.index + m[1].length
      const candidate = s.slice(from, endIdx)
      if (ABBR.test(candidate.trim().split(/\s+/).pop() ?? '')) continue
      push(from, endIdx)
      from = endIdx + m[2].length
    }
    push(from, s.length)
    function push(a: number, b: number) {
      const raw = s.slice(a, b)
      const t = raw.trim()
      if (!t) return
      const lead = raw.length - raw.trimStart().length
      out.push({ text: t, start: offset + line!.index + a + lead, end: offset + line!.index + a + lead + t.length })
    }
  }
  return out
}

export interface Block {
  type: 'heading' | 'para'
  text: string
  start: number
  end: number
  level?: number
}

/** Split raw text into headings and paragraphs, with offsets into the original string. */
export function detectStructure(text: string): Block[] {
  const blocks: Block[] = []
  const lines: { t: string; start: number }[] = []
  const re = /([^\n]*)(\n|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && m.index < text.length) {
    lines.push({ t: m[1], start: m.index })
    if (m[2] === '') break
  }
  let para: { t: string; start: number; end: number } | null = null
  const flush = () => {
    if (para) blocks.push({ type: 'para', text: para.t, start: para.start, end: para.end })
    para = null
  }
  for (let i = 0; i < lines.length; i++) {
    const { t, start } = lines[i]
    const trimmed = t.trim()
    if (!trimmed) {
      flush()
      continue
    }
    const md = /^(#{1,4})\s+(.+?)\s*#*$/.exec(trimmed)
    const prevBlank = i === 0 || !lines[i - 1].t.trim()
    const nextBlank = i === lines.length - 1 || !lines[i + 1].t.trim()
    const words = trimmed.split(/\s+/).length
    const looksHeading =
      !md &&
      prevBlank &&
      nextBlank &&
      words <= 10 &&
      trimmed.length <= 80 &&
      !/[.,;:!?]$/.test(trimmed) &&
      /^[A-Z0-9]/.test(trimmed) &&
      !/^[-*•]\s/.test(trimmed)
    if (md) {
      flush()
      blocks.push({ type: 'heading', text: md[2], start: start + t.indexOf(md[2]), end: start + t.indexOf(md[2]) + md[2].length, level: md[1].length })
    } else if (looksHeading) {
      flush()
      blocks.push({ type: 'heading', text: trimmed, start: start + t.indexOf(trimmed), end: start + t.indexOf(trimmed) + trimmed.length, level: 2 })
    } else {
      const s0 = start + (t.length - t.trimStart().length)
      if (para && !/^[-*•]\s|^\d+[.)]\s/.test(trimmed)) {
        // soft-wrapped continuation
        para.t += '\n' + trimmed
        para.end = s0 + trimmed.length
      } else {
        flush()
        para = { t: trimmed, start: s0, end: s0 + trimmed.length }
      }
    }
  }
  flush()
  return blocks
}

export interface ChunkOpts {
  target?: number
  max?: number
}

export function chunkText(
  text: string,
  base: { sourceId: string; notebookId: string; idPrefix: string },
  pages?: PageRange[],
  opts: ChunkOpts = {},
): Chunk[] {
  const target = opts.target ?? 650
  const max = opts.max ?? 1000
  const blocks = detectStructure(text)
  const chunks: Chunk[] = []
  let heading: string | undefined
  let cur: { start: number; end: number; parts: string[] } | null = null

  const pageAt = (pos: number) => pages?.find((p) => pos >= p.start && pos < p.end + 2)?.page

  const flush = () => {
    if (!cur) return
    const idx = chunks.length
    chunks.push({
      id: `${base.idPrefix}_${idx}`,
      sourceId: base.sourceId,
      notebookId: base.notebookId,
      index: idx,
      start: cur.start,
      end: cur.end,
      text: cur.parts.join('\n\n'),
      heading,
      page: pageAt(cur.start),
    })
    cur = null
  }

  for (const b of blocks) {
    if (b.type === 'heading') {
      flush()
      heading = b.text
      continue
    }
    if (b.text.length > max) {
      flush()
      // split long paragraph by sentences
      const sents = splitSentences(b.text, b.start)
      let acc: { start: number; end: number; parts: string[] } | null = null
      for (const s of sents) {
        if (acc && acc.parts.join(' ').length + s.text.length > target) {
          cur = { start: acc.start, end: acc.end, parts: [acc.parts.join(' ')] }
          flush()
          acc = null
        }
        if (!acc) acc = { start: s.start, end: s.end, parts: [s.text] }
        else {
          acc.parts.push(s.text)
          acc.end = s.end
        }
      }
      if (acc) {
        cur = { start: acc.start, end: acc.end, parts: [acc.parts.join(' ')] }
        flush()
      }
      continue
    }
    if (cur && cur.parts.join('\n\n').length + b.text.length > target) flush()
    if (!cur) cur = { start: b.start, end: b.end, parts: [b.text] }
    else {
      cur.parts.push(b.text)
      cur.end = b.end
    }
  }
  flush()
  return chunks
}

export function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n)
  const sp = cut.lastIndexOf(' ')
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—(]$/, '') + '…'
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function wordCount(s: string): number {
  return (s.match(/\S+/g) ?? []).length
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Deterministic PRNG so generated quizzes are reproducible per seed. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Find `quote` inside text[from,to) tolerating whitespace/line-wrap differences.
 * Returns absolute offsets, or null when the quote isn't (verbatim) there.
 */
export function locateQuote(text: string, quote: string, from: number, to: number): { start: number; end: number } | null {
  const tryOne = (q: string) => {
    const words = q.trim().split(/\s+/).filter(Boolean)
    if (words.length < 3) return null
    const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
    const hay = text.slice(from, to)
    const m = re.exec(hay)
    return m ? { start: from + m.index, end: from + m.index + m[0].length } : null
  }
  const whole = tryOne(quote)
  if (whole) return whole
  const first = splitSentences(quote)[0]?.text
  return first && first.length >= 25 && first !== quote ? tryOne(first) : null
}
