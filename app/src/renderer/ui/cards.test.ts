import { describe, expect, it } from 'vitest'
import type { ObjectCard } from '../../shared/show'
import { ago, buildLine, cardChips, matching, pictureLine, sizeLine, stepCard, waitedFor, workLine } from './cards'

const card = (over: Partial<ObjectCard> = {}): ObjectCard => ({ id: 'tub', name: 'tub', opened: true, build: { status: 'ok', revision: 3, stale: false }, thumb: null, marks: { open: 0, drafts: 0 }, dimensions: null, session: null, ...over })

describe('what a card says of its build', () => {
  it('says the build of this run, and nothing of a build for an object not opened in it', () => {
    expect(buildLine(card())).toEqual({ text: 'Built, r3', standing: 'ok' })
    expect(buildLine(card({ build: { status: 'building', revision: 3, stale: true } }))).toEqual({ text: 'Building…', standing: 'building' })
    expect(buildLine(card({ build: { status: 'idle', revision: 0, stale: false } }))).toEqual({ text: 'Not built yet', standing: 'idle' })
    expect(buildLine(card({ opened: false, build: undefined }))).toEqual({ text: 'Not opened in this run' })
  })

  it('says when the model was saved for an object not opened in this run, from the files alone', () => {
    const now = Date.parse('2026-11-04T12:00:00Z')
    const said = buildLine(card({ opened: false, build: undefined, sourcesMtimeMs: now - 3 * 3_600_000 }), now)
    expect(said).toEqual({ text: 'Model saved 3 h ago', title: 'Not opened in this run' })
    expect(ago(30_000)).toBe('just now')
    expect(ago(5 * 60_000)).toBe('5 min ago')
    expect(ago(26 * 3_600_000)).toBe('1 day ago')
    expect(ago(90 * 86_400_000)).toBe('3 months ago')
    expect(ago(800 * 86_400_000)).toBe('2 years ago')
  })

  it('says the size the kernel gave, with a sign when it is the mesh\'s and not the B-rep\'s, and none where the page has no picture of it', () => {
    const thumb = { at: '2026-11-01T10:00:00.000Z', layout: 'assembly', behind: false, bench: true as const }
    expect(sizeLine(card({ thumb, box: { x: 150, y: 80, z: 92, exact: true } }))).toBe('150 × 80 × 92 mm')
    expect(sizeLine(card({ thumb, box: { x: 150.04, y: 80, z: 91.9996, exact: false } }))).toBe('≈ 150 × 80 × 92 mm')
    expect(sizeLine(card({ thumb }))).toBeNull()
    expect(sizeLine(card({ box: { x: 1, y: 2, z: 3, exact: true } }))).toBeNull()
  })

  it('says how long a question has waited, and what a project that works is doing', () => {
    expect(waitedFor(20_000)).toBe('waiting under 1 min')
    expect(waitedFor(4 * 60_000 + 5000)).toBe('waiting 4 min')
    expect(waitedFor(3 * 3_600_000)).toBe('waiting 3 h')
    expect(waitedFor(49 * 3_600_000)).toBe('waiting 2 days')
    expect(workLine(card({ build: { status: 'building', revision: 1, stale: true } }))).toBe('Building…')
    expect(workLine(card({ session: 'working' }))).toBe('Claude Code is working')
  })

  it('says a failure with its first line, in the colour of one, and that a build was let go', () => {
    expect(buildLine(card({ build: { status: 'failed', revision: 3, stale: true, error: 'NameError: name x is not defined' } }))).toEqual({ text: 'Failed: NameError: name x is not defined', tone: 'fail', standing: 'failed' })
    expect(buildLine(card({ build: { status: 'failed', revision: 0, stale: false } }))).toEqual({ text: 'Failed', tone: 'fail', standing: 'failed' })
    expect(buildLine(card({ build: { status: 'ok', revision: 3, stale: false, letGo: 'memory' } }))).toEqual({ text: 'Let go to make room: built again when opened', standing: 'idle' })
    expect(buildLine(card({ build: { status: 'building', revision: 3, stale: false, letGo: 'memory' } }))).toEqual({ text: 'Building…', standing: 'building' })
  })

  it('says why an object cannot be built in place of all of it', () => {
    expect(buildLine(card({ opened: false, build: undefined, problem: 'no model file in /ws/tub' }))).toEqual({ text: 'no model file in /ws/tub' })
  })
})

describe('what a card says of its picture', () => {
  const thumb = { at: '2026-10-08T21:14:03', layout: 'assembly', behind: false }
  const NOW = new Date('2026-10-10T02:00:00')

  it('says when the picture was made, and nothing for none', () => {
    expect(pictureLine(card(), NOW)).toBeNull()
    expect(pictureLine(card({ thumb }), NOW)).toEqual({ text: 'Picture of 8 Oct, 21:14', behind: false })
    expect(pictureLine(card({ thumb: { ...thumb, at: 'last week' } }), NOW)).toEqual({ text: 'Picture of an unknown day', behind: false })
    // Of another year than this one: said with its year, or last October's reads as this one's.
    expect(pictureLine(card({ thumb }), new Date('2027-03-01T10:00:00'))!.text).toBe('Picture of 8 Oct 2026, 21:14')
  })

  it('says that a source has changed since, and what the picture draws otherwise than the object is', () => {
    expect(pictureLine(card({ thumb: { ...thumb, behind: true } }), NOW)).toEqual({ text: 'Picture of 8 Oct, 21:14', behind: true })
    expect(pictureLine(card({ thumb: { ...thumb, cut: true, hidden: 1 } }), NOW)!.text).toBe('Picture of 8 Oct, 21:14, cut by its section, 1 part left out')
    expect(pictureLine(card({ thumb: { ...thumb, apart: true, hidden: 2 } }), NOW)!.text).toBe('Picture of 8 Oct, 21:14, parts drawn apart, 2 parts left out')
  })

  it('says of which build the picture is when the last one failed', () => {
    expect(pictureLine(card({ thumb, build: { status: 'failed', revision: 3, stale: true, error: 'x' } }), NOW)!.text).toBe('Picture of 8 Oct, 21:14, of the last build that worked')
  })
})

