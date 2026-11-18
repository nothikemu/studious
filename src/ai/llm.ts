import type { AiConfig, Chunk } from '../types'

/** Reasoning models stream their chain of thought inline; it must never reach the user or the JSON parser. */
export function stripThinking(s: string): string {
  return s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/^[\s\S]*?<\/think(?:ing)?>/i, '').trim()
}

export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1'
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

const defaultBase = (p: AiConfig['provider']) =>
  p === 'nvidia' ? NVIDIA_BASE : p === 'openrouter' ? OPENROUTER_BASE : p === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'

/** Tolerate common paste mistakes: whitespace, quotes, a leading "Bearer ", "Authorization:" labels. */
export function cleanKey(k: string): string {
  const unquote = (x: string) => x.trim().replace(/^["'`]+|["'`]+$/g, '').trim()
  return unquote(unquote(k).replace(/^authorization:\s*/i, '').replace(/^bearer\s+/i, ''))
}

/** Normalise a base URL: add https://, upgrade http (redirects drop auth headers), drop a pasted endpoint suffix. */
export function cleanBase(raw: string, fallback: string): string {
  let b = (raw || '').trim()
  if (!b) return fallback
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b
  if (/^http:\/\/(?!localhost|127\.0\.0\.1)/i.test(b)) b = b.replace(/^http:/i, 'https:')
  return b.replace(/\/(chat\/completions|v1\/messages)\/?$/i, '').replace(/\/+$/, '')
}

const KEY_PREFIX: Partial<Record<AiConfig['provider'], string>> = { openrouter: 'sk-or-', nvidia: 'nvapi-', anthropic: 'sk-ant-' }
/** Expected key prefix when the key clearly belongs to a different provider, else null. */
export function wrongKeyPrefix(cfg: AiConfig): string | null {
  const key = cleanKey(cfg.apiKey)
  const want = KEY_PREFIX[cfg.provider]
  return want && key && !key.startsWith(want) ? want : null
}

export function keyHint(cfg: AiConfig): string {
  const key = cleanKey(cfg.apiKey)
  const want = KEY_PREFIX[cfg.provider]
  const masked = key ? `${key.slice(0, 7)}…(${key.length} chars)` : 'none'
  const wrong = want && key && !key.startsWith(want) ? ` This doesn’t look like a ${cfg.provider} key — they start with “${want}”.` : ''
  return ` Key sent: ${masked}.${wrong}`
}

export async function callLLM(cfg: AiConfig, system: string, user: string, maxTokens = 4096, signal?: AbortSignal): Promise<string> {
  try {
    return stripThinking(await rawCall(cfg, system, user, maxTokens, signal))
  } catch (e) {
    // fetch() rejects with a bare TypeError when the browser blocks a cross-origin call (no CORS headers) or the network is down
    if (e instanceof TypeError) {
      throw new Error(
        `The browser couldn’t reach ${new URL(cleanBase(cfg.baseUrl, defaultBase(cfg.provider))).host}. If you’re online, this provider probably doesn’t allow direct browser calls (CORS) — set Base URL to a small proxy you control (see docs/nvidia-proxy.md).`,
      )
    }
    throw e
  }
}

async function rawCall(cfg: AiConfig, system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
  if (cfg.provider === 'anthropic') {
    const res = await fetch(`${cleanBase(cfg.baseUrl, 'https://api.anthropic.com')}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cleanKey(cfg.apiKey),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    })
    if (!res.ok) throw new Error(await errMsg(res, cfg))
    const j = await res.json()
    return (j.content ?? []).map((b: any) => b.text ?? '').join('')
  }
  const res = await fetch(`${cleanBase(cfg.baseUrl, defaultBase(cfg.provider))}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cleanKey(cfg.apiKey)}`,
      // OpenRouter uses these (optional) headers to attribute traffic to the app
      ...(cfg.provider === 'openrouter' ? { 'X-Title': 'Studious', 'HTTP-Referer': typeof location !== 'undefined' ? location.origin : '' } : {}),
    },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  })
  if (!res.ok) throw new Error(await errMsg(res, cfg))
  const j = await res.json()
  return j.choices?.[0]?.message?.content ?? ''
}

async function errMsg(res: Response, cfg: AiConfig) {
  let detail = ''
  try {
    const j = await res.json()
    detail = j.error?.message ?? JSON.stringify(j).slice(0, 200)
  } catch {
    /* ignore */
  }
  const auth = res.status === 401 || res.status === 403
  return `The model returned ${res.status}${detail ? `: ${detail}` : ''}${auth ? keyHint(cfg) + ` Endpoint: ${new URL(res.url || 'https://unknown').host || 'unknown'}.` : ''}`
}

export interface LlmContext {
  text: string
  byNumber: Map<number, string> // [n] -> chunkId
}

/** Number chunks [1]..[n] so the model can cite them; sample evenly when over budget. */
export function buildContext(chunks: Chunk[], titleOf: (sourceId: string) => string, budget = 60_000): LlmContext {
  let pool = chunks
  const total = chunks.reduce((n, c) => n + c.text.length, 0)
  if (total > budget) {
    const ratio = budget / total
    const step = 1 / ratio
    pool = chunks.filter((_, i) => Math.floor(i / step) !== Math.floor((i - 1) / step) || i === 0)
  }
  const byNumber = new Map<number, string>()
  const parts = pool.map((c, i) => {
    byNumber.set(i + 1, c.id)
    return `[${i + 1}] (${titleOf(c.sourceId)}${c.heading ? ` › ${c.heading}` : ''}${c.page ? `, p.${c.page}` : ''})\n${c.text}`
  })
  return { text: parts.join('\n\n'), byNumber }
}

export function extractJson<T = any>(s: string): T {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s)
  const body = fence ? fence[1] : s
  const start = body.search(/[{[]/)
  if (start < 0) throw new Error('The model did not return JSON.')
  const open = body[start]
  const close = open === '{' ? '}' : ']'
  const end = body.lastIndexOf(close)
  return JSON.parse(body.slice(start, end + 1))
}
