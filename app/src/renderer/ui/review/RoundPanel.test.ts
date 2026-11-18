import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../../../shared/history'
import type { Mark } from '../../../shared/marks'
import type { Round } from '../../../shared/reviews'
import { buttonsLabelled, elementsOf } from '../../../test/elements'
import { plainText } from '../../../test/plainText'
import { reviewStore } from '../../state/review'
import { store } from '../../state/store'
import { RoundPanel, RoundPanelView } from './RoundPanel'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const round = (over: Partial<Round> = {}): Round => ({ id: 'R1', build: 'h41', sources: 'abc', line: 'check it', layout: 'default', startedAt: 't', endedAt: 't', sentAt: 't', ...over })
const pick = (id: string, over: object = {}): Mark => ({ id, kind: 'pick', target: 'face', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, round: 'R1', ...over }) as unknown as Mark
const answered = (id: string, over: object = {}): Mark => pick(id, { intent: 'dont', status: 'resolved', resolvedBy: 'agent', resolvedNote: 'took the rib out', ...over })
const entry = (id: string, sources: string): HistoryEntry => ({ id, at: 't', run: 'r', revision: 1, sources, model: 'm.py', files: [], parts: 1, seconds: 1, line: '' }) as unknown as HistoryEntry

const view = (over: Partial<Parameters<typeof RoundPanelView>[0]> = {}) =>
  RoundPanelView({ round: round(), rounds: [round()], marks: [answered('M1', { note: 'the rib' }), pick('M2', { intent: 'want' })], history: [entry('h41', 'abc'), entry('h42', 'def')], sending: null, refused: null, wrong: null, onWrong: () => {}, ...over })
const markup = (over: Parameters<typeof view>[0] = {}): string => renderToStaticMarkup(view(over))

afterEach(() => {
  vi.unstubAllGlobals()
  reviewStore.setState({ objectId: null, rounds: [], sending: null, choice: 'plain', panel: null, refused: null })
  store.setState({ marks: [], objectId: null })
})

describe('the items of a round', () => {
  it('names the round and lists each item with its chip, its note and what Claude said', () => {
    const text = plainText(markup())
    expect(text).toContain('Review of h41 · 1 − · 1 +')
    expect(text).toContain('−M1')
    expect(text).toContain('the rib')
    expect(text).toContain('took the rib out')
    expect(text).toContain('+M2')
  })

  it('has a 22 px column for the sign, then the words, then a muted line with what the item is on', () => {
    const out = markup({ marks: [answered('M1', { note: 'the rib', anchor: { point: [0, 0, 0], ref: 'plate/F3' } }), pick('M2', { intent: 'want' })] })
    const first = out.match(/<li class="round-item" data-mark="M1"[^>]*>.*?<\/li>/)![0]
    expect(first.indexOf('round-item-sign')).toBeLessThan(first.indexOf('the rib'))
    expect(first.indexOf('the rib')).toBeLessThan(first.indexOf('round-item-where'))
    expect(first).toMatch(/<span class="round-item-sign"><span class="sign-disc num" data-sign="-"[^>]*>−<\/span><\/span>/)
    expect(first).toMatch(/<span class="round-item-where num">plate\/F3<\/span>/)
    // An item on nothing a name can be given to has no such line.
    expect(out.match(/<li class="round-item" data-mark="M2"[^>]*>.*?<\/li>/)![0]).not.toContain('round-item-where')
  })

  it('has OK and Still wrong for an item Claude resolved, and says Not answered yet of one it did not', () => {
    const out = view()
    expect(buttonsLabelled(out, 'OK')).toHaveLength(1)
    expect(buttonsLabelled(out, 'Still wrong')).toHaveLength(1)
    expect(plainText(markup())).toContain('Not answered yet')
  })

  it('says OK (accepted) of an item acknowledged through "OK all", with no buttons for it', () => {
    const out = view({ marks: [answered('M1', { acknowledged: true })] })
    expect(plainText(renderToStaticMarkup(out))).toContain('OK (accepted)')
    expect(buttonsLabelled(out, 'OK')).toHaveLength(0)
  })

  it('says OK in the build it was judged on, and Still wrong', () => {
    const text = plainText(markup({ marks: [answered('M1', { acknowledged: true, judged: { verdict: 'ok', build: 'h42' } }), pick('M2', { status: 'draft', judged: { verdict: 'still-wrong', build: 'h42' } })] }))
    expect(text).toContain('OK in h42')
    expect(text).toContain('Still wrong')
  })

  it('asks main for OK of the item, and for Still wrong only once the person has chosen it and may add a note', async () => {
    const judge = vi.fn(async () => ({}) as Mark)
    vi.stubGlobal('window', { torno: { marks: { judge } } })
    reviewStore.setState({ objectId: 'bracket' })
    const [ok] = buttonsLabelled(view(), 'OK')
    await (ok.props.onClick as () => Promise<void>)()
    expect(judge).toHaveBeenLastCalledWith('bracket', 'M1', 'ok')
    // Still wrong opens a field for the note: nothing is asked of main yet.
    const onWrong = vi.fn()
    const [wrong] = buttonsLabelled(view({ onWrong }), 'Still wrong')
    ;(wrong.props.onClick as () => void)()
    expect(onWrong).toHaveBeenCalledWith({ id: 'M1', note: '' })
    expect(judge).toHaveBeenCalledTimes(1)
    const open = view({ wrong: { id: 'M1', note: 'it is back' } })
    const field = elementsOf(open).find((el) => el.type === 'textarea')
    expect(field?.props.value).toBe('it is back')
    const [send] = buttonsLabelled(open, 'Send back')
    await (send.props.onClick as () => Promise<void>)()
    expect(judge).toHaveBeenLastCalledWith('bracket', 'M1', 'still-wrong', 'it is back')
  })

  it('asks for Still wrong with no note when none was written', async () => {
    const judge = vi.fn(async () => ({}) as Mark)
    vi.stubGlobal('window', { torno: { marks: { judge } } })
    reviewStore.setState({ objectId: 'bracket' })
    const [send] = buttonsLabelled(view({ wrong: { id: 'M1', note: '  ' } }), 'Send back')
    await (send.props.onClick as () => Promise<void>)()
    expect(judge).toHaveBeenLastCalledWith('bracket', 'M1', 'still-wrong')
  })
})

