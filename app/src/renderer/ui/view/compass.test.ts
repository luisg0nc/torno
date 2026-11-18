import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SavedView } from '../../../shared/views'
import { compassViews, foldSavedViews, hasProcedure, hasTags, stackBottomOf } from './compass'
import { ViewCube } from './ViewCube'

const CAMERA: SavedView['camera'] = { position: [1, 1, 1], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }
const view = (name: string, proposed = false): SavedView => ({ name, author: proposed ? 'agent' : 'user', ...(proposed ? { proposed: true } : {}), layout: 'assembly', camera: CAMERA, hidden: [], at: 't' })

const rest = { toolHasTags: false, explodeOpen: false, procedure: false, stackBottom: 300, topTag: null }

describe('foldSavedViews', () => {
  it('stacks the views while nothing stands in their way', () => {
    expect(foldSavedViews(rest)).toBe('stack')
    // A tag below the stack, or none near it, leaves them stacked.
    expect(foldSavedViews({ ...rest, topTag: 340 })).toBe('stack')
  })

  it('folds them to one pill while a tool with tags is in hand, or explode is open', () => {
    expect(foldSavedViews({ ...rest, toolHasTags: true })).toBe('pill')
    expect(foldSavedViews({ ...rest, explodeOpen: true })).toBe('pill')
  })

  it('folds them when the stack would meet a tag', () => {
    expect(foldSavedViews({ ...rest, topTag: 300 })).toBe('pill')
    expect(foldSavedViews({ ...rest, topTag: 120 })).toBe('pill')
  })

  it('hides them while Align or Region is in hand, whatever else is so', () => {
    expect(foldSavedViews({ ...rest, procedure: true })).toBe('none')
    expect(foldSavedViews({ ...rest, procedure: true, toolHasTags: true, explodeOpen: true, topTag: 10 })).toBe('none')
  })
})

describe('the tools the compass reads', () => {
  it('has tags for Section, Measure and Draw, and none for the others', () => {
    expect(['section', 'measure', 'draw'].every((t) => hasTags(t as never))).toBe(true)
    expect(['select', 'pin', 'arrow', 'shape', 'align', 'region'].some((t) => hasTags(t as never))).toBe(false)
  })

  it('has a procedure card for Align and Region', () => {
    expect(hasProcedure('align')).toBe(true)
    expect(hasProcedure('region')).toBe(true)
    expect(hasProcedure('select')).toBe(false)
  })
})

describe('the stack of saved views', () => {
  it('shows the one that is on, then the first proposal, and counts the rest', () => {
    const views = [view('a'), view('b'), view('p1', true), view('p2', true), view('c')]
    expect(compassViews(views, 'b').shown.map((v) => v.name)).toEqual(['b', 'p1'])
    expect(compassViews(views, 'b').more).toBe(3)
    expect(compassViews(views, null).shown.map((v) => v.name)).toEqual(['p1'])
    expect(compassViews([view('a')], null)).toEqual({ shown: [], more: 1 })
    expect(compassViews([], null)).toEqual({ shown: [], more: 0 })
  })

  it('shows a proposal that is on once, and keeps the saved order', () => {
    const views = [view('p1', true), view('a'), view('p2', true)]
    expect(compassViews(views, 'p1').shown.map((v) => v.name)).toEqual(['p1', 'p2'])
    expect(compassViews(views, 'a').shown.map((v) => v.name)).toEqual(['p1', 'a'])
  })

  it('stands further down with each pill', () => {
    expect(stackBottomOf(1)).toBeGreaterThan(0)
    expect(stackBottomOf(3)).toBe(stackBottomOf(1) + 2 * 30)
  })
})

describe('the view cube', () => {
  const html = (on: Parameters<typeof ViewCube>[0]['on']) => renderToStaticMarkup(createElement(ViewCube, { on, go: () => {} }))
  /** The opening tag of the element with this accessible name. */
  const tagOf = (markup: string, name: string): string => markup.match(new RegExp(`<[^>]*aria-label="${name}"[^>]*>`))![0]

  it('has a button for each face, the corner and the three views behind the dots, by name', () => {
    const markup = html(null)
    for (const name of ['Top view, 4', 'Front view, 2', 'Right view, 3', 'Iso view, 1', 'More views']) expect(markup).toContain(`aria-label="${name}"`)
    // Real buttons over the picture, so that the cube is reached by keys.
    expect(tagOf(markup, 'Top view, 4')).toMatch(/^<button /)
    expect(tagOf(markup, 'Iso view, 1')).toMatch(/^<button /)
  })

  it('marks the face of the view on screen', () => {
    const markup = html('front')
    expect(tagOf(markup, 'Front view, 2')).toContain('data-on')
    expect(tagOf(markup, 'Top view, 4')).not.toContain('data-on')
    expect(tagOf(markup, 'Right view, 3')).not.toContain('data-on')
  })

  it('puts the lock on the face of the view the camera is locked on, and on the dots for one behind them', () => {
    expect(html('top')).toContain('view-lock')
    expect(html(null)).not.toContain('view-lock')
    expect(tagOf(html('back'), 'More views: locked on back')).toContain('data-locked')
  })
})
