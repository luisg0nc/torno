import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import type { Mark } from '../../shared/marks'
import type { Scene } from '../../shared/scene'
import { MOST_SET_MEMBERS, type NamedSet, type SelectorFound } from '../../shared/sets'
import { SetStore } from '../sets/store'
import { addSetTool } from './setTools'
import { highlightTool } from './markTools'
import { TOOLS, refusedKeys } from './schemas'
import type { ToolDeps } from './tools'

// `add_set`: Claude proposes a named set, through a real store over a folder and a kernel that answers `selectors`.

const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 7, seconds: 1, stale: false }
const CAMERA = { position: [100, -100, 80], target: [0, 0, 10], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 }

const part = (name: string, layout: string, faceCount: number, edgeCount: number, tags?: Scene['parts'][number]['tags']) =>
  ({ name, layout, faceCount, edgeCount, bbox: { min: [0, 0, 0], max: [10, 10, 10] }, ...(tags ? { tags } : {}) }) as unknown as Scene['parts'][number]
const scene = {
  model: 'm.py',
  layouts: ['assembly', 'print'],
  parts: [part('block', 'assembly', 20, 40), part('lid', 'assembly', 6, 12, { top: { faces: [1] } }), part('block', 'print', 20, 40)]
} as unknown as Scene
const sketch = { id: 'M7', kind: 'sketch', author: 'person', layout: 'assembly', strokes: [{ id: 'k3', points: [[0, 0, 0]] }], nextStroke: 4 } as unknown as Mark

let root: string
let store: SetStore
let deps: ToolDeps
/** The refs the kernel was asked for with `selectors`, and the layout: one entry for each query. */
let queries: Array<{ layout: string; refs: string[] }>
let kernel: (args: { layout: string; refs: string[] }) => Promise<{ selectors: SelectorFound[] }>
const shown: Array<{ layout: string; refs: string[]; strokes?: string[] }> = []

