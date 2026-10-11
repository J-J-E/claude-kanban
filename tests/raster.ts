// A monospace text rasterisation of a drawn tree (what `ui.drawn({ in })` returns for a Client): every Box is placed the way a
// flex row or column would place it, one character a cell, text cut with an ellipsis where its Box ends, borders drawn
// with box characters. For reading the board next to docs/design/mock.html and for the golden tests that keep it from
// changing by accident; it is a sketch, not the desktop's paint: no proportional font, no fills, no native control chrome
// (an Input is `[ text ]`, a Button `(Label)`, `[Label]` when it is the main one).
//
// A border takes a cell by default (the header's air rows hold its lines). With `thin` it is drawn the way the desktop draws it, as a thin
// line that takes no cell: nothing is inset, children are drawn first, and a border glyph only goes into a cell that is still
// blank, so a card reads `│ KB-0008 Later… │`, a two-row card `╭ … ╮` over `╰ … ╯`, and a panel has its corners beside the title bar,
// its sides, and a full closing line when its last row is a blank gap row.
//
// Colour and weight are kept apart from the characters, in a second grid that `styleRuns` reads, so the sketch stays
// aligned: `W` warning, `C` claude, `E` error (lower case when filled), `I` filled, `B` a bright outline, `d` dim, `b` bold, `.` plain. Not a test file (the
// runner only runs *.test.ts).

export type DrawnNode = { type: string; props: Record<string, unknown>; hover?: unknown; children?: (DrawnNode | string | null)[] }

type Rect = { x: number; y: number; w: number; h: number }
type Cell = { ch: string; style: string }

function cellWidth(text: string): number {
  let n = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 32 || (cp >= 0x300 && cp <= 0x36f)) continue
    n += (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0x1f300 && cp <= 0x1faff) ? 2 : 1
  }
  return n
}

function kidsOf(n: DrawnNode): DrawnNode[] {
  return (n.children ?? []).filter((c): c is DrawnNode => typeof c === 'object' && c !== null)
}

function textOf(n: DrawnNode | string | null | undefined): string {
  if (n === null || n === undefined) return ''
  if (typeof n === 'string') return n
  return (n.children ?? []).map(textOf).join('')
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

/** Set while `rasterise` runs with `thin`. */
let THIN = false

const BORDERS: Record<string, string> = {
  round: '╭╮╰╯─│',
  bold: '┏┓┗┛━┃',
  double: '╔╗╚╝═║',
  dashed: '┌┐└┘╌╎',
  single: '┌┐└┘─│',
}

/** The letter the style grid keeps for a text: `W` warning, `C` claude, `E` error (lower case when inverse, a filled label), `I`
 * inverse in the default colour, `d` dim, `b` bold, `.` plain. */
function styleOf(p: Record<string, unknown>): string {
  const colour = p.color
  const letter = colour === 'warning' ? 'W' : colour === 'claude' ? 'C' : colour === 'error' ? 'E' : ''
  if (p.inverse === true) return letter === '' ? 'I' : letter.toLowerCase()
  if (letter !== '') return letter
  return p.dimColor === true ? 'd' : p.bold === true ? 'b' : '.'
}

/** The letter for a border: the colour, else `d` when dim, else `B` (bright). */
function borderStyleOf(p: Record<string, unknown>): string {
  const colour = p.borderColor
  if (colour === 'warning') return 'W'
  if (colour === 'claude') return 'C'
  if (colour === 'error') return 'E'
  return p.borderDimColor === true ? 'd' : 'B'
}

class Sheet {
  readonly cells: Cell[][]
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', style: ' ' })))
  }
  put(x: number, y: number, ch: string, style: string, clip: Rect): void {
    if (x < clip.x || y < clip.y || x >= clip.x + clip.w || y >= clip.y + clip.h) return
    const row = this.cells[y]
    if (row === undefined || x < 0 || x >= this.w) return
    row[x] = { ch, style }
  }
}

// ---- Measuring ----

function intrinsicW(n: DrawnNode): number {
  const w = num(n.props.width)
  if (w !== undefined) return w
  if (n.type === 'Text') return cellWidth(textOf(n))
  if (n.type === 'Input') return 20
  if (n.type === 'Button') return cellWidth(String(n.props.label ?? '')) + 2
  const flow = kidsOf(n).filter((c) => c.props.position !== 'absolute' && c.props.display !== 'none')
  const border = n.props.borderStyle !== undefined && !THIN ? 2 : 0
  const pad = (num(n.props.paddingLeft) ?? num(n.props.paddingX) ?? 0) + (num(n.props.paddingRight) ?? num(n.props.paddingX) ?? 0)
  if (n.props.flexDirection === 'column') return Math.max(0, ...flow.map(outerW)) + border + pad
  return flow.reduce((sum, c) => sum + outerW(c), 0) + (num(n.props.gap) ?? 0) * Math.max(0, flow.length - 1) + border + pad
}

