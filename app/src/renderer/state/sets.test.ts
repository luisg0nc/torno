import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NamedSet, SetMember } from '../../shared/sets'
import { NOTHING_SELECTED, Unplaced, asksFor, connectSets, dropStrokes, holds, litSet, nextColour, selectableMembers, setActions, setsHolding, setsStore, suggestName } from './sets'
import { store } from './store'

const set = (over: Partial<NamedSet> & { members?: SetMember[] } = {}): NamedSet => ({ id: 'N1', name: 'deck', slug: 'deck', comment: '', colour: 0, layout: 'assembly', by: 'person', members: [], createdAt: '2026-11-17T10:00:00.000Z', ...over })
const face = (ref: string, state: 'ok' | 'lost' = 'ok'): SetMember => ({ face: ref, point: [0, 0, 20], normal: [0, 0, 1], state })

/** `window.torno.sets` as far as the window asks of it. */
function fake() {
  const sets = {
    list: vi.fn(async () => [] as NamedSet[]),
    make: vi.fn(async (_o: string, ask: { name: string }) => set({ id: 'N7', name: ask.name, slug: ask.name })),
    edit: vi.fn(async (_o: string, id: string) => set({ id })),
    remove: vi.fn(async () => {}),
    restore: vi.fn(async (_o: string, id: string) => set({ id })),
    accept: vi.fn(async (_o: string, id: string) => set({ id })),
    dismiss: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {}),
    onProblem: vi.fn(() => () => {}),
    problem: vi.fn(async () => null as string | null),
    dismissProblem: vi.fn(async () => {})
  }
  vi.stubGlobal('window', { torno: { sets } })
  return sets
}

