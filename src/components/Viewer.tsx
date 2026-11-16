import { useMemo, useState, type ReactNode } from 'react'
import { db } from '../db'
import { collectCiteIds, numberer } from '../lib/cites'
import { deckToPptx, download, flashcardsAnki, flashcardsCsv, glossaryCsv, itemToHtml, itemToMarkdown, mapToSvg, printHtml, quizJson, slug, tableCsv } from '../lib/export'
import { useUI } from '../store'
import { STUDIO_META } from '../studio/meta'
import { addTableColumn, glossaryToCards } from '../studio/generate'
import type { Block, DocContent, GlossaryContent, MapContent, StudioItem, TableContent } from '../types'
import { uid } from '../lib/ids'
import { Cites } from './Cite'
import { FlashViewer } from './Flash'
import { DeckViewer, MapViewer } from './MapDeck'
import { useNb } from './nb'
import { QuizViewer } from './Quiz'
import { deleteItem, kindIcon } from './Studio'
import { Button, Icon, IconButton, Menu } from './ui'

export function Viewer({ item, onRegenerate, configDialog }: { item: StudioItem; onRegenerate: () => void; configDialog: ReactNode }) {
  const { notebook, resolver } = useNb()
  const openItem = useUI((s) => s.openItem)
  const rightWide = useUI((s) => s.rightWide)
  const setRightWide = useUI((s) => s.setRightWide)
  const toast = useUI((s) => s.toast)
  const [editingTitle, setEditingTitle] = useState(false)
  const name = slug(`${notebook.title}-${item.title}`)

  const exports = [
    { label: 'Markdown (.md)', icon: 'download', onClick: () => download(`${name}.md`, itemToMarkdown(item, resolver, notebook.title), 'text/markdown') },
    { label: 'PDF / print…', icon: 'download', onClick: () => printHtml(itemToHtml(item, resolver, notebook.title)) },
    ...(item.kind === 'flashcards'
      ? [
          { label: 'CSV (Front, Back)', icon: 'download', onClick: () => download(`${name}.csv`, flashcardsCsv(item.content as any), 'text/csv') },
          { label: 'Anki import (.txt)', icon: 'download', onClick: () => download(`${name}-anki.txt`, flashcardsAnki(item.content as any), 'text/plain') },
        ]
      : []),
    ...(item.kind === 'quiz' ? [{ label: 'JSON', icon: 'download', onClick: () => download(`${name}.json`, quizJson(item.content as any), 'application/json') }] : []),
    ...(item.kind === 'mindmap' ? [{ label: 'SVG image', icon: 'download', onClick: () => download(`${name}.svg`, mapToSvg((item.content as MapContent).root), 'image/svg+xml') }] : []),
    ...(item.kind === 'deck' ? [{ label: 'PowerPoint (.pptx)', icon: 'download', onClick: () => deckToPptx(item, resolver, item.title).catch((e) => toast(`Couldn’t build the deck: ${e.message}`, 'error')) }] : []),
    ...(item.kind === 'table' ? [{ label: 'CSV', icon: 'download', onClick: () => download(`${name}.csv`, tableCsv(item.content as TableContent), 'text/csv') }] : []),
    ...(item.kind === 'glossary' ? [{ label: 'CSV', icon: 'download', onClick: () => download(`${name}.csv`, glossaryCsv(item.content as GlossaryContent), 'text/csv') }] : []),
  ] as { label: string; icon: any; onClick: () => void }[]

  return (
    <div className="viewer">
      <div className="viewer-head">
        <IconButton icon="back" label="Back to Studio" onClick={() => openItem(null)} />
        <div className="viewer-title">
          {editingTitle ? (
            <input
              autoFocus
              defaultValue={item.title}
              aria-label="Title"
              onBlur={(e) => (db.items.update(item.id, { title: e.target.value.trim() || item.title }), setEditingTitle(false))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button className="title-btn" onClick={() => setEditingTitle(true)} title="Rename">
              <Icon name={kindIcon(item.kind)} size={16} /> <span>{item.title}</span>
            </button>
          )}
          <span className="meta">
            {STUDIO_META[item.kind].label} · {item.mode === 'llm' ? 'Written by your model' : 'Built offline'}
          </span>
        </div>
        <IconButton icon={rightWide ? 'shrink' : 'expand'} label={rightWide ? 'Narrow panel' : 'Widen panel'} className="hide-narrow" onClick={() => setRightWide(!rightWide)} />
        <Menu
          label="Export"
          icon="download"
          items={exports}
        />
        <Menu
          label="More"
          items={[
            { label: 'Regenerate…', icon: 'spark', onClick: onRegenerate },
            'sep',
            {
              label: 'Delete',
              icon: 'trash',
              danger: true,
              onClick: async () => {
                if (!confirm(`Delete “${item.title}”?${item.kind === 'flashcards' ? ' Its cards leave your review queue too.' : ''}`)) return
                openItem(null)
                await deleteItem(item.id)
              },
            },
          ]}
        />
      </div>
      <div className="viewer-body">
        {(item.kind === 'guide' || item.kind === 'notes') && <DocViewer item={item as StudioItem<DocContent>} />}
        {item.kind === 'flashcards' && <FlashViewer item={item as any} />}
        {item.kind === 'quiz' && <QuizViewer item={item as any} />}
        {item.kind === 'mindmap' && <MapViewer item={item as StudioItem<MapContent>} />}
        {item.kind === 'deck' && <DeckViewer item={item as any} />}
        {item.kind === 'table' && <TableViewer item={item as StudioItem<TableContent>} />}
        {item.kind === 'glossary' && <GlossaryViewer item={item as StudioItem<GlossaryContent>} />}
      </div>
      {configDialog}
    </div>
  )
}

export function useCiteNumber(content: unknown) {
  const ids = useMemo(() => collectCiteIds(content), [content])
  return useMemo(() => numberer(ids), [ids])
}

export const saveContent = (id: string, content: unknown) => db.items.update(id, { content, updatedAt: Date.now() })

// ------------------------------------------------------------------ guide / notes
function DocViewer({ item }: { item: StudioItem<DocContent> }) {
  const num = useCiteNumber(item.content)
  const [edit, setEdit] = useState(false)
  const blocks = item.content.blocks
  const set = (next: Block[]) => saveContent(item.id, { blocks: next })
  const update = (i: number, patch: Partial<Block>) => set(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  return (
    <div className="doc">
      <div className="doc-bar">
        <Button size="sm" variant={edit ? 'primary' : 'secondary'} icon={edit ? 'check' : 'edit'} onClick={() => setEdit(!edit)}>
          {edit ? 'Done editing' : 'Edit'}
        </Button>
        <span className="meta">Superscript numbers open the source passage.</span>
      </div>
      {!edit && (
        <article className="prose">
          {groupLists(blocks).map((g, gi) =>
            g.type === 'ul' ? (
              <ul key={gi}>
                {g.items.map((b) => (
                  <li key={b.id}>
                    {b.text} <Cites ids={b.cites} number={num} quote={b.text} />
                  </li>
                ))}
              </ul>
            ) : g.b.kind === 'h2' ? (
              <h2 key={g.b.id}>{g.b.text}</h2>
            ) : g.b.kind === 'h3' ? (
              <h3 key={g.b.id}>{g.b.text}</h3>
            ) : (
              <p key={g.b.id}>
                {g.b.text} <Cites ids={g.b.cites} number={num} quote={g.b.text} />
              </p>
            ),
          )}
        </article>
      )}
      {edit && (
        <div className="edit-blocks">
          {blocks.map((b, i) => (
            <div key={b.id} className="edit-block">
              <select aria-label="Block type" value={b.kind} onChange={(e) => update(i, { kind: e.target.value as Block['kind'] })}>
                <option value="h2">Heading</option>
                <option value="h3">Subheading</option>
                <option value="p">Paragraph</option>
                <option value="li">Bullet</option>
              </select>
              <AutoText value={b.text} onCommit={(t) => update(i, { text: t })} />
              <div className="edit-block-actions">
                <IconButton icon="plus" label="Add paragraph below" size={15} onClick={() => set([...blocks.slice(0, i + 1), { id: uid('b'), kind: 'p', text: 'New paragraph', cites: [] }, ...blocks.slice(i + 1)])} />
                <IconButton icon="trash" label="Delete block" size={15} onClick={() => set(blocks.filter((_, j) => j !== i))} />
              </div>
            </div>
          ))}
          <Button icon="plus" onClick={() => set([...blocks, { id: uid('b'), kind: 'p', text: 'New paragraph', cites: [] }])}>
            Add block
          </Button>
        </div>
      )}
    </div>
  )
}

type Group = { type: 'ul'; items: Block[] } | { type: 'b'; b: Block }
function groupLists(blocks: Block[]): Group[] {
  const out: Group[] = []
  for (const b of blocks) {
    if (b.kind === 'li') {
      const last = out[out.length - 1]
      if (last?.type === 'ul') last.items.push(b)
      else out.push({ type: 'ul', items: [b] })
    } else out.push({ type: 'b', b })
  }
  return out
}

export function AutoText({ value, onCommit, className = '', label = 'Text' }: { value: string; onCommit: (t: string) => void; className?: string; label?: string }) {
  const [v, setV] = useState(value)
  const [last, setLast] = useState(value)
  if (value !== last) (setLast(value), setV(value))
  return (
    <textarea
      aria-label={label}
      className={`autotext ${className}`}
      value={v}
      rows={Math.max(1, Math.ceil(v.length / 52))}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
    />
  )
}

// ------------------------------------------------------------------ glossary
function GlossaryViewer({ item }: { item: StudioItem<GlossaryContent> }) {
  const { notebook } = useNb()
  const toast = useUI((s) => s.toast)
  const num = useCiteNumber(item.content)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'term' | 'formula'>('all')
  const entries = item.content.entries.filter((e) => (kind === 'all' || e.kind === kind) && (!q || (e.term + e.definition).toLowerCase().includes(q.toLowerCase())))
  const hasFormulas = item.content.entries.some((e) => e.kind === 'formula')
  const groups = Object.entries(
    entries.reduce<Record<string, typeof entries>>((acc, e) => {
      const l = e.kind === 'formula' ? '∑' : (e.term[0]?.toUpperCase() ?? '#')
      ;(acc[l] ??= []).push(e)
      return acc
    }, {}),
  )
  return (
    <div className="glossary">
      <div className="toolbar">
        <div className="search-mini">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter terms" aria-label="Filter glossary" />
        </div>
        {hasFormulas && (
          <div className="seg">
            {(['all', 'term', 'formula'] as const).map((k) => (
              <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'all' ? 'All' : k === 'term' ? 'Terms' : 'Formulas'}
              </button>
            ))}
          </div>
        )}
        <Button
          size="sm"
          icon="cards"
          onClick={async () => toast(`${await glossaryToCards(notebook.id, item.id, item.content.entries)} new cards added to review.`, 'success')}
        >
          Add terms to review
        </Button>
      </div>
      <div className="gloss">
        {groups.map(([l, list]) => (
          <section key={l} className="gloss-group">
            <h3 className="letter">{l === '∑' ? 'Formulas' : l}</h3>
            <dl>
              {list.map((e) => (
                <div key={e.id} className="gloss-row">
                  <dt>{e.term}</dt>
                  <dd className={e.kind === 'formula' ? 'mono' : ''}>
                    {e.definition} <Cites ids={e.cites} number={num} quote={e.definition} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {!entries.length && <p className="hint">No entries match.</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ table
function TableViewer({ item }: { item: StudioItem<TableContent> }) {
  const num = useCiteNumber(item.content)
  const toast = useUI((s) => s.toast)
  const [col, setCol] = useState('')
  const [busy, setBusy] = useState(false)
  const t = item.content
  const setCell = (rid: string, cid: string, text: string) =>
    saveContent(item.id, { ...t, rows: t.rows.map((r) => (r.id === rid ? { ...r, cells: { ...r.cells, [cid]: { ...r.cells[cid], text } } } : r)) })
  return (
    <div className="table-view">
      <form
        className="toolbar"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!col.trim()) return
          setBusy(true)
          try {
            await addTableColumn(item.id, col.trim())
            setCol('')
          } catch (err) {
            toast((err as Error).message, 'error')
          } finally {
            setBusy(false)
          }
        }}
      >
        <input value={col} onChange={(e) => setCol(e.target.value)} placeholder="Add a column — e.g. “Where it occurs”" aria-label="New column name" />
        <Button type="submit" size="sm" icon="plus" busy={busy}>
          Add column
        </Button>
      </form>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Data table">
        <table>
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Row</span></th>
              {t.columns.map((c) => (
                <th scope="col" key={c.id}>
                  <span>{c.name}</span>
                  <button className="th-x" aria-label={`Remove column ${c.name}`} onClick={() => saveContent(item.id, { columns: t.columns.filter((x) => x.id !== c.id), rows: t.rows })}>
                    <Icon name="x" size={12} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                {t.columns.map((c) => {
                  const cell = r.cells[c.id]
                  return (
                    <td key={c.id} className={cell?.cites.length ? '' : 'is-missing'}>
                      <span contentEditable suppressContentEditableWarning onBlur={(e) => e.currentTarget.textContent !== cell?.text && setCell(r.id, c.id, e.currentTarget.textContent ?? '')}>
                        {cell?.text}
                      </span>{' '}
                      <Cites ids={cell?.cites ?? []} number={num} quote={cell?.text} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Cells marked “not found” mean your sources don’t say — click any cell to edit it.</p>
    </div>
  )
}
