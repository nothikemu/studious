import MiniSearch from 'minisearch'
import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../db'
import { clip, stem } from '../lib/text'
import { go, useUI } from '../store'
import { STUDIO_META } from '../studio/meta'
import type { StudioItem } from '../types'
import { Dialog, Icon } from './ui'

interface Doc {
  id: string
  type: 'passage' | 'item' | 'card'
  title: string
  body: string
  nbId: string
  nbTitle: string
  sourceId?: string
  chunkId?: string
  itemId?: string
}

function itemText(i: StudioItem): string {
  const out: string[] = []
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string' && ['text', 'front', 'back', 'prompt', 'label', 'term', 'definition', 'title', 'name', 'explanation'].includes(key)) out.push(v)
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key))
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k))
  }
  walk(i.content)
  return out.join(' ')
}

export function SearchDialog() {
  const close = () => useUI.getState().setSearchOpen(false)
  const openReader = useUI((s) => s.openReader)
  const openItem = useUI((s) => s.openItem)
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    ;(async () => {
      const [nbs, sources, chunks, items, cards] = await Promise.all([db.notebooks.toArray(), db.sources.toArray(), db.chunks.toArray(), db.items.toArray(), db.cards.toArray()])
      const nb = new Map(nbs.map((n) => [n.id, n.title]))
      const sm = new Map(sources.map((s) => [s.id, s.title]))
      const d: Doc[] = [
        ...chunks.map((c): Doc => ({ id: 'p' + c.id, type: 'passage', title: `${sm.get(c.sourceId) ?? ''}${c.heading ? ` › ${c.heading}` : ''}`, body: c.text, nbId: c.notebookId, nbTitle: nb.get(c.notebookId) ?? '', sourceId: c.sourceId, chunkId: c.id })),
        ...items.map((i): Doc => ({ id: 'i' + i.id, type: 'item', title: `${STUDIO_META[i.kind].label}: ${i.title}`, body: itemText(i), nbId: i.notebookId, nbTitle: nb.get(i.notebookId) ?? '', itemId: i.id })),
        ...cards.map((c): Doc => ({ id: 'c' + c.id, type: 'card', title: c.front, body: c.back, nbId: c.notebookId, nbTitle: nb.get(c.notebookId) ?? '', chunkId: c.cites[0] })),
      ]
      setDocs(d)
    })()
  }, [])

  const index = useMemo(() => {
    if (!docs) return null
    const ms = new MiniSearch<Doc>({ fields: ['title', 'body'], storeFields: [], idField: 'id', processTerm: (t) => stem(t.toLowerCase()), searchOptions: { prefix: true, fuzzy: 0.15, boost: { title: 2 }, combineWith: 'AND' } })
    ms.addAll(docs)
    return ms
  }, [docs])

  const results = useMemo(() => {
    if (!index || !docs || !q.trim()) return []
    const byId = new Map(docs.map((d) => [d.id, d]))
    let r = index.search(q)
    if (!r.length) r = index.search(q, { combineWith: 'OR' })
    return r.slice(0, 30).map((x) => byId.get(x.id as string)!)
  }, [index, docs, q])

  useEffect(() => setSel(0), [q])
  useEffect(() => listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' }), [sel])

  const pick = (d: Doc) => {
    close()
    go(`/n/${d.nbId}`)
    setTimeout(() => {
      if (d.type === 'item' && d.itemId) openItem(d.itemId)
      else if (d.chunkId) {
        const sid = d.sourceId ?? undefined
        if (sid) openReader(sid, d.chunkId)
        else db.chunks.get(d.chunkId).then((c) => c && openReader(c.sourceId, c.id))
      }
    }, 120)
  }

  const hl = (text: string) => {
    const terms = q.trim().split(/\s+/).filter((t) => t.length > 1)
    if (!terms.length) return clip(text, 150)
    const lower = text.toLowerCase()
    const at = Math.max(0, Math.min(...terms.map((t) => lower.indexOf(t.toLowerCase())).filter((i) => i >= 0), text.length) - 40)
    const snip = text.slice(at, at + 170)
    const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
    return (at > 0 ? '…' : '') + snip.split(re).map((p, i) => (i % 2 ? `\u0000${p}\u0001` : p)).join('') + (at + 170 < text.length ? '…' : '')
  }
  const renderHl = (s: string) => s.split(/(\u0000.*?\u0001)/).map((p, i) => (p.startsWith('\u0000') ? <mark key={i}>{p.slice(1, -1)}</mark> : p))

  return (
    <Dialog title="Search everything" onClose={close} width={640}>
      <div className="search-box">
        <Icon name="search" size={18} />
        <input
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search passages, studio items and cards in every notebook"
          aria-label="Search"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(results.length - 1, s + 1)))
            if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)))
            if (e.key === 'Enter' && results[sel]) pick(results[sel])
          }}
        />
      </div>
      {!docs && <p className="hint">Indexing…</p>}
      {docs && q.trim() && !results.length && <p className="hint">No matches for “{q}”.</p>}
      {docs && !q.trim() && <p className="hint">{docs.length.toLocaleString()} items indexed. Try a term, a question, or a card.</p>}
      <ul className="results" ref={listRef} role="listbox">
        {results.map((d, i) => (
          <li key={d.id} role="option" aria-selected={i === sel} className={i === sel ? 'is-sel' : ''}>
            <button onClick={() => pick(d)} onMouseMove={() => setSel(i)}>
              <span className={`kind kind-${d.type}`}>{d.type === 'passage' ? 'Passage' : d.type === 'item' ? 'Studio' : 'Card'}</span>
              <span className="r-main">
                <strong>{clip(d.title, 80)}</strong>
                <span>{renderHl(hl(d.body))}</span>
                <small>{d.nbTitle}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
