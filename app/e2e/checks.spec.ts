import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { cardSection, openSection } from './helpers'
import { openListed } from './objects'

// The checks a model declares in its checks(p): measured by the kernel at every build, listed in the left column
// under Parameters (folded to a title that says how many fail), and, when the agent makes one easier to pass, said
// under the rows. The model is written into the test's own copy of the fixtures.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

test.describe.configure({ mode: 'serial' })

const MODEL = (walls: number): string => `from dataclasses import dataclass
from build123d import Box, Pos

@dataclass(frozen=True)
class Params:
    gap: float = 0.1

def assembly(p):
    return {"tub": Box(20, 20, 10), "lid": Pos(20 + p.gap, 0, 0) * Box(20, 20, 10)}

def checks(p):
    return [
        {"name": "lid fits the tub", "kind": "clearance", "a": "lid", "b": "tub", "min": 0.15, "max": 0.25},
        {"name": "walls", "kind": "thin", "a": "tub", "min": ${walls}},
    ]
`

let root: string
let model: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-checks-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  mkdirSync(join(root, 'lidded'))
  model = join(root, 'lidded', 'lidded.py')
  writeFileSync(model, MODEL(1.2))
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const section = () => page.locator('.left .checks')
const said = () => cardSection(page, 'Checks').locator('.route-said')

async function open(name: string): Promise<void> {
  await openListed(page, name)
  await expect.poll(async () => { const s = await state(); return s.objectId === name && s.build?.status }, { timeout: 30_000 }).toBe('ok')
}

test('a model with no checks says so in the head of its section, which does not unfold', async () => {
  await open('plain')
  await openSection(page, 'Parts')
  await expect(page.locator('.left .layers')).toBeVisible()
  await cardSection(page, 'Checks').scrollIntoViewIfNeeded()
  await expect(cardSection(page, 'Checks')).toContainText('none')
  await expect(cardSection(page, 'Checks')).toHaveAttribute('data-empty', '')
  await expect(section()).toHaveCount(0)
})

test('a check that fails does not fail the build, and is told in the head of its section', async () => {
  await open('lidded')
  await openSection(page, 'Checks')
  await expect(section()).toBeVisible()
  // The checks are a section of their own, after the Parameters and before the Marks.
  const order = await page.locator('.left .route-section').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')))
  expect(order.indexOf('checks')).toBe(order.indexOf('params') + 1)
  expect(order.indexOf('marks')).toBe(order.indexOf('checks') + 1)
  await expect(said()).toHaveText('2, 1 fails')
  // The head's ring says it waits, and what waits on the person is in Needs you.
  await expect(cardSection(page, 'Checks')).toHaveAttribute('data-needs', '')
  await expect(cardSection(page, 'Needs you').locator('.route-said')).toHaveText('1 waiting')
})

test('it has a row for each check: how it stands in a word, what was measured and what was wanted', async () => {
  await openSection(page, 'Checks')
  await expect(section().locator('[data-check]')).toHaveCount(2)
  const fits = section().locator('[data-check="lid fits the tub"]')
  await expect(fits).toHaveAttribute('data-standing', 'fails')
  await expect(fits.locator('.check-standing')).toHaveText('fails')
  await expect(fits.locator('.check-detail')).toContainText('0.1 mm')
  await expect(fits.locator('.check-detail')).toContainText('wanted 0.15 to 0.25 mm')
  // Its gauge says it in words, and a failing row has the failure's wash.
  await expect(fits.locator('.gauge')).toHaveAttribute('aria-label', /outside 0\.15 to 0\.25$/)
  await expect(fits).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // Failing first.
  await expect(section().locator('.check-row').first()).toHaveAttribute('data-check', 'lid fits the tub')
  const walls = section().locator('[data-check="walls"]')
  await expect(walls).toHaveAttribute('data-standing', 'passes')
  // A thin wall is found by sampling, and the row says so.
  await expect(walls.locator('.check-detail')).toContainText('found by sampling')
  await expect(section().locator('.check-notes')).toHaveCount(0)
})

test('the agent making a check easier to pass is said under the rows', async () => {
  writeFileSync(model, MODEL(0.6))
  await expect(section().locator('.check-notes')).toBeVisible({ timeout: 30_000 })
  await expect(section().locator('.check-notes li')).toHaveText(['walls: min 1.2 → 0.6 mm (since r2)'])
})
