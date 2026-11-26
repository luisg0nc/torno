import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyBoard, type BoardFile, type Card } from '../../shared/board'
import { boardActions, boardStore, defaultShown, forgetMemories, memoryEpoch, onBoardForgotten, inModel, partRead, partWrite, sharing, SHOWN_KEY, shownRead, shownWrite, swapped } from './board'
import { actions, onWorkspaceSet, store } from './store'

const card = (id: string, by: Card['by'], kind: Card['kind'] = 'text'): Card => ({ id, kind, x: 0, y: 0, w: 10, h: 10, by })
const board = (...cards: Card[]): BoardFile => ({ ...emptyBoard(), cards })

/** A storage of a Map: the one the window has is not there under node. */
function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('what a project opens on', () => {
  it('is the model until its board has a card of the person or of the agent', () => {
    expect(defaultShown(null)).toBe('model')
    expect(defaultShown(board())).toBe('model')
    expect(defaultShown(board(card('C1', 'torno', 'brief'), card('C2', 'torno', 'mark')))).toBe('model')
    expect(defaultShown(board(card('C1', 'torno', 'brief'), card('C2', 'person')))).toBe('brief')
    expect(defaultShown(board(card('C1', 'agent')))).toBe('brief')
  })

  it('does not count a hidden card of main as a card of the person', () => {
    expect(defaultShown(board({ ...card('C1', 'torno'), hidden: true }))).toBe('model')
  })
})

describe('what the window remembers', () => {
  it('keeps the choice per project, and reads nothing it does not understand', () => {
    const storage = memory()
    expect(shownRead(storage, 'a')).toBeNull()
    shownWrite(storage, 'a', 'brief')
    shownWrite(storage, 'b', 'model')
    expect(shownRead(storage, 'a')).toBe('brief')
    expect(shownRead(storage, 'b')).toBe('model')
    expect(shownRead(storage, 'c')).toBeNull()
    storage.data.set(SHOWN_KEY, '{"a":"elsewhere","b":3}')
    expect(shownRead(storage, 'a')).toBeNull()
    expect(shownRead(storage, 'b')).toBeNull()
    storage.data.set(SHOWN_KEY, 'not json')
    expect(shownRead(storage, 'a')).toBeNull()
  })

  it('reads the choice a window kept when the brief was the board as the brief', () => {
    const storage = memory()
    storage.data.set(SHOWN_KEY, '{"a":"board"}')
    expect(shownRead(storage, 'a')).toBe('brief')
  })

  it('goes on with no storage, or one that refuses', () => {
    expect(shownRead(null, 'a')).toBeNull()
    expect(() => shownWrite(null, 'a', 'brief')).not.toThrow()
    const refusing = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(shownRead(refusing, 'a')).toBeNull()
    expect(() => shownWrite(refusing, 'a', 'brief')).not.toThrow()
  })
})

