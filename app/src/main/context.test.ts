import { describe, expect, it } from 'vitest'
import type { BuildState } from '../shared/build'
import type { Part, Scene } from '../shared/scene'
import type { ViewState } from '../shared/view'
import type { ObjectInfo } from '../shared/workspace'
import type { Mark } from '../shared/marks'
import type { InstructionFile } from '../shared/instructions'
import { instructionsLine } from '../shared/instructions'
import type { ScanAlignment, ScanInfo } from '../shared/scans'
import { probe } from '../test/diagnosisFixtures'
import { buildContextFor, CONTEXT_LIMIT, contextFor, modelOutput, tellsInstructions, type ContextDeps } from './context'
import { STARTER_MATERIALS, printerOf } from '../shared/profile'

const BRACKET: ObjectInfo = { id: 'bracket', name: 'bracket', dir: '/ws/bracket', model: 'bracket.py' }

function part(layout: string, name: string): Part {
  return { key: `${layout}:${name}`, name, layout } as Part
}

const SCENE: Scene = {
  model: 'bracket.py',
  layouts: ['assembly', 'print'],
  parts: [part('assembly', 'base'), part('assembly', 'post'), part('print', 'base'), part('print', 'post')],
  seconds: 0.8,
  output: ''
}

const CAMERA = { position: [1, 2, 3], target: [0, 0, 0], up: [0, 0, 1], ortho: false, fov: 35, zoom: 1 } as ViewState['camera']

function deps(over: { build?: BuildState; scene?: Scene; revision?: number; view?: ViewState; now?: number; open?: string | null; name?: string; references?: string[] }): ContextDeps {
  return {
    references: () => over.references ?? [],
    object: (id) => (id === 'bracket' ? { ...BRACKET, name: over.name ?? BRACKET.name } : undefined),
    openObjectId: () => (over.open === undefined ? 'bracket' : over.open),
    build: () => over.build,
    scene: () => (over.scene ? { revision: over.revision ?? over.build?.revision ?? 1, scene: over.scene } : undefined),
    view: () => over.view,
    now: () => over.now ?? 0
  }
}

/** What the agent is told when the object has no marks. */
const textFor = (d: ContextDeps, objectId: string): string => contextFor(d, objectId).text

describe('the references of a new conversation', () => {
  const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 1, seconds: 0.5, stale: false }
  const LINE = "The person's references for this project are in reference/: photo-1.jpg, doodle-1.png. Read them when they matter."
  it('are named in one line, in a fresh conversation only', () => {
    const d = deps({ build: OK, scene: SCENE, references: ['photo-1.jpg', 'doodle-1.png'] })
    const fresh = contextFor(d, 'bracket', [], { fresh: true })
    expect(fresh.text.split('\n')).toContain(LINE)
    expect(fresh.sentMarkIds).toEqual([])
    expect(contextFor(d, 'bracket').text).not.toContain('reference/')
    // The first prompt of a session that was not resumed is in a new conversation too.
    expect(contextFor(d, 'bracket', [], { newConversation: true }).text.split('\n').at(-1)).toBe(LINE)
  })
  it('are not said when there are none', () => {
    expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [], { fresh: true }).text).not.toContain('reference/')
  })
  it('are named twelve at most, and the rest counted', () => {
    const many = Array.from({ length: 14 }, (_, i) => `photo-${i + 1}.jpg`)
    const text = contextFor(deps({ build: OK, scene: SCENE, references: many }), 'bracket', [], { fresh: true }).text
    expect(text).toContain(`reference/: ${many.slice(0, 12).join(', ')} and 2 more. Read them when they matter`)
    expect(text).not.toContain('photo-13.jpg')
  })
})

describe('the notice of a Go back', () => {
  const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 1, seconds: 0.5, stale: false }
  const NOTICE = 'The person went back to build h4: the model files are as they were then, and prompts "make it taller" are undone. You keep what you learnt from them; do not try them again unless asked.'
  it('is the first line of the next prompt\'s context, and the rest of it is as it was', () => {
    const d = deps({ build: OK, scene: SCENE })
    const plain = contextFor(d, 'bracket')
    const told = contextFor(d, 'bracket', [], { notice: NOTICE })
    expect(told.text).toBe(`${NOTICE}\n${plain.text}`)
    expect(told.sentMarkIds).toEqual(plain.sentMarkIds)
    expect(told.revision).toBe(plain.revision)
    expect(contextFor(d, 'bracket').text).not.toContain('went back')
  })
  it('is told even when the context has nothing else, and is not held to the context limit', () => {
    // An object that is not in the workspace has nothing to say, and the notice is still told.
    expect(contextFor(deps({}), 'nowhere', [], { notice: NOTICE }).text).toBe(NOTICE)
    const many = Array.from({ length: 200 }, (_, i) => ({ id: `M${i + 1}`, kind: 'pin', author: 'user', note: 'n'.repeat(60), status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '', checkedRevision: 1, anchor: { point: [0, 0, 0] } }) as Mark)
    const full = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', many, { notice: NOTICE })
    expect(full.text.startsWith(`${NOTICE}\n`)).toBe(true)
    expect(full.text.length - NOTICE.length - 1).toBeLessThanOrEqual(CONTEXT_LIMIT)
  })
})

// #50: the first prompt of a session names the instruction files Claude Code reads, and says what wins for seeing the build.
describe('the instruction files of a session', () => {
  const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 1, seconds: 0.5, stale: false }
  const FILES: InstructionFile[] = [
    { path: '/home/me/objects/CLAUDE.md', shown: '~/objects/CLAUDE.md', kind: 'project', bytes: 7300 },
    { path: '/home/me/.claude/CLAUDE.md', shown: '~/.claude/CLAUDE.md', kind: 'user', bytes: 900 }
  ]
  const LINE = instructionsLine(FILES)!
  const pin = (id: string): Mark => ({ id, kind: 'pin', author: 'user', note: 'n'.repeat(60), status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 1, camera: CAMERA, createdAt: '', checkedRevision: 1, anchor: { point: [0, 0, 0] } }) as Mark

  it('are named in the last line, with their sizes and which wins', () => {
    const d = deps({ build: OK, scene: SCENE })
    const told = contextFor(d, 'bracket', [], { instructions: FILES })
    expect(told.text.split('\n').at(-1)).toBe(LINE)
    expect(LINE).toContain('~/objects/CLAUDE.md (7.1 KB), ~/.claude/CLAUDE.md (900 B)')
    expect(LINE).toContain("What torno's tools say of the build is current")
    expect(told.sentMarkIds).toEqual([])
  })

  it('are told with the first prompt of a session and again after /clear (a fresh conversation), and no other', () => {
    expect(tellsInstructions({ first: true })).toBe(true)
    expect(tellsInstructions({ fresh: true })).toBe(true)
    expect(tellsInstructions({ first: true, fresh: true })).toBe(true)
    expect(tellsInstructions({})).toBe(false)
    expect(tellsInstructions({ first: false, fresh: false })).toBe(false)
  })

  it('are counted as data for the chat\'s line: how many are named', () => {
    const d = deps({ build: OK, scene: SCENE })
    expect(contextFor(d, 'bracket', [], { instructions: FILES })).toMatchObject({ instructions: 2 })
    expect(contextFor(d, 'bracket')).not.toHaveProperty('instructions')
    expect(contextFor(d, 'bracket', [], { instructions: [] })).not.toHaveProperty('instructions')
  })

  it('cannot empty the context with long paths: the line is bounded, and the failed build is still told', () => {
    const deep = `/${'a-very-long-folder-name/'.repeat(40)}`
    const long = Array.from({ length: 6 }, (_, i) => ({ path: `${deep}${i}/CLAUDE.md`, shown: `${deep}${i}/CLAUDE.md`, kind: 'project', bytes: 1 }) as InstructionFile)
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 1, stale: true, error: { kind: 'exception', message: 'boom', traceback: 'x'.repeat(5000) } }
    const told = contextFor(deps({ build: failed, scene: SCENE }), 'bracket', [], { instructions: long })
    expect(told.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(told.text).toContain('BUILD FAILED')
    expect(told.text.split('\n').at(-1)).toBe(instructionsLine(long))
  })

  it('are not said unless asked for: later prompts, and a session with none', () => {
    const d = deps({ build: OK, scene: SCENE })
    expect(contextFor(d, 'bracket').text).not.toContain('instruction files')
    expect(contextFor(d, 'bracket', [], { instructions: [] }).text).not.toContain('instruction files')
    // Nor with the answer to an edit.
    expect(buildContextFor(d, 'bracket', [], {}).text).not.toContain('instruction files')
  })

  it('are said also when the build failed or nothing is built: the prompt is the first of the session all the same', () => {
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 1, stale: true, error: { kind: 'exception', message: 'boom' } }
    expect(contextFor(deps({ build: failed, scene: SCENE }), 'bracket', [], { instructions: FILES }).text.split('\n').at(-1)).toBe(LINE)
    expect(contextFor(deps({}), 'bracket', [], { instructions: FILES }).text.split('\n').at(-1)).toBe(LINE)
  })

  it('keep their room against the traceback of a failed build', () => {
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 1, stale: true, error: { kind: 'exception', message: 'boom', traceback: Array.from({ length: 200 }, (_, i) => `  File "x.py", line ${i}, in f${i}: ${'y'.repeat(60)}`).join('\n') } }
    const told = contextFor(deps({ build: failed, scene: SCENE }), 'bracket', [], { instructions: FILES })
    expect(told.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(told.text.split('\n').at(-1)).toBe(LINE)
    expect(told.text).toContain('BUILD FAILED')
  })

  it('keep their room against the selection and the scans, all at their limits', () => {
    const deep = `/${'a-very-long-folder-name/'.repeat(40)}`
    const long = Array.from({ length: 6 }, (_, i) => ({ path: `${deep}${i}/CLAUDE.md`, shown: `${deep}${i}/CLAUDE.md`, kind: 'project', bytes: 1 }) as InstructionFile)
    const LONG = instructionsLine(long)!
    const scans = Array.from({ length: 12 }, (_, i) => ({ id: `S${i + 1}`, name: `${'scan-of-the-loom-'.repeat(6)}${i}.glb`, alignments: {}, checks: {} }) as unknown as ScanInfo)
    // A failed build whose traceback would fill what the status may have, and the scans.
    const traceback = Array.from({ length: 200 }, (_, i) => `  File "x.py", line ${i}, in f${i}: ${'y'.repeat(60)}`).join('\n')
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 1, stale: true, error: { kind: 'exception', message: 'boom', traceback } }
    const broken = contextFor(deps({ build: failed, scene: SCENE }), 'bracket', [], { scans, instructions: long })
    expect(broken.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(broken.text).toContain('BUILD FAILED')
    expect(broken.text).toContain('Scans: S1')
    expect(broken.text.split('\n').at(-1)).toBe(LONG)
    // A build that worked, of so many parts that the status would fill its room, with the selection too.
    const parts = Array.from({ length: 120 }, (_, i) => part('assembly', `${'p'.repeat(40)}${i}`))
    const many: Scene = { ...SCENE, layouts: ['assembly'], parts }
    const refs = Array.from({ length: 8 }, (_, i) => ({ ref: `${parts[i].name}/F${i}`, descriptor: 'd'.repeat(300) }))
    const view: ViewState = { objectId: 'bracket', layout: 'assembly', camera: CAMERA, visible: parts.map((p) => p.key), selection: { revision: 1, total: 20, refs } }
    const ok = contextFor(deps({ build: OK, scene: many, view }), 'bracket', [], { scans, instructions: long })
    expect(ok.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(ok.text).toMatch(/\nSelected: .* and 12 more\n/)
    expect(ok.text).toContain('Scans: S1')
    expect(ok.text.split('\n').at(-1)).toBe(LONG)
  })

  it('come after the references of a new conversation, and keep their room against the marks', () => {
    const d = deps({ build: OK, scene: SCENE, references: ['photo-1.jpg'] })
    const lines = contextFor(d, 'bracket', [], { newConversation: true, instructions: FILES }).text.split('\n')
    expect(lines.at(-2)).toContain('reference/: photo-1.jpg')
    expect(lines.at(-1)).toBe(LINE)
    // Drafts that would fill the context to its limit leave the line its room.
    const many = Array.from({ length: 200 }, (_, i) => pin(`M${i + 1}`))
    const full = contextFor(d, 'bracket', many, { newConversation: true, instructions: FILES })
    expect(full.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(full.text.split('\n').at(-1)).toBe(LINE)
    expect(full.sentMarkIds.length).toBeGreaterThan(0)
  })
})

