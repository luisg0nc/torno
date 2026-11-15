import { describe, expect, it } from 'vitest'
import type { ChatItem, PromptRow } from '../../../shared/chat'
import type { HistoryEntry } from '../../../shared/history'
import { goneBack, joinTurns, numbersOf, savesBetween, saveWords, stripOf, turnFacts } from './historyJoin'

const user = (id: string, at: number, state: 'sent' | 'queued' = 'sent'): ChatItem => ({ kind: 'user', id, text: id, images: [], state, at })
const turn = (id: string): ChatItem => ({ kind: 'turn', id, ok: true, stopped: false, seconds: 1, pulled: {} })
const text = (id: string): ChatItem => ({ kind: 'text', id, text: 'hi', streaming: false })

let n = 0
const entry = (id: string, at: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  at,
  run: 'run1',
  revision: ++n,
  sources: `s${n}`,
  model: 'm.py',
  files: ['m/m.py'],
  parts: 1,
  seconds: 1,
  line: 'tub changed',
  ...extra
})
const agent = (id: string, at: string, prompt: string, extra: Partial<HistoryEntry> = {}) => entry(id, at, { cause: 'agent', turn: { prompt }, ...extra })
const person = (id: string, at: string, extra: Partial<HistoryEntry> = {}) => entry(id, at, { cause: 'person', ...extra })

describe('numbersOf', () => {
  const row = (id: string, number: number): PromptRow => ({ conversation: 'c', id, number, text: id, at: number })
  it('gives a prompt the number the project\'s list has for it, whatever conversation it is of', () => {
    const items = [user('u1', 1), text('t'), turn('x1'), user('u2', 2), turn('x2')]
    expect([...numbersOf([row('old', 1), row('u1', 2), row('u2', 3)], items)]).toEqual([['old', 1], ['u1', 2], ['u2', 3]])
  })
  it('numbers on from the list\'s last the prompts of the transcript it has not heard of yet, queued ones too, in the order they were made', () => {
    const items = [user('u1', 1), user('u2', 2), user('u3', 3, 'queued')]
    expect([...numbersOf([row('u1', 7)], items)]).toEqual([['u1', 7], ['u2', 8], ['u3', 9]])
    expect([...numbersOf([], items)]).toEqual([['u1', 1], ['u2', 2], ['u3', 3]])
  })
})

describe('joinTurns', () => {
  const items = [user('u1', 1), text('a'), turn('x1'), user('u2', 2), turn('x2'), user('u3', 3), turn('x3')]
  const numbering = numbersOf([], items)
  const entries = [
    person('h1', '2026-01-01T00:00:00Z'),
    agent('h2', '2026-01-01T00:01:00Z', 'u1'),
    agent('h3', '2026-01-01T00:02:00Z', 'u1'),
    entry('h4', '2026-01-01T00:03:00Z'),
    agent('h5', '2026-01-01T00:04:00Z', 'u3', { failed: true })
  ]

  it('gives each turn the entries that name its prompt, the number of the prompt and the build it began from', () => {
    const joined = joinTurns(items, entries, numbering)
    expect(joined.get('x1')).toMatchObject({ promptId: 'u1', number: 1, from: { id: 'h1' } })
    expect(joined.get('x1')!.entries.map((e) => e.id)).toEqual(['h2', 'h3'])
  })

  it('has a turn that built nothing too, with no entries and no earlier build to start from but the newest', () => {
    const joined = joinTurns(items, entries, numbering)
    expect(joined.get('x2')).toMatchObject({ promptId: 'u2', number: 2, entries: [] })
  })

  it('leaves out an entry that says nothing of its turn, and takes the newest build that can be drawn as the start, not a failed one', () => {
    const joined = joinTurns(items, entries, numbering)
    expect(joined.get('x3')!.entries.map((e) => e.id)).toEqual(['h5'])
    // before h5 the newest drawable is h4 (cause unknown), which belongs to no turn.
    expect(joined.get('x3')!.from?.id).toBe('h4')
    expect([...joined.values()].flatMap((j) => j.entries).some((e) => e.id === 'h4')).toBe(false)
  })

  it('joins a prompt to its own turn when another prompt was queued meanwhile and is drawn at the end', () => {
    const queued = [user('u1', 1), text('a'), turn('x1'), user('u2', 2, 'queued')]
    const joined = joinTurns(queued, [agent('h1', '2026-01-01T00:00:00Z', 'u1')], numbersOf([], queued))
    expect([...joined.keys()]).toEqual(['x1'])
    expect(joined.get('x1')!.entries).toHaveLength(1)
  })
})