describe('the swap of the main area', () => {
  const both = { scans: true, tracing: true }
  const none = { scans: false, tracing: false }

  it('goes model, brief, scans, tracing, model, and passes over what the project has none of', () => {
    expect(swapped('model', both)).toBe('brief')
    expect(swapped('brief', both)).toBe('scans')
    expect(swapped('scans', both)).toBe('tracing')
    expect(swapped('tracing', both)).toBe('model')
    expect(swapped('brief', { scans: false, tracing: true })).toBe('tracing')
    expect(swapped('brief', { scans: true, tracing: false })).toBe('scans')
    expect(swapped('scans', { scans: true, tracing: false })).toBe('model')
    expect(swapped('model', none)).toBe('brief')
    expect(swapped('brief', none)).toBe('model')
    // Left on a view that is gone: on to the model.
    expect(swapped('tracing', none)).toBe('model')
    expect(swapped('scans', none)).toBe('model')
  })

  it('shows each in turn, and keeps the choice of it for the project', () => {
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.swap(both)
    expect(boardStore.getState().shown).toBe('brief')
    boardActions.swap(both)
    expect(boardStore.getState().shown).toBe('scans')
    boardActions.swap(both)
    expect(boardStore.getState().shown).toBe('tracing')
    boardActions.swap(both)
    expect(boardStore.getState().shown).toBe('model')
  })

  it('leaves a tracing or scans that are not there for the model, without taking the choice back', () => {
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.show('tracing')
    boardActions.leaveTracing()
    expect(boardStore.getState()).toMatchObject({ shown: 'model', chosen: true })
    boardActions.show('scans')
    boardActions.leaveTracing()
    expect(boardStore.getState().shown).toBe('scans')
    boardActions.leaveScans()
    expect(boardStore.getState()).toMatchObject({ shown: 'model', chosen: true })
    boardActions.show('brief')
    boardActions.leaveTracing()
    boardActions.leaveScans()
    expect(boardStore.getState().shown).toBe('brief')
  })

  it('says which views have the 3D view under them: the model and the scans', () => {
    expect(inModel('model')).toBe(true)
    expect(inModel('scans')).toBe(true)
    expect(inModel('brief')).toBe(false)
    expect(inModel('tracing')).toBe(false)
  })

  it('remembers a tracing or scans as it does the board and the model', () => {
    const storage = memory()
    shownWrite(storage, 'a', 'tracing')
    expect(shownRead(storage, 'a')).toBe('tracing')
    shownWrite(storage, 'b', 'scans')
    expect(shownRead(storage, 'b')).toBe('scans')
  })
})

describe('the board store', () => {
  beforeEach(() => {
    boardActions.reset()
  })

  it('swaps with swap and shows what it is told', () => {
    boardActions.open('a', null)
    expect(boardStore.getState().shown).toBe('model')
    boardActions.swap({ scans: false, tracing: false })
    expect(boardStore.getState().shown).toBe('brief')
    boardActions.swap({ scans: false, tracing: false })
    expect(boardStore.getState().shown).toBe('model')
    boardActions.show('brief')
    expect(boardStore.getState().shown).toBe('brief')
  })

  it('opens a project on the model, and on the brief when the board first read has a card of the person there', () => {
    boardActions.open('a', null)
    expect(boardStore.getState()).toMatchObject({ objectId: 'a', board: null, shown: 'model' })
    boardActions.setBoard('a', board(card('C1', 'torno', 'brief'), card('C2', 'person')))
    expect(boardStore.getState().shown).toBe('brief')
    boardActions.open('b', null)
    boardActions.setBoard('b', board(card('C1', 'torno', 'brief')))
    expect(boardStore.getState().shown).toBe('model')
  })

  it('does not flip from the model to the brief when a card is added while the project is open', () => {
    boardActions.open('a', null)
    boardActions.setBoard('a', board(card('C1', 'torno', 'brief')))
    // The agent's first add_card, or a pin, comes in as a change main tells of: the person is at the model, and stays.
    boardActions.setBoard('a', board(card('C1', 'torno', 'brief'), card('C2', 'agent')))
    expect(boardStore.getState().shown).toBe('model')
  })

  it('does not take the default back once the person chose', () => {
    boardActions.open('a', null)
    boardActions.show('model')
    boardActions.setBoard('a', board(card('C2', 'person')))
    expect(boardStore.getState().shown).toBe('model')
  })

  it('holds what main found wrong with the board file until it is dismissed, for the open project only, and starts each project afresh', () => {
    boardActions.open('a', null)
    boardActions.setFileProblem({ objectId: 'b', message: 'not mine' })
    expect(boardStore.getState().fileProblem).toBeNull()
    boardActions.setFileProblem({ objectId: 'a', message: 'The board file could not be read.' })
    expect(boardStore.getState().fileProblem).toBe('The board file could not be read.')
    boardActions.dismissFileProblem()
    expect(boardStore.getState().fileProblem).toBeNull()
    boardActions.setFileProblem({ objectId: 'a', message: 'again' })
    boardActions.open('b', null)
    expect(boardStore.getState().fileProblem).toBeNull()
  })

  it('ignores the board of a project that is not the open one', () => {
    boardActions.open('a', null)
    boardActions.setBoard('b', board(card('C1', 'person')))
    expect(boardStore.getState().board).toBeNull()
  })

  it('selects, adds to a selection, and lets go of what a new board no longer has', () => {
    boardActions.open('a', null)
    boardActions.setBoard('a', board(card('C1', 'person'), card('C2', 'person'), card('C3', 'person')))
    boardActions.select(['C1'])
    boardActions.select(['C2'], true)
    expect(boardStore.getState().selected).toEqual(['C1', 'C2'])
    boardActions.select(['C2'], true)
    expect(boardStore.getState().selected).toEqual(['C1', 'C2'])
    boardActions.setBoard('a', board(card('C1', 'person')))
    expect(boardStore.getState().selected).toEqual(['C1'])
    boardActions.select([])
    expect(boardStore.getState().selected).toEqual([])
  })

  it('forgets the selection when another project opens', () => {
    boardActions.open('a', null)
    boardActions.setBoard('a', board(card('C1', 'person')))
    boardActions.select(['C1'])
    boardActions.open('b', null)
    expect(boardStore.getState()).toMatchObject({ objectId: 'b', board: null, selected: [] })
  })

  it('holds what main refused, and starts each project afresh', () => {
    boardActions.open('a', null)
    boardActions.say('The board holds 2000 cards.')
    expect(boardStore.getState()).toMatchObject({ problem: 'The board holds 2000 cards.' })
    boardActions.open('b', null)
    expect(boardStore.getState()).toMatchObject({ problem: null })
  })
})

