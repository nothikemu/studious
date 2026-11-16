import { useState } from 'react'
import { isRemote } from '../ai/config'
import { callLLM } from '../ai/llm'
import { db } from '../db'
import { useUI } from '../store'
import type { AiConfig } from '../types'
import { Button, Dialog } from './ui'

const PRESETS: Record<AiConfig['provider'], { model: string; base: string }> = {
  offline: { model: '', base: '' },
  anthropic: { model: 'claude-sonnet-5-5', base: '' },
  openai: { model: 'gpt-4.1-mini', base: '' },
}

export function SettingsDialog() {
  const close = () => useUI.getState().setSettingsOpen(false)
  const ai = useUI((s) => s.ai)
  const setAi = useUI((s) => s.setAi)
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const toast = useUI((s) => s.toast)
  const [cfg, setCfg] = useState<AiConfig>(ai)
  const [testing, setTesting] = useState(false)

  const test = async () => {
    setTesting(true)
    try {
      const out = await callLLM(cfg, 'Reply with the single word: ready', 'ping', 20)
      toast(`Connected. Model replied: “${out.trim().slice(0, 40)}”`, 'success')
    } catch (e) {
      toast(`Couldn’t connect. ${(e as Error).message}`, 'error')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Dialog
      title="Settings"
      onClose={close}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" onClick={() => (setAi(cfg), toast('Settings saved.', 'success'), close())}>Save</Button>
        </>
      }
    >
      <div className="stack">
        <fieldset className="field">
          <legend>Theme</legend>
          <div className="seg">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button key={t} className={theme === t ? 'on' : ''} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>AI engine</legend>
          <div className="seg">
            {(['offline', 'anthropic', 'openai'] as const).map((p) => (
              <button key={p} className={cfg.provider === p ? 'on' : ''} aria-pressed={cfg.provider === p} onClick={() => setCfg({ ...cfg, provider: p, model: PRESETS[p].model || cfg.model })}>
                {p === 'offline' ? 'Offline' : p === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}
              </button>
            ))}
          </div>
          {cfg.provider === 'offline' ? (
            <p className="muted">Everything runs in your browser. Answers and Studio items are built by ranking and quoting passages from your sources — dependable and private, but not paraphrased.</p>
          ) : (
            <div className="stack-sm">
              <label className="field">
                <span>API key</span>
                <input type="password" autoComplete="off" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} placeholder="Stored only in this browser" />
              </label>
              <div className="grid2">
                <label className="field"><span>Model</span><input value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} /></label>
                <label className="field"><span>Base URL <em>(optional)</em></span><input value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} placeholder={cfg.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'} /></label>
              </div>
              <p className="muted small">Requests go directly from your browser to this provider; relevant passages from your sources are sent with each request. Every generated claim must cite a passage or it’s discarded, and you’ll fall back to offline mode if a call fails.</p>
              <Button size="sm" busy={testing} disabled={!isRemote(cfg)} onClick={test}>Test connection</Button>
            </div>
          )}
        </fieldset>

        <fieldset className="field">
          <legend>Your data</legend>
          <p className="muted small">Notebooks, sources and review history live in this browser’s storage. Export a notebook from its card for a backup.</p>
          <Button variant="danger" size="sm" icon="trash" onClick={async () => {
            if (confirm('Delete ALL notebooks, sources and review history from this browser?')) {
              await Promise.all([db.notebooks, db.sources, db.chunks, db.messages, db.items, db.cards, db.reviews, db.attempts].map((t) => t.clear()))
              toast('Everything was deleted.', 'info')
              close()
            }
          }}>Delete all data</Button>
        </fieldset>
      </div>
    </Dialog>
  )
}
