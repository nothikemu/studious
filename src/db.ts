import Dexie, { type Table } from 'dexie'
import type {
  Card,
  ChatMessage,
  Chunk,
  Notebook,
  QuizAttempt,
  ReviewLog,
  Source,
  StudioItem,
} from './types'

class StudiousDB extends Dexie {
  notebooks!: Table<Notebook, string>
  sources!: Table<Source, string>
  chunks!: Table<Chunk, string>
  messages!: Table<ChatMessage, string>
  items!: Table<StudioItem, string>
  cards!: Table<Card, string>
  reviews!: Table<ReviewLog, string>
  attempts!: Table<QuizAttempt, string>

  constructor(name = 'studious') {
    super(name)
    this.version(1).stores({
      notebooks: 'id, updatedAt, lastOpenedAt',
      sources: 'id, notebookId',
      chunks: 'id, sourceId, notebookId',
      messages: 'id, notebookId, at',
      items: 'id, notebookId, kind, updatedAt',
      cards: 'id, notebookId, due, itemId',
      reviews: 'id, notebookId, at, cardId',
      attempts: 'id, notebookId, itemId, at',
    })
  }
}

export const db = new StudiousDB()

export async function deleteNotebook(id: string) {
  await db.transaction(
    'rw',
    [db.notebooks, db.sources, db.chunks, db.messages, db.items, db.cards, db.reviews, db.attempts],
    async () => {
      await Promise.all([
        db.notebooks.delete(id),
        db.sources.where('notebookId').equals(id).delete(),
        db.chunks.where('notebookId').equals(id).delete(),
        db.messages.where('notebookId').equals(id).delete(),
        db.items.where('notebookId').equals(id).delete(),
        db.cards.where('notebookId').equals(id).delete(),
        db.reviews.where('notebookId').equals(id).delete(),
        db.attempts.where('notebookId').equals(id).delete(),
      ])
    },
  )
}

export async function deleteSource(id: string) {
  await db.transaction('rw', [db.sources, db.chunks], async () => {
    await db.sources.delete(id)
    await db.chunks.where('sourceId').equals(id).delete()
  })
}

/** Full-notebook JSON backup */
export async function exportNotebookJson(id: string) {
  const [notebook, sources, chunks, messages, items, cards, reviews, attempts] = await Promise.all([
    db.notebooks.get(id),
    db.sources.where('notebookId').equals(id).toArray(),
    db.chunks.where('notebookId').equals(id).toArray(),
    db.messages.where('notebookId').equals(id).toArray(),
    db.items.where('notebookId').equals(id).toArray(),
    db.cards.where('notebookId').equals(id).toArray(),
    db.reviews.where('notebookId').equals(id).toArray(),
    db.attempts.where('notebookId').equals(id).toArray(),
  ])
  return { format: 'studious-notebook', version: 1, notebook, sources, chunks, messages, items, cards, reviews, attempts }
}

export async function importNotebookJson(data: any): Promise<string> {
  if (!data || data.format !== 'studious-notebook' || !data.notebook) throw new Error('Not a Studious notebook backup.')
  const fixCards = (data.cards ?? []).map((c: Card) => ({
    ...c,
    fsrs: {
      ...c.fsrs,
      due: new Date(c.fsrs.due),
      last_review: c.fsrs.last_review ? new Date(c.fsrs.last_review) : undefined,
    },
  }))
  await db.transaction(
    'rw',
    [db.notebooks, db.sources, db.chunks, db.messages, db.items, db.cards, db.reviews, db.attempts],
    async () => {
      await db.notebooks.put({ ...data.notebook, lastOpenedAt: Date.now() })
      await db.sources.bulkPut(data.sources ?? [])
      await db.chunks.bulkPut(data.chunks ?? [])
      await db.messages.bulkPut(data.messages ?? [])
      await db.items.bulkPut(data.items ?? [])
      await db.cards.bulkPut(fixCards)
      await db.reviews.bulkPut(data.reviews ?? [])
      await db.attempts.bulkPut(data.attempts ?? [])
    },
  )
  return data.notebook.id as string
}
