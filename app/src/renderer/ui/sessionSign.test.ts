import { describe, expect, it } from 'vitest'
import { dockToggleName, dockToggleSaid, rowSaid, signOf, waitingObjects } from './sessionSign'

const objects = [
  { id: 'bracket', name: 'bracket' },
  { id: 'hollow', name: 'hollow' },
  { id: 'plain', name: 'plain' }
]

describe('signOf', () => {
  it('has one for a session at work and one that waits for the person, and none for the rest', () => {
    expect(signOf('needs_input')).toBe('needs_input')
    expect(signOf('working')).toBe('working')
    for (const status of ['starting', 'idle', 'exited'] as const) expect(signOf(status)).toBeNull()
    expect(signOf(undefined)).toBeNull()
  })
})

describe('waitingObjects', () => {
  it('lists the objects whose session needs the person, in the order of the list and not of the sessions', () => {
    const sessions = {
      plain: { sessionId: 'c', view: 'chat' as const, status: 'needs_input' as const },
      bracket: { sessionId: 'a', view: 'chat' as const, status: 'working' as const },
      hollow: { sessionId: 'b', view: 'terminal' as const, status: 'needs_input' as const }
    }
    expect(waitingObjects(objects, sessions).map((o) => o.id)).toEqual(['hollow', 'plain'])
  })

  it('names none for a session of no object of the list, nor for sessions that are idle or ended', () => {
    const sessions = {
      ghost: { sessionId: 'g', view: 'chat' as const, status: 'needs_input' as const },
      bracket: { sessionId: 'a', view: 'chat' as const, status: 'idle' as const },
      hollow: { sessionId: 'b', view: 'chat' as const, status: 'exited' as const }
    }
    expect(waitingObjects(objects, sessions)).toEqual([])
  })
})

describe('what is said, for a screen reader and for a title', () => {
  it('describes a row by its session, and says nothing of one with no sign; the name is never changed', () => {
    expect(rowSaid('needs_input')).toBe('session needs you')
    expect(rowSaid('working')).toBe('session is working')
    expect(rowSaid(null)).toBeUndefined()
  })

  it('names the toggle of the dock the same with or without a sign, and describes a hidden one whose session has a sign', () => {
    expect(dockToggleName(true)).toBe('Hide session')
    expect(dockToggleName(false)).toBe('Show session')
    expect(dockToggleSaid(true, 'needs_input')).toBeUndefined()
    expect(dockToggleSaid(false, null)).toBeUndefined()
    expect(dockToggleSaid(false, 'needs_input')).toBe('Claude Code needs you')
    expect(dockToggleSaid(false, 'working')).toBe('Claude Code is working')
  })
})
