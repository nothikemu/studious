import type {
  Block,
  DeckContent,
  DocContent,
  FlashContent,
  GlossaryContent,
  MapContent,
  MapNode,
  QuizContent,
  StudioItem,
  TableContent,
} from '../types'
import { collectCiteIds, numberer, type Resolver } from './cites'
import { mapToSvg } from './mindmap'

export function download(filename: string, data: string | Blob, mime = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type: `${mime};charset=utf-8` }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'studious'

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`
export const toCsv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n')

function refs(ids: string[], n: (id: string) => number) {
  return ids.map((id) => `[^${n(id)}]`).join('')
}

function footnotes(ids: string[], r: Resolver, n: (id: string) => number) {
  if (!ids.length) return ''
  return '\n\n---\n\n' + ids.map((id) => `[^${n(id)}]: ${r.label(id)} — “${r.quote(id, 200)}”`).join('\n') + '\n'
}

function blocksMd(blocks: Block[], n: (id: string) => number) {
  return blocks
    .map((b) => {
      const c = refs(b.cites, n)
      return b.kind === 'h2' ? `\n## ${b.text}\n` : b.kind === 'h3' ? `\n### ${b.text}\n` : b.kind === 'li' ? `- ${b.text}${c}` : `${b.text}${c}\n`
    })
    .join('\n')
}

function mapMd(n: MapNode, depth = 0, num: (id: string) => number): string {
  return `${'  '.repeat(depth)}- ${n.label}${refs(n.cites, num)}\n` + n.children.map((c) => mapMd(c, depth + 1, num)).join('')
}

export function itemToMarkdown(item: StudioItem, r: Resolver, notebookTitle: string): string {
  const ids = collectCiteIds(item.content)
  const n = numberer(ids)
  let body = ''
  switch (item.kind) {
    case 'guide':
    case 'notes':
      body = blocksMd((item.content as DocContent).blocks, n)
      break
    case 'flashcards':
      body = (item.content as FlashContent).cards.map((c, i) => `**${i + 1}. ${c.front}**\n\n${c.back}${refs(c.cites, n)}\n`).join('\n')
      break
    case 'quiz':
      body = (item.content as QuizContent).questions
        .map((q, i) => `**${i + 1}. ${q.prompt}**\n\n${q.options.map((o, j) => `- ${String.fromCharCode(97 + j)}) ${o}${j === q.answer ? ' ✓' : ''}`).join('\n')}\n\n_${q.explanation}_${refs(q.cites, n)}\n`)
        .join('\n')
      break
    case 'mindmap':
      body = mapMd((item.content as MapContent).root, 0, n)
      break
    case 'deck':
      body = (item.content as DeckContent).slides
        .map((s, i) => `## ${i + 1}. ${s.title}\n\n${s.bullets.map((b) => `- ${b.text}${refs(b.cites, n)}`).join('\n')}${s.notes ? `\n\n> Notes: ${s.notes}` : ''}\n`)
        .join('\n')
      break
    case 'table': {
      const t = item.content as TableContent
      const head = `| | ${t.columns.map((c) => c.name).join(' | ')} |\n|---|${t.columns.map(() => '---').join('|')}|`
      const rows = t.rows.map((row) => `| **${row.label}** | ${t.columns.map((c) => (row.cells[c.id]?.text ?? '').replace(/\|/g, '\\|') + refs(row.cells[c.id]?.cites ?? [], n)).join(' | ')} |`)
      body = [head, ...rows].join('\n')
      break
    }
    case 'glossary':
      body = (item.content as GlossaryContent).entries.map((e) => `- **${e.term}** — ${e.definition}${refs(e.cites, n)}`).join('\n')
      break
  }
  return `# ${item.title}\n\n_${notebookTitle}_\n\n${body}${footnotes(ids, r, n)}`
}

