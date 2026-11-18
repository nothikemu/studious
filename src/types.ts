import type { Card as FsrsCard } from 'ts-fsrs'

export type SourceKind = 'pdf' | 'text' | 'markdown' | 'html' | 'paste' | 'sample'

export interface NotebookPrefs {
  level: 'beginner' | 'intermediate' | 'advanced'
  desiredRetention: number // 0.7 – 0.97
  examDate?: string // YYYY-MM-DD
  newPerDay: number
}

export interface Notebook {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastOpenedAt: number
  prefs: NotebookPrefs
}

export interface PageRange {
  page: number
  start: number
  end: number
}

export interface Source {
  id: string
  notebookId: string
  title: string
  kind: SourceKind
  text: string
  pages?: PageRange[]
  enabled: boolean
  addedAt: number
  wordCount: number
}

export interface Chunk {
  id: string
  sourceId: string
  notebookId: string
  index: number
  start: number
  end: number
  text: string
  heading?: string
  page?: number
}

export interface ChatSegment {
  text: string
  cites: string[] // chunk ids
}

export interface ChatMessage {
  id: string
  notebookId: string
  role: 'user' | 'assistant'
  text?: string
  segments?: ChatSegment[]
  notFound?: boolean
  mode?: 'offline' | 'llm'
  followUps?: string[]
  at: number
}

export type StudioKind =
  | 'guide'
  | 'flashcards'
  | 'quiz'
  | 'mindmap'
  | 'deck'
  | 'table'
  | 'glossary'
  | 'notes'

export interface Block {
  id: string
  kind: 'h2' | 'h3' | 'p' | 'li'
  text: string
  cites: string[]
}
export interface DocContent {
  blocks: Block[]
}

export interface FlashItem {
  id: string
  cardId?: string
  front: string
  back: string
  cites: string[]
}
export interface FlashContent {
  cards: FlashItem[]
}

export interface QuizQ {
  id: string
  prompt: string
  options: string[]
  answer: number
  explanation: string
  cites: string[]
  difficulty: 'easy' | 'medium' | 'hard'
}
export interface QuizContent {
  questions: QuizQ[]
}

export interface MapNode {
  id: string
  label: string
  cites: string[]
  children: MapNode[]
}
export interface MapContent {
  root: MapNode
}

export interface Slide {
  id: string
  title: string
  bullets: { text: string; cites: string[] }[]
  notes?: string
}
export interface DeckContent {
  slides: Slide[]
}

export interface TableCell {
  text: string
  cites: string[]
}
export interface TableContent {
  columns: { id: string; name: string }[]
  rows: { id: string; label: string; sourceId?: string; cells: Record<string, TableCell> }[]
}

export interface GlossaryEntry {
  id: string
  term: string
  definition: string
  cites: string[]
  kind: 'term' | 'formula'
}
export interface GlossaryContent {
  entries: GlossaryEntry[]
}

export interface StudioItem<C = unknown> {
  id: string
  notebookId: string
  kind: StudioKind
  title: string
  createdAt: number
  updatedAt: number
  mode: 'offline' | 'llm'
  sourceIds: string[]
  params: Record<string, unknown>
  content: C
}

export interface Card {
  id: string
  notebookId: string
  itemId?: string
  front: string
  back: string
  cites: string[]
  origin: 'flashcards' | 'quiz' | 'manual'
  fsrs: FsrsCard
  due: number
  suspended?: boolean
  createdAt: number
}

export interface ReviewLog {
  id: string
  cardId: string
  notebookId: string
  at: number
  rating: 1 | 2 | 3 | 4
  wasNew?: boolean
}

export interface QuizAttempt {
  id: string
  notebookId: string
  itemId: string
  qid: string
  chosen: number
  correct: boolean
  at: number
  sourceId?: string
  difficulty: 'easy' | 'medium' | 'hard'
}

export interface AiConfig {
  provider: 'offline' | 'anthropic' | 'nvidia' | 'openai'
  apiKey: string
  model: string
  baseUrl: string
}
