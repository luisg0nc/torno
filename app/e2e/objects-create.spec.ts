import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

// Making an object from the bridge: main's half of onboarding. The folder is made in a temporary copy of the
// fixture workspace, the workspace lists the object when the call answers, and the kernel builds the template.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

test.describe.configure({ mode: 'serial' })

let root: string
let files: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-create-'))
  cpSync(fixtures, root, { recursive: true, filter: (from) => !from.endsWith('__pycache__') })
  files = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-create-files-'))
  writeFileSync(join(files, 'desk.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]))
  writeFileSync(join(files, 'datasheet.pdf'), '%PDF-1.7\n1 0 obj\n')
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(files, { recursive: true, force: true })
})

test('the photo dialog is answered by the test hook', async () => {
  await app.evaluate(() => {
    ;(globalThis as unknown as { __tornoMain: { pickPhotos: string[] } }).__tornoMain.pickPhotos = ['/a/b.png']
  })
  expect(await page.evaluate(() => window.torno.objects.pickPhotos())).toEqual(['/a/b.png'])
  expect(await app.evaluate(() => (globalThis as unknown as { __tornoMain: { photoPicks: number } }).__tornoMain.photoPicks)).toBe(1)
})

test('the PDF dialog is answered by the test hook', async () => {
  await app.evaluate(() => {
    ;(globalThis as unknown as { __tornoMain: { pickPdf: string | null } }).__tornoMain.pickPdf = '/a/b.pdf'
  })
  expect(await page.evaluate(() => window.torno.objects.pickPdf())).toBe('/a/b.pdf')
  expect(await app.evaluate(() => (globalThis as unknown as { __tornoMain: { pdfPicks: number } }).__tornoMain.pdfPicks)).toBe(1)
})

test('create makes the folder, lists the object when it answers, and the kernel builds the template', async () => {
  const req = {
    name: 'cable-clip',
    description: 'A clip for a 6 mm cable.',
    photos: [{ path: join(files, 'desk.png'), note: 'the desk edge' }],
    doodles: [{ png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), note: 'the shape' }],
    steps: [],
    scans: [],
    objects: [{ id: 'plain', note: 'same style' }],
    sizes: [{ what: 'cable', value: 'Ø6', unit: 'mm' as const, source: 'measured' as const }],
    rules: '',
    links: [],
    pdfs: [{ path: join(files, 'datasheet.pdf'), note: 'the cable' }]
  }
  const made = await page.evaluate((r) => window.torno.objects.create(r), req)
  expect(made).toEqual({ objectId: 'cable-clip' })
  // At once: no waiting for a file event.
  const listed = await page.evaluate(() => window.torno.workspace.current())
  expect(listed?.objects.map((o) => o.id)).toContain('cable-clip')

  const dir = join(root, 'cable-clip')
  expect(readdirSync(dir).sort()).toEqual(['.torno', 'brief.md', 'cable_clip.py', 'reference'])
  expect(readdirSync(join(dir, 'reference')).sort()).toEqual(['datasheet.pdf', 'doodle-1.png', 'photo-1.png'])
  // The board is in the folder as made: frames for what was given, the PDF and the size among them, and nothing else of .torno.
  const board = JSON.parse(readFileSync(join(dir, '.torno', 'board', 'board.json'), 'utf8')) as { cards: Array<{ kind: string; name?: string; source?: string; size?: { what: string }; caption?: string }> }
  expect(board.cards.filter((c) => c.kind === 'frame').map((c) => c.name)).toEqual(['Brief', 'Photos', 'Sketches', 'Sizes', 'PDFs'])
  expect(board.cards.find((c) => c.kind === 'size')?.size?.what).toBe('cable')
  expect(board.cards.find((c) => c.source === 'reference/datasheet.pdf')?.caption).toBe('the cable')
  expect(readdirSync(join(dir, '.torno'))).toEqual(['board'])
  expect(readdirSync(join(dir, '.torno', 'board'))).toEqual(['board.json'])
  const brief = readFileSync(join(dir, 'brief.md'), 'utf8')
  for (const part of ['the desk edge', 'the shape', 'same style', '../plain/']) expect(brief).toContain(part)
  expect(readdirSync(root).filter((n) => n.startsWith('.'))).toEqual([])

  // The window's list is Task 3's; main opens it as the window will.
  await page.evaluate(() => {
    const w = window as unknown as { scenes: Array<{ objectId: string; parts: string[] }> }
    w.scenes = []
    window.torno.object.onScene((m) => w.scenes.push({ objectId: m.objectId, parts: m.scene.parts.map((p) => p.key) }))
    return window.torno.object.open('cable-clip')
  })
  await expect.poll(() => page.evaluate(() => (window as unknown as { scenes: unknown[] }).scenes), { timeout: 20_000 }).toEqual([{ objectId: 'cable-clip', parts: ['assembly:placeholder'] }])
})

test('create refuses a folder that is there, in any case, and an object that is not', async () => {
  const base = { description: 'x', photos: [], doodles: [], steps: [], scans: [], objects: [], sizes: [], rules: '', links: [], pdfs: [] }
  const refused = (r: object) => page.evaluate((req) => window.torno.objects.create(req as never).then(() => 'made', (e: Error) => e.message), r)
  expect(await refused({ ...base, name: 'Cable-Clip' })).toMatch(/there already/)
  expect(await refused({ ...base, name: 'bracket' })).toMatch(/there already/)
  expect(await refused({ ...base, name: 'fresh', objects: [{ id: 'nope', note: '' }] })).toMatch(/nope/)
  expect(existsSync(join(root, 'fresh'))).toBe(false)
  expect(readdirSync(root).filter((n) => n.startsWith('.'))).toEqual([])
})
