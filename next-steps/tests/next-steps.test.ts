import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-13T10:00:00Z')
const HOUR = 3_600_000

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 20,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 19 },
    view: {},
  },
} as const

test('suggests three next prompts, fills the picked one, and shows the usage line', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let filled: string | undefined
  let forks = 0

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine' }) as RenderElement
  })
  on('session.usage', () => ({
    value: {
      startedAt: NOW,
      context: { tokens: 82_100, window: 1_000_000, percent: 8 },
      rateLimits: [
        { kind: 'seven_day', percentUsed: 91, resetsAt: new Date(NOW + 21.5 * HOUR).toISOString() },
        { kind: 'five_hour', percentUsed: 0, resetsAt: new Date(NOW + 4.5 * HOUR).toISOString() },
      ],
      cost: { usd: 0.01 },
    },
  }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.fork', () => {
    forks += 1
    return {
      value: {
        isAnswered: true,
        text: '1. Run the traversal test checklist\n- Commit the pending work\n"Wire in the story slideshow"\nA fourth one',
        usage: { input_tokens: 0, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', ($, e) => {
    filled = e.text
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'do the thing', wait: false, origin: { kind: 'composer' } })
  // A subagent's turn asks for nothing.
  await $.turn.complete({ answer: 'sub', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'a1', reason: 'answer' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  expect(forks).toBe(1)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'next-steps', surface, ...BAND })
    expect((await ui.find({ key: 'pick1' }))?.text).toContain('Run the traversal test checklist')
    expect((await ui.find({ key: 'pick2' }))?.text).toContain('Commit the pending work')
    expect((await ui.find({ key: 'pick3' }))?.text).toContain('Wire in the story slideshow')
    expect(await ui.find({ key: 'pick4' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /91% \(resets 21h30m\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0% \(resets 4h30m\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /82\.1k\/1000\.0k/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', ...BAND })
  await ui.press({ key: 'pick2' })
  expect(filled).toBe('Commit the pending work')
  expect(await ui.find({ key: 'pick1' })).toBeUndefined()
  // The usage line stays once the list is gone.
  expect(await ui.find({ type: 'Text', text: /\$0\.01/ })).toBeDefined()
  await ui.unmount()
})

test('0 dismisses the list, and a new prompt drops a stale answer', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let answer: (text: string) => void = () => {}

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, { key: 'engine' }) as RenderElement
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] } }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.fork', () => {
    return new Promise(resolve => {
      answer = text =>
        resolve({
          value: {
            isAnswered: true,
            text,
            usage: { input_tokens: 0, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          },
        })
    })
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'one', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()
  await $.prompt.submit({ text: 'something else', wait: false, origin: { kind: 'composer' } })
  answer('Stale suggestion')
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'pick1' })).toBeUndefined()
  await ui.unmount()

  await $.turn.complete({ answer: 'two', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.settle()
  answer('Fresh suggestion')
  await clock.settle()

  const again = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', ...BAND })
  expect((await again.find({ key: 'pick1' }))?.text).toContain('Fresh suggestion')
  await again.press({ key: 'dismiss' })
  expect(await again.find({ key: 'pick1' })).toBeUndefined()
  await again.unmount()
})
