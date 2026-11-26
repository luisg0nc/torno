import { describe, expect, it } from 'vitest'
import { type BoardFile, type Card, linksIn } from './board'
import { briefSections, briefSpine, briefWords, claudeSections, freshCards, handOf, promptsSaid, seenHash, seenOf, whenSaid, linkLabel, RULES_FRAME, rulesSaid, sizesSaid, sizeSource, sizeValue, spineSaid, topicOf } from './brief'
import type { PromptRow } from './chat'

const card = (id: string, extra: Partial<Card>): Card => ({ id, kind: 'text', x: 0, y: 0, w: 100, h: 100, by: 'person', ...extra })
const board = (cards: Card[]): BoardFile => ({ next: 99, cards, arrows: [] })

describe('briefSections', () => {
  it('sorts the cards of a board into the sheet', () => {
    const b = board([
      card('C1', { kind: 'frame', name: 'Rules', y: 400 }),
      card('C2', { kind: 'brief', by: 'torno', source: 'brief' }),
      card('C3', { kind: 'size', y: 10, size: { what: 'tab hole', value: '6.6', unit: 'mm', source: 'measured' } }),
      card('C4', { kind: 'text', frame: 'C1', text: 'Printed in ABS', y: 410 }),
      card('C5', { kind: 'text', text: 'ask about the screws', y: 900 }),
      card('C6', { kind: 'reference', by: 'torno', source: 'reference/photo-1.jpg', y: 5 }),
      card('C7', { kind: 'picture', picture: 'p-0123456789ab.png', y: 6 }),
      card('C8', { kind: 'reference', by: 'torno', source: 'reference/608zz.step', y: 7 }),
      card('C9', { kind: 'mark', by: 'torno', source: 'M1', y: 8 }),
      card('C10', { kind: 'size', y: 20, hidden: true, by: 'torno', size: { what: 'gone', value: '1', unit: 'mm', source: 'a guess' } })
    ])
    const s = briefSections(b)
    expect(s.hasWhat).toBe(true)
    expect(s.sizes.map((c) => c.id)).toEqual(['C3'])
    expect(s.rules.map((c) => c.id)).toEqual(['C4'])
    expect(s.notes.map((c) => c.id)).toEqual(['C5'])
    expect(s.pictures.map((c) => c.id)).toEqual(['C6', 'C7'])
    expect(s.references.map((c) => c.id)).toEqual(['C8'])
  })

  it('leaves out hidden cards, and the old copies of marks, builds and the rest, without losing them', () => {
    const b = board([card('C1', { kind: 'build' }), card('C2', { kind: 'scan', by: 'torno' }), card('C3', { kind: 'text', hidden: true, by: 'torno' })])
    const s = briefSections(b)
    expect([s.sizes, s.rules, s.notes, s.pictures, s.references].every((l) => l.length === 0)).toBe(true)
    expect(s.hasWhat).toBe(false)
  })

  it('reads the Rules frame by name whatever its case, and a doodle among the pictures', () => {
    const b = board([card('C1', { kind: 'frame', name: ' RULES ' }), card('C2', { kind: 'text', frame: 'C1', text: 'x' }), card('C3', { kind: 'sketch', picture: 'p-0123456789ab.png' })])
    const s = briefSections(b)
    expect(s.rules).toHaveLength(1)
    expect(s.pictures.map((c) => c.id)).toEqual(['C3'])
    expect(s.rulesFrame).toBe('C1')
    expect(RULES_FRAME).toBe('rules')
  })

  it('lists what main made and the person put away, to be shown again', () => {
    const b = board([card('C1', { kind: 'reference', by: 'torno', hidden: true, source: 'reference/photo-1.jpg' }), card('C2', { kind: 'mark', by: 'torno', hidden: true })])
    const s = briefSections(b)
    expect(s.hidden.map((c) => c.id)).toEqual(['C1'])
    expect(s.pictures).toEqual([])
  })

  it('has no rules frame to put a rule in when the board has none', () => {
    expect(briefSections(board([])).rulesFrame).toBeNull()
  })
})

describe('what the ledger says of a size', () => {
  const size = (value: string, over = {}) => ({ what: 'w', value, unit: 'mm' as const, source: 'measured' as const, ...over })
  it('shows the numbers read from the value, and the value as typed when it holds none', () => {
    expect(sizeValue(size('Ø6,6'))).toBe('Ø 6.6')
    expect(sizeValue(size('186 x 128 mm'))).toBe('186 × 128')
    expect(sizeValue(size('about 60 mm'))).toBe('about 60')
    expect(sizeValue(size('mm'))).toBe('mm')
  })
  it('says where it came from, with the note after', () => {
    expect(sizeSource(size('1', { source: 'from a manual or datasheet', note: 'photo-1.jpg' }))).toBe('from a datasheet · photo-1.jpg')
    expect(sizeSource(size('1', { source: 'a guess' }))).toBe('a guess')
  })
  it('counts every size as not checked until something checks it', () => {
    expect(sizesSaid(7)).toBe('7 sizes, 7 not checked')
    expect(sizesSaid(1)).toBe('1 size, 1 not checked')
    expect(sizesSaid(0)).toBe('none yet')
    expect(rulesSaid(3)).toBe('3 rules, 3 not checked')
  })
})

