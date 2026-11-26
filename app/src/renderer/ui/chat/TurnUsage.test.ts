import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TurnUsageLine } from './TurnUsage'

const text = (html: string): string => html.replace(/<[^>]+>/g, '').replaceAll('&#x27;', "'")

describe('TurnUsageLine', () => {
  it('says what the turn took under its end, the cost first', () => {
    const html = renderToStaticMarkup(createElement(TurnUsageLine, { usage: { input: 200, output: 6300, cacheRead: 742_000, cacheCreation: 14_000, requests: 8, costUsd: 0.64 } }))
    expect(text(html)).toContain('$0.64 for 8 calls: 742 k of context read again, 14.2 k new to it, 6.3 k written.')
    expect(html).toContain('chat-turn-cost')
  })

  it('says the cost of the first turn after a resume is not known, and why, once', () => {
    const html = renderToStaticMarkup(createElement(TurnUsageLine, { usage: { input: 0, output: 5200, cacheRead: 1_150_000, cacheCreation: 183_000, requests: 7 } }))
    expect(text(html)).toContain('Cost not known for this turn. 7 calls: 1.15 M of context read again')
    expect(text(html)).toContain("Claude Code counts a resumed conversation's cost together")
  })

  it('draws nothing for a turn the CLI counted nothing for', () => {
    expect(renderToStaticMarkup(createElement(TurnUsageLine, { usage: undefined }))).toBe('')
  })
})
