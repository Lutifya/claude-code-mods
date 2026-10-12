import type { ClientKeyEvent, ClientModule, ClientPointerEvent, ClientSurface, RenderChildren } from 'claude-code'

import type { Canvas, PadProps } from '../types'

// Palette index 1..8; `text` follows the theme, so ink shows on light and dark.
const PALETTE = ['text', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta', 'gray']
const MAX_SIZE = 5
const UNDO_DEPTH = 30
// Each cell is a braille character: 2 dots across, 4 down.
const DOTS_X = 2
const DOTS_Y = 4
// The braille bit of the dot at (x, y) within its cell (U+2800 + bits).
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]

type Point = { x: number; y: number }

type Pad = {
  canvas: Canvas
  rev: number
  color: number
  size: number
  isErasing: boolean
  undo: Canvas[]
  // The stroke under way: its last point and whether it erases.
  stroke?: { last: Point; erases: boolean }
}

type Surface = ClientSurface<Pad>

// One toolbar entry on the pad's first row, hit-tested by column.
type Tool = { text: string; color?: string; isOn?: boolean; act: (pad: Pad) => Pad }

// Kept narrow (46 columns) so a docked pane still reaches "clear".
const toolbar = (pad: Pad): Tool[] => [
  ...PALETTE.map((color, i) => ({
    text: pad.color === i + 1 && !pad.isErasing ? '[█]' : ' █ ',
    color,
    act: (one: Pad) => ({ ...one, color: i + 1, isErasing: false }),
  })),
  { text: ' erase ', isOn: pad.isErasing, act: one => ({ ...one, isErasing: !one.isErasing }) },
  { text: ' -', act: one => ({ ...one, size: Math.max(1, one.size - 1) }) },
  { text: String(pad.size), act: one => one },
  { text: '+ ', act: one => ({ ...one, size: Math.min(MAX_SIZE, one.size + 1) }) },
  { text: 'undo ', act: undo },
  { text: 'clear', act: clear },
]

const Pad: ClientModule<PadProps, Pad> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined || surface.state.rev !== props.rev) {
    if (surface.state === undefined) {
      surface.onPointer(event => pointer(surface, event))
      surface.onKey(event => key(surface, event))
    }
    surface.setState({
      canvas: props.canvas,
      rev: props.rev,
      color: surface.state?.color ?? 1,
      size: surface.state?.size ?? 1,
      isErasing: false,
      undo: [],
    })
  }
  const pad = surface.state ?? { canvas: props.canvas, rev: props.rev, color: 1, size: 1, isErasing: false, undo: [] }
  const columns = surface.columns
  const rows = Math.max(0, surface.rows - 1)

  const tools = toolbar(pad).map((tool, i) => (
    <Text key={`tool${i}`} color={tool.color} inverse={tool.isOn === true} dimColor={tool.color === undefined && !tool.isOn}>
      {tool.text}
    </Text>
  ))

  const lines: RenderChildren[] = []
  for (let row = 0; row < rows; row += 1) {
    lines.push(
      <Text key={`row${row}`} wrap="truncate-end">
        {runs(pad.canvas, row, columns).map((run, i) => (
          <Text key={`run${i}`} color={run.color}>
            {run.text}
          </Text>
        ))}
      </Text>,
    )
  }

  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">{tools}</Text>
      {lines}
    </Box>
  )
}

export default Pad

function pointer(surface: Surface, event: ClientPointerEvent) {
  const pad = surface.state
  if (pad === undefined) {
    return
  }
  if (event.type === 'down' && event.y === 0) {
    const tool = toolAt(pad, event.x)
    if (tool !== undefined) {
      const next = tool.act(pad)
      surface.setState(next)
      if (next.canvas !== pad.canvas) {
        surface.post({ canvas: next.canvas })
      }
    }

    return
  }
  if (event.type === 'down' && event.button !== undefined) {
    const at = dot(surface, event)
    const erases = event.button === 'right' || pad.isErasing
    const started = { ...pad, undo: [...pad.undo, pad.canvas].slice(-UNDO_DEPTH) }
    const stroke = { last: at, erases }
    surface.setState({ ...started, canvas: paint(started, stroke, at), stroke })

    return
  }
  if (event.type === 'move' && event.button !== undefined && pad.stroke !== undefined) {
    const at = dot(surface, event)
    surface.setState({ ...pad, canvas: line(pad, pad.stroke, pad.stroke.last, at), stroke: { ...pad.stroke, last: at } })

    return
  }
  if (event.type === 'up' && pad.stroke !== undefined) {
    surface.setState({ ...pad, stroke: undefined })
    surface.post({ canvas: pad.canvas })
  }
}