describe('the chips of a card', () => {
  it('has none for an object with nothing open on it', () => {
    expect(cardChips(card())).toEqual([])
  })

  it('counts the open marks and those not sent, and says when the marks could not be read', () => {
    expect(cardChips(card({ marks: { open: 2, drafts: 1 } })).map((c) => c.text)).toEqual(['2 open marks', '1 not sent yet'])
    expect(cardChips(card({ marks: { open: 1, drafts: 0 } })).map((c) => c.text)).toEqual(['1 open mark'])
    expect(cardChips(card({ marks: null }))).toEqual([{ text: 'Marks could not be read', tone: 'warn' }])
  })

  it('says how the dimensions stand on the build of this run', () => {
    expect(cardChips(card({ marks: { open: 6, drafts: 0 }, dimensions: { failing: 1, unmeasured: 2, passing: 3 } }))).toEqual([
      { text: '6 open marks' },
      { text: '1 dimension fails', tone: 'fail' },
      { text: '2 not measured' },
      { text: '3 pass', tone: 'ok' }
    ])
    expect(cardChips(card({ marks: { open: 2, drafts: 0 }, dimensions: { failing: 2, unmeasured: 0, passing: 0 } }))[1]).toEqual({ text: '2 dimensions fail', tone: 'fail' })
  })

  it('never gives a verdict of a build that is not of this run: what was is said as what was', () => {
    const before = cardChips(card({ opened: false, build: undefined, marks: { open: 3, drafts: 0 }, lastRun: { dimensions: 3, failed: 1 } }))
    expect(before).toEqual([{ text: '3 open marks' }, { text: '1 dimension failed as of its last run' }])
    const none = cardChips(card({ opened: false, build: undefined, marks: { open: 2, drafts: 0 }, lastRun: { dimensions: 2, failed: 0 } }))
    expect(none[1]).toEqual({ text: '2 dimensions, not measured in this run' })
    expect([...before, ...none].some((chip) => chip.tone === 'ok' || chip.tone === 'fail')).toBe(false)
  })

  it('says where the session stands, and nothing of one that has ended', () => {
    expect(cardChips(card({ session: 'working' }))).toEqual([{ text: 'Session working' }])
    expect(cardChips(card({ session: 'needs_input' }))).toEqual([{ text: 'Session needs you', tone: 'warn' }])
    expect(cardChips(card({ session: 'idle' }))).toEqual([{ text: 'Session idle' }])
    expect(cardChips(card({ session: 'starting' }))).toEqual([{ text: 'Session starting' }])
    expect(cardChips(card({ session: 'exited' }))).toEqual([])
  })
})

it('keeps the cards whose name holds what was typed, whatever the case', () => {
  const cards = [card({ id: 'a', name: 'Helmet stand' }), card({ id: 'b', name: 'intake' }), card({ id: 'c', name: 'stand-off' })]
  expect(matching(cards, ' STAND ').map((c) => c.id)).toEqual(['a', 'c'])
  expect(matching(cards, '')).toBe(cards)
  expect(matching(cards, 'zz')).toEqual([])
})

describe('moving between cards with the arrow keys', () => {
  // Ten cards, four to a row: 0 1 2 3 / 4 5 6 7 / 8 9.
  const step = (key: string, at: number): number | 'field' | null => stepCard({ key }, at, 10, 4)

  it('goes to the next and the one before, and stops at the ends', () => {
    expect(step('ArrowRight', 0)).toBe(1)
    expect(step('ArrowRight', 9)).toBe(9)
    expect(step('ArrowLeft', 4)).toBe(3)
    expect(step('ArrowLeft', 0)).toBe(0)
    expect(step('Home', 7)).toBe(0)
    expect(step('End', 2)).toBe(9)
  })

  it('goes a row down and up, to the last card when the row below is shorter, and to the field above the first row', () => {
    expect(step('ArrowDown', 1)).toBe(5)
    expect(step('ArrowDown', 6)).toBe(9)
    expect(step('ArrowDown', 8)).toBe(8)
    expect(step('ArrowUp', 9)).toBe(5)
    expect(step('ArrowUp', 2)).toBe('field')
  })

  it('starts at the first card when none has the focus, and leaves every other key alone', () => {
    expect(step('ArrowDown', -1)).toBe(0)
    expect(step('ArrowRight', -1)).toBe(0)
    expect(step('a', 3)).toBeNull()
    expect(stepCard({ key: 'ArrowDown' }, -1, 0, 1)).toBeNull()
  })
})