function outerW(n: DrawnNode): number {
  return intrinsicW(n) + (num(n.props.marginLeft) ?? 0) + (num(n.props.marginRight) ?? 0)
}

function intrinsicH(n: DrawnNode): number {
  const h = num(n.props.height)
  if (h !== undefined) return h
  if (n.type === 'Text') return 1
  if (n.type === 'Input' || n.type === 'Button') return 2
  const flow = kidsOf(n).filter((c) => c.props.position !== 'absolute' && c.props.display !== 'none')
  const border = n.props.borderStyle !== undefined && !THIN ? 2 : 0
  if (n.props.flexDirection === 'column') return flow.reduce((sum, c) => sum + intrinsicH(c), 0) + border
  return Math.max(1, ...flow.map(intrinsicH)) + border
}

// ---- Drawing ----

function drawText(sheet: Sheet, n: DrawnNode, r: Rect, clip: Rect): void {
  let text = textOf(n)
  if (r.w <= 0) return
  if (cellWidth(text) > r.w && n.props.wrap === 'truncate-end') {
    let out = ''
    let used = 0
    for (const ch of text) {
      if (used + cellWidth(ch) > r.w - 1) break
      out += ch
      used += cellWidth(ch)
    }
    text = out + '…'
  }
  const style = styleOf(n.props)
  let x = r.x
  for (const ch of text) {
    const w = cellWidth(ch)
    sheet.put(x, r.y, ch, style, clip)
    if (w === 2) sheet.put(x + 1, r.y, '', style, clip)
    x += w
    if (x >= r.x + r.w + 1) break
  }
}

