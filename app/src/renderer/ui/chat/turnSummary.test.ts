import { describe, expect, it } from 'vitest'
import type { ChatItem } from '../../../shared/chat'
import { isEmpty, itemsOfTurn, netParts, summaryParts, turnSummary } from './turnSummary'

const user: ChatItem = { kind: 'user', id: 'u1', text: 'thicken it', images: [], state: 'sent', at: 1 }
const prompt = (revision: number): ChatItem => ({ kind: 'context', id: 'c1', forUser: 'u1', text: '', marks: [], revision, buildState: 'ok' })
const tool = (id: string, name: string, input: unknown, extra: Partial<Extract<ChatItem, { kind: 'tool' }>> = {}): ChatItem => ({ kind: 'tool', id, toolUseId: id, name, torno: name.startsWith('mcp__torno__'), input, state: 'done', images: [], ...extra })
const build = (id: string, forUser: string, buildState: 'ok' | 'failed', revision?: number, dimensions: Array<{ id: string; was: 'pass' | 'fail' | 'none'; now: 'pass' | 'fail' | 'none' }> = []): ChatItem => ({
  kind: 'context',
  id,
  forUser,
  forTool: true,
  text: '',
  marks: [],
  buildState,
  ...(revision !== undefined ? { revision } : {}),
  ...(dimensions.length > 0 ? { digest: { revision: revision ?? 0, changed: true, parts: [], unchanged: 0, flags: [], dimensions } } : {})
})
const end: ChatItem = { kind: 'turn', id: 't1', ok: true, stopped: false, seconds: 3, pulled: {} }