describe('a board file kept aside', () => {
  it('is offered with the notice of the file, and goes with it', () => {
    boardActions.open('a', null)
    boardActions.setFileProblem({ objectId: 'a', message: 'could not be read', aside: true })
    expect(boardStore.getState()).toMatchObject({ fileProblem: 'could not be read', fileAside: true })
    boardActions.dismissFileProblem()
    expect(boardStore.getState()).toMatchObject({ fileProblem: null, fileAside: false })
    boardActions.setFileProblem({ objectId: 'a', message: 'not a plain file' })
    expect(boardStore.getState()).toMatchObject({ fileAside: false })
    boardActions.setFileProblem({ objectId: 'other', message: 'not this one', aside: true })
    expect(boardStore.getState().fileProblem).toBe('not a plain file')
  })
})

describe('putting a copy back', () => {
  const copy = (b: BoardFile) => b
  afterEach(() => vi.unstubAllGlobals())

  it('asks first when the brief holds cards made since, replaces when told to, and can take it back', async () => {
    const useAside = vi.fn(async (_id: string, replace?: boolean) => (replace ? board(card('C4', 'person')) : { made: 2 }))
    const undoAside = vi.fn(async () => copy(board(card('C1', 'person'), card('C2', 'agent'))))
    vi.stubGlobal('window', { torno: { board: { useAside, undoAside } } })
    boardActions.open('a', null)
    boardActions.setFileProblem({ objectId: 'a', message: 'could not be read', aside: true })
    await boardActions.useAside()
    expect(useAside).toHaveBeenLastCalledWith('a', false)
    expect(boardStore.getState()).toMatchObject({ asideAsk: 2, fileProblem: 'could not be read', putBack: false })
    boardActions.keepThisOne()
    expect(boardStore.getState()).toMatchObject({ asideAsk: null, fileProblem: 'could not be read' })
    await boardActions.useAside()
    await boardActions.useAside(true)
    expect(useAside).toHaveBeenLastCalledWith('a', true)
    expect(boardStore.getState()).toMatchObject({ asideAsk: null, fileProblem: null, fileAside: false, putBack: true })
    expect(boardStore.getState().board?.cards.map((c) => c.id)).toEqual(['C4'])
    await boardActions.undoAside()
    expect(boardStore.getState()).toMatchObject({ putBack: false })
    expect(boardStore.getState().board?.cards.map((c) => c.id)).toEqual(['C1', 'C2'])
  })

  it('says why a copy that cannot be read is not put back, and asks nothing', async () => {
    vi.stubGlobal('window', { torno: { board: { useAside: vi.fn(async () => { throw new Error("Error invoking remote method 'board:useAside': Error: still cannot be read whole") }) } } })
    boardActions.open('a', null)
    boardActions.setFileProblem({ objectId: 'a', message: 'could not be read', aside: true })
    await boardActions.useAside()
    expect(boardStore.getState()).toMatchObject({ problem: 'still cannot be read whole', asideAsk: null, putBack: false })
  })
})