export function flashcardsCsv(c: FlashContent) {
  return toCsv([['Front', 'Back'], ...c.cards.map((x) => [x.front, x.back])])
}
/** Tab-separated, importable via Anki's File → Import (fields: Front, Back). */
export function flashcardsAnki(c: FlashContent) {
  const clean = (s: string) => s.replace(/\t/g, ' ').replace(/\n/g, '<br>')
  return c.cards.map((x) => `${clean(x.front)}\t${clean(x.back)}`).join('\n')
}
export function tableCsv(t: TableContent) {
  return toCsv([['', ...t.columns.map((c) => c.name)], ...t.rows.map((r) => [r.label, ...t.columns.map((c) => r.cells[c.id]?.text ?? '')])])
}
export function glossaryCsv(g: GlossaryContent) {
  return toCsv([['Term', 'Definition', 'Type'], ...g.entries.map((e) => [e.term, e.definition, e.kind])])
}
export function quizJson(q: QuizContent) {
  return JSON.stringify(q, null, 2)
}
export { mapToSvg }

export async function deckToPptx(item: StudioItem, r: Resolver, title: string) {
  const { default: Pptx } = await import('pptxgenjs')
  const d = item.content as DeckContent
  const ids = collectCiteIds(d)
  const n = numberer(ids)
  const p = new Pptx()
  p.layout = 'LAYOUT_WIDE'
  p.title = title
  const INK = '1D2420'
  const GREEN = '224B3A'
  const PAPER = 'F7F3EA'
  d.slides.forEach((s, i) => {
    const sl = p.addSlide()
    sl.background = { color: i === 0 ? GREEN : PAPER }
    if (i === 0) {
      sl.addText(s.title, { x: 0.8, y: 2.3, w: 11.5, h: 1.5, fontFace: 'Georgia', fontSize: 40, bold: true, color: 'F6F1E7' })
      sl.addText(s.bullets.map((b) => b.text).join(' · '), { x: 0.8, y: 3.9, w: 11.5, h: 0.6, fontFace: 'Calibri', fontSize: 16, color: 'CFE3D8' })
    } else {
      sl.addShape(p.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: GREEN }, line: { color: GREEN } })
      sl.addText(s.title, { x: 0.8, y: 0.5, w: 11.7, h: 1, fontFace: 'Georgia', fontSize: 30, bold: true, color: GREEN })
      sl.addText(
        s.bullets.map((b) => ({ text: b.text + (b.cites.length ? `  [${b.cites.map(n).join(',')}]` : ''), options: { bullet: true, breakLine: true } })),
        { x: 0.9, y: 1.7, w: 11.5, h: 4.7, fontFace: 'Calibri', fontSize: 20, color: INK, valign: 'top', paraSpaceAfter: 10 },
      )
    }
    if (s.notes) sl.addNotes(s.notes)
  })
  const refSlide = p.addSlide()
  refSlide.background = { color: PAPER }
  refSlide.addText('Sources', { x: 0.8, y: 0.5, w: 11, h: 0.8, fontFace: 'Georgia', fontSize: 28, bold: true, color: GREEN })
  refSlide.addText(ids.slice(0, 18).map((id) => ({ text: `[${n(id)}] ${r.label(id)}`, options: { breakLine: true } })), { x: 0.9, y: 1.5, w: 11.5, h: 5, fontFace: 'Calibri', fontSize: 13, color: INK, valign: 'top' })
  await p.writeFile({ fileName: `${slug(title)}.pptx` })
}

const PRINT_CSS = `body{font:14px/1.6 Georgia,serif;color:#1d2420;max-width:760px;margin:32px auto;padding:0 24px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:26px 0 6px;color:#224b3a;border-bottom:1px solid #ddd;padding-bottom:3px}h3{font-size:15px;margin:16px 0 4px}p,li{margin:4px 0}sup{color:#b4532a;font-weight:600}.sub{color:#6b756f;font-style:italic;margin-bottom:18px}.q{margin:14px 0;break-inside:avoid}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border:1px solid #ccc;padding:5px 7px;vertical-align:top;text-align:left}.fn{font-size:11.5px;color:#555;margin:2px 0}.card{border:1px solid #ccc;border-radius:6px;padding:8px 12px;margin:8px 0;break-inside:avoid}`

