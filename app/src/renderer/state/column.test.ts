import { describe, expect, it } from 'vitest'
import { CARD_DEFAULT, CARD_MAX, CARD_NARROW, clampLeft, COLUMN_DEFAULT, COLUMN_KEY, leftDefault, SECTION_IDS, VIEWPORT_MIN, readColumn, sectionsFor, storedColumn, writeColumn } from './column'

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

describe('the route card as the person keeps it', () => {
  it('starts with Needs you, Parts, Checks and Marks open and the rest folded, at the default width', () => {
    expect(COLUMN_DEFAULT).toEqual({ folded: ['params', 'scans', 'tracings'], width: 296 })
    expect(readColumn(null)).toEqual(COLUMN_DEFAULT)
    expect(readColumn('nope')).toEqual(COLUMN_DEFAULT)
  })

  it('reads an old value ({ open, width }) as the default folding at its width', () => {
    expect(readColumn('{"open":"marks","width":300}')).toEqual({ ...COLUMN_DEFAULT, width: 300 })
    expect(readColumn('{"open":null,"width":400}')).toEqual({ ...COLUMN_DEFAULT, width: 400 })
    // The older shape still: folded sections as an object, a marks height.
    const older = { folded: { objects: true, layers: false }, marks: 320, width: 350 }
    expect(readColumn(JSON.stringify(older))).toEqual({ ...COLUMN_DEFAULT, width: 350 })
  })

  it('reads back what was written, and nothing but the window keeps it', () => {
    const storage = memory()
    writeColumn(storage, { folded: ['parts', 'marks'], width: 400 })
    expect(Object.keys(storage.data)).toEqual([COLUMN_KEY])
    expect(readColumn(storedColumn(storage))).toEqual({ folded: ['parts', 'marks'], width: 400 })
    writeColumn(storage, { folded: [], width: 300 })
    expect(readColumn(storedColumn(storage))).toEqual({ folded: [], width: 300 })
  })

  it('keeps the known sections of a folded list, once each and in the card\'s order', () => {
    expect(readColumn('{"folded":["marks","history","marks","needs"],"width":300}')).toEqual({ folded: ['marks'], width: 300 })
  })

  it('takes what it can of a value that is not its own, and the default for the rest', () => {
    expect(readColumn('[1, 2]')).toEqual(COLUMN_DEFAULT)
    expect(readColumn('{"folded":"all","width":"wide"}')).toEqual(COLUMN_DEFAULT)
    expect(readColumn('{"folded":["scans"]}')).toEqual({ folded: ['scans'], width: CARD_DEFAULT })
  })

  it('never throws for a storage that refuses: the window works without it', () => {
    expect(storedColumn(refusing)).toBeNull()
    expect(readColumn(storedColumn(refusing))).toEqual(COLUMN_DEFAULT)
    expect(() => writeColumn(refusing, COLUMN_DEFAULT)).not.toThrow()
    expect(() => writeColumn(null, COLUMN_DEFAULT)).not.toThrow()
  })
})

describe('which sections the card has', () => {
  it('has all six for an open project and none on a page, with a new project or with none open', () => {
    expect(SECTION_IDS).toEqual(['parts', 'params', 'checks', 'marks', 'scans', 'tracings'])
    expect(sectionsFor({ page: 'object', objectId: 'hollow' })).toEqual(SECTION_IDS)
    expect(sectionsFor({ page: 'objects', objectId: 'hollow' })).toEqual([])
    expect(sectionsFor({ page: 'new', objectId: 'hollow' })).toEqual([])
    expect(sectionsFor({ page: 'object', objectId: null })).toEqual([])
  })
})

describe('the width of the card', () => {
  it('is kept from the narrow default up to the most, and what is no width is the default', () => {
    expect(readColumn('{"width":360.4}').width).toBe(360)
    for (const width of [100, 248, -5]) expect(readColumn(JSON.stringify({ width })).width).toBe(CARD_NARROW)
    for (const width of ['wide', null]) expect(readColumn(JSON.stringify({ width })).width).toBe(CARD_DEFAULT)
    expect(readColumn('{"width":99999}').width).toBe(CARD_MAX)
  })

  it('is 296, and 264 in a window narrower than 1360; what is kept never goes below the narrow one', () => {
    expect([CARD_DEFAULT, CARD_NARROW, VIEWPORT_MIN]).toEqual([296, 264, 420])
    expect(leftDefault(1440)).toBe(296)
    expect(leftDefault(1359)).toBe(264)
    expect(leftDefault(1280)).toBe(264)
  })

  it('is bounded below by the default of the window and above by the room the viewport keeps beside the dock', () => {
    expect(clampLeft(100, 1600, 420)).toBe(CARD_DEFAULT)
    expect(clampLeft(CARD_NARROW, 1600, 420)).toBe(CARD_DEFAULT)
    expect(clampLeft(100, 1280, 384)).toBe(264)
    // The default width stands for the default of whichever window shows it.
    expect(clampLeft(CARD_DEFAULT, 1280, 384)).toBe(264)
    expect(clampLeft(280, 1280, 384)).toBe(280)
    expect(clampLeft(400, 1600, 420)).toBe(400)
    expect(clampLeft(5000, 1600, 420)).toBe(1600 - 420 - VIEWPORT_MIN)
    expect(clampLeft(5000, 1600, 0)).toBe(1600 - VIEWPORT_MIN)
    expect(clampLeft(5000, 600, 420)).toBe(264)
    expect(clampLeft(5000, 1000, 420)).toBe(CARD_NARROW)
  })
})