beforeEach(() => {
  store.setState({ objectId: 'bracket', layout: 'assembly', selection: [], picked: {} })
  setsStore.setState({ objectId: 'bracket', sets: [], making: false, hovered: null, repicking: null, removed: null, said: null, refused: null, problem: null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  store.setState({ objectId: null, selection: [], picked: {} })
  setsStore.setState({ objectId: null, sets: [], making: false, hovered: null, repicking: null, removed: null, said: null, refused: null, problem: null })
})

describe('the name a set is suggested', () => {
  it('is the type of the first face and the way it faces', () => {
    expect(suggestName('plane, normal +Z, z = 20, 1180 mm²', [])).toBe('plane +Z face')
    expect(suggestName('cylinder, radius 4, 120 mm²', [])).toBe('cylinder face')
    expect(suggestName('circle, radius 4, 25.13 mm', [])).toBe('circle edge')
    expect(suggestName('part, 40 × 30 × 5 mm, 6000 mm³, 6 faces', [])).toBe('Part set')
    expect(suggestName(undefined, [])).toBe('New set')
  })
  it('is made unique among the names there are, by a number', () => {
    expect(suggestName('plane, normal +Z, z = 20, 1180 mm²', ['plane +Z face'])).toBe('plane +Z face 2')
    expect(suggestName('plane, normal +Z, z = 20, 1180 mm²', ['plane +Z face', 'Plane +Z face 2'])).toBe('plane +Z face 3')
  })
})

describe('the colour a new set takes', () => {
  it('is the one after the set made last, round the eight', () => {
    expect(nextColour([])).toBe(0)
    expect(nextColour([set({ id: 'N1', colour: 0 }), set({ id: 'N2', colour: 1 })])).toBe(2)
    expect(nextColour([set({ id: 'N9', colour: 7 }), set({ id: 'N10', colour: 7 })])).toBe(0)
    // Made last is the highest number, not the last in the list.
    expect(nextColour([set({ id: 'N10', colour: 3 }), set({ id: 'N9', colour: 6 })])).toBe(4)
  })
})

describe('which sets hold a ref', () => {
  const deck = set({ id: 'N1', members: [face('block/F12'), { edge: 'block/E4', point: [0, 0, 0], state: 'ok' }, face('lid/F2', 'lost')] })
  const intake = set({ id: 'N2', name: 'intake', slug: 'intake', members: [face('block/F12'), { part: 'lid' }] })
  const other = set({ id: 'N3', name: 'away', slug: 'away', layout: 'print', members: [face('block/F12')] })
  it('holds a face, an edge, or a face of a part it holds whole; a lost member holds nothing', () => {
    expect(holds(deck, 'block/F12')).toBe(true)
    expect(holds(deck, 'block/E4')).toBe(true)
    expect(holds(deck, 'lid/F2')).toBe(false)
    expect(holds(intake, 'lid/F9')).toBe(true)
    expect(holds(intake, 'lid')).toBe(true)
    expect(holds(deck, 'M3')).toBe(false)
  })
  it('lists them oldest first, of the layout shown only', () => {
    expect(setsHolding([deck, intake, other], 'assembly', 'block/F12').map((s) => s.id)).toEqual(['N1', 'N2'])
    expect(setsHolding([deck, intake, other], 'print', 'block/F12').map((s) => s.id)).toEqual(['N3'])
    store.setState({ layout: 'assembly' })
    setsStore.setState({ sets: [deck, intake, other] })
    expect(setActions.setsAt('block/F12').map((s) => s.slug)).toEqual(['deck', 'intake'])
  })
  it('selects the members the build has found, never a stroke', () => {
    expect(selectableMembers(set({ members: [face('block/F12'), face('block/F3', 'lost'), { stroke: 'M7/k3' }, { part: 'lid' }] }))).toEqual(['block/F12', 'lid'])
  })
})

describe('what the view lights for a set', () => {
  const sketch = { id: 'M7', kind: 'sketch', strokes: [{ id: 'k3' }] } as never
  const deck = set({ colour: 4, members: [face('block/F12'), face('block/F3', 'lost'), { part: 'lid' }, { stroke: 'M7/k3' }, { stroke: 'M7/k9' }] })
  it('is its members the build found and its strokes still there, in its colour', () => {
    expect(litSet([deck], 'N1', 'assembly', [sketch])).toEqual({ refs: ['block/F12', 'lid', 'M7/k3'], colour: 4, proposed: false })
  })
  it('says a proposal, and is none for no set, an unknown one, or one of another layout', () => {
    expect(litSet([{ ...deck, by: 'agent', proposed: true }], 'N1', 'assembly', [sketch])?.proposed).toBe(true)
    expect(litSet([deck], null, 'assembly', [])).toBeNull()
    expect(litSet([deck], 'N9', 'assembly', [])).toBeNull()
    expect(litSet([deck], 'N1', 'print', [])).toBeNull()
  })
})

describe('the members asked for from a selection', () => {
  it('sends each face with where it was picked, so that none is held', async () => {
    const asks = await asksFor(['block/F12', 'block/E3', 'lid', 'M7/k3'], { 'block/F12': { point: [1, 2, 20], normal: [0, 0, 1] }, 'block/E3': { point: [4, 0, 0], normal: null } }, async () => null)
    expect(asks).toEqual([{ ref: 'block/F12', point: [1, 2, 20], normal: [0, 0, 1] }, { ref: 'block/E3', point: [4, 0, 0] }, { ref: 'lid' }, { stroke: 'M7/k3' }])
  })
  it('asks the kernel for the middle of a face that was selected without a pick', async () => {
    const asks = await asksFor(['block/F1', 'block/E2'], {}, async (ref) => (ref === 'block/F1' ? { center: [5, 5, 5], normal: [1, 0, 0] } : { center: [6, 6, 6], normal: null }))
    expect(asks).toEqual([{ ref: 'block/F1', point: [5, 5, 5], normal: [1, 0, 0] }, { ref: 'block/E2', point: [6, 6, 6] }])
  })
  it('refuses, in a sentence, when the kernel cannot say where a face or an edge is: no member is sent for main to hold at a guess', async () => {
    const refusal = asksFor(['block/F1', 'block/F2', 'block/E3', 'lid'], {}, async (ref) => (ref === 'block/F1' ? { center: [5, 5, 5], normal: [1, 0, 0] } : null))
    await expect(refusal).rejects.toBeInstanceOf(Unplaced)
    await expect(refusal).rejects.toThrow('The kernel could not say where block/F2 and block/E3 are: select them again, or click them in the view')
    await expect(asksFor(['block/F2'], {}, async () => null)).rejects.toThrow('The kernel could not say where block/F2 is: select it again, or click it in the view')
  })
})

describe('Ctrl+G', () => {
  it('opens the popover with something selected', () => {
    store.setState({ selection: ['block/F12'] })
    expect(setActions.startMake()).toBe(true)
    expect(setsStore.getState().making).toBe(true)
    setActions.cancelMake()
    expect(setsStore.getState().making).toBe(false)
  })
  it('says what to select, in the status line for a moment, with nothing selected', () => {
    vi.useFakeTimers()
    expect(setActions.startMake()).toBe(false)
    expect(setsStore.getState().making).toBe(false)
    expect(setsStore.getState().said).toBe('Select faces, edges, parts or strokes first')
    expect(NOTHING_SELECTED).toBe('Select faces, edges, parts or strokes first')
    vi.advanceTimersByTime(5000)
    expect(setsStore.getState().said).toBeNull()
  })
  it('does nothing with no project open', () => {
    store.setState({ objectId: null, selection: ['block/F12'] })
    expect(setActions.startMake()).toBe(false)
  })
})

describe('what is asked of main', () => {
  it('makes a set, closes the popover and holds the set it comes back with', async () => {
    const sets = fake()
    setsStore.setState({ making: true })
    const made = await setActions.make({ name: 'deck', comment: '', layout: 'assembly', members: [{ ref: 'lid' }] })
    expect(sets.make).toHaveBeenCalledWith('bracket', { name: 'deck', comment: '', layout: 'assembly', members: [{ ref: 'lid' }] }, undefined)
    expect(made.id).toBe('N7')
    expect(setsStore.getState().making).toBe(false)
    expect(setsStore.getState().sets.map((s) => s.id)).toEqual(['N7'])
  })
  it('says which build the refs it sends are of: the one it shows', async () => {
    const sets = fake()
    store.setState({ scene: { model: 'm.py', layouts: ['assembly'], parts: [], seconds: 0, output: '' } as never, revision: 4, selection: ['lid'], picked: {} })
    await setActions.make({ name: 'deck', comment: '', layout: 'assembly', members: [{ ref: 'lid' }] })
    expect(sets.make).toHaveBeenLastCalledWith('bracket', expect.anything(), 4)
    setsStore.setState({ sets: [set()] })
    await setActions.addSelection('N1')
    expect(sets.edit).toHaveBeenLastCalledWith('bracket', 'N1', { add: [{ ref: 'lid' }] }, 4)
    store.setState({ scene: null, revision: 0 })
  })
  it('refuses the selection, saying so in the status line and in the notices, when the kernel cannot place a face of it', async () => {
    const sets = fake()
    vi.stubGlobal('window', { torno: { sets, geometry: { describe: vi.fn(async () => { throw new Error('kernel is gone') }) } } })
    setsStore.setState({ sets: [set()] })
    store.setState({ selection: ['block/F2'], picked: {} })
    expect(await setActions.addSelection('N1')).toBe(false)
    expect(sets.edit).not.toHaveBeenCalled()
    const sentence = 'The kernel could not say where block/F2 is: select it again, or click it in the view'
    expect(setsStore.getState().refused).toBe(sentence)
    expect(setsStore.getState().said).toBe(sentence)
    expect(await setActions.repick('N1')).toBe(false)
    expect(sets.edit).not.toHaveBeenCalled()
  })
  it('says main\'s words when it refuses an edit, and changes nothing', async () => {
    const sets = fake()
    sets.edit.mockRejectedValueOnce(new Error('#deck is taken (N3)'))
    setsStore.setState({ sets: [set()] })
    expect(await setActions.edit('N1', { name: 'x' })).toBe(false)
    expect(setsStore.getState().refused).toBe('#deck is taken (N3)')
  })
  it('adds the selection, and takes away what of it is in the set', async () => {
    const sets = fake()
    setsStore.setState({ sets: [set({ members: [face('block/F12')] })] })
    store.setState({ selection: ['lid'], picked: {} })
    expect(await setActions.addSelection('N1')).toBe(true)
    expect(sets.edit).toHaveBeenLastCalledWith('bracket', 'N1', { add: [{ ref: 'lid' }] }, undefined)
    setsStore.setState({ sets: [set({ members: [face('block/F12')] })] })
    store.setState({ selection: ['block/F12', 'lid'] })
    expect(await setActions.takeSelection('N1')).toBe(true)
    expect(sets.edit).toHaveBeenLastCalledWith('bracket', 'N1', { take: ['block/F12'] }, undefined)
    store.setState({ selection: ['lid'] })
    expect(await setActions.takeSelection('N1')).toBe(false)
    expect(setsStore.getState().refused).toBe('None of what is selected is in this set')
  })
  it('deletes a set and offers to put it back for a while, once', async () => {
    vi.useFakeTimers()
    const sets = fake()
    setsStore.setState({ sets: [set()] })
    await setActions.remove('N1')
    expect(setsStore.getState().sets).toEqual([])
    expect(setsStore.getState().removed).toEqual({ id: 'N1', name: 'deck' })
    await setActions.undo()
    expect(sets.restore).toHaveBeenCalledWith('bracket', 'N1')
    expect(setsStore.getState().sets.map((s) => s.id)).toEqual(['N1'])
    expect(setsStore.getState().removed).toBeNull()
    await setActions.remove('N1')
    vi.advanceTimersByTime(11_000)
    expect(setsStore.getState().removed).toBeNull()
  })
  it('accepts and dismisses a proposal', async () => {
    const sets = fake()
    setsStore.setState({ sets: [set({ id: 'N2', by: 'agent', proposed: true }), set({ id: 'N3', slug: 'b', name: 'b', by: 'agent', proposed: true })] })
    await setActions.accept('N2')
    expect(sets.accept).toHaveBeenCalledWith('bracket', 'N2')
    await setActions.dismiss('N3')
    expect(sets.dismiss).toHaveBeenCalledWith('bracket', 'N3')
    expect(setsStore.getState().sets.map((s) => s.id)).toEqual(['N2'])
  })
})

describe('Re-pick', () => {
  it('clears the selection on the first press, and sends what is selected next as the repick on the second', async () => {
    const sets = fake()
    setsStore.setState({ sets: [set({ members: [face('block/F12', 'lost')] })] })
    store.setState({ selection: ['block/F1'], picked: {} })
    setActions.startRepick('N1')
    expect(setsStore.getState().repicking).toBe('N1')
    expect(store.getState().selection).toEqual([])
    expect(await setActions.repick('N1')).toBe(false)
    expect(setsStore.getState().refused).toBe(NOTHING_SELECTED)
    store.setState({ selection: ['block/F3'], picked: { 'block/F3': { point: [0, 0, 5], normal: [0, 0, 1] } } })
    expect(await setActions.repick('N1')).toBe(true)
    expect(sets.edit).toHaveBeenLastCalledWith('bracket', 'N1', { repick: [{ ref: 'block/F3', point: [0, 0, 5], normal: [0, 0, 1] }] }, undefined)
    expect(setsStore.getState().repicking).toBeNull()
  })
})

describe('what main found wrong with the sets file', () => {
  it('keeps it for the open project, and not for another, until it is dismissed', async () => {
    const sets = fake()
    setActions.problemTold({ objectId: 'other', message: 'not ours' })
    expect(setsStore.getState().problem).toBeNull()
    setActions.problemTold({ objectId: 'bracket', message: 'The named sets file of this project could not be read. It was kept as .torno/sets.json.bad-1, and a new list was started.' })
    expect(setsStore.getState().problem).toBe('The named sets file of this project could not be read. It was kept as .torno/sets.json.bad-1, and a new list was started.')
    setActions.told({ objectId: 'bracket', sets: [] })
    expect(setsStore.getState().problem).not.toBeNull()
    setActions.dismissProblem()
    expect(setsStore.getState().problem).toBeNull()
    expect(sets.dismissProblem).toHaveBeenCalledWith('bracket')
  })
  it('is asked for when a project opens, as the window may not have been listening when it was said, and let go with the project', async () => {
    const sets = fake()
    sets.problem.mockResolvedValueOnce('The named sets file of this project could not be read.')
    const off = connectSets()
    await vi.waitFor(() => expect(setsStore.getState().problem).toBe('The named sets file of this project could not be read.'))
    expect(sets.problem).toHaveBeenCalledWith('bracket')
    setActions.open('two')
    expect(setsStore.getState().problem).toBeNull()
    off()
  })
})

describe('following main', () => {
  it('holds the sets main tells of the open project, and not those of another', () => {
    setActions.told({ objectId: 'other', sets: [set()] })
    expect(setsStore.getState().sets).toEqual([])
    setActions.told({ objectId: 'bracket', sets: [set()] })
    expect(setsStore.getState().sets).toHaveLength(1)
  })
  it('lets go the hovered and the re-picked set when it is gone', () => {
    setsStore.setState({ sets: [set()], hovered: 'N1', repicking: 'N1' })
    setActions.told({ objectId: 'bracket', sets: [] })
    expect(setsStore.getState()).toMatchObject({ hovered: null, repicking: null })
  })
  it('reads the sets when a project opens, and follows its changes', async () => {
    const sets = fake()
    sets.list.mockResolvedValueOnce([set()])
    const off = connectSets()
    await vi.waitFor(() => expect(setsStore.getState().sets).toHaveLength(1))
    expect(sets.list).toHaveBeenCalledWith('bracket')
    expect(sets.onChanged).toHaveBeenCalled()
    off()
  })
  it('lets go the strokes of the selection once the sketch is closed, and keeps the rest', () => {
    store.setState({ selection: ['block/F1', 'M7/k3'] })
    dropStrokes()
    expect(store.getState().selection).toEqual(['block/F1'])
  })
})