describe('the round in the head of the card', () => {
  it('is the head of the card: its container says so, and it keeps its words', () => {
    const out = markup()
    expect(out).toMatch(/^<section[^>]*data-head="review"/)
    expect(plainText(out)).toContain('Review of h41')
  })
})

describe('the round that has not gone', () => {
  const unsent = round({ sentAt: undefined, endedAt: undefined })
  const open = (over: Partial<Parameters<typeof RoundPanelView>[0]> = {}) => view({ round: unsent, rounds: [unsent], ...over })

  it('says it goes as one prompt, and tells how to comment a stroke, while it is open', () => {
    const text = plainText(renderToStaticMarkup(open()))
    expect(text).toContain('goes as one prompt')
    expect(text).toContain('Comment a stroke by clicking it')
  })

  it('says neither once the round has gone', () => {
    const text = plainText(markup())
    expect(text).not.toContain('goes as one prompt')
    expect(text).not.toContain('Comment a stroke by clicking it')
    expect(buttonsLabelled(view(), 'Send review')).toHaveLength(0)
  })

  it('has Send review, which asks main to send the round as the bar does, and none with no items, being sent or let go as plain marks', async () => {
    const asked: unknown[] = []
    vi.stubGlobal('window', { torno: { marks: { round: vi.fn(async (_id: string, ask: unknown) => (asked.push(ask), { rounds: [unsent], sending: 'R1' })) } } })
    reviewStore.setState({ objectId: 'bracket' })
    await (buttonsLabelled(open(), 'Send review')[0].props.onClick as () => Promise<void>)()
    expect(asked).toEqual([{ send: 'R1' }])
    expect(buttonsLabelled(open({ marks: [] }), 'Send review')).toHaveLength(0)
    expect(buttonsLabelled(open({ sending: 'R1' }), 'Send review')).toHaveLength(0)
    const plain = round({ sentAt: undefined, plain: 't' } as Partial<Round>)
    expect(buttonsLabelled(view({ round: plain, rounds: [plain] }), 'Send review')).toHaveLength(0)
  })
})

