import { db } from '../db'
import { buildQueue, startOfDay } from './srs'

/** Cards a review session would actually serve today, per notebook (respects the daily new-card cap). */
export async function dueCounts(notebookId?: string): Promise<Map<string, number>> {
  const [nbs, cards, logs] = await Promise.all([
    notebookId ? db.notebooks.where('id').equals(notebookId).toArray() : db.notebooks.toArray(),
    notebookId ? db.cards.where('notebookId').equals(notebookId).toArray() : db.cards.toArray(),
    db.reviews.where('at').aboveOrEqual(startOfDay()).toArray(),
  ])
  const out = new Map<string, number>()
  for (const nb of nbs) {
    const mine = cards.filter((c) => c.notebookId === nb.id)
    const newToday = logs.filter((l) => l.notebookId === nb.id && l.wasNew).length
    out.set(nb.id, buildQueue(mine, newToday, nb.prefs.newPerDay).length)
  }
  return out
}
