import { useRef, useState } from 'react'
import { useUI } from '../store'
import { useNb } from './nb'

/** Numbered citation chips. Hover/focus previews the passage; click opens it highlighted in the reader. */
export function Cites({ ids, number, quote }: { ids: string[]; number: (id: string) => number; quote?: string }) {
  const { resolver } = useNb()
  const openReader = useUI((s) => s.openReader)
  const [tip, setTip] = useState<{ id: string; x: number; y: number; above: boolean } | null>(null)
  const timer = useRef<number>(0)
  if (!ids.length) return null

  const show = (id: string, el: HTMLElement) => {
    window.clearTimeout(timer.current)
    const r = el.getBoundingClientRect()
    const W = Math.min(320, window.innerWidth - 24)
    const x = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12))
    const above = r.top > 220
    setTip({ id, x, y: above ? r.top - 8 : r.bottom + 8, above })
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setTip(null), 60)
  }

  return (
    <span className="cites">
      {ids.map((id) => {
        const chunk = resolver.chunk(id)
        const n = number(id)
        if (!chunk) {
          return (
            <span key={id} className="cite is-gone" title="This source was removed">
              {n || '?'}
            </span>
          )
        }
        return (
          <span key={id} className="cite-wrap">
            <button
              className="cite"
              onClick={() => (setTip(null), openReader(chunk.sourceId, id, quote))}
              onMouseEnter={(e) => show(id, e.currentTarget)}
              onMouseLeave={hide}
              onFocus={(e) => show(id, e.currentTarget)}
              onBlur={hide}
              aria-label={`Source ${n}: ${resolver.label(id)}. Open passage.`}
            >
              {n}
            </button>
            {tip?.id === id && (
              <span className="cite-pop" role="tooltip" style={{ left: tip.x, top: tip.y, transform: tip.above ? 'translateY(-100%)' : undefined }}>
                <strong>{resolver.label(id)}</strong>
                {chunk.heading && <em>{chunk.heading}</em>}
                <span>“{resolver.quote(id, 260)}”</span>
                <small>Click to open in the source</small>
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}
