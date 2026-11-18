import { afterEach, expect, it } from 'vitest'
import { getLeaders } from '../../state/leaders'
import { publishTag, tagAt, watchTag, withdrawTag } from './useTagAt'

afterEach(() => {
  withdrawTag('a')
  withdrawTag('b')
})

const origin = { x: 100, y: 40 }
const box = { x: 10, y: 20, w: 80, h: 30 }

it('registers a leader for a tag beside its subject, in window pixels, and for each tag at once', () => {
  publishTag('a', { box, side: 'above', subject: { x: 50, y: 90 } }, origin)
  publishTag('b', { box: { ...box, y: 200 }, side: 'right', subject: { x: 60, y: 210 } }, origin)
  expect(getLeaders().map((l) => [l.id, l.subject, l.tag.x, l.tag.y])).toEqual([
    ['a', { x: 150, y: 130 }, 110, 60],
    ['b', { x: 160, y: 250 }, 110, 240]
  ])
})

it('draws no leader for a docked tag, or one with no subject, and none after it is withdrawn', () => {
  publishTag('a', { box, side: 'docked', subject: { x: 50, y: 90 } }, origin)
  publishTag('b', { box, side: 'above', subject: null }, origin)
  expect(getLeaders()).toEqual([])
  publishTag('a', { box, side: 'left', subject: { x: 50, y: 90 } }, origin)
  expect(getLeaders().map((l) => l.id)).toEqual(['a'])
  withdrawTag('a')
  expect(getLeaders()).toEqual([])
  expect(tagAt('a')).toBeNull()
})

it('tells a tool where its tag stands, in the pane, as it moves, and that it is gone', () => {
  const seen: Array<string | null> = []
  const off = watchTag('a', (at) => seen.push(at && at.side))
  publishTag('a', { box, side: 'above', subject: { x: 50, y: 90 } }, origin)
  publishTag('a', { box, side: 'right', subject: { x: 50, y: 90 } }, origin)
  expect(tagAt('a')?.box).toEqual(box)
  withdrawTag('a')
  off()
  publishTag('a', { box, side: 'below', subject: { x: 50, y: 90 } }, origin)
  expect(seen).toEqual(['above', 'right', null])
})
