import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import type { TornoState } from '../src/renderer/state/store'
import { png } from '../src/test/pngFixtures'
import { box, stl } from '../src/test/scanFixtures'

// Making a new object, from the window: the page, its draft, the doodle board, a photo of 3000 px arriving scaled
// in the first prompt, the scan imported, and the object made on the disk. The agent is the stand-in. The window is
// hidden: everything is read from the DOM and the store, and the board is drawn with page.mouse.
const appDir = resolve(__dirname, '..')
const fixtures = resolve(appDir, '../kernel/tests/fixtures/ws')
const fakeAgent = resolve(appDir, 'test/fake-agent.mjs')

type Main = { pickPhotos: string[]; photoPicks: number; pickFile: string | null }
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
const fromList = (page: Page) => page.getByRole('navigation', { name: 'Objects' }).getByRole('button', { name: 'New object' })

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

  const state = (): Promise<TornoState> => page.evaluate(() => window.__tornoTest!.state())
  const newPage = () => page.getByRole('region', { name: 'New object' })
  const cards = (kind: string) => newPage().locator(`.ref-card[data-kind="${kind}"]`)
  const board = () => page.getByRole('dialog', { name: 'Doodle board' })

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
    await fromList(page).click()
    await expect(newPage()).toBeVisible()
    expect((await state()).page).toBe('new')
    await expect(page.locator('.viewport-pane')).toBeHidden()
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused()
    const name = page.getByLabel('Name', { exact: true })
    const create = newPage().getByRole('button', { name: 'Create' })
    await name.fill('bracket')
    await expect(newPage()).toContainText('A folder `bracket` is there already')
    await name.fill('Plain')
    await expect(newPage()).toContainText('A folder `plain` is there already')
    await name.fill('tests')
    await expect(newPage()).toContainText('a name the workspace keeps for itself')
    await name.fill('.hidden')
    await expect(newPage()).toContainText('starts with a letter or a digit')
    await name.fill('cable-clip')
    await expect(newPage().locator('#new-name-help')).toHaveText("The folder's name: letters, digits, - _ (no dots)")
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
    const ask = page.getByRole('alertdialog', { name: 'Discard this new object?' })
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Keep editing' }).click()
    await expect(ask).toHaveCount(0)
    expect((await state()).page).toBe('new')
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('cable-clip')
  })

  test('the draft survives the page of objects and another object, and the window asks before it is closed on', async () => {
    await page.getByRole('button', { name: 'bracket', exact: true }).click()
    await expect.poll(async () => (await state()).page).toBe('object')
    await expect(newPage()).toHaveCount(0)
    await fromList(page).click()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('cable-clip')
    await expect(page.getByLabel('What is it?')).toHaveValue(/6 mm cable/)
    // A close of the window with a draft in it is asked about.
    await app.evaluate(({ BrowserWindow }) => void BrowserWindow.getAllWindows()[0].close())
    await expect(page.getByRole('alertdialog', { name: 'Close torno?' })).toContainText('A new object is set up and not made yet.')
    await page.getByRole('alertdialog', { name: 'Close torno?' }).getByRole('button', { name: 'Keep it open' }).click()
  })

  test('photos come through the dialog, scaled to 1280 px for the prompt (a WebP turned into a JPEG) and drawn small', async () => {
    await hook(app, { pickPhotos: [big(), webp()] })
    await newPage().getByRole('button', { name: 'Add photos…' }).click()
    await expect(cards('photos')).toHaveCount(2)
    await expect(cards('photos').nth(0)).toContainText('Photo')
    await expect(cards('photos').nth(0)).toContainText('desk-3000.png')
    await expect(cards('photos').nth(0)).toContainText('3000 × 2000, sent at 1280 × 853')
    await expect(cards('photos').nth(1)).toContainText('800 × 600')
    const widths = await cards('photos').locator('img').evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth))
    expect(widths).toEqual([1280, 800])
    await cards('photos').nth(0).getByLabel(/^Note for /).fill('the desk edge, 18 mm thick')
    // The same photo twice is one.
    await newPage().getByRole('button', { name: 'Add photos…' }).click()
    await expect(newPage()).toContainText('2 photos are there already')
    await expect(cards('photos')).toHaveCount(2)
    await cards('photos').nth(1).getByRole('button', { name: 'Remove photo 2' }).click()
    await expect(cards('photos')).toHaveCount(1)
    await hook(app, { pickPhotos: [big(), webp()] })
    await newPage().getByRole('button', { name: 'Add photos…' }).click()
    await expect(cards('photos')).toHaveCount(2)
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
      const section = document.querySelector('section[aria-label="New object"]')!
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
    await expect(newPage()).toContainText('notes.txt is neither a picture nor a scan')
    await expect(cards('photos')).toHaveCount(2)
    // A file over 25 MB is refused before it is read.
    await page.evaluate(() => {
      const section = document.querySelector('section[aria-label="New object"]')!
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
      document.querySelector('section[aria-label="New object"]')!.dispatchEvent(over)
      return over.defaultPrevented
    })
    expect(text).toBe(false)
  })

  test('a doodle is drawn with the pointer, undone, put away with Escape, kept with Done, and opened again to change', async () => {
    await newPage().getByRole('button', { name: 'Draw…' }).click()
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

    await newPage().getByRole('button', { name: 'Draw…' }).click()
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

  test('a scan and another object of the workspace are given with their notes', async () => {
    await hook(app, { pickFile: plate() })
    await newPage().getByRole('button', { name: 'Add a scan…' }).click()
    await expect(cards('scans')).toHaveCount(1)
    await expect(cards('scans').first()).toContainText('Scan')
    await expect(cards('scans').first()).toContainText('plate.stl')
    await cards('scans').first().getByLabel(/^Note for /).fill('the desk, scanned')
    // The same scan twice is one.
    await newPage().getByRole('button', { name: 'Add a scan…' }).click()
    await expect(newPage()).toContainText('plate.stl is there already')
    await expect(cards('scans')).toHaveCount(1)

    await newPage().getByRole('button', { name: 'Refer to an object…' }).click()
    const menu = page.getByRole('menu', { name: 'Objects of this workspace' })
    await expect(menu.getByRole('menuitem', { name: 'plain' })).toBeVisible()
    await menu.getByRole('menuitem', { name: 'plain' }).click()
    await expect(menu).toHaveCount(0)
    await expect(cards('objects')).toHaveCount(1)
    await cards('objects').first().getByLabel(/^Note for /).fill('same style')
    // It is not offered twice.
    await newPage().getByRole('button', { name: 'Refer to an object…' }).click()
    await expect(page.getByRole('menuitem', { name: 'plain' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(newPage()).toBeVisible()
    await expect(newPage().locator('.new-will')).toContainText('reference/')
    await expect(newPage().locator('.new-will')).toContainText('3 files')
  })

  test('Create makes the object, lists it, opens it, and the first prompt reaches the agent with the pictures scaled to 1280 px', async () => {
    await newPage().getByRole('button', { name: 'Create' }).click()
    await expect.poll(async () => (await state()).objectId, { timeout: 30_000 }).toBe('cable-clip')
    const now = await state()
    expect(now.page).toBe('object')
    expect(now.workspace?.objects.map((o) => o.id)).toContain('cable-clip')
    await expect(page.getByRole('button', { name: 'cable-clip', exact: true })).toBeVisible()
    await expect(newPage()).toHaveCount(0)

    // The folder: the template, the brief with every note, the originals copied as they were, and nothing else.
    const dir = join(root, 'cable-clip')
    expect(readdirSync(dir).filter((n) => n !== '.torno').sort()).toEqual(['brief.md', 'cable_clip.py', 'reference'])
    expect(readdirSync(join(dir, 'reference')).sort()).toEqual(['doodle-1.png', 'photo-1.png', 'photo-2.webp'])
    expect(readFileSync(join(dir, 'reference', 'photo-1.png')).equals(readFileSync(big()))).toBe(true)
    const brief = readFileSync(join(dir, 'brief.md'), 'utf8')
    for (const part of ['A clip that holds a 6 mm cable', 'the desk edge, 18 mm thick', 'the shape of the jaw', 'the desk, scanned', 'same style', '../plain/']) expect(brief).toContain(part)
    expect(readdirSync(root).filter((n) => n.startsWith('.'))).toEqual([])

    // The chat: one prompt, with the photos and the doodle as pictures scaled to 1280 px at most, and the agent answered.
    const dock = page.locator('[data-region="session"]')
    await expect(dock.locator('.chat')).toBeVisible({ timeout: 30_000 })
    await expect(dock.locator('.chat-user').first()).toContainText('This is a new object, cable-clip')
    await expect(dock.locator('.chat-user').first()).toContainText('the desk edge, 18 mm thick')
    await expect(dock.locator('.chat-thumb img')).toHaveCount(3)
    const widths = await dock.locator('.chat-thumb img').evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).naturalWidth))
    expect(widths).toEqual([1280, 800, 1200])
    await expect(dock.locator('.chat-user')).toHaveCount(1)
    await expect(dock.locator('.chat-turn')).toHaveCount(1, { timeout: 30_000 })

    // The scan was imported into the object.
    await expect.poll(() => (existsSync(join(dir, '.torno', 'scans.json')) ? readFileSync(join(dir, '.torno', 'scans.json'), 'utf8') : ''), { timeout: 60_000 }).toContain('plate.stl')
    // The draft is spent.
    await fromList(page).click()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('')
    await expect(cards('photos')).toHaveCount(0)
    // Empty, Escape leaves the page at once, for the object that was open.
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('object')
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

  test('Cancel with something in the draft asks first, and Discard throws it away', async () => {
    await fromList(page).click()
    await page.getByLabel('Name', { exact: true }).fill('lid')
    await newPage().getByRole('button', { name: 'Cancel' }).click()
    const ask = page.getByRole('alertdialog', { name: 'Discard this new object?' })
    await expect(ask).toBeVisible()
    // Escape in the question keeps the page.
    await page.keyboard.press('Escape')
    await expect(ask).toHaveCount(0)
    await expect(newPage()).toBeVisible()
    await newPage().getByRole('button', { name: 'Cancel' }).click()
    await ask.getByRole('button', { name: 'Discard' }).click()
    await expect.poll(async () => (await state()).page).toBe('object')
    await fromList(page).click()
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue('')
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('object')
  })

  test('the page of objects has the way in too, and Escape goes back to it', async () => {
    await page.getByRole('button', { name: 'All objects' }).click()
    await expect.poll(async () => (await state()).page).toBe('objects')
    await page.locator('.show-new').click()
    await expect(newPage()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('objects')
    await expect(newPage()).toHaveCount(0)
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
      await fromList(page).click()
      await page.getByLabel('Name', { exact: true }).fill('latch')
      await page.getByLabel('What is it?').fill('A latch for a box lid.')
      await page.getByRole('region', { name: 'New object' }).getByRole('button', { name: 'Create' }).click()
      await expect.poll(async () => (await page.evaluate(() => window.__tornoTest!.state())).objectId, { timeout: 30_000 }).toBe('latch')
      const dock = page.locator('[data-region="session"]')
      await expect(dock.locator('.session-held')).toContainText('was not found on PATH')
      await expect(dock.locator('.session-held')).toContainText('kept')
      expect(existsSync(join(root, 'latch', 'latch.py'))).toBe(true)

      // The agent is found now: a session started by hand has the prompt in its box, not sent.
      writeFileSync(command, `#!/bin/sh\nexec node ${fakeAgent} "$@"\n`)
      chmodSync(command, 0o755)
      await dock.getByRole('button', { name: 'New session' }).click()
      await expect(dock.locator('[data-chat-composer]')).toHaveValue(/This is a new object, latch/, { timeout: 30_000 })
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
  const list = () => page.getByRole('navigation', { name: 'Objects' })
  const marks = () => page.locator('section[aria-label="Marks"]')
  const status = () => page.locator('[data-region="status"]')

  test.beforeAll(async () => {
    root = copyOfWorkspace()
    files = temp('files')
    writeFileSync(join(files, 'desk.png'), png(400, 300))
    ;({ app, page } = await start(root, `node ${fakeAgent}`))
    await page.getByRole('button', { name: 'bracket', exact: true }).click()
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
    await fromList(page).click()
    await expect(dock()).toContainText('Claude Code starts here once you create the object.')
    await expect(dock()).toContainText('No name yet')
    await expect(dock()).toContainText('Nothing yet')
    await expect(dock().getByRole('button', { name: 'New session' })).toHaveCount(0)
    await expect(dock().getByRole('button', { name: 'Resume' })).toHaveCount(0)
    await page.getByLabel('Name', { exact: true }).fill('cable-clip')
    await hook(app, { pickPhotos: [join(files, 'desk.png')] })
    await page.getByRole('region', { name: 'New object' }).getByRole('button', { name: 'Add photos…' }).click()
    await expect(dock().locator('.draft-pane')).toContainText('cable-clip')
    await expect(dock().locator('.draft-pane')).toContainText('1 photo')
    await expect(list().locator('[aria-current="true"]')).toHaveCount(0)
    await expect(marks()).toHaveCount(0)
    await expect(status()).toContainText('New object')
    await expect(status().getByRole('button', { name: 'Rebuild' })).toHaveCount(0)
    await expect(status().getByRole('button', { name: 'Export…' })).toHaveCount(0)
    // Escape leaves the field, then asks: the draft has something.
    await page.getByLabel('Name', { exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(page.getByLabel('Name', { exact: true })).not.toBeFocused()
    await page.keyboard.press('Escape')
    const ask = page.getByRole('alertdialog', { name: 'Discard this new object?' })
    await ask.getByRole('button', { name: 'Discard' }).click()
    await expect.poll(async () => (await state()).page).toBe('object')
    await expect(list().locator('[aria-current="true"]')).toHaveCount(1)
    await expect(marks()).toHaveCount(1)
    await expect(status().getByRole('button', { name: 'Rebuild' })).toBeVisible()
    await expect(dock().getByRole('button', { name: 'New session' })).toBeVisible()
  })

  test('a running session of the object that was open stays in full, with a note of whose it is', async () => {
    await dock().getByRole('button', { name: 'New session' }).click()
    await expect(dock().getByRole('button', { name: 'End session' })).toBeVisible({ timeout: 30_000 })
    await fromList(page).click()
    await expect(dock().locator('.session-status')).toBeVisible()
    await expect(dock().getByRole('button', { name: 'End session' })).toBeVisible()
    await expect(dock().locator('.session-aside')).toContainText('This is the session of bracket')
    await expect(dock().locator('.draft-pane')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await state()).page).toBe('object')
    await expect(dock().locator('.session-aside')).toHaveCount(0)
    await expect(dock().getByRole('button', { name: 'End session' })).toBeVisible()
  })
})
