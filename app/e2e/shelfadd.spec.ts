import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { benchTab, newSession as fromDock, openSection } from './helpers'
import { openListed } from './objects'

// Adding a part by hand (#355): files dropped on the Shelf tab open a short form, "Ask Claude to put it on the shelf" puts the request in the box with
// nothing copied, and the files are copied into common/parts/<id>/ when the message that names the folder is sent. The agent is the stand-in.
//
// A drop needs a File with a place on the disk (webUtils.getPathForFile): a File made in the page has none. The files here come from a file input given
// real paths (Playwright's setInputFiles), whose File objects are put in a DataTransfer and dropped by events the page dispatches.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

test.describe.configure({ mode: 'serial' })

let root: string
let home: string
let from: string
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-shelfadd-'))
  home = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-shelfadd-home-'))
  from = mkdtempSync(join(realpathSync(tmpdir()), 'torno-e2e-shelfadd-from-'))
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  // A picture, a datasheet and a STEP, each a plain file the person has somewhere else.
  writeFileSync(join(from, 'drawing.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  writeFileSync(join(from, 'MTS-101 sheet.pdf'), '%PDF-1.4\n% a datasheet\n')
  writeFileSync(join(from, 'body.step'), 'ISO-10303-21;\nEND-ISO-10303-21;\n')
  writeFileSync(join(from, 'notes.txt'), 'not a kind the shelf takes')
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, HOME: home, TORNO_TEST: '1', TORNO_AGENT_CMD: `node ${fakeAgent}`, TORNO_WORKSPACE: root } })
  page = await app.firstWindow()
  await page.waitForSelector('[data-region="viewport"]')
})

test.afterAll(async () => {
  await app?.close()
  for (const dir of [root, home, from]) rmSync(dir, { recursive: true, force: true })
})

const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
const dock = () => page.locator('[data-region="session"]')
const composer = () => dock().locator('[data-chat-composer]')
const turns = () => dock().locator('.chat .chat-turn')
const tab = () => page.locator('.left .shelf-tab')
const form = () => tab().locator('[data-add-part]')
const partDir = (id: string) => join(root, 'common', 'parts', id)
const names = (id: string) => (existsSync(partDir(id)) ? readdirSync(partDir(id)).sort() : null)

/** The files, as a DataTransfer of File objects that have a path: through a file input the page has been given real files for. */
async function carried(...files: string[]) {
  await page.evaluate(() => {
    document.getElementById('e2e-files')?.remove()
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.id = 'e2e-files'
    document.body.append(input)
  })
  await page.setInputFiles('#e2e-files', files.map((f) => join(from, f)))
  return page.evaluateHandle(() => {
    const dt = new DataTransfer()
    for (const file of (document.getElementById('e2e-files') as HTMLInputElement).files!) dt.items.add(file)
    return dt
  })
}

async function over(dt: Awaited<ReturnType<typeof carried>>, type: 'dragover' | 'drop' | 'dragleave'): Promise<boolean> {
  return page.evaluate(([d, kind]) => {
    const event = new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: d as DataTransfer })
    document.querySelector('.left .shelf-tab')!.dispatchEvent(event)
    return event.defaultPrevented
  }, [dt, type] as const)
}

async function drop(...files: string[]): Promise<void> {
  const dt = await carried(...files)
  expect(await over(dt, 'dragover')).toBe(true)
  expect(await over(dt, 'drop')).toBe(true)
}

test('a drag over the tab shows the drop, a drag of a shelf row or of text is not taken, and leaving puts the drop away', async () => {
  await openListed(page, 'hollow')
  await expect.poll(async () => { const s = await state(); return s.objectId === 'hollow' && s.build?.status }, { timeout: 30_000 }).toBe('ok')
  await expect(benchTab(page, 'Shelf')).toHaveText(/^Shelf\s*1$/)
  await openSection(page, 'Shelf')
  await expect(tab()).toBeVisible()
  await fromDock(dock())
  await expect(composer()).toBeEnabled()

  const dt = await carried('drawing.png')
  expect(await over(dt, 'dragover')).toBe(true)
  await expect(tab().locator('.shelf-drop')).toBeVisible()
  await expect(tab().locator('.shelf-drop')).toContainText('Drop a datasheet, STEP or photo')
  await over(dt, 'dragleave')
  await expect(tab().locator('.shelf-drop')).toHaveCount(0)
  // A row's own drag carries its id under a type of torno's own, never a file: nothing is taken.
  const row = await page.evaluateHandle(() => {
    const d = new DataTransfer()
    d.setData('application/x-torno-shelf-part', 'ec11')
    return d
  })
  expect(await over(row, 'dragover')).toBe(false)
  expect(await over(row, 'drop')).toBe(false)
  await expect(tab().locator('.shelf-drop')).toHaveCount(0)
  await expect(form()).toHaveCount(0)
})

