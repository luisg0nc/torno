import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { png } from '../src/test/pngFixtures'
import { box, stl } from '../src/test/scanFixtures'
import { closeModelMenu, inModelMenu, openSection, showProjects, newSession } from './helpers'
import { newFromList, openListed, projectCrumb } from './objects'

// Making a new object, from the window: the page, its draft, the doodle board, a photo of 3000 px arriving scaled
// in the first prompt, the scan imported, and the object made on the disk. The agent is the stand-in. The window is
// hidden: everything is read from the DOM and the store, and the board is drawn with page.mouse.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

type Main = { pickPhotos: string[]; photoPicks: number; pickFile: string | null; pickStep: string | null; pickPdf: string | null }
const temp = (name: string): string => mkdtempSync(join(realpathSync(tmpdir()), `torno-e2e-onboard-${name}-`))
const copyOfWorkspace = (): string => {
  const root = temp('ws')
  cpSync(fixtures, root, { recursive: true, filter: (source) => !source.endsWith('__pycache__') })
  return root
}

async function start(root: string, command: string): Promise<{ app: ElectronApplication; page: Page }> {
  // TORNO_TEST=1 makes main create the window with show: false. Never launch without it.
  const app = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, TORNO_TEST: '1', TORNO_AGENT_CMD: command, TORNO_WORKSPACE: root } })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-region="left"]')
  return { app, page }
}

/** The button at the foot of the list of objects, in the left column. */

const hook = (app: ElectronApplication, set: Partial<Main>): Promise<void> => app.evaluate((_electron, values) => void Object.assign((globalThis as unknown as { __tornoMain: Main }).__tornoMain, values), set)