describe('what goes with the next prompt', () => {
  beforeEach(() => {
    boardActions.reset()
    boardActions.open('a', null)
    const withArrow = { ...board(card('C1', 'person', 'frame'), card('C2', 'person'), card('C3', 'person')), arrows: [{ id: 'C4', from: 'C2', to: 'C3', by: 'person' as const }] }
    boardActions.setBoard('a', withArrow)
  })

  it('is the whole brief when asked, and is taken back off', () => {
    boardActions.attachAll()
    expect(boardStore.getState().attached).toEqual({ ids: 'all' })
    boardActions.detach()
    expect(boardStore.getState().attached).toBeNull()
  })

  it('goes with one prompt: taken when it is sent, and given back when it did not go', () => {
    boardActions.attachAll()
    const taken = boardActions.takeAttached()
    expect(taken).toEqual({ ids: 'all' })
    expect(boardStore.getState().attached).toBeNull()
    boardActions.giveBackAttached(taken!)
    expect(boardStore.getState().attached).toEqual({ ids: 'all' })
    // Not over what was attached since.
    boardActions.takeAttached()
    boardActions.attachAll()
    boardActions.giveBackAttached({ ids: ['C3'] })
    expect(boardStore.getState().attached).toEqual({ ids: 'all' })
  })

  it('is forgotten when another project opens', () => {
    boardActions.attachAll()
    boardActions.open('b', null)
    expect(boardStore.getState().attached).toBeNull()
  })
})

describe('a ref to a card in the chat', () => {
  beforeEach(() => {
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.setBoard('a', board(card('C1', 'person'), card('C2', 'person')))
  })

  it('shows the brief with that card lit, and no other', () => {
    boardActions.show('model')
    boardActions.select(['C1'])
    boardActions.reveal('C2')
    expect(boardStore.getState()).toMatchObject({ shown: 'brief', selected: ['C2'] })
  })

  it('shows nothing of a card the board has not', () => {
    boardActions.show('model')
    boardActions.reveal('C9')
    expect(boardStore.getState()).toMatchObject({ shown: 'model', selected: [] })
  })
})

describe('what the window keeps per project', () => {
  it('is let go when a workspace is opened or left: another workspace may have a project of the same name', () => {
    let forgotten = 0
    onBoardForgotten(() => (forgotten += 1))
    const off = onWorkspaceSet(forgetMemories)
    const epoch = memoryEpoch()
    actions.setWorkspace(null)
    off()
    expect(forgotten).toBe(1)
    expect(memoryEpoch()).toBe(epoch + 1)
  })
})

