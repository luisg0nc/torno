import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/history'
import type { ProjectUsage, UsageRow } from '../../../shared/usage'
import { buildNamed, chipCost, groupCount, groupTitle, liveBy,stripGroups, stripNodes, stripSays, ticksOf, type StripLive, type StripNode } from './strip'

let n = 0
const entry = (id: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  at: new Date(1_700_000_000_000 + ++n * 60_000).toISOString(),
  run: 'run1',
  revision: n,
  sources: `s${n}`,
  model: 'm.py',
  files: ['m.py'],
  parts: 1,
  seconds: 1,
  line: 'tub changed',
  ...extra
})
const agent = (id: string, prompt: string, extra: Partial<HistoryEntry> = {}) => entry(id, { cause: 'agent', turn: { prompt }, ...extra })

describe('what is said of the build that runs or just failed', () => {
  const numbers = new Map([['u14', 14]])
  const claude = { cause: 'agent' as const, turn: { prompt: 'u14' } }
  it("is whose its saves were, as main says: never the last prompt's because a session works (#384)", () => {
    expect(liveBy({ status: 'building', reason: 'watch', made: claude }, numbers)).toEqual({ cause: 'agent', prompt: 14 })
    expect(liveBy({ status: 'failed', reason: 'watch', made: { cause: 'person' } }, numbers)).toEqual({ cause: 'person' })
    expect(liveBy({ status: 'building', reason: 'watch', made: { cause: 'agent' } }, numbers)).toEqual({ cause: 'agent' })
  })
  it("is what it was started for where that says more, a save of the person's where no save was heard, and nothing otherwise", () => {
    expect(liveBy({ status: 'building', reason: 'params', made: claude }, numbers)).toEqual({ cause: 'params' })
    expect(liveBy({ status: 'building', reason: 'goback' }, numbers)).toEqual({ cause: 'goback' })
    expect(liveBy({ status: 'building', reason: 'watch' }, numbers)).toEqual({ cause: 'person' })
    expect(liveBy({ status: 'building', reason: 'open' }, numbers)).toEqual({})
    expect(liveBy({ status: 'ok', reason: 'watch', made: claude }, numbers)).toEqual({})
    expect(liveBy(undefined, numbers)).toEqual({})
  })
})
const idle = (over: Partial<StripLive> = {}): StripLive => ({ status: 'ok', onShow: null, ...over })
const numbering = new Map([['u13', 13], ['u14', 14], ['u15', 15]])
const byId = (history: HistoryEntry[]) => new Map(history.map((e) => [e.id, e]))