describe('goneBack', () => {
  it('names the prompts whose builds a Go back undid, and not one with a build that stands', () => {
    const entries = [agent('h1', '2026-01-01T00:00:00Z', 'u1'), agent('h2', '2026-01-01T00:01:00Z', 'u2', { undone: true }), agent('h3', '2026-01-01T00:02:00Z', 'u3', { undone: true }), agent('h4', '2026-01-01T00:03:00Z', 'u3')]
    expect([...goneBack(entries)]).toEqual(['u2'])
  })
})

describe('savesBetween', () => {
  const entries = [
    agent('h1', '2026-01-01T00:00:10Z', 'u1'),
    person('h2', '2026-01-01T00:01:00Z'),
    person('h3', '2026-01-01T00:02:00Z', { files: ['common/f.py'] }),
    person('h4', '2026-01-01T00:03:00Z'),
    entry('h5', '2026-01-01T00:03:30Z', { cause: 'params', tried: ['wall'] }),
    person('h6', '2026-01-01T00:04:00Z'),
    agent('h7', '2026-01-01T00:04:30Z', 'u2'),
    person('h8', '2026-01-01T00:05:00Z')
  ]

  it('folds three saves in a row into one run, and keeps params apart from saves', () => {
    const runs = savesBetween(entries, '2026-01-01T00:00:30Z', '2026-01-01T00:04:10Z')
    expect(runs.map((r) => [r.cause, r.entries.map((e) => e.id)])).toEqual([['person', ['h2', 'h3', 'h4']], ['params', ['h5']], ['person', ['h6']]])
  })

  it('ends a run at a build of the agent, and takes nothing outside the window', () => {
    const runs = savesBetween(entries, '2026-01-01T00:00:30Z', '2026-01-01T00:05:30Z')
    expect(runs.map((r) => r.entries.map((e) => e.id))).toEqual([['h2', 'h3', 'h4'], ['h5'], ['h6'], ['h8']])
    expect(savesBetween(entries, '2026-01-01T00:06:00Z', '2026-01-01T00:07:00Z')).toEqual([])
  })
})

describe('saveWords', () => {
  it('says one save with its files and its build', () => {
    expect(saveWords({ cause: 'person', entries: [person('h39', '2026-01-01T00:00:00Z', { files: ['common/fillets.py'] })] })).toBe('You saved common/fillets.py in your editor · h39')
  })
  it('says several as a count, from the first build to the last', () => {
    const run = { cause: 'person' as const, entries: [person('h2', '2026-01-01T00:00:00Z'), person('h3', '2026-01-01T00:00:00Z'), person('h4', '2026-01-01T00:00:00Z')] }
    expect(saveWords(run)).toBe('You saved 3 times in your editor · h2 to h4')
  })
  it('says params by their names', () => {
    expect(saveWords({ cause: 'params', entries: [entry('h5', '2026-01-01T00:00:00Z', { cause: 'params', tried: ['wall', 'lid'] })] })).toBe('You tried wall, lid · h5')
    expect(saveWords({ cause: 'params', entries: [entry('h5', '2026-01-01T00:00:00Z', { cause: 'params' })] })).toBe('You tried other values of Params · h5')
  })
})

describe('the strip and the facts of a turn', () => {
  const at = '2026-01-01T00:00:00Z'
  const from = agent('h1', at, 'u0', { failing: ['wall'] })
  const joined = (entries: HistoryEntry[], start: HistoryEntry | undefined = from) => ({ promptId: 'u1', number: 1, entries, ...(start ? { from: start } : {}) })

  it('lays the build it began from before its builds, and cuts a long run to its ends', () => {
    expect(stripOf(joined([agent('h2', at, 'u1')])).map((s) => (s.kind === 'build' ? s.entry.id : `+${s.count}`))).toEqual(['h1', 'h2'])
    const many = [2, 3, 4, 5, 6, 7].map((k) => agent(`h${k}`, at, 'u1'))
    expect(stripOf(joined(many)).map((s) => (s.kind === 'build' ? s.entry.id : `+${s.count}`))).toEqual(['h1', 'h2', '+3', 'h6', 'h7'])
  })

  it('says the parts that changed, the checks that flipped and the builds that failed on the way', () => {
    const turn = joined([agent('h2', at, 'u1', { line: 'tub changed, lid same', failing: [] }), agent('h3', at, 'u1', { failed: true, error: 'x' }), agent('h4', at, 'u1', { line: 'no part changed' })])
    expect(turnFacts(turn)).toEqual(['tub changed, lid same', '1 check now passes', '1 failed on the way'])
    expect(turnFacts(joined([agent('h2', at, 'u1', { failed: true })]))).toEqual(['the build failed'])
  })
})
