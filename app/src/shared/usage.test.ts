import { describe, expect, it } from 'vitest'
import type { ChatItem, TurnUsage } from './chat'
import { addUsage, largeTimes, medianCost, usageFacts, usageLine, whyLarge, type UsageRow } from './usage'

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

describe("a build under a tool's card that was the person's alone", () => {
  it('is none of the turn (#384)', () => {
    const theirs = { ...build('b2', 36, 'ok'), byPerson: true } as ChatItem
    expect(usageFacts([build('b1', 34, 'ok'), theirs]).builds).toEqual({ count: 1, to: 34 })
    expect(usageFacts([theirs]).builds).toEqual({ count: 0 })
  })
})

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

describe('largeTimes', () => {
  it('is how many times the usual turn a turn cost, from 3 times on', () => {
    expect(largeTimes(7.05, 15, 0.95)).toBeCloseTo(7.42, 2)
    expect(largeTimes(3, 15, 1)).toBe(3)
    expect(largeTimes(2.9, 15, 1)).toBeNull()
  })

  it('is never within the project\'s first 3 prompts', () => {
    expect(largeTimes(10, 3, 1)).toBeNull()
    expect(largeTimes(10, 4, 1)).toBe(10)
  })

  it('is null with no cost, no number or no usual turn to measure against', () => {
    expect(largeTimes(undefined, 9, 1)).toBeNull()
    expect(largeTimes(10, undefined, 1)).toBeNull()
    expect(largeTimes(10, 9, undefined)).toBeNull()
    expect(largeTimes(10, 9, 0)).toBeNull()
  })
})

describe('whyLarge', () => {
  const usage = { input: 0, output: 31_400, cacheRead: 9_860_000, cacheCreation: 212_000, requests: 62, costUsd: 7.05 }
  it('says the calls and the context each read, the pictures and where from, and the builds, as facts', () => {
    const why = whyLarge(usage, { pictures: { look: 13, section: 1 }, builds: { count: 3, from: 33, to: 36 } }, 7.42)
    expect(why.head).toBe("Why this turn was large: 7.4 × this project's usual turn")
    expect(why.lines).toEqual([
      '62 calls, and each read the whole conversation again: 159 k a call on average, 9.86 M in all.',
      '14 pictures came in on the way, 13 from look and 1 from section. A picture stays in the conversation, so every call after it reads it too.',
      '3 builds ran, r33 to r36.'
    ])
  })

  it('says one picture and one build, and leaves out what there was none of', () => {
    expect(whyLarge(usage, { pictures: { you: 1 }, builds: { count: 1, to: 4 } }, 3).lines.slice(1)).toEqual(['1 picture came in on the way, from you. A picture stays in the conversation, so every call after it reads it too.', '1 build ran, r4.'])
    expect(whyLarge(usage, { pictures: {}, builds: { count: 0 } }, 3).lines).toHaveLength(1)
    expect(whyLarge(usage, { pictures: { look: 4 }, builds: { count: 0 } }, 3).lines[1]).toMatch(/^4 pictures came in on the way, all from look\./)
  })
})
