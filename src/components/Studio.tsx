import { useState } from 'react'
import { db } from '../db'
import { STUDIO_META, STUDIO_ORDER } from '../studio/meta'
import { DEFAULT_TABLE_COLUMNS } from '../studio/offline'
import { generateStudio, type GenParams } from '../studio/generate'
import { useUI } from '../store'
import type { StudioKind } from '../types'
import { useNb } from './nb'
import { Viewer } from './Viewer'
import { Button, Dialog, Icon, ago, type IconName } from './ui'

const ICON: Record<StudioKind, IconName> = { guide: 'guide', flashcards: 'cards', quiz: 'quiz', mindmap: 'mindmap', deck: 'deck', table: 'table', glossary: 'glossary', notes: 'notes' }
export const kindIcon = (k: StudioKind) => ICON[k]

/** Shared by the Studio view and the chat quick-cards: opens the config dialog, generates, then opens the result. */
export function useStudioLauncher() {
  const { notebook } = useNb()
  const openItem = useUI((s) => s.openItem)
  const ai = useUI((s) => s.ai)
  const toast = useUI((s) => s.toast)
  const [config, setConfig] = useState<StudioKind | null>(null)
  const [busy, setBusy] = useState<StudioKind[]>([])

  async function run(kind: StudioKind, params: GenParams) {
    setConfig(null)
    setBusy((b) => [...b, kind])
    try {
      const { item: made, note } = await generateStudio(notebook.id, kind, params, ai)
      if (note) toast(note, 'info')
      openItem(made.id)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy((b) => b.filter((_, i) => i !== b.indexOf(kind)))
    }
  }
  const dialog = config ? <ConfigDialog kind={config} onClose={() => setConfig(null)} onGo={(p) => run(config, p)} /> : null
  return { busy, launch: (k: StudioKind) => setConfig(k), dialog }
}

export function StudioPane() {
  const { sources, items } = useNb()
  const itemId = useUI((s) => s.studioItemId)
  const openItem = useUI((s) => s.openItem)
  const { busy, launch, dialog } = useStudioLauncher()

  const item = items.find((i) => i.id === itemId)
  if (itemId && item) return <Viewer item={item} onRegenerate={() => launch(item.kind)} configDialog={dialog} />

  const usable = sources.some((s) => s.enabled)
  return (
    <div className="pane-body studio">
      <div className="studio-head">
        <h2>Study tools</h2>
        <p className="muted">Build study material from the sources you’ve switched on. Every item keeps its citations and can be edited and exported.</p>
      </div>
      <div className="mod-grid">
        {STUDIO_ORDER.map((k) => (
          <button key={k} data-kind={k} className="mod" disabled={!usable || busy.includes(k)} onClick={() => launch(k)}>
            <span className="mod-icon">{busy.includes(k) ? <span className="spin" /> : <Icon name={ICON[k]} size={20} />}</span>
            <span className="mod-name">{STUDIO_META[k].label}</span>
            <span className="mod-blurb">{busy.includes(k) ? 'Building…' : STUDIO_META[k].blurb}</span>
          </button>
        ))}
      </div>
      {!usable && <p className="hint">Add and switch on a source to unlock study tools.</p>}

      <div className="studio-list">
        <h3 className="section-label">Saved in this lesson</h3>
        {busy.map((k, i) => (
          <div key={k + i} className="item item-skel" aria-busy="true">
            <span className="item-ic skel" />
            <span className="item-text">
              <span className="skel skel-line" style={{ width: '40%' }} />
              <span className="skel skel-line" style={{ width: '25%' }} />
            </span>
          </div>
        ))}
        {items.length === 0 && busy.length === 0 && <p className="hint">Nothing yet. Pick a tool above.</p>}
        {items
          .slice()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((i) => (
            <button key={i.id} className="item" onClick={() => openItem(i.id)}>
              <span className="item-ic" data-kind={i.kind}>
                <Icon name={ICON[i.kind]} size={17} />
              </span>
              <span className="item-text">
                <span className="item-title">{i.title}</span>
                <span className="meta">
                  {STUDIO_META[i.kind].label} · {summary(i)} · {ago(i.updatedAt)}
                </span>
              </span>
              <Icon name="chevron" size={15} />
            </button>
          ))}
      </div>
      {dialog}
    </div>
  )
}

