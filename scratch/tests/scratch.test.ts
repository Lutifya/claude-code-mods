import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// $.store in memory, readable by the test.
const memoryStore = (on: On, entries: Record<string, unknown> = {}) => {
  const kept = new Map(Object.entries(entries))
  on('store.get', ($, e) => ({ value: kept.get(e.key) }))
  on('store.set', ($, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })

  return kept
}

const PANE = {
  component: 'Pane',
  requestId: 'scratch',
  props: {
    title: 'Scratch',
    isFocused: true,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
} as const

const PRESENTATION = { isFullscreen: true, columns: 120 }
const NOW = Date.parse('2026-10-13T10:00:00Z')

// Moving the focus ring onto the canvas is the live surface's to do (the kit
// has no ring): the command asks for it and goes on whatever the answer.
test('/scratch opens the pad asking for the keys', async ($, on) => {
  memoryStore(on)
  const opened: unknown[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  // The pane as the surface shows it once opened, so the canvas is there to focus.
  const ui = await $.ui.mount({ plugin: 'scratch', surface: 'terminal', ...PANE })
  const ran = await $.command.run({ command: 'scratch', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION })
  await ui.unmount()

  expect(opened).toEqual([expect.objectContaining({ id: 'scratch', focus: true })])
  expect(ran.text).toBeUndefined()
})

test('a mouse drag draws in braille dots, the toolbar clears, u undoes, and the sketch reaches the prompt as a PNG', async ($, on) => {
  mock.clock(on, { now: NOW })
  const store = memoryStore(on)
  let filled = ''
  let written: { argv: readonly string[]; stdin?: string } | undefined
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    filled = e.text
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('env.get', () => ({ value: '/home/me' }))
  on('process.run', ($, e) => {
    written = { argv: e.argv, stdin: e.init?.stdin }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    store.set('dots', [])
    const ui = await $.ui.mount({ plugin: 'scratch', surface, ...PANE })
    await ui.resize({ columns: 60, rows: 10, in: 'canvas' })

    // Row 0 is the toolbar. Cell (5, 3) is dot (10, 9): two dots across, four
    // down, the pen at the cell's middle row where no sub-cell position comes.
    await ui.pointer({ type: 'down', x: 5, y: 3, button: 'left', in: 'canvas' })
    await ui.pointer({ type: 'move', x: 10, y: 3, button: 'left', in: 'canvas' })
    await ui.pointer({ type: 'up', x: 10, y: 3, button: 'left', in: 'canvas' })
    expect((store.get('dots') as string[])[9]).toBe(`${' '.repeat(10)}${'1'.repeat(11)}`)
    expect(await ui.find({ in: 'canvas', type: 'Text', text: /^ {5}⠒{5}⠂ *$/ })).toBeDefined()

    // A right-drag erases with a nib a dot wider.
    await ui.pointer({ type: 'down', x: 10, y: 3, button: 'right', in: 'canvas' })
    await ui.pointer({ type: 'up', x: 10, y: 3, button: 'right', in: 'canvas' })
    expect((store.get('dots') as string[])[9]).toBe(`${' '.repeat(10)}${'1'.repeat(9)}`)

    // Key 3 picks yellow. (The kit hands no sub-cell `fine` position, so a
    // click lands on its cell's middle here as in tmux.)
    await ui.key({ key: '3', in: 'canvas' })
    await ui.pointer({ type: 'down', x: 20, y: 5, button: 'left', in: 'canvas' })
    await ui.pointer({ type: 'up', x: 20, y: 5, button: 'left', in: 'canvas' })
    expect((store.get('dots') as string[])[17]).toBe(`${' '.repeat(40)}3`)

    const clearAt = 8 * 3 + ' erase '.length + ' -'.length + '1'.length + '+ '.length + 'undo '.length
    await ui.pointer({ type: 'down', x: clearAt + 1, y: 0, button: 'left', in: 'canvas' })
    await ui.pointer({ type: 'up', x: clearAt + 1, y: 0, button: 'left', in: 'canvas' })
    expect(store.get('dots')).toEqual([])
    await ui.key({ key: 'u', in: 'canvas' })
    expect((store.get('dots') as string[])[17]).toBe(`${' '.repeat(40)}3`)

    await ui.press({ key: 'to-prompt' })
    const path = '/home/me/.claude/scratch/sketch-2026-10-13T10-00-00-000Z.png'
    expect(filled).toBe(`@${path} `)
    expect(written?.argv.at(-1)).toBe(path)
    // Sketches older than a week go as the new one is written.
    expect(written?.argv[2]).toContain(`find "$dir" -name 'sketch-*.png' -mmin +10080 -delete`)
    // A PNG of the drawing cropped with a margin: dots 10-40 by 9-17 plus six
    // a side, ten pixels a dot, so 430 by 210.
    expect(written?.stdin?.slice(0, 32)).toBe('iVBORw0KGgoAAAANSUhEUgAAAa4AAADS')
    await ui.unmount()
  }
})

test('/scratch clear wipes the pad on screen', async ($, on) => {
  memoryStore(on, { dots: ['', '', '', '', '  11', '  11', '  11', '  11'] })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'scratch', surface: 'terminal', ...PANE })
  await ui.resize({ columns: 60, rows: 10, in: 'canvas' })
  expect(await ui.find({ in: 'canvas', type: 'Text', text: /^ ⣿ *$/ })).toBeDefined()

  const ran = await $.command.run({ command: 'scratch', args: 'clear', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(ran.text).toBe('Scratch pad cleared.')
  expect(await ui.find({ in: 'canvas', type: 'Text', text: /^ ⣿ *$/ })).toBeUndefined()
  await ui.unmount()
})
