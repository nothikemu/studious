import type { StudioKind } from '../types'

export const STUDIO_META: Record<StudioKind, { label: string; blurb: string; noun: string }> = {
  guide: { label: 'Study guide', blurb: 'Overview, sections, key terms and self-checks.', noun: 'study guide' },
  flashcards: { label: 'Flashcards', blurb: 'Active-recall cards scheduled with FSRS.', noun: 'flashcard deck' },
  quiz: { label: 'Quiz', blurb: 'Questions with explanations tied to the source.', noun: 'quiz' },
  mindmap: { label: 'Mind map', blurb: 'Concepts and how they branch.', noun: 'mind map' },
  deck: { label: 'Slide deck', blurb: 'A presentable outline you can export.', noun: 'slide deck' },
  table: { label: 'Data table', blurb: 'Extract and compare across sources.', noun: 'table' },
  glossary: { label: 'Glossary', blurb: 'Terms, definitions and formulas.', noun: 'glossary' },
  notes: { label: 'Notes', blurb: 'Editable outline you can keep refining.', noun: 'notes' },
}

export const STUDIO_ORDER: StudioKind[] = ['guide', 'flashcards', 'quiz', 'mindmap', 'deck', 'table', 'glossary', 'notes']
