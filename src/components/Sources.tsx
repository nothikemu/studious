import { useEffect, useMemo, useRef, useState } from 'react'
import { db, deleteSource } from '../db'
import { ACCEPT, addSource, extractFromFile } from '../lib/ingest'
import { detectStructure, locateQuote } from '../lib/text'
import { useUI } from '../store'
import { useNb } from './nb'
import { Button, Dialog, Empty, Icon, IconButton, Menu } from './ui'

export function SourcesPane() {
  const { notebook, sources, chunks } = useNb()
  const reader = useUI((s) => s.reader)
  const toast = useUI((s) => s.toast)
  const openReader = useUI((s) => s.openReader)
  const [adding, setAdding] = useState(false)
  const [pending, setPending] = useState<string[]>([])
  const [drag, setDrag] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const ingest = async (files: File[]) => {
    for (const f of files) {
      setPending((p) => [...p, f.name])
      try {
        const ex = await extractFromFile(f)
        await addSource(notebook.id, f.name, ex)
      } catch (e) {
        toast((e as Error).message, 'error')
      } finally {
        setPending((p) => p.filter((n) => n !== f.name))
      }
    }
  }

  if (reader) return <Reader />

  const active = sources.filter((s) => s.enabled).length
  return (
    <div
      className={`pane-body ${drag ? 'is-drag' : ''}`}
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        ingest([...e.dataTransfer.files])
      }}
    >
      <div className="pane-actions">
        <Button variant="secondary" icon="plus" onClick={() => setAdding(true)} style={{ flex: 1 }}>
          Add sources
        </Button>
        <input ref={fileRef} hidden multiple type="file" accept={ACCEPT} onChange={(e) => (ingest([...(e.target.files ?? [])]), (e.target.value = ''))} />
      </div>

      {sources.length > 0 && (
        <label className="check-all">
          <input
            type="checkbox"
            checked={active === sources.length}
            ref={(el) => {
              if (el) el.indeterminate = active > 0 && active < sources.length
            }}
            onChange={(e) => db.sources.bulkUpdate(sources.map((s) => ({ key: s.id, changes: { enabled: e.target.checked } })))}
          />
          <span>
            {active} of {sources.length} used for answers
          </span>
        </label>
      )}

      <ul className="src-list">
        {pending.map((n, i) => (
          <li key={n + i} className="src is-pending">
            <span className="spin" aria-hidden="true" />
            <span className="src-title">Reading {n}…</span>
          </li>
        ))}
        {sources.map((s) => (
          <li key={s.id} className={`src ${s.enabled ? '' : 'is-off'}`}>
            <input type="checkbox" aria-label={`Use ${s.title} in answers`} checked={s.enabled} onChange={(e) => db.sources.update(s.id, { enabled: e.target.checked })} />
            <button className="src-main" onClick={() => openReader(s.id)}>
              <Icon name={s.kind === 'pdf' ? 'pdf' : 'doc'} size={17} />
              <span className="src-text">
                <span className="src-title">{s.title}</span>
                <span className="meta">
                  {s.wordCount.toLocaleString()} words
                  {s.pages ? ` · ${s.pages.length} pp` : ''} · {chunks.filter((c) => c.sourceId === s.id).length} passages
                </span>
              </span>
            </button>
            <Menu
              label={`Actions for ${s.title}`}
              items={[
                { label: 'Open', icon: 'eye', onClick: () => openReader(s.id) },
                {
                  label: 'Rename…',
                  icon: 'edit',
                  onClick: () => {
                    const t = prompt('Rename source', s.title)
                    if (t?.trim()) db.sources.update(s.id, { title: t.trim() })
                  },
                },
                'sep',
                { label: 'Remove source', icon: 'trash', danger: true, onClick: () => confirm(`Remove “${s.title}”? Citations pointing to it will stop working.`) && deleteSource(s.id) },
              ]}
            />
          </li>
        ))}
      </ul>

      {!sources.length && !pending.length && (
        <Empty icon="upload" title="Drop in your material" action={<Button variant="primary" icon="upload" onClick={() => setAdding(true)}>Add a source</Button>}>
          PDFs, Markdown, text or HTML — or paste text. Everything stays in this browser.
        </Empty>
      )}
      {drag && <div className="drop-hint">Drop to add</div>}

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onFiles={(f) => (setAdding(false), ingest(f))}
          onPaste={async (title, text) => {
            try {
              await addSource(notebook.id, title, { text, kind: 'paste' })
              setAdding(false)
            } catch (e) {
              toast((e as Error).message, 'error')
            }
          }}
        />
      )}
    </div>
  )
}

