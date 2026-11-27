import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { png } from '../src/test/pngFixtures'
import { newSession, showBrief, showModel } from './helpers'
import { newFromList, openListed } from './objects'

// A menu of the title bar, opened while a sheet is up (the Brief's picture opened large, the ink pad and the reduced
// sheet of a view note): it is drawn over the sheet, and an Escape with the focus in it is the menu's; the next one is
// the sheet's. The window is hidden: everything is read from the DOM and the store.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-titlemenus-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  writeFileSync(join(root, 'bracket', 'brief.md'), '# bracket\n\nHolds the lid shut.\n\n## References\n\n- reference/photo-1.png: the old part\n')
  mkdirSync(join(root, 'bracket', 'reference'))
  writeFileSync(join(root, 'bracket', 'reference', 'photo-1.png'), png(40, 30))
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  rmSync(root, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const folderButton =(): Locator => page.locator('.title-row').getByRole('button', { name: /^Folder / })
const projectButton = (): Locator => page.locator('.title-row').getByRole('button', { name: /^Project / })

/** Whether a menu is the topmost thing over the whole of its box: sampled in a grid, just inside its rounded edge. */
const seenWhole = (menu: Locator): Promise<boolean> =>
  menu.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const along = (from: number, to: number): number[] => [0, 0.25, 0.5, 0.75, 1].map((t) => from + 4 + t * (to - from - 8))
    return along(box.left, box.right).every((x) => along(box.top, box.bottom).every((y) => el.contains(document.elementFromPoint(x, y))))
  })

/** Opens a menu of the title bar over a sheet: it is seen whole, an Escape closes it and leaves the sheet, the next one is the sheet's. */
async function menuFirst(button: Locator, name: 'Folders' | 'Projects', sheet: Locator, after: () => Promise<void>): Promise<void> {
  await button.click()
  const menu = page.getByRole('menu', { name })
  await expect(menu.getByRole('menuitem').first()).toBeVisible()
  expect(await seenWhole(menu)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(button).toBeFocused()
  await expect(sheet).toBeVisible()
  // With the menu gone, the next Escape is the sheet's, wherever the focus is.
  await page.keyboard.press('Escape')
  await after()
}

test('over a Brief picture opened large, Escape closes a title bar menu first, then the picture', async () => {
  await openListed(page, 'bracket')
  await showBrief(page)
  for (const [button, name] of [[folderButton(), 'Folders'], [projectButton(), 'Projects']] as const) {
    await page.getByRole('button', { name: 'Open photo-1.png large' }).click()
    const picture = page.locator('.pboard-view')
    await expect(picture).toBeVisible()
    await menuFirst(button, name, picture, () => expect(picture).toHaveCount(0))
  }
})

test('over the sheet of "Draw on view", a title bar menu is seen whole and Escape closes it first; the same over a note whose picture is gone', async () => {
  await openListed(page, 'bracket')
  await showModel(page)
  await expect.poll(async () => (await state()).build, { timeout: 30_000 }).toMatchObject({ status: 'ok' })
  const dock = page.locator('[data-region="session"]')
  await newSession(dock)
  await expect(dock.locator('[data-chat-composer]')).toBeEnabled()
  const drawing = page.getByRole('dialog', { name: 'Drawing on the view' })
  for (const [button, name] of [[folderButton(), 'Folders'], [projectButton(), 'Projects']] as const) {
    await dock.getByRole('button', { name: 'Draw on view' }).click()
    await expect(drawing).toBeVisible()
    await menuFirst(button, name, drawing, () => expect(drawing).toHaveCount(0))
  }

  // A note with a comment alone, then its plain picture taken from the disk: it reopens as the reduced sheet.
  await dock.getByRole('button', { name: 'Draw on view' }).click()
  await drawing.getByRole('textbox', { name: 'Comment' }).fill('thicker')
  await drawing.getByRole('button', { name: 'Done' }).click()
  await expect(drawing).toHaveCount(0)
  const note = (await state()).marks.find((m) => m.kind === 'note')!
  rmSync(join(root, 'bracket', '.torno', 'notes'), { recursive: true })
  const reduced = page.getByRole('dialog', { name: 'Editing the view note' })
  await page.evaluate((id) => window.__tornoTest!.openNote('bracket', id), note.id)
  await expect(reduced).toBeVisible()
  await menuFirst(projectButton(), 'Projects', reduced, () => expect(reduced).toHaveCount(0))
})

test('over the doodle board of a new project, the folder menu is seen whole and Escape closes it first, then the board', async () => {
  await newFromList(page)
  await page.getByRole('button', { name: /^Sketch it/ }).click()
  const board = page.getByRole('dialog', { name: 'Doodle board' })
  await expect(board).toBeVisible()
  await menuFirst(folderButton(), 'Folders', board, () => expect(board).toHaveCount(0))
})
