import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Baseline, Limit, Usage } from '../types'

const suggestions = atom({ plugin: 'next-steps', key: 'suggestions' } as const, [])
const isLoading = atom({ plugin: 'next-steps', key: 'isLoading' } as const, false)
const usage = atom({ plugin: 'next-steps', key: 'usage' } as const, null)
const baseline = atom({ plugin: 'next-steps', key: 'baseline' } as const, null)
const tick = atom({ plugin: 'next-steps', key: 'tick' } as const, 0)

// Asked over the session's own transcript ($.model.fork), so the prefix comes
// from the prompt cache: each turn costs a cache read plus a few output tokens.
const ASK = [
  'Without using any tools and without doing any of the work, suggest the 3 most useful prompts I could send you next in this conversation.',
  'Write each one as I would type it: imperative, specific to this work, at most 70 characters, in the language I have been writing in.',
  'Answer with exactly 3 lines, one prompt per line, and nothing else: no numbering, no quotes, no preamble.',
].join(' ')

const BAR_CELLS = 10

// Bumped by every prompt: a fork that answers after a newer prompt went in
// is stale and dropped.
let generation = 0

export const register: Register = on => {
  const measure = (u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Usage => ({
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    contextPercent: u.context.percent,
    limits: u.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
    usd: u.cost?.usd,
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const now = await $.session.usage()
    await update($, usage, () => measure(now))
    // Redraws the "resets in" countdowns once a minute.
    $.clock.every(60_000, () => void update($, tick, n => n + 1))

    return started
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => measure(e))

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    generation += 1
    await update($, suggestions, () => [])
    await update($, isLoading, () => false)
    // A prompt typed over a running turn folds into it: the baseline stays
    // the one its turn started from.
    if (e.turnId === undefined) {
      const now = await read($, usage)
      const base: Baseline = {
        contextTokens: now?.contextTokens,
        fiveHour: limit(now, 'five_hour')?.percentUsed,
        usd: now?.usd,
      }
      await update($, baseline, () => base)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const isMainAnswer = e.agentId === undefined && e.reason === 'answer' && e.answer !== ''
    if (isMainAnswer) {
      void suggest($, generation)
    }

    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const list = await read($, suggestions)
    const isThinking = await read($, isLoading)
    const now = await read($, usage)
    const base = await read($, baseline)
    await read($, tick)
    const showsList = !e.props.isWorking && (list.length > 0 || isThinking)
    if (!showsList && now === null) {
      return next(e)
    }
    const at = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)

    const pick = async (text: string) => {
      const box = await $.prompt.read()
      const isEmpty = box.text.trim() === ''
      await $.prompt.fill(isEmpty ? { text } : { text: `\n${text}`, mode: 'append' })
      await update($, suggestions, () => [])
    }
    const dismiss = () => update($, suggestions, () => [])

    const sep = () => <Text dimColor> · </Text>
    const bar = (one: Limit | undefined, label: string) => {
      if (one === undefined) {
        return null
      }
      const filled = Math.min(BAR_CELLS, Math.round((one.percentUsed / 100) * BAR_CELLS))
      const color = levelColor(one.percentUsed)
      const left = one.resetsAt === undefined ? '' : untilText(Date.parse(one.resetsAt) - at)

      return (
        <Text>
          {sep()}
          <Text dimColor>{label} </Text>
          <Text color={color}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(BAR_CELLS - filled)}</Text>
          <Text color={color}>
            {' '}
            {formatPercent(one.percentUsed)}
            {left === '' ? '' : ` (resets ${left})`}
          </Text>
        </Text>
      )
    }

    const usageLine = () => {
      if (now === null) {
        return null
      }
      const ctxPercent = now.contextPercent ?? 0
      const added =
        now.contextTokens !== undefined && base?.contextTokens !== undefined
          ? now.contextTokens - base.contextTokens
          : undefined
      const fiveHour = limit(now, 'five_hour')?.percentUsed
      const spent = now.usd !== undefined && base?.usd !== undefined ? now.usd - base.usd : undefined
      const fiveHourAdded =
        fiveHour !== undefined && base?.fiveHour !== undefined ? fiveHour - base.fiveHour : undefined
      const last = [
        added !== undefined && added >= 0 ? `+${kilo(added)}` : undefined,
        fiveHourAdded !== undefined ? `+${formatPercent(Math.max(0, fiveHourAdded))}` : undefined,
        spent !== undefined ? `+$${spent.toFixed(2)}` : undefined,
      ].filter(part => part !== undefined)
      // While the turn runs the figures have not moved yet.
      const hasLast = !e.props.isWorking && base !== null && last.length > 0

      return (
        <Text wrap="wrap">
          {now.usd !== undefined && <Text color="success">${now.usd.toFixed(2)}</Text>}
          {now.usd !== undefined && sep()}
          <Text dimColor>ctx </Text>
          <Text>
            {now.contextTokens === undefined ? '–' : kilo(now.contextTokens)}/{kilo(now.contextWindow)}
          </Text>
          <Text color={levelColor(ctxPercent)}> ({formatPercent(ctxPercent)})</Text>
          {bar(limit(now, 'seven_day'), '7d')}
          {bar(limit(now, 'five_hour'), '5h')}
          {hasLast && sep()}
          {hasLast && <Text color="success">{last.join(' ')}</Text>}
          {hasLast && <Text dimColor> (last prompt)</Text>}
        </Text>
      )
    }

    return (
      <Box flexDirection="column">
        {showsList && <Text dimColor>next:</Text>}
        {showsList && isThinking && list.length === 0 && (
          <Box paddingLeft={2}>
            <Text dimColor>thinking of next steps…</Text>
          </Box>
        )}
        {showsList &&
          list.map((text, i) => (
            <Box key={`row${i + 1}`} paddingLeft={2}>
              <Button key={`pick${i + 1}`} plain hotkey={String(i + 1)} label={text} onPress={() => void pick(text)} />
            </Box>
          ))}
        {showsList && list.length > 0 && (
          <Box paddingLeft={2}>
            <Button key="dismiss" plain dimColor hotkey="0" label="dismiss" role="dismiss" onPress={() => void dismiss()} />
          </Box>
        )}
        {usageLine()}
      </Box>
    )
  })
}

async function suggest($: EngineInterface, mine: number) {
  await update($, isLoading, () => true)
  try {
    const reply = await $.model.fork({ prompt: ASK })
    if (generation === mine) {
      await update($, suggestions, () => (reply.isAnswered ? parse(reply.text) : []))
    }
  } finally {
    if (generation === mine) {
      await update($, isLoading, () => false)
    }
  }
}

const limit = (u: Usage | null, kind: string): Limit | undefined => u?.limits.find(one => one.kind === kind)

// One prompt per line, numbering, bullets and quotes stripped, at most three.
const parse = (text: string): string[] =>
  text
    .split('\n')
    .map(line =>
      line
        .trim()
        .replace(/^(?:[-*•]|\d+[.):]|\[\d+\])\s*/, '')
        .replace(/^["'`“”]+|["'`“”]+$/g, '')
        .trim(),
    )
    .filter(line => line !== '')
    .slice(0, 3)

const kilo = (tokens: number) => `${(tokens / 1000).toFixed(1)}k`

const formatPercent = (n: number) => `${Math.round(n)}%`

const levelColor = (percent: number) => (percent >= 90 ? 'error' : percent >= 60 ? 'warning' : 'success')

const untilText = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'now'
  }
  const minutes = Math.round(ms / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const rest = minutes % 60
  if (days > 0) {
    return `${days}d${hours}h`
  }

  return hours > 0 ? `${hours}h${rest}m` : `${rest}m`
}
