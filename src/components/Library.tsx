import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db, deleteNotebook, exportNotebookJson, importNotebookJson } from '../db'
import { download, slug } from '../lib/export'
import { ACCEPT, addSource, extractFromFile } from '../lib/ingest'
import { createSampleNotebook } from '../lib/notebooks'
import { dueCounts } from '../lib/queue'
import { wordCount } from '../lib/text'
import { go, useUI } from '../store'
import { createNotebook } from '../studio/generate'
import { Button, Icon, IconButton, Mascot, Menu, Wordmark, ago } from './ui'
import { TopRight } from './TopRight'

const PASTE_MIN_WORDS = 30

export function Library() {
  const notebooks = useLiveQuery(() => db.notebooks.orderBy('lastOpenedAt').reverse().toArray(), [])
  const stats = useLiveQuery(async () => {
    const [sources, items, due] = await Promise.all([db.sources.toArray(), db.items.toArray(), dueCounts()])
    const m = new Map<string, { sources: number; due: number; items: number }>()
    const get = (id: string) => m.get(id) ?? (m.set(id, { sources: 0, due: 0, items: 0 }), m.get(id)!)
    sources.forEach((s) => (get(s.notebookId).sources += 1))
    items.forEach((i) => (get(i.notebookId).items += 1))
    due.forEach((n, id) => (get(id).due = n))
    return m
  }, [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const toast = useUI((s) => s.toast)
  const totalDue = [...(stats?.values() ?? [])].reduce((n, s) => n + s.due, 0)
  const words = wordCount(text)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) {
        e.preventDefault()
        promptRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fromFiles = async (files: File[]) => {
    if (!files.length) return
    setBusy('Reading your files…')
    try {
      const id = await createNotebook(files[0].name.replace(/\.[^.]+$/, ''))
      let ok = 0
      for (const f of files) {
        try {
          await addSource(id, f.name, await extractFromFile(f))
          ok++
        } catch (e) {
          toast((e as Error).message, 'error')
        }
      }
      if (ok) go(`/n/${id}`)
      else await deleteNotebook(id)
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    const t = text.trim()
    if (!t || busy) return
    setBusy('Creating your lesson…')
    try {
      if (words >= PASTE_MIN_WORDS) {
        const title = t.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60)
        const id = await createNotebook(title || 'Pasted notes')
        await addSource(id, 'Pasted notes', { text: t, kind: 'paste' })
        go(`/n/${id}`)
      } else go(`/n/${await createNotebook(t.slice(0, 80))}`)
      setText('')
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const sample = async () => {
    setBusy('Opening the sample lesson…')
    try {
      go(`/n/${await createSampleNotebook()}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }
  const onImport = async (f?: File) => {
    if (!f) return
    try {
      const id = await importNotebookJson(JSON.parse(await f.text()))
      toast('Lesson imported.', 'success')
      go(`/n/${id}`)
    } catch (e) {
      toast(`Couldn’t import that file. ${(e as Error).message}`, 'error')
    }
  }

  return (
    <div className="home">
      <header className="home-top">
        <Wordmark />
        <div className="grow" />
        {totalDue > 0 && (
          <Button className="btn-gold" size="sm" icon="review" onClick={() => go('/review')}>
            Review {totalDue} due
          </Button>
        )}
        <TopRight />
      </header>

      <main className="home-main">
        <Mascot />
        <h1>What do you want to learn?</h1>

        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <textarea
            ref={promptRef}
            value={text}
            rows={2}
            aria-label="What do you want to learn?"
            placeholder="Tip: Upload a PDF, or paste your notes here to start a lesson"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="prompt-foot">
            <button type="button" className="pchip" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              <Icon name="doc" size={14} /> Upload
            </button>
            <button type="button" className="pchip" onClick={sample} disabled={!!busy}>
              <Icon name="spark" size={14} /> Try a sample
            </button>
            <input ref={fileRef} hidden multiple type="file" accept={ACCEPT} onChange={(e) => (fromFiles([...(e.target.files ?? [])]), (e.target.value = ''))} />
            <span className="grow" />
            {text.trim() && (
              <span className="meta prompt-hint">{words >= PASTE_MIN_WORDS ? 'Pasted text becomes your source' : 'Starts a lesson with this title'}</span>
            )}
            <kbd title="Press / to focus">/</kbd>
            <button type="submit" className="send" aria-label="Start lesson" disabled={!text.trim() || !!busy}>
              {busy ? <span className="spin" /> : <Icon name="send" size={16} />}
            </button>
          </div>
        </form>
        {busy && <p className="meta" role="status">{busy}</p>}

        <section className="lessons" aria-label="Lessons">
          <div className="lessons-head">
            <h2>Lessons</h2>
            <Button variant="ghost" size="sm" icon="upload" onClick={() => importRef.current?.click()}>
              Import backup
            </Button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => (onImport(e.target.files?.[0]), (e.target.value = ''))} />
          </div>
          {notebooks && notebooks.length === 0 && (
            <div className="lessons-empty">
              <p>No lessons yet. Upload something above, or open the sample to see citations, study tools and review working together.</p>
            </div>
          )}
          <ul className="lesson-list">
            {notebooks?.map((n) => {
              const s = stats?.get(n.id)
              return (
                <li key={n.id} className="lesson">
                  <a href={`#/n/${n.id}`} className="lesson-link" aria-label={`Open ${n.title}`}>
                    <span className="lesson-ic">
                      <Icon name="book" size={26} />
                    </span>
                    <span className="lesson-text">
                      <strong>{n.title}</strong>
                      <span className="meta">
                        Opened {ago(n.lastOpenedAt)} · {s?.sources ?? 0} source{(s?.sources ?? 0) === 1 ? '' : 's'}
                        {s?.items ? ` · ${s.items} study item${s.items === 1 ? '' : 's'}` : ''}
                      </span>
                    </span>
                    {!!s?.due && <span className="pill pill-due">{s.due} due</span>}
                    <span className="start">
                      Start <Icon name="arrow" size={15} />
                    </span>
                  </a>
                  <div className="lesson-menu">
                    <Menu
                      label={`Actions for ${n.title}`}
                      items={[
                        { label: 'Open progress', icon: 'chart', onClick: () => go(`/n/${n.id}/progress`) },
                        { label: 'Export backup (.json)', icon: 'download', onClick: async () => download(`${slug(n.title)}.studious.json`, JSON.stringify(await exportNotebookJson(n.id)), 'application/json') },
                        {
                          label: 'Delete lesson…',
                          icon: 'trash',
                          danger: true,
                          onClick: async () => {
                            if (confirm(`Delete “${n.title}” and everything in it? This can’t be undone.`)) await deleteNotebook(n.id)
                          },
                        },
                      ]}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </main>
      <span hidden>
        <IconButton icon="plus" label="" />
      </span>
    </div>
  )
}