function drawBox(sheet: Sheet, n: DrawnNode, r: Rect, clip: Rect): void {
  if (n.props.display === 'none') return
  if (n.type === 'Text') return drawText(sheet, n, r, clip)
  if (n.type === 'Input') {
    const text = String(n.props.value ?? '') !== '' ? String(n.props.value) : String(n.props.placeholder ?? '')
    const line = ('[ ' + text).slice(0, Math.max(0, r.w - 1)).padEnd(Math.max(0, r.w - 1), ' ') + ']'
    ;[...line].forEach((ch, i) => sheet.put(r.x + i, r.y, ch, n.props.value ? '.' : 'd', clip))
    return
  }
  if (n.type === 'Button') {
    const label = String(n.props.label ?? '')
    const [open, close] = n.props.variant === 'primary' ? ['[', ']'] : ['(', ')']
    ;[...(open + label + close)].forEach((ch, i) => sheet.put(r.x + i, r.y, ch, n.props.variant === 'primary' ? 'b' : '.', clip))
    return
  }
  // A one-cell strip filled in a theme colour and holding nothing is a card's spine (the left edge of a card that waits on him): drawn as `▌`.
  if (n.props.backgroundColor !== undefined && r.w === 1 && kidsOf(n).length === 0 && (n.props.backgroundColor === 'warning' || n.props.backgroundColor === 'error' || n.props.backgroundColor === 'claude')) {
    const letter = n.props.backgroundColor === 'warning' ? 'W' : n.props.backgroundColor === 'error' ? 'E' : 'C'
    for (let j = 0; j < r.h; j++) sheet.put(r.x, r.y + j, '▌', letter, clip)
    return
  }
  // A Box with a background is opaque: whatever was drawn under it is gone (the ghost and the menu hide what they cover).
  if (n.props.backgroundColor !== undefined) {
    for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) sheet.put(r.x + i, r.y + j, ' ', ' ', clip)
  }
  const border = n.props.borderStyle
  let inner = r
  if (typeof border === 'string' && !THIN) {
    const set = BORDERS[border] ?? BORDERS.single ?? '┌┐└┘─│'
    const style = borderStyleOf(n.props)
    const [tl, tr, bl, br, hz, vt] = [...set]
    for (let i = 0; i < r.w; i++) {
      sheet.put(r.x + i, r.y, i === 0 ? (tl as string) : i === r.w - 1 ? (tr as string) : (hz as string), style, clip)
      sheet.put(r.x + i, r.y + r.h - 1, i === 0 ? (bl as string) : i === r.w - 1 ? (br as string) : (hz as string), style, clip)
    }
    for (let j = 1; j < r.h - 1; j++) {
      sheet.put(r.x, r.y + j, vt as string, style, clip)
      sheet.put(r.x + r.w - 1, r.y + j, vt as string, style, clip)
    }
    inner = { x: r.x + 1, y: r.y + 1, w: Math.max(0, r.w - 2), h: Math.max(0, r.h - 2) }
  }
  const padL = num(n.props.paddingLeft) ?? num(n.props.paddingX) ?? 0
  const padR = num(n.props.paddingRight) ?? num(n.props.paddingX) ?? 0
  const padT = num(n.props.paddingTop) ?? num(n.props.paddingY) ?? 0
  inner = { x: inner.x + padL, y: inner.y + padT, w: Math.max(0, inner.w - padL - padR), h: Math.max(0, inner.h - padT) }
  const box = n.props.overflow === 'hidden' ? intersect(clip, inner) : clip
  const edges = (): void => {
    if (!THIN || typeof border !== 'string' || r.w < 2 || r.h < 1) return
    // A border in the colour of its own fill is not seen (a card is a rounded fill with no outline).
    if (n.props.borderColor !== undefined && n.props.borderColor === n.props.backgroundColor) return
    const set = BORDERS[border] ?? BORDERS.single ?? '┌┐└┘─│'
    const style = borderStyleOf(n.props)
    const [tl, tr, bl, br, hz, vt] = [...set] as string[]
    const blank = (x: number, y: number): boolean => sheet.cells[y]?.[x]?.ch === ' '
    for (let j = 0; j < r.h; j++) {
      const y = r.y + j
      const isTop = r.h >= 2 && j === 0
      const isBottom = r.h >= 2 && j === r.h - 1
      let whole = isTop || isBottom
      if (whole) for (let i = 1; i < r.w - 1; i++) if (!blank(r.x + i, y)) whole = false
      const left = isTop ? tl : isBottom ? bl : vt
      const right = isTop ? tr : isBottom ? br : vt
      if (whole) for (let i = 1; i < r.w - 1; i++) sheet.put(r.x + i, y, hz as string, style, clip)
      if (blank(r.x, y)) sheet.put(r.x, y, left as string, style, clip)
      if (blank(r.x + r.w - 1, y)) sheet.put(r.x + r.w - 1, y, right as string, style, clip)
    }
  }

  const flow: DrawnNode[] = []
  // An outline that holds nothing (the one round the lane under a dragged card) is laid over the rest, into the cells they left blank.
  const isOutline = (c: DrawnNode): boolean => c.props.position === 'absolute' && typeof c.props.borderStyle === 'string' && kidsOf(c).length === 0 && c.props.backgroundColor === undefined
  for (const c of [...kidsOf(n).filter((x) => !isOutline(x)), ...kidsOf(n).filter(isOutline)]) {
    if (c.props.display === 'none') continue
    if (c.props.position === 'absolute') {
      const x = r.x + (num(c.props.left) ?? 0)
      const y = r.y + (num(c.props.top) ?? 0)
      const cr = { x, y, w: intrinsicW(c), h: intrinsicH(c) }
      drawBox(sheet, c, cr, clip)
    } else {
      flow.push(c)
    }
  }
  if (flow.length === 0) {
    edges()
    return
  }

  if (n.props.flexDirection === 'column') {
    const total = flow.reduce((sum, c) => sum + intrinsicH(c), 0)
    let y = inner.y + (THIN && n.props.justifyContent === 'center' ? Math.max(0, Math.floor((inner.h - total) / 2)) : 0)
    for (const c of flow) {
      const h = intrinsicH(c)
      const w = num(c.props.width) ?? Math.max(0, inner.w - (num(c.props.marginLeft) ?? 0) - (num(c.props.marginRight) ?? 0))
      drawBox(sheet, c, { x: inner.x + (num(c.props.marginLeft) ?? 0), y, w, h }, box)
      y += h
    }
    edges()
    return
  }

  // A row: base widths, then grow into what is left or shrink to fit, then the justify offset.
  const gap = num(n.props.gap) ?? 0
  const bases = flow.map((c) => intrinsicW(c))
  const margins = flow.map((c) => (num(c.props.marginLeft) ?? 0) + (num(c.props.marginRight) ?? 0))
  const used = bases.reduce((a, b) => a + b, 0) + margins.reduce((a, b) => a + b, 0) + gap * Math.max(0, flow.length - 1)
  const left = inner.w - used
  const widths = [...bases]
  if (left > 0) {
    const grow = flow.map((c) => num(c.props.flexGrow) ?? 0)
    const total = grow.reduce((a, b) => a + b, 0)
    if (total > 0) {
      let given = 0
      grow.forEach((g, i) => {
        const add = i === grow.length - 1 || g === 0 ? (g === 0 ? 0 : left - given) : Math.floor((left * g) / total)
        widths[i] = (widths[i] as number) + add
        given += add
      })
    }
  } else if (left < 0) {
    // Shrink as a flex row does: the overflow is shared by flexShrink times the base width (default 1), an item stops at 0.
    let over = -left
    for (let pass = 0; pass < 6 && over > 0; pass++) {
      const weights = flow.map((c, i) => (num(c.props.flexShrink) ?? 1) * (widths[i] as number))
      const total = weights.reduce((a, b) => a + b, 0)
      if (total === 0) break
      const cuts = weights.map((wt, i) => Math.min(widths[i] as number, Math.floor((over * wt) / total)))
      let rest = over - cuts.reduce((a, b) => a + b, 0)
      // Whole cells that the division left over go to the heaviest items first.
      const order = weights.map((wt, i) => i).sort((a, b) => (weights[b] as number) - (weights[a] as number))
      for (const i of order) {
        if (rest <= 0) break
        if ((weights[i] as number) > 0 && (cuts[i] as number) < (widths[i] as number)) {
          cuts[i] = (cuts[i] as number) + 1
          rest -= 1
        }
      }
      cuts.forEach((cut, i) => {
        widths[i] = (widths[i] as number) - cut
      })
      over = rest > 0 ? rest : 0
    }
  }
  const spare = Math.max(0, inner.w - widths.reduce((a, b) => a + b, 0) - margins.reduce((a, b) => a + b, 0) - gap * Math.max(0, flow.length - 1))
  let x = inner.x + (n.props.justifyContent === 'flex-end' ? spare : n.props.justifyContent === 'center' ? Math.floor(spare / 2) : 0)
  flow.forEach((c, i) => {
    x += num(c.props.marginLeft) ?? 0
    const w = widths[i] as number
    const h = num(c.props.height) ?? inner.h
    drawBox(sheet, c, { x, y: inner.y, w, h }, box)
    x += w + (num(c.props.marginRight) ?? 0) + gap
  })
  edges()
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) }
}

