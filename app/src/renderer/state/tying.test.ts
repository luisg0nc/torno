import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyBoard, type BoardFile, type Card } from '../../shared/board'
import type { DimensionMark } from '../../shared/marks'
import { boardActions, boardStore } from './board'
import { measuredStore, type Held } from './measured'
import { toolStore } from './tools'
import { heldRefusal, keepHeldAndTie, toleranceOf, tyingActions, tyingStore } from './tying'

const size = (over: Partial<NonNullable<Card['size']>> = {}): Card => ({
  id: 'C7',
  kind: 'size',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  by: 'person',
  size: { what: 'over both holes', value: '28.6', unit: 'mm', source: 'measured', ...over }
})
const file = (...cards: Card[]): BoardFile => ({ ...emptyBoard(), cards })
const held = (over: Partial<Held> = {}): Held => ({ objectId: 'bracket', layout: 'assembled', revision: 3, camera: {} as Held['camera'], measure: 'distance', a: {} as Held['a'], value: 28.9, how: 'edge to edge', ...over })

let tie: ReturnType<typeof vi.fn>
beforeEach(() => {
  tie = vi.fn(async (_o: string, _c: string, _m: string | null, _t?: number) => file(size()))
  vi.stubGlobal('window', { torno: { board: { tie } } })
  boardStore.setState({ objectId: 'bracket', board: file(size()), shown: 'brief' })
  measuredStore.getState().clearHeld()
  toolStore.setState({ tool: 'select' })
})
afterEach(() => {
  tyingActions.end(null)
  vi.unstubAllGlobals()
})

describe('tying a size by measuring', () => {
  it('shows the model with Measure in hand, and holds the size and the tolerance its source gives', () => {
    tyingActions.begin('bracket', size())
    expect(boardStore.getState().shown).toBe('model')
    expect(toolStore.getState().tool).toBe('measure')
    expect(tyingStore.getState().tying).toEqual({ objectId: 'bracket', cardId: 'C7', tolerance: '0.5' })
    tyingActions.end()
    expect(tyingStore.getState().tying).toBeNull()
    expect(boardStore.getState().shown).toBe('brief')
    expect(toolStore.getState().tool).toBe('select')
    expect(tie).not.toHaveBeenCalled()
  })

  it('ends with no change when the person goes to the brief, or to another project, or the size goes', () => {
    tyingActions.begin('bracket', size())
    boardActions.show('brief')
    expect(tyingStore.getState().tying).toBeNull()
    tyingActions.begin('bracket', size())
    boardStore.setState({ board: file() })
    expect(tyingStore.getState().tying).toBeNull()
    tyingActions.begin('bracket', size())
    boardStore.setState({ objectId: 'other' })
    expect(tyingStore.getState().tying).toBeNull()
    expect(tie).not.toHaveBeenCalled()
  })

  it('ties to the dimension with the tolerance of the head, and goes back to the brief', async () => {
    tyingActions.begin('bracket', size())
    tyingActions.setTolerance('0.3')
    expect(await tyingActions.tieTo('M9')).toBe(true)
    expect(tie).toHaveBeenCalledWith('bracket', 'C7', 'M9', 0.3)
    expect(tyingStore.getState().tying).toBeNull()
    expect(boardStore.getState().shown).toBe('brief')
  })

  it('stays on what main refused, and says it', async () => {
    tie.mockRejectedValueOnce(new Error("Error invoking remote method 'board:tie': Error: M9 already checks C2."))
    tyingActions.begin('bracket', size())
    expect(await tyingActions.tieTo('M9')).toBe(false)
    expect(boardStore.getState().problem).toBe('M9 already checks C2.')
    expect(tyingStore.getState().tying).not.toBeNull()
  })

  it('does not ask main for a tolerance that is no number', async () => {
    tyingActions.begin('bracket', size())
    tyingActions.setTolerance('about 1')
    expect(await tyingActions.tieTo('M9')).toBe(false)
    expect(tie).not.toHaveBeenCalled()
    expect(toleranceOf('0,25')).toBe(0.25)
    expect(toleranceOf('-1')).toBeTypeOf('string')
    expect(toleranceOf(' ')).toBeTypeOf('string')
  })

  it('keeps the measurement as a dimension and ties it, in one go', async () => {
    tyingActions.begin('bracket', size())
    measuredStore.getState().setHeld(held())
    const commit = vi.fn(async () => ({ id: 'M9', kind: 'dimension' }) as unknown as DimensionMark)
    expect((await keepHeldAndTie(commit))?.id).toBe('M9')
    expect(commit).toHaveBeenCalledOnce()
    expect(tie).toHaveBeenCalledWith('bracket', 'C7', 'M9', 0.5)
    expect(tyingStore.getState().tying).toBeNull()
  })

  it('does not keep a measurement that could not check the size', async () => {
    boardStore.setState({ board: file(size({ value: 'Ø6.6' })) })
    tyingActions.begin('bracket', size({ value: 'Ø6.6' }))
    measuredStore.getState().setHeld(held({ measure: 'distance' }))
    const commit = vi.fn()
    await expect(keepHeldAndTie(commit)).rejects.toThrow(/diameter/)
    expect(commit).not.toHaveBeenCalled()
    expect(heldRefusal(size({ value: 'Ø6.6' }), { measure: 'diameter' })).toBeNull()
  })

  it('keeps as a plain dimension when no size is being tied', async () => {
    measuredStore.getState().setHeld(held())
    const commit = vi.fn(async () => ({ id: 'M2', kind: 'dimension' }) as unknown as DimensionMark)
    await keepHeldAndTie(commit)
    expect(tie).not.toHaveBeenCalled()
  })
})
