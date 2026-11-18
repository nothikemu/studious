import type { AiConfig } from '../types'

const KEY = 'studious.ai'
export const DEFAULT_AI: AiConfig = { provider: 'offline', apiKey: '', model: 'claude-sonnet-5-5', baseUrl: '' }

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_AI, ...JSON.parse(raw) } : DEFAULT_AI
  } catch {
    return DEFAULT_AI
  }
}
export function saveAiConfig(c: AiConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    /* storage unavailable — config lives for this session only */
  }
}
export const isRemote = (c: AiConfig) => c.provider !== 'offline' && !!c.apiKey.trim() && !!c.model.trim()
