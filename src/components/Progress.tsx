import { useLiveQuery } from 'dexie-react-hooks'
import { State } from 'ts-fsrs'
import { db } from '../db'
import { retrievability, startOfDay, stateName } from '../lib/srs'
import { go } from '../store'
import type { Card, NotebookPrefs } from '../types'
import { Button, Empty, Icon, IconButton } from './ui'

const DAY = 86_400_000

export function Progress({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const [nb, cards, reviews, attempts, chunks, sources] = await Promise.all([
      db.notebooks.get(id),
      db.cards.where('notebookId').equals(id).toArray(),
      db.reviews.where('notebookId').equals(id).toArray(),
      db.attempts.where('notebookId').equals(id).toArray(),
      db.chunks.where('notebookId').equals(id).toArray(),
      db.sources.where('notebookId').equals(id).toArray(),
    ])
    return { nb, cards, reviews, attempts, chunks, sources }
  }, [id])

  if (!data) return <div className="center-screen"><span className="spin lg" /></div>
  const { nb, cards, reviews, attempts, chunks, sources } = data
  if (!nb) return <div className="center-screen"><Empty icon="warn" title="Notebook not found" action={<Button onClick={() => go('/')}>Back</Button>} /></div>

  const now = Date.now()
  const today = startOfDay()
  const live = cards.filter((c) => !c.suspended)
  const dueNow = live.filter((c) => c.due <= now && c.fsrs.state !== State.New).length
  const states = { new: 0, learning: 0, review: 0, relearning: 0 }
  live.forEach((c) => states[stateName(c.fsrs.state)]++)
  const seen = live.filter((c) => c.fsrs.state !== State.New)
  const avgR = seen.length ? seen.reduce((n, c) => n + retrievability(c, nb.prefs), 0) / seen.length : 0
  const mature = live.filter((c) => c.fsrs.state === State.Review && c.fsrs.scheduled_days >= 21).length

  const days = Array.from({ length: 14 }, (_, i) => today - (13 - i) * DAY)
  const perDay = days.map((d) => reviews.filter((r) => r.at >= d && r.at < d + DAY).length)
  const reviewDays = new Set(reviews.map((r) => startOfDay(r.at)))
  let streak = 0
  for (let d = reviewDays.has(today) ? today : today - DAY; reviewDays.has(d); d -= DAY) streak++

  const last30 = reviews.filter((r) => r.at > now - 30 * DAY && !r.wasNew)
  const trueRet = last30.length >= 5 ? last30.filter((r) => r.rating > 1).length / last30.length : null

  const forecast = Array.from({ length: 7 }, (_, i) => {
    const from = i === 0 ? 0 : today + i * DAY
    const to = today + (i + 1) * DAY
    return live.filter((c) => c.due >= from && c.due < to && (i > 0 || c.fsrs.state !== State.New || false)).length
  })

  const chunkSource = new Map(chunks.map((c) => [c.id, c.sourceId]))
  const mastery = sources.map((s) => {
    const cs = cards.filter((c) => c.cites.some((id) => chunkSource.get(id) === s.id))
    const cseen = cs.filter((c) => c.fsrs.state !== State.New)
    const r = cseen.length ? cseen.reduce((n, c) => n + retrievability(c, nb.prefs), 0) / cseen.length : null
    const at = attempts.filter((a) => a.sourceId === s.id)
    const acc = at.length ? at.filter((a) => a.correct).length / at.length : null
    return { s, cards: cs.length, seen: cseen.length, r, acc, attempts: at.length }
  })
  const totalAcc = attempts.length ? attempts.filter((a) => a.correct).length / attempts.length : null

  const setPrefs = (p: Partial<NotebookPrefs>) => db.notebooks.update(id, { prefs: { ...nb.prefs, ...p }, updatedAt: Date.now() })
  const empty = !cards.length && !attempts.length

  return (
    <div className="progress-page">
      <header className="review-top">
        <IconButton icon="back" label="Back to notebook" onClick={() => go(`/n/${id}`)} />
        <h1>{nb.title} <span className="muted">— progress</span></h1>
        <div className="grow" />
        <Button variant={dueNow ? 'primary' : 'secondary'} icon="review" onClick={() => go(`/n/${id}/review`)}>{dueNow ? `Review ${dueNow} due` : 'Review'}</Button>
      </header>
      <main className="progress-main">
        {empty && <Empty icon="chart" title="Nothing to measure yet">Generate flashcards or take a quiz in Studio — your mastery shows up here as you study.</Empty>}

        <section className="tiles" aria-label="Summary">
          <Tile label="Cards" value={String(live.length)} sub={`${states.new} new · ${mature} mature`} />
          <Tile label="Due now" value={String(dueNow)} sub={dueNow ? 'ready to review' : 'all caught up'} />
          <Tile label="Est. recall" value={seen.length ? `${Math.round(avgR * 100)}%` : '—'} sub="average across seen cards" />
          <Tile label="Streak" value={`${streak}d`} sub={streak ? 'keep it going' : 'review today to start'} icon="flame" />
          <Tile label="Quiz accuracy" value={totalAcc === null ? '—' : `${Math.round(totalAcc * 100)}%`} sub={`${attempts.length} answer${attempts.length === 1 ? '' : 's'}`} />
          <Tile label="True retention" value={trueRet === null ? '—' : `${Math.round(trueRet * 100)}%`} sub={`target ${Math.round(nb.prefs.desiredRetention * 100)}%`} />
        </section>

        <div className="cols">
          <section className="panel">
            <h2>Reviews, last 14 days</h2>
            <Bars values={perDay} labels={days.map((d) => new Date(d).toLocaleDateString(undefined, { weekday: 'narrow' }))} unit="reviews" />
          </section>
          <section className="panel">
            <h2>Due in the next 7 days</h2>
            <Bars values={forecast} labels={forecast.map((_, i) => (i === 0 ? 'Now' : new Date(today + i * DAY).toLocaleDateString(undefined, { weekday: 'narrow' })))} unit="cards due" accent />
          </section>
        </div>

        <section className="panel">
          <h2>Card states</h2>
          <StateBar states={states} />
        </section>

        <section className="panel">
          <h2>Mastery by source</h2>
          {!mastery.length && <p className="hint">Add sources to see mastery.</p>}
          <ul className="mastery">
            {mastery.map((m) => (
              <li key={m.s.id}>
                <div className="m-head"><strong>{m.s.title}</strong><span className="meta">{m.cards} card{m.cards === 1 ? '' : 's'} · {m.attempts} quiz answer{m.attempts === 1 ? '' : 's'}</span></div>
                <Meter label="Recall" value={m.r} />
                <Meter label="Quiz" value={m.acc} />
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Make it yours</h2>
          <div className="prefs">
            <label className="field">
              <span>Learning level <em>(shapes AI-written material)</em></span>
              <select value={nb.prefs.level} onChange={(e) => setPrefs({ level: e.target.value as NotebookPrefs['level'] })}>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label className="field">
              <span>Target retention: <strong>{Math.round(nb.prefs.desiredRetention * 100)}%</strong></span>
              <input type="range" min={0.8} max={0.97} step={0.01} value={nb.prefs.desiredRetention} onChange={(e) => setPrefs({ desiredRetention: +e.target.value })} />
              <small className="meta">Higher means more reviews. Applies to future scheduling.</small>
            </label>
            <label className="field">
              <span>New cards per day</span>
              <input type="number" min={0} max={200} value={nb.prefs.newPerDay} onChange={(e) => setPrefs({ newPerDay: Math.max(0, Math.min(200, +e.target.value || 0)) })} />
            </label>
            <label className="field">
              <span>Exam date <em>(optional)</em></span>
              <input type="date" value={nb.prefs.examDate ?? ''} onChange={(e) => setPrefs({ examDate: e.target.value || undefined })} />
              <small className="meta">Cards won’t be scheduled past the day before your exam.</small>
            </label>
          </div>
        </section>
      </main>
    </div>
  )
}

function Tile({ label, value, sub, icon }: { label: string; value: string; sub: string; icon?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{icon && <Icon name={icon} size={13} />} {label}</span>
      <strong>{value}</strong>
      <span className="meta">{sub}</span>
    </div>
  )
}

function Bars({ values, labels, unit, accent }: { values: number[]; labels: string[]; unit: string; accent?: boolean }) {
  const max = Math.max(1, ...values)
  const W = 320, H = 110, bw = W / values.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} className="bars" role="img" aria-label={values.map((v, i) => `${labels[i]}: ${v} ${unit}`).join('; ')}>
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
      {values.map((v, i) => {
        const h = (v / max) * (H - 16)
        return (
          <g key={i}>
            <rect x={i * bw + 5} y={H - h} width={bw - 10} height={Math.max(h, v ? 2 : 0)} rx={3} fill={accent ? 'var(--cite)' : 'var(--accent)'} opacity={v ? 1 : 0.15}>
              <title>{`${labels[i]}: ${v} ${unit}`}</title>
            </rect>
            {v > 0 && <text x={i * bw + bw / 2} y={H - h - 4} textAnchor="middle" className="bar-n">{v}</text>}
            <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" className="bar-l">{labels[i]}</text>
          </g>
        )
      })}
    </svg>
  )
}

