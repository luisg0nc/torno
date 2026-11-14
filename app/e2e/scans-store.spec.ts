import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import type { ScanInfo, ScansFile } from '../src/shared/scans'
import { box, stl } from '../src/test/scanFixtures'
import { openPanel } from './helpers'
import { openListed } from './objects'

// Scans from the window to the files and back: the bridge, the store in main
// that owns <object>/.torno/scans.json and .torno/scans/, and the real import
// process. Nothing draws a scan yet, so everything goes through
// window.torno.scans. The scan is a box made here, in a folder of its own
// outside the workspace.
//
// The window is hidden: state is read through window.__tornoTest.state().
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let downloads: string
let source: string
let app: ElectronApplication
let page: Page
let before: Record<string, string>

test.beforeAll(async () => {
  // A copy: scans are written into the object's folder.
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-scans-'))
  cpSync(fixtures, root, { recursive: true, filter: (from) => !from.endsWith('__pycache__') })
  downloads = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-downloads-'))
  source = join(downloads, 'Box.STL')
  writeFileSync(source, stl(box([40, 30, 5])))
  before = bracketFiles()
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root }
  })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  await openListed(page, 'bracket')
  await openPanel(page, 'Scans')
  await expect.poll(async () => (await state()).scene?.parts.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(0)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(downloads, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const scansFolder = (): string => join(root, 'bracket', '.torno', 'scans')
const scansOnDisk = (): ScansFile => JSON.parse(readFileSync(join(root, 'bracket', '.torno', 'scans.json'), 'utf8'))

/** Every file of the bracket outside .torno/, with its contents. */
function bracketFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (prefix === '' && name === '.torno') continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`)
      else files[`${prefix}${name}`] = readFileSync(path, 'base64')
    }
  }
  walk(join(root, 'bracket'), '')
  return files
}

type Refused = 'relative' | 'ghost' | 'unknown' | 'unreadable' | 'nowhere' | 'otherBuild' | 'noBuild' | 'rough'

/** What a call through the bridge rejected with, or null when it did not. */
function rejection(which: Refused, path = ''): Promise<string | null> {
  return page.evaluate(
    ({ which, path }) => {
      const identity = { transform: { t: [0, 0, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number], s: 1 }, steps: ['typed' as const] }
      const calls: Record<string, () => Promise<unknown>> = {
        relative: () => window.torno.scans.import('bracket', 'relative.stl'),
        ghost: () => window.torno.scans.list('ghost'),
        unknown: () => window.torno.scans.rename('bracket', 'S9', 'x'),
        unreadable: () => window.torno.scans.import('bracket', path),
        nowhere: () => window.torno.scans.align('bracket', 'S1', 'nowhere', identity, { revision: window.__tornoTest!.state().revision, rough: true }),
        otherBuild: () => window.torno.scans.align('bracket', 'S1', window.__tornoTest!.state().layout, identity, { revision: window.__tornoTest!.state().revision + 1, rough: true }),
        // Against the bridge's type, which asks for it: what main does with a caller that leaves it out.
        noBuild: () => (window.torno.scans.align as unknown as (...args: unknown[]) => Promise<unknown>)('bracket', 'S1', window.__tornoTest!.state().layout, identity),
        rough: () => window.torno.scans.align('bracket', 'S1', window.__tornoTest!.state().layout, { ...identity, steps: ['pairs'], pairs: [{ scan: [0, 0, 0], model: [0, 0, 0], residual: 0 }, { scan: [9, 0, 0], model: [9, 0, 0], residual: 0 }] }, { revision: window.__tornoTest!.state().revision })
      }
      return calls[which]().then(
        () => null,
        (e: Error) => e.message
      )
    },
    { which, path }
  )
}

test('the file to import is asked of main, which under test opens no dialog', async () => {
  expect(await page.evaluate(() => window.torno.scans.pick())).toBeNull()
  await app.evaluate((_electron, path) => void ((globalThis as unknown as { __tornoMain: { pickFile: string | null } }).__tornoMain.pickFile = path), source)
  expect(await page.evaluate(() => window.torno.scans.pick())).toBe(source)
  expect(await app.evaluate(() => (globalThis as unknown as { __tornoMain: { filePicks: number } }).__tornoMain.filePicks)).toBe(2)
})

test('a file is imported by the real process, told as it goes, and its mesh comes back whole', async () => {
  test.setTimeout(120_000)
  const original = readFileSync(source)
  const said = await page.evaluate(async (path) => {
    const told: string[] = []
    const offProgress = window.torno.scans.onProgress((m) => told.push(`${m.objectId} ${m.name}: ${m.stage}`))
    const offChanged = window.torno.scans.onChanged((m) => told.push(`${m.objectId}: ${m.scans.map((s) => s.id).join(' ')}`))
    const scan = await window.torno.scans.import('bracket', path)
    const mesh = await window.torno.scans.mesh('bracket', scan.id)
    offProgress()
    offChanged()
    return { scan, told, bytes: mesh.byteLength, magic: new TextDecoder().decode(new Uint8Array(mesh, 0, 8)), list: await window.torno.scans.list('bracket') }
  }, source)

  expect(said.scan).toMatchObject({
    id: 'S1',
    name: 'Box.STL',
    source: { path: source, bytes: original.byteLength },
    imported: { unit: 'mm', up: 'z', assumed: { unit: true, up: true }, vertices: 8, triangles: 12, colours: 'none', bbox: { min: [-20, -15, -2.5], max: [20, 15, 2.5] } },
    alignments: {},
    sourceState: 'present',
    meshState: 'ok',
    checks: {}
  })
  expect(said.scan.source.sha256).toMatch(/^[0-9a-f]{64}$/)
  expect(said.list).toEqual([said.scan])
  // The stages the process named, that it ended, and then the scan.
  expect(said.told.slice(0, -2).every((line) => /^bracket Box\.STL: [a-z]+$/.test(line))).toBe(true)
  expect(said.told).toContain('bracket Box.STL: reading')
  expect(said.told.slice(-2)).toEqual(['bracket Box.STL: null', 'bracket: S1'])
  expect(said.magic).toBe('TORNOSCN')
  expect(said.bytes).toBe(64 + 8 * 12 + 12 * 12)

  expect(scansOnDisk()).toMatchObject({ next: 2, scans: [{ id: 'S1' }] })
  expect(readdirSync(scansFolder()).sort()).toEqual(['.gitignore', 'S1'])
  expect(readdirSync(join(scansFolder(), 'S1'))).toEqual(['mesh.bin'])
  // The source is as it was, alone in its folder, and nothing of the object but .torno/ was written.
  expect(readFileSync(source).equals(original)).toBe(true)
  expect(readdirSync(downloads)).toEqual(['Box.STL'])
  expect(bracketFiles()).toEqual(before)
  expect(existsSync(join(root, 'bracket', '__pycache__'))).toBe(false)
})

test('what cannot be done is refused in plain words', async () => {
  expect(await rejection('relative')).toBe('give the whole path of the file')
  expect(await rejection('ghost')).toBe('no project named ghost in the open workspace')
  expect(await rejection('unknown')).toBe('no scan S9; scans: S1')
  // What the import process itself says of a file it cannot read.
  mkdirSync(join(downloads, 'more'))
  const cloud = join(downloads, 'more', 'cloud.ply')
  writeFileSync(cloud, 'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n')
  const unreadable = await rejection('unreadable', cloud)
  expect(unreadable).toContain('cloud.ply')
  // In the process's own words: it ran, and answered.
  expect(unreadable).not.toMatch(/could not be started|without an answer/)
  // Its id is not given again, and nothing of it is left.
  expect(scansOnDisk()).toMatchObject({ next: 3, scans: [{ id: 'S1' }] })
  expect(readdirSync(scansFolder()).sort()).toEqual(['.gitignore', 'S1'])
})

test('an alignment is kept with how the layout was spread, and dropped when the unit is changed', async () => {
  test.setTimeout(120_000)
  const layout = (await state()).scene!.layouts[0]
  const parts = (await state()).scene!.parts.filter((part) => part.layout === layout).map((part) => part.name)
  const aligned = await page.evaluate(
    ({ layout }) => window.torno.scans.align('bracket', 'S1', layout, { transform: { t: [1, 2, 3], q: [0, 0, 0, 2], s: 1 }, steps: ['typed'] }, { revision: window.__tornoTest!.state().revision, rough: true }),
    { layout }
  )
  const alignment = aligned.alignments[layout]
  expect(alignment.transform).toEqual({ t: [1, 2, 3], q: [0, 0, 0, 1], s: 1 })
  expect(Object.keys(alignment.frame).sort()).toEqual([...parts].sort())
  expect(Number.isNaN(Date.parse(alignment.at))).toBe(false)
  expect(scansOnDisk().scans[0].alignments[layout]).toEqual(alignment)
  expect(await rejection('nowhere')).toBe('no build of this project has a layout named nowhere: there is nothing to align the scan to')
  // Task 5: an alignment is of the build it was made on, and one that is rough is kept only with a yes; what main says of it is main's.
  const revision = (await state()).revision
  expect(await rejection('otherBuild')).toBe(`that alignment was made on r${revision + 1}, the build is r${revision}: align again`)
  expect(await rejection('noBuild')).toBe('an alignment says which build it was made on')
  // Fix round 1 (R-basis): rough is a doubtful fit of pairs; a scan placed by hand is kept as that, and says so.
  expect(await rejection('rough')).toBe('this alignment is rough (it has 2 pairs of points: it takes three that are not in a line to fix a scan): it is kept only once that is accepted')
  expect(alignment).toMatchObject({ revision, steps: ['typed'], before: null })
  expect(alignment).not.toHaveProperty('rough')

  const converted: ScanInfo = await page.evaluate(() => window.torno.scans.convert('bracket', 'S1', { unit: 'cm', up: 'z' }))
  expect(converted).toMatchObject({ imported: { unit: 'cm', up: 'z', assumed: { unit: false, up: false }, triangles: 12, bbox: { min: [-200, -150, -25], max: [200, 150, 25] } }, alignments: {} })
  expect(scansOnDisk().scans[0].alignments).toEqual({})
  // The mesh that was converted is another file, which the record names; the one it was made from is gone.
  expect(converted.imported.mesh).toMatch(/^mesh\.\d+\.bin$/)
  expect(readdirSync(join(scansFolder(), 'S1'))).toEqual([converted.imported.mesh])
  const bytes = await page.evaluate(async () => (await window.torno.scans.mesh('bracket', 'S1')).byteLength)
  expect(bytes).toBe(64 + 8 * 12 + 12 * 12)
  expect(readFileSync(join(scansFolder(), '.gitignore'), 'utf8')).toBe('mesh*.bin\n')
})

test('a scan whose mesh is not there is read again from its source, into the same scan', async () => {
  test.setTimeout(120_000)
  // As in a clone: the record is committed, the mesh is not.
  rmSync(join(scansFolder(), 'S1'), { recursive: true })
  expect((await page.evaluate(() => window.torno.scans.list('bracket')))[0].meshState).toBe('missing')
  const again = await page.evaluate(() => window.torno.scans.reimport('bracket', 'S1'))
  expect(again).toMatchObject({ sourceChanged: false, meshChanged: false, scan: { id: 'S1', meshState: 'ok', imported: { unit: 'cm', bbox: { max: [200, 150, 25] } } } })
  expect(again.scan.imported.mesh).toMatch(/^mesh\.\d+\.bin$/)
  expect(readdirSync(join(scansFolder(), 'S1'))).toEqual([again.scan.imported.mesh])
  expect(scansOnDisk()).toMatchObject({ next: 3, scans: [{ id: 'S1' }] })
})

test('a scans file that cannot be read is said to the window, until it is dismissed there', async () => {
  // In an object that is not open yet: its scans are first read when it is.
  mkdirSync(join(root, 'hollow', '.torno'), { recursive: true })
  writeFileSync(join(root, 'hollow', '.torno', 'scans.json'), '{"next": 4, "scans": [')
  await openListed(page, 'hollow')
  await openPanel(page, 'Scans')
  const problem = page.locator('[data-part="problem"]')
  await expect(problem).toContainText('The scans file of this project could not be read')
  await expect(problem).toContainText('still in .torno/scans/')
  expect(await page.evaluate(() => window.torno.scans.problem('hollow'))).toContain('scans.json.corrupt-')
  await problem.getByRole('button', { name: 'Dismiss' }).click()
  await expect(problem).toHaveCount(0)
  expect(await page.evaluate(() => window.torno.scans.problem('hollow'))).toBeNull()
  await openListed(page, 'bracket')
  await openPanel(page, 'Scans')
  await expect.poll(async () => (await state()).objectId).toBe('bracket')
})

test('a scan that is removed leaves its source, and its number is not given again', async () => {
  await page.evaluate(() => window.torno.scans.remove('bracket', 'S1'))
  expect(await page.evaluate(() => window.torno.scans.list('bracket'))).toEqual([])
  expect(existsSync(join(scansFolder(), 'S1'))).toBe(false)
  expect(scansOnDisk()).toEqual({ next: 3, scans: [] })
  expect(existsSync(source)).toBe(true)
  expect(bracketFiles()).toEqual(before)
})