describe('contextFor', () => {
  it('names the revision, the layout shown and its parts after a build that worked', () => {
    const build: BuildState = { objectId: 'bracket', status: 'ok', revision: 12, seconds: 0.8, stale: false }
    expect(textFor(deps({ build, scene: SCENE }), 'bracket')).toBe(
      '[torno] bracket · build ok · r12 (0.8 s) · layout assembly · parts: base, post.'
    )
  })

  it('hands the chat the build and the selection the text names, as data', () => {
    const ok: BuildState = { objectId: 'bracket', status: 'ok', revision: 3, seconds: 0.8, stale: false }
    const view = { camera: CAMERA, layout: 'assembly', visible: ['assembly:base'], selection: { revision: 3, total: 2, refs: [{ ref: 'base/F5', descriptor: 'plane' }, { ref: 'post' }] } } as ViewState
    expect(contextFor(deps({ build: ok, scene: SCENE, view }), 'bracket')).toMatchObject({ revision: 3, buildState: 'ok', selection: ['base/F5', 'post'] })
    const plain = contextFor(deps({ build: ok, scene: SCENE }), 'bracket')
    expect(plain).toMatchObject({ revision: 3, buildState: 'ok' })
    expect(plain).not.toHaveProperty('selection')
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 2, stale: true, error: { kind: 'exception', message: 'no' } }
    expect(contextFor(deps({ build: failed, scene: SCENE }), 'bracket')).toMatchObject({ revision: 2, buildState: 'failed' })
    // Nothing built: no revision to name; no text: no facts.
    const first: BuildState = { objectId: 'bracket', status: 'building', revision: 0, startedAt: 0, stale: false }
    expect(contextFor(deps({ build: first }), 'bracket')).toMatchObject({ buildState: 'building' })
    expect(contextFor(deps({ build: first }), 'bracket')).not.toHaveProperty('revision')
    expect(contextFor(deps({ build: ok }), 'nothing')).toEqual({ text: '', sentMarkIds: [] })
  })

  it('uses the layout on screen, and says which of its parts are hidden', () => {
    const build: BuildState = { objectId: 'bracket', status: 'ok', revision: 3, seconds: 12.34, stale: false }
    const view: ViewState = { objectId: 'bracket', layout: 'print', camera: CAMERA, visible: ['print:base'] }
    expect(textFor(deps({ build, scene: SCENE, view }), 'bracket')).toBe(
      '[torno] bracket · build ok · r3 (12.3 s) · layout print · parts: base, post (hidden: post).'
    )
  })

  it('says that the layout on screen is drawn apart, and that this is for display only', () => {
    const build: BuildState = { objectId: 'bracket', status: 'ok', revision: 3, seconds: 0.8, stale: false }
    const view: ViewState = { objectId: 'bracket', layout: 'assembly', camera: CAMERA, visible: ['assembly:base', 'assembly:post'], explode: { amount: 0.4, scale: 1, axis: 'z' } }
    expect(textFor(deps({ build, scene: SCENE, view }), 'bracket')).toBe('[torno] bracket · build ok · r3 (0.8 s) · layout assembly, exploded 40 % along z (display only) · parts: base, post.')
    // Drawn together, nothing is said of it; nor of a layout the build no longer has, whose explode is of no layout named.
    expect(textFor(deps({ build, scene: SCENE, view: { ...view, explode: { amount: 0, scale: 2, axis: 'z' } } }), 'bracket')).toBe('[torno] bracket · build ok · r3 (0.8 s) · layout assembly · parts: base, post.')
    expect(textFor(deps({ build, scene: SCENE, view: { ...view, layout: 'gone' } }), 'bracket')).toBe('[torno] bracket · build ok · r3 (0.8 s) · layout assembly · parts: base, post.')
  })

  it('says that the layout on screen is drawn apart or cut also while a build runs or has failed: what is seen is still drawn so', () => {
    const view: ViewState = { objectId: 'bracket', layout: 'assembly', camera: CAMERA, visible: ['assembly:base', 'assembly:post'], explode: { amount: 0.4, scale: 1, axis: 'z' } }
    const building: BuildState = { objectId: 'bracket', status: 'building', revision: 11, startedAt: 10_000, stale: true }
    expect(textFor(deps({ build: building, scene: SCENE, view, now: 14_200 }), 'bracket')).toBe('[torno] bracket · building (4 s so far) · showing r11, exploded 40 % along z (display only).')
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 11, stale: true, error: { kind: 'exception', message: 'boom' } }
    expect(textFor(deps({ build: failed, scene: SCENE, view }), 'bracket')).toBe('[torno] bracket · BUILD FAILED · showing r11 (stale), exploded 40 % along z (display only).\nboom')
    // The person's own section, in all three: it is what they see, and what a look with no arguments draws.
    const cut: ViewState = { objectId: 'bracket', layout: 'assembly', camera: CAMERA, visible: ['assembly:base', 'assembly:post'], section: { origin: [12, 0, 0], normal: [1, 0, 0] } }
    const ok: BuildState = { objectId: 'bracket', status: 'ok', revision: 3, seconds: 0.8, stale: false }
    expect(textFor(deps({ build: ok, scene: SCENE, view: cut }), 'bracket')).toBe('[torno] bracket · build ok · r3 (0.8 s) · layout assembly, cut by the plane normal +X at x = 12 (display only) · parts: base, post.')
    expect(textFor(deps({ build: building, scene: SCENE, view: cut, now: 14_200 }), 'bracket')).toBe('[torno] bracket · building (4 s so far) · showing r11, cut by the plane normal +X at x = 12 (display only).')
    expect(textFor(deps({ build: failed, scene: SCENE, view: cut }), 'bracket')).toBe('[torno] bracket · BUILD FAILED · showing r11 (stale), cut by the plane normal +X at x = 12 (display only).\nboom')
    // Not of an object the window does not show, nor of a layout the build no longer has.
    expect(textFor(deps({ build: building, scene: SCENE, view, now: 14_200, open: 'other' }), 'bracket')).toBe('[torno] bracket · not open in the torno window · building (4 s so far) · last built r11.')
    expect(textFor(deps({ build: building, scene: SCENE, view: { ...view, layout: 'gone' }, now: 14_200 }), 'bracket')).toBe('[torno] bracket · building (4 s so far) · showing r11.')
  })

  it('says of a build too quick to time that it took under 0.1 s, never 0.0 s', () => {
    const build: BuildState = { objectId: 'bracket', status: 'ok', revision: 1, seconds: 0.04, stale: false }
    expect(textFor(deps({ build, scene: SCENE }), 'bracket')).toBe('[torno] bracket · build ok · r1 (under 0.1 s) · layout assembly · parts: base, post.')
    expect(textFor(deps({ build: { ...build, seconds: 0.05 }, scene: SCENE }), 'bracket')).toBe('[torno] bracket · build ok · r1 (0.1 s) · layout assembly · parts: base, post.')
    expect(textFor(deps({ build: { ...build, seconds: 0 }, scene: SCENE }), 'bracket')).toBe('[torno] bracket · build ok · r1 (under 0.1 s) · layout assembly · parts: base, post.')
  })

  it('says how long a build has been running and what is on screen meanwhile', () => {
    const build: BuildState = { objectId: 'bracket', status: 'building', revision: 11, startedAt: 10_000, stale: true }
    expect(textFor(deps({ build, scene: SCENE, now: 14_200 }), 'bracket')).toBe('[torno] bracket · building (4 s so far) · showing r11.')
  })

  it('says so when a first build is still running', () => {
    const build: BuildState = { objectId: 'bracket', status: 'building', revision: 0, startedAt: 10_000, stale: false }
    expect(textFor(deps({ build, now: 10_400 }), 'bracket')).toBe('[torno] bracket · building (0 s so far) · nothing built yet.')
  })

  it('gives the error and the end of the traceback when the build failed', () => {
    const traceback = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const build: BuildState = {
      objectId: 'bracket',
      status: 'failed',
      revision: 11,
      seconds: 0.2,
      stale: true,
      error: { kind: 'exception', message: "NameError: name 'Boxx' is not defined", traceback: `${traceback}\n` }
    }
    const text = textFor(deps({ build, scene: SCENE }), 'bracket')
    const lines = text.split('\n')
    expect(lines[0]).toBe('[torno] bracket · BUILD FAILED · showing r11 (stale).')
    expect(lines[1]).toBe("NameError: name 'Boxx' is not defined")
    expect(lines.slice(2)).toEqual(Array.from({ length: 12 }, (_, i) => `line ${i + 9}`))
  })

  it('says nothing is on screen when the first build failed', () => {
    const build: BuildState = { objectId: 'bracket', status: 'failed', revision: 0, stale: false, error: { kind: 'no_model', message: 'no model file in /ws/bracket' } }
    expect(textFor(deps({ build }), 'bracket')).toBe('[torno] bracket · BUILD FAILED · nothing built yet.\nno model file in /ws/bracket')
  })

  it('cuts a long failure to the limit, keeping the last lines of the traceback', () => {
    const traceback = Array.from({ length: 12 }, (_, i) => `frame ${i + 1} ${'x'.repeat(900)}`).join('\n')
    const build: BuildState = {
      objectId: 'bracket',
      status: 'failed',
      revision: 2,
      stale: true,
      error: { kind: 'exception', message: `ValueError: ${'m'.repeat(900)}`, traceback: `${traceback}\nValueError: the last line` }
    }
    const text = textFor(deps({ build, scene: SCENE }), 'bracket')
    expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(CONTEXT_LIMIT).toBe(6000)
    expect(text.startsWith('[torno] bracket · BUILD FAILED · showing r2 (stale).\nValueError: mmm')).toBe(true)
    expect(text.endsWith('\nValueError: the last line')).toBe(true)
    expect(text).toContain('…')
  })

  it('cuts a long list of parts to the limit', () => {
    const parts = Array.from({ length: 1000 }, (_, i) => part('main', `part_number_${i}`))
    const build: BuildState = { objectId: 'bracket', status: 'ok', revision: 1, seconds: 2, stale: false }
    const text = textFor(deps({ build, scene: { ...SCENE, layouts: ['main'], parts } }), 'bracket')
    expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(text).toMatch(/part_number_0, .* and \d+ more\.$/)
  })

  it('leaves the duration out when it is not known when the build started', () => {
    const build: BuildState = { objectId: 'bracket', status: 'building', revision: 11, stale: true }
    expect(textFor(deps({ build, scene: SCENE, now: 1_760_000_000_000 }), 'bracket')).toBe('[torno] bracket · building · showing r11.')
  })

  describe('for an object that is not the one open in the window', () => {
    it('says so, and names its parts without a layout: none is on screen', () => {
      const build: BuildState = { objectId: 'bracket', status: 'ok', revision: 12, seconds: 0.8, stale: false }
      for (const open of ['gear', null]) {
        expect(textFor(deps({ build, scene: SCENE, open }), 'bracket')).toBe(
          '[torno] bracket · not open in the torno window · build ok · r12 (0.8 s) · parts: base, post.'
        )
      }
    })

    it('does not say that its parts are showing', () => {
      const building: BuildState = { objectId: 'bracket', status: 'building', revision: 11, startedAt: 10_000, stale: true }
      expect(textFor(deps({ build: building, now: 14_200, open: 'gear' }), 'bracket')).toBe(
        '[torno] bracket · not open in the torno window · building (4 s so far) · last built r11.'
      )
      const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 11, stale: true, error: { kind: 'exception', message: 'no' } }
      expect(textFor(deps({ build: failed, open: 'gear' }), 'bracket')).toBe('[torno] bracket · not open in the torno window · BUILD FAILED · last built r11.\nno')
      expect(textFor(deps({ open: 'gear' }), 'bracket')).toBe('[torno] bracket · not open in the torno window · not built yet.')
    })
  })

  it('never exceeds the limit, whatever the object is called', () => {
    const name = 'n'.repeat(7000)
    const traceback = Array.from({ length: 12 }, (_, i) => `frame ${i + 1} ${'x'.repeat(300)}`).join('\n')
    const states: BuildState[] = [
      { objectId: 'bracket', status: 'idle', revision: 0, stale: false },
      { objectId: 'bracket', status: 'building', revision: 1, startedAt: 0, stale: true },
      { objectId: 'bracket', status: 'failed', revision: 1, stale: true, error: { kind: 'exception', message: 'm'.repeat(900), traceback } },
      { objectId: 'bracket', status: 'failed', revision: 1, stale: true, error: { kind: 'exception', message: 'no' } },
      { objectId: 'bracket', status: 'ok', revision: 1, seconds: 1, stale: false }
    ]
    for (const build of states) {
      for (const scene of [SCENE, undefined]) {
        const text = textFor(deps({ build, scene, name }), 'bracket')
        expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
        expect(text.startsWith('[torno] nnn')).toBe(true)
        expect(text.endsWith('…')).toBe(true)
      }
    }
  })

  it('says an object has not been built, and nothing about one it does not know', () => {
    expect(textFor(deps({}), 'bracket')).toBe('[torno] bracket · not built yet.')
    expect(textFor(deps({ build: { objectId: 'bracket', status: 'idle', revision: 0, stale: false } }), 'bracket')).toBe('[torno] bracket · not built yet.')
    expect(textFor(deps({}), 'nothing')).toBe('')
  })

  describe('with marks', () => {
    const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 3, seconds: 0.8, stale: false }
    const STATUS = '[torno] bracket · build ok · r3 (0.8 s) · layout assembly · parts: base, post.'
    const HEAD = 'Marks from the user (drawn in look pictures with these numbers):'
    const DIMS = 'Dimensions (measured on r3):'
    const pin = (n: number, over: Partial<Mark> = {}): Mark =>
      ({
        id: `M${n}`,
        kind: 'pin',
        author: 'user',
        note: `note ${n}`,
        status: 'draft',
        anchorState: 'ok',
        layout: 'assembly',
        revision: 3,
        camera: CAMERA,
        createdAt: '2026-10-09T12:00:00.000Z',
        checkedRevision: 3,
        anchor: { point: [n, 0, 5], part: 'base', ref: 'base/F1', descriptor: 'plane, normal +Z, z = 5, 1200 mm²' },
        ...over
      }) as Mark
    const line = (n: number): string => `M${n} pin on base/F1 (plane, normal +Z, z = 5, 1200 mm²) at (${n}, 0, 5): "note ${n}"`

    it('lists every draft after the build line, oldest first, and says which they are', () => {
      const marks = [pin(1), pin(2, { anchorState: 'drifted' }), pin(3)]
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text).toBe([STATUS, HEAD, line(1), 'M2 pin placed on base/F1 at (2, 0, 5): "note 2" [moved since it was placed: check it]', line(3)].join('\n'))
      expect(context.sentMarkIds).toEqual(['M1', 'M2', 'M3'])
    })

    it('says of a draft the agent was sent before that it has changed', () => {
      const marks = [pin(1, { sentBefore: true }), pin(2)]
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text).toBe([STATUS, HEAD, `(changed) ${line(1)}`, line(2)].join('\n'))
      expect(context.sentMarkIds).toEqual(['M1', 'M2'])
    })

    it('sums up the marks already sent in one line, and lists none of them again', () => {
      const marks = [pin(1, { status: 'sent' }), pin(2, { status: 'resolved' }), pin(3), pin(4, { status: 'sent' })]
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text).toBe([STATUS, HEAD, line(3), 'Open marks: M1, M4'].join('\n'))
      expect(context.sentMarkIds).toEqual(['M3'])

      // The same marks once M3 was delivered: nothing is listed, nothing is to be sent.
      const again = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks.map((m) => (m.id === 'M3' ? { ...m, status: 'sent' } : m)))
      expect(again.text).toBe([STATUS, 'Open marks: M1, M3, M4'].join('\n'))
      expect(again.sentMarkIds).toEqual([])
    })

    it("does not tell the agent of its own marks as news: they are among the open ones", () => {
      const marks = [pin(1, { author: 'agent', status: 'sent' }), pin(2, { author: 'agent', status: 'sent' })]
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text).toBe([STATUS, 'Open marks: M1, M2'].join('\n'))
      expect(context.sentMarkIds).toEqual([])
    })

    it('says of each open mark that moved, lost its part or was not checked, and then where to get their data', () => {
      const marks = [
        pin(1, { status: 'sent', anchorState: 'drifted' }),
        pin(2, { status: 'sent' }),
        pin(4, { status: 'sent', anchorState: 'orphaned' }),
        pin(6, { status: 'sent', checkedRevision: 2 }),
        pin(7, { status: 'sent', anchorState: 'drifted', checkedRevision: 2 })
      ]
      expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks).text).toBe(
        [STATUS, 'Open marks: M1 (moved), M2, M4 (part gone), M6 (unchecked), M7 (moved); call mcp__torno__marks for their data'].join('\n')
      )
      // Nothing to get when nothing is flagged.
      expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [marks[1]]).text).toBe([STATUS, 'Open marks: M2'].join('\n'))
    })

    it('names the tool as the agent\'s client does: for one that is not Claude Code, in words, and within the same limit', () => {
      const toolName = (tool: string): string => `the torno tool ${tool}`
      const flagged = [pin(1, { status: 'sent', anchorState: 'drifted' })]
      expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', flagged, { toolName }).text).toBe([STATUS, 'Open marks: M1 (moved); call the torno tool marks for their data'].join('\n'))
      const many = Array.from({ length: 200 }, (_, i) => pin(i + 1, { note: `note ${i + 1} ${'n'.repeat(60)}` }))
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', many, { toolName })
      expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      expect(context.text.split('\n').at(-1)).toBe(`… and ${200 - context.sentMarkIds.length} more: call the torno tool marks`)
      expect(context.text).not.toContain('mcp__torno__')
    })

    it('still says where to get their data when the flagged marks do not all fit', () => {
      const marks = Array.from({ length: 200 }, (_, i) => pin(i + 1, { status: 'sent', anchorState: 'drifted' }))
      const last = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks).text.split('\n').at(-1)!
      expect(last).toMatch(/^Open marks: M1 \(moved\), M2 \(moved\), .* and \d+ more; call mcp__torno__marks for their data$/)
      expect(last.length).toBeLessThanOrEqual('Open marks: '.length + 300)
    })

    it('says in a draft line that the mark was not checked against the build named above', () => {
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [pin(1, { checkedRevision: 2 })])
      expect(context.text).toBe([STATUS, HEAD, `${line(1)} [not checked against r3]`].join('\n'))
    })

    it('says of a mark of the user\'s that they reopened that they did, rather than that it changed: a resolution was not accepted', () => {
      const marks = [pin(1, { sentBefore: true, reopened: true }), pin(2, { reopened: true })]
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text).toBe([STATUS, HEAD, `(reopened by the user) ${line(1)}`, `(reopened by the user) ${line(2)}`].join('\n'))
      // Also in a conversation that never had it: the mark was resolved once, and that did not do.
      expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks, { fresh: true }).text).toBe(context.text)
    })

    it("lists a mark of the agent's that the user reopened, once, as its own and reopened", () => {
      const marks = [pin(1, { author: 'agent', status: 'draft' }), pin(2, { author: 'agent', status: 'sent' })]
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text).toBe([STATUS, HEAD, `(yours, reopened by the user) ${line(1)}`, 'Open marks: M2'].join('\n'))
      // Sent with the prompt, like a draft of the user's: then it is one of the open marks.
      expect(context.sentMarkIds).toEqual(['M1'])
    })

    describe('in a conversation that has not seen them', () => {
      const STILL = 'Marks still open (this conversation has not seen them):'

      it("lists every open mark of the user's once more, after the drafts, and sends only the drafts", () => {
        const marks = [pin(1, { status: 'sent', sentBefore: true }), pin(2, { status: 'resolved' }), pin(3, { sentBefore: true }), pin(4, { author: 'agent', status: 'sent' }), pin(5, { status: 'sent', anchorState: 'drifted' })]
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks, { fresh: true })
        expect(context.text).toBe(
          [
            STATUS,
            HEAD,
            // Not "(changed)": this conversation never had it.
            line(3),
            STILL,
            line(1),
            'M5 pin placed on base/F1 at (5, 0, 5): "note 5" [moved since it was placed: check it]',
            'Open marks: M1, M4, M5 (moved); call mcp__torno__marks for their data'
          ].join('\n')
        )
        expect(context.sentMarkIds).toEqual(['M3'])
      })

      it('says nothing more than usual when there is none', () => {
        const marks = [pin(1), pin(4, { author: 'agent', status: 'sent' })]
        expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks, { fresh: true }).text).toBe([STATUS, HEAD, line(1), 'Open marks: M4'].join('\n'))
      })

      it('keeps to the limit: those that do not fit are counted', () => {
        const marks = Array.from({ length: 200 }, (_, i) => pin(i + 1, { status: 'sent', note: `note ${i + 1} ${'n'.repeat(60)}` }))
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks, { fresh: true })
        expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
        const lines = context.text.split('\n')
        expect(lines[1]).toBe(STILL)
        expect(lines.at(-2)).toMatch(/^… and \d+ more: call mcp__torno__marks$/)
        expect(lines.length).toBeGreaterThan(30)
        expect(context.sentMarkIds).toEqual([])
      })

      it('keeps to the limit when the drafts have left no room for the marks listed again: nothing is said of those but their numbers', () => {
        const drafts = Array.from({ length: 40 }, (_, i) => pin(i + 1, { note: 'n'.repeat(359) }))
        const sent = Array.from({ length: 30 }, (_, i) => pin(i + 41, { status: 'sent', sentBefore: true }))
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [...drafts, ...sent], { fresh: true })
        expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
        const lines = context.text.split('\n')
        // The drafts that fit, and how many did not; then no head with nothing under it.
        expect(lines).not.toContain(STILL)
        expect(lines.at(-2)).toBe(`… and ${40 - context.sentMarkIds.length} more: call mcp__torno__marks`)
        expect(lines.at(-1)).toMatch(/^Open marks: M41, M42, /)
        expect(context.sentMarkIds.length).toBeGreaterThan(5)
        // Every mark said to be sent has its whole line.
        for (const id of context.sentMarkIds) expect(lines.some((l) => l.startsWith(`${id} pin on `) && l.endsWith('"'))).toBe(true)
      })

      it('lists as many of them as there is room for after the drafts, and counts the rest', () => {
        const drafts = Array.from({ length: 12 }, (_, i) => pin(i + 1, { note: 'n'.repeat(359) }))
        const sent = Array.from({ length: 30 }, (_, i) => pin(i + 41, { status: 'sent', sentBefore: true }))
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [...drafts, ...sent], { fresh: true })
        expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
        const lines = context.text.split('\n')
        const at = lines.indexOf(STILL)
        expect(context.sentMarkIds).toHaveLength(12)
        expect(at).toBe(2 + 12)
        const again = lines.slice(at + 1, -2)
        expect(again.length).toBeGreaterThan(0)
        expect(lines.at(-2)).toBe(`… and ${30 - again.length} more: call mcp__torno__marks`)
      })
    })

    describe('with a selection', () => {
      const selected = (over: Partial<ViewState> = {}): ViewState => ({
        objectId: 'bracket',
        layout: 'assembly',
        camera: CAMERA,
        visible: ['assembly:base', 'assembly:post'],
        selection: { revision: 3, total: 3, refs: [{ ref: 'base/F5', descriptor: 'plane, normal +Z, z = 2.5, 1200 mm²' }, { ref: 'base/E5', descriptor: 'line, 30 mm' }, { ref: 'post' }] },
        ...over
      })
      const SELECTED = 'Selected: base/F5 (plane, normal +Z, z = 2.5, 1200 mm²), base/E5 (line, 30 mm), post'

      it('says what the user has selected, after the build line and before the marks', () => {
        expect(contextFor(deps({ build: OK, scene: SCENE, view: selected() }), 'bracket', [pin(1)]).text).toBe([STATUS, SELECTED, HEAD, line(1)].join('\n'))
        expect(textFor(deps({ build: OK, scene: SCENE, view: selected() }), 'bracket')).toBe([STATUS, SELECTED].join('\n'))
      })

      it('says nothing of it when the refs may not name what was selected: another build, a stale one, another layout, another object', () => {
        const none = (d: ContextDeps): void => expect(textFor(d, 'bracket')).not.toContain('Selected')
        none(deps({ build: OK, scene: SCENE, view: selected({ selection: { revision: 2, total: 1, refs: [{ ref: 'base/F5' }] } }) }))
        none(deps({ build: { ...OK, stale: true }, scene: SCENE, view: selected() }))
        none(deps({ build: { objectId: 'bracket', status: 'building', revision: 3, startedAt: 0, stale: true }, scene: SCENE, view: selected() }))
        none(deps({ build: { objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'no' } }, scene: SCENE, view: selected() }))
        none(deps({ build: OK, scene: SCENE, view: selected(), open: 'gear' }))
        none(deps({ build: OK, scene: SCENE, view: selected({ layout: 'exploded' }) }))
        none(deps({ build: OK, scene: SCENE, view: selected({ selection: { revision: 3, total: 0, refs: [] } }) }))
      })

      it('names at most eight, and stays within the limit with the marks', () => {
        const refs = Array.from({ length: 12 }, (_, i) => ({ ref: `base/F${i}`, descriptor: 'd'.repeat(300) }))
        const marks = Array.from({ length: 200 }, (_, i) => pin(i + 1, { note: `note ${i + 1} ${'n'.repeat(60)}` }))
        const context = contextFor(deps({ build: OK, scene: SCENE, view: selected({ selection: { revision: 3, total: 12, refs } }) }), 'bracket', marks)
        expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
        const selectedLine = context.text.split('\n')[1]
        expect(selectedLine.match(/base\/F\d+/g)).toHaveLength(8)
        expect(selectedLine).toMatch(/ and 4 more$/)
      })

      it('says how many more are selected than it was given the refs of', () => {
        // The window reports eight refs at most, and how many are selected in all.
        const refs = Array.from({ length: 8 }, (_, i) => ({ ref: `base/F${i}` }))
        const view = selected({ selection: { revision: 3, total: 23, refs } })
        expect(textFor(deps({ build: OK, scene: SCENE, view }), 'bracket').split('\n')[1]).toBe(`Selected: ${refs.map((r) => r.ref).join(', ')} and 15 more`)
        // The count is still said when what is said of the refs has to be cut.
        const long = Array.from({ length: 8 }, (_, i) => ({ ref: `${'p'.repeat(190)}/F${i}`, descriptor: 'd'.repeat(300) }))
        const cut = textFor(deps({ build: OK, scene: SCENE, view: selected({ selection: { revision: 3, total: 23, refs: long } }) }), 'bracket').split('\n')[1]
        expect(cut.length).toBeLessThanOrEqual(1000)
        expect(cut).toMatch(/… and 15 more$/)
      })
    })

    it('says nothing of marks when all are resolved', () => {
      expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [pin(1, { status: 'resolved' })])).toEqual({ text: STATUS, sentMarkIds: [], revision: 3, buildState: 'ok' })
    })

    it('lists the oldest drafts that fit, counts the rest and says how to get them: the limit holds for 200 marks', () => {
      const marks = Array.from({ length: 200 }, (_, i) => pin(i + 1, { note: `note ${i + 1} ${'n'.repeat(60)}` }))
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      const lines = context.text.split('\n')
      const listed = lines.slice(2, -1)
      expect(lines.slice(0, 2)).toEqual([STATUS, HEAD])
      // Not a few: what fits is used.
      expect(listed.length).toBeGreaterThan(30)
      expect(CONTEXT_LIMIT - context.text.length).toBeLessThan(200)
      expect(listed.map((l) => l.split(' ')[0])).toEqual(marks.slice(0, listed.length).map((m) => m.id))
      expect(lines.at(-1)).toBe(`… and ${200 - listed.length} more: call mcp__torno__marks`)
      // Only what the agent was given becomes sent; the rest wait for the next prompt.
      expect(context.sentMarkIds).toEqual(marks.slice(0, listed.length).map((m) => m.id))
    })

    it('holds the limit with 200 marks open and a build that failed at length', () => {
      const traceback = Array.from({ length: 12 }, (_, i) => `frame ${i + 1} ${'x'.repeat(900)}`).join('\n')
      const build: BuildState = { objectId: 'bracket', status: 'failed', revision: 2, stale: true, error: { kind: 'exception', message: 'm'.repeat(900), traceback } }
      // Checked against r2, the build still on show.
      const marks = [...Array.from({ length: 200 }, (_, i) => pin(i + 1, { status: 'sent', checkedRevision: 2 })), pin(201, { note: 'n'.repeat(2000), checkedRevision: 2 }), pin(202, { checkedRevision: 2 })]
      const context = contextFor(deps({ build, scene: SCENE }), 'bracket', marks)
      expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      // The build keeps a third of the room; the marks are told all the same.
      expect(context.text.startsWith('[torno] bracket · BUILD FAILED · showing r2 (stale).\n')).toBe(true)
      expect(context.sentMarkIds).toEqual(['M201', 'M202'])
      expect(context.text.split('\n').at(-1)).toMatch(/^Open marks: M1, M2, .* and \d+ more$/)
    })

    it('lists none of the drafts when even the first does not fit, and sends none', () => {
      const long = pin(1, { anchor: { point: [0, 0, 0], ref: 'base/F1', descriptor: 'd'.repeat(7000) } } as Partial<Mark>)
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [long, pin(2)])
      expect(context.text).toBe([STATUS, HEAD, '… and 2 more: call mcp__torno__marks'].join('\n'))
      expect(context.sentMarkIds).toEqual([])
    })

    it('says which layout a draft is in when it is not the one the first line names: its coordinates are in that frame', () => {
      const marks = [pin(1), pin(2, { layout: 'print' }), pin(3, { layout: 'print', anchorState: 'drifted' })]
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text).toBe(
        [STATUS, HEAD, line(1), `${line(2)} [in layout print]`, 'M3 pin placed on base/F1 at (3, 0, 5): "note 3" [moved since it was placed: check it] [in layout print]'].join('\n')
      )
      // With print on screen it is the marks of the assembly that say so.
      const view: ViewState = { objectId: 'bracket', layout: 'print', camera: CAMERA, visible: ['print:base', 'print:post'] }
      const onPrint = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', marks).text.split('\n')
      expect(onPrint.slice(2)).toEqual([`${line(1)} [in layout assembly]`, line(2), 'M3 pin placed on base/F1 at (3, 0, 5): "note 3" [moved since it was placed: check it]'])
    })

    it('says the layout of every draft when the first line names none', () => {
      const marks = [pin(1), pin(2, { layout: 'print' })]
      const both = [`${line(1)} [in layout assembly]`, `${line(2)} [in layout print]`]
      // Not open in the window, building, failed: no layout is named.
      expect(contextFor(deps({ build: OK, scene: SCENE, open: 'gear' }), 'bracket', marks).text.split('\n').slice(2)).toEqual(both)
      const building: BuildState = { objectId: 'bracket', status: 'building', revision: 3, startedAt: 0, stale: true }
      expect(contextFor(deps({ build: building, scene: SCENE }), 'bracket', marks).text.split('\n').slice(2)).toEqual(both)
      const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'no' } }
      expect(contextFor(deps({ build: failed, scene: SCENE }), 'bracket', marks).text.split('\n').slice(3)).toEqual(both)
      // An object with one layout, open in the window, has no other frame a mark could be in.
      const one = { ...SCENE, layouts: ['assembly'], parts: SCENE.parts.slice(0, 2) }
      expect(contextFor(deps({ build: building, scene: one }), 'bracket', [pin(1)]).text.split('\n').slice(2)).toEqual([line(1)])
      expect(contextFor(deps({ build: building, scene: one, open: 'gear' }), 'bracket', [pin(1)]).text.split('\n').slice(2)).toEqual([`${line(1)} [in layout assembly]`])
    })

    it('counts the layout in what fits', () => {
      const marks = Array.from({ length: 200 }, (_, i) => pin(i + 1, { layout: 'print', note: `note ${i + 1} ${'n'.repeat(60)}` }))
      const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
      expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      expect(CONTEXT_LIMIT - context.text.length).toBeLessThan(200)
      const listed = context.text.split('\n').slice(2, -1)
      expect(listed.every((l) => l.endsWith(' [in layout print]'))).toBe(true)
      expect(context.sentMarkIds).toHaveLength(listed.length)
    })

    describe('the dimensions the agent has been given', () => {
      // Pinned: sent, not resolved. Measured on r3, the build there is.
      const dim = (n: number, over: object = {}): Mark =>
        ({
          ...pin(n, { status: 'sent', sentBefore: true, note: '' }),
          kind: 'dimension',
          measure: 'diameter',
          a: { point: [n, 0, 5], part: 'base', ref: 'base/F9' },
          value: 8,
          how: 'cylinder',
          measuredRevision: 3,
          ...over
        }) as Mark
      const failing = (n: number, over: object = {}): Mark => dim(n, { expected: 8.5, verdict: 'fail', ...over })
      const passing = (n: number, over: object = {}): Mark => dim(n, { expected: 8, verdict: 'pass', ...over })
      const FAIL = (n: number): string => `M${n} diameter 8 mm, base/F9 (expected 8.5 ± 0.05: FAIL, 0.5 under)`
      const text = (marks: Mark[], opts: { fresh?: boolean } = {}): string => contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks, opts).text

      it('after an edit, says the build and the dimensions in the same words, and nothing of the other marks or the selection', () => {
        const view = { camera: CAMERA, layout: 'assembly', visible: ['assembly:base', 'assembly:post'], selection: { revision: 3, total: 1, refs: [{ ref: 'base/F5' }] } } as ViewState
        const marks = [pin(1), failing(8), passing(9), pin(11, { status: 'sent' })]
        const told = buildContextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', marks)
        expect(told.text).toBe([STATUS, DIMS, FAIL(8), '1 pinned dimension passes'].join('\n'))
        expect(told).toMatchObject({ sentMarkIds: [], revision: 3, buildState: 'ok' })
      })

      it('lists each one that fails, after the marks, and then how many pass', () => {
        const marks = [pin(1), failing(8), passing(9), passing(10), pin(11, { status: 'sent' })]
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
        expect(context.text).toBe([STATUS, HEAD, line(1), DIMS, FAIL(8), '2 pinned dimensions pass', 'Open marks: M9, M10, M11'].join('\n'))
        // They are not news: only the draft is turned sent.
        expect(context.sentMarkIds).toEqual(['M1'])
      })

      it('lists them with every prompt until they pass: nothing consumes them', () => {
        const marks = [failing(8)]
        const first = text(marks)
        expect(first).toBe([STATUS, DIMS, FAIL(8)].join('\n'))
        expect(text(marks)).toBe(first)
        // Passing, there is only the count; and it is among the open marks again.
        expect(text([passing(8)])).toBe([STATUS, DIMS, '1 pinned dimension passes', 'Open marks: M8'].join('\n'))
      })

      it('lists one that cannot be measured, with why, and one not measured on this build, without a value of it', () => {
        const marks = [
          dim(2, { value: undefined, how: undefined, refused: 'base/F9 is a plane face: it has no diameter', expected: 8 }),
          dim(3, { anchorState: 'orphaned', expected: 8, verdict: 'pass' }),
          passing(4, { measuredRevision: 2 }),
          dim(5, { measuredRevision: undefined })
        ]
        expect(text(marks)).toBe(
          [
            STATUS,
            DIMS,
            'M2 diameter: not measurable (base/F9 is a plane face: it has no diameter), base/F9 (expected 8 ± 0.05)',
            'M3 diameter: not measurable, [its part is gone]',
            'M4 diameter: not measured on r3 (was 8 mm on r2), base/F9 (expected 8 ± 0.05)',
            'M5 diameter: not measured yet, base/F9'
          ].join('\n')
        )
      })

      it('one whose end the build moved is measured, judged, and says that it moved', () => {
        expect(text([failing(8, { anchorState: 'drifted' }), passing(9, { anchorState: 'drifted' })])).toBe(
          [STATUS, DIMS, `${FAIL(8)} [moved since it was placed: check it]`, '1 pinned dimension passes (1 measured from what is under its ends now: M9)', 'Open marks: M9 (moved); call mcp__torno__marks for their data'].join('\n')
        )
        // Only counted, one that passes would pass unseen for what it was placed on: each such is named.
        expect(text([passing(9, { anchorState: 'drifted' }), passing(10), passing(12, { anchorState: 'drifted' })]).split('\n')[2]).toBe(
          '3 pinned dimensions pass (2 measured from what is under their ends now: M9, M12)'
        )
      })

      it('says nothing when there is none pinned, nor of one with nothing expected that is measured', () => {
        expect(text([pin(1, { status: 'sent' })])).toBe([STATUS, 'Open marks: M1'].join('\n'))
        expect(text([dim(2)])).toBe([STATUS, 'Open marks: M2'].join('\n'))
        // Resolved: no longer a check of the part.
        expect(text([failing(2, { status: 'resolved' })])).toBe(STATUS)
      })

      it('a draft dimension is told with the drafts, as a mark: not under the dimensions until it has been given', () => {
        const draft = failing(8, { status: 'draft', sentBefore: false })
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [draft])
        expect(context.text).toBe([STATUS, HEAD, FAIL(8)].join('\n'))
        expect(context.sentMarkIds).toEqual(['M8'])
        // Changed after it was given, it is news again, and listed once.
        expect(text([failing(8, { status: 'draft' })])).toBe([STATUS, HEAD, `(changed) ${FAIL(8)}`].join('\n'))
      })

      it('the agent’s own whose expectation the person changed is told as changed, not as reopened', () => {
        expect(text([failing(8, { author: 'agent', status: 'draft', sentBefore: true })])).toBe([STATUS, HEAD, `(yours, changed) ${FAIL(8)}`].join('\n'))
        expect(text([failing(8, { author: 'agent', status: 'draft', sentBefore: true, reopened: true })])).toBe([STATUS, HEAD, `(yours, reopened by the user) ${FAIL(8)}`].join('\n'))
        expect(text([failing(8, { author: 'agent', status: 'draft', sentBefore: false })])).toBe([STATUS, HEAD, `(yours, reopened by the user) ${FAIL(8)}`].join('\n'))
      })

      it('the agent’s own is listed as its own, and one of another layout says which', () => {
        expect(text([failing(8, { author: 'agent', layout: 'print' })])).toBe([STATUS, DIMS, `(yours) ${FAIL(8)} [in layout print]`].join('\n'))
      })

      it('in a conversation that has not seen the marks, is listed once: under the dimensions', () => {
        const marks = [pin(1, { status: 'sent', sentBefore: true }), failing(8), passing(9)]
        const STILL = 'Marks still open (this conversation has not seen them):'
        expect(text(marks, { fresh: true })).toBe(
          [STATUS, STILL, line(1), 'M9 diameter 8 mm, base/F9 (expected 8 ± 0.05: pass)', DIMS, FAIL(8), '1 pinned dimension passes', 'Open marks: M1, M9'].join('\n')
        )
      })

      it('keeps to the limit: what fits is listed, the rest counted, and the count of those that pass is still said', () => {
        const marks = [...Array.from({ length: 150 }, (_, i) => failing(i + 1, { note: 'n'.repeat(40) })), passing(200), passing(201)]
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks)
        expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
        const lines = context.text.split('\n')
        expect(lines[1]).toBe(DIMS)
        expect(lines[2]).toBe(`${FAIL(1)}: "${'n'.repeat(40)}"`)
        const listed = lines.filter((l) => l.includes('FAIL')).length
        expect(listed).toBeGreaterThan(30)
        expect(lines.at(-3)).toBe(`… and ${150 - listed} more unmet or unmeasured: call mcp__torno__marks`)
        expect(lines.at(-2)).toBe('2 pinned dimensions pass')
        // Those with a line above are not named again; those left out still are.
        expect(lines.at(-1)).toMatch(new RegExp(`^Open marks: M${listed + 1}, M${listed + 2}, `))
      })

      it('keeps room for them before the drafts are listed: a prompt full of drafts still says which dimensions fail', () => {
        const drafts = Array.from({ length: 60 }, (_, i) => pin(i + 1, { note: 'n'.repeat(300) }))
        const context = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [...drafts, failing(100), failing(101), passing(102)])
        expect(context.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
        const lines = context.text.split('\n')
        const at = lines.indexOf(DIMS)
        expect(at).toBeGreaterThan(5)
        // The head, then either a line or the count of those left out; and the count of those that pass.
        expect(lines.slice(at + 1).join('\n')).toMatch(/^(M100 .*\n(M101 .*|… and 1 more unmet or unmeasured: call mcp__torno__marks)|… and 2 more unmet or unmeasured: call mcp__torno__marks)\n1 pinned dimension passes\nOpen marks: /)
        // Only the drafts that were listed are turned sent.
        expect(context.sentMarkIds.length).toBeGreaterThan(5)
        expect(context.sentMarkIds.length).toBeLessThan(60)
        expect(context.sentMarkIds.every((id) => lines.some((l) => l.startsWith(`${id} pin`)))).toBe(true)
      })

      it('says which build they were measured on, and that it is not of the model as it now is while a build runs or after one failed', () => {
        const marks = [failing(8), passing(9)]
        const of = (build: BuildState): string[] => contextFor(deps({ build, scene: SCENE, revision: 3 }), 'bracket', marks).text.split('\n')
        expect(of(OK)[1]).toBe('Dimensions (measured on r3):')
        const building = of({ objectId: 'bracket', status: 'building', revision: 3, startedAt: 0, stale: true })
        expect(building[0]).toBe('[torno] bracket · building (0 s so far) · showing r3.')
        expect(building[1]).toBe('Dimensions (measured on r3; a build is running, so these are not of your last edit):')
        expect(building[3]).toBe('1 pinned dimension passes')
        const failed = of({ objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'no' } })
        expect(failed[2]).toBe('Dimensions (measured on r3; the latest build failed, so these are still of r3):')
        // The head is counted in what fits.
        const many = Array.from({ length: 150 }, (_, i) => failing(i + 1, { note: 'n'.repeat(40) }))
        expect(contextFor(deps({ build: { objectId: 'bracket', status: 'building', revision: 3, startedAt: 0, stale: true }, scene: SCENE, revision: 3 }), 'bracket', many).text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      })

      it('before any build of the run has none measured: each is told as not measured, never with the value its file holds', () => {
        const none = contextFor(deps({}), 'bracket', [passing(8, { measuredRevision: undefined })]).text
        expect(none).toBe(['[torno] bracket · not built yet.', 'Dimensions (nothing is built yet):', 'M8 diameter: not measured yet, base/F9 (expected 8 ± 0.05) [in layout assembly]'].join('\n'))
      })
    })

    it('tells of the marks of an object that is not built, or not open', () => {
      expect(contextFor(deps({}), 'bracket', [pin(1)]).text).toBe(['[torno] bracket · not built yet.', HEAD, `${line(1)} [in layout assembly]`].join('\n'))
      expect(contextFor(deps({ open: 'gear' }), 'bracket', [pin(1)]).sentMarkIds).toEqual(['M1'])
      expect(contextFor(deps({}), 'nothing', [pin(1)])).toEqual({ text: '', sentMarkIds: [] })
    })
  })
})

