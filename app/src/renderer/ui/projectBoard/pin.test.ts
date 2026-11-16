import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardFile } from '../../../shared/board'
import { pinnedSaid, pinToBoard } from './pin'

const board: BoardFile = { next: 2, cards: [{ id: 'C1', kind: 'params', x: 0, y: 0, w: 10, h: 10, by: 'person', source: 'params' }], arrows: [] }
let pin: ReturnType<typeof vi.fn>

beforeEach(() => {
  pin = vi.fn()
  vi.stubGlobal('window', { torno: { board: { pin } } })
})
afterEach(() => vi.unstubAllGlobals())

describe('pinning to the board', () => {
  it('says it is pinned, when main gives the board', async () => {
    pin.mockResolvedValue(board)
    expect(await pinToBoard('bracket', { kind: 'params' })).toBe('Pinned to the board')
    expect(pin).toHaveBeenCalledWith('bracket', { kind: 'params' })
  })

  it('says why not, in main’s words, when it refuses', async () => {
    pin.mockResolvedValue({ refused: 'The Params are on this board already.' })
    expect(await pinToBoard('bracket', { kind: 'params' })).toBe('The Params are on this board already.')
  })

  it('says why not when the call itself fails, without Electron’s wrapping', async () => {
    pin.mockRejectedValue(new Error("Error invoking remote method 'board:pin': Error: That project is not open."))
    expect(await pinToBoard('bracket', { kind: 'view', name: 'front' })).toBe('That project is not open.')
  })

  it('names a build, a view, the Params and the checks as the sentence does', () => {
    expect(pinnedSaid({ kind: 'build', id: 'h41' })).toBe('h41')
    expect(pinnedSaid({ kind: 'view', name: 'front' })).toBe('front')
    expect(pinnedSaid({ kind: 'params' })).toBe('the Params')
    expect(pinnedSaid({ kind: 'checks' })).toBe('the checks')
  })
})
