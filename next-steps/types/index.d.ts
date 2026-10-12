// The figures of `$.session.usage()` the band draws (the status line's).
export type Usage = {
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  limits: Limit[]
  usd?: number
}

// One rate-limit window: `five_hour`, `seven_day`, or a gateway's.
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// The usage when the person's last prompt went in: the "last prompt"
// figures are the current usage minus this.
export type Baseline = { contextTokens?: number; fiveHour?: number; usd?: number }

declare module 'claude-code' {
  interface PluginState {
    'next-steps': {
      suggestions: string[]
      isLoading: boolean
      usage: Usage | null
      baseline: Baseline | null
      tick: number
    }
  }
}
