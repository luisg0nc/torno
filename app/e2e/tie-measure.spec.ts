import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { BoardFile } from '../src/shared/board'
import type { MarksFile } from '../src/shared/marks'
import type { TornoState } from '../src/renderer/state/store'
import { openListed } from './objects'

// Tying a size of the brief by measuring it on the part (#264): "Measure it on the part" shows the model with Measure in hand and
// the card's head says "Tying 6.4 mm"; T measures the wall, "Keep and tie to the size" keeps and ties it, and the brief reads the
// size's verdict. Esc leaves with no change. On the `gauge` fixture, whose plate is 6 mm thick. The window is hidden.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-tie-measure-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
  await openListed(page, 'gauge')
  await expect.poll(async () => (await state()).build, { timeout: 90_000 }).toMatchObject({ objectId: 'gauge', status: 'ok' })
  await expect.poll(async () => (await state()).scene !== null).toBe(true)
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const readBoard = (): Promise<BoardFile> => page.evaluate(() => window.torno.board.read('gauge'))
const marks = (): MarksFile => {
  try {
    return JSON.parse(readFileSync(join(root, 'gauge', '.torno', 'marks.json'), 'utf8'))
  } catch {
    return { next: 1, marks: [] }
  }
}
const sizeRow = (): Locator => page.locator('.brief-row[data-card]:not(.brief-rule)').first()
const head = (): Locator => page.locator('.route-hand .tying')
const tag = (): Locator => page.locator('.viewport-pane [data-tag="measure"]')
const switchButton = (name: 'Model' | 'Brief'): Locator => page.locator('.pboard-switch').getByRole('button', { name, exact: true })

async function atRest(): Promise<void> {
  let last = ''
  await expect
    .poll(async () => {
      const now = JSON.stringify(await page.evaluate(() => window.__tornoTest!.camera()))
      const still = now === last
      last = now
      return still
    }, { intervals: [120] })
    .toBe(true)
}

/** Over the plate's top: where T reads the wall under the pointer. */
async function pointAtTop(): Promise<void> {
  const [fx, fy] = await page.evaluate(() => window.__tornoTest!.project([-10, 5, 6]))
  const box = (await page.locator('.viewport-canvas canvas').first().boundingBox())!
  await page.mouse.move(box.x + fx * box.width, box.y + fy * box.height)
}

async function openTie(): Promise<void> {
  await expect(sizeRow()).toBeVisible()
  await sizeRow().getByRole('button', { name: /^Tie / }).click()
  await page.getByRole('button', { name: 'Measure it on the part' }).click()
}

test('a size nothing checks is tied by measuring it on the part, and the brief reads its verdict', async () => {
  await page.evaluate(() => window.torno.board.change('gauge', { op: 'add', card: { kind: 'size', x: 0, y: 0, w: 240, h: 60, size: { what: 'plate thickness', value: '6.4', unit: 'mm', source: 'measured' } } }))
  await switchButton('Brief').click()
  await expect(sizeRow()).toContainText('nothing checks this')
  await openTie()

  // The model is shown with Measure in hand, and the head of the card is the size being tied.
  await expect(page.locator('.brief-page')).toHaveCount(0)
  await expect(switchButton('Model')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Measure', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(head()).toContainText('Tying 6.4 mm')
  await expect(head()).toContainText('plate thickness')
  await expect(head().getByLabel('Tolerance')).toHaveValue('0.5')

  await atRest()
  await pointAtTop()
  await page.keyboard.press('t')
  await expect(tag().locator('.measure-reading')).toHaveText('6mm')
  expect(marks().marks).toEqual([])
  await tag().getByRole('button', { name: 'Keep and tie to the size' }).click()

  // Kept as a dimension and tied: the brief is shown, and the size reads what the dimension says.
  await expect(page.locator('.brief-page')).toBeVisible()
  await expect(head()).toHaveCount(0)
  await expect(sizeRow().locator('.brief-verdict')).toContainText('holds')
  const dimension = marks().marks.find((m) => m.kind === 'dimension')!
  expect(dimension).toMatchObject({ expected: 6.4, tolerance: 0.5 })
  const saved = (await readBoard()).cards.find((c) => c.kind === 'size')!
  expect(saved.size?.tie).toEqual({ mark: dimension.id, tolerance: 0.5 })
})

test('Esc leaves tying with no change: the brief comes back and no dimension is kept', async () => {
  await page.evaluate(() => window.torno.board.change('gauge', { op: 'add', card: { kind: 'size', x: 0, y: 80, w: 240, h: 60, size: { what: 'other wall', value: '3', unit: 'mm', source: 'a guess' } } }))
  const before = marks().marks.length
  const row = page.locator('.brief-row[data-card]:not(.brief-rule)').nth(1)
  await row.getByRole('button', { name: /^Tie / }).click()
  await page.getByRole('button', { name: 'Measure it on the part' }).click()
  await expect(head()).toContainText('Tying 3 mm')
  await expect(head().getByLabel('Tolerance')).toHaveValue('2')
  await atRest()
  await pointAtTop()
  await page.keyboard.press('t')
  await expect(tag().locator('.measure-reading')).toHaveText('6mm')
  // The first Esc lets go of the measurement, the second leaves.
  await page.keyboard.press('Escape')
  await expect(tag()).toHaveCount(0)
  await expect(head()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(head()).toHaveCount(0)
  await expect(page.locator('.brief-page')).toBeVisible()
  await expect(page.locator('.brief-row[data-card]:not(.brief-rule)').nth(1)).toContainText('nothing checks this')
  expect(marks().marks.length).toBe(before)
  expect((await readBoard()).cards.filter((c) => c.size?.tie)).toHaveLength(1)
})
