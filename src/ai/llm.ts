import type { AiConfig, Chunk } from '../types'

/** Reasoning models stream their chain of thought inline; it must never reach the user or the JSON parser. */
export function stripThinking(s: string): string {
  return s.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/^[\s\S]*?<\/think(?:ing)?>/i, '').trim()
}

export const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1'

export async function callLLM(cfg: AiConfig, system: string, user: string, maxTokens = 4096, signal?: AbortSignal): Promise<string> {
  try {
    return stripThinking(await rawCall(cfg, system, user, maxTokens, signal))
  } catch (e) {
    // fetch() rejects with a bare TypeError when the browser blocks a cross-origin call (no CORS headers) or the network is down
    if (e instanceof TypeError) {
      throw new Error(
        `The browser couldn’t reach ${new URL((cfg.baseUrl || (cfg.provider === 'nvidia' ? NVIDIA_BASE : cfg.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'))).host}. If you’re online, this provider probably doesn’t allow direct browser calls (CORS) — set Base URL to a small proxy you control (see docs/nvidia-proxy.md).`,
      )
    }
    throw e
  }
}

async function rawCall(cfg: AiConfig, system: string, user: string, maxTokens: number, signal?: AbortSignal): Promise<string> {
  if (cfg.provider === 'anthropic') {
    const res = await fetch(`${(cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
    })
    if (!res.ok) throw new Error(await errMsg(res))
    const j = await res.json()
    return (j.content ?? []).map((b: any) => b.text ?? '').join('')
  }
  const res = await fetch(`${(cfg.baseUrl || (cfg.provider === 'nvidia' ? NVIDIA_BASE : 'https://api.openai.com/v1')).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  })
  if (!res.ok) throw new Error(await errMsg(res))
  const j = await res.json()
  return j.choices?.[0]?.message?.content ?? ''
}

async function errMsg(res: Response) {
  let detail = ''
  try {
    const j = await res.json()
    detail = j.error?.message ?? JSON.stringify(j).slice(0, 200)
  } catch {
    /* ignore */
  }
  return `The model returned ${res.status}${detail ? `: ${detail}` : ''}`
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