describe('stripNodes', () => {
  it('gives an empty history no node', () => {
    expect(stripNodes([], idle())).toEqual([])
  })

  it('draws a build that is running while none has landed: one node, running', () => {
    const nodes = stripNodes([], idle({ status: 'building', prompt: 1, cause: 'agent' }))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'running', by: 'Prompt 1', onShow: false })
  })

  it('draws a failed build with no build before it as a failed node with nothing it is after', () => {
    const nodes = stripNodes([], idle({ status: 'failed' }))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'failed' })
    expect(nodes[0]!.after).toBeUndefined()
  })

  it('says a build after h40 failed: a failed node after h40, and h40 on show', () => {
    const history = [agent('h39', 'u13'), agent('h40', 'u13')]
    const nodes = stripNodes(history, idle({ status: 'failed', onShow: 'h40', failedAfter: 'h40', prompt: 14, cause: 'agent' }), numbering)
    expect(nodes.map((x) => x.kind)).toEqual(['built', 'built', 'failed'])
    expect(nodes[2]).toMatchObject({ kind: 'failed', after: 'h40', by: 'Prompt 14' })
    expect(nodes[1]).toMatchObject({ id: 'h40', onShow: true })
    expect(nodes[0]!.onShow).toBe(false)
  })

  it('takes a failed build the history keeps for that node, after the build before it, and does not draw a second one', () => {
    const history = [agent('h40', 'u13'), agent('h41', 'u14', { failed: true, error: 'NameError' })]
    const nodes = stripNodes(history, idle({ status: 'failed', onShow: 'h40', failedAfter: 'h40' }), numbering)
    expect(nodes.map((x) => [x.id, x.kind, x.after])).toEqual([
      ['h40', 'built', undefined],
      ['h41', 'failed', 'h40']
    ])
    expect(nodes[1]!.by).toBe('Prompt 14')
  })

  it('puts a running build last', () => {
    const nodes = stripNodes([agent('h40', 'u13')], idle({ status: 'building', onShow: 'h40', prompt: 14, cause: 'agent' }), numbering)
    expect(nodes.map((x) => x.kind)).toEqual(['built', 'running'])
    expect(nodes[1]).toMatchObject({ by: 'Prompt 14' })
    expect(nodes[0]!.onShow).toBe(true)
  })

  it('says a build the person saved: saved, "Saved by you"', () => {
    const nodes = stripNodes([entry('h38', { cause: 'person' })], idle({ onShow: 'h38' }))
    expect(nodes[0]).toMatchObject({ saved: true, by: 'Saved by you', cause: 'person', onShow: true })
  })

  it('keeps a starred build starred, and marks the build a review is of', () => {
    const nodes = stripNodes([agent('h40', 'u13', { starred: true }), agent('h41', 'u14')], idle({ onShow: 'h41', reviewing: 'h41' }), numbering)
    expect(nodes[0]).toMatchObject({ starred: true, reviewing: false, by: 'Prompt 13' })
    expect(nodes[1]).toMatchObject({ starred: false, reviewing: true })
  })

  it('names what made a build that no prompt made: "Manual edit" for Parameters, never "you tried"', () => {
    const nodes = stripNodes([entry('h1', { cause: 'params' }), entry('h2', { cause: 'goback', wentBackTo: 'h1' }), entry('h3')], idle())
    expect(nodes.map((x) => x.by)).toEqual(['Manual edit', 'Went back', 'Earlier'])
    expect(nodes[0]!.saved).toBe(true)
  })

  it('says "Claude Code" for a build of a prompt the window has no number for', () => {
    expect(stripNodes([agent('h1', 'u99')], idle(), numbering)[0]!.by).toBe('Claude Code')
  })

  it('names a running build by what started it', () => {
    expect(stripNodes([], idle({ status: 'building', cause: 'params' }))[0]!.by).toBe('Manual edit')
    expect(stripNodes([], idle({ status: 'building', cause: 'person' }))[0]!.by).toBe('Saved by you')
    expect(stripNodes([], idle({ status: 'building' }))[0]!.by).toBe('')
  })

  it('keeps the order of the history, oldest to newest', () => {
    const nodes = stripNodes([entry('h1'), entry('h2'), entry('h3')], idle())
    expect(nodes.map((x) => x.id)).toEqual(['h1', 'h2', 'h3'])
  })
})

describe('stripGroups', () => {
  it('makes one group of a prompt\'s builds, labelled by its number, its last build the one shown', () => {
    const history = [agent('h1', 'u13'), agent('h2', 'u14'), agent('h3', 'u14'), agent('h4', 'u14')]
    const groups = stripGroups(stripNodes(history, idle({ onShow: 'h4' }), numbering))
    expect(groups.map((g) => [g.label, groupCount(g), g.last.id])).toEqual([
      ['Prompt 13', 1, 'h1'],
      ['Prompt 14', 3, 'h4']
    ])
    expect(groups[1]).toMatchObject({ id: 'h2', prompt: 14, onShow: true })
    expect(groups[0]!.onShow).toBe(false)
  })

  it('makes one "Manual edit" group of the Parameters builds between two prompts', () => {
    const history = [agent('h1', 'u13'), entry('h2', { cause: 'params' }), entry('h3', { cause: 'params' }), agent('h4', 'u14')]
    const groups = stripGroups(stripNodes(history, idle(), numbering))
    expect(groups.map((g) => [g.label, groupCount(g)])).toEqual([
      ['Prompt 13', 1],
      ['Manual edit', 2],
      ['Prompt 14', 1]
    ])
    expect(groups[1]!.saved).toBe(true)
  })

  it('labels the other causes "Saved by you", "Went back" and "Earlier", and keeps each going back its own', () => {
    const history = [entry('h1'), entry('h2'), entry('h3', { cause: 'person' }), entry('h4', { cause: 'person' }), entry('h5', { cause: 'goback', wentBackTo: 'h1' }), entry('h6', { cause: 'goback', wentBackTo: 'h3' })]
    const groups = stripGroups(stripNodes(history, idle()))
    expect(groups.map((g) => [g.label, groupCount(g)])).toEqual([
      ['Earlier', 2],
      ['Saved by you', 2],
      ['Went back', 1],
      ['Went back', 1]
    ])
  })

  it('splits a prompt\'s builds when something else came between them, and keeps two prompts apart', () => {
    const history = [agent('h1', 'u13'), entry('h2', { cause: 'params' }), agent('h3', 'u13'), agent('h4', 'u14')]
    expect(stripGroups(stripNodes(history, idle(), numbering)).map((g) => g.label)).toEqual(['Prompt 13', 'Manual edit', 'Prompt 13', 'Prompt 14'])
  })

  it('counts a failed build in its prompt\'s group and says the group ended in a failure', () => {
    const history = [agent('h1', 'u14'), agent('h2', 'u14', { failed: true, error: 'NameError' })]
    const [group] = stripGroups(stripNodes(history, idle({ status: 'failed', onShow: 'h1', failedAfter: 'h1' }), numbering))
    expect(group).toMatchObject({ label: 'Prompt 14', state: 'failed', onShow: true })
    expect(groupCount(group!)).toBe(2)
  })

  it('puts the running build in its prompt\'s group, and one that nobody can say in a group of its own', () => {
    const running = stripGroups(stripNodes([agent('h1', 'u14')], idle({ status: 'building', onShow: 'h1', prompt: 14, cause: 'agent' }), numbering))
    expect(running.map((g) => [g.label, groupCount(g), g.state])).toEqual([['Prompt 14', 2, 'running']])
    const unknown = stripGroups(stripNodes([agent('h1', 'u14')], idle({ status: 'building', onShow: 'h1' }), numbering))
    expect(unknown.map((g) => [g.label, g.state])).toEqual([
      ['Prompt 14', 'built'],
      ['Building', 'running']
    ])
    const failed = stripGroups(stripNodes([], idle({ status: 'failed' })))
    expect(failed.map((g) => g.label)).toEqual(['Failed build'])
  })

  it('says a group is starred when one of its builds is, and is under review when its build is', () => {
    const history = [agent('h1', 'u14', { starred: true }), agent('h2', 'u14')]
    const [group] = stripGroups(stripNodes(history, idle({ onShow: 'h2', reviewing: 'h2' }), numbering))
    expect(group).toMatchObject({ starred: true, reviewing: true })
  })

  it('is none for no node', () => {
    expect(stripGroups([])).toEqual([])
  })
})

