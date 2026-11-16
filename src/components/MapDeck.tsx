import { useEffect, useMemo, useRef, useState } from 'react'
import { edgePath, layoutTree } from '../lib/mindmap'
import type { DeckContent, MapContent, MapNode, Slide, StudioItem } from '../types'
import { uid } from '../lib/ids'
import { Cites } from './Cite'
import { Button, Icon, IconButton } from './ui'
import { saveContent, useCiteNumber, AutoText } from './Viewer'

// ------------------------------------------------------------------ mind map
export function MapViewer({ item }: { item: StudioItem<MapContent> }) {
  const num = useCiteNumber(item.content)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // start with every branch closed so the overview reads at a glance; click a branch to open it
    return new Set(item.content.root.children.filter((b) => b.children.length).map((b) => b.id))
  })
  const [sel, setSel] = useState<MapNode | null>(null)
  const { nodes, width, height } = useMemo(() => layoutTree(item.content.root, collapsed), [item.content.root, collapsed])
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  const fit = () => {
    const el = box.current
    if (!el) return
    const fitK = Math.min(1.2, (el.clientWidth - 32) / width, (el.clientHeight - 32) / height)
    const k = Math.max(0.6, fitK) // keep text legible; pan if the map is larger than the pane
    setView({ k, x: Math.max(16, (el.clientWidth - width * k) / 2), y: Math.max(16, (el.clientHeight - height * k) / 2) })
  }
  useEffect(fit, [width, height])
  useEffect(() => {
    const ro = new ResizeObserver(fit)
    box.current && ro.observe(box.current)
    return () => ro.disconnect()
  })
  const zoom = (f: number) => setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.25, v.k * f)) }))
  const toggle = (n: MapNode) => setCollapsed((c) => { const s = new Set(c); s.has(n.id) ? s.delete(n.id) : s.add(n.id); return s })

  return (
    <div className="map">
      <div className="map-tools">
        <IconButton icon="plus" label="Zoom in" onClick={() => zoom(1.2)} />
        <IconButton icon="minus" label="Zoom out" onClick={() => zoom(1 / 1.2)} />
        <IconButton icon="expand" label="Fit to view" onClick={fit} />
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>Expand all</Button>
        <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set(item.content.root.children.filter((b) => b.children.length).map((c) => c.id)))}>Collapse</Button>
      </div>
      <div
        ref={box}
        className="map-canvas"
        onPointerDown={(e) => { if ((e.target as Element).closest('.mnode')) return; drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => drag.current && setView((v) => ({ ...v, x: drag.current!.vx + e.clientX - drag.current!.x, y: drag.current!.vy + e.clientY - drag.current!.y }))}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.08 : 0.92) } }}
      >
        <svg width="100%" height="100%" role="group" aria-label="Mind map. Use Tab to move between nodes, Enter to expand or collapse.">
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {nodes.filter((n) => n.parent).map((n) => <path key={n.node.id} d={edgePath(n.parent!, n)} className="medge" />)}
            {nodes.map((n) => (
              <g
                key={n.node.id}
                className={`mnode d${Math.min(n.depth, 3)} ${sel?.id === n.node.id ? 'is-sel' : ''}`}
                transform={`translate(${n.x},${n.y})`}
                tabIndex={0}
                role="button"
                aria-expanded={n.hasKids ? !n.collapsed : undefined}
                aria-label={n.node.label}
                onClick={() => (setSel(n.node), n.hasKids && toggle(n.node))}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSel(n.node), n.hasKids && toggle(n.node))}
              >
                <rect width={n.w} height={n.h} rx={10} />
                <text>{n.lines.map((l, i) => <tspan key={i} x={10} y={20 + i * 16}>{l}</tspan>)}</text>
                {n.hasKids && (
                  <g transform={`translate(${n.w},${n.h / 2})`}>
                    <circle r={9} className="mtoggle" />
                    <text className="mplus" textAnchor="middle" y={4}>{n.collapsed ? '+' : '–'}</text>
                  </g>
                )}
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="map-detail" aria-live="polite">
        {sel ? (
          <>
            <p>{sel.label}</p>
            {sel.cites.length > 0 ? <Cites ids={sel.cites} number={num} quote={sel.label} /> : <span className="meta">Central topic</span>}
          </>
        ) : (
          <span className="meta">Select a node to see its source. Drag to pan; Ctrl/⌘ + scroll to zoom.</span>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ deck
export function DeckViewer({ item }: { item: StudioItem<DeckContent> }) {
  const num = useCiteNumber(item.content)
  const slides = item.content.slides
  const [i, setI] = useState(0)
  const [edit, setEdit] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const s = slides[Math.min(i, slides.length - 1)]
  const set = (next: Slide[]) => saveContent(item.id, { slides: next })
  const patch = (p: Partial<Slide>) => set(slides.map((x) => (x.id === s.id ? { ...x, ...p } : x)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return
      if (e.key === 'ArrowRight') setI((n) => Math.min(slides.length - 1, n + 1))
      if (e.key === 'ArrowLeft') setI((n) => Math.max(0, n - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [slides.length])

  if (!s) return <p className="hint">No slides.</p>
  return (
    <div className="deck">
      <div className="toolbar">
        <Button size="sm" variant={edit ? 'primary' : 'secondary'} icon={edit ? 'check' : 'edit'} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit slide'}</Button>
        <Button size="sm" icon="expand" onClick={() => stage.current?.requestFullscreen?.()}>Present</Button>
        <span className="grow" />
        <span className="meta">{i + 1} / {slides.length}</span>
        <IconButton icon="back" label="Previous slide" disabled={i === 0} onClick={() => setI(i - 1)} />
        <IconButton icon="chevron" label="Next slide" disabled={i >= slides.length - 1} onClick={() => setI(i + 1)} />
      </div>
      <div ref={stage} className={`slide ${i === 0 ? 'is-title' : ''}`}>
        <div className="slide-in">
          {edit ? (
            <input className="slide-title-input" aria-label="Slide title" value={s.title} onChange={(e) => patch({ title: e.target.value })} />
          ) : (
            <h2>{s.title}</h2>
          )}
          <ul>
            {s.bullets.map((b, bi) => (
              <li key={bi}>
                {edit ? (
                  <div className="row">
                    <AutoText value={b.text} label="Bullet" onCommit={(t) => patch({ bullets: s.bullets.map((x, j) => (j === bi ? { ...x, text: t } : x)) })} />
                    <IconButton icon="trash" label="Delete bullet" size={14} onClick={() => patch({ bullets: s.bullets.filter((_, j) => j !== bi) })} />
                  </div>
                ) : (
                  <>{b.text} <Cites ids={b.cites} number={num} quote={b.text} /></>
                )}
              </li>
            ))}
          </ul>
          {edit && <Button size="sm" icon="plus" onClick={() => patch({ bullets: [...s.bullets, { text: 'New point', cites: [] }] })}>Add bullet</Button>}
        </div>
      </div>
      {s.notes && !edit && <details className="notes"><summary>Speaker notes</summary><p>{s.notes}</p></details>}
      <ol className="thumbs" aria-label="Slides">
        {slides.map((x, n) => (
          <li key={x.id}>
            <button className={n === i ? 'on' : ''} onClick={() => setI(n)} aria-label={`Go to slide ${n + 1}: ${x.title}`} aria-current={n === i}>
              <span>{n + 1}</span> {x.title}
            </button>
          </li>
        ))}
      </ol>
      {edit && (
        <div className="row">
          <Button size="sm" icon="plus" onClick={() => { const n = { id: uid('s'), title: 'New slide', bullets: [{ text: 'Point', cites: [] }] }; set([...slides.slice(0, i + 1), n, ...slides.slice(i + 1)]); setI(i + 1) }}>Add slide after</Button>
          <Button size="sm" variant="danger" icon="trash" disabled={slides.length < 2} onClick={() => { set(slides.filter((x) => x.id !== s.id)); setI(Math.max(0, i - 1)) }}>Delete slide</Button>
        </div>
      )}
      <span hidden><Icon name="doc" /></span>
    </div>
  )
}
