import { afterEach, expect, it } from 'vitest'
import { borrowLeader, getLeaders, setToolLeaders, subscribeLeaders } from './leaders'

afterEach(() => {
  setToolLeaders([])
  borrowLeader(null)
})

const tag = { x: 160, y: 100, w: 80, h: 30 }

it('keeps the leaders of the tool in hand and the one borrowed, in that order', () => {
  setToolLeaders([{ id: 'section', subject: { x: 0, y: 0 }, tag }])
  borrowLeader({ subject: { x: 5, y: 5 }, chip: tag, clip: { x: 0, y: 0, w: 100, h: 100 } })
  expect(getLeaders().map((l) => l.id)).toEqual(['section', 'borrowed'])
  borrowLeader(null)
  expect(getLeaders().map((l) => l.id)).toEqual(['section'])
})

it('tells each subscriber at each change, and not after it is gone', () => {
  const seen: string[][] = []
  const off = subscribeLeaders((list) => seen.push(list.map((l) => l.id)))
  setToolLeaders([{ id: 'a', subject: { x: 0, y: 0 }, tag }])
  borrowLeader({ subject: { x: 1, y: 1 }, chip: tag, clip: { x: 0, y: 0, w: 9, h: 9 } })
  off()
  setToolLeaders([])
  expect(seen).toEqual([['a'], ['a', 'borrowed']])
})

it('does not tell when nothing changed', () => {
  let calls = 0
  const off = subscribeLeaders(() => (calls += 1))
  borrowLeader(null)
  setToolLeaders([])
  off()
  expect(calls).toBe(0)
})