test('files of the wrong kind are said and nothing opens; with a good one among them the form opens with the good ones', async () => {
  await drop('notes.txt')
  await expect(form()).toHaveCount(0)
  await expect(tab().locator('[data-part="shelf-said"]')).toHaveText('notes.txt is not a PDF, a picture (png, jpg, webp) or a STEP file.')
  await drop('notes.txt', 'drawing.png', 'MTS-101 sheet.pdf')
  await expect(form()).toBeVisible()
  await expect(form().locator('.add-back')).toHaveText('New part, from 2 files you dropped')
  await expect(form().locator('[data-part="add-said"]')).toHaveText('notes.txt is not a PDF, a picture (png, jpg, webp) or a STEP file.')
  // A picture is shown, a PDF is a tile with its ending; each by the name it will have.
  await expect(form().locator('.add-file[data-file="drawing.png"] img')).toBeVisible()
  await expect(form().locator('.add-file[data-file="MTS-101_sheet.pdf"] .add-ending')).toHaveText('PDF')
  await expect(form().locator('.add-file-name')).toHaveText(['drawing.png', 'MTS-101_sheet.pdf'])
  // The name is made from the first file's, in mono.
  const name = form().getByLabel('Name', { exact: true })
  await expect(name).toHaveValue('drawing')
  expect(await name.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Mono')
  await expect(form().locator('.add-note')).toContainText('torno copies your files into common/parts/drawing/ when you send the request. You see the request in the box first.')
})

test('Back leaves the form and writes nothing; Escape does the same', async () => {
  await form().locator('.add-back').click()
  await expect(form()).toHaveCount(0)
  expect(names('drawing')).toBeNull()
  expect(existsSync(join(root, 'common', 'parts', 'drawing'))).toBe(false)
  await drop('drawing.png')
  await expect(form()).toBeVisible()
  await form().getByLabel('What is it').focus()
  await page.keyboard.press('Escape')
  await expect(form()).toHaveCount(0)
  await expect(tab().locator('.shelf-row[data-part="ec11"]')).toBeVisible()
})

test('the name is checked as it is typed: an identifier, and not a part on the shelf; a half-filled size holds the button back', async () => {
  await drop('drawing.png', 'MTS-101 sheet.pdf')
  const name = form().getByLabel('Name', { exact: true })
  const ask = form().locator('[data-part="add-ask"]')
  const help = form().locator('[data-part="add-name-help"]')
  await name.fill('mts-101')
  await expect(help).toContainText('lower-case')
  await expect(ask).toBeDisabled()
  await name.fill('ec11')
  await expect(help).toHaveText('ec11 is already on the shelf.')
  await expect(ask).toBeDisabled()
  await name.fill('')
  await expect(help).toHaveText('Give the part a name.')
  await name.fill('mts_101')
  await expect(help).toContainText('common/parts/')
  await expect(ask).toBeEnabled()
  // A size with a name and no value is half filled.
  await form().getByLabel('What size 1 measures').fill('panel hole')
  await expect(ask).toBeDisabled()
  await expect(form().locator('#add-hold')).toHaveText('Finish or clear the size that is half filled.')
  await form().getByLabel('Value of size 1').fill('Ø 6.2')
  await expect(ask).toBeEnabled()
  // Up to 20 rows.
  for (let n = 0; n < 25; n++) if (await form().getByRole('button', { name: 'Add a size' }).isEnabled()) await form().getByRole('button', { name: 'Add a size' }).click()
  await expect(form().locator('.add-size')).toHaveCount(20)
  await expect(form().getByRole('button', { name: 'Add a size' })).toBeDisabled()
  for (let n = 19; n >= 4; n--) await form().getByLabel(`Clear size ${n + 1}`).click()
  await expect(form().locator('.add-size')).toHaveCount(4)
  // The form fits the column: nothing scrolls sideways, and a row's three boxes and its clear button are all inside the box of sizes.
  expect(await form().locator('.add-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  const box = await form().locator('.add-sizes').boundingBox()
  for (const part of ['.add-input >> nth=0', '.add-source', '.add-clear']) {
    const inner = await form().locator('.add-size').first().locator(part).boundingBox()
    expect(inner!.x + inner!.width).toBeLessThanOrEqual(box!.x + box!.width + 0.5)
    expect(inner!.width).toBeGreaterThan(10)
  }
})

test('Ask Claude puts the request in the box, shown first, and copies nothing until it is sent', async () => {
  await form().getByLabel('What is it').fill('MTS-101 mini toggle, SPST, two pins')
  await form().getByLabel('What size 2 measures').fill('bushing')
  await form().getByLabel('Value of size 2').fill('6')
  await form().getByLabel('What size 3 measures').fill('lever')
  await form().getByLabel('Value of size 3').fill('10')
  await form().getByLabel('Where size 3 came from').selectOption('guess')
  await form().locator('[data-part="add-ask"]').click()
  await expect(form()).toHaveCount(0)
  // The box puts a space after what is inserted, as it does after a ref.
  await expect.poll(async () => (await composer().inputValue()).trimEnd()).toBe(
    'Put the MTS-101 mini toggle, SPST, two pins on the shelf as mts_101: Ø 6.2 panel hole (datasheet), 6 bushing (datasheet), 10 lever (assumed). Its files are in common/parts/mts_101/: drawing.png, MTS-101_sheet.pdf. Model it as the torno-model skill says.'
  )
  expect(names('mts_101')).toBeNull()
  expect(existsSync(join(root, 'common'))).toBe(true)
  expect(existsSync(join(root, 'common', 'parts', 'mts_101'))).toBe(false)
  // Never sent by itself.
  await expect(turns()).toHaveCount(0)
})

test('sending that message copies the files whole into common/parts/<id>/ first, and writes nothing else', async () => {
  await composer().focus()
  await page.keyboard.press('Enter')
  await expect(turns()).toHaveCount(1, { timeout: 20_000 })
  expect(names('mts_101')).toEqual(['MTS-101_sheet.pdf', 'drawing.png'])
  expect(readFileSync(join(partDir('mts_101'), 'MTS-101_sheet.pdf'), 'utf8')).toBe('%PDF-1.4\n% a datasheet\n')
  expect(readFileSync(join(partDir('mts_101'), 'drawing.png')).length).toBe(readFileSync(join(from, 'drawing.png')).length)
  // The sources are untouched, and no part.py or .torno was written by torno.
  expect(existsSync(join(from, 'drawing.png'))).toBe(true)
})

test('a message that no longer names the folder lets the request go: nothing is copied', async () => {
  await drop('body.step')
  await form().getByLabel('Name', { exact: true }).fill('toggle_two')
  await form().locator('[data-part="add-ask"]').click()
  await expect(composer()).toHaveValue(/common\/parts\/toggle_two\/: body\.step/)
  await composer().fill('Never mind, I will do it later')
  await page.keyboard.press('Enter')
  await expect(turns()).toHaveCount(2, { timeout: 20_000 })
  expect(names('toggle_two')).toBeNull()
  // And the request is forgotten: a message that names the folder now copies nothing.
  await composer().fill('Look at common/parts/toggle_two/ please')
  await page.keyboard.press('Enter')
  await expect(turns()).toHaveCount(3, { timeout: 20_000 })
  expect(names('toggle_two')).toBeNull()
})

test('a refusal is shown in the box\'s error line and the message is not sent; the name taken is never copied over', async () => {
  // drawing.png is in mts_101 already: adding it again to that part is refused for that file, in any case of the name.
  writeFileSync(join(partDir('mts_101'), 'Drawing.PNG'), 'mine')
  await drop('drawing.png', 'body.step')
  await form().getByLabel('Name', { exact: true }).fill('mts_101')
  await form().locator('[data-part="add-ask"]').click()
  const text = await composer().inputValue()
  expect(text).toContain('common/parts/mts_101/: drawing.png, body.step')
  await composer().focus()
  await page.keyboard.press('Enter')
  const problem = dock().locator('.chat-problem')
  await expect(problem).toContainText('drawing.png is already there: torno never copies over a file.')
  await expect(problem).toContainText('Nothing was sent')
  await expect(composer()).toHaveValue(text)
  await expect(turns()).toHaveCount(3)
  // The file that could be copied was, and the one that is there was left as it was.
  expect(names('mts_101')).toEqual(['Drawing.PNG', 'MTS-101_sheet.pdf', 'body.step', 'drawing.png'])
  expect(readFileSync(join(partDir('mts_101'), 'Drawing.PNG'), 'utf8')).toBe('mine')
  // Taking the folder out of the message sends it without the files.
  await composer().fill('Do it without the files')
  await page.keyboard.press('Enter')
  await expect(turns()).toHaveCount(4, { timeout: 20_000 })
})

test('Enter twice at once sends the message once and copies once, and the box holds still while it copies', async () => {
  await drop('body.step')
  await form().getByLabel('Name', { exact: true }).fill('twice_part')
  await form().locator('[data-part="add-ask"]').click()
  await expect(composer()).toHaveValue(/common\/parts\/twice_part\/: body\.step/)
  const before = await turns().count()
  // Two key presses in one tick: the second comes while the first send is still going (before the copy is done and the box emptied).
  await composer().evaluate((el) => {
    for (let n = 0; n < 2; n++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
  })
  await expect(turns()).toHaveCount(before + 1, { timeout: 20_000 })
  await expect(composer()).toHaveValue('')
  // Given time to show a second message, if one was sent.
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await expect(turns()).toHaveCount(before + 1)
  expect(names('twice_part')).toEqual(['body.step'])
})

test('main refuses what the window should not have sent: a bad id, a link, a relative path, too many files', async () => {
  const refused = (id: string, paths: string[]) => page.evaluate(([i, p]) => window.torno.shelf.addFiles(i as string, p as string[]).then(() => 'ok', (e: Error) => e.message), [id, paths] as const)
  expect(await refused('../x', [join(from, 'drawing.png')])).toMatch(/not a part/)
  expect(await refused('ok_id', Array.from({ length: 9 }, () => join(from, 'drawing.png')))).toMatch(/at most 8/)
  const got = await page.evaluate((p) => window.torno.shelf.addFiles('ok_id', p), ['relative.png', join(from, 'notes.txt')])
  expect(got.copied).toEqual([])
  expect(got.refused.map((r) => r.name)).toEqual(['relative.png', 'notes.txt'])
  expect(existsSync(partDir('ok_id'))).toBe(false)
})

test('with an empty shelf the tab is still there as "Shelf 0", says so, keeps its foot, and takes the first drop', async () => {
  if ((await form().count()) > 0) await form().locator('.add-back').click()
  rmSync(join(root, 'common', 'parts'), { recursive: true, force: true })
  await expect(benchTab(page, 'Shelf')).toHaveText(/^Shelf\s*0$/, { timeout: 15_000 })
  // It stays last, and is the open one when the project has kept it so.
  await expect(page.locator('.left .bench-tab').last()).toHaveAttribute('data-tab', 'shelf')
  await openSection(page, 'Shelf')
  await expect(tab().locator('.shelf-row')).toHaveCount(0)
  await expect(tab().locator('[data-part="shelf-empty"] b')).toHaveText('No parts on the shelf yet.')
  await expect(tab().locator('[data-part="shelf-empty"] p')).toHaveText('Claude asks before it puts a part it researched here. Or drop a datasheet, STEP or photo here to add one.')
  await expect(tab().locator('.shelf-foot')).toContainText('common/parts/')
  await drop('drawing.png')
  await expect(form()).toBeVisible()
  await expect(form().locator('.add-back')).toHaveText('New part, from 1 file you dropped')
  await form().locator('.add-back').click()
  await expect(form()).toHaveCount(0)
  await expect(tab().locator('[data-part="shelf-empty"]')).toBeVisible()
})