function key(surface: Surface, event: ClientKeyEvent) {
  const pad = surface.state
  if (pad === undefined || event.ctrl === true || event.meta === true) {
    return
  }
  const digit = Number(event.key)
  if (Number.isInteger(digit) && digit >= 1 && digit <= PALETTE.length) {
    surface.setState({ ...pad, color: digit, isErasing: false })
  } else if (event.key === 'e') {
    surface.setState({ ...pad, isErasing: !pad.isErasing })
  } else if (event.key === '+' || event.key === '=') {
    surface.setState({ ...pad, size: Math.min(MAX_SIZE, pad.size + 1) })
  } else if (event.key === '-') {
    surface.setState({ ...pad, size: Math.max(1, pad.size - 1) })
  } else if (event.key === 'u' || event.key === 'c') {
    const next = event.key === 'u' ? undo(pad) : clear(pad)
    surface.setState(next)
    // The hooks module keeps the canvas as it now is.
    surface.post({ canvas: next.canvas })
  }
}

function undo(pad: Pad): Pad {
  const previous = pad.undo[pad.undo.length - 1]

  return previous === undefined ? pad : { ...pad, canvas: previous, undo: pad.undo.slice(0, -1) }
}

function clear(pad: Pad): Pad {
  return pad.canvas.length === 0 ? pad : { ...pad, canvas: [], undo: [...pad.undo, pad.canvas].slice(-UNDO_DEPTH) }
}

function toolAt(pad: Pad, x: number): Tool | undefined {
  let start = 0
  for (const tool of toolbar(pad)) {
    if (x >= start && x < start + tool.text.length) {
      return tool
    }
    start += tool.text.length
  }

  return undefined
}

// The dot under the pointer, the toolbar's row above the canvas. Where the
// terminal reports sub-cell positions (Ghostty, iTerm2, kitty, WezTerm) the
// pen lands on the very dot; elsewhere on the cell's middle, and the line
// between two moves still runs dot by dot. A drag held past the region's
// edges keeps to them.
function dot(surface: Surface, event: ClientPointerEvent): Point {
  const x = event.fine === undefined ? event.x * DOTS_X : Math.floor(event.fine.x * DOTS_X)
  const y = event.fine === undefined ? (event.y - 1) * DOTS_Y + 1 : Math.floor((event.fine.y - 1) * DOTS_Y)
  const right = Math.max(0, surface.columns * DOTS_X - 1)
  const bottom = Math.max(0, (surface.rows - 1) * DOTS_Y - 1)

  return { x: Math.min(right, Math.max(0, x)), y: Math.min(bottom, Math.max(0, y)) }
}

function line(pad: Pad, stroke: NonNullable<Pad['stroke']>, from: Point, to: Point): Canvas {
  let canvas = pad.canvas
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const steps = Math.max(dx, dy, 1)
  for (let i = 0; i <= steps; i += 1) {
    const point = {
      x: Math.round(from.x + ((to.x - from.x) * i) / steps),
      y: Math.round(from.y + ((to.y - from.y) * i) / steps),
    }
    canvas = paint({ ...pad, canvas }, stroke, point)
  }

  return canvas
}

// A round nib: size 1 is one dot, each size up widens it by a dot a side.
function paint(pad: Pad, stroke: NonNullable<Pad['stroke']>, at: Point): Canvas {
  const ink = stroke.erases ? ' ' : String(pad.color)
  const reach = (stroke.erases ? pad.size + 1 : pad.size) - 1
  const canvas = [...pad.canvas]
  for (let y = Math.max(0, at.y - reach); y <= at.y + reach; y += 1) {
    while (canvas.length <= y) {
      canvas.push('')
    }
    let row = canvas[y] ?? ''
    for (let x = Math.max(0, at.x - reach); x <= at.x + reach; x += 1) {
      if ((x - at.x) ** 2 + (y - at.y) ** 2 <= reach * reach + reach) {
        row = row.padEnd(x + 1, ' ')
        row = row.slice(0, x) + ink + row.slice(x + 1)
      }
    }
    canvas[y] = row.trimEnd()
  }

  return canvas
}

type Run = { text: string; color?: string }

// One cell row as braille characters, in runs of one color: a cell takes the
// color most of its dots have.
function runs(canvas: Canvas, row: number, columns: number): Run[] {
  const out: Run[] = []
  for (let column = 0; column < columns; column += 1) {
    let bits = 0
    const counts = new Map<string, number>()
    for (let dy = 0; dy < DOTS_Y; dy += 1) {
      const line = canvas[row * DOTS_Y + dy] ?? ''
      for (let dx = 0; dx < DOTS_X; dx += 1) {
        const ink = line[column * DOTS_X + dx]
        if (ink !== undefined && ink !== ' ') {
          bits |= BRAILLE_BITS[dy]?.[dx] ?? 0
          counts.set(ink, (counts.get(ink) ?? 0) + 1)
        }
      }
    }
    let top: string | undefined
    for (const [ink, count] of counts) {
      if (top === undefined || count > (counts.get(top) ?? 0)) {
        top = ink
      }
    }
    const cell: Run = bits === 0 ? { text: ' ' } : { text: String.fromCharCode(0x2800 + bits), color: colorOf(top) }
    const last = out[out.length - 1]
    if (last !== undefined && last.color === cell.color) {
      last.text += cell.text
    } else {
      out.push(cell)
    }
  }

  return out
}

function colorOf(ink: string | undefined): string | undefined {
  if (ink === undefined || ink === ' ') {
    return undefined
  }

  return PALETTE[Number(ink) - 1]
}