describe('the spine of what Claude wrote down (#338)', () => {
  const row = (id: string, number: number, at: number): PromptRow => ({ conversation: 'c1', id, number, text: `prompt ${number}`, at })
  const prompts = new Map([row('u2', 2, 2000), row('u6', 6, 6000), row('u11', 11, 11000), row('u13', 13, 13000)].map((r) => [r.id, r]))
  const t = (prompt: string) => ({ prompt, conversation: 'c1' })

  it('hangs each card of Claude’s on the prompt that wrote or last changed it, oldest first, and leaves the person’s and torno’s out', () => {
    const nodes = briefSpine(
      [
        card('C10', { by: 'agent', text: 'Screen: Waveshare', turn: t('u2') }),
        card('C20', { by: 'agent', text: 'Controls: 9 buttons', turn: t('u13') }),
        card('C14', { by: 'agent', kind: 'size', turn: t('u2'), size: { what: 'screen', value: '40.9 x 19.7', unit: 'mm', source: 'from Claude' } }),
        card('C5', { text: 'mine' }),
        card('C6', { kind: 'brief', by: 'torno' }),
        card('C7', { by: 'agent', kind: 'frame', name: 'Rules', turn: t('u2') }),
        card('C8', { by: 'agent', text: 'gone', turn: t('u2'), hidden: true })
      ],
      prompts
    )
    expect(nodes.map((n) => [n.id, n.prompt?.number, n.cards.map((c) => c.id)])).toEqual([
      ['u2', 2, ['C10', 'C14']],
      ['u13', 13, ['C20']]
    ])
  })

  it('puts what a card said before in the node of the prompt that wrote it, struck, with the prompt that changed it', () => {
    const mount = card('C13', { by: 'agent', text: 'Mount: an arm', turn: t('u11'), was: [{ text: 'Mount: a blade', turn: t('u2') }, { text: 'Mount: a tube', turn: t('u6') }] })
    const nodes = briefSpine([mount], prompts)
    expect(nodes.map((n) => [n.id, n.cards.map((c) => c.id), n.ghosts])).toEqual([
      ['u2', [], [{ card: 'C13', text: 'Mount: a blade', changedIn: 6 }]],
      ['u6', [], [{ card: 'C13', text: 'Mount: a tube', changedIn: 11 }]],
      ['u11', ['C13'], []]
    ])
  })

  it('keeps a card the person made theirs where Claude wrote it, and puts cards with no prompt first and a prompt not on this computer by its time', () => {
    const nodes = briefSpine(
      [
        card('C1', { by: 'person', text: 'Controls: mine', from: { by: 'agent', turn: t('u13') } }),
        card('C2', { by: 'agent', text: 'old', at: '2026-11-20T10:00:00.000Z' }),
        card('C3', { by: 'agent', text: 'elsewhere', turn: t('u99'), at: new Date(5000).toISOString() })
      ],
      prompts
    )
    expect(nodes.map((n) => [n.id, n.at, n.cards.map((c) => c.id)])).toEqual([
      ['', Date.parse('2026-11-20T10:00:00.000Z'), ['C2']],
      ['u99', 5000, ['C3']],
      ['u13', 13000, ['C1']]
    ])
  })

  it('says whose a card is, with its prompt when it is known', () => {
    expect(handOf(card('C1', { by: 'agent', turn: t('u13') }), prompts).label).toBe('Claude, prompt 13')
    expect(handOf(card('C1', { by: 'agent', turn: t('u99') }), prompts)).toEqual({ hand: 'claude', label: 'Claude' })
    expect(handOf(card('C1', { from: { by: 'agent', turn: t('u2') } }), prompts)).toEqual({ hand: 'you', label: 'Yours, from prompt 2' })
    expect(handOf(card('C1', {}), prompts)).toEqual({ hand: 'you', label: 'You' })
  })

  it('counts what Claude wrote down, and reads a card’s topic', () => {
    const cards = [card('C1', { text: 'a' }), card('C2', { text: 'b' }), card('C3', { frame: 'C9', text: 'r' }), card('C4', { kind: 'size' })]
    expect(spineSaid(cards, 'C9')).toBe('2 notes, a size, a rule')
    expect(spineSaid([], null)).toBe('nothing yet')
    expect(topicOf('Mount: an adjustable arm')).toEqual({ topic: 'Mount', rest: 'an adjustable arm' })
    expect(topicOf('Every encoder size is assumed. Measure one: then')).toBeNull()
    expect(topicOf('see https://example.com')).toBeNull()
  })
})

