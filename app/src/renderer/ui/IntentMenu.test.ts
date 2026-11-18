import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Mark } from '../../shared/marks'
import { plainText } from '../../test/plainText'
import { IntentMenu, intentChoices, intentSaid } from './IntentMenu'

const CAMERA = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as const
const mark = (over: object = {}): Mark => ({ id: 'M8', kind: 'pick', target: 'face', author: 'user', note: '', status: 'draft', anchorState: 'ok', layout: 'default', revision: 1, camera: CAMERA, createdAt: 't', anchor: { point: [0, 0, 0] }, ...over }) as unknown as Mark

describe('what a row offers to say of a mark', () => {
  it('is plain, don\'t want or want for a mark of any kind, with the one it says marked', () => {
    expect(intentChoices(mark({ intent: 'dont' }))).toEqual([
      { intent: null, label: 'Plain', checked: false },
      { intent: 'dont', label: "Don't want", checked: true },
      { intent: 'want', label: 'Want', checked: false }
    ])
    expect(intentChoices(mark()).map((c) => c.checked)).toEqual([true, false, false])
  })

  it('is no plain for a shape, whose other intents are set in its fields: want makes it add, don\'t want remove', () => {
    const shape = mark({ kind: 'shape', shape: 'box', intent: 'add', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [1, 1, 1] })
    expect(intentChoices(shape).map((c) => [c.intent, c.checked])).toEqual([['dont', false], ['want', true]])
    expect(intentChoices(mark({ kind: 'shape', shape: 'box', intent: 'keep-out', position: [0, 0, 0], rotation: [0, 0, 0, 1], size: [1, 1, 1] })).map((c) => c.checked)).toEqual([false, false])
  })

  it('says it in words', () => {
    expect(intentSaid(mark())).toBe('plain')
    expect(intentSaid(mark({ intent: 'dont' }))).toBe("don't want")
    expect(intentSaid(mark({ intent: 'want' }))).toBe('want')
  })
})

describe('the intent menu of a row', () => {
  it('is a button that says what the person says of the mark, with the menu away', () => {
    const markup = renderToStaticMarkup(createElement(IntentMenu, { mark: mark({ intent: 'dont' }) }))
    expect(markup).toContain('aria-label="M8: don&#x27;t want. Change"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('role="menu"')
    expect(plainText(markup)).toBe('−')
    expect(markup).toMatch(/<span class="sign-disc[^"]*" data-sign="-">−<\/span>/)
  })

  it('shows a plus for want, and a sign for none that is no want', () => {
    const want = renderToStaticMarkup(createElement(IntentMenu, { mark: mark({ intent: 'want' }) }))
    expect(plainText(want)).toBe('+')
    expect(want).toContain('data-sign="+"')
    expect(renderToStaticMarkup(createElement(IntentMenu, { mark: mark() }))).not.toContain('sign-disc')
    expect(plainText(renderToStaticMarkup(createElement(IntentMenu, { mark: mark() })))).toBe('±')
  })
})