describe('the board main tells again', () => {
  it('keeps the card objects that did not change, so that they are not drawn again, and takes the ones that did', () => {
    const a = card('C1', 'person')
    const b = card('C2', 'person')
    const before = board(a, b)
    const after = sharing(before, JSON.parse(JSON.stringify({ ...before, cards: [a, { ...b, x: 50 }, card('C3', 'agent')] })) as BoardFile)
    expect(after.cards[0]).toBe(a)
    expect(after.cards[1]).not.toBe(b)
    expect(after.cards[1].x).toBe(50)
    expect(after.cards).toHaveLength(3)
    expect(sharing(null, before)).toBe(before)
  })

  it('gives setBoard the same card objects for a board that changed elsewhere', () => {
    boardActions.reset()
    boardActions.open('a', null)
    const one = board(card('C1', 'person'))
    boardActions.setBoard('a', one)
    const first = boardStore.getState().board!.cards[0]
    boardActions.setBoard('a', JSON.parse(JSON.stringify({ ...one, cards: [...one.cards, card('C2', 'person')] })) as BoardFile)
    expect(boardStore.getState().board!.cards[0]).toBe(first)
  })
})

describe('a part of the shelf opened in the main area (#352)', () => {
  it('is a fifth view: after the tracing in the swap, passed over when no part is open', () => {
    const has = { scans: true, tracing: true, part: true }
    expect(swapped('tracing', has)).toBe('part')
    expect(swapped('brief', { scans: false, tracing: false, part: true })).toBe('part')
    expect(swapped('scans', { scans: true, tracing: false, part: true })).toBe('part')
    expect(swapped('part', has)).toBe('model')
    expect(swapped('tracing', { scans: true, tracing: true })).toBe('model')
    expect(swapped('brief', { scans: false, tracing: false, part: false })).toBe('model')
  })

  it('has the 3D view away, as the brief does', () => {
    expect(inModel('part')).toBe(false)
  })

  it('opens a part: the row is lit, the page shown, and both are kept for the project', () => {
    const storage = memory()
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.openPart('ec11', storage)
    expect(store.getState().shelfOpen).toBe('ec11')
    expect(boardStore.getState()).toMatchObject({ shown: 'part', chosen: true })
    expect(partRead(storage, 'a')).toBe('ec11')
    expect(partRead(storage, 'b')).toBeNull()
  })

  it('closes it back to the model, and forgets the part', () => {
    const storage = memory()
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.openPart('ec11', storage)
    boardActions.closePart(storage)
    expect(store.getState().shelfOpen).toBeNull()
    expect(boardStore.getState().shown).toBe('model')
    expect(partRead(storage, 'a')).toBeNull()
  })

  it('closing the part leaves the brief on screen when that is what was shown', () => {
    const storage = memory()
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.openPart('ec11', storage)
    boardActions.show('brief')
    boardActions.closePart(storage)
    expect(boardStore.getState().shown).toBe('brief')
    expect(store.getState().shelfOpen).toBeNull()
  })

  it('opens a project on the page of its part again, when the window kept both', () => {
    const storage = memory()
    shownWrite(storage, 'a', 'part')
    partWrite(storage, 'a', 'ec11')
    boardActions.reset()
    boardActions.open('a', storage)
    expect(boardStore.getState()).toMatchObject({ shown: 'part', chosen: true })
    expect(store.getState().shelfOpen).toBe('ec11')
  })

  it('opens on the model when the page was kept and the part was not', () => {
    const storage = memory()
    shownWrite(storage, 'a', 'part')
    boardActions.reset()
    boardActions.open('a', storage)
    expect(boardStore.getState().shown).toBe('model')
  })

  it('reads no part id that is not one, and goes on with no storage', () => {
    const storage = memory()
    storage.data.set('torno.board.part', '{"a":"../x","b":3,"c":"ec11"}')
    expect(partRead(storage, 'a')).toBeNull()
    expect(partRead(storage, 'b')).toBeNull()
    expect(partRead(storage, 'c')).toBe('ec11')
    storage.data.set('torno.board.part', 'nonsense')
    expect(partRead(storage, 'c')).toBeNull()
    expect(partRead(null, 'a')).toBeNull()
    expect(() => partWrite(null, 'a', 'ec11')).not.toThrow()
  })
})
