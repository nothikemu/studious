import { db } from '../db'
import type { PageRange, Source, SourceKind } from '../types'
import { uid } from './ids'
import { chunkText, wordCount } from './text'

export interface Extracted {
  text: string
  kind: SourceKind
  pages?: PageRange[]
}

export const ACCEPT = '.pdf,.txt,.md,.markdown,.html,.htm,text/plain,text/markdown,text/html,application/pdf'
export const MAX_FILE_BYTES = 40 * 1024 * 1024

export async function extractFromFile(file: File): Promise<Extracted> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`“${file.name}” is larger than 40 MB.`)
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdf(await file.arrayBuffer())
  const raw = await file.text()
  if (name.endsWith('.html') || name.endsWith('.htm') || file.type === 'text/html') return { text: htmlToText(raw), kind: 'html' }
  if (name.endsWith('.md') || name.endsWith('.markdown')) return { text: normalize(raw), kind: 'markdown' }
  if (name.endsWith('.txt') || file.type.startsWith('text/')) return { text: normalize(raw), kind: 'text' }
  throw new Error(`“${file.name}” isn’t a supported type. Use PDF, Markdown, text or HTML — or paste the text.`)
}

export function normalize(t: string): string {
  return t.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,noscript,nav,footer,header,aside,svg,form').forEach((n) => n.remove())
  doc.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    const level = Number(h.tagName[1])
    h.textContent = `\n\n${'#'.repeat(Math.min(level, 4))} ${(h.textContent ?? '').trim()}\n\n`
  })
  doc.querySelectorAll('p,div,section,article,blockquote,tr').forEach((n) => n.append('\n\n'))
  doc.querySelectorAll('li').forEach((n) => n.append('\n'))
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'))
  return normalize(doc.body?.textContent ?? '')
}

async function extractPdf(buf: ArrayBuffer): Promise<Extracted> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise
  let text = ''
  const pages: PageRange[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    let out = ''
    let lastY: number | null = null
    let lastH = 10
    for (const it of content.items as any[]) {
      if (typeof it.str !== 'string') continue
      const y = it.transform?.[5] as number
      const h = (it.height as number) || lastH
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        const gap = Math.abs(y - lastY)
        out += gap > h * 1.9 ? '\n\n' : '\n'
      } else if (out && !out.endsWith(' ') && !out.endsWith('\n') && it.str && !it.str.startsWith(' ')) out += ' '
      out += it.str
      if (it.hasEOL && !out.endsWith('\n')) out += '\n'
      lastY = y
      lastH = h
    }
    out = out.replace(/-\n(?=[a-z])/g, '').replace(/[ \t]+/g, ' ')
    const start = text.length + (text ? 2 : 0)
    text += (text ? '\n\n' : '') + out.trim()
    pages.push({ page: p, start, end: text.length })
  }
  if (text.replace(/\s/g, '').length < 40)
    throw new Error('No selectable text was found in this PDF. It may be a scan — OCR isn’t supported yet.')
  return { text, kind: 'pdf', pages }
}

export async function addSource(notebookId: string, title: string, ex: Extracted): Promise<Source> {
  const text = ex.kind === 'pdf' ? ex.text : normalize(ex.text)
  if (wordCount(text) < 5) throw new Error('That source is nearly empty.')
  const id = uid('s_')
  const source: Source = {
    id,
    notebookId,
    title: title.replace(/\.(pdf|txt|md|markdown|html?)$/i, '').trim() || 'Untitled source',
    kind: ex.kind,
    text,
    pages: ex.pages,
    enabled: true,
    addedAt: Date.now(),
    wordCount: wordCount(text),
  }
  const chunks = chunkText(text, { sourceId: id, notebookId, idPrefix: id }, ex.pages)
  await db.transaction('rw', [db.sources, db.chunks, db.notebooks], async () => {
    await db.sources.add(source)
    await db.chunks.bulkAdd(chunks)
    await db.notebooks.update(notebookId, { updatedAt: Date.now() })
  })
  return source
}
