import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BuildState } from '../../shared/build'
import { Builds } from '../builds'
import { type RunningKernel, startKernel } from '../kernel/client'
import { forgetParamFiles, overrideValues, reconcile } from '../paramsfile'
import { type LayoutPrints, compareBuilds } from './compare'
import { Drives } from './drives'

// What a field of the Params drives, against the real kernel: two fields that drive different faces of one part.

const KERNEL_DIR = resolve(__dirname, '../../../../kernel')
const MODEL = [
  'from dataclasses import dataclass',
  'from build123d import Box, Pos',
  '',
  '@dataclass(frozen=True)',
  'class Params:',
  '    width: float = 40.0',
  '    boss: float = 4.0',
  '    ribs: int = 1',
  '',
  'def assembly(p):',
  '    block = Box(p.width, 20, 5) + Pos(0, 0, 2.5 + p.boss / 2) * Box(6, 6, p.boss)',
  '    for i in range(p.ribs):',
  '        block = block + Pos(0, 7 + 4 * i, -3.5) * Box(2, 1, 2)',
  '    return {"block": block}',
  ''
].join('\n')

let root: string
let kernel: RunningKernel
let builds: Builds

const prints = async (): Promise<LayoutPrints> => (await builds.query<{ parts: LayoutPrints }>('block', 'face_prints', { layout: 'assembly' })).parts

beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-drives-'))
  const dir = join(root, 'block')
  mkdirSync(dir)
  writeFileSync(join(dir, 'block.py'), MODEL)
  kernel = startKernel({ workspaceRoot: root, hasProject: false, kernelDir: KERNEL_DIR })
  builds = new Builds({ kernel, watch: () => () => {}, overrides: { values: overrideValues, reconcile } })
  const first = new Promise<BuildState>((done) => builds.on('build', (s) => s.status === 'ok' && done(s)))
  builds.open({ id: 'block', name: 'block', dir, model: 'block.py' })
  await first
}, 60_000)

afterAll(async () => {
  await kernel.dispose()
  rmSync(root, { recursive: true, force: true })
  forgetParamFiles()
})

describe('what a field drives, in a trial worker', () => {
  it('lights different faces for two fields, and the build on show is the same afterwards', async () => {
    const revision = builds.scene('block')!.revision
    const before = await prints()
    const drives = new Drives(builds)
    const width = await drives.of('block', 'width')
    const boss = await drives.of('block', 'boss')
    if (!width.ok || !boss.ok) throw new Error(JSON.stringify({ width, boss }))
    const wide = width.layouts.assembly
    const tall = boss.layouts.assembly
    expect(wide.parts).toEqual([])
    expect(tall.parts).toEqual([])
    expect(wide.faces.length).toBeGreaterThan(0)
    expect(tall.faces.length).toBeGreaterThan(0)
    expect(wide.faces).not.toEqual(tall.faces)
    // The width moves the ends of the block, never the top of the boss; the boss's height moves its top, never the block's ends.
    const onTop = (ref: string): boolean => before.block[Number(ref.split('/F')[1])].normal?.[2] === 1 && before.block[Number(ref.split('/F')[1])].area < 40
    expect(wide.faces.some(onTop)).toBe(false)
    expect(tall.faces.some(onTop)).toBe(true)
    // A nudge that takes away faces is told as the part.
    const ribs = await drives.of('block', 'ribs')
    expect(ribs.ok && ribs.layouts.assembly.parts.length + ribs.layouts.assembly.faces.length).toBeGreaterThan(0)
    // Nothing of the build on show moved: same revision, same faces.
    expect(builds.scene('block')!.revision).toBe(revision)
    expect(compareBuilds(before, await prints())).toEqual({ faces: [], parts: [] })
  })
})
