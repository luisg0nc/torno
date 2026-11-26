import { describe, expect, it } from 'vitest'
import type { Usage, UsageRow } from '../../../shared/usage'
import { buckets, byPictures, conversationsOf, daySpan, ledgerLead, pageLead, rowsIn } from './usagePage'

const day = (d: number, h = 12): number => new Date(2026, 10, d, h).getTime()
const used = (costUsd: number | undefined, over: Partial<Usage> = {}): Usage => ({ input: 0, output: 100, cacheRead: 9600, cacheCreation: 300, requests: 4, ...(costUsd !== undefined ? { costUsd } : {}), ...over })
let n = 0
function row(conversation: string, at: number, usage: Usage | undefined, over: Partial<UsageRow> = {}): UsageRow {
  n += 1
  return { conversation, id: `p${n}`, number: n, text: `prompt ${n}`, at, turns: usage ? [`t${n}`] : [], facts: { pictures: {}, builds: { count: 0 } }, ...(usage ? { usage } : {}), ...over }
}

describe('rowsIn', () => {
  it('keeps the last 7 days for the week, 30 for the month, all for all, counted from today', () => {
    const rows = [row('a', new Date(2026, 9, 20).getTime(), used(1)), row('a', day(10), used(1)), row('a', day(20), used(1)), row('a', day(26), used(1))]
    const now = day(26, 18)
    expect(rowsIn(rows, 'week', now).map((r) => r.at)).toEqual([day(20), day(26)])
    expect(rowsIn(rows, 'month', now)).toHaveLength(3)
    expect(rowsIn(rows, 'all', now)).toHaveLength(4)
  })
})

describe('pageLead', () => {
  it('says the cost, the prompts and conversations, and the share read again', () => {
    const rows = [row('a', day(20), used(1)), row('b', day(21), used(3)), row('t', day(22), undefined, { terminal: true })]
    const lead = pageLead(rows, 'week')
    expect(lead.head).toBe('$4.00 over 3 prompts in 3 conversations. 96 % of the tokens were the conversation read again.')
    expect(lead.more).toBe(`Prompt ${rows[1].number} took 75 % of the week: 4 calls. 1 prompt in a terminal has no cost to count.`)
  })

  it('says the first turns after a resume have no cost to count, and nothing of a top prompt that is not a large share', () => {
    const rows = [row('a', day(20), used(1)), row('a', day(20), used(1)), row('a', day(20), used(1)), row('a', day(21), used(undefined), { resumed: true })]
    expect(pageLead(rows, 'all').more).toBe('1 first turn after a resume has no cost to count.')
  })

  it('says there is nothing to count when no turn said what it took', () => {
    expect(pageLead([], 'week').head).toBe('No turn of Claude Code in the week.')
  })
})

describe('buckets', () => {
  it('gives the 7 days of a week, each with its cost and what is not known', () => {
    const rows = [row('a', day(20), used(1)), row('a', day(20, 15), used(2)), row('t', day(24), undefined, { terminal: true }), row('a', day(26), used(undefined), { resumed: true })]
    const days = buckets(rows, 'week', day(26, 18))
    expect(days).toHaveLength(7)
    expect(days[0]).toMatchObject({ cost: 3, unknown: 0, top: 'Fri', bottom: '20' })
    expect(days[4]).toMatchObject({ cost: 0, unknown: 1 })
    expect(days[6]).toMatchObject({ cost: 0, unknown: 1, top: 'Thu', bottom: '26' })
  })

  it('gives weeks for all of a project longer than a month', () => {
    const rows = [row('a', new Date(2026, 7, 3).getTime(), used(1)), row('a', day(26), used(2))]
    const weeks = buckets(rows, 'all', day(26, 18))
    expect(weeks.length).toBeGreaterThan(10)
    expect(weeks.reduce((s, w) => s + w.cost, 0)).toBe(3)
  })
})

describe('byPictures', () => {
  it('counts each turn whole under the pictures it had, with its share of the cost', () => {
    const pics = (k: number) => ({ facts: { pictures: { look: k }, builds: { count: 0 } } })
    const rows = [row('a', day(20), used(6), pics(14)), row('a', day(20), used(1), pics(3)), row('a', day(20), used(1), pics(0)), row('a', day(20), used(undefined), pics(1))]
    expect(byPictures(rows)).toEqual([
      { label: 'With 5 or more pictures', turns: 1, calls: 4, cost: 6, share: 0.75 },
      { label: 'With 2 to 4 pictures', turns: 1, calls: 4, cost: 1, share: 0.125 },
      { label: 'With 1 picture or none', turns: 1, calls: 4, cost: 1, share: 0.125 }
    ])
  })
})

describe('conversationsOf', () => {
  it('gives each conversation its prompts, calls, pictures and cost, newest last, with what is not known', () => {
    const rows = [row('a', day(20), used(1), { facts: { pictures: { look: 2 }, builds: { count: 0 } } }), row('t', day(22), undefined, { terminal: true }), row('a', day(21), used(undefined), { resumed: true })]
    const [a, t] = conversationsOf(rows)
    expect(a).toMatchObject({ id: 'a', name: rows[0].text, prompts: 2, calls: 8, pictures: 2, cost: 1, unknown: 1, resumed: true, terminal: false, from: day(20), to: day(21) })
    expect(a.costs).toEqual([1, null])
    expect(t).toMatchObject({ id: 't', terminal: true, prompts: 1 })
  })
})

describe('daySpan', () => {
  it('says two days of a month, of two months, and one day', () => {
    expect(daySpan(day(20), day(26))).toBe('20 to 26 Nov')
    expect(daySpan(new Date(2026, 9, 28).getTime(), day(3))).toBe('28 Oct to 3 Nov')
    expect(daySpan(day(26, 9), day(26, 18))).toBe('26 Nov')
  })
})

describe('ledgerLead', () => {
  it('says the cost of a conversation, its prompts and calls, and the turns of unknown cost', () => {
    const rows = [row('a', day(20), used(10.8)), row('a', day(21), used(undefined), { resumed: true })]
    expect(ledgerLead(conversationsOf(rows)[0]!)).toBe('$10.80 for 2 prompts and 8 calls, with 1 turn of unknown cost.')
  })
})