function summary(i: { kind: StudioKind; content: any }): string {
  const c = i.content
  switch (i.kind) {
    case 'guide':
    case 'notes': return `${c.blocks.length} blocks`
    case 'flashcards': return `${c.cards.length} cards`
    case 'quiz': return `${c.questions.length} questions`
    case 'mindmap': return `${c.root.children.length} branches`
    case 'deck': return `${c.slides.length} slides`
    case 'table': return `${c.rows.length}×${c.columns.length}`
    case 'glossary': return `${c.entries.length} entries`
  }
}

export function ConfigDialog({ kind, onClose, onGo }: { kind: StudioKind; onClose: () => void; onGo: (p: GenParams) => void }) {
  const { sources } = useNb()
  const ai = useUI((s) => s.ai)
  const [focus, setFocus] = useState('')
  const [count, setCount] = useState(kind === 'quiz' ? 10 : 20)
  const [difficulty, setDifficulty] = useState<GenParams['difficulty']>('adaptive')
  const [rowMode, setRowMode] = useState<'sources' | 'terms'>('sources')
  const [cols, setCols] = useState<string[]>(DEFAULT_TABLE_COLUMNS.sources)
  const [colInput, setColInput] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set(sources.filter((s) => s.enabled).map((s) => s.id)))
  const meta = STUDIO_META[kind]
  const addCol = () => {
    const v = colInput.trim()
    if (v && !cols.includes(v)) setCols([...cols, v])
    setColInput('')
  }
  return (
    <Dialog
      title={`New ${meta.noun}`}
      onClose={onClose}
      footer={
        <>
          <span className="meta grow">{ai.provider !== 'offline' && ai.apiKey ? 'Written by your connected model' : 'Built offline from quoted passages'}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            icon="spark"
            disabled={!picked.size}
            onClick={() => onGo({ focus: focus.trim() || undefined, count, difficulty, rowMode, columns: kind === 'table' ? cols : undefined, sourceIds: [...picked] })}
          >
            Generate
          </Button>
        </>
      }
    >
      <p className="muted">{meta.blurb}</p>
      <div className="stack">
        <label className="field">
          <span>Focus <em>(optional)</em></span>
          <input data-autofocus value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="A topic or question to concentrate on" />
        </label>
        {kind === 'flashcards' && (
          <label className="field">
            <span>Number of cards</span>
            <select value={count} onChange={(e) => setCount(+e.target.value)}>
              {[10, 20, 30, 40].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
        )}
        {kind === 'quiz' && (
          <div className="grid2">
            <label className="field">
              <span>Questions</span>
              <select value={count} onChange={(e) => setCount(+e.target.value)}>
                {[5, 10, 15, 20].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Difficulty</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as GenParams['difficulty'])}>
                <option value="adaptive">Adaptive (from your results)</option>
                <option value="mixed">Mixed</option>
                <option value="easy">Easy — recognise terms</option>
                <option value="medium">Medium — fill the blank</option>
                <option value="hard">Hard — match descriptions</option>
              </select>
            </label>
          </div>
        )}
        {kind === 'table' && (
          <>
            <fieldset className="field">
              <legend>Rows</legend>
              <div className="seg">
                {(['sources', 'terms'] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={rowMode === m ? 'on' : ''}
                    aria-pressed={rowMode === m}
                    onClick={() => (setRowMode(m), setCols(DEFAULT_TABLE_COLUMNS[m]))}
                  >
                    {m === 'sources' ? 'One per source' : 'One per key term'}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <span>Columns</span>
              <div className="chips">
                {cols.map((c) => (
                  <span key={c} className="chip chip-tag">
                    {c}
                    <button type="button" aria-label={`Remove column ${c}`} onClick={() => setCols(cols.filter((x) => x !== c))}>
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="row">
                <input aria-label="New column" value={colInput} onChange={(e) => setColInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCol())} placeholder="Add a column, e.g. “Where it occurs”" />
                <Button type="button" onClick={addCol}>Add</Button>
              </div>
            </div>
          </>
        )}
        {sources.length > 1 && (
          <fieldset className="field">
            <legend>Sources to use</legend>
            <div className="stack-sm">
              {sources.map((s) => (
                <label key={s.id} className="check">
                  <input
                    type="checkbox"
                    checked={picked.has(s.id)}
                    onChange={(e) => {
                      const n = new Set(picked)
                      e.target.checked ? n.add(s.id) : n.delete(s.id)
                      setPicked(n)
                    }}
                  />
                  <span>{s.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Dialog>
  )
}

export async function deleteItem(id: string) {
  await db.transaction('rw', [db.items, db.cards], async () => {
    await db.items.delete(id)
    await db.cards.where('itemId').equals(id).filter((c) => c.origin === 'flashcards').delete()
  })
}