function StateBar({ states }: { states: Record<string, number> }) {
  const total = Object.values(states).reduce((a, b) => a + b, 0)
  const parts = [
    { k: 'new', label: 'New', color: 'var(--ink-3)' },
    { k: 'learning', label: 'Learning', color: 'var(--cite)' },
    { k: 'relearning', label: 'Relearning', color: 'var(--bad)' },
    { k: 'review', label: 'Review', color: 'var(--accent)' },
  ]
  return (
    <>
      <div className="statebar" role="img" aria-label={parts.map((p) => `${p.label} ${states[p.k]}`).join(', ')}>
        {total ? parts.map((p) => states[p.k] > 0 && <span key={p.k} style={{ flexGrow: states[p.k], background: p.color }} title={`${p.label}: ${states[p.k]}`} />) : <span style={{ flexGrow: 1, background: 'var(--line)' }} />}
      </div>
      <ul className="legend">
        {parts.map((p) => <li key={p.k}><i style={{ background: p.color }} />{p.label} <strong>{states[p.k]}</strong></li>)}
      </ul>
    </>
  )
}

function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="meter">
      <span>{label}</span>
      <div className="meter-track" role="img" aria-label={value === null ? `${label}: no data yet` : `${label}: ${Math.round(value * 100)}%`}>
        {value !== null && <i style={{ width: `${Math.round(value * 100)}%`, background: value >= 0.8 ? 'var(--good)' : value >= 0.55 ? 'var(--accent)' : 'var(--cite)' }} />}
      </div>
      <b>{value === null ? '—' : `${Math.round(value * 100)}%`}</b>
    </div>
  )
}

export type { Card }
