import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '../store'

const P: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  search: 'M11 4a7 7 0 105 11.9l4 4M11 4a7 7 0 010 14',
  back: 'M15 5l-7 7 7 7',
  close: 'M6 6l12 12M18 6L6 18',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M9.5 17v-4h1.6a1.2 1.2 0 010 2.4H9.5',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  send: 'M5 12l14-7-5 14-2-6z',
  chat: 'M4 5h16v11H9l-5 4z',
  guide: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM8 8h7M8 12h7',
  cards: 'M7 8h12v10H7zM5 6h12M9 4h10',
  quiz: 'M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4M12 17h.01M4 12a8 8 0 1016 0 8 8 0 10-16 0',
  mindmap: 'M12 12m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0M5 5.5h4l3 6.5M5 18.5h4l3-6.5M19 8h-3.5L12 12M19 16h-3.5L12 12',
  deck: 'M4 5h16v11H4zM8 20h8M12 16v4',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  glossary: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h3',
  notes: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1.2-1.6-2.8-2.3.6a7 7 0 00-1.6-.9L15 5.2h-3.2l-.5 2.3a7 7 0 00-1.6.9l-2.3-.6L5.8 10.6 7.8 12l-2 1.2 1.6 2.8 2.3-.6a7 7 0 001.6.9l.5 2.3H15l.5-2.3a7 7 0 001.6-.9l2.3.6L21 13.2z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M7 7l10 10M17 7L7 17',
  chevron: 'M9 6l6 6-6 6',
  chevdown: 'M6 9l6 6 6-6',
  sidebarL: 'M4 5h16v14H4zM9 5v14',
  sidebarR: 'M4 5h16v14H4zM15 5v14',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  shrink: 'M20 10h-6V4M4 14h6v6M14 10l7-7M3 21l7-7',
  edit: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  chart: 'M5 20V10M12 20V4M19 20v-7',
  review: 'M4 12a8 8 0 0114-5.3M20 4v4h-4M20 12a8 8 0 01-14 5.3M4 20v-4h4',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM8 3v16',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  clock: 'M12 7v5l3 2M4 12a8 8 0 1016 0 8 8 0 10-16 0',
  flame: 'M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z',
  warn: 'M12 4l9 16H3zM12 10v4M12 17h.01',
}

export type IconName = keyof typeof P | (string & {})

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={P[name] ?? P.doc} />
    </svg>
  )
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M21.2 11.2c-.9-1.7-2.7-2.5-5-2.5-2.6 0-4.3 1.2-4.3 3.1 0 4.4 9.6 2 9.6 6.6 0 2.1-1.9 3.5-4.8 3.5-2.4 0-4.3-.9-5.4-2.6" stroke="var(--accent-ink)" strokeWidth="2.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="8" r="2" fill="var(--cite)" />
    </svg>
  )
}

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: IconName
  busy?: boolean
}
export function Button({ variant = 'secondary', size = 'md', icon, busy, children, className = '', ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={rest.disabled || busy} className={`btn btn-${variant} btn-${size} ${className}`}>
      {busy ? <span className="spin" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, shortcut, size = 18, className = '', active, ...rest }: { icon: IconName; label: string; shortcut?: string; size?: number; active?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} aria-label={label} aria-pressed={active} className={`iconbtn ${active ? 'is-active' : ''} ${className}`}>
      <Icon name={icon} size={size} />
      <span className="tip" role="tooltip">
        {label}
        {shortcut && <kbd>{shortcut}</kbd>}
      </span>
    </button>
  )
}

export function Dialog({ title, onClose, children, width = 520, footer, labelledBy }: { title: string; onClose: () => void; children: ReactNode; width?: number; footer?: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const root = ref.current!
    const focusables = () => [...root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((e) => !e.hasAttribute('disabled'))
    ;(root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus())
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus())
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [onClose])
  return createPortal(
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? id} style={{ maxWidth: width }}>
        <div className="dialog-head">
          <h2 id={id}>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function Menu({ label, icon = 'more', items, align = 'right' }: { label: string; icon?: IconName; align?: 'left' | 'right'; items: ({ label: string; icon?: IconName; onClick: () => void; danger?: boolean } | 'sep')[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', off)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <IconButton icon={icon} label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className={`menu-pop align-${align}`} role="menu">
          {items.map((it, i) =>
            it === 'sep' ? (
              <hr key={i} />
            ) : (
              <button
                key={i}
                role="menuitem"
                className={it.danger ? 'danger' : ''}
                onClick={() => {
                  setOpen(false)
                  it.onClick()
                }}
              >
                {it.icon && <Icon name={it.icon} size={16} />}
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

export function ToastHost() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Empty({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={22} />
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function ago(t: number): string {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}
