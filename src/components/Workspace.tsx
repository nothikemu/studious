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

  const { rightOpen, toggleRight, mobileTab, setMobileTab, leftView, setLeftView, reader, studioItemId, openItem, closeReader, setSearchOpen, setSettingsOpen } = useUI()
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
        <Empty icon="warn" title="Lesson not found" action={<Button variant="primary" onClick={() => go('/')}>Back to home</Button>}>
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
  const inStudio = leftView === 'studio' || !!studioItemId
  const tabs: { id: MobileTab; label: string; icon: string }[] = [
    { id: 'sources', label: 'Sources', icon: 'doc' },
    { id: 'chat', label: 'Chat', icon: 'chat' },
    { id: 'studio', label: 'Tools', icon: 'spark' },
  ]
  const rail = (view: 'sources' | 'studio') => {
    if (view === 'sources') closeReader()
    else openItem(null)
    setLeftView(view)
    if (mobileTab === 'chat') setMobileTab(view)
  }

  return (
    <NbCtx.Provider value={ctx}>
      <div className="ws">
        <nav className="rail" aria-label="Lesson navigation">
          <a href="#/" className="rail-logo" aria-label="Home">
            <Logo size={28} />
          </a>
          <IconButton tipSide="right" size={20} icon="doc" label="Sources" active={leftView === 'sources'} onClick={() => rail('sources')} />
          <IconButton tipSide="right" size={20} icon="spark" label="Study tools" active={leftView === 'studio'} onClick={() => rail('studio')} />
          <IconButton tipSide="right" size={20} icon="review" label={dueCount ? `Review (${dueCount} due)` : 'Review'} onClick={() => go(`/n/${id}/review`)} />
          <IconButton tipSide="right" size={20} icon="chart" label="Progress" onClick={() => go(`/n/${id}/progress`)} />
          <span className="grow" />
          <IconButton tipSide="right" size={20} icon="search" label="Search everything" shortcut="⌘K" onClick={() => setSearchOpen(true)} />
          <IconButton tipSide="right" size={20} icon="gear" label="Settings" onClick={() => setSettingsOpen(true)} />
        </nav>

        <main className="ws-main">
          <header className="ws-top">
            <h1 className="sr-only">{nb.title}</h1>
            <a href="#/" className="brand-link top-logo" aria-label="Home">
              <Logo size={26} />
            </a>
            {renaming ? (
              <input
                autoFocus
                className="title-input"
                aria-label="Lesson name"
                defaultValue={nb.title}
                onBlur={(e) => (db.notebooks.update(id, { title: e.target.value.trim() || nb.title }), setRenaming(false))}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <button className="nb-title" onClick={() => setRenaming(true)} title="Rename lesson">
                {nb.title}
              </button>
            )}
            <div className="grow" />
            <Button size="sm" variant="ghost" icon="chart" onClick={() => go(`/n/${id}/progress`)} className="hide-narrow">
              Progress
            </Button>
            <Button size="sm" variant="primary" icon="review" onClick={() => go(`/n/${id}/review`)}>
              {dueCount ? `Review ${dueCount}` : 'Review'}
            </Button>
            <IconButton className="hide-narrow" icon="sidebarR" label={rightOpen ? 'Hide chat' : 'Show chat'} active={rightOpen} onClick={toggleRight} />
            <span className="top-right-mobile">
              <TopRight />
            </span>
          </header>

          <div className={`panes ${rightOpen ? '' : 'no-right'} tab-${mobileTab}`}>
            <section className="pane pane-left" aria-label={inStudio ? 'Study tools' : 'Sources'}>
              <div className="pane-head">
                <h2>{inStudio ? 'Study tools' : reader ? 'Reading' : 'Sources'}</h2>
                {!inStudio && !reader && <span className="count">{ctx.sources.length}</span>}
                {inStudio && !studioItemId && <span className="count">{ctx.items.length}</span>}
              </div>
              {inStudio ? <StudioPane /> : <SourcesPane />}
            </section>
            <aside className="pane pane-right" aria-label="Chat">
              <div className="pane-head">
                <h2>Chat</h2>
                <span className="grow" />
                <Button size="sm" variant="ghost" onClick={toggleRight} className="hide-narrow">
                  Hide <Icon name="arrow" size={14} />
                </Button>
              </div>
              <ChatPane />
            </aside>
          </div>
        </main>

        <nav className="tabbar" aria-label="Workspace sections">
          {tabs.map((t) => (
            <button key={t.id} className={mobileTab === t.id ? 'on' : ''} aria-current={mobileTab === t.id} onClick={() => (t.id === 'chat' ? setMobileTab('chat') : (t.id === 'sources' ? closeReader() : openItem(null), setLeftView(t.id as 'sources' | 'studio'), setMobileTab(t.id)))}>
              <Icon name={t.icon} size={20} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </NbCtx.Provider>
  )
}
