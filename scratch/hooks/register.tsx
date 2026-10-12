import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Canvas } from '../types'
import { canvasToPng, toBase64 } from './png'

const PANE = 'scratch'
// 'dots': the braille canvas (the first, half-block one was 'canvas').
const STORE_KEY = 'dots'
// Where "→ prompt" writes the sketch for Claude to read, under $HOME.
const SKETCH_DIR = '.claude/scratch'
const rev = atom({ plugin: 'scratch', key: 'rev' } as const, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'scratch',
      description: 'Open the drawing pad, mouse and keys already in it (/scratch clear wipes it)',
      argumentHint: '[clear]',
      immediate: true,
    })

    return started
  })

  on('command.run', { command: 'scratch' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await $.store.set(STORE_KEY, [])
      await update($, rev, n => n + 1)

      return { text: 'Scratch pad cleared.' }
    }
    // `focus` plus moving the ring onto the canvas is what spares the click:
    // the pad takes the keys and the first drag draws.
    await $.ui.open({ id: PANE, title: 'Scratch', focus: true, rows: 22 })
    try {
      await $.ui.focus({ requestId: PANE, key: 'canvas' })
    } catch {
      // The pane opened without the keys (text in the composer): a click still draws.
    }

    return {}
  })

  // The pad posts its canvas at the end of every stroke, undo and clear.
  on('ui.message', { requestId: PANE, element: 'canvas' }, async ($, e, next) => {
    const canvas = asCanvas(e.data)
    if (canvas !== undefined) {
      await $.store.set(STORE_KEY, canvas)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>The scratch pad draws in the terminal and the desktop app.</Text>
    }
    const { Box, Button, Client, Text } = $.ui.resolve(e)
    const canvas = await loadCanvas($)
    const version = await read($, rev)
    const height = Math.max(4, e.props.scroll.bodyRows - 2)

    const toPrompt = async () => {
      const path = await saveSketch($, await loadCanvas($))
      if (path === undefined) {
        $.ui.toast('Nothing drawn yet.')

        return
      }
      // The @ mention hands Claude the picture itself; the path alone would
      // still let it open the file.
      const box = await $.prompt.read()
      await $.prompt.fill(box.text.trim() === '' ? { text: `@${path} ` } : { text: ` @${path} `, mode: 'append' })
    }

    return (
      <Box flexDirection="column">
        <Client key="canvas" module="./pad.tsx" props={{ canvas, rev: version }} width={e.props.bodyColumns} height={height} />
        <Box flexDirection="row" gap={1}>
          <Button key="to-prompt" label="→ prompt" onPress={() => void toPrompt()} />
          <Text dimColor wrap="truncate-end">
            drag draw · right-drag erase · 1-8 color · e eraser · +/- size · u undo · c clear · esc prompt
          </Text>
        </Box>
      </Box>
    )
  })
}

async function loadCanvas($: EngineInterface): Promise<Canvas> {
  return asCanvas(await $.store.get(STORE_KEY)) ?? []
}

// Writes the drawing as a PNG under ~/.claude/scratch and answers its path:
// $.fs writes text only, so the bytes go through `base64 -d` on stdin.
async function saveSketch($: EngineInterface, canvas: Canvas): Promise<string | undefined> {
  const png = canvasToPng(canvas)
  const home = await $.env.get('HOME')
  if (png === undefined || home === undefined) {
    return undefined
  }
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  const path = `${home}/${SKETCH_DIR}/sketch-${stamp}.png`
  const written = await $.process.run(
    ['/bin/sh', '-c', 'mkdir -p "$(dirname "$1")" && base64 -d > "$1"', 'sh', path],
    { stdin: toBase64(png) },
  )
  if (written.exitCode !== 0) {
    $.ui.toast(`Could not write the sketch: ${written.stderr.trim().slice(0, 200)}`)

    return undefined
  }

  return path
}

function asCanvas(value: unknown): Canvas | undefined {
  if (typeof value === 'object' && value !== null && 'canvas' in value) {
    return asCanvas(value.canvas)
  }
  if (!Array.isArray(value) || !value.every(row => typeof row === 'string')) {
    return undefined
  }

  return value.slice(0, 1000).map(row => row.slice(0, 2000))
}

