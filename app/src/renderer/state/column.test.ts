import { describe, expect, it } from 'vitest'
import { benchTabs, readBench, tabShown, CARD_DEFAULT, CARD_MAX, CARD_NARROW, clampLeft, COLUMN_DEFAULT, COLUMN_KEY, leftDefault, VIEWPORT_MIN, readColumn, cardFor, storedColumn, writeColumn } from './column'

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
  it('starts at the default width', () => {
    expect(COLUMN_DEFAULT).toEqual({ width: 296 })
    expect(readColumn(null)).toEqual(COLUMN_DEFAULT)
    expect(readColumn('nope')).toEqual(COLUMN_DEFAULT)
  })

  it('reads an old value ({ open, width }) for its width', () => {
    expect(readColumn('{"open":"marks","width":300}')).toEqual({ ...COLUMN_DEFAULT, width: 300 })
    expect(readColumn('{"open":null,"width":400}')).toEqual({ ...COLUMN_DEFAULT, width: 400 })
    // The older shape still: folded sections as an object, a marks height.
    const older = { folded: { objects: true, layers: false }, marks: 320, width: 350 }
    expect(readColumn(JSON.stringify(older))).toEqual({ ...COLUMN_DEFAULT, width: 350 })
  })

  it('reads back what was written, and nothing but the window keeps it', () => {
    const storage = memory()
    writeColumn(storage, { width: 400 })
    expect(Object.keys(storage.data)).toEqual([COLUMN_KEY])
    expect(readColumn(storedColumn(storage))).toEqual({ width: 400 })
    writeColumn(storage, { width: 300 })
    expect(readColumn(storedColumn(storage))).toEqual({ width: 300 })
  })

  it('leaves the folded sections of an earlier card out: there are none now', () => {
    expect(readColumn('{"folded":["tracings","history","scans"],"width":300}')).toEqual({ width: 300 })
  })

  it('takes what it can of a value that is not its own, and the default for the rest', () => {
    expect(readColumn('[1, 2]')).toEqual(COLUMN_DEFAULT)
    expect(readColumn('{"folded":"all","width":"wide"}')).toEqual(COLUMN_DEFAULT)
    expect(readColumn('{"folded":["scans"]}')).toEqual({ width: CARD_DEFAULT })
  })

  it('never throws for a storage that refuses: the window works without it', () => {
    expect(storedColumn(refusing)).toBeNull()
    expect(readColumn(storedColumn(refusing))).toEqual(COLUMN_DEFAULT)
    expect(() => writeColumn(refusing, COLUMN_DEFAULT)).not.toThrow()
    expect(() => writeColumn(null, COLUMN_DEFAULT)).not.toThrow()
  })
})

describe('whether the card is there', () => {
  it('is for an open project, and away on a page, with a new project or with none open', () => {
    expect(cardFor({ page: 'object', objectId: 'hollow' })).toBe(true)
    expect(cardFor({ page: 'objects', objectId: 'hollow' })).toBe(false)
    expect(cardFor({ page: 'new', objectId: 'hollow' })).toBe(false)
    expect(cardFor({ page: 'object', objectId: null })).toBe(false)
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

describe('the tabs of the bench', () => {
  it('shows Parameters alone for a one-part model, Parts alone with no Params, both otherwise', () => {
    expect(benchTabs(1, 22)).toEqual(['params'])
    expect(benchTabs(4, 0)).toEqual(['parts'])
    expect(benchTabs(1, 0)).toEqual(['parts'])
    expect(benchTabs(4, 22)).toEqual(['params', 'parts'])
  })
  it('adds Shelf, last, when the workspace has a part on its shelf, with or without Params', () => {
    expect(benchTabs(1, 22, 1)).toEqual(['params', 'shelf'])
    expect(benchTabs(4, 22, 6)).toEqual(['params', 'parts', 'shelf'])
    expect(benchTabs(4, 0, 2)).toEqual(['parts', 'shelf'])
    expect(benchTabs(1, 0, 2)).toEqual(['parts', 'shelf'])
    expect(benchTabs(4, 22, 0)).toEqual(['params', 'parts'])
  })
  it('draws Shelf when it was kept and there is a shelf, else the first tab', () => {
    expect(tabShown('shelf', ['params', 'shelf'])).toBe('shelf')
    expect(tabShown('shelf', ['params'])).toBe('params')
  })
  it('draws the tab kept if the project has it, else Parameters', () => {
    expect(tabShown('parts', ['params', 'parts'])).toBe('parts')
    expect(tabShown('parts', ['params'])).toBe('params')
    expect(tabShown(undefined, ['params', 'parts'])).toBe('params')
    expect(tabShown('params', ['parts'])).toBe('parts')
  })
  it('reads what was kept for each project and nothing else', () => {
    expect(readBench(JSON.stringify({ hollow: 'parts', gear: 'params', bench: 'shelf', odd: 'marks' }))).toEqual({ hollow: 'parts', gear: 'params', bench: 'shelf' })
    expect(readBench('nonsense')).toEqual({})
    expect(readBench(null)).toEqual({})
    expect(readBench('[1]')).toEqual({})
  })
})