describe('links of brief.md', () => {
  it('reads every address in order, as firstLink reads one', () => {
    expect(linksIn('A [cockpit](https://cdn.shopify.com/files/GT1-EVO_cockpit.pdf?v=3). See http://a.b/c, then https://x.y/(z).')).toEqual(['https://cdn.shopify.com/files/GT1-EVO_cockpit.pdf?v=3', 'http://a.b/c', 'https://x.y/(z)'])
    expect(linksIn('none')).toEqual([])
  })

  it('labels an address by its file and host, never as the address itself', () => {
    expect(linkLabel('https://cdn.shopify.com/s/files/1/GT1-EVO_cockpit.pdf?v=1')).toEqual({ label: 'GT1 EVO cockpit, PDF', host: 'cdn.shopify.com' })
    expect(linkLabel('https://www.example.com/')).toEqual({ label: 'example.com', host: 'example.com' })
  })
})

describe('the person’s words of brief.md', () => {
  it('leaves out the name torno wrote on top and the References it listed, and keeps the rest as written', () => {
    const text = '# simracing-panel\n\nWe want a box.\n\n- 5 toggles\n- 18 buttons\n\n## References\n\n- reference/photo-1.jpg: the switch\n\n## Where\n\nOn the arm.\n'
    expect(briefWords(text)).toBe('We want a box.\n\n- 5 toggles\n- 18 buttons\n\n## Where\n\nOn the arm.')
    expect(briefWords('Just words, no title.')).toBe('Just words, no title.')
    expect(briefWords('```\n## not a heading\n```')).toBe('```\n## not a heading\n```')
  })

  it('says when, as the spine does', () => {
    expect(whenSaid(new Date(2026, 10, 25, 9, 5).getTime())).toBe('25 Nov 09:05')
  })
})

describe('new since you looked (#340)', () => {
  const prompts = new Map([['u13', { conversation: 'c', id: 'u13', number: 13, text: '', at: 13 }], ['u14', { conversation: 'c', id: 'u14', number: 14, text: '', at: 14 }]])
  const a = card('C1', { by: 'agent', text: 'Controls: 9 buttons', turn: { prompt: 'u13' } })
  const b = card('C2', { by: 'agent', kind: 'size', turn: { prompt: 'u14' }, size: { what: 'plate', value: '15 x 8', unit: 'mm', source: 'from Claude' } })

  it('keeps a hash of each card of Claude’s, and says which are new: added, or saying something else, not moved', () => {
    const seen = seenOf([a, card('C5', { text: 'mine' })], '2026-11-25T17:50:00.000Z')
    expect(Object.keys(seen.cards)).toEqual(['C1'])
    const nodes = briefSpine([{ ...a, x: 500 }, b], prompts)
    expect([...freshCards(nodes, seen)]).toEqual(['C2'])
    expect([...freshCards(briefSpine([{ ...a, text: 'Controls: 3 toggles' }], prompts), seen)]).toEqual(['C1'])
    expect(freshCards(nodes, null).size).toBe(0)
    // A tie of a size is no news.
    expect(seenHash({ ...b, size: { ...b.size!, tie: { mark: 'M9', tolerance: 0.5 } } })).toBe(seenHash(b))
  })

  it('names the prompts in a line', () => {
    expect(promptsSaid([13])).toBe('prompt 13')
    expect(promptsSaid([13, 14])).toBe('prompts 13 and 14')
    expect(promptsSaid([4, 9, 13])).toBe('prompts 4, 9 and 13')
    expect(promptsSaid([])).toBe('')
  })
})

describe('Claude\'s old sections of brief.md (#341)', () => {
  const old = '# simracing-panel\n\nWe want a box.\n\n## Answers (2026-11-25)\n\n- Screen: Waveshare\n- Mount: a blade\n\n## Where it goes\n\nOn the arm.\n\n## Changes (2026-11-25, later)\n\n- Mount: an arm\n'

  it('finds them by their headings, and leaves them out of the person\'s words', () => {
    expect(claudeSections(old)).toEqual([
      { heading: 'Answers (2026-11-25)', body: '- Screen: Waveshare\n- Mount: a blade' },
      { heading: 'Changes (2026-11-25, later)', body: '- Mount: an arm' }
    ])
    expect(briefWords(old)).toBe('We want a box.\n\n## Where it goes\n\nOn the arm.')
    expect(claudeSections('# box\n\n## Where it goes\n\nOn the arm.\n')).toEqual([])
    // A heading of the person's own with those words but no date is theirs.
    expect(claudeSections('# box\n\n## Assumptions\n\n- mine\n\n## Changes from the old holder\n\n- wider\n')).toEqual([])
    expect(briefWords('# box\n\n## Assumptions\n\n- mine\n')).toBe('## Assumptions\n\n- mine')
  })
})
