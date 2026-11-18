import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { answerQuestion, userMessage } from '../ai/chat'
import { isRemote } from '../ai/config'
import { db } from '../db'
import { analyze } from '../lib/analysis'
import { uid } from '../lib/ids'
import { buildRetriever } from '../lib/search'
import { useUI } from '../store'
import { saveToNotes } from '../studio/generate'
import type { ChatMessage } from '../types'
import { Cites } from './Cite'
import { useNb } from './nb'
import { useStudioLauncher } from './Studio'
import { Button, Icon, IconButton, Mascot } from './ui'

export function ChatPane() {
  const { notebook, sources, chunks, messages, resolver } = useNb()
  const ai = useUI((s) => s.ai)
  const toast = useUI((s) => s.toast)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { launch, busy: genBusy, dialog } = useStudioLauncher()

  const active = useMemo(() => {
    const on = new Set(sources.filter((s) => s.enabled).map((s) => s.id))
    return chunks.filter((c) => on.has(c.sourceId))
  }, [sources, chunks])
  const activeSources = sources.filter((s) => s.enabled)
  const engine = useMemo(() => {
    if (!active.length) return null
    return { a: analyze(active, activeSources), r: buildRetriever(active) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, busy])

  const ask = async (q: string) => {
    q = q.trim()
    if (!q || busy) return
    setText('')
    const um = userMessage(notebook.id, q)
    await db.messages.add(um)
    if (!engine) {
      await db.messages.add({ id: uid('m'), notebookId: notebook.id, role: 'assistant', notFound: true, text: 'There are no active sources. Add a source or switch one on in the Sources pane.', at: Date.now() })
      return
    }
    setBusy(true)
    try {
      const hist = [...messages, um]
      const ans = await answerQuestion({ query: q, history: hist, a: engine.a, retriever: engine.r, cfg: ai, prefs: notebook.prefs, titleOf: (sid) => engine.a.sourceById.get(sid)?.title ?? 'Source' })
      await db.messages.add({ id: uid('m'), notebookId: notebook.id, role: 'assistant', at: Date.now(), ...ans })
    } catch (e) {
      toast((e as Error).message, 'error')
    } finally {
      setBusy(false)
      taRef.current?.focus()
    }
  }

  const starters = engine
    ? ['Summarize my sources', (engine.a.defs[0] ?? null) ? `What is ${engine.a.defs[0].term}?` : 'What are the key ideas?', sources.length > 1 ? 'Compare the sources' : 'What are the key terms?']
    : []

  return (
    <div className="chat">
      <div className="chat-scroll" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="quick">
              <button className="qcard" data-kind="quiz" disabled={!activeSources.length || genBusy.includes('quiz')} onClick={() => launch('quiz')}>
                <span className="qcard-head"><Icon name="quiz" size={18} /> Quizzes <em className="badge">Popular</em></span>
                <span className="qcard-sub">Test your knowledge</span>
              </button>
              <button className="qcard" data-kind="flashcards" disabled={!activeSources.length || genBusy.includes('flashcards')} onClick={() => launch('flashcards')}>
                <span className="qcard-head"><Icon name="layers" size={18} /> Flashcards</span>
                <span className="qcard-sub">Study with active recall</span>
              </button>
            </div>
            <Mascot size={72} />
            <h2>Hey, I’m Studious</h2>
            <p>
              {sources.length
                ? `I can answer questions about your ${activeSources.length} active source${activeSources.length === 1 ? '' : 's'} — and show you exactly where each answer comes from.`
                : 'Add a source and I’ll answer from it — with the exact passage cited.'}
            </p>
            <div className="chips">
              {starters.map((s) => (
                <button key={s} className="chip" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
            {!isRemote(ai) && sources.length > 0 && (
              <p className="mode-note">
                <strong>Offline mode.</strong> Answers are quoted passages ranked from your sources — nothing leaves your browser.{' '}
                <button className="linkish" onClick={() => setSettingsOpen(true)}>Connect a model</button> for written explanations.
              </p>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={m.id} m={m} onAsk={ask} isLast={i === messages.length - 1} prevQuestion={messages[i - 1]?.text} />
        ))}
        {busy && (
          <div className="msg msg-ai">
            <div className="thinking" aria-label="Searching your sources">
              <span /> <span /> <span />
              <em>Searching your sources…</em>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value)
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              ask(text)
            }
          }}
          placeholder={sources.length ? 'Ask about your sources…' : 'Add a source to begin'}
          aria-label="Ask a question"
          disabled={!sources.length}
        />
        <div className="composer-foot">
          <span className="meta">{resolverHint(activeSources.length, active.length)}</span>
          <div className="row">
            {messages.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => confirm('Clear this conversation?') && db.messages.where('notebookId').equals(notebook.id).delete()}>
                Clear
              </Button>
            )}
            <Button type="submit" variant="primary" size="sm" icon="send" aria-label="Ask" title="Ask" disabled={!text.trim() || busy} />
          </div>
        </div>
      </form>
      {dialog}
      <span hidden>{resolver ? '' : ''}</span>
    </div>
  )
}

const resolverHint = (s: number, c: number) => `${s} source${s === 1 ? '' : 's'} · ${c} passages`

function Message({ m, onAsk, isLast, prevQuestion }: { m: ChatMessage; onAsk: (q: string) => void; isLast: boolean; prevQuestion?: string }) {
  const { notebook } = useNb()
  const toast = useUI((s) => s.toast)
  const openItem = useUI((s) => s.openItem)
  const ids = useMemo(() => [...new Set((m.segments ?? []).flatMap((s) => s.cites))], [m.segments])
  const num = (id: string) => ids.indexOf(id) + 1
  if (m.role === 'user') {
    return (
      <div className="msg msg-user">
        <p>{m.text}</p>
      </div>
    )
  }
  return (
    <div className="msg msg-ai">
      {m.text && <p className={m.notFound ? 'notice' : 'sys'}>{m.text}</p>}
      {m.notFound && !m.text && (
        <div className="notfound">
          <Icon name="warn" size={18} />
          <div>
            <strong>That isn’t covered by your active sources.</strong>
            <p>I only answer from what you’ve added, so I won’t guess. Try rephrasing with terms from the material, switching on more sources, or adding a source that covers it.</p>
          </div>
        </div>
      )}
      {m.segments && (
        <p className="answer">
          {m.segments.map((s, i) => (
            <span key={i}>
              {s.text}
              <Cites ids={s.cites} number={num} quote={s.text} />{' '}
            </span>
          ))}
        </p>
      )}
      {m.segments && (
        <div className="msg-foot">
          <span className="meta">{m.mode === 'llm' ? 'Written by your model from cited passages' : 'Quoted passages from your sources'}</span>
          <div className="row">
            <IconButton
              icon="copy"
              label="Copy answer"
              size={15}
              onClick={() => navigator.clipboard?.writeText(m.segments!.map((s) => s.text).join(' ')).then(() => toast('Copied.', 'success'))}
            />
            <IconButton
              icon="notes"
              label="Save to notes"
              size={15}
              onClick={async () => {
                const id = await saveToNotes(notebook.id, prevQuestion ?? 'Saved answer', m.segments!)
                toast('Saved to My notes.', 'success')
                openItem(id)
              }}
            />
          </div>
        </div>
      )}
      {isLast && m.followUps && m.followUps.length > 0 && (
        <div className="chips">
          {m.followUps.map((f) => (
            <button key={f} className="chip" onClick={() => onAsk(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function useMessages(notebookId: string) {
  return useLiveQuery(() => db.messages.where('notebookId').equals(notebookId).sortBy('at'), [notebookId])
}
