export function uid(prefix = ''): string {
  const r = (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))
  return prefix + r.replace(/-/g, '').slice(0, 14)
}
