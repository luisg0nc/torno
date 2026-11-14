import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../shared/history'
import type { ObjectInfo } from '../shared/workspace'
import { type RunningKernel, startKernel } from './kernel/client'
import { rebuildKept, sweepCompare } from './oldbuild'

// An older kept build drawn from its copy, against the real kernel (RF5: what it draws is the copy's `common/`, not today's).

const KERNEL_DIR = resolve(__dirname, '../../../kernel')

let root: string
let userData: string
let kernel: RunningKernel

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

// Two ways a model reaches `common/`: through the folder the kernel is run in, and by a path of its own.
const viaCwd = ['from build123d import Box', 'from common.fillets import SIZE', '', 'block = Box(SIZE, SIZE, SIZE)', ''].join('\n')
const viaPath = ['import pathlib, sys', "sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'common'))", 'from build123d import Box', 'from fillets import SIZE', '', 'block = Box(SIZE, SIZE, SIZE)', ''].join('\n')

/** A kept build: its copies where the history keeps them (`.torno/history/h1/source/`), and its entry. */
function kept(name: string, files: Record<string, string>, extra: Partial<HistoryEntry> = {}): { obj: ObjectInfo; entry: HistoryEntry } {
  const dir = join(root, name)
  for (const [file, text] of Object.entries(files)) write(join(dir, '.torno', 'history', 'h1', 'source', ...file.split('/')), text)
  const obj: ObjectInfo = { id: name, name, dir, model: `${name}.py` }
  const entry: HistoryEntry = { id: 'h1', at: '2026-11-14T10:00:00Z', run: 'r', revision: 1, sources: 'x', model: `${name}.py`, files: Object.keys(files), parts: 1, seconds: 1, line: 'first build kept', ...extra }
  return { obj, entry }
}

beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-oldbuild-'))
  userData = mkdtempSync(join(realpathSync(tmpdir()), 'torno-oldbuild-data-'))
  // Today's files: the common one has grown since the builds below were kept.
  write(join(root, 'common', 'fillets.py'), 'SIZE = 30\n')
  write(join(root, 'cwd', 'cwd.py'), viaCwd)
  write(join(root, 'path', 'path.py'), viaPath)
  kernel = startKernel({ workspaceRoot: root, hasProject: false, kernelDir: KERNEL_DIR })
  await kernel.ready
}, 90_000)

afterAll(async () => {
  await kernel.dispose()
  rmSync(root, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

const width = (scene: { parts: Array<{ bbox: { min: number[]; max: number[] } }> }): number => scene.parts[0].bbox.max[0] - scene.parts[0].bbox.min[0]

describe('rebuildKept', () => {
  it('draws the size the copy of common/ had, whichever way the model reaches it', async () => {
    for (const [name, model] of [['cwd', viaCwd], ['path', viaPath]] as const) {
      const { obj, entry } = kept(name, { [`${name}/${name}.py`]: model, 'common/fillets.py': 'SIZE = 10\n' })
      const drawn = await rebuildKept(obj, entry, { kernel, userData })
      if ('refused' in drawn) throw new Error(drawn.refused)
      expect(width(drawn.scene)).toBeCloseTo(10)
      expect(drawn.blob.byteLength).toBeGreaterThan(0)
    }
  })

  it('leaves nothing in the workspace and removes its folder once it has answered', async () => {
    const before = readdirSync(root).sort()
    const { obj, entry } = kept('cwd', { 'cwd/cwd.py': viaCwd, 'common/fillets.py': 'SIZE = 12\n' })
    await rebuildKept(obj, entry, { kernel, userData })
    expect(readdirSync(root).sort()).toEqual(before)
    expect(existsSync(join(userData, 'compare')) ? readdirSync(join(userData, 'compare')) : []).toEqual([])
    // Today's build is as it was.
    expect(readdirSync(join(root, 'common'))).toEqual(['fillets.py'])
  })

  it('refuses a build that failed, with a sentence', async () => {
    const { obj, entry } = kept('cwd', {}, { failed: true, error: 'boom' })
    const drawn = await rebuildKept(obj, entry, { kernel, userData })
    expect(drawn).toEqual({ refused: expect.stringMatching(/failed/) })
  })

  it('refuses a build whose copies were not kept', async () => {
    const { obj, entry } = kept('cwd', {})
    const drawn = await rebuildKept(obj, entry, { kernel, userData })
    expect(drawn).toEqual({ refused: expect.stringMatching(/copies/) })
  })

  it('says why the copy does not build', async () => {
    const { obj, entry } = kept('cwd', { 'cwd/cwd.py': 'raise RuntimeError("no thanks")\n' })
    const drawn = await rebuildKept(obj, entry, { kernel, userData })
    expect(drawn).toEqual({ refused: expect.stringContaining('no thanks') })
  })

  it('sweeps what a run that ended badly left', () => {
    write(join(userData, 'compare', 'old-1', 'x.py'), '')
    sweepCompare(userData)
    expect(existsSync(join(userData, 'compare'))).toBe(false)
  })
})
