import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db, deleteNotebook, importNotebookJson } from '../db'
import { createSampleNotebook } from '../lib/notebooks'
import { dueCounts } from '../lib/queue'
import { go, useUI } from '../store'
import { createNotebook } from '../studio/generate'
import { Button, Dialog, Empty, Logo, Menu, ago, Icon } from './ui'
import { TopRight } from './TopRight'

export function Library() {
  const notebooks = useLiveQuery(() => db.notebooks.orderBy('lastOpenedAt').reverse().toArray(), [])
  const stats = useLiveQuery(async () => {
    const [sources, items, due] = await Promise.all([db.sources.toArray(), db.items.toArray(), dueCounts()])
    const m = new Map<string, { sources: number; due: number; items: number; words: number }>()
    const get = (id: string) => m.get(id) ?? (m.set(id, { sources: 0, due: 0, items: 0, words: 0 }), m.get(id)!)
    sources.forEach((s) => ((get(s.notebookId).sources += 1), (get(s.notebookId).words += s.wordCount)))
    due.forEach((n, id) => (get(id).due = n))
    items.forEach((i) => (get(i.notebookId).items += 1))
    return m
  }, [])
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const toast = useUI((s) => s.toast)
  const totalDue = [...(stats?.values() ?? [])].reduce((n, s) => n + s.due, 0)

  const create = async () => {
    const id = await createNotebook(title)
    setCreating(false)
    setTitle('')
    go(`/n/${id}`)
  }
  const sample = async () => {
    setBusy(true)
    try {
      go(`/n/${await createSampleNotebook()}`)
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const onImport = async (f?: File) => {
    if (!f) return
    try {
      const id = await importNotebookJson(JSON.parse(await f.text()))
      toast('Notebook imported.', 'success')
      go(`/n/${id}`)
    } catch (e) {
      toast(`Couldn’t import that file. ${(e as Error).message}`, 'error')
    }
  }

  return (
    <div className="library">
      <header className="lib-top">
        <div className="brand">
          <Logo />
          <span>Studious</span>
        </div>
        <div className="grow" />
        {totalDue > 0 && (
          <Button variant="primary" icon="review" onClick={() => go('/review')}>
            Review {totalDue} due
          </Button>
        )}
        <TopRight />
      </header>

      <main className="lib-main">
        <section className="lib-hero">
          <p className="eyebrow">Your notebooks</p>
          <h1>
            Study from <em>your own</em> sources.
          </h1>
          <p className="lede">Add readings, lecture notes or PDFs. Ask questions and get answers that point to the exact passage — then turn the material into cards, quizzes, maps and decks you’ll actually remember.</p>
          <div className="row">
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New notebook
            </Button>
            <Button icon="spark" busy={busy} onClick={sample}>
              Try the sample notebook
            </Button>
            <Button variant="ghost" icon="upload" onClick={() => importRef.current?.click()}>
              Import backup
            </Button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => (onImport(e.target.files?.[0]), (e.target.value = ''))} />
          </div>
        </section>

        {notebooks && notebooks.length === 0 && (
          <Empty icon="book" title="No notebooks yet">
            Start with your own material, or open the sample to see how citations, Studio and review work together.
          </Empty>
        )}

        <ul className="nb-grid">
          {notebooks?.map((n) => {
            const s = stats?.get(n.id)
            return (
              <li key={n.id} className="nb-card">
                <a href={`#/n/${n.id}`} className="nb-link" aria-label={`Open ${n.title}`}>
                  <div className="nb-spine" aria-hidden="true" />
                  <h2>{n.title}</h2>
                  <p className="meta">
                    {s?.sources ?? 0} source{(s?.sources ?? 0) === 1 ? '' : 's'} · {s?.items ?? 0} studio item{(s?.items ?? 0) === 1 ? '' : 's'}
                  </p>
                  <div className="nb-foot">
                    <span className="meta">Opened {ago(n.lastOpenedAt)}</span>
                    {!!s?.due && (
                      <span className="pill pill-due">
                        <Icon name="review" size={12} /> {s.due} due
                      </span>
                    )}
                  </div>
                </a>
                <div className="nb-menu">
                  <Menu
                    label={`Actions for ${n.title}`}
                    items={[
                      { label: 'Open progress', icon: 'chart', onClick: () => go(`/n/${n.id}/progress`) },
                      {
                        label: 'Delete notebook…',
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
      </main>

      {creating && (
        <Dialog
          title="New notebook"
          onClose={() => setCreating(false)}
          width={440}
          footer={
            <>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={create}>
                Create notebook
              </Button>
            </>
          }
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              create()
            }}
          >
            <label className="field">
              <span>Notebook name</span>
              <input data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Organic Chemistry — Midterm" maxLength={80} />
            </label>
          </form>
        </Dialog>
      )}
    </div>
  )
}
