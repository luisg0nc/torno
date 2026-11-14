import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { REFERENCE_COLOR } from '../src/shared/palette'
import { openPanel } from './helpers'
import { openListed } from './objects'

// A bought part the model puts among its references(p) (a bd_warehouse bearing): in the layers list with the tag
// "bought" and a neutral swatch, and in the assembly only.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-references-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())

test('a reference is listed as bought, in a neutral tone, in the assembly and not on the bed', async () => {
  await openListed(page, 'housing608')
  await expect.poll(async () => { const s = await state(); return s.objectId === 'housing608' && s.build?.status }, { timeout: 60_000 }).toBe('ok')
  const s = await state()
  expect(s.scene!.parts.filter((p) => p.role === 'reference').map((p) => `${p.layout}:${p.name}`)).toEqual(['assembly:608'])
  expect(s.scene!.parts.filter((p) => p.layout === 'print').map((p) => p.name)).toEqual(['housing', 'cap'])
  await openPanel(page, 'Layers')
  const row = page.locator('[data-layer="608"]')
  await expect(row.locator('.layer-bought')).toHaveText('bought')
  await expect(row.locator('.swatch')).toHaveCSS('background-color', hex(REFERENCE_COLOR))
  await expect(page.locator('[data-layer="housing"] .layer-bought')).toHaveCount(0)
})

function hex(color: string): string {
  const n = parseInt(color.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
