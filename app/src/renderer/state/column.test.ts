import { describe, expect, it } from 'vitest'
import { clampLeft, COLUMN_DEFAULT, COLUMN_KEY, LEFT_DEFAULT, LEFT_MIN, leftDefault, PANEL_MAX, RAIL_W, VIEWPORT_MIN, panelsFor, readColumn, shownPanel, writeColumn } from './column'

/** A storage of the window, as the tests need it: what was written, and one that refuses. */
function memory(start: Record<string, string> = {}): Storage & { data: Record<string, string> } {
  const data = { ...start }
  return {
    data,
    get length() {
      return Object.keys(data).length
    },
    clear: () => Object.keys(data).forEach((key) => delete data[key]),
    key: (n: number) => Object.keys(data)[n] ?? null,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => void (data[key] = value),
    removeItem: (key: string) => void delete data[key]
  }
}

const refusing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  }
} as unknown as Storage

describe('the rail and its panel as the person keeps them', () => {
  it('starts with the marks open at the default width', () => {
    expect(COLUMN_DEFAULT).toEqual({ open: 'marks', width: LEFT_MIN })
    expect(readColumn(memory())).toEqual(COLUMN_DEFAULT)
    expect(readColumn(null)).toEqual(COLUMN_DEFAULT)
  })

  it('reads back what was written, and nothing but the window keeps it', () => {
    const storage = memory()
    writeColumn(storage, { open: 'layers', width: 400 })
    expect(Object.keys(storage.data)).toEqual([COLUMN_KEY])
    expect(readColumn(storage)).toEqual({ open: 'layers', width: 400 })
    writeColumn(storage, { open: null, width: 300 })
    expect(readColumn(storage)).toEqual({ open: null, width: 300 })
  })

  it('reads a value of the old shape (folded sections, marks height, width) as the marks open at its width', () => {
    const old = { folded: { objects: true, layers: false, params: true, checks: true, print: true, scans: false }, marks: 320, width: 400 }
    expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify(old) }))).toEqual({ open: 'marks', width: 400 })
    expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify({ ...old, width: null }) }))).toEqual({ open: 'marks', width: LEFT_MIN })
  })

  it('takes what it can of a value that is not its own, and the default for the rest', () => {
    expect(readColumn(memory({ [COLUMN_KEY]: 'not json' }))).toEqual(COLUMN_DEFAULT)
    expect(readColumn(memory({ [COLUMN_KEY]: '[1, 2]' }))).toEqual(COLUMN_DEFAULT)
    expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify({ open: 'history', width: 'wide' }) }))).toEqual(COLUMN_DEFAULT)
    expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify({ open: 'scans' }) }))).toEqual({ open: 'scans', width: LEFT_MIN })
  })

  it('never throws for a storage that refuses: the window works without it', () => {
    expect(readColumn(refusing)).toEqual(COLUMN_DEFAULT)
    expect(() => writeColumn(refusing, COLUMN_DEFAULT)).not.toThrow()
    expect(() => writeColumn(null, COLUMN_DEFAULT)).not.toThrow()
  })
})

describe('which panels there are, and which is shown', () => {
  const at = (page: 'object' | 'objects' | 'new', objectId: string | null = 'hollow') => panelsFor({ page, objectId })

  it('has the five of an open project, Projects and Marks on the page of projects, Projects alone for a new one or none open', () => {
    expect(at('object')).toEqual(['projects', 'layers', 'params', 'scans', 'marks'])
    expect(at('objects')).toEqual(['projects', 'marks'])
    expect(at('new')).toEqual(['projects'])
    expect(at('objects', null)).toEqual(['projects'])
    expect(at('new', null)).toEqual(['projects'])
    expect(at('object', null)).toEqual(['projects'])
  })

  it('shows the one kept when it is there, none when it is not, and Projects when none is open and the person has not closed it', () => {
    expect(shownPanel('layers', at('object'))).toBe('layers')
    expect(shownPanel('layers', at('objects'))).toBeNull()
    expect(shownPanel('marks', at('objects'))).toBe('marks')
    expect(shownPanel(null, at('object'))).toBeNull()
    expect(shownPanel('marks', at('object', null))).toBe('projects')
    expect(shownPanel(null, at('object', null))).toBeNull()
  })
})

describe('the width of the panel', () => {
  it('is kept from the default up to the most, and the old null is the default', () => {
    expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify({ open: 'marks', width: 360.4 }) })).width).toBe(360)
    for (const width of [LEFT_MIN, 100, 248, 'wide', null, -5]) expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify({ open: 'marks', width }) })).width).toBe(LEFT_MIN)
    expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify({ open: 'marks', width: 99999 }) })).width).toBe(PANEL_MAX)
    expect(readColumn(memory({ [COLUMN_KEY]: JSON.stringify({ open: 'marks', width: Number.POSITIVE_INFINITY }) })).width).toBe(LEFT_MIN)
  })

  it('is 296, and 264 in a window narrower than 1360; what is kept never goes below the narrow one', () => {
    expect([LEFT_DEFAULT, LEFT_MIN, RAIL_W, VIEWPORT_MIN]).toEqual([296, 264, 52, 420])
    expect(leftDefault(1440)).toBe(296)
    expect(leftDefault(1359)).toBe(264)
    expect(leftDefault(1280)).toBe(264)
  })

  it('is bounded below by the default of the window and above by the room the viewport keeps beside the rail and the dock', () => {
    expect(clampLeft(100, 1600, 420)).toBe(LEFT_DEFAULT)
    expect(clampLeft(LEFT_MIN, 1600, 420)).toBe(LEFT_DEFAULT)
    expect(clampLeft(100, 1280, 384)).toBe(264)
    expect(clampLeft(280, 1280, 384)).toBe(280)
    expect(clampLeft(400, 1600, 420)).toBe(400)
    expect(clampLeft(5000, 1600, 420)).toBe(1600 - 420 - VIEWPORT_MIN - RAIL_W)
    expect(clampLeft(5000, 1600, 0)).toBe(1600 - VIEWPORT_MIN - RAIL_W)
    expect(clampLeft(5000, 600, 420)).toBe(264)
    expect(clampLeft(5000, 1000, 420)).toBe(LEFT_MIN)
  })
})
