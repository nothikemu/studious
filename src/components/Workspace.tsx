import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { db } from '../db'
import { makeResolver } from '../lib/cites'
import { dueCounts } from '../lib/queue'
import { go, useUI, type MobileTab } from '../store'
import { ChatPane } from './Chat'
import { NbCtx } from './nb'
import { SourcesPane } from './Sources'
import { StudioPane } from './Studio'
import { TopRight } from './TopRight'
import { Button, Empty, Icon, IconButton, Logo } from './ui'

export function Workspace({ id }: { id: string }) {
  const notebook = useLiveQuery(async () => (await db.notebooks.get(id)) ?? null, [id])
  const sources = useLiveQuery(() => db.sources.where('notebookId').equals(id).sortBy('addedAt'), [id])
  const chunks = useLiveQuery(() => db.chunks.where('notebookId').equals(id).toArray(), [id])
  const items = useLiveQuery(() => db.items.where('notebookId').equals(id).toArray(), [id])
  const messages = useLiveQuery(() => db.messages.where('notebookId').equals(id).sortBy('at'), [id])
  const dueCount = useLiveQuery(async () => (await dueCounts(id)).get(id) ?? 0, [id]) ?? 0

  const { leftOpen, rightOpen, rightWide, toggleLeft, toggleRight, mobileTab, setMobileTab, reader, studioItemId } = useUI()
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    db.notebooks.update(id, { lastOpenedAt: Date.now() })
  }, [id])

  const resolver = useMemo(() => makeResolver(chunks ?? [], sources ?? []), [chunks, sources])
  const ctx = useMemo(
    () => (notebook && sources && chunks && items && messages ? { notebook, sources, chunks, items, messages, resolver } : null),
    [notebook, sources, chunks, items, messages, resolver],
  )

  if (notebook === null)
    return (
      <div className="center-screen">
        <Empty icon="warn" title="Notebook not found" action={<Button variant="primary" onClick={() => go('/')}>Back to notebooks</Button>}>
          It may have been deleted, or the link is from another browser.
        </Empty>
      </div>
    )
  if (!ctx)
    return (
      <div className="center-screen" aria-busy="true">
        <span className="spin lg" />
      </div>
    )

  const nb = ctx.notebook
  const tabs: { id: MobileTab; label: string; icon: string }[] = [
    { id: 'sources', label: 'Sources', icon: 'doc' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
    { id: 'studio', label: 'Studio', icon: 'spark' },
  ]

  return (
    <NbCtx.Provider value={ctx}>
      <div className="ws">
        <header className="ws-top">
          <h1 className="sr-only">{nb.title}</h1>
          <a href="#/" className="brand-link" aria-label="All notebooks">
            <Logo size={26} />
          </a>
          <Icon name="chevron" size={14} className="sep" />
          {renaming ? (
            <input
              autoFocus
              className="title-input"
              aria-label="Notebook name"
              defaultValue={nb.title}
              onBlur={(e) => (db.notebooks.update(id, { title: e.target.value.trim() || nb.title }), setRenaming(false))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button className="nb-title" onClick={() => setRenaming(true)} title="Rename notebook">
              {nb.title}
            </button>
          )}
          <div className="grow" />
          <Button size="sm" icon="chart" variant="ghost" onClick={() => go(`/n/${id}/progress`)} className="hide-narrow">
            Progress
          </Button>
          <Button size="sm" icon="review" variant={dueCount ? 'primary' : 'secondary'} onClick={() => go(`/n/${id}/review`)}>
            {dueCount ? `Review ${dueCount}` : 'Review'}
          </Button>
          <span className="vr hide-narrow" />
          <IconButton className="hide-narrow" icon="sidebarL" label={leftOpen ? 'Hide sources' : 'Show sources'} active={leftOpen} onClick={toggleLeft} />
          <IconButton className="hide-narrow" icon="sidebarR" label={rightOpen ? 'Hide Studio' : 'Show Studio'} active={rightOpen} onClick={toggleRight} />
          <TopRight />
        </header>

        <div className={`panes ${leftOpen ? '' : 'no-left'} ${rightOpen ? '' : 'no-right'} ${rightWide && studioItemId ? 'wide-right' : ''} tab-${mobileTab}`}>
          <section className="pane pane-left" aria-label="Sources">
            <div className="pane-head">
              <h2>{reader ? 'Reading' : 'Sources'}</h2>
              {!reader && <span className="count">{ctx.sources.length}</span>}
            </div>
            <SourcesPane />
          </section>
          <main className="pane pane-mid" aria-label="Chat">
            <div className="pane-head">
              <h2>Chat</h2>
            </div>
            <ChatPane />
          </main>
          <section className="pane pane-right" aria-label="Studio">
            <div className="pane-head">
              <h2>Studio</h2>
              <span className="count">{ctx.items.length}</span>
            </div>
            <StudioPane />
          </section>
        </div>

        <nav className="tabbar" aria-label="Workspace sections">
          {tabs.map((t) => (
            <button key={t.id} className={mobileTab === t.id ? 'on' : ''} aria-current={mobileTab === t.id} onClick={() => setMobileTab(t.id)}>
              <Icon name={t.icon} size={20} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </NbCtx.Provider>
  )
}
