import { describe, expect, it } from 'vitest'
import { answersIn, shelfOffer } from './offerLines'

const ask = (question: string, header = 'Shelf') => ({ question, header, multi: false, options: [{ label: 'Put it on the shelf', description: '' }, { label: 'Not this one', description: '' }] })

const board = [
  'Put the Waveshare board on the parts shelf?',
  '40.9 × 19.7 board outline (datasheet)',
  '1.6 board thickness (datasheet)',
  '7.5 thickness with the screen (assumed)',
  '12 × 25 room for the USB-C plug (assumed)'
].join('\n')

describe('shelfOffer', () => {
  it('takes the first line as the title and each size line as a row: value, what, source and how it is told', () => {
    const offer = shelfOffer(ask(board))
    expect(offer?.title).toBe('Put the Waveshare board on the parts shelf?')
    expect(offer?.blocks).toHaveLength(1)
    const rows = offer?.blocks[0].kind === 'rows' ? offer.blocks[0].rows : []
    expect(rows).toEqual([
      { value: '40.9 × 19.7', what: 'board outline', source: 'datasheet', tone: 'plain' },
      { value: '1.6', what: 'board thickness', source: 'datasheet', tone: 'plain' },
      { value: '7.5', what: 'thickness with the screen', source: 'assumed', tone: 'warn' },
      { value: '12 × 25', what: 'room for the USB-C plug', source: 'assumed', tone: 'warn' }
    ])
  })

  it('tells measured as ok and a listing, a standard or a derived size as quiet; a source it does not know is plain', () => {
    const offer = shelfOffer(ask('Put it?\nØ7 hole (measured)\nM6 bushing thread (ISO 261)\n13 body (listing)\n6.5 under the panel (derived)\n2 something (a hunch)'))
    const rows = offer?.blocks[0].kind === 'rows' ? offer.blocks[0].rows : []
    expect(rows.map((r) => [r.value, r.source, r.tone])).toEqual([['Ø7', 'measured', 'ok'], ['M6', 'ISO 261', 'quiet'], ['13', 'listing', 'quiet'], ['6.5', 'derived', 'quiet'], ['2', 'a hunch', 'plain']])
  })

  it('keeps other lines as text, in their place around the rows; a bullet or a blank line is ignored', () => {
    const offer = shelfOffer(ask('Put the board on the shelf?\nThen the next project takes these sizes.\n- 40.9 board (datasheet)\n\n7.5 thick (assumed)\nI would write common/parts/board/.'))
    expect(offer?.blocks.map((b) => b.kind)).toEqual(['text', 'rows', 'text'])
    expect(offer?.blocks[0]).toEqual({ kind: 'text', text: 'Then the next project takes these sizes.' })
    expect(offer?.blocks[1].kind === 'rows' && offer.blocks[1].rows.map((r) => r.value)).toEqual(['40.9', '7.5'])
    expect(offer?.blocks[2]).toEqual({ kind: 'text', text: 'I would write common/parts/board/.' })
  })

  it('falls back to text for a line that does not read as a size, and is no offer when no line does', () => {
    expect(shelfOffer(ask('Put it?\nabout 40 long (datasheet)\n40 long, datasheet\n40 (datasheet)'))).toBeNull()
    const mixed = shelfOffer(ask('Put it?\n40 long (datasheet)\nwide, I think (assumed)'))
    expect(mixed?.blocks.map((b) => b.kind)).toEqual(['rows', 'text'])
  })

  it('is only for the header Shelf, in any case, and a question with a title alone is a normal one', () => {
    expect(shelfOffer(ask(board, 'shelf'))).not.toBeNull()
    expect(shelfOffer(ask(board, 'SHELF'))).not.toBeNull()
    expect(shelfOffer(ask(board, 'Shelf life'))).toBeNull()
    expect(shelfOffer(ask(board, ''))).toBeNull()
    expect(shelfOffer(ask('Put it on the shelf?'))).toBeNull()
  })
})

describe('answersIn', () => {
  it('takes what follows each question and a colon, as main wrote the answers (a line a question)', () => {
    expect(answersIn([board], `${board}: Put it on the shelf`)).toEqual(['Put it on the shelf'])
  })

  it('splits several questions at where each one starts, keeping an answer that has a line break or a colon', () => {
    expect(answersIn(['Which wall?', 'Put it?\n7 hole (assumed)'], 'Which wall?: left\nright\nPut it?\n7 hole (assumed): Not this one: later')).toEqual(['left\nright', 'Not this one: later'])
  })

  it('is undefined for a question the text does not answer', () => {
    expect(answersIn([board, 'Other?'], `${board}: Put it on the shelf`)).toEqual(['Put it on the shelf', undefined])
    expect(answersIn([board], 'something else')).toEqual([undefined])
  })
})