test.describe('a new object', () => {
  test.describe.configure({ mode: 'serial' })

  let root: string
  let files: string
  let app: ElectronApplication
  let page: Page
  const big = () => join(files, 'desk-3000.png')
  const webp = () => join(files, 'bench.webp')
  const plate = () => join(files, 'plate.stl')
  const bearing = () => join(files, '608ZZ.STEP')
  const datasheet = () => join(files, 'Datasheet.pdf')

  const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
  const newPage = () => page.getByRole('region', { name: 'New project' })
  const cards = (kind: string) => newPage().locator(`.ref-card[data-kind="${kind}"]`)
  const board = () => page.getByRole('dialog', { name: 'Doodle board' })
  const startButton = () => newPage().getByRole('button', { name: /^Start: make the project and ask Claude/ })
  const doodleIt = () => newPage().getByRole('button', { name: /^Sketch it/ })
  const dropAnything = () => newPage().getByRole('button', { name: /^Drop anything/ })
  const also = (name: string) => newPage().getByRole('button', { name, exact: true })
  const slot = (id: string) => newPage().locator(`[data-slot="${id}"]`)

  /** Draws a stroke on the board between two fractions of the canvas, with real pointer events. */
  async function stroke(from: [number, number], to: [number, number]): Promise<void> {
    const box = (await board().locator('canvas').boundingBox())!
    await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), { steps: 4 })
    await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 4 })
    await page.mouse.up()
  }

  test.beforeAll(async () => {
    root = copyOfWorkspace()
    files = temp('files')
    writeFileSync(big(), png(3000, 2000))
    writeFileSync(plate(), stl(box([60, 50, 2], [0, 0, -10])))
    writeFileSync(bearing(), 'ISO-10303-21;\nENDSEC;\n')
    writeFileSync(datasheet(), '%PDF-1.4\n%%EOF\n')
    ;({ app, page } = await start(root, `node ${fakeAgent}`))
    // A WebP is made by the window itself: a test has no encoder, and the window is what reads it.
    const encoded = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(800, 600)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#4477aa'
      ctx.fillRect(0, 0, 800, 600)
      const blob = await canvas.convertToBlob({ type: 'image/webp' })
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    })
    writeFileSync(webp(), Buffer.from(encoded))
  })

  test.afterAll(async () => {
    await app?.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  test('the page opens from the list, over the view, and says at once what is wrong with a name', async () => {
    await newFromList(page)
    await expect(newPage()).toBeVisible()
    expect((await state()).page).toBe('new')
    await expect(page.locator('.viewport-pane')).toBeHidden()
    // The dock cannot show here: its toggle is disabled, with the reason in its title.
    await expect(page.locator('.dock')).toBeHidden()
    await expect(page.locator('.dock-toggle')).toBeDisabled()
    await expect(page.locator('.dock-toggle')).toHaveAttribute('title', /hidden on this page/)
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused()
    const name = page.getByLabel('Name', { exact: true })
    const create = startButton()
    await name.fill('bracket')
    await expect(newPage()).toContainText('A folder `bracket` is there already')
    await name.fill('Plain')
    await expect(newPage()).toContainText('A folder `plain` is there already')
    await name.fill('tests')
    await expect(newPage()).toContainText('a name the workspace keeps for itself')
    await name.fill('.hidden')
    await expect(newPage()).toContainText('starts with a letter or a digit')
    await name.fill('cable-clip')
    await expect(newPage().locator('#new-name-help')).toHaveText("The folder's name: letters, digits, \u2212 and _.")
    // A name alone is not enough.
    await expect(create).toBeDisabled()
    await page.getByLabel('What is it?').fill('A clip that holds a 6 mm cable to the edge of a desk, printed in PETG.')
    await expect(create).toBeEnabled()
    await expect(newPage().locator('.new-will')).toContainText('cable_clip.py')
    await expect(newPage().locator('.new-will')).not.toContainText('reference/')
  })

  test('Escape leaves a field, then asks before the page with something in it is left; "Keep editing" keeps it', async () => {
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('What is it?')).not.toBeFocused()
    await page.keyboard.press('Escape')
    const ask = page.getByRole('alertdialog', { name: 'Discard this new project?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Keep editing' }).click()
    await expect(ask).toHaveCount(0)
    expect((await state()).page).toBe('new')
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('cable-clip')
  })

  test('the draft survives the page of objects and another object, and the window asks before it is closed on', async () => {
    await openListed(page, 'bracket')
    await expect.poll(async () => (await state()).page).toBe('object')
    await expect(newPage()).toHaveCount(0)
    await newFromList(page)
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('cable-clip')
    await expect(page.getByLabel('What is it?')).toHaveValue(/6 mm cable/)
    // A close of the window with a draft in it is asked about.
    await app.evaluate(({ BrowserWindow }) => void BrowserWindow.getAllWindows()[0].close())
    await expect(page.getByRole('alertdialog', { name: 'Close torno?' })).toContainText('New project: it is set up and not made yet')
    await page.getByRole('alertdialog', { name: 'Close torno?' }).getByRole('button', { name: 'Keep it open' }).click()
  })

  test('photos come through the dialog, scaled to 1280 px for the prompt (a WebP turned into a JPEG) and drawn small', async () => {
    await hook(app, { pickPhotos: [big(), webp()] })
    await dropAnything().click()
    await expect(cards('photos')).toHaveCount(2)
    await expect(cards('photos').nth(0)).toContainText('Photo')
    await expect(cards('photos').nth(0)).toContainText('desk-3000.png')
    await expect(cards('photos').nth(0)).toContainText('3000 × 2000, sent at 1280 × 853')
    await expect(cards('photos').nth(1)).toContainText('800 × 600')
    const widths = await cards('photos').locator('img').evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth))
    expect(widths).toEqual([1280, 800])
    await cards('photos').nth(0).getByLabel(/^Note for /).fill('the desk edge, 18 mm thick')
    // The same photo twice is one.
    await dropAnything().click()
    await expect(newPage()).toContainText('2 photos are there already')
    await expect(cards('photos')).toHaveCount(2)
    await cards('photos').nth(1).getByRole('button', { name: 'Remove photo 2' }).click()
    await expect(cards('photos')).toHaveCount(1)
    await hook(app, { pickPhotos: [big(), webp()] })
    await dropAnything().click()
    await expect(cards('photos')).toHaveCount(2)
  })

  test('a screenshot pasted from the clipboard has no file and is kept as a photo from its bytes (#196)', async () => {
    const before = await cards('photos').count()
    // A paste event made in the page, with a PNG and no path: the clipboard itself is never touched.
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(300, 200)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#aa5544'
      ctx.fillRect(0, 0, 300, 200)
      const file = new File([await canvas.convertToBlob({ type: 'image/png' })], 'image.png', { type: 'image/png' })
      const data = new DataTransfer()
      data.items.add(file)
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await expect(cards('photos')).toHaveCount(before + 1)
    const pasted = cards('photos').nth(before)
    await expect(pasted).toContainText('pasted.png')
    await expect(pasted).toContainText('300 × 200')
    await expect(newPage()).not.toContainText('no place on the disk')
    await pasted.getByRole('button', { name: `Remove photo ${before + 1}` }).click()
    await expect(cards('photos')).toHaveCount(before)
  })

  test('main serves the bytes only of the photos its own dialog offered', async () => {
    const refused = await page.evaluate((path) => window.torno.objects.readPhoto(path).then(() => 'read', (e: Error) => e.message), join(files, 'stranger.png'))
    expect(refused).toMatch(/not chosen in this window/)
    writeFileSync(join(files, 'stranger.png'), png(10, 10))
    expect(await page.evaluate((path) => window.torno.objects.readPhoto(path).then(() => 'read', (e: Error) => e.message), join(files, 'stranger.png'))).toMatch(/not chosen in this window/)
    expect(await page.evaluate((path) => window.torno.objects.readPhoto(path).then((b) => b.length > 8, () => false), big())).toBe(true)
  })

  test('a file dropped with no place on the disk, or that is neither a picture nor a scan, is said and nothing is added', async () => {
    const said = await page.evaluate(() => {
      const section = document.querySelector('section[aria-label="New project"]')!
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['x'], 'sketch.png'))
      dataTransfer.items.add(new File(['x'], 'notes.txt'))
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
      section.dispatchEvent(over)
      section.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
      return over.defaultPrevented
    })
    expect(said).toBe(true)
    await expect(newPage()).toContainText('sketch.png: That file has no place on the disk')
    await expect(newPage()).toContainText('notes.txt is neither a picture, a STEP file, a PDF nor a scan')
    await expect(cards('photos')).toHaveCount(2)
    // A file over 25 MB is refused before it is read.
    await page.evaluate(() => {
      const section = document.querySelector('section[aria-label="New project"]')!
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File([new ArrayBuffer(26 * 1024 * 1024)], 'huge.png'))
      section.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
    })
    await expect(newPage()).toContainText('huge.png is over 25 MB.')
    // Something that is no file is none of the page's.
    const text = await page.evaluate(() => {
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', 'lid')
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer })
      document.querySelector('section[aria-label="New project"]')!.dispatchEvent(over)
      return over.defaultPrevented
    })
    expect(text).toBe(false)
  })

  test('a doodle is drawn with the pointer, undone, put away with Escape, kept with Done, and opened again to change', async () => {
    await doodleIt().click()
    await expect(board()).toBeVisible()
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '0')
    await expect(board().getByRole('button', { name: 'Done' })).toBeDisabled()
    await stroke([0.2, 0.3], [0.8, 0.3])
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '1')
    // Escape asks, since something was drawn; "Keep drawing" goes on, and Discard puts the board away and keeps nothing.
    await page.keyboard.press('Escape')
    const ask = page.getByRole('alertdialog', { name: 'Discard this doodle?' })
    await expect(ask).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    await expect(board()).toBeVisible()
    await page.keyboard.press('Escape')
    await ask.getByRole('button', { name: 'Discard' }).click()
    await expect(board()).toHaveCount(0)
    await expect(cards('doodles')).toHaveCount(0)

    await doodleIt().click()
    await board().getByRole('button', { name: 'Thick pen' }).click()
    await stroke([0.2, 0.3], [0.8, 0.3])
    await stroke([0.5, 0.2], [0.5, 0.8])
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '2')
    await page.keyboard.press('Control+z')
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '1')
    await board().getByRole('button', { name: 'Eraser' }).click()
    await stroke([0.4, 0.3], [0.6, 0.3])
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '2')
    await board().getByRole('button', { name: 'Undo' }).click()
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '1')
    await board().getByRole('button', { name: 'Done' }).click()
    await expect(board()).toHaveCount(0)
    await expect(cards('doodles')).toHaveCount(1)
    await expect(cards('doodles').first()).toContainText('Doodle')
    const size = await cards('doodles').locator('img').evaluate((img) => [(img as HTMLImageElement).naturalWidth, (img as HTMLImageElement).naturalHeight])
    expect(size).toEqual([1200, 800])
    await cards('doodles').first().getByLabel(/^Note for /).fill('the shape of the jaw')

    // Opened again, the strokes are there to change.
    await cards('doodles').first().getByRole('button', { name: 'Change doodle 1' }).click()
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '1')
    await stroke([0.2, 0.7], [0.8, 0.7])
    await board().getByRole('button', { name: 'Done' }).click()
    await expect(cards('doodles')).toHaveCount(1)
    await expect(cards('doodles').first().getByLabel(/^Note for /)).toHaveValue('the shape of the jaw')
    await cards('doodles').first().getByRole('button', { name: 'Change doodle 1' }).click()
    await expect(board().locator('canvas')).toHaveAttribute('data-strokes', '2')
    await board().getByRole('button', { name: 'Cancel' }).click()
    await expect(board()).toHaveCount(0)
  })

  test('the doodle board fills the window, has a grid, and Shift draws a straight line from where the stroke began', async () => {
    await doodleIt().click()
    const canvas = board().locator('canvas')
    await expect(canvas).toHaveAttribute('data-grid', '')
    const box = (await canvas.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(1000)
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
    await page.mouse.down()
    await page.keyboard.down('Shift')
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7, { steps: 3 })
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2, { steps: 3 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await expect(canvas).toHaveAttribute('data-strokes', '1')
    const inked = (fx: number, fy: number): Promise<boolean> =>
      canvas.evaluate((c, [x, y]) => (c as HTMLCanvasElement).getContext('2d')!.getImageData(Math.round((c as HTMLCanvasElement).width * x), Math.round((c as HTMLCanvasElement).height * y), 1, 1).data[3] > 0, [fx, fy])
    expect(await inked(0.5, 0.2)).toBe(true)
    expect(await inked(0.3, 0.7)).toBe(false)
    await page.keyboard.press('Escape')
    await page.getByRole('alertdialog', { name: 'Discard this doodle?' }).getByRole('button', { name: 'Discard' }).click()
  })

  test('a doodle is drawn over one of the photos: the photo is under the ink in its picture, there is no grid, and it is opened again on the photo', async () => {
    await doodleIt().click()
    await expect(board().locator('canvas')).toHaveAttribute('data-grid', '')
    await board().getByLabel('Draw over').selectOption({ label: 'Photo 2, bench.webp' })
    await expect(board().locator('canvas')).not.toHaveAttribute('data-grid')
    await expect(board().locator('canvas')).toHaveAttribute('data-ground', '')
    // Only the background was changed, no stroke: leaving still asks (#197).
    await page.keyboard.press('Escape')
    const ask = page.getByRole('alertdialog', { name: 'Discard this doodle?' })
    await expect(ask).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    await stroke([0.2, 0.3], [0.8, 0.3])
    await board().getByRole('button', { name: 'Done' }).click()
    await expect(board()).toHaveCount(0)
    await expect(cards('doodles')).toHaveCount(2)
    const pixel = (fx: number, fy: number): Promise<number[]> =>
      cards('doodles').nth(1).locator('img').evaluate(async (img, [x, y]) => {
        const picture = img as HTMLImageElement
        await picture.decode()
        const canvas = new OffscreenCanvas(picture.naturalWidth, picture.naturalHeight)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(picture, 0, 0)
        return Array.from(ctx.getImageData(Math.round(canvas.width * x), Math.round(canvas.height * y), 1, 1).data)
      }, [fx, fy])
    // The photo (#4477aa, 800 x 600, fitted whole: white at the sides) where there is no ink, the ink over it.
    const [r, g, b] = await pixel(0.5, 0.7)
    expect(Math.abs(r - 0x44) + Math.abs(g - 0x77) + Math.abs(b - 0xaa)).toBeLessThan(40)
    expect((await pixel(0.02, 0.5)).slice(0, 3)).toEqual([255, 255, 255])
    expect(Math.max(...(await pixel(0.5, 0.3)).slice(0, 3))).toBeLessThan(80)
    // Opened again, it is on its photo.
    await cards('doodles').nth(1).getByRole('button', { name: 'Change doodle 2' }).click()
    await expect(board().getByLabel('Draw over')).toHaveValue(/^r\d+$/)
    await expect(board().getByLabel('Draw over').locator('option:checked')).toHaveText('Photo 2, bench.webp')
    await expect(board().locator('canvas')).not.toHaveAttribute('data-grid')
    await board().getByRole('button', { name: 'Cancel' }).click()
    await cards('doodles').nth(1).getByRole('button', { name: 'Remove doodle 2' }).click()
    await expect(cards('doodles')).toHaveCount(1)
  })

  test('a vendor STEP file is given as a bought part, with a note, and the preview names it for import_step', async () => {
    await hook(app, { pickStep: bearing() })
    await also('Bought part').click()
    await expect(cards('steps')).toHaveCount(1)
    await expect(cards('steps').first()).toContainText('Bought part')
    await expect(cards('steps').first()).toContainText('608ZZ.STEP')
    await cards('steps').first().getByLabel(/^Note for /).fill('the bearing, 8 x 22 x 7')
    // The same file twice is one.
    await also('Bought part').click()
    await expect(newPage()).toContainText('608ZZ.STEP is there already')
    await expect(cards('steps')).toHaveCount(1)
  })

  test('a scan and another object of the workspace are given with their notes', async () => {
    await hook(app, { pickFile: plate() })
    await also('Scan').click()
    await expect(cards('scans')).toHaveCount(1)
    await expect(cards('scans').first()).toContainText('Scan')
    await expect(cards('scans').first()).toContainText('plate.stl')
    await cards('scans').first().getByLabel(/^Note for /).fill('the desk, scanned')
    // The same scan twice is one.
    await also('Scan').click()
    await expect(newPage()).toContainText('plate.stl is there already')
    await expect(cards('scans')).toHaveCount(1)

    await also('Other project').click()
    const menu = page.getByRole('menu', { name: 'Projects of this workspace' })
    await expect(menu.getByRole('menuitem', { name: 'plain' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'plain' }).click()
    await expect(menu).toHaveCount(0)
    await expect(cards('objects')).toHaveCount(1)
    await cards('objects').first().getByLabel(/^Note for /).fill('same style')
    // It is not offered twice.
    await also('Other project').click()
    await expect(page.getByRole('menuitem', { name: 'plain' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(newPage()).toBeVisible()
    await expect(newPage().locator('.new-will')).toContainText('reference/')
    await expect(newPage().locator('.new-will')).toContainText('4 files')
  })

  test('sizes, rules, a link and a PDF are given in their slots, the preview says them, and S opens the doodle', async () => {
    // The card is there from the start; its button adds a row, and the first field takes the focus.
    await expect(slot('sizes')).toContainText('Sizes I know')
    await slot('sizes').getByRole('button', { name: 'Add a size' }).click()
    await expect(newPage().getByLabel('What size 1 measures')).toBeFocused()
    // A row nothing is typed in holds nothing back; one half done does, and says so.
    await expect(startButton()).toBeEnabled()
    await newPage().getByLabel('What size 1 measures').fill('battery tray')
    await expect(startButton()).toBeDisabled()
    await expect(newPage().locator('.new-will')).toContainText('Finish or remove the sizes that are not whole')
    await newPage().getByLabel('Value of size 1').fill('186 x 128')
    await newPage().getByLabel('Where size 1 came from').selectOption('measured')
    await expect(startButton()).toBeEnabled()
    // "Add a size" adds a second row; a person may not say a size is from Claude.
    await slot('sizes').getByRole('button', { name: 'Add a size' }).click()
    await expect(newPage().getByLabel('What size 2 measures')).toBeFocused()
    await expect(newPage().getByLabel('Where size 2 came from').locator('option')).toHaveText(['measured', 'from a manual or datasheet', 'a guess'])
    await expect(startButton()).toBeEnabled()
    await newPage().getByLabel('Value of size 2').fill('5')
    await expect(startButton()).toBeDisabled()
    await newPage().getByLabel('Remove size 2').click()
    await expect(startButton()).toBeEnabled()
    // S is a letter in a field, and the doodle on the page.
    await newPage().getByLabel('Note for size 1').press('s')
    await expect(newPage().getByLabel('Note for size 1')).toHaveValue('s')
    await expect(board()).toHaveCount(0)
    await newPage().getByLabel('Note for size 1').fill('')

    await expect(slot('rules')).toContainText('Rules')
    await slot('rules').locator('textarea').fill('PETG, 0.4 nozzle, min wall 1.2 mm')

    await also('Link or PDF').click()
    await expect(newPage().getByLabel('Link address')).toBeFocused()
    await newPage().getByLabel('Link address').fill('ftp://example.com/x')
    await newPage().getByLabel('Link address').press('Enter')
    await expect(newPage()).toContainText('A link is an http or https address.')
    await newPage().getByLabel('Link address').fill('https://example.com/datasheet')
    await newPage().getByLabel('Link address').press('Enter')
    await expect(slot('links').getByRole('listitem', { name: 'Link 1' })).toContainText('https://example.com/datasheet')
    await newPage().getByLabel('Note for link 1').fill('the vendor')
    await hook(app, { pickPdf: datasheet() })
    await slot('links').getByRole('button', { name: 'Add a PDF…' }).click()
    await expect(cards('pdfs')).toHaveCount(1)
    await expect(cards('pdfs').first()).toContainText('Datasheet.pdf')
    await cards('pdfs').first().getByLabel(/^Note for /).fill('the cell')
    await slot('links').getByRole('button', { name: 'Add a PDF…' }).click()
    await expect(newPage()).toContainText('Datasheet.pdf is there already')
    await expect(cards('pdfs')).toHaveCount(1)

    // What Claude gets first says all of it, as main writes it.
    const text = newPage().locator('.draft-pane-text')
    await expect(text).toContainText('battery tray 186 × 128 mm (measured)')
    await expect(text).toContainText('PETG, 0.4 nozzle, min wall 1.2 mm')
    await expect(text).toContainText('https://example.com/datasheet: the vendor')
    await expect(text).toContainText('reference/Datasheet.pdf')
    await expect(newPage().locator('.new-will')).toContainText('5 files')

    // The doodle, from the keyboard, with the page in focus.
    await newPage().focus()
    await page.keyboard.press('s')
    await expect(board()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(board()).toHaveCount(0)
  })

  test('Create makes the object, lists it, opens it, and the first prompt reaches the agent with the pictures scaled to 1280 px', async () => {
    // The model and effort of its session, beside Create: before any session, Claude Code's aliases.
    const choice = newPage().getByRole('group', { name: 'Claude Code starts on' })
    await expect(choice.getByLabel('Model')).toHaveValue('')
    await choice.getByLabel('Model').selectOption('haiku')
    await choice.getByLabel('Effort').selectOption('high')
    await startButton().click()
    await expect.poll(async () => (await state()).objectId, { timeout: 30_000 }).toBe('cable-clip')
    const now = await state()
    expect(now.page).toBe('object')
    expect(now.workspace?.objects.map((o) => o.id)).toContain('cable-clip')
    await expect(projectCrumb(page)).toHaveAttribute('aria-label', 'Project cable-clip')
    await expect(newPage()).toHaveCount(0)

    // The project opens on its board, with a frame for each kind of what was given.
    const frames = page.locator('.pboard-card[data-kind="frame"]')
    await expect(frames).toHaveCount(8, { timeout: 30_000 })
    await expect(frames).toContainText(['Brief', 'Photos', 'Doodles', 'Sizes', 'Rules', 'Links', 'Bought parts', 'PDFs'])
    await expect(page.locator('.pboard-card[data-kind="size"]')).toContainText('battery tray')

    // The folder: the template, the brief with every note, the originals copied as they were, and nothing else.
    const dir = join(root, 'cable-clip')
    expect(readdirSync(dir).filter((n) => n !== '.torno').sort()).toEqual(['brief.md', 'cable_clip.py', 'reference'])
    expect(readdirSync(join(dir, 'reference')).sort()).toEqual(['608ZZ.step', 'Datasheet.pdf', 'doodle-1.png', 'photo-1.png', 'photo-2.webp'])
    expect(readFileSync(join(dir, 'reference', 'photo-1.png')).equals(readFileSync(big()))).toBe(true)
    const brief = readFileSync(join(dir, 'brief.md'), 'utf8')
    for (const part of ['A clip that holds a 6 mm cable', 'the desk edge, 18 mm thick', 'the shape of the jaw', 'the desk, scanned', 'same style', 'reference/608ZZ.step: the bearing, 8 x 22 x 7', '../plain/']) expect(brief).toContain(part)
    expect(readdirSync(root).filter((n) => n.startsWith('.'))).toEqual([])

    // The chat: one prompt, with the photos and the doodle as pictures scaled to 1280 px at most, and the agent answered.
    const dock = page.locator('[data-region="session"]')
    await expect(dock.locator('.chat')).toBeVisible({ timeout: 30_000 })
    await expect(dock.locator('.chat-user').first()).toContainText('This is a new project, cable-clip')
    await expect(dock.locator('.chat-user').first()).toContainText('the desk edge, 18 mm thick')
    await expect(dock.locator('.chat-user').first()).toContainText('import_step(Path(__file__).parent / "reference" / "608ZZ.step")')
    expect(readFileSync(join(dir, 'reference', '608ZZ.step'), 'utf8')).toBe('ISO-10303-21;\nENDSEC;\n')
    await expect(dock.locator('.chat-thumb img')).toHaveCount(3)
    const widths = await dock.locator('.chat-thumb img').evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth))
    expect(widths).toEqual([1280, 800, 1200])
    await expect(dock.locator('.chat-user')).toHaveCount(1)
    await expect(dock.locator('.chat-turn')).toHaveCount(1, { timeout: 30_000 })
    // Started on them, for this session alone: the stand-in runs the model it was given (`--model=haiku`), and the pane says both.
    await expect(await inModelMenu(dock, 'Model')).toHaveValue('haiku')
    await expect(await inModelMenu(dock, 'Effort')).toHaveValue('high')
    await closeModelMenu(dock)

    // The scan was imported into the object.
    await expect.poll(() => (existsSync(join(dir, '.torno', 'scans.json')) ? readFileSync(join(dir, '.torno', 'scans.json'), 'utf8') : ''), { timeout: 60_000 }).toContain('plate.stl')
    // The draft is spent.
    await newFromList(page)
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('')
    await expect(cards('photos')).toHaveCount(0)
    // The choice is the person's, kept for the next object; the list is now the one the chat's CLI offered.
    await expect(newPage().getByRole('group', { name: 'Claude Code starts on' }).getByLabel('Model')).toHaveValue('haiku')
    await expect(newPage().getByRole('group', { name: 'Claude Code starts on' }).getByLabel('Effort')).toHaveValue('high')
    // Empty, Escape leaves the page at once, for the page of projects it was reached from.
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('objects')
  })

  test('a resumed chat shows the references from reference/ again, and says which one is no longer there', async () => {
    const dir = join(root, 'cable-clip')
    const dock = page.locator('[data-region="session"]')
    const view = (name: string) => dock.getByRole('group', { name: 'View' }).getByRole('button', { name })
    const earlier = () => dock.locator('.chat').getByRole('region', { name: 'Earlier in this conversation' })
    /** The terminal resumes the conversation, and the chat again after it: the first prompt is then read from the log, without its pictures' data. */
    async function resume(): Promise<void> {
      await view('Terminal').click()
      await expect(dock.locator('.chat')).toHaveCount(0, { timeout: 15_000 })
      await expect(dock.locator('.xterm')).toBeVisible({ timeout: 15_000 })
      await view('Chat').click()
      await expect(earlier()).toBeVisible({ timeout: 15_000 })
    }
    // The log has the names and no picture data.
    const logs = readdirSync(join(dir, '.torno', 'chat'))
    expect(logs).toHaveLength(1)
    const log = readFileSync(join(dir, '.torno', 'chat', logs[0]), 'utf8')
    expect(log).toContain('"file":"reference/doodle-1.png"')
    expect(log).not.toContain('"data"')

    await resume()
    const user = earlier().locator('.chat-user').first()
    await expect(user.locator('.chat-thumb img')).toHaveCount(3)
    await expect(user.locator('.chat-thumb-gone')).toHaveCount(0)
    expect(await user.locator('.chat-thumb').evaluateAll((thumbs) => thumbs.map((t) => t.getAttribute('title')))).toEqual(['photo-1.png', 'photo-2.webp', 'doodle-1.png'])
    // Scaled as any picture is: the 3000 px photo comes back at 1280.
    expect(await user.locator('.chat-thumb img').first().evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1280)

    rmSync(join(dir, 'reference', 'doodle-1.png'))
    await resume()
    const again = earlier().locator('.chat-user').first()
    await expect(again.locator('.chat-thumb img')).toHaveCount(2)
    await expect(again.locator('.chat-thumb-gone')).toHaveText('reference/doodle-1.png is no longer there')
  })

  test('Discard with something in the draft asks first, and Discard throws it away', async () => {
    await newFromList(page)
    await page.getByLabel('Name', { exact: true }).fill('lid')
    await newPage().getByRole('button', { name: 'Discard', exact: true }).click()
    const ask = page.getByRole('alertdialog', { name: 'Discard this new project?' })
    await expect(ask).toBeVisible()
    // Escape in the question keeps the page.
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    await expect(newPage()).toBeVisible()
    await newPage().getByRole('button', { name: 'Discard', exact: true }).click()
    await ask.getByRole('button', { name: 'Discard' }).click()
    // Back on the page of projects, which it was reached from.
    await expect.poll(async () => (await state()).page).toBe('objects')
    await newFromList(page)
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('objects')
  })

  test('the page of objects has the way in too, and Escape goes back to it', async () => {
    await showProjects(page)
    await expect.poll(async () => (await state()).page).toBe('objects')
    await page.locator('.show-new').click()
    await expect(newPage()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('objects')
    await expect(newPage()).toHaveCount(0)
  })
})

test.describe('the composer of an empty folder', () => {
  test.describe.configure({ mode: 'serial' })

  test('Start makes the folder the words name and starts the session with the words as its first prompt', async () => {
    test.setTimeout(90_000)
    const root = temp('empty')
    const { app, page } = await start(root, `node ${fakeAgent}`)
    try {
      const composer = page.locator('.empty-folder')
      await expect(composer.getByRole('heading', { name: 'What are we making?' })).toBeVisible()
      const words = composer.getByRole('textbox', { name: 'What are we making?' })
      await words.fill('A clip that holds a 6 mm cable to the edge of a desk')
      const where = composer.getByRole('button', { name: /^Goes in / })
      await expect(where).toContainText(`${root.split('/').pop()}/cable-clip`)
      // The folder offered can be changed, and a name the workspace refuses is said.
      await where.click()
      const name = composer.getByLabel('Goes in', { exact: true })
      await name.fill('tools')
      await expect(composer.getByRole('button', { name: 'Start', exact: true })).toBeDisabled()
      await expect(composer.locator('.compose-help')).toContainText('keeps for itself')
      await name.fill('desk-clip')
      await name.press('Enter')
      await expect(composer.getByRole('button', { name: /^Goes in / })).toContainText('/desk-clip')
      // Nothing is written before Start.
      expect(readdirSync(root)).toEqual([])
      await composer.getByRole('button', { name: 'Start', exact: true }).click()
      await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).objectId, { timeout: 30_000 }).toBe('desk-clip')
      expect(existsSync(join(root, 'desk-clip', 'desk_clip.py'))).toBe(true)
      expect(readFileSync(join(root, 'desk-clip', 'brief.md'), 'utf8')).toContain('A clip that holds a 6 mm cable to the edge of a desk')
      const dock = page.locator('[data-region="session"]')
      await expect(dock.locator('.chat-user').first()).toContainText('This is a new project, desk-clip', { timeout: 30_000 })
      await expect(dock.locator('.chat-user').first()).toContainText('A clip that holds a 6 mm cable to the edge of a desk')
      expect(readdirSync(root)).toEqual(['desk-clip'])
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the full page takes over what was typed and the folder offered', async () => {
    const root = temp('empty-full')
    const { app, page } = await start(root, `node ${fakeAgent}`)
    try {
      const composer = page.locator('.empty-folder')
      await composer.getByRole('textbox', { name: 'What are we making?' }).fill('A hook for a mug')
      await composer.getByRole('button', { name: 'open the full new project page' }).click()
      const here = page.getByRole('region', { name: 'New project' })
      await expect(here.getByLabel('What is it?')).toHaveValue('A hook for a mug')
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue('mug-hook')
      expect(readdirSync(root)).toEqual([])
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

test.describe('a new object whose agent cannot be started', () => {
  test.describe.configure({ mode: 'serial' })

  test('the object is made and open, the reason is shown, and the prompt is in the box of the first chat', async () => {
    test.setTimeout(90_000)
    const root = copyOfWorkspace()
    const home = temp('agent')
    const command = join(home, 'claude-stand-in.sh')
    const { app, page } = await start(root, command)
    try {
      await newFromList(page)
      await page.getByLabel('Name', { exact: true }).fill('latch')
      await page.getByLabel('What is it?').fill('A latch for a box lid.')
      await page.getByRole('region', { name: 'New project' }).getByRole('button', { name: /^Start: make the project and ask Claude/ }).click()
      await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).objectId, { timeout: 30_000 }).toBe('latch')
      const dock = page.locator('[data-region="session"]')
      await expect(dock.locator('.session-held')).toContainText('was not found on PATH')
      await expect(dock.locator('.session-held')).toContainText('kept')
      expect(existsSync(join(root, 'latch', 'latch.py'))).toBe(true)

      // The agent is found now: a session started by hand has the prompt in its box, not sent.
      writeFileSync(command, `#!/bin/sh\nexec node ${fakeAgent} "$@"\n`)
      chmodSync(command, 0o755)
      await newSession(dock)
      await expect(dock.locator('[data-chat-composer]')).toHaveValue(/This is a new project, latch/, { timeout: 30_000 })
      await expect(dock.locator('.session-held')).toContainText('It is in the box below')
      await expect(dock.locator('.chat-turn')).toHaveCount(0)
      await dock.locator('.session-held').getByRole('button', { name: 'Dismiss' }).click()
      await expect(dock.locator('.session-held')).toHaveCount(0)
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
      rmSync(home, { recursive: true, force: true })
    }
  })
})

test.describe('the window while a new object is made', () => {
  test.describe.configure({ mode: 'serial' })

  let root: string
  let files: string
  let app: ElectronApplication
  let page: Page
  const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
  const dock = () => page.locator('[data-region="session"]')
  const newPage = () => page.getByRole('region', { name: 'New project' })
  const dropAnything = () => newPage().getByRole('button', { name: /^Drop anything/ })
  const also = (name: string) => newPage().getByRole('button', { name, exact: true })
  const marks = () => page.locator('[data-region="left"] .route-section[data-section="marks"]')
  const status = () => page.locator('[data-region="status"]')

  test.beforeAll(async () => {
    root = copyOfWorkspace()
    files = temp('files')
    writeFileSync(join(files, 'desk.png'), png(400, 300))
    ;({ app, page } = await start(root, `node ${fakeAgent}`))
    await openListed(page, 'bracket')
    await expect.poll(async () => (await state()).page).toBe('object')
  })

  test.afterAll(async () => {
    await app?.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(files, { recursive: true, force: true })
  })

  test('the shell is of the object being made, and comes back as it was', async () => {
    await expect(dock().getByRole('button', { name: 'New session' })).toBeVisible()
    await expect(status().getByRole('button', { name: 'Rebuild' })).toBeVisible({ timeout: 30_000 })
    await newFromList(page)
    // The first prompt is on the page, on the dye at its right: the dock is hidden while the page is up.
    await expect(dock()).toBeHidden()
    await expect(newPage().locator('.draft-pane[data-plate]')).toContainText('What Claude gets first')
    await expect(newPage()).toContainText('Written from this page as you add to it.')
    await expect(newPage().locator('.draft-pane-text')).toContainText('This is a new project')
    await page.getByLabel('Name', { exact: true }).fill('cable-clip')
    await hook(app, { pickPhotos: [join(files, 'desk.png')] })
    await dropAnything().click()
    await expect(newPage().locator('.draft-pane')).toContainText('cable-clip')
    await expect(newPage().locator('.draft-pane')).toContainText('reference/photo-1.png')
    await expect(newPage().locator('.draft-pane')).toContainText('attached: picture 1')
    // A bought part is named in the preview, with how the agent is to place it.
    await hook(app, { pickStep: join(files, '608ZZ.STEP') })
    await also('Bought part').click()
    await expect(newPage().locator('.draft-pane-text')).toContainText('reference/608ZZ.step')
    await expect(newPage().locator('.draft-pane-text')).toContainText('import_step(')
    // The title bar's crumb reads "New project", and the rail has no index of sections: there is no project open to read.
    await expect(page.locator('.title-row .crumb-project')).toHaveText('New project')
    await expect(page.locator('[data-region="left"] .route-card')).toHaveCount(0)
    await expect(marks()).toHaveCount(0)
    await expect(status()).toContainText('New project')
    await expect(status().getByRole('button', { name: 'Rebuild' })).toHaveCount(0)
    await expect(status().getByRole('button', { name: 'Export…' })).toHaveCount(0)
    // Escape leaves the field, then asks: the draft has something.
    await page.getByLabel('Name', { exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('Name', { exact: true })).not.toBeFocused()
    await page.keyboard.press('Escape')
    const ask = page.getByRole('alertdialog', { name: 'Discard this new project?' })
    await ask.getByRole('button', { name: 'Discard' }).click()
    // The page was reached from the page of projects, and Discard goes back to it; bracket is still the one open under it.
    await expect.poll(async () => (await state()).page).toBe('objects')
    expect((await state()).objectId).toBe('bracket')
    await openListed(page, 'bracket')
    await expect.poll(async () => (await state()).page).toBe('object')
    await expect(projectCrumb(page)).toHaveAttribute('aria-label', 'Project bracket')
    await openSection(page, 'Marks')
    await expect(marks()).toHaveCount(1)
    await expect(status().getByRole('button', { name: 'Rebuild' })).toBeVisible()
    await expect(dock().getByRole('button', { name: 'New session' })).toBeVisible()
  })

  test('a running session of the object that was open goes on behind the page, and its dock is back when the page is left', async () => {
    await newSession(dock())
    await expect(dock().locator('.session-status')).toBeVisible({ timeout: 30_000 })
    await newFromList(page)
    await expect(dock()).toBeHidden()
    await expect(page.locator('.shell')).toHaveAttribute('data-dock', 'collapsed')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('objects')
    await expect(page.locator('.shell')).toHaveAttribute('data-dock', 'open')
    await expect(dock().locator('.session-status')).toBeVisible()
  })
})

test.describe('a new project made without starting Claude', () => {
  test.describe.configure({ mode: 'serial' })

  test('is made and open on its board, with no session and no prompt sent', async () => {
    test.setTimeout(90_000)
    const root = copyOfWorkspace()
    const { app, page } = await start(root, `node ${fakeAgent}`)
    try {
      await newFromList(page)
      const here = page.getByRole('region', { name: 'New project' })
      await page.getByLabel('Name', { exact: true }).fill('latch')
      await page.getByLabel('What is it?').fill('A latch for a box lid.')
      await here.locator('[data-slot="sizes"]').getByRole('button', { name: 'Add a size' }).click()
      await here.getByLabel('What size 1 measures').fill('lid thickness')
      await here.getByLabel('Value of size 1').fill('4')
      // A scan is imported into the project even though no prompt is sent (onboard, which imports it otherwise, is not called).
      const scanFiles = temp('files')
      writeFileSync(join(scanFiles, 'plate.stl'), stl(box([60, 50, 2], [0, 0, -10])))
      await hook(app, { pickFile: join(scanFiles, 'plate.stl') })
      await here.getByRole('button', { name: 'Scan', exact: true }).click()
      await expect(here.locator('.ref-card[data-kind="scans"]')).toHaveCount(1)
      await here.getByRole('button', { name: 'Or make it without starting Claude' }).click()
      await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).objectId, { timeout: 30_000 }).toBe('latch')
      await expect(here).toHaveCount(0)
      const frames = page.locator('.pboard-card[data-kind="frame"]')
      await expect(frames).toContainText(['Brief', 'Sizes'], { timeout: 30_000 })
      expect(existsSync(join(root, 'latch', 'latch.py'))).toBe(true)
      // No session was started and nothing was sent: it waits for a click.
      const dock = page.locator('[data-region="session"]')
      await expect(dock.locator('.chat-user')).toHaveCount(0)
      await expect(dock.getByRole('button', { name: 'New session' })).toBeVisible()
      await expect
        .poll(() => (existsSync(join(root, 'latch', '.torno', 'scans.json')) ? readFileSync(join(root, 'latch', '.torno', 'scans.json'), 'utf8') : ''), { timeout: 60_000 })
        .toContain('plate.stl')
      rmSync(scanFiles, { recursive: true, force: true })
    } finally {
      await app.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