/** One tree drawn into `columns` cells and as many rows as the tree is tall (its root's `height`). */
export type Raster = { lines: string[]; styles: string[] }

export function rasterise(tree: DrawnNode, columns: number, opts: { thin?: boolean } = {}): Raster {
  THIN = opts.thin === true
  try {
    return rasteriseNow(tree, columns)
  } finally {
    THIN = false
  }
}

function rasteriseNow(tree: DrawnNode, columns: number): Raster {
  const rows = num(tree.props.height) ?? intrinsicH(tree)
  const sheet = new Sheet(columns, rows)
  const all: Rect = { x: 0, y: 0, w: columns, h: rows }
  drawBox(sheet, { ...tree, props: { ...tree.props, position: 'relative' } }, { x: 0, y: 0, w: num(tree.props.width) ?? columns, h: rows }, all)
  return {
    lines: sheet.cells.map((row) => row.map((c) => c.ch).join('').replace(/\s+$/, '')),
    styles: sheet.cells.map((row) => row.map((c) => c.style).join('')),
  }
}

/** Stacks rasters one under another (the top zone over the lanes). */
export function stack(...parts: Raster[]): Raster {
  return { lines: parts.flatMap((p) => p.lines), styles: parts.flatMap((p) => p.styles) }
}

const WORDS: Record<string, string> = { W: 'orange', w: 'orange filled', C: 'accent', c: 'accent filled', E: 'red', e: 'red filled', I: 'filled', B: 'bright' }

/** The coloured runs of a raster, one note per row that has any: `x 1-14 orange` (cells, 0 at the left), dim and plain left out. */
export function styleRuns(r: Raster): string[] {
  const out: string[] = []
  r.styles.forEach((row, y) => {
    const runs: string[] = []
    let i = 0
    while (i < row.length) {
      const s = row[i] as string
      let j = i
      while (j + 1 < row.length && row[j + 1] === s) j++
      if (WORDS[s] !== undefined) runs.push(`${i}-${j} ${WORDS[s]}`)
      i = j + 1
    }
    if (runs.length > 0) out.push(`${String(y).padStart(2, ' ')}: ${runs.join(', ')}`)
  })
  return out
}