const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function itemToHtml(item: StudioItem, r: Resolver, notebookTitle: string): string {
  const ids = collectCiteIds(item.content)
  const n = numberer(ids)
  const sup = (c: string[]) => (c.length ? `<sup>${c.map(n).join(',')}</sup>` : '')
  let body = ''
  switch (item.kind) {
    case 'guide':
    case 'notes': {
      let inList = false
      for (const b of (item.content as DocContent).blocks) {
        if (b.kind !== 'li' && inList) (body += '</ul>', (inList = false))
        if (b.kind === 'h2') body += `<h2>${h(b.text)}</h2>`
        else if (b.kind === 'h3') body += `<h3>${h(b.text)}</h3>`
        else if (b.kind === 'li') {
          if (!inList) (body += '<ul>', (inList = true))
          body += `<li>${h(b.text)}${sup(b.cites)}</li>`
        } else body += `<p>${h(b.text)}${sup(b.cites)}</p>`
      }
      if (inList) body += '</ul>'
      break
    }
    case 'flashcards':
      body = (item.content as FlashContent).cards.map((c) => `<div class="card"><b>${h(c.front)}</b><br>${h(c.back).replace(/\n/g, '<br>')}${sup(c.cites)}</div>`).join('')
      break
    case 'quiz':
      body = (item.content as QuizContent).questions
        .map((q, i) => `<div class="q"><b>${i + 1}. ${h(q.prompt)}</b><ol type="a">${q.options.map((o, j) => `<li>${h(o)}${j === q.answer ? ' ✓' : ''}</li>`).join('')}</ol><i>${h(q.explanation)}</i>${sup(q.cites)}</div>`)
        .join('')
      break
    case 'mindmap': {
      const walk = (m: MapNode): string => `<li>${h(m.label)}${sup(m.cites)}${m.children.length ? `<ul>${m.children.map(walk).join('')}</ul>` : ''}</li>`
      body = `<ul>${walk((item.content as MapContent).root)}</ul>`
      break
    }
    case 'deck':
      body = (item.content as DeckContent).slides.map((s, i) => `<h2>${i + 1}. ${h(s.title)}</h2><ul>${s.bullets.map((b) => `<li>${h(b.text)}${sup(b.cites)}</li>`).join('')}</ul>`).join('')
      break
    case 'table': {
      const t = item.content as TableContent
      body = `<table><tr><th></th>${t.columns.map((c) => `<th>${h(c.name)}</th>`).join('')}</tr>${t.rows.map((row) => `<tr><td><b>${h(row.label)}</b></td>${t.columns.map((c) => `<td>${h(row.cells[c.id]?.text ?? '')}${sup(row.cells[c.id]?.cites ?? [])}</td>`).join('')}</tr>`).join('')}</table>`
      break
    }
    case 'glossary':
      body = (item.content as GlossaryContent).entries.map((e) => `<p><b>${h(e.term)}</b> — ${h(e.definition)}${sup(e.cites)}</p>`).join('')
      break
  }
  const notes = ids.map((id) => `<p class="fn"><sup>${n(id)}</sup> ${h(r.label(id))} — “${h(r.quote(id, 180))}”</p>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${h(item.title)}</title><style>${PRINT_CSS}</style></head><body><h1>${h(item.title)}</h1><div class="sub">${h(notebookTitle)}</div>${body}${ids.length ? '<h2>Sources</h2>' + notes : ''}</body></html>`
}

export function printHtml(html: string) {
  const f = document.createElement('iframe')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(f)
  const doc = f.contentDocument!
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    f.contentWindow?.focus()
    f.contentWindow?.print()
    setTimeout(() => f.remove(), 2000)
  }, 250)
}
