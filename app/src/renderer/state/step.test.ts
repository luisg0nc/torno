import { describe, expect, it } from 'vitest'
import { CAPTION_PAUSE_MS, CAPTION_USES, HINT_KEY, TOOL_USES_KEY, captionShows, countToolUse, hintLine, pointerHintDue, rememberPointerHint, scanless, sketchLine, stepFor, toolUses } from './step'
import { NO_SCAN_YET, TOOL_KEYS, hint } from '../../shared/keys'

/** A storage of the window, as the tests need it. */
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

describe('the one-time pointer hint', () => {
  it('is due until it was seen, and a storage that is not there or refuses shows it again', () => {
    expect(pointerHintDue(memory())).toBe(true)
    expect(pointerHintDue(null)).toBe(true)
    expect(pointerHintDue(refusing)).toBe(true)
    const storage = memory()
    rememberPointerHint(storage)
    expect(Object.keys(storage.data)).toEqual([HINT_KEY])
    expect(pointerHintDue(storage)).toBe(false)
    expect(() => rememberPointerHint(refusing)).not.toThrow()
    expect(() => rememberPointerHint(null)).not.toThrow()
  })

  it('is the window’s, never the workspace’s: nothing but the window’s storage holds it', () => {
    expect(HINT_KEY).toBe('torno.pointerHint')
  })
})

describe('the line at the foot of the view', () => {
  const none = { tool: 'select' as const, stage: 'first' as const, replacing: null, scans: 1, due: false }

  it('says nothing with Select in hand and the hint gone, and the pointer with Select in hand while the hint is due', () => {
    expect(hintLine(none)).toBeNull()
    expect(hintLine({ ...none, due: true })).toEqual({ kind: 'pointer' })
  })

  it('says what each tool in hand waits for, and the tool’s step takes the hint’s place', () => {
    for (const t of TOOL_KEYS.filter((k) => k.next !== null && k.name !== 'region' && k.name !== 'align')) {
      expect([t.name, hintLine({ ...none, tool: t.name, due: true })]).toEqual([t.name, { kind: 'step', text: t.next }])
    }
  })

  it('goes on to the second end of a measurement', () => {
    expect(hintLine({ ...none, tool: 'measure', stage: 'second' })).toEqual({ kind: 'step', text: 'Measure: click the second end' })
    // The stage is of Measure alone.
    expect(hintLine({ ...none, tool: 'pin', stage: 'second' })).toEqual({ kind: 'step', text: 'Pin: click the part, then write a note' })
  })

  it('says where the pin that is being put somewhere else goes', () => {
    expect(hintLine({ ...none, tool: 'pin', replacing: 'M3' })).toEqual({ kind: 'step', text: 'Pin: click the part where M3 should be' })
  })

  it('tells a scan tool with no scan to import one first, and a scan tool with one what it waits for', () => {
    for (const tool of ['region', 'align'] as const) {
      expect(hintLine({ ...none, tool, scans: 0 })).toEqual({ kind: 'step', text: `${TOOL_KEYS.find((k) => k.name === tool)!.label}: ${NO_SCAN_YET.toLowerCase()}` })
      expect(hintLine({ ...none, tool, scans: 1 })).toEqual({ kind: 'step', text: TOOL_KEYS.find((k) => k.name === tool)!.next })
    }
  })

  it('names no key of a tool, nor any key but Esc, which puts the tool down', () => {
    const keys = new Set([...TOOL_KEYS.map((t) => t.key), hint('keys')])
    for (const t of TOOL_KEYS) {
      const text = stepFor(t.name, 'first', null, 1)
      for (const word of (text ?? '').split(/[^A-Za-z?]+/)) expect([t.name, word, keys.has(word)]).toEqual([t.name, word, false])
    }
  })

  it('knows a scan tool with no scan by the count of scans, once main has said', () => {
    expect(scanless('region', 0)).toBe(true)
    expect(scanless('align', 0)).toBe(true)
    expect(scanless('region', null)).toBe(false)
    expect(scanless('region', 2)).toBe(false)
    expect(scanless('pin', 0)).toBe(false)
  })
})

describe('the caption at the pointer', () => {
  it('shows for the first ten uses of a tool at once, and after that only when the pointer has been still for half a second', () => {
    expect([CAPTION_USES, CAPTION_PAUSE_MS]).toEqual([10, 500])
    expect(captionShows(3, 0)).toBe(true)
    expect(captionShows(CAPTION_USES - 1, 0)).toBe(true)
    expect(captionShows(10, 100)).toBe(false)
    expect(captionShows(10, 499)).toBe(false)
    expect(captionShows(10, 500)).toBe(true)
    expect(captionShows(250, 5000)).toBe(true)
  })

  it('counts a use in the window’s storage, and a storage that is not there or refuses counts none', () => {
    expect(TOOL_USES_KEY).toBe('torno.toolUses')
    const storage = memory()
    expect(toolUses(storage)).toBe(0)
    countToolUse(storage)
    countToolUse(storage)
    expect(toolUses(storage)).toBe(2)
    expect(Object.keys(storage.data)).toEqual([TOOL_USES_KEY])
    expect(toolUses(refusing)).toBe(0)
    expect(toolUses(null)).toBe(0)
    expect(toolUses(memory({ [TOOL_USES_KEY]: 'many' }))).toBe(0)
    expect(() => countToolUse(refusing)).not.toThrow()
    expect(() => countToolUse(null)).not.toThrow()
  })
})

describe('a sketch’s standing line at the foot of the view', () => {
  it('says whether it snaps and how to drop it, and where x-ray is', () => {
    expect(sketchLine({ snapping: true, xray: false })).toEqual({ snap: `Snapping on, hold ${hint('sketch.snap')} to drop it.`, xray: 'X-ray', cap: hint('sketch.xray') })
    expect(sketchLine({ snapping: false, xray: true })).toEqual({ snap: 'Snapping off.', xray: 'X-ray on', cap: hint('sketch.xray') })
  })
})
