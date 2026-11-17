import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { plainText } from '../../../test/plainText'
import { MakeSetForm, makeError, selectionSaid } from './MakeSet'

const html = (over: Partial<Parameters<typeof MakeSetForm>[0]> = {}): string => renderToStaticMarkup(createElement(MakeSetForm, { name: 'deck', comment: '', colour: 2, taken: [], what: '2 faces', ...over }))

describe('the popover that names a set', () => {
  it('holds the name, the comment and eight swatches, the colour chosen checked, and Make is on', () => {
    const out = html()
    expect(out).toContain('value="deck"')
    expect(out).toContain('placeholder="What is it for?"')
    expect(out.match(/role="radio"/g)).toHaveLength(8)
    expect(out.match(/aria-checked="true"/g)).toHaveLength(1)
    expect(out).toMatch(/aria-label="Colour 3"[^>]*>|aria-checked="true"[^>]*aria-label="Colour 3"/)
    expect(out).toContain('style="--set-colour:var(--set-3)"')
    expect(plainText(out)).toContain('2 faces')
    expect(out).not.toMatch(/<button[^>]*disabled=""[^>]*>Make</)
  })
  it('says #deck is taken for a used name, whatever its case, and disables Make', () => {
    const out = html({ taken: ['Deck'] })
    expect(plainText(out)).toContain('#deck is taken')
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Make<\/button>/)
    expect(out).toContain('aria-invalid="true"')
    expect(makeError('deck', ['deck'])).toBe('#deck is taken')
  })
  it('disables Make for an empty name, and for one that is not a name, with the reason', () => {
    expect(html({ name: '  ' })).toMatch(/<button[^>]*disabled=""[^>]*>Make<\/button>/)
    expect(plainText(html({ name: '9lives' }))).toContain('A name must start with a letter.')
    expect(plainText(html({ name: 'a/b' }))).toContain('A name has no &quot;/&quot;, &quot;#&quot; or &quot;@&quot; in it.')
  })
  it('says what main refused in its words', () => {
    expect(plainText(html({ refused: 'The project has no layout print' }))).toContain('The project has no layout print')
  })
  it('says what is being named', () => {
    expect(selectionSaid(['block/F12', 'block/F3', 'block/E4', 'lid', 'M7/k3'])).toBe('2 faces, 1 edge, 1 part, 1 stroke')
    expect(selectionSaid(['lid'])).toBe('1 part')
    expect(selectionSaid([])).toBe('')
  })
})