describe('groupTitle', () => {
  it('gives a prompt\'s words and how many builds, never in the label', () => {
    const history = [agent('h1', 'u14', { turn: { prompt: 'u14', text: 'Make the box 96 mm wide' } }), agent('h2', 'u14', { turn: { prompt: 'u14', text: 'Make the box 96 mm wide' } })]
    const [group] = stripGroups(stripNodes(history, idle({ onShow: 'h2' }), numbering))
    expect(group!.label).toBe('Prompt 14')
    expect(groupTitle(group!, byId(history))).toBe('Prompt 14: Make the box 96 mm wide\n2 builds, h1 to h2, h2 on show')
  })

  it('gives the values a manual edit set', () => {
    const history = [entry('h1', { cause: 'params', tried: ['wall'], set: { wall: 3 } }), entry('h2', { cause: 'params', tried: ['lid'], set: { lid: 1.5 } })]
    const [group] = stripGroups(stripNodes(history, idle()))
    expect(groupTitle(group!, byId(history))).toBe('Manual edit: You set wall to 3, lid to 1.5 · not in the model yet\n2 builds, h1 to h2')
  })

  it('says what a going back restored, and a failed or a starred build alone', () => {
    const history = [entry('h1', { cause: 'goback', wentBackTo: 'h0', starred: true })]
    expect(groupTitle(stripGroups(stripNodes(history, idle()))[0]!, byId(history))).toBe('Went back to h0\nh1, starred')
    const failed = [agent('h2', 'u13', { failed: true, error: 'NameError' })]
    expect(groupTitle(stripGroups(stripNodes(failed, idle(), numbering))[0]!, byId(failed))).toBe('Prompt 13\nh2, failed')
  })
})

describe('buildNamed', () => {
  it('names the newest build that drew as the latest, with what made it in the timeline\'s words', () => {
    const history = [agent('h1', 'u13'), agent('h2', 'u14')]
    expect(buildNamed(stripNodes(history, idle({ onShow: 'h2' }), numbering), 'h2')).toEqual({ id: 'h2', head: 'Latest build · prompt 14', latest: true })
    const manual = [agent('h1', 'u13'), entry('h2', { cause: 'params' })]
    expect(buildNamed(stripNodes(manual, idle(), numbering), 'h2')!.head).toBe('Latest build · manual edit')
    expect(buildNamed(stripNodes([entry('h3', { cause: 'person' })], idle()), 'h3')!.head).toBe('Latest build · saved by you')
    expect(buildNamed(stripNodes([entry('h4', { cause: 'goback', wentBackTo: 'h1' })], idle()), 'h4')!.head).toBe('Latest build · went back')
    expect(buildNamed(stripNodes([agent('h5', 'u99')], idle(), numbering), 'h5')!.head).toBe('Latest build · Claude Code')
  })

  it('names an older build by what made it, and says it is older', () => {
    const history = [agent('h1', 'u13'), agent('h2', 'u14')]
    expect(buildNamed(stripNodes(history, idle({ onShow: 'h2' }), numbering), 'h1')).toEqual({ id: 'h1', head: 'Prompt 13 · older build', latest: false })
    expect(buildNamed(stripNodes([entry('h1'), entry('h2')], idle()), 'h1')!.head).toBe('Earlier · older build')
  })

  it('still calls the build the latest when only failed or running builds came after it', () => {
    const history = [agent('h1', 'u13'), agent('h2', 'u14', { failed: true, error: 'NameError' })]
    expect(buildNamed(stripNodes(history, idle({ status: 'building', onShow: 'h1', prompt: 14, cause: 'agent' }), numbering), 'h1')!.latest).toBe(true)
  })

  it('is null for a build the timeline does not have', () => {
    expect(buildNamed([], 'h1')).toBeNull()
  })
})

