import { describe, expect, it } from 'vitest'
import { INSTRUCTIONS_LIMIT, SERVER_INSTRUCTIONS, TOOLS } from './schemas'

type Entry = { title: string; description: string; annotations: Record<string, boolean>; meta?: Record<string, unknown> }
const entries = Object.entries(TOOLS) as Array<[string, Entry]>

// What a client reads of a tool before it calls one: Claude Code runs the calls of read-only tools side by side
// and, with its tool search on, shows only a tool's name and the server's instructions until it is searched for.
describe('what the tools tell a client', () => {
  it('gives every tool a title in sentence case and an annotation that it reaches nowhere outside the object', () => {
    for (const [name, tool] of entries) {
      expect(tool.title, name).toMatch(/^[A-Z][a-z]/)
      expect(tool.title, name).toBe(tool.title.charAt(0) + tool.title.slice(1).replace(/[A-Z]/g, (c) => c.toLowerCase()))
      expect(tool.annotations.openWorldHint, name).toBe(false)
      expect(typeof tool.annotations.readOnlyHint, name).toBe('boolean')
    }
  })

  it('marks the tools that only read as read-only, and the ones that change the view or the marks as neither read-only nor destructive', () => {
    const readOnly = ['board', 'check', 'describe', 'diff', 'features', 'history', 'look', 'marks', 'measure', 'scan_clash', 'scan_deviation', 'scans', 'scene', 'section', 'try_fillet', 'try_params']
    expect(entries.filter(([, tool]) => tool.annotations.readOnlyHint).map(([name]) => name).sort()).toEqual(readOnly)
    for (const [name, tool] of entries.filter(([name]) => !readOnly.includes(name))) expect(tool.annotations, name).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false })
  })

  it('loads upfront the five tools needed on nearly every turn, and no other', () => {
    expect(entries.filter(([, tool]) => tool.meta?.['anthropic/alwaysLoad'] === true).map(([name]) => name).sort()).toEqual(['describe', 'look', 'marks', 'measure', 'scene'])
    for (const [name, tool] of entries) {
      expect(Object.keys(tool.meta ?? {}).filter((key) => key !== 'anthropic/alwaysLoad'), name).toEqual([])
      // Claude Code cuts a description loaded upfront at this many characters.
      expect(tool.description.length, name).toBeLessThan(INSTRUCTIONS_LIMIT)
    }
  })

  it('has instructions under the length Claude Code cuts them at, with a line for every tool and the words an agent searches with', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(INSTRUCTIONS_LIMIT)
    const lines = SERVER_INSTRUCTIONS.split('\n').filter((line) => line.startsWith('- '))
    expect(lines.map((line) => line.slice(2, line.indexOf(':'))).sort()).toEqual(Object.keys(TOOLS).sort())
    for (const word of ['measure', 'wall thickness', 'section', 'clearance', 'picture', 'marks', 'overlap', 'scan']) expect(SERVER_INSTRUCTIONS, word).toContain(word)
    expect(SERVER_INSTRUCTIONS.split('\n')[0]).toContain('CAD part of the project this session works on')
  })
})

describe('marks and the review', () => {
  it('marks takes review, a round or all, and says what it lists', () => {
    expect(Object.keys(TOOLS.marks.inputSchema)).toContain('review')
    expect(TOOLS.marks.description).toContain('review')
    expect(TOOLS.marks.description).toContain('removed on purpose')
  })

  it('add_mark and add_sketch offer no want or don\'t want: Claude\'s marks are plain', () => {
    expect(Object.keys(TOOLS.add_sketch.inputSchema)).not.toContain('intent')
    const intent = (TOOLS.add_mark.inputSchema as Record<string, { safeParse(value: unknown): { success: boolean } }>).intent
    for (const own of ['add', 'remove', 'keep-out', 'reference']) expect(intent.safeParse(own).success, own).toBe(true)
    for (const review of ['want', 'dont']) expect(intent.safeParse(review).success, review).toBe(false)
    expect(TOOLS.add_mark.description).toContain("review")
  })
})
