import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Grade } from 'ts-fsrs'
import type { Card, NotebookPrefs, ReviewLog } from '../types'
import { uid } from './ids'

export const DEFAULT_PREFS: NotebookPrefs = { level: 'intermediate', desiredRetention: 0.9, newPerDay: 15 }

const DAY = 86_400_000
const cache = new Map<string, ReturnType<typeof fsrs>>()
function sched(retention: number, fuzz: boolean) {
  const key = `${retention}|${fuzz}`
  let f = cache.get(key)
  if (!f) {
    f = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: fuzz, enable_short_term: true }))
    cache.set(key, f)
  }
  return f
}

export function newCard(init: Omit<Card, 'fsrs' | 'due' | 'createdAt'>, now = new Date()): Card {
  const c = createEmptyCard(now)
  return { ...init, fsrs: c, due: now.getTime(), createdAt: now.getTime() }
}

export function formatInterval(ms: number): string {
  const m = ms / 60_000
  if (m < 1) return '<1m'
  if (m < 60) return `${Math.round(m)}m`
  const h = m / 60
  if (h < 24) return `${Math.round(h)}h`
  const d = h / 24
  if (d < 30) return `${Math.round(d)}d`
  if (d < 365) return `${(d / 30).toFixed(1).replace(/\.0$/, '')}mo`
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`
}

/** Clamp a due date so material is reviewed at least once the day before the exam. */
export function clampToExam(due: Date, prefs: NotebookPrefs, now: Date): Date {
  if (!prefs.examDate) return due
  const exam = new Date(prefs.examDate + 'T09:00:00').getTime()
  if (exam <= now.getTime()) return due
  const latest = Math.max(now.getTime() + DAY / 2, exam - DAY)
  return due.getTime() > latest ? new Date(latest) : due
}

export function preview(card: Card, prefs: NotebookPrefs, now = new Date()): Record<1 | 2 | 3 | 4, { label: string; due: Date }> {
  const rec = sched(prefs.desiredRetention, false).repeat(card.fsrs, now)
  const out = {} as Record<1 | 2 | 3 | 4, { label: string; due: Date }>
  for (const r of [1, 2, 3, 4] as const) {
    const due = clampToExam(rec[r as Grade].card.due, prefs, now)
    out[r] = { due, label: formatInterval(due.getTime() - now.getTime()) }
  }
  return out
}

export function applyRating(card: Card, rating: 1 | 2 | 3 | 4, prefs: NotebookPrefs, now = new Date()): { card: Card; log: ReviewLog & { wasNew: boolean } } {
  const wasNew = card.fsrs.state === State.New
  const res = sched(prefs.desiredRetention, true).next(card.fsrs, now, rating as Grade)
  const due = clampToExam(res.card.due, prefs, now)
  const next: Card = { ...card, fsrs: { ...res.card, due }, due: due.getTime() }
  return { card: next, log: { id: uid('r'), cardId: card.id, notebookId: card.notebookId, at: now.getTime(), rating, wasNew } }
}

export function retrievability(card: Card, prefs: NotebookPrefs, now = new Date()): number {
  if (card.fsrs.state === State.New) return 0
  return sched(prefs.desiredRetention, false).get_retrievability(card.fsrs, now, false)
}

export { Rating, State }

export function stateName(s: State): 'new' | 'learning' | 'review' | 'relearning' {
  return s === State.New ? 'new' : s === State.Learning ? 'learning' : s === State.Review ? 'review' : 'relearning'
}

export function startOfDay(t = Date.now()): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Build the review queue: due cards first (oldest due first), then new cards up to the daily cap. */
export function buildQueue(cards: Card[], newDoneToday: number, newPerDay: number, now = Date.now()): Card[] {
  const live = cards.filter((c) => !c.suspended)
  const due = live.filter((c) => c.fsrs.state !== State.New && c.due <= now).sort((a, b) => a.due - b.due)
  const fresh = live.filter((c) => c.fsrs.state === State.New).sort((a, b) => a.createdAt - b.createdAt)
  const slots = Math.max(0, newPerDay - newDoneToday)
  return [...due, ...fresh.slice(0, slots)]
}
