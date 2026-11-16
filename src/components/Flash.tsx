import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db'
import { retrievability, stateName } from '../lib/srs'
import { go } from '../store'
import type { FlashContent, FlashItem, StudioItem } from '../types'
import { Cites } from './Cite'
import { useNb } from './nb'
import { Button, Icon, IconButton } from './ui'
import { saveContent, useCiteNumber } from './Viewer'

export function FlashViewer({ item }: { item: StudioItem<FlashContent> }) {
  const { notebook } = useNb()
  const num = useCiteNumber(item.content)
  const cards = useLiveQuery(() => db.cards.where('itemId').equals(item.id).toArray(), [item.id])
  const byId = new Map((cards ?? []).map((c) => [c.id, c]))
  const now = Date.now()
  const due = (cards ?? []).filter((c) => !c.suspended && c.due <= now).length
  const fresh = (cards ?? []).filter((c) => c.fsrs.state === 0).length
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)

  const patch = async (f: FlashItem, p: Partial<FlashItem>) => {
    await saveContent(item.id, { cards: item.content.cards.map((c) => (c.id === f.id ? { ...c, ...p } : c)) })
    if (f.cardId) await db.cards.update(f.cardId, { front: p.front ?? f.front, back: p.back ?? f.back })
  }
  const remove = async (f: FlashItem) => {
    await saveContent(item.id, { cards: item.content.cards.filter((c) => c.id !== f.id) })
    if (f.cardId) await db.cards.delete(f.cardId)
  }

  return (
    <div className="flash">
      <div className="flash-summary">
        <div>
          <strong>{item.content.cards.length}</strong> cards · <span className="meta">{fresh} new · {due} due now</span>
        </div>
        <Button variant="primary" icon="review" disabled={!due && !fresh} onClick={() => go(`/n/${notebook.id}/review?item=${item.id}`)}>
          Study this deck
        </Button>
      </div>
      <p className="hint">Scheduled with FSRS at {Math.round(notebook.prefs.desiredRetention * 100)}% target retention. Click a card to reveal the answer.</p>
      <ul className="flash-list">
        {item.content.cards.map((f) => {
          const c = f.cardId ? byId.get(f.cardId) : undefined
          const shown = open.has(f.id)
          const isEdit = editing === f.id
          return (
            <li key={f.id} className={`fcard ${shown ? 'is-open' : ''}`}>
              {isEdit ? (
                <div className="stack-sm">
                  <label className="field"><span>Front</span><textarea rows={2} defaultValue={f.front} id={`f-${f.id}`} /></label>
                  <label className="field"><span>Back</span><textarea rows={3} defaultValue={f.back} id={`b-${f.id}`} /></label>
                  <div className="row">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={async () => {
                        await patch(f, { front: (document.getElementById(`f-${f.id}`) as HTMLTextAreaElement).value, back: (document.getElementById(`b-${f.id}`) as HTMLTextAreaElement).value })
                        setEditing(null)
                      }}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="fcard-face" aria-expanded={shown} onClick={() => setOpen((s) => { const n = new Set(s); n.has(f.id) ? n.delete(f.id) : n.add(f.id); return n })}>
                    <span className="fcard-q">{f.front}</span>
                    {shown && <span className="fcard-a">{f.back}</span>}
                  </button>
                  <div className="fcard-foot">
                    {shown && <Cites ids={f.cites} number={num} quote={f.back.split('\n\n').pop()} />}
                    {c && <span className={`pill pill-${stateName(c.fsrs.state)}`}>{stateName(c.fsrs.state)}{c.fsrs.state !== 0 ? ` · ${Math.round(retrievability(c, notebook.prefs) * 100)}%` : ''}</span>}
                    <span className="grow" />
                    <IconButton icon="edit" label="Edit card" size={15} onClick={() => setEditing(f.id)} />
                    <IconButton icon="trash" label="Delete card" size={15} onClick={() => remove(f)} />
                  </div>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {!item.content.cards.length && <p className="hint"><Icon name="warn" size={14} /> No cards left in this deck.</p>}
    </div>
  )
}
