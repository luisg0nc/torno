import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Draft } from '../../state/onboard'
import { DraftPane, pictureState, promptPieces, wordsOf } from './DraftPane'

const preview = { text: 'This is a new project, clip.\n\nA small clip\n\nmore', attached: [1, null], pictured: [], objects: [] }

describe('the session pane while a new object is made', () => {
  it("shows the prompt, with the person's words apart from torno's", () => {
    const thumbs = [
      { file: 'reference/photo-1.jpg', url: 'blob:a', attached: 1, hasPicture: true },
      { file: 'reference/photo-7.jpg', url: 'blob:b', attached: null, hasPicture: true }
    ]
    const out = renderToStaticMarkup(createElement(DraftPane, { preview, words: ['A small clip'], thumbs }))
    expect(out).toContain('What Claude gets first')
    expect(out).toContain('Written from the board, updates as you add')
    expect(out).toContain('<span class="draft-pane-mine">A small clip</span>')
    expect(out).toContain('attached: picture 1')
    expect(out).toContain('named only: over 6')
  })

  it('splits a text at the words, longest first, and at none when there are none', () => {
    expect(promptPieces('a big clip here', ['clip', 'big clip'])).toEqual([
      { text: 'a ', mine: false },
      { text: 'big clip', mine: true },
      { text: ' here', mine: false }
    ])
    expect(promptPieces('abc', [' '])).toEqual([{ text: 'abc', mine: false }])
  })

  it('says why a picture is only named', () => {
    expect(pictureState(2, true)).toBe('attached: picture 2')
    expect(pictureState(null, false)).toBe('named only')
  })
})

describe('the words that are the person\'s own', () => {
  it('are the description, the rules and the notes of every kind, a size\'s name and a link\'s address', () => {
    const d = {
      name: 'x',
      description: 'A clip',
      photos: [{ note: 'p' }],
      doodles: [{ note: 'd' }],
      steps: [{ note: 's' }],
      scans: [{ note: 'c' }],
      objects: [{ note: 'o' }],
      sizes: [{ what: 'tray', note: 'by eye' }],
      rules: 'PETG',
      links: [{ url: 'https://example.com', note: 'forum' }],
      pdfs: [{ note: 'manual' }]
    } as unknown as Draft
    expect(wordsOf(d)).toEqual(['A clip', 'PETG', 'p', 'd', 's', 'c', 'o', 'tray', 'by eye', 'https://example.com', 'forum', 'manual'])
  })
})
