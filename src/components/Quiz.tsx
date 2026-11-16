import { useEffect, useMemo, useState } from 'react'
import { db } from '../db'
import { uid } from '../lib/ids'
import { questionToCard } from '../studio/generate'
import { useUI } from '../store'
import type { QuizContent, QuizQ, StudioItem } from '../types'
import { Cites } from './Cite'
import { useNb } from './nb'
import { Button, Icon } from './ui'
import { useCiteNumber } from './Viewer'

type Phase = 'intro' | 'run' | 'done'

export function QuizViewer({ item }: { item: StudioItem<QuizContent> }) {
  const { notebook, resolver } = useNb()
  const toast = useUI((s) => s.toast)
  const qs = item.content.questions
  const num = useCiteNumber(item.content)
  const [phase, setPhase] = useState<Phase>('intro')
  const [order, setOrder] = useState<QuizQ[]>(qs)
  const [i, setI] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [results, setResults] = useState<{ q: QuizQ; chosen: number }[]>([])
  const q = order[i]

  const start = (pool: QuizQ[]) => {
    setOrder(pool)
    setI(0)
    setPicked(null)
    setResults([])
    setPhase('run')
  }

  const choose = async (idx: number) => {
    if (picked !== null) return
    setPicked(idx)
    setResults((r) => [...r, { q, chosen: idx }])
    const sid = resolver.sourceOf(q.cites[0])?.id
    await db.attempts.add({ id: uid('a'), notebookId: notebook.id, itemId: item.id, qid: q.id, chosen: idx, correct: idx === q.answer, at: Date.now(), sourceId: sid, difficulty: q.difficulty })
  }
  const next = () => {
    if (i + 1 >= order.length) setPhase('done')
    else (setI(i + 1), setPicked(null))
  }

  useEffect(() => {
    if (phase !== 'run') return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select')) return
      const n = Number(e.key)
      if (picked === null && n >= 1 && n <= (q?.options.length ?? 0)) choose(n - 1)
      else if (picked !== null && (e.key === 'Enter' || e.key === 'ArrowRight')) next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const missed = useMemo(() => results.filter((r) => r.chosen !== r.q.answer), [results])
  const score = results.length - missed.length

  if (phase === 'intro') {
    const by = { easy: 0, medium: 0, hard: 0 }
    qs.forEach((x) => by[x.difficulty]++)
    return (
      <div className="quiz-intro">
        <h2>{qs.length} questions</h2>
        <p className="muted">Pick an answer to see why it’s right, with the source passage. Misses can go straight into your review deck.</p>
        <div className="diff-row">
          {(['easy', 'medium', 'hard'] as const).map((d) => by[d] > 0 && <span key={d} className={`pill pill-${d}`}>{by[d]} {d}</span>)}
        </div>
        <Button variant="primary" icon="quiz" onClick={() => start(qs)}>Start quiz</Button>
        <p className="meta">Keys: 1–4 to answer, Enter for next.</p>
      </div>
    )
  }

  if (phase === 'done') {
    const pct = Math.round((score / Math.max(1, results.length)) * 100)
    return (
      <div className="quiz-done">
        <div className="score" role="img" aria-label={`Score ${score} of ${results.length}`}>
          <svg viewBox="0 0 100 100" width="120" height="120">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="8" />
            <circle cx="50" cy="50" r="42" fill="none" stroke={pct >= 70 ? 'var(--good)' : 'var(--cite)'} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 264} 264`} transform="rotate(-90 50 50)" />
          </svg>
          <div><strong>{score}</strong>/{results.length}</div>
        </div>
        <p className="muted">{pct >= 85 ? 'Strong. Try a harder set next.' : pct >= 60 ? 'Solid base — the misses below are worth a second look.' : 'Worth another pass. Review the explanations, then retake the missed ones.'}</p>
        {missed.length > 0 && (
          <>
            <div className="row center">
              <Button variant="primary" icon="cards" onClick={async () => { for (const m of missed) await questionToCard(notebook.id, m.q, item.id); toast(`${missed.length} missed question${missed.length === 1 ? '' : 's'} added to review.`, 'success') }}>
                Add {missed.length} missed to review
              </Button>
              <Button icon="review" onClick={() => start(missed.map((m) => m.q))}>Retake missed</Button>
            </div>
            <ol className="missed">
              {missed.map((m) => (
                <li key={m.q.id}>
                  <strong>{m.q.prompt}</strong>
                  <span className="bad">Your answer: {m.q.options[m.chosen]}</span>
                  <span className="good">Correct: {m.q.options[m.q.answer]}</span>
                  <span className="meta">{m.q.explanation} <Cites ids={m.q.cites} number={num} quote={m.q.explanation} /></span>
                </li>
              ))}
            </ol>
          </>
        )}
        <Button variant="ghost" onClick={() => start(qs)}>Retake whole quiz</Button>
      </div>
    )
  }

  return (
    <div className="quiz-run">
      <div className="progress" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={order.length} aria-valuenow={i + (picked !== null ? 1 : 0)}>
        <span style={{ width: `${((i + (picked !== null ? 1 : 0)) / order.length) * 100}%` }} />
      </div>
      <div className="meta row"><span>Question {i + 1} of {order.length}</span><span className={`pill pill-${q.difficulty}`}>{q.difficulty}</span></div>
      <h2 className="q-prompt">{q.prompt}</h2>
      <div className="options" role="group" aria-label="Answer options">
        {q.options.map((o, idx) => {
          const state = picked === null ? '' : idx === q.answer ? 'is-right' : idx === picked ? 'is-wrong' : 'is-dim'
          return (
            <button key={idx} className={`opt ${state}`} aria-pressed={picked === idx} disabled={picked !== null} onClick={() => choose(idx)}>
              <kbd>{idx + 1}</kbd>
              <span>{o}</span>
              {state === 'is-right' && <Icon name="check" size={17} />}
              {state === 'is-wrong' && <Icon name="x" size={17} />}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div className={`explain ${picked === q.answer ? 'ok' : 'no'}`} role="status">
          <strong>{picked === q.answer ? 'Correct.' : 'Not quite.'}</strong>
          <p>{q.explanation} <Cites ids={q.cites} number={num} quote={q.explanation} /></p>
          <Button variant="primary" onClick={next}>{i + 1 >= order.length ? 'See results' : 'Next question'}</Button>
        </div>
      )}
    </div>
  )
}
