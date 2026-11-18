import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../../../shared/history'
import { STRIP_FOLD_BELOW, bracketOf, inSightOf, stripFolded, stripNodes, stripSays, ticksOf, type StripLive, type StripNode } from './strip'

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
const idle = (over: Partial<StripLive> = {}): StripLive => ({ status: 'ok', onShow: null, ...over })
const numbering = new Map([['u13', 13], ['u14', 14]])

describe('stripNodes', () => {
  it('gives an empty history no node', () => {
    expect(stripNodes([], idle())).toEqual([])
  })

  it('draws a build that is running while none has landed: one node, running', () => {
    const nodes = stripNodes([], idle({ status: 'building', prompt: 1 }))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'running', by: 'prompt 1', onShow: false })
  })

  it('draws a failed build with no build before it as a failed node with nothing it is after', () => {
    const nodes = stripNodes([], idle({ status: 'failed' }))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toMatchObject({ kind: 'failed' })
    expect(nodes[0]!.after).toBeUndefined()
  })

  it('says a build after h40 failed: a failed node after h40, and h40 on show', () => {
    const history = [agent('h39', 'u13'), agent('h40', 'u13')]
    const nodes = stripNodes(history, idle({ status: 'failed', onShow: 'h40', failedAfter: 'h40', prompt: 14 }), numbering)
    expect(nodes.map((x) => x.kind)).toEqual(['built', 'built', 'failed'])
    expect(nodes[2]).toMatchObject({ kind: 'failed', after: 'h40', by: 'prompt 14' })
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
    expect(nodes[1]!.by).toBe('prompt 14')
  })

  it('puts a running build last', () => {
    const nodes = stripNodes([agent('h40', 'u13')], idle({ status: 'building', onShow: 'h40', prompt: 14 }), numbering)
    expect(nodes.map((x) => x.kind)).toEqual(['built', 'running'])
    expect(nodes[1]).toMatchObject({ by: 'prompt 14' })
    expect(nodes[0]!.onShow).toBe(true)
  })

  it('says a build the person saved: saved, by "you saved"', () => {
    const nodes = stripNodes([entry('h38', { cause: 'person' })], idle({ onShow: 'h38' }))
    expect(nodes[0]).toMatchObject({ saved: true, by: 'you saved', onShow: true })
  })

  it('keeps a starred build starred, and marks the build a review is of', () => {
    const nodes = stripNodes([agent('h40', 'u13', { starred: true }), agent('h41', 'u14')], idle({ onShow: 'h41', reviewing: 'h41' }), numbering)
    expect(nodes[0]).toMatchObject({ starred: true, reviewing: false, by: 'prompt 13' })
    expect(nodes[1]).toMatchObject({ starred: false, reviewing: true })
  })

  it('names what made a build that no prompt made', () => {
    const nodes = stripNodes([entry('h1', { cause: 'params' }), entry('h2', { cause: 'goback', wentBackTo: 'h1' }), entry('h3')], idle())
    expect(nodes.map((x) => x.by)).toEqual(['you tried', 'went back', 'earlier'])
  })

  it('keeps the order of the history, oldest to newest', () => {
    const nodes = stripNodes([entry('h1'), entry('h2'), entry('h3')], idle())
    expect(nodes.map((x) => x.id)).toEqual(['h1', 'h2', 'h3'])
  })
})

describe('bracketOf', () => {
  const history = [agent('h39', 'u13'), entry('h40', { cause: 'person' }), agent('h41', 'u14')]
  const nodes = stripNodes(history, idle({ onShow: 'h41' }), numbering)

  it('covers the node of the prompt in sight, and says so', () => {
    expect(bracketOf(nodes, [14])).toEqual({ from: 2, to: 2, label: 'prompt 14, in sight below' })
  })

  it('covers every node between the first and the last of the prompts in sight', () => {
    expect(bracketOf(nodes, [13, 14])).toEqual({ from: 0, to: 2, label: 'prompts 13 to 14, in sight below' })
  })

  it('is none when no prompt in sight made a build', () => {
    expect(bracketOf(nodes, [15])).toBeNull()
    expect(bracketOf(nodes, [])).toBeNull()
    expect(bracketOf([], [14])).toBeNull()
  })

  it('covers the running build of a prompt in sight', () => {
    const running = stripNodes([agent('h40', 'u13')], idle({ status: 'building', onShow: 'h40', prompt: 14 }), numbering)
    expect(bracketOf(running, [14])).toEqual({ from: 1, to: 1, label: 'prompt 14, in sight below' })
  })
})

describe('stripFolded', () => {
  it('folds under 640 px of dock height', () => {
    expect(STRIP_FOLD_BELOW).toBe(640)
    expect(stripFolded(639)).toBe(true)
    expect(stripFolded(640)).toBe(false)
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

describe('inSightOf', () => {
  const spans = [
    { number: 12, top: -400, bottom: -10 },
    { number: 13, top: -10, bottom: 120 },
    { number: 14, top: 120, bottom: 480 },
    { number: 15, top: 480, bottom: 700 }
  ]
  it('lists the prompts whose stretch shows in the window', () => {
    expect(inSightOf(spans, 0, 480)).toEqual([13, 14])
  })
  it('leaves out a stretch that only touches the window', () => {
    expect(inSightOf(spans, -10, 120)).toEqual([13])
  })
  it('is none for no prompts', () => {
    expect(inSightOf([], 0, 480)).toEqual([])
  })
})
