import { beforeEach, describe, expect, it } from 'vitest'
import { emptyBoard, type BoardFile, type Card } from '../../shared/board'
import { boardActions, boardStore, defaultShown, forgetMemories, memoryEpoch, onBoardForgotten, sharing, SHOWN_KEY, shownRead, shownWrite, swapped } from './board'
import { actions, onWorkspaceSet } from './store'

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
    expect(defaultShown(board(card('C1', 'torno', 'brief'), card('C2', 'person')))).toBe('board')
    expect(defaultShown(board(card('C1', 'agent')))).toBe('board')
  })

  it('does not count a hidden card of main as a card of the person', () => {
    expect(defaultShown(board({ ...card('C1', 'torno'), hidden: true }))).toBe('model')
  })
})

describe('what the window remembers', () => {
  it('keeps the choice per project, and reads nothing it does not understand', () => {
    const storage = memory()
    expect(shownRead(storage, 'a')).toBeNull()
    shownWrite(storage, 'a', 'board')
    shownWrite(storage, 'b', 'model')
    expect(shownRead(storage, 'a')).toBe('board')
    expect(shownRead(storage, 'b')).toBe('model')
    expect(shownRead(storage, 'c')).toBeNull()
    storage.data.set(SHOWN_KEY, '{"a":"elsewhere","b":3}')
    expect(shownRead(storage, 'a')).toBeNull()
    expect(shownRead(storage, 'b')).toBeNull()
    storage.data.set(SHOWN_KEY, 'not json')
    expect(shownRead(storage, 'a')).toBeNull()
  })

  it('goes on with no storage, or one that refuses', () => {
    expect(shownRead(null, 'a')).toBeNull()
    expect(() => shownWrite(null, 'a', 'board')).not.toThrow()
    const refusing = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') } }
    expect(shownRead(refusing, 'a')).toBeNull()
    expect(() => shownWrite(refusing, 'a', 'board')).not.toThrow()
  })
})

describe('the swap of the main area', () => {
  it('goes board, model, tracing, board, and passes over Tracing in a project with none', () => {
    expect(swapped('board', true)).toBe('model')
    expect(swapped('model', true)).toBe('tracing')
    expect(swapped('tracing', true)).toBe('board')
    expect(swapped('board', false)).toBe('model')
    expect(swapped('model', false)).toBe('board')
    // Left on a tracing that is gone: on to the board.
    expect(swapped('tracing', false)).toBe('board')
  })

  it('shows the tracing in turn, and keeps the choice of it for the project', () => {
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.swap(true)
    expect(boardStore.getState().shown).toBe('tracing')
    boardActions.swap(true)
    expect(boardStore.getState().shown).toBe('board')
    boardActions.swap(true)
    expect(boardStore.getState().shown).toBe('model')
  })

  it('leaves a tracing that is not there for the model, without taking the choice back', () => {
    boardActions.reset()
    boardActions.open('a', null)
    boardActions.show('tracing')
    boardActions.leaveTracing()
    expect(boardStore.getState()).toMatchObject({ shown: 'model', chosen: true })
    boardActions.show('board')
    boardActions.leaveTracing()
    expect(boardStore.getState().shown).toBe('board')
  })

  it('remembers a tracing as it does the board and the model', () => {
    const storage = memory()
    shownWrite(storage, 'a', 'tracing')
    expect(shownRead(storage, 'a')).toBe('tracing')
  })
})

describe('the board store', () => {
  beforeEach(() => {
    boardActions.reset()
  })

  it('swaps with swap and shows what it is told', () => {
    boardActions.open('a', null)
    expect(boardStore.getState().shown).toBe('model')
    boardActions.swap(false)
    expect(boardStore.getState().shown).toBe('board')
    boardActions.swap(false)
    expect(boardStore.getState().shown).toBe('model')
    boardActions.show('board')
    expect(boardStore.getState().shown).toBe('board')
  })

  it('opens a project on the model, and on the board when the board first read has a card of the person there', () => {
    boardActions.open('a', null)
    expect(boardStore.getState()).toMatchObject({ objectId: 'a', board: null, shown: 'model' })
    boardActions.setBoard('a', board(card('C1', 'torno', 'brief'), card('C2', 'person')))
    expect(boardStore.getState().shown).toBe('board')
    boardActions.open('b', null)
    boardActions.setBoard('b', board(card('C1', 'torno', 'brief')))
    expect(boardStore.getState().shown).toBe('model')
  })

  it('does not flip from the model to the board when a card is added while the project is open', () => {
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

  it('keeps an arrow in the selection, and lets go of one that is gone', () => {
    boardActions.open('a', null)
    const withArrow = { ...board(card('C1', 'person'), card('C2', 'person')), arrows: [{ id: 'C3', from: 'C1', to: 'C2', by: 'person' as const }] }
    boardActions.setBoard('a', withArrow)
    boardActions.select(['C3'])
    boardActions.setBoard('a', { ...withArrow })
    expect(boardStore.getState().selected).toEqual(['C3'])
    boardActions.setBoard('a', { ...withArrow, arrows: [] })
    expect(boardStore.getState().selected).toEqual([])
  })

  it('holds the tool, what is being written and what main refused, and starts each project afresh', () => {
    boardActions.open('a', null)
    boardActions.setTool('arrow')
    boardActions.edit({ kind: 'word', id: 'C3' })
    boardActions.say('The board holds 2000 cards.')
    expect(boardStore.getState()).toMatchObject({ tool: 'arrow', editing: { kind: 'word', id: 'C3' }, problem: 'The board holds 2000 cards.' })
    boardActions.open('b', null)
    expect(boardStore.getState()).toMatchObject({ tool: 'select', editing: null, problem: null })
  })
})

describe('what goes with the next prompt', () => {
  beforeEach(() => {
    boardActions.reset()
    boardActions.open('a', null)
    const withArrow = { ...board(card('C1', 'person', 'frame'), card('C2', 'person'), card('C3', 'person')), arrows: [{ id: 'C4', from: 'C2', to: 'C3', by: 'person' as const }] }
    boardActions.setBoard('a', withArrow)
  })

  it('is the cards and frames selected, and never an arrow', () => {
    boardActions.select(['C1', 'C2', 'C4'])
    expect(boardActions.attachSelected()).toBe(true)
    expect(boardStore.getState().attached).toEqual({ ids: ['C1', 'C2'] })
  })

  it('is nothing when only an arrow, or nothing, is selected', () => {
    expect(boardActions.attachSelected()).toBe(false)
    boardActions.select(['C4'])
    expect(boardActions.attachSelected()).toBe(false)
    expect(boardStore.getState().attached).toBeNull()
  })

  it('is the whole board when asked, and is taken back off', () => {
    boardActions.attachAll()
    expect(boardStore.getState().attached).toEqual({ ids: 'all' })
    boardActions.detach()
    expect(boardStore.getState().attached).toBeNull()
  })

  it('goes with one prompt: taken when it is sent, and given back when it did not go', () => {
    boardActions.select(['C2'])
    boardActions.attachSelected()
    const taken = boardActions.takeAttached()
    expect(taken).toEqual({ ids: ['C2'] })
    expect(boardStore.getState().attached).toBeNull()
    boardActions.giveBackAttached(taken!)
    expect(boardStore.getState().attached).toEqual({ ids: ['C2'] })
    // Not over what was attached since.
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

  it('shows the board with that card selected, and no other', () => {
    boardActions.show('model')
    boardActions.select(['C1'])
    boardActions.reveal('C2')
    expect(boardStore.getState()).toMatchObject({ shown: 'board', selected: ['C2'] })
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