const text = (r: { content: Array<{ type: string; text?: string }> }): string => r.content.map((c) => c.text ?? '').join('\n')
const sets = (): Promise<NamedSet[]> => store.list('bracket')
const answer = (ref: string, n: number): SelectorFound => {
  const edge = ref.includes('/E')
  return {
    ref,
    type: edge ? 'LINE' : 'PLANE',
    center: [n, n + 1, n + 2],
    ...(edge ? {} : { normal: [0, 0, 1] as [number, number, number] }),
    selector: { expression: 'x', form: edge ? { of: 'edges', prefix: { by: 'type', type: 'LINE' }, terminal: { only: true } } : { of: 'faces', prefix: { by: 'type', type: 'PLANE' }, terminal: { only: true } } }
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'torno-add-set-'))
  mkdirSync(join(root, 'bracket'))
  store = new SetStore({
    dirOf: (id) => (id === 'bracket' ? join(root, id) : undefined),
    scene: () => ({ revision: 7, scene }),
    marks: async () => [sketch]
  })
  queries = []
  kernel = async ({ refs }) => ({ selectors: refs.map((ref) => answer(ref, Number(ref.replace(/\D+/g, '')) || 1)) })
  shown.length = 0
  deps = {
    object: (id: string) => (id === 'bracket' ? { id, name: 'bracket', dir: join(root, id), model: 'm.py' } : undefined),
    build: () => OK,
    scene: () => ({ revision: 7, scene }),
    openObjectId: () => 'bracket',
    view: () => ({ objectId: 'bracket', layout: 'assembly', camera: CAMERA, visible: [] }),
    marks: async () => [sketch],
    sets: (id: string) => store.list(id),
    setStore: store,
    query: async (_id: string, name: string, args: { layout: string; refs: string[] }) => {
      expect(name).toBe('selectors')
      queries.push(args)
      return kernel(args)
    },
    highlight: async (_id: string, layout: string, refs: string[], _note?: string, strokes?: string[]) => {
      shown.push({ layout, refs, ...(strokes && strokes.length > 0 ? { strokes } : {}) })
      return { objectId: 'bracket', layout, refs, strokes: strokes ?? [], missing: [] }
    }
  } as unknown as ToolDeps
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('add_set proposes a named set', () => {
  it('stores a proposal of the agent\'s, asks the kernel for its faces first, and says what the person sees and may do', async () => {
    const result = await addSetTool(deps, 'bracket', { name: 'intake', comment: 'where the air goes in', refs: ['block/F1', 'block/F2', 'block/F3'] })
    expect(result.isError, text(result)).toBeUndefined()
    expect(JSON.parse(text(result))).toEqual({
      set: '#intake',
      id: 'N1',
      proposed: true,
      members: ['block/F1', 'block/F2', 'block/F3'],
      reading: 'Proposed #intake (N1): 3 faces. The person sees it dashed and accepts or dismisses it; you may use #intake meanwhile.'
    })
    expect(queries).toEqual([{ layout: 'assembly', refs: ['block/F1', 'block/F2', 'block/F3'] }])
    const [made] = await sets()
    expect(made).toMatchObject({ id: 'N1', name: 'intake', slug: 'intake', comment: 'where the air goes in', layout: 'assembly', by: 'agent', proposed: true })
    // Each member is where the kernel says its face is: none is held at a placeholder, and the selector is kept.
    expect(made.members).toHaveLength(3)
    expect(made.members[1]).toMatchObject({ face: 'block/F2', type: 'PLANE', point: [2, 3, 4], normal: [0, 0, 1], state: 'ok', selector: { of: 'faces' } })
    expect(made.members.some((m) => 'held' in m)).toBe(false)
  })

  it('refuses a second set of the same name, in any case, and one that the person has', async () => {
    expect((await addSetTool(deps, 'bracket', { name: 'intake', refs: ['block/F1'] })).isError).toBeUndefined()
    const again = await addSetTool(deps, 'bracket', { name: 'Intake', refs: ['block/F2'] })
    expect(again.isError).toBe(true)
    expect(text(again)).toBe('#intake is taken (N1)')
    expect(await sets()).toHaveLength(1)
    await store.make('bracket', { name: 'deck', comment: '', layout: 'assembly', members: [{ ref: 'block/F4', point: [0, 0, 0], normal: [0, 0, 1] }] }, 'person')
    expect(text(await addSetTool(deps, 'bracket', { name: 'deck', refs: ['block/F5'] }))).toBe('#deck is taken (N2)')
    expect(await sets()).toHaveLength(2)
  })

  it('refuses no refs, and a name that is none: a 41-character one, one that starts with a digit, one with a slash', async () => {
    expect(text(await addSetTool(deps, 'bracket', { name: 'x', refs: [] }))).toMatch(/give refs/)
    expect(text(await addSetTool(deps, 'bracket', { name: 'x' } as never))).toMatch(/give refs/)
    expect(text(await addSetTool(deps, 'bracket', { name: 'a'.repeat(41), refs: ['block/F1'] }))).toBe('A name has at most 40 characters.')
    expect(text(await addSetTool(deps, 'bracket', { name: '9lives', refs: ['block/F1'] }))).toBe('A name must start with a letter.')
    expect(text(await addSetTool(deps, 'bracket', { name: 'a/b', refs: ['block/F1'] }))).toMatch(/no "\/"/)
    expect(text(await addSetTool(deps, 'bracket', { name: '', refs: ['block/F1'] }))).toBe('A named set needs a name.')
    expect(await sets()).toHaveLength(0)
    expect(queries).toEqual([])
  })

  it('takes a tag\'s face and a stroke: its refs are faces, edges, parts and strokes', async () => {
    const result = await addSetTool(deps, 'bracket', { name: 'lid top', refs: ['lid/@top', 'M7/k3', 'block', 'block/E4'] })
    expect(result.isError, text(result)).toBeUndefined()
    const told = JSON.parse(text(result))
    expect(told.set).toBe('#lid-top')
    expect(told.members).toEqual(['lid/F1', 'block', 'block/E4', 'M7/k3'])
    expect(told.reading).toBe('Proposed #lid-top (N1): 1 face, 1 edge, 1 part, 1 stroke. The person sees it dashed and accepts or dismisses it; you may use #lid-top meanwhile.')
    const [made] = await sets()
    expect(made.members).toEqual(expect.arrayContaining([expect.objectContaining({ face: 'lid/F1', point: [1, 2, 3] }), { stroke: 'M7/k3' }, { part: 'block' }]))
    // The kernel is asked for the faces and edges of each part, and for no part or stroke.
    expect(queries).toEqual([{ layout: 'assembly', refs: ['lid/F1'] }, { layout: 'assembly', refs: ['block/E4'] }])
  })

  it('expands a set among the refs to its members, and a stroke that is gone is refused', async () => {
    await store.make('bracket', { name: 'deck', comment: '', layout: 'assembly', members: [{ ref: 'block/F4', point: [0, 0, 0], normal: [0, 0, 1] }, { ref: 'block/F5', point: [0, 0, 0], normal: [0, 0, 1] }] }, 'person')
    const result = await addSetTool(deps, 'bracket', { name: 'more', refs: ['#deck', 'block/F9'] })
    expect(JSON.parse(text(result)).members).toEqual(['block/F4', 'block/F5', 'block/F9'])
    const gone = await addSetTool(deps, 'bracket', { name: 'route', refs: ['M7/k9'] })
    expect(gone.isError).toBe(true)
    expect(text(gone)).toContain('M7/k9')
    expect(await sets()).toHaveLength(2)
  })

  it('refuses a ref the build does not have, naming it, and writes nothing', async () => {
    const result = await addSetTool(deps, 'bracket', { name: 'bad', refs: ['block/F1', 'block/F99', 'ghost'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('block has 20 faces, F0 to F19: there is no F99')
    expect(text(result)).toContain("no part 'ghost'")
    expect(await sets()).toHaveLength(0)
    expect(queries).toEqual([])
  })

  it('is in the layout on show unless it names one, and asks the kernel in that layout', async () => {
    const result = await addSetTool(deps, 'bracket', { name: 'printed', refs: ['block/F1'], layout: 'print' })
    expect(result.isError, text(result)).toBeUndefined()
    expect((await sets())[0].layout).toBe('print')
    expect(queries).toEqual([{ layout: 'print', refs: ['block/F1'] }])
    expect(text(await addSetTool(deps, 'bracket', { name: 'nowhere', refs: ['block/F1'], layout: 'flat' }))).toContain("no layout 'flat'")
  })

  it('refuses when the kernel cannot be asked, or gives no place for a face, so that no member is held at a placeholder', async () => {
    kernel = async () => Promise.reject(new Error('the kernel is busy building'))
    const down = await addSetTool(deps, 'bracket', { name: 'intake', refs: ['block/F1'] })
    expect(down.isError).toBe(true)
    expect(text(down)).toContain('the kernel is busy building')
    expect(text(down)).toContain('nothing was proposed')
    kernel = async ({ refs }) => ({ selectors: refs.map((ref) => ({ ref, selector: null, selectorWhy: 'the part has no face F1' })) as SelectorFound[] })
    const lacking = await addSetTool(deps, 'bracket', { name: 'intake', refs: ['block/F1'] })
    expect(lacking.isError).toBe(true)
    expect(text(lacking)).toContain('block/F1')
    kernel = async () => ({ selectors: [] })
    expect((await addSetTool(deps, 'bracket', { name: 'intake', refs: ['block/F1'] })).isError).toBe(true)
    expect(await sets()).toHaveLength(0)
    // A part and a stroke need no answer of the kernel.
    kernel = async () => Promise.reject(new Error('down'))
    expect((await addSetTool(deps, 'bracket', { name: 'whole', refs: ['block', 'M7/k3'] })).isError).toBeUndefined()
  })

  it('keeps the set when a face is a form the kernel left out: the member has no selector and is found by place', async () => {
    kernel = async ({ refs }) => ({ selectors: refs.map((ref) => ({ ...answer(ref, 1), selector: null, selectorWhy: 'out of time' })) })
    const result = await addSetTool(deps, 'bracket', { name: 'intake', refs: ['block/F1'] })
    expect(result.isError, text(result)).toBeUndefined()
    const [made] = await sets()
    expect(made.members[0]).toMatchObject({ face: 'block/F1', type: 'PLANE', point: [1, 2, 3] })
    expect('selector' in made.members[0]).toBe(false)
  })

  it('is a proposal Claude can use at once: highlight takes #intake before the person accepts it', async () => {
    await addSetTool(deps, 'bracket', { name: 'intake', refs: ['block/F1', 'block/F2'] })
    const result = await highlightTool(deps, 'bracket', { refs: ['#intake'] })
    expect(result.isError, text(result)).toBeUndefined()
    expect(shown).toEqual([{ layout: 'assembly', refs: ['block/F1', 'block/F2'] }])
    expect(text(result)).toContain('[proposed by you, not accepted]')
  })

  it('writes sets.json in the project, as a proposal of the agent\'s', async () => {
    await addSetTool(deps, 'bracket', { name: 'intake', refs: ['block/F1'] })
    const file = JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'sets.json'), 'utf8'))
    expect(file.sets[0]).toMatchObject({ by: 'agent', proposed: true })
  })

  it('takes no key but its own: a slip is refused by name, and no tool accepts, edits or removes a set', () => {
    expect(Object.keys(TOOLS.add_set.inputSchema).sort()).toEqual(['comment', 'layout', 'name', 'refs'])
    expect(refusedKeys('add_set', { name: 'x', refs: ['block'], proposed: false })?.isError).toBe(true)
    expect(text(refusedKeys('add_set', { name: 'x', ref: ['block'] })!)).toContain('did you mean refs?')
    expect(Object.keys(TOOLS).filter((name) => /set/.test(name))).toEqual(['add_set'])
  })

  it('holds a set to the most members a set may have, and says so', async () => {
    const refs = Array.from({ length: MOST_SET_MEMBERS + 1 }, (_, i) => `block/F${i}`)
    const result = await addSetTool(deps, 'bracket', { name: 'huge', refs })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(String(MOST_SET_MEMBERS))
  })

  it('is refused where the sets cannot be kept', async () => {
    const result = await addSetTool({ ...deps, setStore: undefined } as ToolDeps, 'bracket', { name: 'intake', refs: ['block/F1'] })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('named sets')
  })
})
