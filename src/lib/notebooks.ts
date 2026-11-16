import { SAMPLE_SOURCES, SAMPLE_TITLE } from '../data/sample'
import { addSource } from './ingest'
import { createNotebook } from '../studio/generate'

export async function createSampleNotebook(): Promise<string> {
  const id = await createNotebook(SAMPLE_TITLE)
  for (const s of SAMPLE_SOURCES) await addSource(id, s.title, { text: s.text, kind: 'sample' })
  return id
}
