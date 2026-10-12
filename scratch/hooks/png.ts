// A drawing as a PNG, with no library: the environment has no zlib, so the
// image data goes in stored (uncompressed) deflate blocks. Palette-indexed,
// one byte a pixel, so a sketch stays a few hundred kilobytes.

import type { Canvas } from '../types'

// The pad's palette as RGB for a white page: index 0 is the paper, 1-8 the
// pad's colors in order ('text' becomes ink black).
const RGB: readonly (readonly [number, number, number])[] = [
  [255, 255, 255],
  [24, 24, 27],
  [220, 38, 38],
  [202, 138, 4],
  [22, 163, 74],
  [8, 145, 178],
  [37, 99, 235],
  [192, 38, 211],
  [113, 113, 122],
]

const MARGIN_DOTS = 6
const MAX_SIDE_PX = 1200

// Renders the dots of `canvas` (one string per dot row, '1'-'8' inked) as
// round strokes on white, cropped to the drawing; undefined when it is empty.
export function canvasToPng(canvas: Canvas): Uint8Array | undefined {
  let left = Infinity
  let right = -1
  let top = Infinity
  let bottom = -1
  canvas.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== ' ') {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  })
  if (right < 0) {
    return undefined
  }
  left -= MARGIN_DOTS
  top -= MARGIN_DOTS
  const dotsWide = right + MARGIN_DOTS - left + 1
  const dotsTall = bottom + MARGIN_DOTS - top + 1
  const scale = Math.max(2, Math.min(10, Math.floor(MAX_SIDE_PX / Math.max(dotsWide, dotsTall))))
  const width = dotsWide * scale
  const height = dotsTall * scale
  const pixels = new Uint8Array(width * height)
  const inkAt = (x: number, y: number) => Number(canvas[y]?.[x] ?? ' ')
  // Each dot is a round nib, joined to every inked neighbour (across, down and
  // both diagonals) by a stroke as wide: the dots read as one smooth line.
  const radius = scale * 0.55
  const stroke = (x0: number, y0: number, x1: number, y1: number, ink: number) => {
    const [ax, ay, bx, by] = [(x0 - left + 0.5) * scale, (y0 - top + 0.5) * scale, (x1 - left + 0.5) * scale, (y1 - top + 0.5) * scale]
    const length2 = (bx - ax) ** 2 + (by - ay) ** 2
    for (let py = Math.max(0, Math.floor(Math.min(ay, by) - radius)); py < Math.min(height, Math.ceil(Math.max(ay, by) + radius)); py += 1) {
      for (let px = Math.max(0, Math.floor(Math.min(ax, bx) - radius)); px < Math.min(width, Math.ceil(Math.max(ax, bx) + radius)); px += 1) {
        const [cx, cy] = [px + 0.5, py + 0.5]
        const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - ax) * (bx - ax) + (cy - ay) * (by - ay)) / length2))
        if ((cx - ax - t * (bx - ax)) ** 2 + (cy - ay - t * (by - ay)) ** 2 <= radius * radius) {
          pixels[py * width + px] = ink
        }
      }
    }
  }
  canvas.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const ink = inkAt(x, y)
      if (!(ink >= 1 && ink <= 8)) {
        continue
      }
      stroke(x, y, x, y, ink)
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]] as const) {
        // A diagonal already joined through a shared neighbour would only
        // thicken the corner of a staircase.
        const isJoined = dx !== 0 && dy !== 0 && (inkAt(x + dx, y) === ink || inkAt(x, y + dy) === ink)
        if (inkAt(x + dx, y + dy) === ink && !isJoined) {
          stroke(x, y, x + dx, y + dy, ink)
        }
      }
    }
  })

  return encodeIndexed(width, height, pixels)
}

function encodeIndexed(width: number, height: number, pixels: Uint8Array): Uint8Array {
  // Each scanline leads with filter type 0 (none).
  const raw = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 3, 0, 0, 0], 8) // 8-bit, indexed color, deflate, no filter, no interlace

  return concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('PLTE', new Uint8Array(RGB.flat())),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

function zlibStored(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [new Uint8Array([0x78, 0x01])]
  for (let at = 0; at < data.length || at === 0; at += 65_535) {
    const part = data.subarray(at, Math.min(data.length, at + 65_535))
    const isLast = at + 65_535 >= data.length
    const head = new Uint8Array(5)
    head[0] = isLast ? 1 : 0
    head[1] = part.length & 0xff
    head[2] = part.length >> 8
    head[3] = ~part.length & 0xff
    head[4] = (~part.length >> 8) & 0xff
    blocks.push(head, part)
    if (isLast) {
      break
    }
  }
  const sum = new Uint8Array(4)
  new DataView(sum.buffer).setUint32(0, adler32(data))
  blocks.push(sum)

  return concat(blocks)
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i += 1) {
    out[4 + i] = type.charCodeAt(i)
  }
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))

  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }

  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  }

  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65_521
    b = (b + a) % 65_521
  }

  return ((b << 16) | a) >>> 0
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }

  return out
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    const n = (a << 16) | (b << 8) | c
    out += ALPHABET[(n >> 18) & 63]
    out += ALPHABET[(n >> 12) & 63]
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '='
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '='
  }

  return out
}