describe('scans', () => {
  const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 4, seconds: 0.8, stale: false }
  // Each model end was clicked on a part, and the last build's check found them in place, unless a test says otherwise.
  const pairs = [1.8, 3.4, 0.9, 1.2].map((residual) => ({ scan: [0, 0, 0] as [number, number, number], model: [0, 0, 0] as [number, number, number], part: 'base', residual }))
  const BY_PAIRS: ScanAlignment = { transform: { t: [1, 2, 3], q: [0, 0, 0, 1], s: 1 }, steps: ['pairs'], pairs, rms: 2.1, frame: {}, at: '' }
  const scan = (id: string, alignments: Record<string, ScanAlignment> = {}, more: Partial<ScanInfo> = {}): ScanInfo =>
    ({ id, name: `${id}.glb`, source: { path: `/dl/${id}.glb`, bytes: 1, mtimeMs: 1, sha256: '' }, imported: { unit: 'm', up: 'y', assumed: { unit: true, up: true }, vertices: 9, triangles: 9, colours: 'none', bbox: { min: [0, 0, 0], max: [1, 1, 1] }, area: 1, at: '' }, alignments, sourceState: 'present', meshState: 'ok', checks: Object.fromEntries(Object.keys(alignments).map((layout) => [layout, { revision: 4, of: 4, off: 0, worst: 0, moved: [] }])), ...more }) as ScanInfo

  it('lists a draft region with the other marks, where its scan stands in its layout', () => {
    const region = { id: 'M7', kind: 'region', scan: 'S1', author: 'user', note: 'wiring loom, can be pushed aside', status: 'draft', anchorState: 'ok', layout: 'print', revision: 4, camera: CAMERA, createdAt: '', triangles: 4812, area: 31000, local: { centroid: [-15, -15, 0], bbox: { min: [-20, -20, -0.5], max: [-10, -10, 0.5] }, plane: { origin: [-15, -15, 0], normal: [0, 0, 1], rms: 0.42 }, box: { centre: [-15, -15, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [5, 5, 0.5] } } } as unknown as Mark
    const view: ViewState = { objectId: 'bracket', layout: 'print', camera: CAMERA, visible: [], scans: [{ id: 'S1', visible: true, opacity: 1, loaded: true }] }
    const told = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [region], { scans: [scan('S1', { print: BY_PAIRS })] })
    expect(told.text.split('\n')).toContain('M7 region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ (-14, -13, 3), ≈ 10 × 10 × 1 mm, within a box of ≈ 10 × 10 × 1 mm, flat about a plane with normal ≈ (0, 0, 1): "wiring loom, can be pushed aside"')
    // I3: painted while another layout was shown, it is told in the one on show, with no "[in layout …]" after it.
    const elsewhere = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [{ ...region, layout: 'assembly' } as Mark], { scans: [scan('S1', { print: BY_PAIRS })] })
    expect(elsewhere.text.split('\n')).toContain('M7 region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ (-14, -13, 3), ≈ 10 × 10 × 1 mm, within a box of ≈ 10 × 10 × 1 mm, flat about a plane with normal ≈ (0, 0, 1): "wiring loom, can be pushed aside"')
    expect(elsewhere.text).not.toContain('[in layout')
    const nowhere = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [region], { scans: [scan('S1', { assembly: BY_PAIRS })] })
    expect(nowhere.text).toContain('M7 region on scan S1 (not aligned in print, so it has no place in the model’s frame)')
    expect(told.sentMarkIds).toEqual(['M7'])
    // Its scan gone: it is told as that, with its note.
    const gone = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [{ ...region, anchorState: 'orphaned', sentBefore: true } as Mark], { scans: [] })
    expect(gone.text.split('\n')).toContain('(changed) M7 region on scan S1 [its scan is gone]: "wiring loom, can be pushed aside"')
    // Nothing counts it as a mark no build has checked.
    expect(told.text).not.toContain('not checked')
  })

  // Milestone 5 (T6): of an object that is not the one open no layout is named above: the region's own line names the one it is told in.
  it('tells a draft region of an object that is not open in the first layout of its build, and says which', () => {
    const region = { id: 'M7', kind: 'region', scan: 'S1', author: 'user', note: 'loom', status: 'draft', anchorState: 'ok', layout: 'print', revision: 4, camera: CAMERA, createdAt: '', triangles: 4812, area: 31000, local: { centroid: [-15, -15, 0], bbox: { min: [-20, -20, -0.5], max: [-10, -10, 0.5] }, plane: { origin: [-15, -15, 0], normal: [0, 0, 1], rms: 0.42 }, box: { centre: [-15, -15, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [5, 5, 0.5] } } } as unknown as Mark
    const elsewhere = (scans: ScanInfo[], mark = region): string => contextFor(deps({ build: OK, scene: SCENE, open: 'gear' }), 'bracket', [mark], { scans }).text.split('\n').find((line) => line.includes('M7 region'))!
    // Aligned in the build's first layout: it has its place there, though it was painted in print.
    expect(elsewhere([scan('S1', { assembly: BY_PAIRS })])).toBe('M7 region on scan S1: 4,812 triangles, ≈ 31000 mm², centre ≈ (-14, -13, 3), ≈ 10 × 10 × 1 mm, within a box of ≈ 10 × 10 × 1 mm, flat about a plane with normal ≈ (0, 0, 1): "loom" [in layout assembly]')
    expect(elsewhere([scan('S1', { print: BY_PAIRS })])).toMatch(/^M7 region on scan S1 \(not aligned in assembly, so it has no place in the model’s frame\): .*: "loom" \[in layout assembly\]$/)
    // Before anything is built there is no first layout: its own is the one it is told in, and is named.
    const unbuilt = contextFor(deps({ open: 'gear' }), 'bracket', [region], { scans: [scan('S1', { print: BY_PAIRS })] }).text
    expect(unbuilt.split('\n').find((line) => line.includes('M7 region'))).toMatch(/: "loom" \[in layout print\]$/)
    // One whose scan is gone is nowhere: no layout is named for it.
    expect(elsewhere([], { ...region, anchorState: 'orphaned' } as Mark)).toBe('M7 region on scan S1 [its scan is gone]: "loom"')
  })

  it('says the scans in one line after the status, and nothing when there are none', () => {
    const view: ViewState = { objectId: 'bracket', layout: 'print', camera: CAMERA, visible: [], scans: [{ id: 'S1', visible: true, opacity: 0.6, loaded: true }, { id: 'S2', visible: false, opacity: 1, loaded: true }] }
    const text = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [scan('S1', { print: BY_PAIRS }), scan('S2')] }).text
    expect(text.split('\n')[1]).toBe('Scans: S1 S1.glb, aligned in print by 4 pairs (RMS 2.1 mm, worst 3.4 mm), shown at 60 %; S2 S2.glb, not aligned in print, hidden.')
    expect(contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [] }).text).not.toContain('Scans:')
    expect(contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', []).text).not.toContain('Scans:')
  })

  it('says it after what is selected, for the first layout and without what is on screen when the object is not open', () => {
    const view: ViewState = { objectId: 'bracket', layout: 'print', camera: CAMERA, visible: [], scans: [{ id: 'S1', visible: true, opacity: 1, loaded: true }], selection: { revision: 4, total: 1, refs: [{ ref: 'base/F1' }] } }
    const lines = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [scan('S1', { print: BY_PAIRS })] }).text.split('\n')
    expect(lines.slice(1)).toEqual(['Selected: base/F1', 'Scans: S1 S1.glb, aligned in print by 4 pairs (RMS 2.1 mm, worst 3.4 mm), shown.'])
    const elsewhere = contextFor(deps({ build: OK, scene: SCENE, view, open: 'other' }), 'bracket', [], { scans: [scan('S1', { print: BY_PAIRS })] }).text
    expect(elsewhere.split('\n')[1]).toBe('Scans: S1 S1.glb, not aligned in assembly.')
    // Before anything is built there is no layout to say it of.
    expect(contextFor(deps({ build: { ...OK, status: 'failed', revision: 0 } }), 'bracket', [], { scans: [scan('S1', { print: BY_PAIRS })] }).text).toContain('\nScans: S1 S1.glb.')
  })

  it('says when the model has moved under one and when one is only rough, and keeps to its room', () => {
    const stale = scan('S1', { print: BY_PAIRS }, { checks: { print: { revision: 4, of: 4, off: 2, worst: 6.2, moved: [] } } })
    const view: ViewState = { objectId: 'bracket', layout: 'print', camera: CAMERA, visible: [] }
    expect(contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [stale] }).text).toContain('aligned in print by 4 pairs (RMS 2.1 mm, worst 3.4 mm) but the model is no longer under 2 of its 4 points (worst 6.2 mm off) on r4: check the alignment')
    // Task 5's fix round 1 (R-basis): rough is a doubtful fit of pairs; a scan placed by hand is said to be by hand.
    const rough = scan('S1', { print: { ...BY_PAIRS, pairs: pairs.slice(0, 2), rough: 'it has 2 pairs of points: it takes three that are not in a line to fix a scan' } })
    expect(contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [rough] }).text).toContain('Scans: S1 S1.glb, aligned roughly in print by 2 pairs (RMS 2.1 mm, worst 3.4 mm) (it has 2 pairs of points: it takes three that are not in a line to fix a scan).')
    const byHand = scan('S1', { print: { ...BY_PAIRS, steps: ['typed'], pairs: undefined, rms: undefined } })
    expect(contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [byHand] }).text).toContain('Scans: S1 S1.glb, aligned in print by hand (typed values) (tied to no point of the model: not checked against builds).')
    // One the last build was not checked against says so (R-check).
    const unchecked = scan('S1', { print: BY_PAIRS }, { checks: {} })
    expect(contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [unchecked] }).text).toContain('Scans: S1 S1.glb, aligned in print by 4 pairs (RMS 2.1 mm, worst 3.4 mm) (not checked against r4).')
    // Final fix wave (T1): a later scan's doubt is never among "and 1 more", and a long name does not cut it off.
    const named = scan('S1', { print: BY_PAIRS }, { name: `${'garage '.repeat(60)}.glb` })
    const second = { ...stale, id: 'S2', name: 'S2.glb' }
    const two = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [named, second] }).text.split('\n').find((l) => l.startsWith('Scans:'))!
    expect(two.length).toBeLessThanOrEqual(600)
    expect(two).toMatch(/; S2 \(in doubt\)\.$/)
    expect(two).not.toContain('more')
    const notChecked = { ...unchecked, id: 'S3', name: 'S3.glb' }
    const three = contextFor(deps({ build: OK, scene: SCENE, view }), 'bracket', [], { scans: [named, second, notChecked, scan('S4', { print: BY_PAIRS })] }).text.split('\n').find((l) => l.startsWith('Scans:'))!
    expect(three).toMatch(/; S2 \(in doubt\); S3 \(not checked\) and 1 more\.$/)
    const many = Array.from({ length: 30 }, (_, n) => scan(`S${n + 1}`))
    const line = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [], { scans: many }).text.split('\n').find((l) => l.startsWith('Scans:'))!
    expect(line.length).toBeLessThanOrEqual(600)
    const long = scan('S1', { print: BY_PAIRS }, { name: 'x'.repeat(400) })
    expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [], { scans: [long] }).text.split('\n')[1].length).toBeLessThanOrEqual(600)
  })

  it('counts the line in what the marks have room for', () => {
    const marks = Array.from({ length: 400 }, (_, n) => ({ id: `M${n + 1}`, kind: 'pin', author: 'user', note: 'n'.repeat(60), status: 'draft', anchorState: 'ok', layout: 'assembly', revision: 4, camera: CAMERA, createdAt: '', checkedRevision: 4, anchor: { point: [0, 0, 0] } }) as Mark)
    const text = contextFor(deps({ build: OK, scene: SCENE }), 'bracket', marks, { scans: [scan('S1', { assembly: BY_PAIRS })] }).text
    expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(text).toContain('\nScans: S1 S1.glb, aligned in assembly by 4 pairs')
    expect(text).toMatch(/… and \d+ more: call mcp__torno__marks/)
  })
})