function AddDialog({ onClose, onFiles, onPaste }: { onClose: () => void; onFiles: (f: File[]) => void; onPaste: (title: string, text: string) => void }) {
  const [tab, setTab] = useState<'file' | 'paste'>('file')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Dialog
      title="Add sources"
      onClose={onClose}
      footer={
        tab === 'paste' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={text.trim().split(/\s+/).length < 5} onClick={() => onPaste(title.trim() || 'Pasted text', text)}>
              Add text
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="tabs" role="tablist">
        {(['file', 'paste'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'file' ? 'Upload files' : 'Paste text'}
          </button>
        ))}
      </div>
      {tab === 'file' ? (
        <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), onFiles([...e.dataTransfer.files]))}>
          <Icon name="upload" size={26} />
          <p>
            <strong>Drag files here</strong> or
          </p>
          <Button variant="primary" onClick={() => ref.current?.click()} data-autofocus>
            Choose files
          </Button>
          <input ref={ref} hidden multiple type="file" accept={ACCEPT} onChange={(e) => e.target.files && onFiles([...e.target.files])} />
          <p className="meta">PDF · Markdown · Text · HTML — up to 40 MB each. Scanned PDFs need selectable text.</p>
        </div>
      ) : (
        <div className="stack">
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Week 3 lecture notes" />
          </label>
          <label className="field">
            <span>Text</span>
            <textarea data-autofocus rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an article, notes or a transcript…" />
          </label>
        </div>
      )}
    </Dialog>
  )
}

// ----------------------------------------------------------------------------- Reader
function Reader() {
  const { sources, chunks, resolver } = useNb()
  const reader = useUI((s) => s.reader)!
  const close = useUI((s) => s.closeReader)
  const source = sources.find((s) => s.id === reader.sourceId)
  const [find, setFind] = useState('')
  const hlRef = useRef<HTMLElement | null>(null)
  const blocks = useMemo(() => (source ? detectStructure(source.text) : []), [source?.id, source?.text])
  const range = useMemo(() => {
    const c = reader.chunkId ? chunks.find((x) => x.id === reader.chunkId) : undefined
    if (!c) return null
    // prefer the exact sentence that was cited; fall back to the whole passage
    const exact = source && reader.quote ? locateQuote(source.text, reader.quote, c.start, c.end) : null
    return exact ?? { start: c.start, end: c.end }
  }, [reader.chunkId, reader.quote, chunks, source])

  useEffect(() => {
    hlRef.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [reader.nonce, source?.id, blocks.length])

  if (!source)
    return (
      <div className="pane-body">
        <Empty icon="warn" title="Source not found" action={<Button onClick={close}>Back to sources</Button>}>
          It may have been removed.
        </Empty>
      </div>
    )

  const q = find.trim().toLowerCase()
  const renderText = (text: string, start: number) => {
    // split into [before | highlighted | after] by the cited range, then mark find matches
    const parts: { t: string; hl: boolean }[] = []
    if (range && range.end > start && range.start < start + text.length) {
      const a = Math.max(0, range.start - start)
      const b = Math.min(text.length, range.end - start)
      if (a > 0) parts.push({ t: text.slice(0, a), hl: false })
      parts.push({ t: text.slice(a, b), hl: true })
      if (b < text.length) parts.push({ t: text.slice(b), hl: false })
    } else parts.push({ t: text, hl: false })
    return parts.map((p, i) => {
      const inner = q
        ? p.t.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig')).map((seg, j) => (seg.toLowerCase() === q ? <mark key={j} className="find">{seg}</mark> : seg))
        : p.t
      return p.hl ? (
        <mark key={i} className="cited" ref={(el) => { if (el && !hlRef.current) hlRef.current = el }}>
          {inner}
        </mark>
      ) : (
        <span key={i}>{inner}</span>
      )
    })
  }
  hlRef.current = null
  let lastPage = 0
  return (
    <div className="reader">
      <div className="reader-head">
        <IconButton icon="back" label="Back to sources" onClick={close} />
        <div className="reader-title">
          <strong>{source.title}</strong>
          {reader.chunkId && <span className="meta">Showing cited passage — {resolver.label(reader.chunkId)}</span>}
        </div>
      </div>
      <div className="reader-find">
        <Icon name="search" size={15} />
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in this source" aria-label="Find in this source" />
      </div>
      <article className="reader-body" lang="en">
        {blocks.map((b, i) => {
          const pg = source.pages?.find((p) => b.start >= p.start && b.start <= p.end)?.page
          const pageMark = pg && pg !== lastPage ? ((lastPage = pg), <div className="page-mark" key={`p${pg}`}>Page {pg}</div>) : null
          return (
            <div key={i}>
              {pageMark}
              {b.type === 'heading' ? <h3 className={`h-${b.level}`}>{renderText(b.text, b.start)}</h3> : <p>{renderText(b.text, b.start)}</p>}
            </div>
          )
        })}
      </article>
    </div>
  )
}
