import type { MapNode } from '../types'

export interface LaidNode {
  node: MapNode
  depth: number
  x: number
  y: number
  w: number
  h: number
  lines: string[]
  parent?: LaidNode
  hasKids: boolean
  collapsed: boolean
}

const COL_W = [190, 200, 230, 270]
const GAP_X = 56
const GAP_Y = 12
const MAX_CHARS = [22, 26, 32, 40]

export function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  if (cur) lines.push(cur)
  if (lines.length > 4) {
    lines.length = 4
    lines[3] = lines[3].replace(/.{0,2}$/, '…')
  }
  return lines
}

export function layoutTree(root: MapNode, collapsed: Set<string>) {
  const nodes: LaidNode[] = []
  let cursor = 0
  const xs: number[] = []
  COL_W.forEach((w, i) => (xs[i] = (i ? xs[i - 1] + COL_W[i - 1] + GAP_X : 0)))
  const place = (n: MapNode, depth: number, parent?: LaidNode): LaidNode => {
    const d = Math.min(depth, 3)
    const lines = wrap(n.label, MAX_CHARS[d])
    const h = lines.length * 16 + 16
    const isCollapsed = collapsed.has(n.id) && n.children.length > 0
    const laid: LaidNode = { node: n, depth, x: xs[d], y: 0, w: COL_W[d], h, lines, parent, hasKids: n.children.length > 0, collapsed: isCollapsed }
    nodes.push(laid)
    const kids = isCollapsed ? [] : n.children.map((c) => place(c, depth + 1, laid))
    if (kids.length) {
      laid.y = (kids[0].y + kids[kids.length - 1].y) / 2 + (kids[kids.length - 1].h - h) / 2 - (kids[kids.length - 1].h - kids[0].h) / 2 * 0
      laid.y = (kids[0].y + kids[0].h / 2 + kids[kids.length - 1].y + kids[kids.length - 1].h / 2) / 2 - h / 2
    } else {
      laid.y = cursor
      cursor += h + GAP_Y
    }
    return laid
  }
  place(root, 0)
  const minY = Math.min(...nodes.map((n) => n.y))
  nodes.forEach((n) => (n.y -= minY))
  const width = Math.max(...nodes.map((n) => n.x + n.w))
  const height = Math.max(...nodes.map((n) => n.y + n.h))
  return { nodes, width, height }
}

export function edgePath(p: LaidNode, c: LaidNode): string {
  const x1 = p.x + p.w
  const y1 = p.y + p.h / 2
  const x2 = c.x
  const y2 = c.y + c.h / 2
  const mx = (x1 + x2) / 2
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Standalone SVG (light theme) for export. */
export function mapToSvg(root: MapNode): string {
  const { nodes, width, height } = layoutTree(root, new Set())
  const pad = 24
  const palette = ['#224b3a', '#2f6f56', '#5a8f7b', '#8fb3a4']
  const edges = nodes
    .filter((n) => n.parent)
    .map((n) => `<path d="${edgePath(n.parent!, n)}" fill="none" stroke="#b9b09a" stroke-width="1.4"/>`)
    .join('')
  const boxes = nodes
    .map((n) => {
      const d = Math.min(n.depth, 3)
      const fill = d === 0 ? palette[0] : d === 1 ? '#e6efe9' : '#fffdf8'
      const color = d === 0 ? '#f6f1e7' : '#1d2420'
      const text = n.lines
        .map((l, i) => `<tspan x="${n.x + 10}" y="${n.y + 20 + i * 16}">${esc(l)}</tspan>`)
        .join('')
      return `<g><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="9" fill="${fill}" stroke="${d === 0 ? palette[0] : '#cfc6b0'}"/><text font-family="Georgia,serif" font-size="12.5" fill="${color}">${text}</text></g>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + pad * 2}" height="${height + pad * 2}" viewBox="${-pad} ${-pad} ${width + pad * 2} ${height + pad * 2}"><rect x="${-pad}" y="${-pad}" width="100%" height="100%" fill="#f7f3ea"/>${edges}${boxes}</svg>`
}
