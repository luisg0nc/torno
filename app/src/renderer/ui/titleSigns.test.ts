import { describe, expect, it } from 'vitest'
import { titleSigns } from './titleSigns'

const status = (s: 'working' | 'needs_input' | 'idle') => ({ status: s })

describe('titleSigns', () => {
  const objects = [
    { id: 'intake', name: 'intake' },
    { id: 'guitar', name: 'guitar-wall-stand' },
    { id: 'hinge', name: 'hinge' },
    { id: 'lid', name: 'lid' }
  ]

  it('shows the folder\'s other projects that work or wait, the one that waits first, and not the open one', () => {
    const sessions = { intake: status('working'), guitar: status('working'), hinge: status('needs_input'), lid: status('idle') }
    expect(titleSigns(objects, sessions, 'intake')).toEqual({
      shown: [
        { id: 'hinge', name: 'hinge', state: 'needs_input' },
        { id: 'guitar', name: 'guitar-wall-stand', state: 'working' }
      ],
      more: 0
    })
  })

  it('counts what does not fit after the first two', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id }))
    const sessions = Object.fromEntries(many.map((o) => [o.id, status(o.id === 'e' ? 'needs_input' : 'working')]))
    const got = titleSigns(many, sessions, 'f')
    expect(got.shown.map((s) => s.id)).toEqual(['e', 'a'])
    expect(got.more).toBe(3)
    expect(titleSigns(many, sessions, 'f', 3).more).toBe(2)
  })

  it('has none when no other project works or waits, or when a session is starting, idle or ended', () => {
    expect(titleSigns(objects, { intake: status('working'), lid: status('idle') }, 'intake')).toEqual({ shown: [], more: 0 })
    expect(titleSigns(objects, {}, null)).toEqual({ shown: [], more: 0 })
  })

  it('with no project open, every project that works or waits is a sign', () => {
    expect(titleSigns(objects, { intake: status('working') }, null).shown.map((s) => s.id)).toEqual(['intake'])
  })
})
