import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Draft } from '../../state/onboard'
import { DraftPane, pictureState, promptPieces, wordsOf } from './DraftPane'

const make = { folder: 'parts/cable-clip/', module: 'cable_clip', files: 0, scans: 0 }
const preview = { text: 'This is a new project, clip.\n\nA small clip\n\nmore', attached: [1, null], pictured: [], objects: [] }

describe('the session pane while a new object is made', () => {
  it("shows the prompt, with the person's words apart from torno's", () => {
    const thumbs = [
      { file: 'reference/photo-1.jpg', url: 'blob:a', attached: 1, hasPicture: true },
      { file: 'reference/photo-7.jpg', url: 'blob:b', attached: null, hasPicture: true }
    ]
    const out = renderToStaticMarkup(createElement(DraftPane, { preview, words: ['A small clip'], thumbs, make }))
    expect(out).toContain('What Claude gets first')
    expect(out).toContain('Written from this page as you add to it.')
    expect(out).toContain('<span class="draft-pane-mine">A small clip</span>')
    expect(out).toContain('attached: picture 1')
    expect(out).toContain('named only: over 6')
  })

  it('is the dyed plate, and says what will be made from the page', () => {
    const out = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make }))
    expect(out).toContain('data-plate')
    expect(out).toContain('Makes <span class="num">parts/cable-clip/</span> with <span class="num">cable_clip.py</span>')
    expect(out).toContain('<span class="num">brief.md</span>')
    expect(out).not.toContain('reference/')
    const more = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make: { ...make, files: 3, scans: 1 } }))
    expect(more).toContain('<span class="num">reference/</span> (<span class="num">3</span> files)')
    expect(more).toContain('The scan is imported into the project, not copied.')
    const none = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make: 'Give it a name and say what it is to start.' }))
    expect(none).toContain('Give it a name and say what it is to start.')
    expect(none).not.toContain('Makes')
  })

  it('puts the foot, the choice and the buttons, at the bottom of the plate', () => {
    const out = renderToStaticMarkup(createElement(DraftPane, { preview, words: [], thumbs: [], make, children: createElement('button', null, 'Start') }))
    expect(out.indexOf('new-will')).toBeLessThan(out.indexOf('<button>Start</button>'))
  })

  it('draws the references of the prompt as outlined chips, and the sizes in the face of numbers', () => {
    const text = 'Hello\n\n- reference/photo-1.png: the edge (attached: picture 1)\n- ../plain/ (another project)\n\nSizes the person gave:\n- cable Ø 6 mm (measured)\n- tray 186 × 128 mm\n\nRules:\nPETG'
    const out = renderToStaticMarkup(createElement(DraftPane, { preview: { ...preview, text }, words: ['cable'], thumbs: [], make }))
    expect(out).toContain('<span class="draft-pane-chip">reference/photo-1.png</span>')
    expect(out).toContain('<span class="draft-pane-chip">attached: picture 1</span>')
    expect(out).toContain('<span class="draft-pane-chip">../plain/</span>')
    expect(out).toContain('<span class="draft-pane-size num">')
    expect(out).toContain('<span class="draft-pane-mine">cable</span>')
    // Only the sizes' lines are in mono, not the rules after them.
    expect(out).not.toContain('<span class="draft-pane-size num">Rules')
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