describe('what the model printed', () => {
  const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 4, seconds: 0.5, stale: false }
  const FAILED: BuildState = { objectId: 'bracket', status: 'failed', revision: 3, stale: true, error: { kind: 'exception', message: 'AssertionError: 2 solids', traceback: 'Traceback (most recent call last):\n  File "bracket.py", line 9\nAssertionError: 2 solids', output: 'solids: 2\nvolume: 3040.5' } }
  const printing = (output: string): Scene => ({ ...SCENE, output })
  const lines = (n: number, from = 1): string => Array.from({ length: n }, (_, i) => `row ${from + i}`).join('\n')

  it('is told after a build that worked, last, with the number of lines', () => {
    const told = buildContextFor(deps({ build: OK, scene: printing('solids: 2\nvolume: 3040.5\n') }), 'bracket')
    expect(told.text).toBe('[torno] bracket · build ok · r4 (0.5 s) · layout assembly · parts: base, post.\nModel printed (last 2 lines):\nsolids: 2\nvolume: 3040.5')
    expect(told).toMatchObject({ sentMarkIds: [], revision: 4, buildState: 'ok' })
  })

  it('is told after a build that failed, after its traceback', () => {
    const text = buildContextFor(deps({ build: FAILED, scene: SCENE }), 'bracket').text
    expect(text).toContain('BUILD FAILED')
    expect(text).toContain('AssertionError: 2 solids')
    expect(text.endsWith('\nModel printed (last 2 lines):\nsolids: 2\nvolume: 3040.5')).toBe(true)
  })

  it('is the last 15 lines, and says that the rest was cut', () => {
    const text = buildContextFor(deps({ build: OK, scene: printing(lines(40)) }), 'bracket').text
    expect(text.split('\n').slice(-16)).toEqual(['Model printed (last 15 lines, earlier output cut):', ...lines(15, 26).split('\n')])
    expect(text).not.toContain('row 25\n')
    expect(text.endsWith('row 40')).toBe(true)
  })

  it('is the last 1,000 characters at most, the end kept', () => {
    const text = buildContextFor(deps({ build: OK, scene: printing(`${'a'.repeat(3000)}\nthe end`) }), 'bracket').text
    const [, head, ...rest] = text.split('\n')
    expect(head).toBe('Model printed (last 2 lines, earlier output cut):')
    const tail = rest.join('\n')
    expect(tail.length).toBeLessThanOrEqual(1000)
    expect(tail.startsWith('…')).toBe(true)
    expect(tail.endsWith('\nthe end')).toBe(true)
    expect(modelOutput(deps({ build: OK, scene: printing('x'.repeat(5000)) }), 'bracket')?.text.length).toBe(1000)
  })

  it('is not said when the model printed nothing, or only blank lines', () => {
    expect(buildContextFor(deps({ build: OK, scene: printing('') }), 'bracket').text).not.toContain('Model printed')
    expect(buildContextFor(deps({ build: OK, scene: printing('\n  \n') }), 'bracket').text).not.toContain('Model printed')
    expect(buildContextFor(deps({ build: { ...FAILED, error: { kind: 'exception', message: 'no' } }, scene: SCENE }), 'bracket').text).not.toContain('Model printed')
  })

  it('is told of the build that ended last: not while one runs, and not for a kernel that stopped', () => {
    const building: BuildState = { objectId: 'bracket', status: 'building', revision: 4, startedAt: 0, stale: true }
    expect(buildContextFor(deps({ build: building, scene: printing('old') }), 'bracket').text).not.toContain('Model printed')
    // The output of a kernel that stopped is its stderr, not the model's.
    const stopped: BuildState = { objectId: 'bracket', status: 'failed', revision: 4, stale: true, error: { kind: 'crash', message: 'kernel stopped', output: 'Traceback in the kernel', kernelStderr: true } }
    expect(buildContextFor(deps({ build: stopped, scene: printing('old') }), 'bracket').text).not.toContain('Model printed')
    expect(buildContextFor(deps({ build: stopped, scene: printing('old') }), 'bracket').text).not.toContain('Traceback in the kernel')
    // A build process that was killed (a segfault in a boolean) keeps what the model printed before it.
    const killed: BuildState = { objectId: 'bracket', status: 'failed', revision: 4, stale: true, error: { kind: 'crash', message: 'the build process was killed by SIGSEGV (Segmentation fault) before it finished', output: 'cutting\nabout to fuse' } }
    expect(buildContextFor(deps({ build: killed, scene: printing('old') }), 'bracket').text).toMatch(/\nModel printed \(last 2 lines\):\ncutting\nabout to fuse$/)
    // Nor is the output of the build before a failed one.
    expect(buildContextFor(deps({ build: { ...FAILED, error: { kind: 'exception', message: 'no' } }, scene: printing('from r3') }), 'bracket').text).not.toContain('from r3')
  })

  it('is not part of what goes with a prompt', () => {
    expect(contextFor(deps({ build: OK, scene: printing('solids: 2') }), 'bracket').text).not.toContain('Model printed')
  })

  it('comes after the dimensions and keeps the whole to CONTEXT_LIMIT, the dimensions first', () => {
    const dim = (n: number, note = ''): Mark =>
      ({ id: `M${n}`, kind: 'dimension', author: 'user', note, status: 'sent', sentBefore: true, anchorState: 'ok', layout: 'assembly', revision: 4, camera: CAMERA, createdAt: '', checkedRevision: 4, measure: 'diameter', a: { point: [n, 0, 5], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', measuredRevision: 4, expected: 8.5, tolerance: 0.05, verdict: 'fail' }) as unknown as Mark
    const dims = Array.from({ length: 12 }, (_, n) => dim(n + 1))
    const without = buildContextFor(deps({ build: OK, scene: SCENE }), 'bracket', dims).text
    const text = buildContextFor(deps({ build: OK, scene: printing(lines(15)) }), 'bracket', dims).text
    expect(text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
    expect(text.startsWith(without)).toBe(true)
    // Whatever room is left holds the end of it, or says there is output.
    expect(text.slice(without.length)).toMatch(/^\nModel printed/)
    // No room at all: the dimensions are not given up for it.
    // As the dimensions take the room, less of it is told, then a line that there is some, then nothing: never over the limit.
    const endings = new Set<string>()
    for (let count = 1; count <= 130; count += 1) {
      const crowded = buildContextFor(deps({ build: OK, scene: printing(lines(15)) }), 'bracket', Array.from({ length: count }, (_, n) => dim(n + 1))).text
      expect(crowded.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      endings.add(crowded.includes('\nModel printed (') ? 'tail' : crowded.endsWith('call mcp__torno__scene to read it.') ? 'pointer' : 'nothing')
    }
    expect([...endings].sort()).toEqual(['nothing', 'pointer', 'tail'])
  })

  it('keeps the traceback whole when the output is long', () => {
    const text = buildContextFor(deps({ build: { ...FAILED, error: { ...FAILED.error!, output: lines(100) } }, scene: SCENE }), 'bracket').text
    expect(text).toContain('File "bracket.py", line 9\nAssertionError: 2 solids\nModel printed (last 15 lines, earlier output cut):')
  })

  it('goes through the redaction of whatever is logged, before it is cut', () => {
    const redact = (t: string): string => t.split('s3cret').join('[redacted]')
    const text = buildContextFor({ ...deps({ build: OK, scene: printing('key s3cret\nmore') }), redact }, 'bracket').text
    expect(text).toContain('key [redacted]')
    expect(text).not.toContain('s3cret')
  })
})

describe('the digest of the build of an edit', () => {
  const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 4, seconds: 0.5, stale: false }
  const STATUS = '[torno] bracket · build ok · r4 (0.5 s) · layout assembly · parts: base, post.'
  const sound = (layout: string, name: string, more: Partial<Part> = {}): Part =>
    ({ key: `${layout}:${name}`, name, layout, bbox: { min: [0, 0, 0], max: [40, 30, 6] }, bboxExact: true, volume: 7200, volumeExact: true, faceCount: 6, edgeCount: 12, valid: true, solids: 1, openShells: 0, meshVolume: 7200, ...more }) as Part
  const R3: Scene = { ...SCENE, parts: [sound('assembly', 'base'), sound('assembly', 'post'), sound('print', 'base'), sound('print', 'post')] }
  const R4: Scene = { ...SCENE, output: 'volume: 6000', parts: [sound('assembly', 'base', { volume: 6000, meshVolume: 6000, solids: 2, faceCount: 12, edgeCount: 24 }), sound('assembly', 'post'), sound('print', 'base', { volume: 6000, solids: 2, faceCount: 12, edgeCount: 24 }), sound('print', 'post')] }
  const withBuilds = (over: Pick<ContextDeps, 'verdicts'> & { build?: BuildState; kept?: Array<{ revision: number; scene: Scene }> } = {}): ContextDeps => {
    const kept = over.kept ?? [
      { revision: 3, scene: R3 },
      { revision: 4, scene: R4 }
    ]
    return { ...deps({ build: over.build ?? OK, scene: kept.at(-1)?.scene, revision: kept.at(-1)?.revision }), scenes: () => kept, ...(over.verdicts ? { verdicts: over.verdicts } : {}) }
  }
  const DIGEST = ['Changed since r3: base: volume 7200 → 6000 mm³ (-1200, -17 %), faces 6 → 12, edges 12 → 24, solids 1 → 2; 1 part unchanged.', 'Check: base is 2 solids (was 1); the face or edge numbers of base may name others now (describe refs again).'].join('\n')

  it('comes after the status and before what the model printed, and is given as data', () => {
    const told = buildContextFor(withBuilds(), 'bracket')
    expect(told.text).toBe([STATUS, DIGEST, 'Model printed (last 1 line):', 'volume: 6000'].join('\n'))
    expect(told.digest).toMatchObject({ revision: 4, since: 3, changed: true, unchanged: 1, flags: [{ kind: 'solids', part: 'base', hard: true }, { kind: 'refs', part: 'base' }] })
    expect(told.digest?.parts.map((p) => p.name)).toEqual(['base'])
  })

  it('is left out when an eval run takes it away (digest: false), the rest as ever', () => {
    const told = buildContextFor({ ...withBuilds(), digest: false }, 'bracket')
    expect(told.text).toBe([STATUS, 'Model printed (last 1 line):', 'volume: 6000'].join('\n'))
    expect(told.digest).toBeUndefined()
  })

  it('comes before the dimensions, and says a dimension that passed on the build before and fails now', () => {
    const dim = (n: number, over: object): Mark =>
      ({ id: `M${n}`, kind: 'dimension', author: 'user', note: '', status: 'sent', sentBefore: true, anchorState: 'ok', layout: 'assembly', revision: 4, camera: CAMERA, createdAt: '', checkedRevision: 4, measure: 'diameter', a: { point: [n, 0, 5], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', measuredRevision: 4, expected: 8, tolerance: 0.05, ...over }) as unknown as Mark
    const marks = [dim(4, { value: 9, verdict: 'fail' }), dim(5, { verdict: 'pass' })]
    const verdicts = (_id: string, revision: number | undefined) =>
      new Map(
        revision === 3
          ? [
              ['M4', 'pass' as const],
              ['M5', 'pass' as const]
            ]
          : [
              ['M4', 'fail' as const],
              ['M5', 'pass' as const]
            ]
      )
    const told = buildContextFor(withBuilds({ verdicts, kept: [{ revision: 3, scene: R3 }, { revision: 4, scene: { ...R3, output: '' } }] }), 'bracket', marks)
    const lines = told.text.split('\n')
    expect(lines.slice(0, 3)).toEqual([STATUS, "Changed since r3: no part's volume, size or faces (2 as they were).", 'Check: M4 FAIL, passed on r3.'])
    expect(lines[3]).toBe('Dimensions (measured on r4):')
    expect(told.digest?.dimensions).toEqual([{ id: 'M4', was: 'pass', now: 'fail' }])
  })

  it('tells the assumed sizes when that set changes, and not otherwise', () => {
    const param = (name: string, value: number, doc: string | null) => ({ name, type: 'float', default: value, literal: true, doc })
    const a: Scene = { ...R3, params: [param('wall', 2, 'assumed: perimeters'), param('w', 60, 'brief: asked'), param('c', 1, null)] }
    const same: Scene = { ...R4, params: a.params as NonNullable<Scene['params']> }
    const less: Scene = { ...R4, params: [param('wall', 2, 'brief: asked'), param('w', 60, 'brief: asked'), param('c', 1, null)] }
    const LINE = 'Assumed: wall 2 (1 of 3 sizes); no source: 1'
    expect(buildContextFor(withBuilds({ kept: [{ revision: 3, scene: R3 }, { revision: 4, scene: same }] }), 'bracket').text).toContain(LINE)
    expect(buildContextFor(withBuilds({ kept: [{ revision: 3, scene: a }, { revision: 4, scene: same }] }), 'bracket').text).not.toContain('Assumed')
    expect(buildContextFor(withBuilds({ kept: [{ revision: 3, scene: a }, { revision: 4, scene: less }] }), 'bracket').text).toContain('No source: 1 of 3 sizes')
  })

  it("says every time that the build is made with Params the person tried, and what was let go of", () => {
    const param = (name: string, def: number, value: number) => ({ name, type: 'float', default: def, value, literal: true, doc: null, editable: 'float' as const })
    const tried: Scene = { ...SCENE, params: [param('wall', 2, 2.4), param('lip', 3, 3)] }
    for (const make of [contextFor, buildContextFor]) {
      const lines = make(withBuilds({ kept: [{ revision: 3, scene: tried }] }), 'bracket').text.split('\n')
      expect(lines[1]).toBe('Params tried by the person (this build is made with them; the model file says otherwise): wall 2.4 (file 2). To make one the default, edit it in the model.')
    }
    const gone: Scene = { ...SCENE, params: [param('wall', 2.2, 2.2)], overrides: { applied: {}, dropped: [{ name: 'wall', reason: 'the file wins' }] } }
    expect(contextFor(withBuilds({ kept: [{ revision: 3, scene: gone }] }), 'bracket').text).toContain('Params overrides let go of: wall (the file wins).')
    expect(contextFor(withBuilds({ kept: [{ revision: 3, scene: SCENE }] }), 'bracket').text).not.toContain('Params tried')
  })

  it('of a first build, is the check alone', () => {
    const told = buildContextFor(withBuilds({ kept: [{ revision: 4, scene: { ...R3, output: '' } }] }), 'bracket')
    expect(told.text).toBe([STATUS, 'Check: nothing found (every part valid, closed, not inside out, its mesh agreeing with its volume).'].join('\n'))
    expect(told.digest).toMatchObject({ revision: 4, changed: false })
  })

  it('is not given while a build runs, after one that failed, of a build that is not the last kept, nor with a prompt', () => {
    const running: BuildState = { objectId: 'bracket', status: 'building', revision: 4, stale: true }
    const failed: BuildState = { objectId: 'bracket', status: 'failed', revision: 4, stale: true, error: { kind: 'exception', message: 'boom' } }
    for (const build of [running, failed, { ...OK, revision: 5 }]) {
      const told = buildContextFor(withBuilds({ build }), 'bracket')
      expect(told.text).not.toMatch(/Changed since|Check:/)
      expect(told.digest).toBeUndefined()
    }
    expect(contextFor(withBuilds(), 'bracket').text).not.toMatch(/Changed since|Check:/)
    expect(contextFor(withBuilds(), 'bracket').digest).toBeUndefined()
  })

  it('keeps the whole within CONTEXT_LIMIT, the dimensions told after it whatever their number', () => {
    const many = (n: number, more: (i: number) => Partial<Part>): Part[] => Array.from({ length: n }, (_, i) => sound('assembly', `a-part-with-a-rather-long-name-${i}`, more(i)))
    const before: Scene = { ...SCENE, layouts: ['assembly'], parts: many(60, () => ({})) }
    const after: Scene = { ...SCENE, layouts: ['assembly'], output: 'x'.repeat(900), parts: many(60, (i) => ({ volume: 7000 - i, valid: i % 7 !== 0 })) }
    const dim = (n: number): Mark =>
      ({ id: `M${n}`, kind: 'dimension', author: 'user', note: 'a note '.repeat(10), status: 'sent', sentBefore: true, anchorState: 'ok', layout: 'assembly', revision: 4, camera: CAMERA, createdAt: '', checkedRevision: 4, measure: 'diameter', a: { point: [n, 0, 5], part: 'base', ref: 'base/F9' }, value: 8, how: 'cylinder', measuredRevision: 4, expected: 8.5, tolerance: 0.05, verdict: 'fail' }) as unknown as Mark
    for (const count of [0, 5, 40, 120]) {
      const told = buildContextFor(withBuilds({ kept: [{ revision: 3, scene: before }, { revision: 4, scene: after }] }), 'bracket', Array.from({ length: count }, (_, n) => dim(n + 1)))
      expect(told.text.length).toBeLessThanOrEqual(CONTEXT_LIMIT)
      const lines = told.text.split('\n')
      expect(lines[1]).toMatch(/^Changed since r3: /)
      expect(lines[2]).toMatch(/^Check: a-part-with-a-rather-long-name-0 is not valid/)
      expect(lines[1].length + lines[2].length + 1).toBeLessThanOrEqual(1200)
      if (count > 0) expect(lines[3]).toBe('Dimensions (measured on r4):')
    }
  })
})

describe('a failed fillet', () => {
  const MESSAGE = 'ValueError: Failed creating a fillet with radius of 6, try a smaller value or use max_fillet() to find the largest valid fillet radius'
  const failed = (over: Partial<NonNullable<BuildState['error']>> = {}): BuildState => ({
    objectId: 'bracket',
    status: 'failed',
    revision: 3,
    stale: true,
    error: { kind: 'exception', message: MESSAGE, traceback: 'Traceback (most recent call last):\n  File "bracket.py", line 9\nValueError: Failed creating a fillet', diagnosis: probe(), output: 'making the plate', ...over }
  })

  it('is told why under the error line, before the traceback, so that the agent has it without a call', () => {
    const text = buildContextFor(deps({ build: failed(), scene: SCENE }), 'bracket').text
    const lines = text.split('\n')
    expect(lines[0]).toBe('[torno] bracket · BUILD FAILED · showing r3 (stale).')
    expect(lines[1]).toBe(MESSAGE)
    expect(lines[2]).toBe(
      'Why: fillet R6 of 8 edges: each works alone; 4 pairs of adjacent edges fail (edges 4-5, 4-6, 5-7, 6-7: 12 mm apart, two R6 need more); the 8 together work up to R5.999 (fail at R6, bisected to 0.001 mm).'
    )
    expect(lines[3]).toMatch(/^Edges \(local: /)
    expect(text.indexOf('Traceback (most recent call last):')).toBeGreaterThan(text.indexOf('4: line, 5 mm'))
    expect(text.endsWith('Model printed (last 1 line):\nmaking the plate')).toBe(true)
  })

  it('is told with a prompt too, as the error is', () => {
    expect(contextFor(deps({ build: failed(), scene: SCENE }), 'bracket').text.split('\n')[2]).toMatch(/^Why: fillet R6 of 8 edges/)
  })

  it('fits under the error within the limits the failed line keeps: the traceback keeps its last line', () => {
    const traceback = Array.from({ length: 12 }, (_, i) => `frame ${i + 1} ${'x'.repeat(900)}`).join('\n')
    const many = { ...probe(), edges: Array.from({ length: 24 }, (_, i) => ({ ...probe().edges[0]!, index: i })) }
    const build = failed({ message: `ValueError: ${'m'.repeat(900)}`, traceback: `${traceback}\nValueError: the last line`, diagnosis: many })
    // Alone, and beside marks, where the build's lines keep a third of the room.
    const marks = Array.from({ length: 50 }, (_, i) => ({ id: `M${i + 1}`, kind: 'pin', status: 'draft', author: 'user', note: 'n'.repeat(80), layout: 'assembly', anchor: { point: [0, 0, 0], ref: 'base/F1' } }) as unknown as Mark)
    for (const [text, room] of [
      [textFor(deps({ build, scene: SCENE }), 'bracket'), CONTEXT_LIMIT],
      [buildContextFor(deps({ build, scene: SCENE }), 'bracket').text, CONTEXT_LIMIT],
      [contextFor(deps({ build, scene: SCENE }), 'bracket', marks).text.split('\nMarks from the user')[0]!, 2000]
    ] as const) {
      expect(text.length).toBeLessThanOrEqual(room)
      const lines = text.split('\n')
      expect(lines[2]).toMatch(/^Why: fillet R6 of 8 edges: each works alone; 4 pairs/)
      expect(text).toContain('\nValueError: the last line')
      expect(text.match(/\n\d+: line/g)?.length ?? 0).toBeLessThan(24)
    }
    // What is cut of the edges is counted.
    expect(textFor(deps({ build, scene: SCENE }), 'bracket')).toMatch(/\nand \d+ more edges\n/)
  })
})

// #53: the checks the model declares are told after the person's dimensions, never as "verified".
describe('the checks the model declares', () => {
  const build: BuildState = { objectId: 'bracket', status: 'ok', revision: 4, seconds: 0.5, stale: false }
  const fits = { name: 'lid fits the tub', kind: 'clearance', status: 'fail' as const, value: 0.12, unit: 'mm', min: 0.15, max: 0.25, exact: true }
  const walls = { name: 'walls', kind: 'thin', status: 'pass' as const, value: null, unit: 'mm', min: 1.2, max: null, exact: false }
  const gap = { name: 'gap', kind: 'clearance', status: 'pass' as const, value: 0.2, unit: 'mm', min: 0.1, max: 0.3, exact: true }
  const dimension = {
    id: 'M8', kind: 'dimension', measure: 'diameter', author: 'user', note: '', status: 'sent', anchorState: 'ok', layout: 'assembly', revision: 4, camera: CAMERA, createdAt: '', checkedRevision: 4,
    value: 7, expected: 8, tolerance: 0.05, measuredRevision: 4, anchor: { ref: 'base/F9' }
  } as unknown as Mark

  it('are told in a line under the build, with what did not pass named and a pass never called verified', () => {
    const text = textFor(deps({ build, scene: { ...SCENE, checks: [fits, walls, gap] } }), 'bracket')
    expect(text.split('\n').at(-1)).toBe("Checks (the model's own, on r4): 2 pass, 1 fails (1 of the passes by sampling or approximate): lid fits the tub (0.12 mm, wanted 0.15 to 0.25 mm)")
    expect(text).not.toMatch(/verified/i)
  })
  it('come after the dimensions of the person, and the same after an edit', () => {
    const scene = { ...SCENE, checks: [fits] }
    const told = contextFor(deps({ build, scene }), 'bracket', [dimension]).text.split('\n')
    expect(told.findIndex((l) => l.startsWith('Checks'))).toBeGreaterThan(told.findIndex((l) => l.startsWith('Dimensions')))
    expect(buildContextFor(deps({ build, scene }), 'bracket', [dimension]).text).toContain('Checks (the model')
  })
  it('say while a build runs that they are not of the last edit', () => {
    const running = { objectId: 'bracket', status: 'building', revision: 4, stale: false } as BuildState
    expect(textFor(deps({ build: running, scene: { ...SCENE, checks: [fits] }, revision: 4 }), 'bracket')).toContain('[a build is running, so these are not of your last edit]')
  })
  it('are not mentioned when the model declares none', () => {
    expect(textFor(deps({ build, scene: { ...SCENE, checks: [] } }), 'bracket')).not.toContain('Checks')
    expect(textFor(deps({ build, scene: SCENE }), 'bracket')).not.toContain('Checks')
  })
  it('keep the context within its limit with many of them', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...fits, name: `check number ${i} with a long name` }))
    expect(textFor(deps({ build, scene: { ...SCENE, checks: many } }), 'bracket').length).toBeLessThanOrEqual(CONTEXT_LIMIT)
  })
})

describe('the print profile of a new conversation', () => {
  const OK: BuildState = { objectId: 'bracket', status: 'ok', revision: 1, seconds: 0.5, stale: false }
  const profile = { printer: printerOf({ name: 'Bambu X1C', bed: [256, 256, 250], nozzle: 0.4 })!, material: STARTER_MATERIALS[1] }
  it('is told in one line, in a new conversation only', () => {
    const d = { ...deps({ build: OK, scene: SCENE }), profile: () => profile }
    const fresh = contextFor(d, 'bracket', [], { fresh: true }).text.split('\n')
    expect(fresh.filter((l) => l.startsWith('Print profile of this project')).length).toBe(1)
    expect(fresh.join('\n')).toContain('Bambu X1C')
    expect(contextFor(d, 'bracket').text).not.toContain('Print profile')
    expect(contextFor(d, 'bracket', [], { newConversation: true, buildOnly: true } as never).text).not.toContain('Print profile')
  })
  it('is not told when the project has none', () => {
    expect(contextFor(deps({ build: OK, scene: SCENE }), 'bracket', [], { fresh: true }).text).not.toContain('Print profile')
  })
})