describe('ticksOf', () => {
  const many = (count: number): StripNode[] => stripNodes(Array.from({ length: count }, (_, i) => entry(`h${i + 1}`)), idle({ onShow: `h${count}` }))

  it('is the last eight nodes', () => {
    expect(ticksOf(many(41)).map((x) => x.id)).toEqual(['h34', 'h35', 'h36', 'h37', 'h38', 'h39', 'h40', 'h41'])
  })

  it('is all of a short history, and none of an empty one', () => {
    expect(ticksOf(many(3))).toHaveLength(3)
    expect(ticksOf([])).toEqual([])
  })

  it('keeps the build on show among the eight when it is older, in its place in the order', () => {
    const nodes = stripNodes(Array.from({ length: 41 }, (_, i) => entry(`h${i + 1}`)), idle({ onShow: 'h12' }))
    const ticks = ticksOf(nodes)
    expect(ticks).toHaveLength(8)
    expect(ticks.map((x) => x.id)).toEqual(['h12', 'h35', 'h36', 'h37', 'h38', 'h39', 'h40', 'h41'])
    expect(ticks.find((x) => x.onShow)?.id).toBe('h12')
  })
})

describe('stripSays', () => {
  const nodes = stripNodes([agent('h40', 'u13'), agent('h41', 'u14')], idle({ onShow: 'h41' }), numbering)
  it('says what a pick does when nothing is happening', () => {
    expect(stripSays({ nodes, exporting: false })).toBe('Pick one to compare, star or go back')
  })
  it('says a build is running', () => {
    expect(stripSays({ nodes: [...nodes, ...stripNodes([], idle({ status: 'building' }))], exporting: false })).toBe('A build is running')
  })
  it('says the build on show is still on show after a failure', () => {
    const failed = stripNodes([agent('h40', 'u13')], idle({ status: 'failed', onShow: 'h40', failedAfter: 'h40' }), numbering)
    expect(stripSays({ nodes: failed, exporting: false })).toBe('h40 is still on show')
  })
  it('says what a review is of, and what an export takes', () => {
    const reviewed = stripNodes([agent('h41', 'u14')], idle({ onShow: 'h41', reviewing: 'h41' }), numbering)
    expect(stripSays({ nodes: reviewed, exporting: false })).toBe('Your review is of h41')
    expect(stripSays({ nodes: reviewed, exporting: true })).toBe('Exporting the build on show, h41')
  })
  it('says an export of nothing built', () => {
    expect(stripSays({ nodes: [], exporting: true })).toBe('Exporting the build on show')
  })
})

describe('chipCost', () => {
  const row = (number: number, costUsd?: number): UsageRow => ({ conversation: 'c', id: `u${number}`, number, text: '', at: number, turns: [`t${number}`], facts: { pictures: {}, builds: { count: 0 } }, usage: { input: 0, output: 1, cacheRead: 1, cacheCreation: 0, ...(costUsd !== undefined ? { costUsd } : {}) } })
  const usage: ProjectUsage = { rows: [row(13, 0.95), row(14, 0.64), row(15, 7.05), row(16)], median: 0.95 }
  const groupOf = (prompt: number) => stripGroups(stripNodes([agent('h1', `u${prompt}`)], idle(), new Map([[`u${prompt}`, prompt]])))[0]!

  it("says a prompt group's cost, the large one marked", () => {
    expect(chipCost(groupOf(14), usage)).toEqual({ text: '$0.64', large: false })
    expect(chipCost(groupOf(15), usage)).toEqual({ text: '$7.05', large: true })
  })

  it('says nothing for a group that is no prompt, a prompt whose cost is not known, or before usage is read', () => {
    expect(chipCost(stripGroups(stripNodes([entry('h1', { cause: 'person' })], idle()))[0]!, usage)).toBeNull()
    expect(chipCost(groupOf(16), usage)).toBeNull()
    expect(chipCost(groupOf(14), undefined)).toBeNull()
  })
})
