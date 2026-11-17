import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewMark, Mark } from '../../shared/marks'
import type { Round, RoundAsk, RoundsView } from '../../shared/reviews'
import { commitMark } from '../tools/pickMarks'
import { connectReview, reviewActions, reviewStore, roundsViewOf, withIntent } from './review'
import { store } from './store'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: '2026-11-17T10:00:00.000Z', ...over })
const pick = (over: object = {}): NewMark => ({ kind: 'pick', target: 'face', author: 'user', note: '', layout: 'default', revision: 1, camera: CAMERA, anchor: { point: [0, 0, 0], ref: 'lid/F1' }, ...over }) as unknown as NewMark

/** `window.torno.marks` as far as the review asks of it: what it was asked, and a state it answers with. */
function fake(answer: RoundsView = { rounds: [], sending: null }) {
  const asked: RoundAsk[] = []
  const added: Array<{ objectId: string; mark: NewMark }> = []
  const marks = {
    round: vi.fn(async (_objectId: string, ask: RoundAsk) => (asked.push(ask), answer)),
    rounds: vi.fn(async () => answer),
    add: vi.fn(async (objectId: string, mark: NewMark) => (added.push({ objectId, mark }), { ...mark, id: 'M1' } as unknown as Mark)),
    setIntent: vi.fn(async () => ({}) as Mark),
    judge: vi.fn(async () => ({}) as Mark),
    roundOut: vi.fn(async () => ({}) as Mark),
    onChanged: vi.fn(() => () => {})
  }
  vi.stubGlobal('window', { torno: { marks } })
  return { asked, added, marks }
}

