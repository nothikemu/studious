import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '../db'
import { applyRating, buildQueue, formatInterval, preview, startOfDay } from '../lib/srs'
import { State } from 'ts-fsrs'
import { go, useUI } from '../store'
import type { Card, Notebook } from '../types'
import { Button, Empty, Icon, IconButton } from './ui'

interface Session {
  queue: Card[]
  total: number
  done: number
  again: number
  notebooks: Map<string, Notebook>
  chunks: Map<string, { sourceId: string; text: string }>
  titles: Map<string, string>
}

export function Review({ id }: { id?: string }) {
  const route = useUI((s) => s.route)
  const itemFilter = route.name === 'review' ? route.item : undefined
  const openReader = useUI((s) => s.openReader)
  const [s, setS] = useState<Session | null>(null)
  const [shown, setShown] = useState(false)
  const [undo, setUndo] = useState<{ card: Card; logId: string; wasDone: boolean } | null>(null)
  const startedAt = useRef(Date.now())
  const [cram, setCram] = useState(false)

  const load = async (cramMode: boolean) => {
    const [nbs, allCards, logs, chunks, sources] = await Promise.all([
      db.notebooks.toArray(),
      id ? db.cards.where('notebookId').equals(id).toArray() : db.cards.toArray(),
      db.reviews.where('at').aboveOrEqual(startOfDay()).toArray(),
      db.chunks.toArray(),
      db.sources.toArray(),
    ])
    const notebooks = new Map(nbs.map((n) => [n.id, n]))
    let queue: Card[] = []
    for (const nb of nbs) {
      let cards = allCards.filter((c) => c.notebookId === nb.id && (!itemFilter || c.itemId === itemFilter))
      if (!cards.length) continue
      const newToday = logs.filter((l) => l.notebookId === nb.id && l.wasNew).length
      queue = queue.concat(cramMode ? cards.filter((c) => !c.suspended).sort(() => Math.random() - 0.5).slice(0, 30) : buildQueue(cards, newToday, itemFilter ? 999 : nb.prefs.newPerDay))
    }
    startedAt.current = Date.now()
    setS({
      queue,
      total: queue.length,
      done: 0,
      again: 0,
      notebooks,
      chunks: new Map(chunks.map((c) => [c.id, { sourceId: c.sourceId, text: c.text }])),
      titles: new Map(sources.map((x) => [x.id, x.title])),
    })
    setShown(false)
  }
  useEffect(() => {
    load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, itemFilter])

  const card = s?.queue[0]
  const prefs = card && s ? s.notebooks.get(card.notebookId)?.prefs : undefined
  const prev = useMemo(() => (card && prefs ? preview(card, prefs) : null), [card, prefs])

  const rate = async (rating: 1 | 2 | 3 | 4) => {
    if (!s || !card || !prefs || !shown) return
    const { card: next, log } = applyRating(card, rating, prefs)
    await db.transaction('rw', [db.cards, db.reviews], async () => {
      await db.cards.put(next)
      await db.reviews.add(log)
    })
    setUndo({ card, logId: log.id, wasDone: !(next.due - Date.now() < 15 * 60_000) })
    const rest = s.queue.slice(1)
    const again = next.due - Date.now() < 15 * 60_000 // still in learning steps: see it again this session
    setS({ ...s, queue: again ? [...rest, next] : rest, done: s.done + (again ? 0 : 1), again: s.again + (rating === 1 ? 1 : 0) })
    setShown(false)
  }

  const undoLast = async () => {
    if (!undo || !s) return
    await db.transaction('rw', [db.cards, db.reviews], async () => {
      await db.cards.put(undo.card)
      await db.reviews.delete(undo.logId)
    })
    setS({ ...s, queue: [undo.card, ...s.queue.filter((c) => c.id !== undo.card.id)], done: Math.max(0, s.done - (undo.wasDone ? 1 : 0)) })
    setUndo(null)
    setShown(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return
      if (!shown && (e.key === ' ' || e.key === 'Enter')) (e.preventDefault(), setShown(true))
      else if (shown && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key) as 1 | 2 | 3 | 4)
      else if (shown && e.key === ' ') (e.preventDefault(), rate(3))
      else if (e.key.toLowerCase() === 'z' && undo) undoLast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const back = () => go(id ? `/n/${id}` : '/')

  if (!s) return <div className="center-screen"><span className="spin lg" /></div>
  const counts = {
    new: s.queue.filter((c) => c.fsrs.state === State.New).length,
    learn: s.queue.filter((c) => c.fsrs.state === State.Learning || c.fsrs.state === State.Relearning).length,
    due: s.queue.filter((c) => c.fsrs.state === State.Review).length,
  }

  return (
    <div className="review">
      <header className="review-top">
        <IconButton icon="back" label="Leave review" onClick={back} />
        <h1 className="sr-only">Review</h1>
        <div className="progress grow" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={s.done}>
          <span style={{ width: `${(s.done / Math.max(1, s.total)) * 100}%` }} />
        </div>
        <div className="counts" aria-label="Cards remaining">
          <span className="c-new" title="New">{counts.new}</span>
          <span className="c-learn" title="Learning">{counts.learn}</span>
          <span className="c-due" title="Due">{counts.due}</span>
        </div>
        <IconButton icon="review" label="Undo last answer" shortcut="Z" disabled={!undo} onClick={undoLast} />
      </header>

      {!card ? (
        <Done s={s} onBack={back} onCram={() => (setCram(true), load(true))} cram={cram} />
      ) : (
        <main className="review-main">
          <div className="rcard" data-shown={shown}>
            <div className="rcard-label">{card.origin === 'quiz' ? 'From your quiz' : 'Question'}</div>
            <p className="rcard-front">{card.front}</p>
            {shown ? (
              <>
                <hr />
                <div className="rcard-label">Answer</div>
                <p className="rcard-back">{card.back}</p>
                {card.cites[0] && s.chunks.get(card.cites[0]) && (
                  <button
                    className="src-link"
                    onClick={() => {
                      const ch = s.chunks.get(card.cites[0])!
                      go(`/n/${card.notebookId}`)
                      setTimeout(() => openReader(ch.sourceId, card.cites[0]), 80)
                    }}
                  >
                    <Icon name="link" size={14} /> {s.titles.get(s.chunks.get(card.cites[0])!.sourceId)} — see the passage
                  </button>
                )}
              </>
            ) : null}
          </div>
          {!shown ? (
            <Button variant="primary" className="reveal" onClick={() => setShown(true)}>
              Show answer <kbd>Space</kbd>
            </Button>
          ) : (
            <div className="grades" role="group" aria-label="How well did you remember?">
              {([1, 2, 3, 4] as const).map((r) => (
                <button key={r} className={`grade g${r}`} onClick={() => rate(r)}>
                  <span className="g-label">{['Again', 'Hard', 'Good', 'Easy'][r - 1]}</span>
                  <span className="g-int">{prev ? prev[r].label : formatInterval(0)}</span>
                  <kbd>{r}</kbd>
                </button>
              ))}
            </div>
          )}
        </main>
      )}
    </div>
  )
}

function Done({ s, onBack, onCram, cram }: { s: Session; onBack: () => void; onCram: () => void; cram: boolean }) {
  const [next, setNext] = useState<number | null>(null)
  useEffect(() => {
    db.cards.toArray().then((cs) => {
      const future = cs.filter((c) => !c.suspended && c.due > Date.now()).map((c) => c.due)
      setNext(future.length ? Math.min(...future) : null)
    })
  }, [])
  return (
    <main className="review-main">
      <Empty icon="check" title={s.total ? (cram ? 'Cram round finished' : 'You’re done for now') : 'Nothing due'} action={<div className="row center"><Button variant="primary" onClick={onBack}>Back to notebook</Button><Button onClick={onCram}>Cram 30 random cards</Button></div>}>
        {s.total ? `${s.done} card${s.done === 1 ? '' : 's'} reviewed${s.again ? `, ${s.again} marked Again` : ''}. ` : 'No cards are due. Generate flashcards in Studio, or add missed quiz questions to review. '}
        {next && `Next card is due in ${formatInterval(next - Date.now())}.`}
      </Empty>
    </main>
  )
}