describe('the account of a turn', () => {
  it('is empty for a turn that changed nothing', () => {
    const s = turnSummary(itemsOfTurn([user, prompt(1), { kind: 'text', id: 'x', text: 'hi', streaming: false }, end], 't1'))
    expect(isEmpty(s)).toBe(true)
    expect(summaryParts(s)).toEqual([])
  })

  it('counts two edits of one file, the builds they started, a resolved mark and a mark added', () => {
    const items: ChatItem[] = [
      user,
      prompt(1),
      tool('e1', 'Edit', { file_path: '/ws/hollow/hollow.py', old_string: 'a', new_string: 'b' }),
      build('b1', 'e1', 'ok', 2),
      tool('e2', 'Edit', { file_path: '/ws/hollow/hollow.py', old_string: 'b', new_string: 'c' }),
      build('b2', 'e2', 'ok', 3, [{ id: 'M3', was: 'fail', now: 'pass' }]),
      tool('r1', 'mcp__torno__resolve_mark', { id: 'M1' }, { result: 'resolved: M1 pin: "thin"' }),
      tool('a1', 'mcp__torno__add_mark', { kind: 'pin', note: 'x' }, { result: 'placed in layout main: (yours) M5 pin on lid/F2: "thinned"\nrevision r3' }),
      end
    ]
    expect(summaryParts(turnSummary(itemsOfTurn(items, 't1')))).toEqual(['hollow.py edited ×2', 'r1 → r3 ok', 'resolved M1', 'added M5', 'M3 now passes'])
  })

  it("leaves a build that was the person's alone out of the turn's builds and its dimensions (#384)", () => {
    const theirs = { ...build('b2', 'e1', 'ok', 3, [{ id: 'M3', was: 'pass', now: 'fail' }]), byPerson: true } as ChatItem
    const items: ChatItem[] = [user, prompt(1), tool('e1', 'Bash', { command: 'python gen.py' }), build('b1', 'e1', 'ok', 2), theirs, end]
    expect(summaryParts(turnSummary(itemsOfTurn(items, 't1')))).toEqual(['r1 → r2 ok'])
  })

  it('says the sketches it drew, and the ones it drew again', () => {
    const made = (id: string, n: number): ChatItem => tool(id, 'mcp__torno__add_sketch', { name: 'Hose' }, { result: `made in layout main: M${n} · sketch "Hose" · flow ⌀19 mm · 2 strokes on 1 plane · sent, drawn on build 3\nrevision r3` })
    const one = [user, prompt(1), made('s1', 9), end]
    expect(summaryParts(turnSummary(itemsOfTurn(one, 't1')))).toEqual(['drew a sketch M9'])
    expect(isEmpty(turnSummary(itemsOfTurn(one, 't1')))).toBe(false)
    const more = [user, prompt(1), made('s1', 9), made('s2', 10), tool('s3', 'mcp__torno__add_sketch', { sketch: 'M9' }, { result: 'replaced in layout main: M9 · sketch "Hose" · rough · 1 stroke on 1 plane · sent, drawn on build 3' }), end]
    expect(summaryParts(turnSummary(itemsOfTurn(more, 't1')))).toEqual(['drew sketches M9, M10', 'drew M9 again'])
    // One that was refused, or taken away, is not a sketch drawn.
    const refused = [user, prompt(1), tool('s1', 'mcp__torno__add_sketch', {}, { result: 'a sketch needs a name', state: 'error' }), tool('s2', 'mcp__torno__add_sketch', { sketch: 'M9', remove: true }, { result: 'removed M9, your sketch "Hose": it is gone' }), end]
    expect(summaryParts(turnSummary(itemsOfTurn(refused, 't1')))).toEqual([])
  })

  it('says a build that failed and then passed, and one that failed last', () => {
    const edits = (last: 'ok' | 'failed'): ChatItem[] => [user, prompt(2), tool('e1', 'Edit', { file_path: '/p/a.py' }), build('b1', 'e1', 'failed'), tool('e2', 'Edit', { file_path: '/p/a.py' }), build('b2', 'e2', last, last === 'ok' ? 3 : undefined), end]
    expect(summaryParts(turnSummary(itemsOfTurn(edits('ok'), 't1')))).toEqual(['a.py edited ×2', 'r2 → r3 ok after 1 failed build'])
    expect(summaryParts(turnSummary(itemsOfTurn(edits('failed'), 't1')))).toEqual(['a.py edited ×2', '2 builds failed'])
  })

  it('leaves out an edit that did not happen, a dimension that ended as it began, and what an earlier turn did', () => {
    const items: ChatItem[] = [
      tool('old', 'Edit', { file_path: '/p/old.py' }),
      { kind: 'turn', id: 't0', ok: true, stopped: false, seconds: 1, pulled: {} },
      user,
      tool('e1', 'Edit', { file_path: '/p/a.py' }, { state: 'denied' }),
      tool('e2', 'Write', { file_path: '/p/b.py', content: '' }),
      build('b1', 'e2', 'ok', 4, [{ id: 'M2', was: 'pass', now: 'fail' }]),
      build('b2', 'e2', 'ok', 5, [{ id: 'M2', was: 'fail', now: 'pass' }]),
      end
    ]
    expect(summaryParts(turnSummary(itemsOfTurn(items, 't1')))).toEqual(['b.py edited', 'r5 ok'])
  })

  it('names three files and counts the rest', () => {
    const items: ChatItem[] = ['a', 'b', 'c', 'd', 'e'].map((n) => tool(n, 'Edit', { file_path: `/p/${n}.py` }))
    expect(summaryParts(turnSummary([...items]))).toEqual(['a.py, b.py, c.py and 2 more files edited'])
  })

  it('puts the first build against the last, from the kernel numbers of the digests', () => {
    const part = (before: number, after: number, exact: boolean, faces: [number, number]) => ({
      name: 'tub',
      layout: 'main',
      text: '',
      volume: { before, after, change: after - before, exact },
      size: { before: [1, 1, 1], after: [1, 1, 1], change: [0, 0, 0], exact: true },
      faces: { before: faces[0], after: faces[1] },
      edges: { before: 1, after: 1 }
    })
    const withParts = (id: string, revision: number, p: ReturnType<typeof part>): ChatItem => {
      const item = build(id, 'e1', 'ok', revision)
      return item.kind === 'context' ? { ...item, digest: { revision, changed: true, parts: [p as never], unchanged: 0, flags: [], dimensions: [] } } : item
    }
    const items = [withParts('b1', 2, part(28400, 26000, true, [14, 18])), withParts('b2', 3, part(26000, 25560, false, [18, 22]))]
    expect(netParts(items)).toEqual(['tub: volume ≈ 28400 → 25560 mm³ (-10 %), faces 14 → 22'])
    // Back where it began: nothing to tell.
    expect(netParts([withParts('b1', 2, part(100, 90, true, [4, 5])), withParts('b2', 3, part(90, 100, true, [5, 4]))])).toEqual([])
    expect(netParts([user])).toEqual([])
  })

  it('finds the turn by its id and gives nothing for another', () => {
    expect(itemsOfTurn([user, end], 'zz')).toEqual([])
  })
})
