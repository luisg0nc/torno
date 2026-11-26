import { describe, expect, it } from 'vitest'
import type { ChatItem, TurnUsage } from './chat'
import { addUsage, medianCost, usageFacts, usageLine, type UsageRow } from './usage'

const user = (id: string, images = 0): ChatItem => ({ kind: 'user', id, text: 'x', images: Array.from({ length: images }, (_, i) => ({ id: `${id}-i${i}`, mediaType: 'image/png' })), state: 'sent', at: 1 })
const tool = (id: string, name: string, images = 0, state: 'done' | 'error' = 'done'): ChatItem => ({ kind: 'tool', id, toolUseId: id, name, torno: name.startsWith('mcp__torno__'), input: {}, state, images: Array.from({ length: images }, (_, i) => ({ id: `${id}-i${i}`, mediaType: 'image/png' })) })
const sent = (forUser: string, revision: number): ChatItem => ({ kind: 'context', id: `c-${forUser}`, forUser, text: '', marks: [], revision })
const build = (id: string, revision: number | undefined, buildState: 'ok' | 'failed'): ChatItem => ({ kind: 'context', id, forUser: 't', forTool: true, text: '', marks: [], buildState, ...(revision !== undefined ? { revision } : {}) })

describe('usageFacts', () => {
  it('counts the pictures that came into the conversation, by the tool that brought them, and the person as you', () => {
    const facts = usageFacts([user('u', 1), tool('a', 'mcp__torno__look', 2), tool('b', 'mcp__torno__look', 1), tool('c', 'mcp__torno__section', 1), tool('d', 'Read', 0)])
    expect(facts.pictures).toEqual({ you: 1, look: 3, section: 1 })
  })

  it('says how many builds ran, from the build on show when the prompt was sent to the last that worked', () => {
    const facts = usageFacts([user('u'), sent('u', 33), build('b1', 34, 'ok'), build('b2', undefined, 'failed'), build('b3', 36, 'ok')])
    expect(facts.builds).toEqual({ count: 3, from: 33, to: 36 })
  })

  it('says no builds for a turn that started none', () => {
    expect(usageFacts([user('u'), sent('u', 2)]).builds).toEqual({ count: 0 })
  })
})

const u = (over: Partial<TurnUsage> = {}): TurnUsage => ({ input: 1, output: 10, cacheRead: 100, cacheCreation: 20, requests: 2, costUsd: 0.5, ...over })

describe('addUsage', () => {
  it('sums the tokens, the calls and the cost of two turns of one prompt', () => {
    expect(addUsage(u(), u({ costUsd: 0.25 }))).toEqual({ input: 2, output: 20, cacheRead: 200, cacheCreation: 40, requests: 4, costUsd: 0.75 })
  })

  it('leaves the cost unknown when one of the turns has none', () => {
    expect(addUsage(u(), u({ costUsd: undefined }))).not.toHaveProperty('costUsd')
  })
})

const row = (number: number, costUsd?: number): UsageRow => ({ conversation: 'c', id: `p${number}`, number, text: '', at: number, turns: [], facts: { pictures: {}, builds: { count: 0 } }, ...(costUsd !== undefined ? { usage: { ...u(), costUsd } } : {}) })

describe('medianCost', () => {
  it('is the middle cost of the prompts whose cost is known', () => {
    expect(medianCost([row(1, 1), row(2, 3), row(3, 2), row(4)])).toBe(2)
  })

  it('is the mean of the two middle ones of an even count', () => {
    expect(medianCost([row(1, 1), row(2, 2), row(3, 4), row(4, 10)])).toBe(3)
  })

  it('is undefined with no cost known', () => {
    expect(medianCost([row(1), { ...row(2), usage: { ...u(), costUsd: undefined } }])).toBeUndefined()
  })
})

describe('usageLine', () => {
  it('says the cost first, then the calls and the three kinds of token', () => {
    expect(usageLine({ input: 200, output: 6300, cacheRead: 742_000, cacheCreation: 14_000, requests: 8, costUsd: 0.64 })).toEqual({ lead: '$0.64', rest: ' for 8 calls: 742 k of context read again, 14.2 k new to it, 6.3 k written.', known: true })
  })

  it('says one call', () => {
    expect(usageLine({ input: 0, output: 10, cacheRead: 100, cacheCreation: 0, requests: 1, costUsd: 0.01 })?.rest).toBe(' for 1 call: 100 of context read again, 0 new to it, 10 written.')
  })

  it('says the cost is not known for the first turn after a resume, with its tokens', () => {
    expect(usageLine({ input: 0, output: 5200, cacheRead: 1_150_000, cacheCreation: 183_000, requests: 7 })).toEqual({ lead: 'Cost not known for this turn.', rest: ' 7 calls: 1.15 M of context read again, 183 k new to it, 5.2 k written.', known: false })
  })

  it('says nothing for a turn the CLI counted nothing for', () => {
    expect(usageLine(undefined)).toBeNull()
    expect(usageLine({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, requests: 0, costUsd: 0 })).toBeNull()
  })
})