beforeEach(() => {
  reviewStore.setState({ objectId: 'bracket', rounds: [], sending: null, choice: 'plain', panel: null, refused: null })
  store.setState({ objectId: 'bracket' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  reviewStore.setState({ objectId: null, rounds: [], sending: null, choice: 'plain', panel: null, refused: null })
  store.setState({ objectId: null })
})

describe('the intent the bar gives a new mark', () => {
  it('is the bar\'s choice while a round is open on that layout, and none on another layout', () => {
    reviewStore.setState({ rounds: [round()], choice: 'dont' })
    expect(reviewActions.intentForNew('default')).toBe('dont')
    expect(reviewActions.intentForNew('print')).toBeUndefined()
    reviewStore.setState({ choice: 'want' })
    expect(reviewActions.intentForNew('default')).toBe('want')
  })

  it('is none for plain, with no round, or once the round has ended', () => {
    reviewStore.setState({ rounds: [round()], choice: 'plain' })
    expect(reviewActions.intentForNew('default')).toBeUndefined()
    reviewStore.setState({ rounds: [], choice: 'dont' })
    expect(reviewActions.intentForNew('default')).toBeUndefined()
    reviewStore.setState({ rounds: [round({ endedAt: '2026-11-17T10:05:00.000Z' })], choice: 'dont' })
    expect(reviewActions.intentForNew('default')).toBeUndefined()
  })
})

describe('what a mark is made with', () => {
  it('says want or don\'t want of the person\'s mark, and a shape\'s own add or remove', () => {
    expect(withIntent(pick(), 'dont')).toMatchObject({ intent: 'dont' })
    expect(withIntent(pick(), 'want')).toMatchObject({ intent: 'want' })
    expect(withIntent(pick({ kind: 'shape', intent: 'keep-out' }), 'dont')).toMatchObject({ intent: 'remove' })
    expect(withIntent(pick({ kind: 'shape', intent: 'reference' }), 'want')).toMatchObject({ intent: 'add' })
  })

  it('leaves a measure and a "should be here" as they are: the bar does not apply to them', () => {
    const span = pick({ kind: 'span', tracing: 'T1' })
    const offset = pick({ kind: 'offset', tracing: 'T1' })
    for (const intent of ['dont', 'want'] as const) {
      expect(withIntent(span, intent)).toBe(span)
      expect(withIntent(offset, intent)).toBe(offset)
    }
    expect(withIntent(span, 'dont')).not.toHaveProperty('intent')
  })

  it('leaves a mark as it is for none, and the agent\'s alone', () => {
    const mark = pick()
    expect(withIntent(mark, undefined)).toBe(mark)
    const agents = pick({ author: 'agent' })
    expect(withIntent(agents, 'dont')).toBe(agents)
  })

  it('is what a pick made with the bar on don\'t want sends to main', async () => {
    const { added } = fake()
    reviewStore.setState({ rounds: [round()], choice: 'dont' })
    await commitMark('bracket', pick())
    expect(added).toHaveLength(1)
    expect(added[0].mark).toMatchObject({ kind: 'pick', intent: 'dont' })
  })

  it('is a pick as it was with the bar on plain, or no round open', async () => {
    const { added } = fake()
    reviewStore.setState({ rounds: [round()], choice: 'plain' })
    await commitMark('bracket', pick())
    reviewStore.setState({ rounds: [], choice: 'want' })
    await commitMark('bracket', pick())
    expect(added.map((a) => 'intent' in a.mark)).toEqual([false, false])
  })
})

describe('the round and what is asked of main', () => {
  it('starts a round on the layout shown, and takes its answer for the rounds', async () => {
    const { asked } = fake({ rounds: [round()], sending: null })
    await reviewActions.start('default')
    expect(asked).toEqual([{ start: { layout: 'default' } }])
    expect(reviewStore.getState().rounds).toEqual([round()])
  })

  it('ends, sends and lets go as plain marks by the round\'s id', async () => {
    const { asked } = fake({ rounds: [round()], sending: 'R1' })
    await reviewActions.end('R1')
    await reviewActions.send('R1')
    await reviewActions.plain('R1')
    expect(asked).toEqual([{ end: 'R1' }, { send: 'R1' }, { plain: 'R1' }])
    expect(reviewStore.getState().sending).toBe('R1')
  })

  it('opens a round that was ended again, and starts the next round from a sent one, by its id', async () => {
    const { asked } = fake({ rounds: [round({ endedAt: 'x', sentAt: 'y' }), round({ id: 'R2', from: 'R1' })], sending: null })
    reviewStore.setState({ panel: 'R1' })
    expect(await reviewActions.reopen('R2')).toBe(true)
    expect(await reviewActions.carry('R1')).toBe(true)
    expect(asked).toEqual([{ reopen: 'R2' }, { carry: 'R1' }])
    // The bar of the next round is what shows now: the panel of the one before is put away.
    expect(reviewStore.getState().panel).toBeNull()
  })

  it('keeps the panel when the next round was refused', async () => {
    vi.stubGlobal('window', { torno: { marks: { round: async () => Promise.reject(new Error('A build is running: review the build once it lands.')) } } })
    reviewStore.setState({ rounds: [round({ sentAt: 'y' })], panel: 'R1' })
    expect(await reviewActions.carry('R1')).toBe(false)
    expect(reviewStore.getState().panel).toBe('R1')
    expect(reviewStore.getState().refused).toContain('A build is running')
  })

  it('judges an item OK with no note, and Still wrong with the note, as the verdict of the person', async () => {
    const { marks } = fake()
    expect(await reviewActions.judge('M1', 'ok')).toBe(true)
    expect(await reviewActions.judge('M2', 'still-wrong', 'the rib is back')).toBe(true)
    expect(await reviewActions.judge('M3', 'still-wrong')).toBe(true)
    expect(marks.judge.mock.calls).toEqual([
      ['bracket', 'M1', 'ok'],
      ['bracket', 'M2', 'still-wrong', 'the rib is back'],
      ['bracket', 'M3', 'still-wrong']
    ])
  })

  it('says why main would not take a verdict', async () => {
    vi.stubGlobal('window', { torno: { marks: { judge: async () => Promise.reject(new Error('M1 was not resolved by the agent: there is nothing to judge')) } } })
    expect(await reviewActions.judge('M1', 'ok')).toBe(false)
    expect(reviewStore.getState().refused).toContain('nothing to judge')
  })

  it('says why main refused, and changes nothing', async () => {
    fake()
    vi.stubGlobal('window', { torno: { marks: { round: async () => Promise.reject(new Error('A build is running: review the build once it lands.')) } } })
    reviewStore.setState({ rounds: [round()] })
    await reviewActions.start('default')
    expect(reviewStore.getState().refused).toBe('A build is running: review the build once it lands.')
    expect(reviewStore.getState().rounds).toEqual([round()])
    reviewActions.choose('want')
    expect(reviewStore.getState().refused).toBeNull()
  })

  it('goes back to plain when the round is no longer open, and lets go of a panel of a round that is gone', () => {
    reviewStore.setState({ rounds: [round()], choice: 'dont', panel: 'R1' })
    reviewActions.told({ objectId: 'bracket', rounds: [round({ endedAt: 'x' })], sending: null })
    expect(reviewStore.getState().choice).toBe('plain')
    expect(reviewStore.getState().panel).toBe('R1')
    reviewActions.told({ objectId: 'bracket', rounds: [], sending: null })
    expect(reviewStore.getState().panel).toBeNull()
  })

  it('hears of the rounds of the project it has, and of no other', () => {
    reviewActions.told({ objectId: 'lid', rounds: [round()], sending: null })
    expect(reviewStore.getState().rounds).toEqual([])
    reviewActions.told({ objectId: 'bracket', rounds: [round()], sending: 'R1' })
    expect(reviewStore.getState()).toMatchObject({ rounds: [round()], sending: 'R1' })
  })

  it('toggles an intent: the key of the one chosen takes it back to plain', () => {
    reviewStore.setState({ rounds: [round()] })
    reviewActions.toggle('dont')
    expect(reviewStore.getState().choice).toBe('dont')
    reviewActions.toggle('want')
    expect(reviewStore.getState().choice).toBe('want')
    reviewActions.toggle('want')
    expect(reviewStore.getState().choice).toBe('plain')
  })

  it('opens a panel for a round and closes it', () => {
    reviewActions.openPanel('R1')
    expect(reviewStore.getState().panel).toBe('R1')
    reviewActions.openPanel(null)
    expect(reviewStore.getState().panel).toBeNull()
  })

  it('takes a mark out of its round, and says what main refused', async () => {
    const { marks } = fake()
    await reviewActions.takeOut('M3')
    expect(marks.roundOut).toHaveBeenCalledWith('bracket', 'M3')
    vi.stubGlobal('window', { torno: { marks: { roundOut: async () => Promise.reject(new Error('M3 is in no round')) } } })
    await reviewActions.takeOut('M3')
    expect(reviewStore.getState().refused).toBe('M3 is in no round')
  })

  it('sets what the person says of a mark, or none, through main', async () => {
    const { marks } = fake()
    await reviewActions.setIntent('M3', 'dont')
    await reviewActions.setIntent('M3', null)
    expect(marks.setIntent.mock.calls).toEqual([['bracket', 'M3', 'dont'], ['bracket', 'M3', null]])
  })
})

describe('the rounds a card or a row is told of', () => {
  it('are those of its project, with the one being sent, and none for another project', () => {
    reviewStore.setState({ rounds: [round()], sending: 'R1' })
    expect(roundsViewOf(reviewStore.getState(), 'bracket')).toEqual({ rounds: [round()], sending: 'R1' })
    expect(roundsViewOf(reviewStore.getState(), 'lid')).toBeUndefined()
  })
})

describe('joining the window to the project and to main', () => {
  it('reads the rounds of the project that opens, and forgets them when another opens', async () => {
    const { marks } = fake({ rounds: [round()], sending: null })
    store.setState({ objectId: null })
    reviewStore.setState({ objectId: null })
    const off = connectReview()
    store.setState({ objectId: 'bracket' })
    await vi.waitFor(() => expect(reviewStore.getState().rounds).toEqual([round()]))
    expect(marks.rounds).toHaveBeenCalledWith('bracket')
    reviewStore.setState({ choice: 'dont', panel: 'R1' })
    store.setState({ objectId: 'lid' })
    expect(reviewStore.getState()).toMatchObject({ objectId: 'lid', rounds: [], choice: 'plain', panel: null })
    off()
  })

  it('follows what main tells of the marks: their rounds and the one being sent', () => {
    let told: ((m: { objectId: string; marks: Mark[]; rounds: Round[]; sending: string | null }) => void) | undefined
    const { marks } = fake()
    marks.onChanged.mockImplementation(((cb: typeof told) => ((told = cb), () => {})) as never)
    const off = connectReview()
    told!({ objectId: 'bracket', marks: [], rounds: [round()], sending: 'R1' })
    expect(reviewStore.getState()).toMatchObject({ rounds: [round()], sending: 'R1' })
    off()
  })
})
