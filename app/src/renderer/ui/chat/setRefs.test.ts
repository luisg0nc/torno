import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Scene } from '../../../shared/scene'
import type { NamedSet } from '../../../shared/sets'
import { setsStore } from '../../state/sets'
import { store } from '../../state/store'
import { Markdown } from './markdown'
import { RefText } from './RefText'

// What the window knows of the project: a build with a part `lid` of ten faces, and a named set `deck` of two of them.
const scene = { model: 'm.py', layouts: ['assembly'], parts: [{ key: 'assembly:lid', name: 'lid', layout: 'assembly', valid: true, faceCount: 10, edgeCount: 4 }], seconds: 0, output: '' } as unknown as Scene
const deck: NamedSet = { id: 'N1', name: 'deck face', slug: 'deck-face', comment: '', colour: 0, layout: 'assembly', by: 'person', members: [{ face: 'lid/F1', point: [0, 0, 0], normal: [0, 0, 1], state: 'ok' }, { face: 'lid/F2', point: [0, 0, 0], normal: [0, 0, 1], state: 'ok' }], createdAt: '2026-11-17T10:00:00.000Z' }

/** A static render reads each store's first state: it is made the state there is now. */
function render(element: ReturnType<typeof createElement>): string {
  const spies = [vi.spyOn(store, 'getInitialState').mockReturnValue(store.getState()), vi.spyOn(setsStore, 'getInitialState').mockReturnValue(setsStore.getState())]
  try {
    return renderToStaticMarkup(element)
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
}

afterEach(() => {
  store.setState({ scene: null, layout: 'assembly', layers: {}, marks: [] })
  setsStore.setState({ sets: [] })
})

describe('#deck-face in the chat', () => {
  it('is a live chip when the project has a named set of that name, and a name with a space is its slug', () => {
    store.setState({ scene, layout: 'assembly', layers: {}, marks: [], revision: 3 })
    setsStore.setState({ sets: [deck] })
    const out = render(createElement(Markdown, { text: 'Look at #deck-face and #Deck-Face, not #include.' }))
    expect(out.match(/data-ref="#deck-face"/g)).toHaveLength(1)
    expect(out.match(/data-ref="#Deck-Face"/g)).toHaveLength(1)
    expect(out).not.toContain('data-ref="#include"')
    expect(out).toContain('data-kind="geometry"')
    expect(out).toContain('data-live=""')
    expect(out).toContain('title="Select #deck-face: 2 faces"')
  })

  it('is only text with no named set of that name, in the markdown and in a tool\'s text alike', () => {
    store.setState({ scene, layout: 'assembly', layers: {}, marks: [] })
    setsStore.setState({ sets: [] })
    expect(render(createElement(Markdown, { text: 'Look at #deck-face' }))).not.toContain('ref-chip')
    expect(render(createElement(RefText, { text: 'highlight #deck-face' }))).not.toContain('ref-chip')
    setsStore.setState({ sets: [deck] })
    expect(render(createElement(RefText, { text: 'highlight #deck-face' }))).toContain('data-ref="#deck-face"')
  })

  it('is told apart from a set of another layout, which is a chip that does nothing', () => {
    store.setState({ scene, layout: 'assembly', layers: {}, marks: [] })
    setsStore.setState({ sets: [{ ...deck, layout: 'print' }] })
    const out = render(createElement(Markdown, { text: 'See #deck-face' }))
    expect(out).toContain('data-ref="#deck-face"')
    expect(out).not.toContain('data-live=""')
    expect(out).toContain('#deck-face is of layout print')
  })
})
