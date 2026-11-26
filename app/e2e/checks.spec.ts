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
const section = () => page.locator('.brief-page .section.checks')
const said = () => cardSection(page, 'Checks').locator('.brief-said')

async function open(name: string): Promise<void> {
  await openListed(page, name)
  await expect.poll(async () => { const s = await state(); return s.objectId === name && s.build?.status }, { timeout: 30_000 }).toBe('ok')
}

test('a model with no checks says so in the head of its block on the Brief page, and the block has no rows', async () => {
  await open('plain')
  await expect(page.locator('.left .layers')).toBeVisible()
  await openSection(page, 'Checks')
  await expect(cardSection(page, 'Checks')).toContainText('none')
  await expect(section()).toHaveCount(0)
})

test('a check that fails does not fail the build, and is told in the head of its block on the Brief page', async () => {
  await open('lidded')
  await openSection(page, 'Checks')
  await expect(section()).toBeVisible()
  // The checks are a block of the Brief page, after the sizes and before the marks; the left column holds the bench alone.
  const order = await page.locator('.brief-page [data-section]').evaluateAll((els) => els.map((el) => el.getAttribute('data-section')))
  expect(order.indexOf('marks')).toBe(order.indexOf('checks') + 1)
  await expect(page.locator('.left .route-section')).toHaveCount(0)
  await expect(said()).toHaveText('2 checks, 1 fails')
  // The block says it waits, and what waits on the person is a row of the On block.
  await expect(cardSection(page, 'Checks')).toHaveAttribute('data-needs', '')
  await expect(page.locator('[data-region="left"] .on-block .on-head .on-said')).toHaveText('1 check fails, 1 pass')
  // The build on show is named in words, as the builds timeline names it; its history id is in the title only.
  const head = page.locator('[data-region="left"] .on-block .on-head')
  await expect(head.locator('.on-name')).toHaveText(/^Latest build( · .+)?$/)
  await expect(head).toHaveAttribute('title', /^h\d+/)
  await expect(head).not.toContainText(/\bh\d+\b/)
  await expect(page.locator('[data-region="left"] .on-block .on-row[data-kind="check"]')).toHaveCount(1)
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