describe('Compare in the panel', () => {
  it('says the reviewed build is shown beside the live one when the history keeps it', () => {
    expect(plainText(markup())).toContain('h41 is shown faint beside h42')
  })

  it('says the reviewed build is not on this computer when its h41 has other sources', () => {
    const text = plainText(markup({ history: [entry('h41', 'zzz'), entry('h42', 'def')] }))
    expect(text).toContain('the reviewed build is not on this computer')
    expect(text).not.toContain('shown faint')
  })

  it('says the build is no longer kept when the history has no h41', () => {
    expect(plainText(markup({ history: [entry('h42', 'def')] }))).toContain('the build is no longer kept')
  })

  it('says nothing of Compare until the history is read', () => {
    const text = plainText(markup({ history: undefined }))
    expect(text).not.toContain('Compare')
    expect(text).not.toContain('shown faint')
  })
})

describe('what is done with the round', () => {
  it('starts round 2 from a round that was sent, by asking to carry it', async () => {
    const asked: unknown[] = []
    vi.stubGlobal('window', { torno: { marks: { round: vi.fn(async (_id: string, ask: unknown) => (asked.push(ask), { rounds: [round(), round({ id: 'R2', from: 'R1', endedAt: undefined, sentAt: undefined })], sending: null })) } } })
    reviewStore.setState({ objectId: 'bracket' })
    const [start] = buttonsLabelled(view(), 'Start round 2')
    await (start.props.onClick as () => Promise<void>)()
    expect(asked).toEqual([{ carry: 'R1' }])
  })

  it('numbers the next round by how many came before, and offers none while a round is open or before this one was sent', () => {
    const next = round({ id: 'R2', from: 'R1' })
    expect(buttonsLabelled(view({ round: next, rounds: [round(), next] }), 'Start round 3')).toHaveLength(1)
    expect(buttonsLabelled(view({ rounds: [round(), round({ id: 'R2', endedAt: undefined, sentAt: undefined })] }), 'Start round 2')).toHaveLength(0)
    expect(buttonsLabelled(view({ round: round({ sentAt: undefined }), rounds: [round({ sentAt: undefined })] }), 'Start round 2')).toHaveLength(0)
  })

  it('offers "Send as plain marks" and opening it again while the round is unsent, and neither once it is sent', async () => {
    const unsent = round({ sentAt: undefined })
    const asked: unknown[] = []
    vi.stubGlobal('window', { torno: { marks: { round: vi.fn(async (_id: string, ask: unknown) => (asked.push(ask), { rounds: [unsent], sending: null })) } } })
    reviewStore.setState({ objectId: 'bracket' })
    const out = view({ round: unsent, rounds: [unsent] })
    await (buttonsLabelled(out, 'Send as plain marks')[0].props.onClick as () => Promise<void>)()
    await (buttonsLabelled(out, 'Open again')[0].props.onClick as () => Promise<void>)()
    expect(asked).toEqual([{ plain: 'R1' }, { reopen: 'R1' }])
    expect(buttonsLabelled(view(), 'Send as plain marks')).toHaveLength(0)
    expect(buttonsLabelled(view(), 'Open again')).toHaveLength(0)
  })

  it('offers no way to let a round go while it is being sent, and none to open it while it is open', () => {
    const unsent = round({ sentAt: undefined })
    expect(buttonsLabelled(view({ round: unsent, rounds: [unsent], sending: 'R1' }), 'Send as plain marks')).toHaveLength(0)
    const open = round({ sentAt: undefined, endedAt: undefined })
    expect(buttonsLabelled(view({ round: open, rounds: [open] }), 'Open again')).toHaveLength(0)
  })

  it('says what main refused', () => {
    expect(plainText(markup({ refused: 'R1 was sent already' }))).toContain('R1 was sent already')
  })
})

describe('the panel in the window', () => {
  it('is not there while none is asked for, and is the round that is, while it is', () => {
    const show = (): string => {
      const review = vi.spyOn(reviewStore, 'getInitialState').mockReturnValue(reviewStore.getState())
      const main = vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState())
      try {
        return renderToStaticMarkup(createElement(RoundPanel))
      } finally {
        review.mockRestore()
        main.mockRestore()
      }
    }
    reviewStore.setState({ objectId: 'bracket', rounds: [round()], panel: null })
    expect(show()).toBe('')
    reviewStore.setState({ panel: 'R1' })
    store.setState({ marks: [answered('M1')] })
    expect(plainText(show())).toContain('Review of h41')
  })
})
