import { beforeEach, describe, expect, it } from 'vitest'
import { TIMELINE_KEY, readTimeline, timeline, timelineActions, writeTimeline } from './timeline'

function memory(start: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } {
  const data = { ...start }
  return { data, getItem: (key: string) => data[key] ?? null, setItem: (key: string, value: string) => void (data[key] = value) }
}

const refusing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  }
} as unknown as Storage

describe('whether the builds timeline is open, kept by the window', () => {
  it('is shut unless the window kept it open', () => {
    expect(readTimeline(null)).toBe(false)
    expect(readTimeline(refusing)).toBe(false)
    expect(readTimeline(memory())).toBe(false)
    expect(readTimeline(memory({ [TIMELINE_KEY]: 'open' }))).toBe(true)
    expect(readTimeline(memory({ [TIMELINE_KEY]: 'shut' }))).toBe(false)
    expect(readTimeline(memory({ [TIMELINE_KEY]: 'nonsense' }))).toBe(false)
  })

  it('is written as open or shut, and a storage that refuses is let go', () => {
    const storage = memory()
    writeTimeline(storage, true)
    expect(storage.data[TIMELINE_KEY]).toBe('open')
    writeTimeline(storage, false)
    expect(storage.data[TIMELINE_KEY]).toBe('shut')
    expect(() => writeTimeline(refusing, true)).not.toThrow()
    expect(() => writeTimeline(null, true)).not.toThrow()
  })
})

describe('the drawer and its groups', () => {
  beforeEach(() => timeline.setState({ open: false, expanded: [] }))

  it('opens, folds and toggles', () => {
    timelineActions.setOpen(true)
    expect(timeline.getState().open).toBe(true)
    timelineActions.toggle()
    expect(timeline.getState().open).toBe(false)
  })

  it('opens a group, and folds it back', () => {
    timelineActions.toggleGroup('h2')
    timelineActions.toggleGroup('h5')
    expect(timeline.getState().expanded).toEqual(['h2', 'h5'])
    timelineActions.toggleGroup('h2')
    expect(timeline.getState().expanded).toEqual(['h5'])
  })

  it('shows a group from the bar: the drawer opens with that group open, once', () => {
    timelineActions.reveal('h2')
    timelineActions.reveal('h2')
    expect(timeline.getState()).toMatchObject({ open: true, expanded: ['h2'] })
  })
})
